/**
 * Logo de marca de BoredChat: un bocadillo de chat con una carita
 * "aburrida" (ojos entornados + boca recta) — guiño al nombre — junto al
 * wordmark. Todo en SVG inline, sin assets externos.
 */

/** Solo el icono (bocadillo con carita aburrida). Escalable por `className`. */
export function LogoIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 60"
      className={className}
      role="img"
      aria-label="BoredChat"
      fill="none"
    >
      {/* Bocadillo */}
      <path
        d="M12 4h40a10 10 0 0 1 10 10v22a10 10 0 0 1-10 10H30l-13 12v-12h-5A10 10 0 0 1 2 36V14A10 10 0 0 1 12 4Z"
        fill="#6366f1"
      />
      {/* Ojos entornados (párpados caídos) */}
      <path d="M17 22c3-3 8-3 11 0" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M36 22c3-3 8-3 11 0" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
      {/* Boca recta (aburrida) */}
      <path d="M22 33h20" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

/** Logo completo: icono + wordmark "BoredChat". */
export function Logo({ className, tamano = 'md' }: { className?: string; tamano?: 'sm' | 'md' | 'lg' }) {
  const alturaIcono = tamano === 'lg' ? 'h-10' : tamano === 'sm' ? 'h-6' : 'h-8';
  const texto = tamano === 'lg' ? 'text-3xl' : tamano === 'sm' ? 'text-lg' : 'text-2xl';
  return (
    <span className={`inline-flex items-center gap-2 font-bold tracking-tight ${texto} ${className ?? ''}`}>
      <LogoIcon className={`${alturaIcono} w-auto`} />
      <span>
        <span className="text-white">Bored</span>
        <span className="text-indigo-400">Chat</span>
      </span>
    </span>
  );
}
