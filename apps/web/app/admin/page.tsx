'use client';

/**
 * Panel de administración — Fase 4.
 *
 * Login con contraseña (validada en el signaling, sesión JWT en
 * localStorage) y tres pestañas: cola de denuncias con el frame capturado
 * (acciones banear/descartar), baneos activos (con opción de levantarlos)
 * y métricas básicas. Los datos se refrescan automáticamente cada 10 s.
 */

import { useCallback, useEffect, useState } from 'react';

const URL_SIGNALING =
  process.env.NEXT_PUBLIC_SIGNALING_URL ?? 'http://localhost:4000';
const CLAVE_TOKEN = 'videochat.admin.token';

interface Denuncia {
  id: string;
  creadaEn: number;
  motivo: string;
  origen: string;
  estado: string;
  sesionDenunciante: string;
  sesionDenunciado: string;
  tieneIdentidad: boolean;
  frame: string | null;
}

interface Baneo {
  id: string;
  creadoEn: number;
  ipHash: string;
  fingerprint: string;
  motivo: string;
  nivel: number;
  expiraEn: number | null;
}

interface Metricas {
  usuariosConectados: number;
  enCola: Record<string, number>;
  matchesHoraActual: number;
  matchesHoraAnterior: number;
  denunciasHoraActual: number;
  denunciasHoraAnterior: number;
}

type Pestana = 'denuncias' | 'baneos' | 'metricas';

const fecha = (ms: number) =>
  new Date(ms).toLocaleString('es', { dateStyle: 'short', timeStyle: 'medium' });

