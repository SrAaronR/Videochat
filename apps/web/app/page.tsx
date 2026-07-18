import Link from 'next/link';

/**
 * Landing mínima de la Fase 1: solo el acceso al chat de texto.
 * La propuesta de valor completa, el gate 18+, el selector de modo
 * y los intereses llegan en las Fases 3 y 5.
 */
export default function PaginaInicio() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 text-center">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Habla con desconocidos
        </h1>
        <p className="mx-auto max-w-md text-slate-400">
          Emparejamiento aleatorio 1 contra 1. Fase 1: chat de texto.
          El video llega en la Fase 2.
        </p>
      </div>
      <Link
        href="/chat"
        className="rounded-xl bg-indigo-500 px-8 py-4 text-lg font-semibold transition hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
      >
        Empezar a chatear
      </Link>
    </main>
  );
}
