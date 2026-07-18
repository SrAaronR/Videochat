/**
 * Gate legal (Fase 5): aceptación de Términos + confirmación de mayoría de
 * edad, guardada en localStorage con timestamp. Sin aceptación registrada
 * no se abre ninguna conexión con el servidor.
 */

const CLAVE = 'videochat.aceptacion';

/**
 * Versión de los textos legales. Si se cambian los Términos, subir esta
 * fecha invalida las aceptaciones antiguas y obliga a aceptar de nuevo.
 */
export const VERSION_TERMINOS = '2026-07-18';

interface Aceptacion {
  /** Momento de la aceptación (ms epoch). */
  timestamp: number;
  /** Versión de los términos aceptados. */
  version: string;
}

/** true si hay una aceptación vigente de la versión actual de los términos. */
export function estaAceptado(): boolean {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return false;
    const aceptacion = JSON.parse(crudo) as Partial<Aceptacion>;
    return aceptacion.version === VERSION_TERMINOS && typeof aceptacion.timestamp === 'number';
  } catch {
    return false;
  }
}

/** Registra la aceptación (checkbox de 18+ y Términos) con timestamp. */
export function guardarAceptacion(): void {
  try {
    localStorage.setItem(
      CLAVE,
      JSON.stringify({ timestamp: Date.now(), version: VERSION_TERMINOS } satisfies Aceptacion),
    );
  } catch {
    // localStorage bloqueado: el gate volverá a pedirla la próxima vez.
  }
}
