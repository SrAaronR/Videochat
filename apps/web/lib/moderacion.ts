/**
 * Moderación en cliente (Fase 4).
 *
 * - Captura de frames de un <video> a data-URI JPEG (denuncias y evidencia).
 * - Muestreador NSFW: cada NEXT_PUBLIC_NSFW_INTERVALO_MS (7 s por defecto)
 *   clasifica el video LOCAL con el modelo de NSFWJS (mobilenet_v2, MIT)
 *   ejecutado con TensorFlow.js; si supera el umbral, avisa al servidor
 *   (`nsfw_alerta`), que decide aviso o ban.
 *
 * El modelo va autoalojado en /public/modelos/nsfw (2,7 MB) y es
 * configurable con NEXT_PUBLIC_NSFWJS_MODEL_URL. Se usa @tensorflow/tfjs
 * directamente (el paquete npm de nsfwjs incrusta los pesos con requires
 * dinámicos que rompen el build de Next). Si el modelo no carga, el
 * muestreo queda desactivado con un aviso en consola; el resto de la
 * moderación (denuncias, baneos, filtros) sigue activa.
 */

/** Resultado de una clasificación: puntuación 0..1 por etiqueta. */
export type PuntuacionesNsfw = Record<string, number>;

/** Interfaz mínima del clasificador (permite inyectar uno falso en tests). */
export interface ClasificadorNsfw {
  clasificar: (video: HTMLVideoElement) => Promise<PuntuacionesNsfw>;
}

/** Umbral por defecto sobre las clases sensibles. */
const UMBRAL = Number(process.env.NEXT_PUBLIC_NSFW_UMBRAL ?? 0.7);
const INTERVALO_MS = Number(process.env.NEXT_PUBLIC_NSFW_INTERVALO_MS ?? 7000);
/** Clases de NSFWJS que cuentan como contenido inapropiado. */
const CLASES_SENSIBLES = ['Porn', 'Hentai'];
/** Etiquetas del modelo NSFWJS mobilenet_v2, en el orden de su salida. */
const ETIQUETAS_MODELO = ['Drawing', 'Hentai', 'Neutral', 'Porn', 'Sexy'];
/** Tamaño de entrada del modelo (224x224 px). */
const TAMANO_ENTRADA = 224;
const URL_MODELO = process.env.NEXT_PUBLIC_NSFWJS_MODEL_URL ?? '/modelos/nsfw/model.json';

/** Captura un frame del video como data-URI JPEG (o null si no hay imagen). */
export function capturarFrame(video: HTMLVideoElement | null, anchoMax = 480): string | null {
  if (!video || video.videoWidth === 0) return null;
  try {
    const escala = Math.min(1, anchoMax / video.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * escala);
    canvas.height = Math.round(video.videoHeight * escala);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch {
    return null;
  }
}

/** Carga NSFWJS una sola vez (o devuelve el clasificador inyectado en tests). */
let clasificadorPromesa: Promise<ClasificadorNsfw | null> | null = null;

function cargarClasificador(): Promise<ClasificadorNsfw | null> {
  // Gancho para pruebas E2E: permite inyectar un clasificador falso.
  const inyectado = (window as { __clasificadorNSFW?: ClasificadorNsfw }).__clasificadorNSFW;
  if (inyectado) return Promise.resolve(inyectado);

  clasificadorPromesa ??= (async () => {
    try {
      const tf = await import('@tensorflow/tfjs');
      const modelo = await tf.loadLayersModel(URL_MODELO);
      return {
        async clasificar(video: HTMLVideoElement) {
          // Mismo preprocesado que NSFWJS: pixeles → [0,1] → 224x224.
          const logits = tf.tidy(() => {
            const imagen = tf.browser
              .fromPixels(video)
              .toFloat()
              .div(255)
              .resizeBilinear([TAMANO_ENTRADA, TAMANO_ENTRADA], true)
              .expandDims(0);
            return modelo.predict(imagen) as import('@tensorflow/tfjs').Tensor;
          });
          try {
            const valores = await logits.data();
            const puntuaciones: PuntuacionesNsfw = {};
            ETIQUETAS_MODELO.forEach((etiqueta, i) => {
              puntuaciones[etiqueta] = valores[i] ?? 0;
            });
            return puntuaciones;
          } finally {
            logits.dispose();
          }
        },
      };
    } catch (err) {
      console.warn('[moderacion] modelo NSFW no disponible; muestreo desactivado', err);
      return null;
    }
  })();
  return clasificadorPromesa;
}

interface OpcionesMuestreo {
  /** Video local a muestrear. */
  video: HTMLVideoElement;
  /** Callback cuando una muestra supera el umbral. */
  alSuperarUmbral: (frame: string | null, puntuaciones: PuntuacionesNsfw) => void;
}

/**
 * Arranca el muestreo periódico del video local. Devuelve una función de
 * parada. Si el modelo no carga, no hace nada (degradación silenciosa).
 */
export function iniciarMuestreoNsfw({ video, alSuperarUmbral }: OpcionesMuestreo): () => void {
  let detenido = false;
  let temporizador: ReturnType<typeof setInterval> | null = null;

  void cargarClasificador().then((clasificador) => {
    if (!clasificador || detenido) return;
    temporizador = setInterval(() => {
      void (async () => {
        if (video.videoWidth === 0 || video.paused) return;
        try {
          const puntuaciones = await clasificador.clasificar(video);
          const supera = CLASES_SENSIBLES.some((clase) => (puntuaciones[clase] ?? 0) >= UMBRAL);
          if (supera) alSuperarUmbral(capturarFrame(video), puntuaciones);
        } catch {
          // Una muestra fallida no detiene el muestreo.
        }
      })();
    }, INTERVALO_MS);
  });

  return () => {
    detenido = true;
    if (temporizador) clearInterval(temporizador);
  };
}
