/**
 * Servidor de señalización — Fases 1-3.
 *
 * Responsabilidades:
 *  - Matchmaking con cola en Redis (un hash por modo video/texto):
 *      (a) durante los primeros 15 s se intenta match por intereses en común;
 *      (b) pasado ese tiempo, match totalmente aleatorio;
 *      (c) nunca se empareja con los últimos 3 matches de la sesión;
 *      (d) filtro opcional por país (detectado por IP con geoip-lite).
 *  - Chat de texto retransmitido por el servidor (necesario para poder
 *    moderarlo en la Fase 4; nunca por data channel).
 *  - Relay del evento `signal` (offer/answer/ICE) para WebRTC.
 *
 * Deuda técnica declarada (ver README): las salas activas y el historial de
 * matches viven en memoria, por lo que solo se soporta UNA instancia de este
 * servidor. Para escalar horizontalmente habrá que moverlos a Redis y usar
 * el adapter @socket.io/redis-adapter.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server, type Socket } from 'socket.io';
import Redis from 'ioredis';
import geoip from 'geoip-lite';
import {
  MAX_INTERESES,
  MAX_LONGITUD_INTERES,
  MAX_LONGITUD_MENSAJE,
  TIPOS_SIGNAL,
  type ClientToServerEvents,
  type CriteriosBusqueda,
  type ModoChat,
  type MotivoSalida,
  type ServerToClientEvents,
  type SignalPayload,
} from '@videochat/shared';

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
/** Cadencia del paso periódico de emparejamiento. */
const INTERVALO_PASO_MS = 2_000;
/** Cuántos matches recientes no se repiten. */
const MAX_HISTORIAL = 3;

const MODOS: ModoChat[] = ['video', 'texto'];

const redis = new Redis(REDIS_URL);
redis.on('error', (err) => console.error('[redis] error:', err.message));

const httpServer = createServer((req, res) => {
  // Endpoint de salud para docker-compose / monitorización.
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, DatosSocket>(httpServer, {
  cors: { origin: ORIGENES },
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

/** Detecta el país del socket por su IP (cabecera de proxy o dirección directa). */
function detectarPais(socket: SocketChat): string | null {
  const xff = socket.handshake.headers['x-forwarded-for'];
  const ip =
    (typeof xff === 'string' ? xff.split(',')[0]?.trim() : undefined) ??
    socket.handshake.address;
  const resultado = ip ? geoip.lookup(ip) : null;
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
 * si ya agotó la ventana de 15 s, o si comparten al menos uno.
 */
function aceptaPorIntereses(a: Esperando, b: Esperando, ahora: number): boolean {
  if (a.intereses.length === 0) return true;
  if (ahora - a.desde > VENTANA_INTERESES_MS) return true;
  return interesesComunes(a, b).length > 0;
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

  // (d) Filtro de país: si un lado lo fijó, el otro debe cumplirlo.
  if (u.filtroPais && v.pais !== u.filtroPais) return false;
  if (v.filtroPais && u.pais !== v.filtroPais) return false;

  // (a)/(b) Regla de intereses con ventana de 15 s, en ambos sentidos.
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
// Conexiones
// ---------------------------------------------------------------------------

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
    // Validación en servidor: tipo, contenido no vacío y longitud máxima.
    // Aquí se enganchará el filtro de términos prohibidos en la Fase 4.
    if (typeof texto !== 'string') return;
    const limpio = texto.trim().slice(0, MAX_LONGITUD_MENSAJE);
    if (!limpio) return;

    const peer = obtenerPeer(socket);
    if (!peer || !socket.data.roomId) {
      socket.emit('error_chat', 'No estás conectado con nadie.');
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

httpServer.listen(PUERTO, () => {
  console.log(`[signaling] escuchando en puerto ${PUERTO} (redis: ${REDIS_URL})`);
});
