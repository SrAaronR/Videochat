/**
 * Servidor de señalización — Fases 1-4.
 *
 * Responsabilidades:
 *  - Matchmaking con cola en Redis (un hash por modo video/texto):
 *      (a) durante los primeros 15 s se intenta match por intereses en común;
 *      (b) pasado ese tiempo, match totalmente aleatorio;
 *      (c) nunca se empareja con los últimos 3 matches de la sesión;
 *      (d) filtro opcional por país (detectado por IP con geoip-lite).
 *  - Chat de texto retransmitido por el servidor, con filtro de términos
 *    prohibidos y de datos personales (Fase 4).
 *  - Relay del evento `signal` (offer/answer/ICE) para WebRTC.
 *  - Moderación: denuncias con frame a PostgreSQL, strikes NSFW, baneos
 *    escalados por IP hasheada + fingerprint, rate limiting por IP y
 *    panel de administración con JWT (ver moderacion.ts y admin.ts).
 *
 * Deuda técnica declarada (ver README): las salas activas y el historial de
 * matches viven en memoria, por lo que solo se soporta UNA instancia de este
 * servidor. Para escalar horizontalmente habrá que moverlos a Redis y usar
 * el adapter @socket.io/redis-adapter.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { Server, type Socket } from 'socket.io';
import Redis from 'ioredis';
import geoip from 'geoip-lite';
import {
  MAX_BYTES_FRAME,
  MAX_INTERESES,
  MAX_LONGITUD_INTERES,
  MAX_LONGITUD_MENSAJE,
  MOTIVOS_DENUNCIA,
  TIPOS_SIGNAL,
  type ClientToServerEvents,
  type CriteriosBusqueda,
  type ModoChat,
  type MotivoDenuncia,
  type MotivoSalida,
  type PayloadAlertaNsfw,
  type PayloadDenuncia,
  type ServerToClientEvents,
  type SignalPayload,
} from '@videochat/shared';
import { prisma } from './db.js';
import {
  LIMITES,
  aplicarBan,
  consultarBan,
  dentroDelLimite,
  evaluarTexto,
  hashIp,
  incrementarMetrica,
  recargarBanesActivos,
  registrarStrikeNsfw,
  sanearFingerprint,
} from './moderacion.js';
import { crearRouterAdmin } from './admin.js';

/** Datos que colgamos de cada socket conectado. */
interface DatosSocket {
  /** Sala activa del socket, si está emparejado. */
  roomId?: string;
  /** true mientras el socket espera pareja en la cola. */
  buscando: boolean;
  /** Últimos criterios de búsqueda (se reutilizan al pulsar "Siguiente"). */
  criterios?: CriteriosBusqueda;
  /** País detectado por IP (ISO-3166 alpha-2) o null si no se pudo. */
  pais: string | null;
  /** Ids de socket de los últimos matches (para no repetir). */
  historial: string[];
  /** Hash irreversible de la IP (moderación y rate limiting). */
  ipHash: string;
  /** Fingerprint del navegador enviado por el cliente (o null). */
  fingerprint: string | null;
}

type SocketChat = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, DatosSocket>;

/** Una sala 1v1: los ids de socket de ambos participantes. */
interface Sala {
  a: string;
  b: string;
}

/** Entrada de la cola de emparejamiento (serializada en Redis). */
interface Esperando {
  socketId: string;
  intereses: string[];
  pais: string | null;
  filtroPais: string | null;
  /** Momento de entrada en la cola (ms epoch). */
  desde: number;
}

const PUERTO = Number(process.env.PORT ?? 4000);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
/** Orígenes permitidos para CORS, separados por comas. */
const ORIGENES = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',');
/** País por defecto cuando GeoIP no resuelve (útil en desarrollo local). */
const PAIS_POR_DEFECTO = process.env.PAIS_POR_DEFECTO || null;

/** Ventana durante la que solo se acepta match por intereses en común. */
const VENTANA_INTERESES_MS = Number(process.env.VENTANA_INTERESES_MS ?? 15_000);
/**
 * Ventana durante la que el filtro de país es obligatorio; pasada, se
 * empareja con cualquier país (preferencia con margen). Más corta que la de
 * intereses porque el país es una preferencia más "dura" y no conviene
 * dejar al usuario esperando mucho si no hay nadie de ese país.
 */
