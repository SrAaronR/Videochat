'use client';

/**
 * Simulador de verificación de edad — SOLO modo test (desarrollo).
 *
 * Con PROVEEDOR_EDAD=test el servidor redirige aquí en lugar de a un
 * proveedor real. El botón llama a /verificacion/estado con aprobarTest=1,
 * que marca la sesión como verificada SIN comprobar nada. El servidor solo
 * lo acepta si PERMITIR_VERIFICACION_TEST está puesta con su frase exacta;
 * en producción esta página no aprueba nada.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { borrarSesionVerificacion, guardarTokenEdad } from '@/lib/verificacionEdad';

const URL_SIGNALING =
  process.env.NEXT_PUBLIC_SIGNALING_URL ?? 'http://localhost:4000';

export default function PaginaSimularVerificacion() {
  const router = useRouter();
  const [sesionId, setSesionId] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    setSesionId(new URLSearchParams(window.location.search).get('sesionId'));
  }, []);

  function aprobar() {
    if (!sesionId) return;
    setEnviando(true);
    setAviso(null);
    void (async () => {
      const res = await fetch(
        `${URL_SIGNALING}/verificacion/estado?sesionId=${encodeURIComponent(sesionId)}&aprobarTest=1`,
      );
      const datos = (await res.json()) as { estado?: string; token?: string; error?: string };
      if (!res.ok || datos.estado !== 'verificada' || !datos.token) {
        throw new Error(datos.error ?? 'El servidor no aceptó la simulación');
      }
      guardarTokenEdad(datos.token);
      borrarSesionVerificacion();
      router.replace('/');
    })().catch((err: Error) => {
      setEnviando(false);
      setAviso(err.message);
    });
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-12 text-center">
      <Logo tamano="md" />

      <div className="w-full max-w-md space-y-5 rounded-2xl bg-slate-900 p-6 text-left">
        <h1 className="text-2xl font-bold">Simulador de verificación</h1>
        <div role="alert" className="rounded-xl border border-amber-500 bg-amber-500/10 p-3 text-sm text-amber-300">
          ⚠ Esto es el <strong>modo de prueba</strong>: no verifica ninguna
          edad, solo simula el resultado para poder desarrollar. Nunca debe
          estar activo en producción.
        </div>

        {sesionId ? (
          <button
            onClick={aprobar}
            disabled={enviando}
            className="w-full rounded-xl bg-indigo-500 px-6 py-3 font-semibold transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {enviando ? 'Aprobando…' : 'Simular verificación aprobada'}
          </button>
        ) : (
          <p role="alert" className="text-sm text-rose-400">
            Falta el parámetro <code>sesionId</code>. Vuelve a{' '}
            <Link href="/verificar-edad" className="text-indigo-400 underline">
              /verificar-edad
            </Link>{' '}
            e inicia el flujo desde allí.
          </p>
        )}

        {aviso && <p role="alert" className="text-sm text-rose-400">{aviso}</p>}
      </div>

      <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
        ← Volver al inicio
      </Link>
    </div>
  );
}
