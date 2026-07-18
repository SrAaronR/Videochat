/**
 * Identidad anónima del navegador para moderación (Fase 4).
 * Se calcula un fingerprint con FingerprintJS y se cachea en localStorage:
 * los baneos se aplican por combinación de IP hasheada (en servidor) +
 * este fingerprint, para que abrir otra pestaña no los eluda.
 */

const CLAVE_CACHE = 'videochat.fingerprint';

/** Obtiene el fingerprint del navegador (cacheado tras el primer cálculo). */
export async function obtenerFingerprint(): Promise<string | null> {
  try {
    const cacheado = localStorage.getItem(CLAVE_CACHE);
    if (cacheado) return cacheado;

    const FingerprintJS = await import('@fingerprintjs/fingerprintjs');
    const agente = await FingerprintJS.load();
    const resultado = await agente.get();
    localStorage.setItem(CLAVE_CACHE, resultado.visitorId);
    return resultado.visitorId;
  } catch {
    // Sin fingerprint el servidor sigue moderando por IP hasheada.
    return null;
  }
}