const VENTANA_PAIS_MS = Number(process.env.VENTANA_PAIS_MS ?? 6_000);
/** Cadencia del paso periódico de emparejamiento. */
const INTERVALO_PASO_MS = 2_000;
/** Cuántos matches recientes no se repiten. */
const MAX_HISTORIAL = 3;

/**
 * Política del detector NSFW automático (muestreo del video local del cliente):
 *  - 'off':   se ignora por completo (sin aviso ni baneo). Útil en pruebas.
 *  - 'aviso': avisa al usuario y guarda evidencia para revisión humana, pero
 *             NUNCA banea de forma automática (por defecto — el ML de cliente
 *             da falsos positivos y no es fiable para expulsar por sí solo).
 *  - 'auto':  comportamiento estricto de la especificación (1.er aviso,
 *             reincidencia → denuncia automática + ban temporal).
 */
const MODO_NSFW = (process.env.MODERACION_NSFW ?? 'aviso').toLowerCase();

const MODOS: ModoChat[] = ['video', 'texto'];

const redis = new Redis(REDIS_URL);
redis.on('error', (err) => console.error('[redis] error:', err.message));

// --- HTTP: salud + API de administración ------------------------------------

const app = express();
app.use(cors({ origin: ORIGENES }));
app.use(express.json({ limit: '1mb' }));
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, DatosSocket>(httpServer, {
  cors: { origin: ORIGENES },
  // Los frames de denuncia viajan como data-URI JPEG.
  maxHttpBufferSize: MAX_BYTES_FRAME + 64 * 1024,
});

/** Salas activas en memoria (ver nota de deuda técnica en la cabecera). */
const salas = new Map<string, Sala>();

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Clave del hash de Redis con la cola de espera de un modo. */
function claveCola(modo: ModoChat): string {
  return `cola:${modo}`;
}

/** IP real del socket (cabecera de proxy o dirección directa). */
function ipDelSocket(socket: SocketChat): string {
  const xff = socket.handshake.headers['x-forwarded-for'];
  return (
    (typeof xff === 'string' ? xff.split(',')[0]?.trim() : undefined) ??
    socket.handshake.address ??
    'desconocida'
  );
}

/** Detecta el país del socket por su IP. */
function detectarPais(socket: SocketChat): string | null {
  const resultado = geoip.lookup(ipDelSocket(socket));
  return resultado?.country ?? PAIS_POR_DEFECTO;
}

/** Sanea los criterios recibidos del cliente (tipos, límites y formato). */
function sanearCriterios(bruto: unknown): CriteriosBusqueda {
  const criterios = (typeof bruto === 'object' && bruto !== null ? bruto : {}) as Partial<CriteriosBusqueda>;

  const modo: ModoChat = criterios.modo === 'texto' ? 'texto' : 'video';

  const intereses = Array.isArray(criterios.intereses)
    ? [...new Set(
        criterios.intereses
          .filter((i): i is string => typeof i === 'string')
          .map((i) => i.trim().toLowerCase().slice(0, MAX_LONGITUD_INTERES))
          .filter(Boolean),
      )].slice(0, MAX_INTERESES)
    : [];

  const filtroPais =
    typeof criterios.filtroPais === 'string' && /^[a-zA-Z]{2}$/.test(criterios.filtroPais)
      ? criterios.filtroPais.toUpperCase()
      : null;

  return { modo, intereses, filtroPais };
}

/** Intereses en común entre dos entradas de la cola. */
function interesesComunes(u: Esperando, v: Esperando): string[] {
  const setV = new Set(v.intereses);
  return u.intereses.filter((i) => setV.has(i));
}

/**
 * Regla de intereses de un solo lado: `a` acepta a `b` si no puso intereses,
 * si ya agotó la ventana de intereses, o si comparten al menos uno.
 */
