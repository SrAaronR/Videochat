/**
 * API del panel de administración — Fase 4.
 *
 * Login con contraseña por variable de entorno (ADMIN_PASSWORD) y sesión
 * JWT (ADMIN_JWT_SECRET). Expone la cola de denuncias con su frame, las
 * acciones banear/descartar, la lista de baneos activos y métricas básicas.
 */
import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type Redis from 'ioredis';
import type { Server } from 'socket.io';
import { prisma } from './db.js';
import { aplicarBan, claveHora, levantarBan } from './moderacion.js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
// Sin secreto explícito se genera uno por arranque (los tokens caducan al
// reiniciar; suficiente para desarrollo, configúralo en producción).
const JWT_SECRET = process.env.ADMIN_JWT_SECRET ?? randomBytes(32).toString('hex');
const DURACION_SESION = '12h';

interface OpcionesAdmin {
  redis: Redis;
  io: Server;
  /** Callback para desconectar en caliente a los sockets recién baneados. */
  desconectarBaneados: (ipHash: string | null, fingerprint: string | null, motivo: string, hasta: number | null) => void;
  /** Tamaños actuales de las colas de emparejamiento. */
  tamanosColas: () => Promise<Record<string, number>>;
}

/** Middleware: exige un JWT válido en Authorization: Bearer. */
function exigirAdmin(req: Request, res: Response, next: NextFunction): void {
  const cabecera = req.headers.authorization ?? '';
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Falta el token de sesión' });
    return;
  }
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Sesión caducada o inválida' });
  }
}

/** Convierte los bytes del frame a data-URI para mostrarlo en el panel. */
function frameADataUri(frame: Uint8Array | null): string | null {
  if (!frame || frame.length === 0) return null;
  return `data:image/jpeg;base64,${Buffer.from(frame).toString('base64')}`;
}

export function crearRouterAdmin({ redis, io, desconectarBaneados, tamanosColas }: OpcionesAdmin): Router {
  const router = Router();

  router.post('/login', (req, res) => {
    if (!ADMIN_PASSWORD) {
      res.status(503).json({ error: 'Panel deshabilitado: configura ADMIN_PASSWORD' });
      return;
    }
    const { password } = (req.body ?? {}) as { password?: string };
    if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
      res.status(401).json({ error: 'Contraseña incorrecta' });
      return;
    }
    const token = jwt.sign({ rol: 'admin' }, JWT_SECRET, { expiresIn: DURACION_SESION });
    res.json({ token });
  });

  router.use(exigirAdmin);

  // --- Denuncias -------------------------------------------------------------

  router.get('/denuncias', async (req, res) => {
    const estado = typeof req.query.estado === 'string' ? req.query.estado : 'pendiente';
    const denuncias = await prisma.denuncia.findMany({
      where: estado === 'todas' ? {} : { estado },
      orderBy: { creadaEn: 'desc' },
      take: 100,
    });
    res.json(
      denuncias.map((d) => ({
        id: d.id,
        creadaEn: d.creadaEn.getTime(),
        motivo: d.motivo,
        origen: d.origen,
        estado: d.estado,
        sesionDenunciante: d.sesionDenunciante,
        sesionDenunciado: d.sesionDenunciado,
        tieneIdentidad: Boolean(d.ipHashDenunciado ?? d.fingerprintDenunciado),
        frame: frameADataUri(d.frame),
      })),
    );
  });

  router.post('/denuncias/:id/banear', async (req, res) => {
    const denuncia = await prisma.denuncia.findUnique({ where: { id: req.params.id } });
    if (!denuncia) {
      res.status(404).json({ error: 'Denuncia no encontrada' });
      return;
    }
    if (!denuncia.ipHashDenunciado && !denuncia.fingerprintDenunciado) {
      res.status(422).json({ error: 'La denuncia no tiene identidad del denunciado' });
      return;
    }
    const motivo = `Baneado por denuncia: ${denuncia.motivo}`;
    const info = await aplicarBan(
      redis,
      denuncia.ipHashDenunciado ?? '',
      denuncia.fingerprintDenunciado,
      motivo,
    );
    await prisma.denuncia.update({ where: { id: denuncia.id }, data: { estado: 'baneada' } });
    desconectarBaneados(denuncia.ipHashDenunciado, denuncia.fingerprintDenunciado, info.motivo, info.hasta);
    res.json({ ok: true, ban: info });
  });

  router.post('/denuncias/:id/descartar', async (req, res) => {
    const actualizadas = await prisma.denuncia.updateMany({
      where: { id: req.params.id, estado: 'pendiente' },
      data: { estado: 'descartada' },
    });
    if (actualizadas.count === 0) {
      res.status(404).json({ error: 'Denuncia no encontrada o ya resuelta' });
      return;
    }
    res.json({ ok: true });
  });

  // --- Baneos ----------------------------------------------------------------

  router.get('/baneos', async (_req, res) => {
    const baneos = await prisma.ban.findMany({
      where: { activo: true, OR: [{ expiraEn: null }, { expiraEn: { gt: new Date() } }] },
      orderBy: { creadoEn: 'desc' },
      take: 200,
    });
    res.json(
      baneos.map((b) => ({
        id: b.id,
        creadoEn: b.creadoEn.getTime(),
        ipHash: b.ipHash,
        fingerprint: b.fingerprint,
        motivo: b.motivo,
        nivel: b.nivel,
        expiraEn: b.expiraEn ? b.expiraEn.getTime() : null,
      })),
    );
  });

  router.post('/baneos/:id/levantar', async (req, res) => {
    const ok = await levantarBan(redis, req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Ban no encontrado' });
      return;
    }
    res.json({ ok: true });
  });

  // --- Métricas ---------------------------------------------------------------

  router.get('/metricas', async (_req, res) => {
    const [matchesActual, matchesAnterior, denunciasActual, denunciasAnterior, colas] =
      await Promise.all([
        redis.get(claveHora('matches')),
        redis.get(claveHora('matches', -1)),
        redis.get(claveHora('denuncias')),
        redis.get(claveHora('denuncias', -1)),
        tamanosColas(),
      ]);
    res.json({
      usuariosConectados: io.engine.clientsCount,
      enCola: colas,
      matchesHoraActual: Number(matchesActual ?? 0),
      matchesHoraAnterior: Number(matchesAnterior ?? 0),
      denunciasHoraActual: Number(denunciasActual ?? 0),
      denunciasHoraAnterior: Number(denunciasAnterior ?? 0),
    });
  });

  return router;
}
