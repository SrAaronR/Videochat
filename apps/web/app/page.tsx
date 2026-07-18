'use client';

/**
 * Landing — Fase 3.
 * Selector de modo (Video / Solo texto), intereses opcionales y filtro
 * opcional de país. Las preferencias se recuerdan en localStorage y se
 * pasan a la sala por querystring.
 * El gate de Términos + mayoría de edad llega en la Fase 5.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ModoChat } from '@videochat/shared';
import { PAISES } from '@/lib/paises';

const CLAVE_PREFERENCIAS = 'videochat.preferencias';

interface Preferencias {
  modo: ModoChat;
  intereses: string;
  pais: string; // '' = cualquier país
}

export default function PaginaInicio() {
  const router = useRouter();
  const [modo, setModo] = useState<ModoChat>('video');
  const [intereses, setIntereses] = useState('');
  const [pais, setPais] = useState('');

  // Restaurar las últimas preferencias del usuario.
  useEffect(() => {
    try {
      const crudo = localStorage.getItem(CLAVE_PREFERENCIAS);
      if (!crudo) return;
      const prefs = JSON.parse(crudo) as Partial<Preferencias>;
      if (prefs.modo === 'video' || prefs.modo === 'texto') setModo(prefs.modo);
      if (typeof prefs.intereses === 'string') setIntereses(prefs.intereses);
      if (typeof prefs.pais === 'string') setPais(prefs.pais);
    } catch {
      // Preferencias corruptas: se ignoran.
    }
  }, []);

  function empezar() {
    try {
      localStorage.setItem(
        CLAVE_PREFERENCIAS,
        JSON.stringify({ modo, intereses, pais } satisfies Preferencias),
      );
    } catch {
      // localStorage lleno o bloqueado: no es crítico.
    }
    const params = new URLSearchParams();
    params.set('modo', modo);
    const listaIntereses = intereses
      .split(',')
      .map((i) => i.trim())
      .filter(Boolean);
    if (listaIntereses.length > 0) params.set('intereses', listaIntereses.join(','));
    if (pais) params.set('pais', pais);
    router.push(`/chat?${params.toString()}`);
  }

  const claseModo = (activo: boolean) =>
    `flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${
      activo ? 'bg-indigo-500' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
    }`;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10 text-center">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Habla con desconocidos
        </h1>
        <p className="mx-auto max-w-md text-slate-400">
          Emparejamiento aleatorio 1 contra 1 por video o solo texto.
          Sin registros ni descargas.
        </p>
      </div>

      <div className="w-full max-w-sm space-y-4 text-left">
        {/* Selector de modo */}
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-300">Modo</legend>
          <div className="flex gap-2" role="group" aria-label="Modo de chat">
            <button
              type="button"
              onClick={() => setModo('video')}
              aria-pressed={modo === 'video'}
              className={claseModo(modo === 'video')}
            >
              🎥 Video
            </button>
            <button
              type="button"
              onClick={() => setModo('texto')}
              aria-pressed={modo === 'texto'}
              className={claseModo(modo === 'texto')}
            >
              💬 Solo texto
            </button>
          </div>
        </fieldset>

        {/* Intereses opcionales */}
        <div>
          <label htmlFor="intereses" className="mb-2 block text-sm font-medium text-slate-300">
            Intereses <span className="text-slate-500">(opcional, separados por comas)</span>
          </label>
          <input
            id="intereses"
            value={intereses}
            onChange={(e) => setIntereses(e.target.value)}
            placeholder="gaming, música, viajes"
            className="w-full rounded-xl bg-slate-800 px-4 py-3 text-sm placeholder:text-slate-500 focus:outline focus:outline-2 focus:outline-indigo-400"
          />
          <p className="mt-1 text-xs text-slate-500">
            Durante 15 s buscamos a alguien con tus intereses; si no hay, te
            emparejamos con cualquiera.
          </p>
        </div>

        {/* Filtro de país opcional */}
        <div>
          <label htmlFor="pais" className="mb-2 block text-sm font-medium text-slate-300">
            País del desconocido <span className="text-slate-500">(opcional)</span>
          </label>
          <select
            id="pais"
            value={pais}
            onChange={(e) => setPais(e.target.value)}
            className="w-full rounded-xl bg-slate-800 px-4 py-3 text-sm focus:outline focus:outline-2 focus:outline-indigo-400"
          >
            <option value="">Cualquier país</option>
            {PAISES.map((p) => (
              <option key={p.codigo} value={p.codigo}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        onClick={empezar}
        className="w-full max-w-sm rounded-xl bg-indigo-500 px-8 py-4 text-lg font-semibold transition hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
      >
        Empezar a chatear
      </button>
    </main>
  );
}
