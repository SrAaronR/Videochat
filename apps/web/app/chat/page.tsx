'use client';

/**
 * Sala de chat de texto — Fase 1.
 *
 * Conecta con el servidor de señalización por Socket.IO, entra en la cola
 * de emparejamiento y, al encontrar pareja, permite chatear por texto.
 * En la Fase 2 esta misma sala añadirá el flujo de video WebRTC
 * (el evento `signal` ya está contratado en @videochat/shared).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  EstadoChat,
  MensajeChat,
  ServerToClientEvents,
} from '@videochat/shared';

type SocketCliente = Socket<ServerToClientEvents, ClientToServerEvents>;

const URL_SIGNALING =
  process.env.NEXT_PUBLIC_SIGNALING_URL ?? 'http://localhost:4000';

/** Mensaje ya anotado con si lo escribió este cliente. */
interface MensajeUI extends MensajeChat {
  propio: boolean;
}

const TEXTO_ESTADO: Record<EstadoChat, string> = {
  inactivo: 'Desconectado',
  buscando: 'Buscando pareja…',
  conectado: 'Conectado con un desconocido',
  peer_desconectado: 'El desconocido se ha desconectado',
};

export default function PaginaChat() {
  const router = useRouter();
  const socketRef = useRef<SocketCliente | null>(null);
  const [estado, setEstado] = useState<EstadoChat>('inactivo');
  const [mensajes, setMensajes] = useState<MensajeUI[]>([]);
  const [borrador, setBorrador] = useState('');
  const [peerEscribiendo, setPeerEscribiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Autoscroll del panel de mensajes.
  const finListaRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    finListaRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, peerEscribiendo]);

  // Aviso "está escribiendo…" con apagado automático.
  const timeoutEscribiendoRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const socket: SocketCliente = io(URL_SIGNALING, {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setError(null);
      setEstado('buscando');
      socket.emit('find_match');
    });

    socket.on('connect_error', () => {
      setError('No se pudo conectar con el servidor. Reintentando…');
    });

    socket.on('buscando', () => setEstado('buscando'));

    socket.on('match_found', () => {
      setMensajes([]);
      setPeerEscribiendo(false);
      setEstado('conectado');
    });

    socket.on('chat_message', (mensaje) => {
      setPeerEscribiendo(false);
      setMensajes((previos) => [
        ...previos,
        { ...mensaje, propio: mensaje.autorId === socket.id },
      ]);
    });

    socket.on('typing', (escribiendo) => setPeerEscribiendo(escribiendo));

    socket.on('peer_left', () => {
      setPeerEscribiendo(false);
      setEstado('peer_desconectado');
    });

    socket.on('error_chat', (mensaje) => setError(mensaje));

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const enviarMensaje = useCallback(() => {
    const socket = socketRef.current;
    const texto = borrador.trim();
    if (!socket || !texto || estado !== 'conectado') return;
    socket.emit('chat_message', texto);
    socket.emit('typing', false);
    setBorrador('');
  }, [borrador, estado]);

  /** Notifica "escribiendo" y programa el apagado a los 2 s sin teclear. */
  const alEscribir = useCallback((valor: string) => {
    setBorrador(valor);
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('typing', true);
    if (timeoutEscribiendoRef.current) clearTimeout(timeoutEscribiendoRef.current);
    timeoutEscribiendoRef.current = setTimeout(() => socket.emit('typing', false), 2000);
  }, []);

  const siguiente = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    setMensajes([]);
    setPeerEscribiendo(false);
    setEstado('buscando');
    // `next` corta la sala actual (si la hay) y reencola en el servidor.
    socket.emit('next');
  }, []);

  const detener = useCallback(() => {
    socketRef.current?.emit('stop');
    router.push('/');
  }, [router]);

  return (
    <main className="mx-auto flex h-dvh max-w-2xl flex-col p-4">
      {/* Barra de estado y controles */}
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`h-2.5 w-2.5 rounded-full ${
              estado === 'conectado'
                ? 'bg-emerald-400'
                : estado === 'buscando'
                  ? 'animate-pulse bg-amber-400'
                  : 'bg-slate-500'
            }`}
          />
          <p aria-live="polite" className="text-sm text-slate-300">
            {TEXTO_ESTADO[estado]}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={siguiente}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold transition hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
          >
            {estado === 'peer_desconectado' ? 'Buscar otro' : 'Siguiente'}
          </button>
          <button
            onClick={detener}
            className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold transition hover:bg-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
          >
            Detener
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="mb-2 rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      )}

      {/* Panel de mensajes */}
      <section
        aria-label="Mensajes del chat"
        className="flex-1 space-y-2 overflow-y-auto rounded-xl bg-slate-900 p-4"
      >
        {mensajes.length === 0 && estado === 'conectado' && (
          <p className="text-center text-sm text-slate-500">
            Estás conectado. ¡Di hola!
          </p>
        )}
        {mensajes.map((mensaje) => (
          <div
            key={mensaje.id}
            className={`flex ${mensaje.propio ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                mensaje.propio ? 'bg-indigo-600' : 'bg-slate-700'
              }`}
            >
              <p className="break-words text-sm">{mensaje.texto}</p>
              <time
                dateTime={new Date(mensaje.timestamp).toISOString()}
                className="mt-1 block text-right text-[10px] text-slate-300/70"
              >
                {new Date(mensaje.timestamp).toLocaleTimeString('es', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </div>
          </div>
        ))}
        {peerEscribiendo && (
          <p className="text-sm italic text-slate-400">El desconocido está escribiendo…</p>
        )}
        <div ref={finListaRef} />
      </section>

      {/* Entrada de texto */}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(evento) => {
          evento.preventDefault();
          enviarMensaje();
        }}
      >
        <input
          value={borrador}
          onChange={(evento) => alEscribir(evento.target.value)}
          placeholder={
            estado === 'conectado' ? 'Escribe un mensaje…' : 'Esperando pareja…'
          }
          disabled={estado !== 'conectado'}
          aria-label="Mensaje"
          maxLength={2000}
          className="flex-1 rounded-xl bg-slate-800 px-4 py-3 text-sm placeholder:text-slate-500 focus:outline focus:outline-2 focus:outline-indigo-400 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={estado !== 'conectado' || !borrador.trim()}
          className="rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold transition hover:bg-indigo-400 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
        >
          Enviar
        </button>
      </form>
    </main>
  );
}
