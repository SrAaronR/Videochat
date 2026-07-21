/**
 * Moderación — Fase 4.
 *
 * - Identidad: hash de IP (sha256 + sal) y fingerprint del navegador.
 * - Baneos escalados 15 min → 24 h → 7 días → permanente, activos en Redis
 *   (con TTL) y registrados de forma duradera en PostgreSQL.
 * - Strikes NSFW: primer aviso; reincidencia → denuncia automática + ban.
 * - Filtro de texto: términos prohibidos configurables y bloqueo de datos
 *   personales obvios (teléfonos, emails) con aviso educativo.
 * - Rate limiting por IP (búsquedas/minuto, mensajes/segundo, denuncias).
 */
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import type { InfoBan } from '@videochat/shared';
import { prisma } from './db.js';

const HASH_SALT = process.env.HASH_SALT ?? 'cambia-esta-sal-en-produccion';

/** Escalado de baneos en segundos; null = permanente. */
export const DURACIONES_BAN: ReadonlyArray<number | null> = [
  15 * 60, // nivel 1: 15 minutos
  24 * 60 * 60, // nivel 2: 24 horas
  7 * 24 * 60 * 60, // nivel 3: 7 días
  null, // nivel 4: permanente
];

/** TTL del contador de escalado (si no reincide en 30 días, se reinicia). */
const TTL_NIVEL_BAN_S = 30 * 24 * 60 * 60;
/** TTL del contador de strikes NSFW. */
const TTL_STRIKES_S = 60 * 60;

// --- Identidad --------------------------------------------------------------

/** Hash irreversible de la IP (no se almacena nunca la IP en claro). */
export function hashIp(ip: string): string {
  return createHash('sha256').update(`${HASH_SALT}:${ip}`).digest('hex').slice(0, 32);
}

/** Sanea el fingerprint recibido del cliente. */
export function sanearFingerprint(bruto: unknown): string | null {
  if (typeof bruto !== 'string') return null;
  const fp = bruto.trim().slice(0, 64);
  return /^[a-zA-Z0-9]+$/.test(fp) ? fp : null;
}

// --- Baneos -----------------------------------------------------------------

const claveBanIp = (ipHash: string) => `ban:ip:${ipHash}`;
const claveBanFp = (fp: string) => `ban:fp:${fp}`;
const claveNivel = (id: string) => `ban:nivel:${id}`;

interface BanRedis extends InfoBan {
  nivel: number;
}

/** Devuelve la info de ban activo para esta identidad, o null. */
export async function consultarBan(
  redis: Redis,
  ipHash: string,
  fingerprint: string | null,
): Promise<InfoBan | null> {
  const claves = [claveBanIp(ipHash)];
  if (fingerprint) claves.push(claveBanFp(fingerprint));
  for (const clave of claves) {
    const crudo = await redis.get(clave);
    if (crudo) {
      try {
        const ban = JSON.parse(crudo) as BanRedis;
        return { motivo: ban.motivo, hasta: ban.hasta };
      } catch {
        await redis.del(clave);
      }
    }
  }
  return null;
}

/**
 * Aplica un ban con escalado automático (o con nivel forzado) a la identidad
 * dada: lo activa en Redis (ambas claves, con TTL) y lo registra en
 * PostgreSQL. Devuelve la info para notificar al usuario.
 */
export async function aplicarBan(
  redis: Redis,
  ipHash: string,
  fingerprint: string | null,
  motivo: string,
  nivelForzado?: number,
): Promise<InfoBan> {
  // El escalado se ancla al fingerprint si existe (sobrevive a cambios de
  // red); si no, al hash de IP.
  const idEscalado = fingerprint ?? ipHash;
  let nivel: number;
  if (nivelForzado) {
    nivel = Math.min(Math.max(nivelForzado, 1), DURACIONES_BAN.length);
    await redis.set(claveNivel(idEscalado), String(nivel), 'EX', TTL_NIVEL_BAN_S);
  } else {
    nivel = Math.min(await redis.incr(claveNivel(idEscalado)), DURACIONES_BAN.length);
    await redis.expire(claveNivel(idEscalado), TTL_NIVEL_BAN_S);
  }

  const duracionS = DURACIONES_BAN[nivel - 1];
  const hasta = duracionS === null ? null : Date.now() + duracionS * 1000;
  const ban: BanRedis = { motivo, hasta, nivel };
  const json = JSON.stringify(ban);

  const claves = [claveBanIp(ipHash)];
  if (fingerprint) claves.push(claveBanFp(fingerprint));
  for (const clave of claves) {
    if (duracionS === null) await redis.set(clave, json);
    else await redis.set(clave, json, 'EX', duracionS);
  }

  await prisma.ban
    .create({
      data: {
        ipHash,
        fingerprint: fingerprint ?? '',
        motivo,
        nivel,
        expiraEn: hasta === null ? null : new Date(hasta),
      },
    })
    .catch((err: unknown) => console.error('[moderacion] error guardando ban en PG:', err));

  return { motivo, hasta };
}

/** Marca un ban como levantado en PG y lo borra de Redis. */
export async function levantarBan(redis: Redis, banId: string): Promise<boolean> {
  const ban = await prisma.ban.findUnique({ where: { id: banId } });
  if (!ban) return false;
  await prisma.ban.update({ where: { id: banId }, data: { activo: false } });
  await redis.del(claveBanIp(ban.ipHash));
  if (ban.fingerprint) await redis.del(claveBanFp(ban.fingerprint));
  return true;
}

/**
 * Recarga en Redis los baneos aún vigentes registrados en PostgreSQL
 * (por si Redis se reinició sin persistencia).
 */
