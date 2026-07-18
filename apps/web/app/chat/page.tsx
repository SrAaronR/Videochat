'use client';

/**
 * Sala de chat — Fases 2 y 3.
 *
 * Modo video: flujo WebRTC completo (ver cabecera de lib/webrtc.ts y la
 * especificación): el initiator crea la offer, answer + ICE por Socket.IO,
 * timeout de 10 s con re-match automático.
 * Modo "Solo texto": misma lógica de emparejamiento y chat, sin flujo de
 * video (no se pide cámara ni se crea RTCPeerConnection).
 *
 * Los criterios (modo, intereses, filtro de país) llegan por querystring
 * desde la landing y se envían al servidor en `find_match`.
 * En móvil, deslizar horizontalmente sobre el video equivale a "Siguiente".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import {
  MOTIVOS_DENUNCIA,
  type ClientToServerEvents,
  type CriteriosBusqueda,
  type EstadoChat,
  type InfoBan,
  type MotivoDenuncia,
  type ServerToClientEvents,
  type SignalPayload,
} from '@videochat/shared';
import PanelChat, { type MensajeUI } from '@/components/PanelChat';
import { estaAceptado, guardarAceptacion } from '@/lib/aceptacion';
import { obtenerFingerprint } from '@/lib/identidad';
import { capturarFrame, iniciarMuestreoNsfw } from '@/lib/moderacion';
import { nombrePais } from '@/lib/paises';
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

/** Información del match actual mostrada en la UI. */
interface InfoMatch {
  interesesComunes: string[];
  paisPeer: string | null;
}

/** Aviso no fatal en pantalla (moderación, confirmaciones). */
interface Banner {
  tono: 'aviso' | 'ok';
  texto: string;
}

/** Desplazamiento mínimo (px) para que un deslizamiento cuente como "Siguiente". */
const UMBRAL_SWIPE_PX = 80;

/** Lee los criterios de búsqueda del querystring de la landing. */
function parsearCriterios(search: string): CriteriosBusqueda {
  const params = new URLSearchParams(search);
  const modo = params.get('modo') === 'texto' ? 'texto' : 'video';
  const intereses = (params.get('intereses') ?? '')
    .split(',')
    .map((i) => i.trim())
    .filter(Boolean);
  const pais = params.get('pais');
  return {
    modo,
    intereses,
    filtroPais: pais && /^[a-zA-Z]{2}$/.test(pais) ? pais.toUpperCase() : null,
  };
}

