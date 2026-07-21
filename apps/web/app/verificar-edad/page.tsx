'use client';

/**
 * Verificación de edad — candado de lanzamiento.
 *
 * Flujo: POST /verificacion/crear en el signaling → redirección a la página
 * del proveedor (Stripe Identity, o el simulador local en modo test) →
 * al volver (?retorno=1&sesionId=…) se hace polling de /verificacion/estado
 * hasta 'verificada' y se guarda el token de edad en localStorage.
 * Sin ese token el servidor no empareja a nadie (el candado real está allí).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import {
  borrarSesionVerificacion,
  guardarSesionVerificacion,
  guardarTokenEdad,
  obtenerSesionVerificacion,
  obtenerTokenEdad,
} from '@/lib/verificacionEdad';

const URL_SIGNALING =
  process.env.NEXT_PUBLIC_SIGNALING_URL ?? 'http://localhost:4000';

/** Cadencia del polling de /verificacion/estado mientras se espera. */
const INTERVALO_POLLING_MS = 3000;

type Pantalla =
  | 'cargando' // consultando el proveedor configurado
  | 'sin-proveedor' // el servidor no tiene verificación configurada
  | 'listo' // se puede iniciar la verificación
  | 'redirigiendo' // sesión creada, saliendo hacia el proveedor
  | 'esperando' // de vuelta del proveedor, polling del estado
  | 'verificada' // token guardado
  | 'fallida'; // el proveedor rechazó o canceló la sesión

