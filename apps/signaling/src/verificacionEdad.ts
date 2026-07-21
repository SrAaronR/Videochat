/**
 * Verificación de edad — candado de lanzamiento.
 *
 * Diseño "falla cerrada": el servidor SOLO empareja a sockets que presentan
 * un token de edad (JWT firmado con AGE_JWT_SECRET) emitido por este módulo
 * tras una verificación real. Si no hay proveedor válido configurado, no se
 * emite ningún token y por tanto NADIE puede usar el chat.
 *
 * Proveedores:
 *  - 'stripe': Stripe Identity (documento + selfie). Requiere STRIPE_SECRET_KEY.
 *    Se usa la API REST directamente (sesiones de verificación alojadas por
 *    Stripe con return_url), sin SDK adicional.
 *  - 'test':   SIMULA la verificación (no verifica nada). Solo para desarrollo
 *    y SOLO si PERMITIR_VERIFICACION_TEST tiene exactamente el valor
 *    'si-entiendo-que-no-verifica-edad'. Jamás usar en producción.
 *
 * Las sesiones de verificación en curso se guardan en Redis con TTL; el
 * estado final lo decide el proveedor (o la simulación en modo test).
 */
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type Redis from 'ioredis';

export type ProveedorEdad = 'stripe' | 'test';

export type EstadoVerificacion = 'pendiente' | 'verificada' | 'fallida' | 'desconocida';

const PROVEEDOR = (process.env.PROVEEDOR_EDAD ?? '').trim().toLowerCase();
const AGE_JWT_SECRET = process.env.AGE_JWT_SECRET ?? '';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? '';
/**
 * El modo test se habilita SOLO con esta frase exacta, para que nadie lo
 * active por accidente creyendo que verifica algo.
 */
const TEST_PERMITIDO =
  process.env.PERMITIR_VERIFICACION_TEST === 'si-entiendo-que-no-verifica-edad';

/** Validez del token de edad (días). Caducado, se repite la verificación. */
const DIAS_TOKEN = Number(process.env.EDAD_TOKEN_DIAS ?? 30);

/** TTL de una sesión de verificación en curso (el usuario puede tardar). */
const TTL_SESION_S = 24 * 60 * 60;

const API_STRIPE = 'https://api.stripe.com/v1/identity/verification_sessions';

/** Datos de una sesión de verificación en Redis. */
interface SesionVerificacion {
  proveedor: ProveedorEdad;
  /** Id de la sesión en Stripe (solo proveedor 'stripe'). */
  stripeId?: string;
  /** Estado local (solo proveedor 'test'; en 'stripe' manda su API). */
  estado?: 'pendiente' | 'verificada';
}

function claveSesion(sesionId: string): string {
  return `edad:sesion:${sesionId}`;
}

/**
 * Proveedor activo o null si la configuración no permite verificar.
 * ESTE es el punto de "falla cerrada": sin secreto de firma o sin
 * credenciales/consentimiento del proveedor, no hay verificación posible.
 */
export function proveedorEdadActivo(): ProveedorEdad | null {
  if (!AGE_JWT_SECRET) return null;
  if (PROVEEDOR === 'stripe' && STRIPE_SECRET_KEY) return 'stripe';
  if (PROVEEDOR === 'test' && TEST_PERMITIDO) return 'test';
  return null;
}

/** Emite el JWT de edad. Solo debe llamarse tras una verificación superada. */
export function emitirTokenEdad(): string {
  if (!AGE_JWT_SECRET) {
    throw new Error('AGE_JWT_SECRET no configurado: no se pueden emitir tokens de edad');
  }
  return jwt.sign({ edadVerificada: true }, AGE_JWT_SECRET, { expiresIn: `${DIAS_TOKEN}d` });
}

/**
 * Valida el token de edad presentado en el handshake del socket.
 * Sin AGE_JWT_SECRET nunca valida (falla cerrada).
 */
