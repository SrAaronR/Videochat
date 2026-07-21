/**
 * Token de edad en el cliente (candado de verificación de edad).
 *
 * El servidor emite un JWT tras una verificación real (ver
 * apps/signaling/src/verificacionEdad.ts) y aquí se guarda en localStorage.
 * Se envía en el handshake del socket (`auth.ageToken`); SIN él el servidor
 * no empareja a nadie, así que borrar/manipular el token solo consigue que
 * el chat no funcione. El descarte por caducidad de aquí es cosmético: la
 * validación real siempre es la del servidor.
 */

const CLAVE_TOKEN = 'videochat.tokenEdad';
/** Sesión de verificación en curso (para retomarla al volver del proveedor). */
const CLAVE_SESION = 'videochat.sesionVerificacion';

/** true si el JWT (sin verificar firma) ya ha caducado. */
function caducado(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1] ?? '')) as { exp?: number };
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
  } catch {
    return false; // Ilegible: que decida el servidor.
  }
}

/** Token de edad guardado, o null si no hay o ya caducó. */
export function obtenerTokenEdad(): string | null {
  try {
    const token = localStorage.getItem(CLAVE_TOKEN);
    if (!token) return null;
    if (caducado(token)) {
      localStorage.removeItem(CLAVE_TOKEN);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

/** Guarda el token emitido por el servidor tras verificarse. */
export function guardarTokenEdad(token: string): void {
  try {
    localStorage.setItem(CLAVE_TOKEN, token);
  } catch {
    // localStorage bloqueado: habrá que verificar de nuevo la próxima vez.
  }
}

/** Id de la sesión de verificación en curso (o null). */
export function obtenerSesionVerificacion(): string | null {
  try {
    return localStorage.getItem(CLAVE_SESION);
  } catch {
    return null;
  }
}

/** Recuerda la sesión de verificación para retomarla tras el redirect. */
export function guardarSesionVerificacion(sesionId: string): void {
  try {
    localStorage.setItem(CLAVE_SESION, sesionId);
  } catch {
    // Sin persistencia se perderá el polling al volver del proveedor.
  }
}

/** Limpia la sesión en curso (verificación terminada o descartada). */
export function borrarSesionVerificacion(): void {
  try {
    localStorage.removeItem(CLAVE_SESION);
  } catch {
    // Nada que hacer.
  }
}