export default function PaginaChat() {
  const router = useRouter();

  // Los criterios se leen en cliente (querystring); hasta entonces no se renderiza la sala.
  const [criterios, setCriterios] = useState<CriteriosBusqueda | null>(null);
  /**
   * Gate legal: null = comprobando, false = sin aceptación registrada
   * (se muestra el gate y NO se conecta), true = puede conectar.
   */
  const [aceptado, setAceptado] = useState<boolean | null>(null);
  const [checkGate, setCheckGate] = useState(false);
  useEffect(() => {
    setCriterios(parsearCriterios(window.location.search));
    setAceptado(estaAceptado());
  }, []);

  // --- Estado de UI ---
  const [estadoMedia, setEstadoMedia] = useState<EstadoMedia>('pidiendo');
  const [estado, setEstado] = useState<EstadoChat>('inactivo');
  const [aviso, setAviso] = useState<string | null>(null);
  const [infoMatch, setInfoMatch] = useState<InfoMatch | null>(null);
  const [mensajes, setMensajes] = useState<MensajeUI[]>([]);
  const [borrador, setBorrador] = useState('');
  const [peerEscribiendo, setPeerEscribiendo] = useState(false);
  const [micActivo, setMicActivo] = useState(true);
  const [camaraActiva, setCamaraActiva] = useState(true);
  const [denunciaAbierta, setDenunciaAbierta] = useState(false);
  /** Suspensión activa: sustituye toda la UI por la pantalla de ban. */
  const [baneo, setBaneo] = useState<InfoBan | null>(null);
  /** Banner de moderación (aviso NSFW, mensaje bloqueado, confirmaciones). */
  const [banner, setBanner] = useState<Banner | null>(null);
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
  const estadoRef = useRef<EstadoChat>('inactivo');
  const timeoutConexionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutRebusquedaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutEscribiendoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arrastreRef = useRef<{ dx: number; dy: number } | null>(null);
  const inicioSwipeRef = useRef<{ x: number; y: number } | null>(null);
  const timeoutBannerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const modoTexto = criterios?.modo === 'texto';

  const cambiarEstado = useCallback((nuevo: EstadoChat) => {
    estadoRef.current = nuevo;
    setEstado(nuevo);
  }, []);

  /** Muestra un banner temporal de moderación (se autooculta a los 8 s). */
  const mostrarBanner = useCallback((nuevo: Banner) => {
    setBanner(nuevo);
    if (timeoutBannerRef.current) clearTimeout(timeoutBannerRef.current);
    timeoutBannerRef.current = setTimeout(() => setBanner(null), 8000);
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
    setInfoMatch(null);
    cambiarEstado('buscando');
    // `next` corta la sala actual en el servidor (si la hay) y reencola
    // con los mismos criterios.
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

  // --- Arranque: (video) cámara/micro primero; luego socket y matchmaking ---
  // Solo se ejecuta con la aceptación legal registrada (gate de la Fase 5).
  useEffect(() => {
    if (!criterios || aceptado !== true) return;
    let cancelado = false;
    let socket: SocketCliente | null = null;
    let pararMuestreoNsfw: (() => void) | null = null;
    const esTexto = criterios.modo === 'texto';

    async function iniciar() {
      // 1) Permisos de media (solo en modo video).
      if (esTexto) {
        setEstadoMedia('ok');
      } else {
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
      }

      // 2) Identidad para moderación: los baneos se aplican por IP hasheada
      // (en servidor) + este fingerprint del navegador.
      const fingerprint = await obtenerFingerprint();
      if (cancelado) return;

      // 3) Socket de señalización (reconexión automática con backoff).
      socket = io(URL_SIGNALING, {
        transports: ['websocket', 'polling'],
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        auth: { fingerprint },
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        setAviso(null);
        cambiarEstado('buscando');
        socket?.emit('find_match', criterios!);
      });

      socket.on('connect_error', (err) => {
        // El gate de baneos rechaza la conexión con message='baneado'.
        if (err.message === 'baneado') {
          const info = (err as Error & { data?: InfoBan }).data;
          setBaneo(info ?? { motivo: 'Suspensión activa', hasta: null });
          socket?.disconnect();
          return;
        }
        setAviso('No se pudo conectar con el servidor. Reintentando…');
      });

      // Ban aplicado en caliente (reincidencia NSFW o acción del admin).
      socket.on('baneado', (info) => {
        setBaneo(info);
        cambiarEstado('inactivo');
      });

      socket.on('aviso_moderacion', (avisoMod) => {
        mostrarBanner({ tono: 'aviso', texto: avisoMod.mensaje });
      });

      socket.on('denuncia_recibida', () => {
        mostrarBanner({ tono: 'ok', texto: 'Denuncia enviada. Gracias por ayudar a mantener la comunidad segura.' });
      });

      // 4) Muestreo NSFW del video local (solo modo video): si supera el
      // umbral, el servidor decide (primer aviso; reincidencia → ban).
      if (!esTexto && videoLocalRef.current) {
        pararMuestreoNsfw = iniciarMuestreoNsfw({
          video: videoLocalRef.current,
          alSuperarUmbral: (frame, puntuaciones) => {
            socket?.emit('nsfw_alerta', { frame, puntuaciones });
          },
        });
      }

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

      socket.on('match_found', ({ initiator, interesesComunes, paisPeer, modo }) => {
        if (timeoutRebusquedaRef.current) {
          clearTimeout(timeoutRebusquedaRef.current);
          timeoutRebusquedaRef.current = null;
        }
        setMensajes([]);
        setPeerEscribiendo(false);
        setAviso(null);
        setInfoMatch({ interesesComunes, paisPeer });

        // En modo texto no hay WebRTC: el match ya es la conexión.
        if (modo === 'texto') {
          cambiarEstado('conectado');
          return;
        }

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
      pararMuestreoNsfw?.();
      if (timeoutRebusquedaRef.current) clearTimeout(timeoutRebusquedaRef.current);
      if (timeoutEscribiendoRef.current) clearTimeout(timeoutEscribiendoRef.current);
      if (timeoutBannerRef.current) clearTimeout(timeoutBannerRef.current);
      limpiarPeerConnection();
      socket?.disconnect();
      socketRef.current = null;
      const stream = streamLocalRef.current;
      if (stream) {
        for (const track of stream.getTracks()) track.stop();
        streamLocalRef.current = null;
      }
    };
  }, [criterios, aceptado, buscarDeNuevo, cambiarEstado, crearPeerConnection, limpiarPeerConnection, mostrarBanner, procesarSignal]);

  /** Envía la denuncia con una captura del video remoto (si lo hay). */
  const denunciar = useCallback((motivo: MotivoDenuncia) => {
    setDenunciaAbierta(false);
    const frame = capturarFrame(videoRemotoRef.current);
    socketRef.current?.emit('denunciar', { motivo, frame });
  }, []);

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

  // --- Gesto de deslizar para "Siguiente" (móvil) ---

  const alTocarInicio = useCallback((evento: React.TouchEvent) => {
    const toque = evento.touches[0];
    if (toque) inicioSwipeRef.current = { x: toque.clientX, y: toque.clientY };
  }, []);

  const alTocarFin = useCallback(
    (evento: React.TouchEvent) => {
      const inicio = inicioSwipeRef.current;
      inicioSwipeRef.current = null;
      const toque = evento.changedTouches[0];
      if (!inicio || !toque) return;
      const dx = toque.clientX - inicio.x;
      const dy = toque.clientY - inicio.y;
      // Deslizamiento horizontal claro (en cualquier dirección) → Siguiente.
      if (Math.abs(dx) > UMBRAL_SWIPE_PX && Math.abs(dx) > 2 * Math.abs(dy)) {
        buscarDeNuevo();
      }
    },
    [buscarDeNuevo],
  );

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

  // --- Piezas de UI compartidas entre modos ---

  const chipInfoMatch =
    infoMatch && (infoMatch.interesesComunes.length > 0 || infoMatch.paisPeer) ? (
      <p className="flex flex-wrap items-center gap-1 text-xs text-slate-300">
        {infoMatch.paisPeer && (
          <span className="rounded-full bg-slate-800 px-2 py-0.5">
            📍 {nombrePais(infoMatch.paisPeer)}
          </span>
        )}
        {infoMatch.interesesComunes.map((interes) => (
          <span key={interes} className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-indigo-300">
            #{interes}
          </span>
        ))}
      </p>
    ) : null;

  const dialogoDenuncia = denunciaAbierta ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Denunciar al desconocido"
      className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-4"
    >
      <div className="w-full max-w-sm space-y-3 rounded-2xl bg-slate-900 p-5">
        <h2 className="text-lg font-bold">Denunciar al desconocido</h2>
        <p className="text-sm text-slate-400">
          Selecciona el motivo. Se enviará una captura del video del
          desconocido al equipo de moderación.
        </p>
        <div className="space-y-2">
          {(Object.entries(MOTIVOS_DENUNCIA) as [MotivoDenuncia, string][]).map(
            ([motivo, etiqueta]) => (
              <button
                key={motivo}
                onClick={() => denunciar(motivo)}
                className="block w-full rounded-lg bg-slate-800 px-3 py-2 text-left text-sm transition hover:bg-slate-700"
              >
                {etiqueta}
              </button>
            ),
          )}
        </div>
        <button
          onClick={() => setDenunciaAbierta(false)}
          className="w-full rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold transition hover:bg-slate-600"
        >
          Cancelar
        </button>
      </div>
    </div>
  ) : null;

  const bannerJsx = banner ? (
    <p
      role="status"
      className={`absolute left-1/2 top-14 z-20 w-max max-w-[90%] -translate-x-1/2 rounded-lg px-3 py-1.5 text-sm font-medium ${
        banner.tono === 'ok' ? 'bg-emerald-600/90' : 'bg-amber-500/95 text-slate-950'
      }`}
    >
      {banner.texto}
    </p>
  ) : null;

  // --- Pantallas especiales ---

  // Suspensión: pantalla completa con motivo y duración, sin acceso al chat.
  if (baneo) {
    const hastaTexto = baneo.hasta
      ? new Date(baneo.hasta).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })
      : null;
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <span aria-hidden className="text-5xl">🚫</span>
        <h1 className="text-2xl font-bold">Has sido suspendido</h1>
        <p className="max-w-md text-slate-300">{baneo.motivo}</p>
        <p className="max-w-md text-sm text-slate-400">
          {hastaTexto
            ? `La suspensión termina el ${hastaTexto}.`
            : 'La suspensión es permanente.'}
        </p>
        <button
          onClick={() => router.push('/')}
          className="rounded-xl bg-slate-700 px-6 py-3 font-semibold transition hover:bg-slate-600"
        >
          Volver al inicio
        </button>
      </main>
    );
  }

  if (!criterios || aceptado === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-slate-400">Cargando…</p>
      </main>
    );
  }

  // Gate legal: acceso directo a /chat sin aceptación registrada.
  if (aceptado === false) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
        <h1 className="text-2xl font-bold">Antes de continuar</h1>
        <p className="max-w-md text-slate-400">
          Este servicio es solo para mayores de 18 años. Necesitamos tu
          confirmación y la aceptación de los términos para conectarte.
        </p>
        <label className="flex max-w-md cursor-pointer items-start gap-3 rounded-xl border border-slate-700 bg-slate-900 p-3 text-left text-sm">
          <input
            type="checkbox"
            checked={checkGate}
            onChange={(e) => setCheckGate(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-indigo-500"
          />
          <span className="text-slate-300">
            Confirmo que tengo <strong>18 años o más</strong> y acepto los{' '}
            <Link href="/terminos" className="text-indigo-400 underline hover:text-indigo-300">Términos</Link>,{' '}
            la <Link href="/privacidad" className="text-indigo-400 underline hover:text-indigo-300">Privacidad</Link>{' '}
            y las <Link href="/normas" className="text-indigo-400 underline hover:text-indigo-300">Normas</Link>.
          </span>
        </label>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            onClick={() => {
              if (!checkGate) return;
              guardarAceptacion();
              setAceptado(true);
            }}
            aria-disabled={!checkGate}
            className={`rounded-xl px-6 py-3 font-semibold transition ${
              checkGate
                ? 'bg-indigo-500 hover:bg-indigo-400'
                : 'cursor-not-allowed bg-slate-700 text-slate-400'
            }`}
          >
            Aceptar y continuar
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

  if (estadoMedia === 'denegado') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-bold">Necesitamos cámara y micrófono</h1>
        <p className="max-w-md text-slate-400">
          Has denegado el acceso a la cámara o al micrófono. Concede los
          permisos en tu navegador y vuelve a intentarlo, o prueba el modo
          solo texto.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
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

  // --- Modo "Solo texto" ---

  if (modoTexto) {
    return (
      <main
        className="relative mx-auto flex h-dvh max-w-3xl flex-col"
        onTouchStart={alTocarInicio}
        onTouchEnd={alTocarFin}
      >
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 p-3">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={`h-2.5 w-2.5 flex-none rounded-full ${
                  estado === 'conectado'
                    ? 'bg-emerald-400'
                    : estado === 'buscando'
                      ? 'animate-pulse bg-amber-400'
                      : 'bg-slate-500'
                }`}
              />
              <p aria-live="polite" className="truncate text-sm text-slate-300">
                {TEXTO_ESTADO[estado]}
              </p>
            </div>
            {chipInfoMatch}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setDenunciaAbierta(true)}
              aria-label="Denunciar al desconocido"
              className={`${claseBotonControl} bg-rose-700 text-base hover:bg-rose-600`}
            >
              🚩
            </button>
            <button
              onClick={buscarDeNuevo}
              className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold transition hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
            >
              Siguiente
            </button>
            <button
              onClick={detener}
              className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-semibold transition hover:bg-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
            >
              Detener
            </button>
          </div>
        </header>

        {aviso && (
          <p role="alert" className="mx-3 mt-2 rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-300">
            {aviso}
          </p>
        )}
        {bannerJsx}

        <PanelChat
          expandido
          estado={estado}
          mensajes={mensajes}
          borrador={borrador}
          peerEscribiendo={peerEscribiendo}
          alCambiarBorrador={alEscribir}
          alEnviar={enviarMensaje}
        />
        {dialogoDenuncia}
      </main>
    );
  }

  // --- Modo video ---

  return (
    <main className="flex h-dvh flex-col md:flex-row">
      {/* Zona de video (deslizar horizontalmente = Siguiente en móvil) */}
      <section
        ref={zonaVideoRef}
        aria-label="Videollamada"
        className="relative flex-1 overflow-hidden bg-black"
        onTouchStart={alTocarInicio}
        onTouchEnd={alTocarFin}
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

        {/* Chip de país/intereses en común del match actual */}
        {estado === 'conectado' && chipInfoMatch && (
          <div className="absolute left-3 top-3 z-10 rounded-xl bg-slate-950/70 px-2.5 py-1.5 backdrop-blur">
            {chipInfoMatch}
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
        {bannerJsx}

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

        {/* Barra de controles (padding extra para la zona segura de iOS) */}
        <div className="absolute bottom-3 left-1/2 z-10 flex max-w-[95%] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl bg-slate-950/70 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur">
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

        {dialogoDenuncia}
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
