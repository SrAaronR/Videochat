/**
 * Configuración WebRTC del cliente.
 *
 * Los servidores ICE se definen por variables de entorno NEXT_PUBLIC_*
 * (incrustadas en build): STUN públicos de Google por defecto y TURN
 * propio (coturn) como respaldo cuando la conexión directa falla.
 *
 * Deuda técnica (Fase 4+): en producción el TURN debería usar credenciales
 * efímeras generadas en servidor (REST API de coturn), no una contraseña
 * estática incrustada en el bundle.
 */

const STUN_POR_DEFECTO = 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302';

/** Construye la lista de servidores ICE a partir del entorno. */
export function obtenerServidoresIce(): RTCIceServer[] {
  const servidores: RTCIceServer[] = [];

  const stun = process.env.NEXT_PUBLIC_STUN_URLS ?? STUN_POR_DEFECTO;
  const urlsStun = stun.split(',').map((u) => u.trim()).filter(Boolean);
  if (urlsStun.length > 0) servidores.push({ urls: urlsStun });

  const urlTurn = process.env.NEXT_PUBLIC_TURN_URL;
  if (urlTurn) {
    servidores.push({
      urls: urlTurn.split(',').map((u) => u.trim()).filter(Boolean),
      username: process.env.NEXT_PUBLIC_TURN_USERNAME ?? '',
      credential: process.env.NEXT_PUBLIC_TURN_PASSWORD ?? '',
    });
  }

  return servidores;
}

/** Configuración de la RTCPeerConnection para el 1v1. */
export function crearConfiguracionRtc(): RTCConfiguration {
  return { iceServers: obtenerServidoresIce() };
}

/** Restricciones de captura: cámara frontal y audio con mejoras básicas. */
export const RESTRICCIONES_MEDIA: MediaStreamConstraints = {
  video: {
    facingMode: 'user',
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

/** Tiempo máximo (ms) para que la conexión WebRTC se establezca antes de re-match. */
export const TIMEOUT_CONEXION_MS = 10_000;
