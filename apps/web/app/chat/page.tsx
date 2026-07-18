'use client';

/**
 * Sala de videochat — Fase 2.
 *
 * Flujo WebRTC (según especificación):
 *  1. Ambos clientes reciben `match_found` con roomId; el servidor designa
 *     al initiator.
 *  2. El initiator crea la offer y la envía por Socket.IO (`signal`).
 *  3. El otro responde con answer; ambos intercambian candidatos ICE por
 *     el mismo canal.
 *  4. STUN de Google + TURN propio como respaldo. Si en 10 s no hay
 *     conexión: error y re-match automático.
 *  5. "Siguiente"/cierre de pestaña: se cierra la RTCPeerConnection, se
 *     notifica al peer y se limpia la sala; quien pulsó se reencola al
 *     instante y el otro ve el aviso y vuelve a buscar automáticamente.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  EstadoChat,
  ServerToClientEvents,
  SignalPayload,
} from '@videochat/shared';
import PanelChat, { type MensajeUI } from '@/components/PanelChat';
import {
  crearConfiguracionRtc,
  RESTRICCIONES_MEDIA,
  TIMEOUT_CONEXION_MS,
} from '@/lib/webrtc';

type SocketCliente = Socket<ServerToClientEvents, ClientToServerEvents>;

const URL_SIGNALING =
  process.env.NEXT_PUBLIC_SIGNALING_URL ?? 'http://localhost:4000';

const TEXTO_ESTADO: Record<EstadoChat, string> = {
  inactivo: 'Desconectado',
  buscando: 'Buscando pareja…',
  conectando: 'Conectando…',
  conectado: 'Conectado',
  peer_desconectado: 'El desconocido se ha desconectado',
};

/** Estado del acceso a cámara y micrófono. */
type EstadoMedia = 'pidiendo' | 'ok' | 'denegado';

const MOTIVOS_DENUNCIA = ['Desnudez', 'Menor de edad', 'Acoso', 'Spam', 'Otro'];

