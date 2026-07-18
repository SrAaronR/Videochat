/**
 * Contrato de eventos Socket.IO compartido entre el frontend (apps/web)
 * y el servidor de señalización (apps/signaling).
 *
 * Fase 1: matchmaking aleatorio básico + chat de texto.
 * Los eventos de WebRTC (`signal`) ya están declarados para la Fase 2,
 * el servidor simplemente los reenvía al peer.
 */

/** Estados de la sesión de chat visibles en la UI. */
export type EstadoChat =
  | 'inactivo'
  | 'buscando'
  | 'conectando'
  | 'conectado'
  | 'peer_desconectado';

/** Modos de chat disponibles. */
export type ModoChat = 'video' | 'texto';

/** Criterios de búsqueda que el cliente envía al entrar en la cola. */
export interface CriteriosBusqueda {
  modo: ModoChat;
  /** Intereses del usuario (tags libres tipo "gaming, música"). */
  intereses: string[];
  /**
   * Filtro de país elegido por el usuario (código ISO-3166 alpha-2,
   * p. ej. "ES") o null para emparejar con cualquier país.
   */
  filtroPais: string | null;
}

/** Límites de saneado de los criterios (aplicados en el servidor). */
export const MAX_INTERESES = 5;
export const MAX_LONGITUD_INTERES = 20;

/** Mensaje de chat tal y como lo entrega el servidor. */
export interface MensajeChat {
  /** Identificador único del mensaje (generado en el servidor). */
  id: string;
  /** Texto del mensaje, ya validado/recortado por el servidor. */
  texto: string;
  /** Id de socket del autor (para saber si es propio o del desconocido). */
  autorId: string;
  /** Timestamp de recepción en el servidor (ms epoch). */
  timestamp: number;
}

/** Payload que reciben ambos usuarios cuando hay emparejamiento. */
export interface MatchEncontrado {
  roomId: string;
  /** El servidor designa a un lado como initiator (crea la offer WebRTC). */
  initiator: boolean;
  /** Id de socket del desconocido. */
  peerId: string;
  /** Modo de la sala (video o solo texto). */
  modo: ModoChat;
  /** Intereses que ambos usuarios tienen en común (puede estar vacío). */
  interesesComunes: string[];
  /** País detectado del desconocido (ISO-3166 alpha-2) o null. */
  paisPeer: string | null;
  /**
   * true si la moderación con supervisión está activa: el cliente enviará
   * capturas periódicas de su cámara al panel de moderación y debe mostrar
   * el aviso de "moderación activa". Cuando es false no se envía nada.
   */
  supervisado: boolean;
}

/** Motivos por los que el peer abandona la sala. */
export type MotivoSalida = 'siguiente' | 'detener' | 'desconexion';

/**
 * Candidato ICE serializado. Se define aquí (en lugar de usar
 * RTCIceCandidateInit del DOM) para que el paquete compartido compile
 * también en el servidor Node, que no tiene tipos del navegador.
 */
export interface CandidatoIce {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/**
 * Mensajes de señalización WebRTC que se retransmiten entre peers.
 * El servidor NO los interpreta: solo valida la forma y hace de relay.
 */
export type SignalPayload =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'candidate'; candidate: CandidatoIce };

/** Tipos de `SignalPayload` admitidos (para validación en el servidor). */
export const TIPOS_SIGNAL = ['offer', 'answer', 'candidate'] as const;