function aceptaPorIntereses(a: Esperando, b: Esperando, ahora: number): boolean {
  if (a.intereses.length === 0) return true;
  if (ahora - a.desde > VENTANA_INTERESES_MS) return true;
  return interesesComunes(a, b).length > 0;
}

/**
 * Regla de país de un solo lado (preferencia con margen): `a` acepta a `b`
 * si no puso filtro de país, si ya agotó la ventana de país (entonces se
 * empareja con cualquiera), o si `b` es del país filtrado. Evita que un
 * filtro de país deje al usuario esperando indefinidamente cuando no hay
 * nadie de ese país (o la geolocalización por IP no coincide).
 */
function aceptaPorPais(a: Esperando, b: Esperando, ahora: number): boolean {
  if (!a.filtroPais) return true;
  if (ahora - a.desde > VENTANA_PAIS_MS) return true;
  return b.pais === a.filtroPais;
}

/** Comprueba todas las reglas de compatibilidad entre dos usuarios en espera. */
function sonCompatibles(u: Esperando, v: Esperando, ahora: number): boolean {
  if (u.socketId === v.socketId) return false;

  const socketU = io.sockets.sockets.get(u.socketId) as SocketChat | undefined;
  const socketV = io.sockets.sockets.get(v.socketId) as SocketChat | undefined;
  if (!socketU || !socketV) return false;

  // (c) Nunca repetir con los últimos matches de la sesión (en ambos sentidos).
  if (socketU.data.historial.includes(v.socketId)) return false;
  if (socketV.data.historial.includes(u.socketId)) return false;

  // (d) Filtro de país como preferencia con margen (ventana de país), en
  // ambos sentidos: pasado ese tiempo se acepta cualquier país.
  if (!aceptaPorPais(u, v, ahora) || !aceptaPorPais(v, u, ahora)) return false;

  // (a)/(b) Regla de intereses con su ventana, en ambos sentidos.
  return aceptaPorIntereses(u, v, ahora) && aceptaPorIntereses(v, u, ahora);
}

// ---------------------------------------------------------------------------
// Matchmaking
// ---------------------------------------------------------------------------

/** Crea la sala, une a ambos sockets, actualiza historiales y notifica. */
function emparejar(entradaA: Esperando, entradaB: Esperando, modo: ModoChat): void {
  const a = io.sockets.sockets.get(entradaA.socketId) as SocketChat | undefined;
  const b = io.sockets.sockets.get(entradaB.socketId) as SocketChat | undefined;
  if (!a || !b) return;

  const roomId = randomUUID();
  salas.set(roomId, { a: a.id, b: b.id });
  const comunes = interesesComunes(entradaA, entradaB);

  for (const [socket, otro] of [[a, b], [b, a]] as const) {
    socket.data.roomId = roomId;
    socket.data.buscando = false;
    socket.join(roomId);
    // Historial corto por sesión para la regla de no-repetición.
    socket.data.historial = [otro.id, ...socket.data.historial].slice(0, MAX_HISTORIAL);
  }

  void incrementarMetrica(redis, 'matches');

  // El que más tiempo llevaba esperando (entradaA) es el initiator WebRTC.
  a.emit('match_found', {
    roomId,
    initiator: true,
    peerId: b.id,
    modo,
    interesesComunes: comunes,
    paisPeer: entradaB.pais,
  });
  b.emit('match_found', {
    roomId,
    initiator: false,
    peerId: a.id,
    modo,
    interesesComunes: comunes,
    paisPeer: entradaA.pais,
  });
}

/** Evita pasos concurrentes de emparejamiento por modo. */
const pasoEnCurso: Record<ModoChat, boolean> = { video: false, texto: false };

/**
 * Paso de emparejamiento: carga la cola del modo, descarta entradas
 * obsoletas y empareja de forma voraz (los que más esperan primero,
 * prefiriendo el candidato con más intereses en común). Los usuarios se
 * reclaman con HDEL atómico para que un `stop`/desconexión concurrente
 * no produzca dobles matches.
 */