export default function PaginaChat() {
  const router = useRouter();

  // --- Estado de UI ---
  const [estadoMedia, setEstadoMedia] = useState<EstadoMedia>('pidiendo');
  const [estado, setEstado] = useState<EstadoChat>('inactivo');
  const [aviso, setAviso] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<MensajeUI[]>([]);
  const [borrador, setBorrador] = useState('');
  const [peerEscribiendo, setPeerEscribiendo] = useState(false);
  const [micActivo, setMicActivo] = useState(true);
  const [camaraActiva, setCamaraActiva] = useState(true);
  const [denunciaAbierta, setDenunciaAbierta] = useState(false);
  /** Posición del video local tras arrastrarlo (null = esquina por defecto). */
  const [posLocal, setPosLocal] = useState<{ x: number; y: number } | null>(null);

  // --- Refs de infraestructura (mutables, fuera del ciclo de render) ---
  const socketRef = useRef<SocketCliente | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamLocalRef = useRef<MediaStream | null>(null);
  const videoLocalRef = useRef<HTMLVideoElement | null>(null);
  const videoRemotoRef = useRef<HTMLVideoElement | null>(null);
  const zonaVideoRef = useRef<HTMLElement | null>(null);
  /** Candidatos ICE recibidos antes de tener remoteDescription. */
  const candidatosPendientesRef = useRef<SignalPayload[]>([]);
  const esInitiatorRef = useRef(false);
  const estadoRef = useRef<EstadoChat>('inactivo');
  const timeoutConexionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutRebusquedaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutEscribiendoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arrastreRef = useRef<{ dx: number; dy: number } | null>(null);

  const cambiarEstado = useCallback((nuevo: EstadoChat) => {
    estadoRef.current = nuevo;
    setEstado(nuevo);
  }, []);

  /** Cierra la RTCPeerConnection actual y limpia timers/estado asociado. */
  const limpiarPeerConnection = useCallback(() => {
    if (timeoutConexionRef.current) {
      clearTimeout(timeoutConexionRef.current);
      timeoutConexionRef.current = null;
    }
    candidatosPendientesRef.current = [];
    const pc = pcRef.current;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      pcRef.current = null;
    }
    if (videoRemotoRef.current) videoRemotoRef.current.srcObject = null;
  }, []);

  /** Vuelve a la cola de emparejamiento (limpia la llamada anterior). */
  const buscarDeNuevo = useCallback(() => {
    if (timeoutRebusquedaRef.current) {
      clearTimeout(timeoutRebusquedaRef.current);
      timeoutRebusquedaRef.current = null;
    }
    limpiarPeerConnection();
    setMensajes([]);
    setPeerEscribiendo(false);
    cambiarEstado('buscando');
    // `next` corta la sala actual en el servidor (si la hay) y reencola.
    socketRef.current?.emit('next');
  }, [cambiarEstado, limpiarPeerConnection]);

  /** Aplica los candidatos ICE que llegaron antes que la remoteDescription. */
  const vaciarCandidatosPendientes = useCallback(async (pc: RTCPeerConnection) => {
    const pendientes = candidatosPendientesRef.current;
    candidatosPendientesRef.current = [];
    for (const señal of pendientes) {
      if (señal.type === 'candidate') {
        await pc.addIceCandidate(señal.candidate).catch(() => {
          // Un candidato inválido no debe tumbar la llamada.
        });
      }
    }
  }, []);

  /** Crea la RTCPeerConnection para un nuevo match y arranca el timeout. */
  const crearPeerConnection = useCallback(() => {
    limpiarPeerConnection();
    const pc = new RTCPeerConnection(crearConfiguracionRtc());
    pcRef.current = pc;

    // Tracks locales hacia el peer.
    const stream = streamLocalRef.current;
    if (stream) {
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
    }

    // Video/audio remoto entrante.
    pc.ontrack = (evento) => {
      const [streamRemoto] = evento.streams;
      const video = videoRemotoRef.current;
      if (video && streamRemoto && video.srcObject !== streamRemoto) {
        video.srcObject = streamRemoto;
        // En iOS el autoplay puede requerir un play() explícito.
        void video.play().catch(() => undefined);
      }
    };

    // Cada candidato ICE local se envía al peer por el socket.
    pc.onicecandidate = (evento) => {
      if (evento.candidate) {
        socketRef.current?.emit('signal', {
          type: 'candidate',
          candidate: evento.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connected':
          if (timeoutConexionRef.current) {
            clearTimeout(timeoutConexionRef.current);
            timeoutConexionRef.current = null;
          }
          setAviso(null);
          cambiarEstado('conectado');
          break;
        case 'disconnected':
          setAviso('Conexión de video inestable…');
          break;
        case 'failed':
          // El peer se cayó a mitad de llamada: mostrar estado y re-buscar.
          limpiarPeerConnection();
          cambiarEstado('peer_desconectado');
          setAviso('Se perdió la conexión de video. Buscando otra persona…');
          timeoutRebusquedaRef.current = setTimeout(buscarDeNuevo, 3000);
          break;
        default:
          break;
      }
    };

    // Timeout de establecimiento: 10 s → error y re-match automático.
    timeoutConexionRef.current = setTimeout(() => {
      if (estadoRef.current !== 'conectado') {
        setAviso('No se pudo establecer la conexión. Buscando otra persona…');
        buscarDeNuevo();
      }
    }, TIMEOUT_CONEXION_MS);

    return pc;
  }, [buscarDeNuevo, cambiarEstado, limpiarPeerConnection]);

  /** Procesa un mensaje de señalización recibido del peer. */
  const procesarSignal = useCallback(
    async (señal: SignalPayload) => {
      const pc = pcRef.current;
      if (!pc) return;

      if (señal.type === 'offer') {
        await pc.setRemoteDescription({ type: 'offer', sdp: señal.sdp });
        await vaciarCandidatosPendientes(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketRef.current?.emit('signal', { type: 'answer', sdp: answer.sdp ?? '' });
      } else if (señal.type === 'answer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: señal.sdp });
        await vaciarCandidatosPendientes(pc);
      } else if (señal.type === 'candidate') {
        // Si aún no hay remoteDescription, el candidato se guarda para después.
        if (pc.remoteDescription) {
          await pc.addIceCandidate(señal.candidate).catch(() => undefined);
        } else {
          candidatosPendientesRef.current.push(señal);
        }
      }
    },
    [vaciarCandidatosPendientes],
  );

  // --- Arranque: cámara/micro primero, luego socket y matchmaking ---
  useEffect(() => {
    let cancelado = false;
    let socket: SocketCliente | null = null;

    async function iniciar() {
      // 1) Permisos de media. Sin cámara/micro no se entra en la cola.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(RESTRICCIONES_MEDIA);
      } catch {
        if (!cancelado) setEstadoMedia('denegado');
        return;
      }
      if (cancelado) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      streamLocalRef.current = stream;
      if (videoLocalRef.current) {
        videoLocalRef.current.srcObject = stream;
        void videoLocalRef.current.play().catch(() => undefined);
      }
      setEstadoMedia('ok');

      // 2) Socket de señalización (reconexión automática con backoff).
      socket = io(URL_SIGNALING, {
        transports: ['websocket', 'polling'],
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        setAviso(null);
        cambiarEstado('buscando');
        socket?.emit('find_match');
      });

      socket.on('connect_error', () => {
        setAviso('No se pudo conectar con el servidor. Reintentando…');
      });

      // Si el socket cae a mitad de llamada, el servidor ya habrá avisado
      // al peer; aquí limpiamos y esperamos la reconexión automática.
      socket.on('disconnect', () => {
        limpiarPeerConnection();
        setPeerEscribiendo(false);
        if (estadoRef.current !== 'inactivo') {
          setAviso('Conexión perdida. Reconectando…');
          cambiarEstado('buscando');
        }
      });

      socket.on('buscando', () => cambiarEstado('buscando'));

      socket.on('match_found', ({ initiator }) => {
        if (timeoutRebusquedaRef.current) {
          clearTimeout(timeoutRebusquedaRef.current);
          timeoutRebusquedaRef.current = null;
        }
        setMensajes([]);
        setPeerEscribiendo(false);
        setAviso(null);
        esInitiatorRef.current = initiator;
        cambiarEstado('conectando');

        const pc = crearPeerConnection();
        // El initiator crea la offer; el otro espera a recibirla.
        if (initiator) {
          void (async () => {
            try {
              const offer = await pc.createOffer();
              await pc.setLocalDescription(offer);
              socket?.emit('signal', { type: 'offer', sdp: offer.sdp ?? '' });
            } catch {
              setAviso('Error creando la oferta de video. Buscando otra persona…');
              buscarDeNuevo();
            }
          })();
        }
      });

      socket.on('signal', (señal) => {
        void procesarSignal(señal).catch(() => {
          // Una señalización corrupta no debe romper la sala: el timeout
          // de conexión se encargará del re-match si no hay video.
        });
      });

      socket.on('chat_message', (mensaje) => {
        setPeerEscribiendo(false);
        setMensajes((previos) => [
          ...previos,
          { ...mensaje, propio: mensaje.autorId === socket?.id },
        ]);
      });

      socket.on('typing', (escribiendo) => setPeerEscribiendo(escribiendo));

      socket.on('peer_left', () => {
        limpiarPeerConnection();
        setPeerEscribiendo(false);
        cambiarEstado('peer_desconectado');
        // Devolver a la cola con aviso: se re-busca solo tras un momento.
        timeoutRebusquedaRef.current = setTimeout(buscarDeNuevo, 2000);
      });

      socket.on('error_chat', (mensaje) => setAviso(mensaje));
    }

    void iniciar();

    return () => {
      cancelado = true;
      if (timeoutRebusquedaRef.current) clearTimeout(timeoutRebusquedaRef.current);
      if (timeoutEscribiendoRef.current) clearTimeout(timeoutEscribiendoRef.current);
      limpiarPeerConnection();
      socket?.disconnect();
      socketRef.current = null;
      const stream = streamLocalRef.current;
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
        streamLocalRef.current = null;
      }
    };
  }, [buscarDeNuevo, cambiarEstado, crearPeerConnection, limpiarPeerConnection, procesarSignal]);

  // --- Acciones de usuario ---

  const enviarMensaje = useCallback(() => {
    const socket = socketRef.current;
    const texto = borrador.trim();
    if (!socket || !texto || estado !== 'conectado') return;
    socket.emit('chat_message', texto);
    socket.emit('typing', false);
    setBorrador('');
  }, [borrador, estado]);

  const alEscribir = useCallback((valor: string) => {
    setBorrador(valor);
    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('typing', true);
    if (timeoutEscribiendoRef.current) clearTimeout(timeoutEscribiendoRef.current);
    timeoutEscribiendoRef.current = setTimeout(() => socket.emit('typing', false), 2000);
  }, []);

  const detener = useCallback(() => {
    socketRef.current?.emit('stop');
    router.push('/');
  }, [router]);

  const alternarMicro = useCallback(() => {
    const track = streamLocalRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicActivo(track.enabled);
  }, []);

  const alternarCamara = useCallback(() => {
    const track = streamLocalRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamaraActiva(track.enabled);
  }, []);

  const pantallaCompleta = useCallback(() => {
    const zona = zonaVideoRef.current;
    if (!zona) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void zona.requestFullscreen().catch(() => undefined);
    }
  }, []);

  // --- Arrastre del video local (escritorio) ---

  const alPulsarVideoLocal = useCallback((evento: React.PointerEvent<HTMLDivElement>) => {
    const elemento = evento.currentTarget;
    const rect = elemento.getBoundingClientRect();
    arrastreRef.current = { dx: evento.clientX - rect.left, dy: evento.clientY - rect.top };
    elemento.setPointerCapture(evento.pointerId);
  }, []);

  const alMoverVideoLocal = useCallback((evento: React.PointerEvent<HTMLDivElement>) => {
    const arrastre = arrastreRef.current;
    const zona = zonaVideoRef.current;
    if (!arrastre || !zona) return;
    const rectZona = zona.getBoundingClientRect();
    const rectVideo = evento.currentTarget.getBoundingClientRect();
    // Posición dentro de la zona de video, limitada a sus bordes.
    const x = Math.min(
      Math.max(evento.clientX - rectZona.left - arrastre.dx, 0),
      rectZona.width - rectVideo.width,
    );
    const y = Math.min(
      Math.max(evento.clientY - rectZona.top - arrastre.dy, 0),
      rectZona.height - rectVideo.height,
    );
    setPosLocal({ x, y });
  }, []);

  const alSoltarVideoLocal = useCallback((evento: React.PointerEvent<HTMLDivElement>) => {
    arrastreRef.current = null;
    evento.currentTarget.releasePointerCapture(evento.pointerId);
  }, []);

  // --- Pantallas especiales ---

  if (estadoMedia === 'denegado') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-bold">Necesitamos cámara y micrófono</h1>
        <p className="max-w-md text-slate-400">
          Has denegado el acceso a la cámara o al micrófono. Concede los
          permisos en tu navegador y vuelve a intentarlo.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => window.location.reload()}
            className="rounded-xl bg-indigo-500 px-6 py-3 font-semibold transition hover:bg-indigo-400"
          >
            Reintentar
          </button>
          <button
            onClick={() => router.push('/')}
            className="rounded-xl bg-slate-700 px-6 py-3 font-semibold transition hover:bg-slate-600"
          >
            Volver
          </button>
        </div>
      </main>
    );
  }

  const claseBotonControl =
    'rounded-full p-3 text-lg leading-none transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300';

  return (
    <main className="flex h-dvh flex-col md:flex-row">
      {/* Zona de video */}
      <section
        ref={zonaVideoRef}
        aria-label="Videollamada"
        className="relative flex-1 overflow-hidden bg-black"
      >
        {/* Video remoto a pantalla completa de la zona */}
        <video
          ref={videoRemotoRef}
          autoPlay
          playsInline
          className="h-full w-full object-cover"
        />

        {/* Overlay de estado cuando no hay video remoto activo */}
        {estado !== 'conectado' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/80">
            {(estado === 'buscando' || estado === 'conectando') && (
              <span
                aria-hidden
                className="h-10 w-10 animate-spin rounded-full border-4 border-slate-600 border-t-indigo-400"
              />
            )}
            <p aria-live="polite" className="px-4 text-center text-lg text-slate-200">
              {estadoMedia === 'pidiendo'
                ? 'Pidiendo acceso a cámara y micrófono…'
                : TEXTO_ESTADO[estado]}
            </p>
          </div>
        )}

        {/* Aviso flotante (errores recuperables, reconexiones) */}
        {aviso && (
          <p
            role="alert"
            className="absolute left-1/2 top-3 z-20 w-max max-w-[90%] -translate-x-1/2 rounded-lg bg-rose-500/90 px-3 py-1.5 text-sm font-medium"
          >
            {aviso}
          </p>
        )}

        {/* Video local en esquina, arrastrable */}
        <div
          onPointerDown={alPulsarVideoLocal}
          onPointerMove={alMoverVideoLocal}
          onPointerUp={alSoltarVideoLocal}
          className={`absolute z-10 w-28 cursor-move touch-none overflow-hidden rounded-xl border border-slate-700 shadow-lg sm:w-36 md:w-44 ${
            posLocal ? '' : 'right-3 top-3'
          }`}
          style={posLocal ? { left: posLocal.x, top: posLocal.y } : undefined}
        >
          <video
            ref={videoLocalRef}
            autoPlay
            playsInline
            muted
            className={`aspect-video w-full -scale-x-100 bg-slate-900 object-cover ${
              camaraActiva ? '' : 'opacity-30'
            }`}
          />
          {!camaraActiva && (
            <span className="absolute inset-0 flex items-center justify-center text-2xl">🚫</span>
          )}
        </div>

        {/* Barra de controles */}
        <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-2xl bg-slate-950/70 p-2 backdrop-blur">
          <button
            onClick={alternarMicro}
            aria-label={micActivo ? 'Silenciar micrófono' : 'Activar micrófono'}
            aria-pressed={!micActivo}
            className={`${claseBotonControl} ${micActivo ? 'bg-slate-700 hover:bg-slate-600' : 'bg-rose-600 hover:bg-rose-500'}`}
          >
            {micActivo ? '🎙️' : '🔇'}
          </button>
          <button
            onClick={alternarCamara}
            aria-label={camaraActiva ? 'Apagar cámara' : 'Encender cámara'}
            aria-pressed={!camaraActiva}
            className={`${claseBotonControl} ${camaraActiva ? 'bg-slate-700 hover:bg-slate-600' : 'bg-rose-600 hover:bg-rose-500'}`}
          >
            {camaraActiva ? '📷' : '🚫'}
          </button>
          <button
            onClick={pantallaCompleta}
            aria-label="Pantalla completa"
            className={`${claseBotonControl} bg-slate-700 hover:bg-slate-600`}
          >
            ⛶
          </button>
          <button
            onClick={() => setDenunciaAbierta(true)}
            aria-label="Denunciar al desconocido"
            className={`${claseBotonControl} bg-rose-700 hover:bg-rose-600`}
          >
            🚩
          </button>
          <span className="mx-1 h-6 w-px bg-slate-700" aria-hidden />
          <button
            onClick={buscarDeNuevo}
            className="rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-semibold transition hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
          >
            Siguiente
          </button>
          <button
            onClick={detener}
            className="rounded-xl bg-slate-700 px-4 py-2.5 text-sm font-semibold transition hover:bg-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
          >
            Detener
          </button>
        </div>

        {/* Diálogo de denuncia (el envío al backend llega en la Fase 4) */}
        {denunciaAbierta && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Denunciar al desconocido"
            className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-4"
          >
            <div className="w-full max-w-sm space-y-3 rounded-2xl bg-slate-900 p-5">
              <h2 className="text-lg font-bold">Denunciar al desconocido</h2>
              <p className="text-sm text-slate-400">
                Selecciona el motivo. El registro de denuncias en el servidor
                se activa en la Fase 4.
              </p>
              <div className="space-y-2">
                {MOTIVOS_DENUNCIA.map((motivo) => (
                  <button
                    key={motivo}
                    onClick={() => {
                      setDenunciaAbierta(false);
                      setAviso('Gracias. La denuncia se procesará cuando la moderación esté activa (Fase 4).');
                    }}
                    className="block w-full rounded-lg bg-slate-800 px-3 py-2 text-left text-sm transition hover:bg-slate-700"
                  >
                    {motivo}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setDenunciaAbierta(false)}
                className="w-full rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold transition hover:bg-slate-600"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Chat lateral (escritorio) / inferior (móvil) */}
      <PanelChat
        estado={estado}
        mensajes={mensajes}
        borrador={borrador}
        peerEscribiendo={peerEscribiendo}
        alCambiarBorrador={alEscribir}
        alEnviar={enviarMensaje}
      />
    </main>
  );
}