export async function recargarBanesActivos(redis: Redis): Promise<void> {
  const activos = await prisma.ban
    .findMany({
      where: { activo: true, OR: [{ expiraEn: null }, { expiraEn: { gt: new Date() } }] },
    })
    .catch(() => []);
  for (const ban of activos) {
    const hasta = ban.expiraEn ? ban.expiraEn.getTime() : null;
    const json = JSON.stringify({ motivo: ban.motivo, hasta, nivel: ban.nivel } satisfies BanRedis);
    const ttl = hasta === null ? null : Math.floor((hasta - Date.now()) / 1000);
    if (ttl !== null && ttl <= 0) continue;
    const claves = [claveBanIp(ban.ipHash)];
    if (ban.fingerprint) claves.push(claveBanFp(ban.fingerprint));
    for (const clave of claves) {
      if (ttl === null) await redis.set(clave, json);
      else await redis.set(clave, json, 'EX', ttl);
    }
  }
  if (activos.length > 0) {
    console.log(`[moderacion] ${activos.length} baneos activos recargados desde PostgreSQL`);
  }
}

// --- Strikes NSFW -----------------------------------------------------------

/** Registra un strike NSFW y devuelve el número acumulado en la última hora. */
export async function registrarStrikeNsfw(redis: Redis, idEscalado: string): Promise<number> {
  const clave = `nsfw:strikes:${idEscalado}`;
  const strikes = await redis.incr(clave);
  await redis.expire(clave, TTL_STRIKES_S);
  return strikes;
}

// --- Filtro de texto ---------------------------------------------------------

/** Lista configurable de términos prohibidos (minúsculas, separados por comas). */
const TERMINOS_PROHIBIDOS = (process.env.TERMINOS_PROHIBIDOS ??
  'cp,pedofilia,zoofilia,violacion')
  .split(',')
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean);

const REGEX_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
/** Secuencias tipo teléfono: 9+ dígitos admitiendo espacios, puntos y guiones. */
const REGEX_TELEFONO = /(?:\+?\d[\s.\-()]*){9,}/;

export type VeredictoTexto =
  | { permitido: true }
  | { permitido: false; motivo: 'termino' | 'datos_personales'; aviso: string };

/** Evalúa un mensaje de chat contra el filtro de términos y datos personales. */
export function evaluarTexto(texto: string): VeredictoTexto {
  const normalizado = texto.toLowerCase();
  for (const termino of TERMINOS_PROHIBIDOS) {
    if (normalizado.includes(termino)) {
      return {
        permitido: false,
        motivo: 'termino',
        aviso: 'Tu mensaje se ha bloqueado por incumplir las normas de la comunidad.',
      };
    }
  }
  if (REGEX_EMAIL.test(texto) || REGEX_TELEFONO.test(texto)) {
    return {
      permitido: false,
      motivo: 'datos_personales',
      aviso:
        'Por tu seguridad no compartas teléfonos ni emails con desconocidos. El mensaje no se ha enviado.',
    };
  }
  return { permitido: true };
}

// --- Rate limiting -----------------------------------------------------------

export const LIMITES = {
  /** Búsquedas de pareja (find_match + next) por minuto y por IP. */
  matchesPorMinuto: Number(process.env.RATE_MATCHES_POR_MINUTO ?? 20),
  /** Mensajes de chat por segundo y por IP. */
  mensajesPorSegundo: Number(process.env.RATE_MENSAJES_POR_SEGUNDO ?? 5),
  /** Denuncias por minuto y por IP. */
  denunciasPorMinuto: Number(process.env.RATE_DENUNCIAS_POR_MINUTO ?? 5),
  /** Alertas NSFW por minuto y por IP. */
  alertasNsfwPorMinuto: 6,
  /**
   * Sesiones de verificación de edad creadas por hora y por IP. Importante:
   * cada sesión de Stripe Identity cuesta dinero, así que sin este límite
   * un atacante podría generar coste ilimitado con un bucle de POST.
   */
  verificacionesPorHora: Number(process.env.RATE_VERIFICACIONES_POR_HORA ?? 10),
  /** Consultas de estado de verificación por minuto y por IP (polling). */
  estadoVerificacionPorMinuto: 60,
};

/**
 * Rate limit simple de ventana fija sobre Redis. Devuelve true si la acción
 * está DENTRO del límite (permitida).
 */
export async function dentroDelLimite(
  redis: Redis,
  tipo: string,
  ipHash: string,
  maximo: number,
  ventanaS: number,
): Promise<boolean> {
  const clave = `rl:${tipo}:${ipHash}`;
  const cuenta = await redis.incr(clave);
  if (cuenta === 1) await redis.expire(clave, ventanaS);
  return cuenta <= maximo;
}

// --- Métricas ----------------------------------------------------------------

/** Clave horaria (UTC) para contadores de métricas. */
export function claveHora(prefijo: string, desplazamientoHoras = 0): string {
  const fecha = new Date(Date.now() + desplazamientoHoras * 3_600_000);
  const y = fecha.getUTCFullYear();
  const m = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  const d = String(fecha.getUTCDate()).padStart(2, '0');
  const h = String(fecha.getUTCHours()).padStart(2, '0');
  return `metricas:${prefijo}:${y}${m}${d}${h}`;
}

/** Incrementa el contador horario de una métrica (TTL 25 h). */
export async function incrementarMetrica(redis: Redis, prefijo: string): Promise<void> {
  const clave = claveHora(prefijo);
  await redis.incr(clave);
  await redis.expire(clave, 25 * 60 * 60);
}
