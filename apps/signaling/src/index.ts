/**
 * Servidor de señalización — Fase 1.
 *
 * Responsabilidades:
 *  - Matchmaking aleatorio básico con cola en Redis (LPUSH/LPOP atómicos).
 *  - Chat de texto retransmitido por el servidor (necesario para poder
 *    moderarlo en fases posteriores; nunca por data channel).
 *  - Relay del evento `signal` (offer/answer/ICE) preparado para la Fase 2.
 *
 * Deuda técnica declarada (ver README): las salas activas viven en memoria,
 * por lo que solo se soporta UNA instancia de este servidor. Para escalar
 * horizontalmente habrá que mover las salas a Redis y usar el adapter
 * @socket.io/redis-adapter.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server, type Socket } from 'socket.io';
import Redis from 'ioredis';
import {
  MAX_LONGITUD_MENSAJE,
  type ClientToServerEvents,
  type MotivoSalida,
  type ServerToClientEvents,
} from '@videochat/shared';

/** Datos que colgamos de cada socket conectado. */
interface DatosSocket {
  /** Sala activa del socket, si está emparejado. */
  roomId?: string;
  /** true mientras el socket espera pareja en la cola. */
  buscando: boolean;
}

type SocketChat = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, DatosSocket>;

/** Una sala 1v1: los ids de socket de ambos participantes. */
interface Sala {
  a: string;
  b: string;
}

const PUERTO = Number(process.env.PORT ?? 4000);
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
/** Orígenes permitidos para CORS, separados por comas. */
const ORIGENES = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',');

/** Clave de la cola de emparejamiento en Redis. */
const CLAVE_COLA = 'matchmaking:cola';

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

/**
 * Saca candidatos de la cola hasta encontrar uno válido.
 * LPOP es atómico, así que dos búsquedas simultáneas nunca obtienen
 * el mismo candidato. Los ids obsoletos (desconectados, ya emparejados
 * o que cancelaron la búsqueda) se descartan sobre la marcha.
 */
async function extraerCandidato(solicitante: SocketChat): Promise<SocketChat | null> {
  // Límite defensivo para no iterar indefinidamente sobre una cola corrupta.
  for (let i = 0; i < 100; i++) {
    const candidatoId = await redis.lpop(CLAVE_COLA);
    if (!candidatoId) return null;
    if (candidatoId === solicitante.id) continue;

    const candidato = io.sockets.sockets.get(candidatoId) as SocketChat | undefined;
    if (!candidato || !candidato.data.buscando || candidato.data.roomId) continue;
    return candidato;
  }
  return null;
}

/** Crea la sala, une a ambos sockets y les notifica el match. */
function emparejar(a: SocketChat, b: SocketChat): void {
  const roomId = randomUUID();
  salas.set(roomId, { a: a.id, b: b.id });

  for (const socket of [a, b]) {
    socket.data.roomId = roomId;
    socket.data.buscando = false;
    socket.join(roomId);
  }

  // El servidor designa al solicitante más antiguo (b, que ya esperaba
  // en la cola) como initiator: será quien cree la offer en la Fase 2.
  a.emit('match_found', { roomId, initiator: false, peerId: b.id });
  b.emit('match_found', { roomId, initiator: true, peerId: a.id });
}

/** Intenta emparejar al socket; si no hay nadie disponible, lo encola. */
async function buscarPareja(socket: SocketChat): Promise<void> {
  if (socket.data.roomId) return; // Ya está en una sala.
  socket.data.buscando = true;

  const candidato = await extraerCandidato(socket);

  // El propio solicitante pudo desconectarse mientras consultábamos Redis.
  if (!socket.connected || !socket.data.buscando) {
    if (candidato) await redis.rpush(CLAVE_COLA, candidato.id);
    return;
  }

  if (candidato) {
    emparejar(socket, candidato);
  } else {
    await redis.rpush(CLAVE_COLA, socket.id);
    socket.emit('buscando');
  }
}

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

/** Elimina al socket de la cola de Redis (si estaba encolado). */
async function salirDeCola(socket: SocketChat): Promise<void> {
  socket.data.buscando = false;
  await redis.lrem(CLAVE_COLA, 0, socket.id);
}

io.on('connection', (socket: SocketChat) => {
  socket.data.buscando = false;

  socket.on('find_match', () => {
    void buscarPareja(socket).catch((err) => {
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

  // Relay de señalización WebRTC (se usará en la Fase 2).
  socket.on('signal', (data) => {
    obtenerPeer(socket)?.emit('signal', data);
  });

  socket.on('next', () => {
    abandonarSala(socket, 'siguiente');
    void buscarPareja(socket).catch((err) => {
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
