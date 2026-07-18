'use client';

/**
 * Landing — Fases 3 y 5.
 * Propuesta de valor, selector de modo (Video / Solo texto), intereses
 * opcionales, filtro opcional de país y GATE OBLIGATORIO: sin marcar la
 * casilla de 18+ y aceptación de Términos no se puede entrar al chat.
 * La aceptación se guarda en localStorage con timestamp (lib/aceptacion.ts)
 * y la sala vuelve a comprobarla antes de conectar.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ModoChat } from '@videochat/shared';
import { estaAceptado, guardarAceptacion } from '@/lib/aceptacion';
import { PAISES } from '@/lib/paises';

const CLAVE_PREFERENCIAS = 'videochat.preferencias';

interface Preferencias {
  modo: ModoChat;
  intereses: string;
  pais: string; // '' = cualquier país
}

const CARACTERISTICAS: Array<[string, string, string]> = [
  ['🎲', 'Aleatorio de verdad', 'Pulsa Empezar y en segundos estás hablando con alguien nuevo. ¿No encaja? Siguiente.'],
  ['🔒', 'Sin registro', 'Nada de cuentas ni perfiles. El video va cifrado de navegador a navegador y no se graba.'],
  ['🛡️', 'Moderación activa', 'Filtros automáticos, botón de denuncia siempre visible y expulsiones para quien incumple las normas.'],
];

export default function PaginaInicio() {
  const router = useRouter();
  const [modo, setModo] = useState<ModoChat>('video');
  const [intereses, setIntereses] = useState('');
  const [pais, setPais] = useState('');
  const [aceptado, setAceptado] = useState(false);
  const [avisoGate, setAvisoGate] = useState(false);

  // Restaurar preferencias y aceptación previa.
  useEffect(() => {
    try {
      const crudo = localStorage.getItem(CLAVE_PREFERENCIAS);
      if (crudo) {
        const prefs = JSON.parse(crudo) as Partial<Preferencias>;
        if (prefs.modo === 'video' || prefs.modo === 'texto') setModo(prefs.modo);
        if (typeof prefs.intereses === 'string') setIntereses(prefs.intereses);
        if (typeof prefs.pais === 'string') setPais(prefs.pais);
      }
    } catch {
      // Preferencias corruptas: se ignoran.
    }
    setAceptado(estaAceptado());
  }, []);

  function empezar() {
    // Gate obligatorio: sin aceptación no se navega a la sala.
    if (!aceptado) {
      setAvisoGate(true);
      return;
    }
    guardarAceptacion();
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
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 flex-col items-center gap-10 px-4 py-12 text-center">
        {/* Propuesta de valor */}
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Habla con desconocidos
            <span className="block text-indigo-400">al azar, cara a cara</span>
          </h1>
          <p className="mx-auto max-w-md text-slate-400">
            Videochat y chat de texto 1 contra 1 con personas de todo el
            mundo. Sin registro, sin descargas: pulsa y conversa.
          </p>
        </div>

        <ul className="grid w-full max-w-3xl gap-3 text-left sm:grid-cols-3">
          {CARACTERISTICAS.map(([icono, titulo, texto]) => (
            <li key={titulo} className="rounded-2xl bg-slate-900 p-4">
              <span aria-hidden className="text-2xl">{icono}</span>
              <p className="mt-1 font-semibold">{titulo}</p>
              <p className="mt-1 text-sm text-slate-400">{texto}</p>
            </li>
          ))}
        </ul>

        {/* Configuración de la búsqueda */}
        <div className="w-full max-w-sm space-y-4 text-left">
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

          {/* Gate obligatorio 18+ / Términos */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${
              avisoGate && !aceptado
                ? 'border-rose-500 bg-rose-500/10'
                : 'border-slate-700 bg-slate-900'
            }`}
          >
            <input
              type="checkbox"
              checked={aceptado}
              onChange={(e) => {
                setAceptado(e.target.checked);
                if (e.target.checked) setAvisoGate(false);
              }}
              className="mt-0.5 h-4 w-4 accent-indigo-500"
            />
            <span className="text-slate-300">
              Confirmo que tengo <strong>18 años o más</strong> y acepto los{' '}
              <Link href="/terminos" className="text-indigo-400 underline hover:text-indigo-300">
                Términos
              </Link>
              , la{' '}
              <Link href="/privacidad" className="text-indigo-400 underline hover:text-indigo-300">
                Privacidad
              </Link>{' '}
              y las{' '}
              <Link href="/normas" className="text-indigo-400 underline hover:text-indigo-300">
                Normas de la comunidad
              </Link>
              .
            </span>
          </label>
          {avisoGate && !aceptado && (
            <p role="alert" className="text-sm text-rose-400">
              Debes confirmar que eres mayor de edad y aceptar los términos
              para continuar.
            </p>
          )}
        </div>

        <button
          onClick={empezar}
          aria-disabled={!aceptado}
          className={`w-full max-w-sm rounded-xl px-8 py-4 text-lg font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 ${
            aceptado
              ? 'bg-indigo-500 hover:bg-indigo-400'
              : 'cursor-not-allowed bg-slate-700 text-slate-400'
          }`}
        >
          Empezar a chatear
        </button>
      </main>

      <footer className="border-t border-slate-800 px-4 py-6">
        <nav
          aria-label="Enlaces legales"
          className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-400"
        >
          <Link href="/terminos" className="hover:text-slate-200">Términos y Condiciones</Link>
          <Link href="/privacidad" className="hover:text-slate-200">Política de Privacidad</Link>
          <Link href="/normas" className="hover:text-slate-200">Normas de la comunidad</Link>
        </nav>
        <p className="mt-3 text-center text-xs text-slate-600">
          Servicio solo para mayores de 18 años. El video no se graba.
        </p>
      </footer>
    </div>
  );
}