async function pasoDeEmparejamiento(modo: ModoChat): Promise<void> {
  if (pasoEnCurso[modo]) return;
  pasoEnCurso[modo] = true;
  try {
    const clave = claveCola(modo);
    const bruto = await redis.hgetall(clave);
    const ahora = Date.now();

    const espera: Esperando[] = [];
    for (const [socketId, json] of Object.entries(bruto)) {
      const socket = io.sockets.sockets.get(socketId) as SocketChat | undefined;
      if (!socket || !socket.data.buscando || socket.data.roomId) {
        await redis.hdel(clave, socketId); // entrada obsoleta
        continue;
      }
      try {
        espera.push(JSON.parse(json) as Esperando);
      } catch {
        await redis.hdel(clave, socketId);
      }
    }

    espera.sort((a, b) => a.desde - b.desde);
    const usados = new Set<string>();

    for (const u of espera) {
      if (usados.has(u.socketId)) continue;

      // Mejor candidato: compatible con más intereses en común; a igualdad,
      // el que más tiempo lleva esperando (orden del bucle).
      let mejor: Esperando | null = null;
      let mejorComunes = -1;
      for (const v of espera) {
        if (usados.has(v.socketId) || !sonCompatibles(u, v, ahora)) continue;
        const comunes = interesesComunes(u, v).length;
        if (comunes > mejorComunes) {
          mejor = v;
          mejorComunes = comunes;
        }
      }
      if (!mejor) continue;

      // Reclamo atómico de ambos: si alguno ya no está (stop/desconexión
      // durante este paso), se devuelve a la cola al que siga válido.
      const borrados = await redis.hdel(clave, u.socketId, mejor.socketId);
      if (borrados < 2) {
        for (const w of [u, mejor]) {
          const s = io.sockets.sockets.get(w.socketId) as SocketChat | undefined;
          if (s?.data.buscando && !s.data.roomId) {
            await redis.hset(clave, w.socketId, JSON.stringify(w));
          }
        }
        continue;
      }

      usados.add(u.socketId);
      usados.add(mejor.socketId);
      emparejar(u, mejor, modo);
    }
  } catch (err) {
    console.error(`[matchmaking] error en paso (${modo}):`, err);
  } finally {
    pasoEnCurso[modo] = false;
  }
}

/** Encola al socket con sus criterios y dispara un paso inmediato. */
async function encolar(socket: SocketChat, criterios: CriteriosBusqueda): Promise<void> {
  if (socket.data.roomId) return; // Ya está en una sala.

  // Rate limit de búsquedas por IP (frena bots que hacen "Siguiente" en bucle).
  const permitido = await dentroDelLimite(
    redis, 'matches', socket.data.ipHash, LIMITES.matchesPorMinuto, 60,
  );
  if (!permitido) {
    socket.emit('error_chat', 'Demasiadas búsquedas seguidas. Espera un momento.');
    return;
  }

  socket.data.criterios = criterios;
  socket.data.buscando = true;

  const entrada: Esperando = {
    socketId: socket.id,
    intereses: criterios.intereses,
    pais: socket.data.pais,
    filtroPais: criterios.filtroPais,
    desde: Date.now(),
  };
  await redis.hset(claveCola(criterios.modo), socket.id, JSON.stringify(entrada));
  socket.emit('buscando');
  void pasoDeEmparejamiento(criterios.modo);
}

// Paso periódico: reempareja a quienes agotaron la ventana de intereses
// sin necesidad de que entre nadie nuevo en la cola.
setInterval(() => {
  for (const modo of MODOS) void pasoDeEmparejamiento(modo);
}, INTERVALO_PASO_MS);

// ---------------------------------------------------------------------------
// Salas
// ---------------------------------------------------------------------------

/** Devuelve el socket del otro participante de la sala, si sigue conectado. */
function obtenerPeer(socket: SocketChat): SocketChat | null {
  const roomId = socket.data.roomId;
  if (!roomId) return null;
  const sala = salas.get(roomId);
  if (!sala) return null;
  const peerId = sala.a === socket.id ? sala.b : sala.a;
  return (io.sockets.sockets.get(peerId) as SocketChat | undefined) ?? null;
}

/**
 * Saca al socket de su sala actual (si la hay), limpia el estado y
 * notifica al peer con el motivo. El peer NO se reencola automáticamente:
 * su cliente decide cuándo volver a buscar.
 */