export default function PaginaAdmin() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>('denuncias');
  const [denuncias, setDenuncias] = useState<Denuncia[]>([]);
  const [baneos, setBaneos] = useState<Baneo[]>([]);
  const [metricas, setMetricas] = useState<Metricas | null>(null);

  useEffect(() => {
    setToken(localStorage.getItem(CLAVE_TOKEN));
  }, []);

  /** Fetch autenticado contra la API del signaling. */
  const api = useCallback(
    async (ruta: string, init?: RequestInit): Promise<Response | null> => {
      const respuesta = await fetch(`${URL_SIGNALING}${ruta}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...init?.headers,
        },
      });
      if (respuesta.status === 401) {
        localStorage.removeItem(CLAVE_TOKEN);
        setToken(null);
        return null;
      }
      return respuesta;
    },
    [token],
  );

  const refrescar = useCallback(async () => {
    if (!token) return;
    try {
      const [rDenuncias, rBaneos, rMetricas] = await Promise.all([
        api('/admin/denuncias?estado=pendiente'),
        api('/admin/baneos'),
        api('/admin/metricas'),
      ]);
      if (rDenuncias?.ok) setDenuncias(await rDenuncias.json());
      if (rBaneos?.ok) setBaneos(await rBaneos.json());
      if (rMetricas?.ok) setMetricas(await rMetricas.json());
      setError(null);
    } catch {
      setError('No se pudo conectar con el servidor de señalización.');
    }
  }, [api, token]);

  // Refresco automático mientras hay sesión.
  useEffect(() => {
    if (!token) return;
    void refrescar();
    const intervalo = setInterval(() => void refrescar(), 10_000);
    return () => clearInterval(intervalo);
  }, [token, refrescar]);

  async function entrar(evento: React.FormEvent) {
    evento.preventDefault();
    setError(null);
    try {
      const respuesta = await fetch(`${URL_SIGNALING}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const datos = (await respuesta.json()) as { token?: string; error?: string };
      if (!respuesta.ok || !datos.token) {
        setError(datos.error ?? 'Error de acceso');
        return;
      }
      localStorage.setItem(CLAVE_TOKEN, datos.token);
      setToken(datos.token);
      setPassword('');
    } catch {
      setError('No se pudo conectar con el servidor.');
    }
  }

  async function accionDenuncia(id: string, accion: 'banear' | 'descartar') {
    const r = await api(`/admin/denuncias/${id}/${accion}`, { method: 'POST' });
    if (r && !r.ok) setError('La acción falló. Reintenta.');
    await refrescar();
  }

  async function levantarBaneo(id: string) {
    const r = await api(`/admin/baneos/${id}/levantar`, { method: 'POST' });
    if (r && !r.ok) setError('No se pudo levantar el ban.');
    await refrescar();
  }

  // --- Login ---

  if (!token) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4">
        <form onSubmit={entrar} className="w-full max-w-sm space-y-4 rounded-2xl bg-slate-900 p-6">
          <h1 className="text-xl font-bold">Panel de administración</h1>
          <label htmlFor="password" className="block text-sm text-slate-300">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-xl bg-slate-800 px-4 py-3 text-sm focus:outline focus:outline-2 focus:outline-indigo-400"
          />
          {error && (
            <p role="alert" className="rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-300">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="w-full rounded-xl bg-indigo-500 px-4 py-3 font-semibold transition hover:bg-indigo-400"
          >
            Entrar
          </button>
        </form>
      </main>
    );
  }

  // --- Panel ---

  const clasePestana = (activa: boolean) =>
    `rounded-lg px-4 py-2 text-sm font-semibold transition ${
      activa ? 'bg-indigo-500' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
    }`;

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Moderación</h1>
        <div className="flex gap-2">
          <button onClick={() => setPestana('denuncias')} className={clasePestana(pestana === 'denuncias')}>
            Denuncias ({denuncias.length})
          </button>
          <button onClick={() => setPestana('baneos')} className={clasePestana(pestana === 'baneos')}>
            Baneos ({baneos.length})
          </button>
          <button onClick={() => setPestana('metricas')} className={clasePestana(pestana === 'metricas')}>
            Métricas
          </button>
          <button
            onClick={() => {
              localStorage.removeItem(CLAVE_TOKEN);
              setToken(null);
            }}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-700"
          >
            Salir
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-rose-500/15 px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      )}

      {pestana === 'denuncias' && (
        <section aria-label="Cola de denuncias" className="space-y-3">
          {denuncias.length === 0 && (
            <p className="rounded-xl bg-slate-900 p-6 text-center text-slate-400">
              No hay denuncias pendientes. 🎉
            </p>
          )}
          {denuncias.map((d) => (
            <article key={d.id} className="flex flex-wrap gap-4 rounded-xl bg-slate-900 p-4">
              {d.frame ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={d.frame}
                  alt={`Frame capturado de la denuncia por ${d.motivo}`}
                  className="h-32 w-52 flex-none rounded-lg bg-black object-contain"
                />
              ) : (
                <div className="flex h-32 w-52 flex-none items-center justify-center rounded-lg bg-slate-800 text-sm text-slate-500">
                  Sin captura
                </div>
              )}
              <div className="min-w-0 flex-1 space-y-1 text-sm">
                <p className="font-semibold">
                  {d.motivo}
                  {d.origen === 'nsfw-auto' && (
                    <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                      detección automática
                    </span>
                  )}
                </p>
                <p className="text-slate-400">{fecha(d.creadaEn)}</p>
                <p className="truncate text-xs text-slate-500">
                  denunciante {d.sesionDenunciante} → denunciado {d.sesionDenunciado}
                </p>
                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => void accionDenuncia(d.id, 'banear')}
                    disabled={!d.tieneIdentidad}
                    className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold transition hover:bg-rose-500 disabled:opacity-40"
                  >
                    Banear
                  </button>
                  <button
                    onClick={() => void accionDenuncia(d.id, 'descartar')}
                    className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold transition hover:bg-slate-600"
                  >
                    Descartar
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {pestana === 'baneos' && (
        <section aria-label="Baneos activos" className="overflow-x-auto rounded-xl bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="p-3">Fecha</th>
                <th className="p-3">Identidad</th>
                <th className="p-3">Motivo</th>
                <th className="p-3">Nivel</th>
                <th className="p-3">Expira</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {baneos.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400">
                    No hay baneos activos.
                  </td>
                </tr>
              )}
              {baneos.map((b) => (
                <tr key={b.id} className="border-t border-slate-800">
                  <td className="p-3 text-slate-400">{fecha(b.creadoEn)}</td>
                  <td className="max-w-40 truncate p-3 font-mono text-xs">
                    {b.fingerprint || b.ipHash}
                  </td>
                  <td className="p-3">{b.motivo}</td>
                  <td className="p-3">{b.nivel}</td>
                  <td className="p-3">{b.expiraEn ? fecha(b.expiraEn) : 'Permanente'}</td>
                  <td className="p-3">
                    <button
                      onClick={() => void levantarBaneo(b.id)}
                      className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-600"
                    >
                      Levantar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {pestana === 'metricas' && metricas && (
        <section aria-label="Métricas" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['Usuarios conectados', String(metricas.usuariosConectados)],
            ['En cola (video)', String(metricas.enCola.video ?? 0)],
            ['En cola (texto)', String(metricas.enCola.texto ?? 0)],
            ['Matches (hora actual)', String(metricas.matchesHoraActual)],
            ['Matches (hora anterior)', String(metricas.matchesHoraAnterior)],
            [
              'Denuncias (hora actual / anterior)',
              `${metricas.denunciasHoraActual} / ${metricas.denunciasHoraAnterior}`,
            ],
          ].map(([titulo, valor]) => (
            <div key={titulo} className="rounded-xl bg-slate-900 p-4">
              <p className="text-sm text-slate-400">{titulo}</p>
              <p className="text-3xl font-bold">{valor}</p>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