export function validarTokenEdad(token: unknown): boolean {
  if (!AGE_JWT_SECRET || typeof token !== 'string' || !token) return false;
  try {
    const payload = jwt.verify(token, AGE_JWT_SECRET);
    return typeof payload === 'object' && payload !== null &&
      (payload as { edadVerificada?: unknown }).edadVerificada === true;
  } catch {
    return false;
  }
}

/** Llamada mínima a la API REST de Stripe (form-urlencoded, Bearer). */
async function llamarStripe(
  url: string,
  metodo: 'GET' | 'POST',
  cuerpo?: URLSearchParams,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      ...(cuerpo ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: cuerpo?.toString(),
  });
  const datos = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const error = (datos.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
    throw new Error(`Stripe: ${error}`);
  }
  return datos;
}

/**
 * Crea una sesión de verificación y devuelve la URL a la que el navegador
 * debe redirigir (la página alojada de Stripe, o el simulador en modo test).
 * `origen` es el origen del frontend YA VALIDADO contra CORS_ORIGIN por el
 * llamante (se usa para el return_url / la página del simulador).
 */
export async function crearSesionVerificacion(
  redis: Redis,
  origen: string,
): Promise<{ sesionId: string; url: string } | null> {
  const proveedor = proveedorEdadActivo();
  if (!proveedor) return null;

  const sesionId = randomUUID();

  if (proveedor === 'test') {
    const sesion: SesionVerificacion = { proveedor, estado: 'pendiente' };
    await redis.set(claveSesion(sesionId), JSON.stringify(sesion), 'EX', TTL_SESION_S);
    return { sesionId, url: `${origen}/verificar-edad/simular?sesionId=${sesionId}` };
  }

  // Stripe Identity: documento de identidad + selfie que coincida.
  const respuesta = await llamarStripe(
    API_STRIPE,
    'POST',
    new URLSearchParams({
      type: 'document',
      'options[document][require_matching_selfie]': 'true',
      return_url: `${origen}/verificar-edad?retorno=1&sesionId=${sesionId}`,
      'metadata[sesionId]': sesionId,
    }),
  );
  const stripeId = respuesta.id;
  const url = respuesta.url;
  if (typeof stripeId !== 'string' || typeof url !== 'string') {
    throw new Error('Stripe: respuesta sin id o url de sesión');
  }
  const sesion: SesionVerificacion = { proveedor, stripeId };
  await redis.set(claveSesion(sesionId), JSON.stringify(sesion), 'EX', TTL_SESION_S);
  return { sesionId, url };
}

/**
 * Consulta el estado de una sesión de verificación.
 * En modo test, `aprobarTest=true` marca la sesión como verificada (es la
 * simulación); con proveedor real se ignora por completo.
 */
export async function consultarVerificacion(
  redis: Redis,
  sesionId: string,
  aprobarTest: boolean,
): Promise<EstadoVerificacion> {
  const crudo = await redis.get(claveSesion(sesionId));
  if (!crudo) return 'desconocida';

  let sesion: SesionVerificacion;
  try {
    sesion = JSON.parse(crudo) as SesionVerificacion;
  } catch {
    return 'desconocida';
  }

  if (sesion.proveedor === 'test') {
    // Doble candado: aunque quede una sesión test en Redis, sin el
    // consentimiento explícito por env no se aprueba nada.
    if (!TEST_PERMITIDO) return 'fallida';
    if (aprobarTest && sesion.estado !== 'verificada') {
      sesion.estado = 'verificada';
      await redis.set(claveSesion(sesionId), JSON.stringify(sesion), 'EX', TTL_SESION_S);
    }
    return sesion.estado === 'verificada' ? 'verificada' : 'pendiente';
  }

  // Proveedor Stripe: el estado canónico vive en su API.
  if (!sesion.stripeId || !STRIPE_SECRET_KEY) return 'fallida';
  const respuesta = await llamarStripe(`${API_STRIPE}/${sesion.stripeId}`, 'GET');
  const estado = respuesta.status;
  if (estado === 'verified') return 'verificada';
  if (estado === 'canceled') return 'fallida';
  // 'requires_input' y 'processing' siguen en curso.
  return 'pendiente';
}