function abandonarSala(socket: SocketChat, motivo: MotivoSalida): void {
  const roomId = socket.data.roomId;
  if (!roomId) return;

  const peer = obtenerPeer(socket);
  salas.delete(roomId);
  socket.data.roomId = undefined;
  void socket.leave(roomId);

  if (peer) {
    peer.data.roomId = undefined;
    void peer.leave(roomId);
    peer.emit('peer_left', motivo);
  }
}

/** Tamaño máximo aceptado para un mensaje de señalización (un SDP típico son unos pocos KB). */
const MAX_BYTES_SIGNAL = 100 * 1024;

/** Comprueba que el payload de `signal` tiene una forma admisible antes del relay. */
function esSignalValido(data: unknown): data is SignalPayload {
  if (typeof data !== 'object' || data === null) return false;
  const tipo = (data as { type?: unknown }).type;
  if (typeof tipo !== 'string' || !(TIPOS_SIGNAL as readonly string[]).includes(tipo)) {
    return false;
  }
  try {
    return JSON.stringify(data).length <= MAX_BYTES_SIGNAL;
  } catch {
    return false;
  }
}

/** Elimina al socket de las colas de Redis (si estaba encolado). */
async function salirDeCola(socket: SocketChat): Promise<void> {
  socket.data.buscando = false;
  for (const modo of MODOS) {
    await redis.hdel(claveCola(modo), socket.id);
  }
}

// ---------------------------------------------------------------------------
// Moderación
// ---------------------------------------------------------------------------

/** Decodifica un data-URI JPEG a bytes, validando prefijo y tamaño. */
function decodificarFrame(frame: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof frame !== 'string') return null;
  if (frame.length > MAX_BYTES_FRAME) return null;
  const prefijo = 'data:image/jpeg;base64,';
  if (!frame.startsWith(prefijo)) return null;
  try {
    // Copia a un Uint8Array plano (el tipo Bytes de Prisma no admite Buffer
    // respaldado por SharedArrayBuffer).
    return new Uint8Array(Buffer.from(frame.slice(prefijo.length), 'base64'));
  } catch {
    return null;
  }
}

/** Banea al socket dado: registra, notifica y desconecta. */
async function banearSocket(socket: SocketChat, motivo: string): Promise<void> {
  const info = await aplicarBan(redis, socket.data.ipHash, socket.data.fingerprint, motivo);
  desconectarBaneados(socket.data.ipHash, socket.data.fingerprint, info.motivo, info.hasta);
}

/**
 * Desconecta en caliente todos los sockets que casen con la identidad
 * recién baneada (todas las pestañas del mismo navegador o IP).
 */
function desconectarBaneados(
  ipHash: string | null,
  fingerprint: string | null,
  motivo: string,
  hasta: number | null,
): void {
  for (const [, generico] of io.sockets.sockets) {
    const socket = generico as SocketChat;
    const coincide =
      (ipHash && socket.data.ipHash === ipHash) ||
      (fingerprint && socket.data.fingerprint === fingerprint);
    if (coincide) {
      socket.emit('baneado', { motivo, hasta });
      abandonarSala(socket, 'desconexion');
      void salirDeCola(socket);
      // Margen para que el evento llegue antes de cortar el socket.
      setTimeout(() => socket.disconnect(true), 100);
    }
  }
}

/** Registra una denuncia (manual o automática) en PostgreSQL. */
async function guardarDenuncia(
  socket: SocketChat,
  denunciado: SocketChat | null,
  motivo: string,
  origen: 'manual' | 'nsfw-auto',
  frame: Uint8Array<ArrayBuffer> | null,
): Promise<void> {
  await prisma.denuncia.create({
    data: {
      motivo,
      origen,
      sesionDenunciante: socket.id,
      sesionDenunciado: denunciado?.id ?? socket.id,
      roomId: socket.data.roomId ?? null,
      ipHashDenunciado: denunciado?.data.ipHash ?? socket.data.ipHash,
      fingerprintDenunciado: denunciado?.data.fingerprint ?? socket.data.fingerprint,
      frame,
    },
  });
  void incrementarMetrica(redis, 'denuncias');
}

