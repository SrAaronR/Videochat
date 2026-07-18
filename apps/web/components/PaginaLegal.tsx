import Link from 'next/link';

/**
 * Maqueta común de las páginas legales estáticas (Fase 5): título, aviso
 * de borrador pendiente de revisión jurídica y cuerpo con estilos de prosa.
 */
export default function PaginaLegal({
  titulo,
  actualizado,
  children,
}: {
  titulo: string;
  actualizado: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="text-sm text-indigo-400 hover:text-indigo-300">
        ← Volver al inicio
      </Link>
      <h1 className="mt-4 text-3xl font-bold">{titulo}</h1>
      <p className="mt-1 text-sm text-slate-500">Última actualización: {actualizado}</p>

      <p
        role="note"
        className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
      >
        ⚠️ BORRADOR generado para el MVP. Este texto debe ser revisado y
        adaptado por un abogado antes del lanzamiento público, especialmente
        en materia de protección de datos y menores.
      </p>

      <div className="mt-8 space-y-6 leading-relaxed text-slate-300 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-100 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
        {children}
      </div>
    </main>
  );
}