export default function PaginaVerificarEdad() {
  const [pantalla, setPantalla] = useState<Pantalla>('cargando');
  const [proveedor, setProveedor] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function pararPolling() {
    if (intervaloRef.current) {
      clearInterval(intervaloRef.current);
      intervaloRef.current = null;
    }
  }

  /** Consulta el estado de la sesión; al verificarse guarda el token. */
  const comprobarEstado = useCallback(async (sesionId: string): Promise<void> => {
    const res = await fetch(
      `${URL_SIGNALING}/verificacion/estado?sesionId=${encodeURIComponent(sesionId)}`,
    );
    const datos = (await res.json()) as { estado?: string; token?: string; error?: string };
    if (!res.ok) throw new Error(datos.error ?? 'Error consultando la verificación');

    if (datos.estado === 'verificada' && datos.token) {
      guardarTokenEdad(datos.token);
      borrarSesionVerificacion();
      pararPolling();
      setPantalla('verificada');
    } else if (datos.estado === 'fallida' || datos.estado === 'desconocida') {
      borrarSesionVerificacion();
      pararPolling();
      setPantalla('fallida');
    }
    // 'pendiente': el polling seguirá preguntando.
  }, []);

  /** Arranca el polling del estado de la sesión dada. */
  const esperarResultado = useCallback(
    (sesionId: string) => {
      setPantalla('esperando');
      pararPolling();
      const tick = () =>
        void comprobarEstado(sesionId).catch(() => {
          // Error de red puntual: el siguiente tick reintenta.
        });
      tick();
      intervaloRef.current = setInterval(tick, INTERVALO_POLLING_MS);
    },
    [comprobarEstado],
  );

  // Arranque: token ya emitido → listo; sesión en curso (o retorno del
  // proveedor) → retomar el polling; si no, consultar el proveedor activo.
  useEffect(() => {
    if (obtenerTokenEdad()) {
      setPantalla('verificada');
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const sesionId = params.get('sesionId') ?? obtenerSesionVerificacion();
    if (sesionId) {
      esperarResultado(sesionId);
      return pararPolling;
    }
    fetch(`${URL_SIGNALING}/verificacion/estado-proveedor`)
      .then((res) => res.json())
      .then((datos: { proveedor?: string | null; activo?: boolean }) => {
        setProveedor(datos.proveedor ?? null);
        setPantalla(datos.activo ? 'listo' : 'sin-proveedor');
      })
      .catch(() => {
        setPantalla('sin-proveedor');
        setAviso('No se pudo contactar con el servidor. Recarga para reintentar.');
      });
    return pararPolling;
  }, [esperarResultado]);

  /** Crea la sesión y redirige a la página del proveedor. */
  function iniciarVerificacion() {
    setAviso(null);
    setPantalla('redirigiendo');
    void (async () => {
      const res = await fetch(`${URL_SIGNALING}/verificacion/crear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origen: window.location.origin }),
      });
      const datos = (await res.json()) as { sesionId?: string; url?: string; error?: string };
      if (!res.ok || !datos.sesionId || !datos.url) {
        throw new Error(datos.error ?? 'No se pudo iniciar la verificación');
      }
      guardarSesionVerificacion(datos.sesionId);
      window.location.href = datos.url;
    })().catch((err: Error) => {
      setPantalla('listo');
      setAviso(err.message);
    });
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-12 text-center">
      <Link href="/" aria-label="Volver al inicio">
        <Logo tamano="md" />
      </Link>

      <div className="w-full max-w-md space-y-5 rounded-2xl bg-slate-900 p-6 text-left">
        <h1 className="text-2xl font-bold">Verificación de edad</h1>
        <p className="text-sm text-slate-400">
          BoredChat es solo para mayores de 18 años. Para proteger a los
          menores, antes de chatear debes verificar tu edad con un documento
          de identidad. Sin esta verificación el servidor no te emparejará
          con nadie.
        </p>

        {pantalla === 'cargando' && (
          <p className="text-sm text-slate-400">Comprobando la configuración…</p>
        )}

        {pantalla === 'sin-proveedor' && (
          <div role="alert" className="rounded-xl border border-amber-500 bg-amber-500/10 p-3 text-sm text-amber-300">
            La verificación de edad no está configurada en el servidor, así
            que el chat permanece cerrado. Si eres quien lo administra,
            configura <code>PROVEEDOR_EDAD</code> y <code>AGE_JWT_SECRET</code>.
          </div>
        )}

        {(pantalla === 'listo' || pantalla === 'redirigiendo') && (
          <>
            {proveedor === 'test' && (
              <div role="alert" className="rounded-xl border border-amber-500 bg-amber-500/10 p-3 text-sm text-amber-300">
                Modo de prueba: la verificación se <strong>simula</strong> y
                no comprueba ninguna edad. Solo para desarrollo.
              </div>
            )}
            <button
              onClick={iniciarVerificacion}
              disabled={pantalla === 'redirigiendo'}
              className="w-full rounded-xl bg-indigo-500 px-6 py-3 font-semibold transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {pantalla === 'redirigiendo' ? 'Redirigiendo…' : 'Verificar mi edad'}
            </button>
            <p className="text-xs text-slate-500">
              La verificación la realiza un proveedor externo (documento +
              selfie). BoredChat solo recibe el resultado: verificado o no.
            </p>
          </>
        )}

        {pantalla === 'esperando' && (
          <p className="text-sm text-slate-400" aria-live="polite">
            Esperando el resultado de la verificación… Esta página se
            actualizará sola en cuanto el proveedor confirme.
          </p>
        )}

        {pantalla === 'verificada' && (
          <>
            <p className="rounded-xl border border-emerald-500 bg-emerald-500/10 p-3 text-sm text-emerald-300">
              ✔ Edad verificada. Ya puedes chatear.
            </p>
            <Link
              href="/"
              className="block w-full rounded-xl bg-indigo-500 px-6 py-3 text-center font-semibold transition hover:bg-indigo-400"
            >
              Ir al chat
            </Link>
          </>
        )}

        {pantalla === 'fallida' && (
          <>
            <p role="alert" className="rounded-xl border border-rose-500 bg-rose-500/10 p-3 text-sm text-rose-300">
              La verificación no se completó. Puedes intentarlo de nuevo.
            </p>
            <button
              // Recarga sin querystring para reiniciar el flujo desde cero.
              onClick={() => window.location.assign('/verificar-edad')}
              className="w-full rounded-xl bg-indigo-500 px-6 py-3 font-semibold transition hover:bg-indigo-400"
            >
              Reintentar
            </button>
          </>
        )}

        {aviso && (
          <p role="alert" className="text-sm text-rose-400">{aviso}</p>
        )}
      </div>

      <Link href="/" className="text-sm text-slate-400 hover:text-slate-200">
        ← Volver al inicio
      </Link>
    </div>
  );
}