// ---------------------------------------------------------------------------
// Conexiones
// ---------------------------------------------------------------------------

// Gate de baneos: se comprueba ANTES de aceptar la conexión. El cliente
// recibe connect_error con message='baneado' y data={motivo, hasta}.
io.use((generico, next) => {
  const socket = generico as SocketChat;
  socket.data.ipHash = hashIp(ipDelSocket(socket));
  socket.data.fingerprint = sanearFingerprint(socket.handshake.auth?.fingerprint);

  consultarBan(redis, socket.data.ipHash, socket.data.fingerprint)
    .then((ban) => {
      if (!ban) {
        next();
        return;
      }
      const err = new Error('baneado') as Error & { data?: unknown };
      err.data = ban;
      next(err);
    })
    .catch((e) => {
      console.error('[moderacion] error consultando ban:', e);
      next(); // Redis caído: no bloquear el servicio entero.
    });
});

io.on('connection', (socket: SocketChat) => {
  socket.data.buscando = false;
  socket.data.historial = [];
  socket.data.pais = detectarPais(socket);

  socket.on('find_match', (criteriosBrutos) => {
    const criterios = sanearCriterios(criteriosBrutos);
    void encolar(socket, criterios).catch((err) => {
      console.error('[matchmaking] error:', err);
      socket.emit('error_chat', 'Error interno buscando pareja. Inténtalo de nuevo.');
    });
  });

  socket.on('chat_message', (texto) => {
    void (async () => {
      // Validación en servidor: tipo, contenido no vacío y longitud máxima.
      if (typeof texto !== 'string') return;
      const limpio = texto.trim().slice(0, MAX_LONGITUD_MENSAJE);
      if (!limpio) return;

      const peer = obtenerPeer(socket);
      if (!peer || !socket.data.roomId) {
        socket.emit('error_chat', 'No estás conectado con nadie.');
        return;
      }

      // Rate limit de mensajes por segundo (anti-spam/flood).
      const permitido = await dentroDelLimite(
        redis, 'mensajes', socket.data.ipHash, LIMITES.mensajesPorSegundo, 1,
      );
      if (!permitido) {
        socket.emit('error_chat', 'Estás enviando mensajes demasiado rápido.');
        return;
      }

      // Filtro de términos prohibidos y datos personales (Fase 4).
      const veredicto = evaluarTexto(limpio);
      if (!veredicto.permitido) {
        socket.emit('aviso_moderacion', { tipo: 'texto', mensaje: veredicto.aviso });
        return;
      }

      const mensaje = {
        id: randomUUID(),
        texto: limpio,
        autorId: socket.id,
        timestamp: Date.now(),
      };
      // Se emite a toda la sala (autor incluido) para que ambos clientes
      // rendericen el mismo mensaje canónico validado por el servidor.
      io.to(socket.data.roomId).emit('chat_message', mensaje);
    })().catch((err) => console.error('[chat] error:', err));
  });

  socket.on('typing', (escribiendo) => {
    obtenerPeer(socket)?.emit('typing', Boolean(escribiendo));
  });

  // Relay de señalización WebRTC (offer/answer/ICE). El servidor no
  // interpreta el contenido: valida la forma y el tamaño y lo reenvía.
  socket.on('signal', (data) => {
    if (!esSignalValido(data)) return;
    obtenerPeer(socket)?.emit('signal', data);
  });

  // Denuncia manual: frame del video remoto + motivo → PostgreSQL.
  socket.on('denunciar', (bruto) => {
    void (async () => {
      const payload = (typeof bruto === 'object' && bruto !== null ? bruto : {}) as Partial<PayloadDenuncia>;
      const motivo = payload.motivo as MotivoDenuncia;
      if (!(motivo in MOTIVOS_DENUNCIA)) return;

      const permitido = await dentroDelLimite(
        redis, 'denuncias', socket.data.ipHash, LIMITES.denunciasPorMinuto, 60,
      );
      if (!permitido) {
        socket.emit('error_chat', 'Has enviado demasiadas denuncias seguidas.');
        return;
      }

      const peer = obtenerPeer(socket);
      if (!peer) {
        socket.emit('error_chat', 'No hay nadie a quien denunciar.');
        return;
      }

      await guardarDenuncia(socket, peer, motivo, 'manual', decodificarFrame(payload.frame));
      socket.emit('denuncia_recibida');
    })().catch((err) => {
      console.error('[moderacion] error guardando denuncia:', err);
      socket.emit('error_chat', 'No se pudo registrar la denuncia. Inténtalo de nuevo.');
    });
  });

  // Alerta del detector NSFW del cliente (video local del propio usuario).
  // El comportamiento depende de MODO_NSFW (off / aviso / auto).
  socket.on('nsfw_alerta', (bruto) => {
    if (MODO_NSFW === 'off') return; // Detector desactivado en servidor.
    void (async () => {
      const payload = (typeof bruto === 'object' && bruto !== null ? bruto : {}) as Partial<PayloadAlertaNsfw>;
      const permitido = await dentroDelLimite(
        redis, 'nsfw', socket.data.ipHash, LIMITES.alertasNsfwPorMinuto, 60,
      );
      if (!permitido) return;

      // Modo 'aviso' (por defecto): informa y guarda evidencia para el panel,
      // pero no banea automáticamente (los falsos positivos del modelo de
      // cliente hacen que el auto-ban expulse a usuarios legítimos).
      if (MODO_NSFW !== 'auto') {
        socket.emit('aviso_moderacion', {
          tipo: 'nsfw',
          mensaje:
            'Se ha detectado posible contenido inapropiado en tu cámara. Recuerda las normas de la comunidad.',
        });
        await guardarDenuncia(socket, null, 'nsfw-auto', 'nsfw-auto', decodificarFrame(payload.frame));
        return;
      }

      // Modo 'auto' (estricto, como la especificación): 1.er aviso;
      // reincidencia → denuncia automática + ban temporal + desconexión.
      const strikes = await registrarStrikeNsfw(
        redis,
        socket.data.fingerprint ?? socket.data.ipHash,
      );
      if (strikes === 1) {
        socket.emit('aviso_moderacion', {
          tipo: 'nsfw',
          mensaje:
            'Se ha detectado posible contenido inapropiado en tu cámara. Si se repite, serás expulsado.',
        });
        return;
      }
      await guardarDenuncia(socket, null, 'nsfw-auto', 'nsfw-auto', decodificarFrame(payload.frame));
      await banearSocket(socket, 'Contenido inapropiado detectado por el sistema automático');
    })().catch((err) => console.error('[moderacion] error en nsfw_alerta:', err));
  });

  socket.on('next', () => {
    abandonarSala(socket, 'siguiente');
    const criterios = socket.data.criterios ?? sanearCriterios(null);
    void encolar(socket, criterios).catch((err) => {
      console.error('[matchmaking] error en next:', err);
      socket.emit('error_chat', 'Error interno buscando pareja. Inténtalo de nuevo.');
    });
  });

  socket.on('stop', () => {
    abandonarSala(socket, 'detener');
    void salirDeCola(socket);
  });

  socket.on('disconnect', () => {
    abandonarSala(socket, 'desconexion');
    void salirDeCola(socket).catch(() => {
      // Redis caído: no hay nada más que limpiar en este punto.
    });
  });
});

// --- Panel de administración -------------------------------------------------

app.use(
  '/admin',
  crearRouterAdmin({
    redis,
    io,
    desconectarBaneados,
    tamanosColas: async () => {
      const tamanos: Record<string, number> = {};
      for (const modo of MODOS) tamanos[modo] = await redis.hlen(claveCola(modo));
      return tamanos;
    },
  }),
);

// --- Arranque -----------------------------------------------------------------

void recargarBanesActivos(redis).catch((err) =>
  console.error('[moderacion] no se pudieron recargar los baneos:', err),
);

httpServer.listen(PUERTO, () => {
  console.log(`[signaling] escuchando en puerto ${PUERTO} (redis: ${REDIS_URL})`);
});