/** Eventos que el servidor emite hacia el cliente. */
export interface ServerToClientEvents {
  /** Confirmación de que el usuario ha entrado en la cola. */
  buscando: () => void;
  /** Se ha encontrado pareja. */
  match_found: (match: MatchEncontrado) => void;
  /** Mensaje de chat retransmitido por el servidor. */
  chat_message: (mensaje: MensajeChat) => void;
  /** El desconocido está escribiendo (true) o ha dejado de escribir (false). */
  typing: (escribiendo: boolean) => void;
  /** El desconocido ha abandonado la sala. */
  peer_left: (motivo: MotivoSalida) => void;
  /** Relay de señalización WebRTC (offer/answer/ICE). */
  signal: (data: SignalPayload) => void;
  /** Error recuperable que la UI puede mostrar. */
  error_chat: (mensaje: string) => void;
  /** El usuario ha sido suspendido; tras esto el servidor lo desconecta. */
  baneado: (info: InfoBan) => void;
  /** Aviso de moderación (primer strike NSFW, mensaje bloqueado…). */
  aviso_moderacion: (aviso: AvisoModeracion) => void;
  /** Confirmación de que la denuncia se registró. */
  denuncia_recibida: () => void;
}

/** Eventos que el cliente emite hacia el servidor. */
export interface ClientToServerEvents {
  /** Entrar en la cola de emparejamiento con los criterios elegidos. */
  find_match: (criterios: CriteriosBusqueda) => void;
  /** Enviar un mensaje de chat (el servidor lo valida y retransmite). */
  chat_message: (texto: string) => void;
  /** Notificar que se está escribiendo o se ha dejado de escribir. */
  typing: (escribiendo: boolean) => void;
  /** Cortar el match actual y buscar otro inmediatamente. */
  next: () => void;
  /** Salir de la sala/cola y volver a la landing. */
  stop: () => void;
  /** Relay de señalización WebRTC (offer/answer/ICE). */
  signal: (data: SignalPayload) => void;
  /** Denunciar al desconocido actual (con captura opcional). */
  denunciar: (denuncia: PayloadDenuncia) => void;
  /** El detector NSFW local superó el umbral (el servidor decide). */
  nsfw_alerta: (alerta: PayloadAlertaNsfw) => void;
  /**
   * Captura periódica de la cámara local para la sala de vigilancia del
   * panel de moderación. Solo se envía si el match indicó `supervisado`.
   */
  vigilancia_frame: (data: { frame: string | null }) => void;
}

/** Longitud máxima de un mensaje de chat aceptada por el servidor. */
export const MAX_LONGITUD_MENSAJE = 2000;

// ---------------------------------------------------------------------------
// Moderación (Fase 4)
// ---------------------------------------------------------------------------

/** Motivos seleccionables al denunciar. */
export type MotivoDenuncia = 'desnudez' | 'menor' | 'acoso' | 'spam' | 'otro';

/** Etiquetas legibles de los motivos de denuncia. */
export const MOTIVOS_DENUNCIA: Record<MotivoDenuncia, string> = {
  desnudez: 'Desnudez',
  menor: 'Menor de edad',
  acoso: 'Acoso',
  spam: 'Spam',
  otro: 'Otro',
};

/** Denuncia enviada por el cliente al servidor. */
export interface PayloadDenuncia {
  motivo: MotivoDenuncia;
  /**
   * Captura del video remoto como data-URI JPEG (`data:image/jpeg;base64,…`)
   * o null en modo solo texto / cámara apagada.
   */
  frame: string | null;
}

/** Alerta del detector NSFW del cliente (muestreo del video LOCAL). */
export interface PayloadAlertaNsfw {
  /** Captura del video local que disparó el umbral (data-URI JPEG). */
  frame: string | null;
  /** Puntuaciones del clasificador, por etiqueta (0..1). */
  puntuaciones: Record<string, number>;
}

/** Información de suspensión que recibe un usuario baneado. */
export interface InfoBan {
  motivo: string;
  /** Fin del ban en ms epoch, o null si es permanente. */
  hasta: number | null;
}

/** Aviso de moderación no fatal mostrado al usuario. */
export interface AvisoModeracion {
  tipo: 'nsfw' | 'texto';
  mensaje: string;
}

/** Tamaño máximo aceptado para un frame de denuncia (data-URI completo). */
export const MAX_BYTES_FRAME = 500 * 1024;
