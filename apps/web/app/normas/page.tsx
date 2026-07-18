import type { Metadata } from 'next';
import PaginaLegal from '@/components/PaginaLegal';

export const metadata: Metadata = { title: 'Normas de la comunidad — Videochat aleatorio' };

export default function PaginaNormas() {
  return (
    <PaginaLegal titulo="Normas de la comunidad" actualizado="18 de julio de 2026">
      <section>
        <h2>La regla de oro</h2>
        <p>
          Trata a la persona del otro lado como te gustaría que te trataran.
          Detrás de cada cámara hay alguien real.
        </p>
      </section>
      <section>
        <h2>Prohibido siempre</h2>
        <ul>
          <li>Menores en cámara o cualquier contenido que los sexualice. Tolerancia cero.</li>
          <li>Desnudez y actos sexuales en cámara.</li>
          <li>Acoso, insultos graves, amenazas o discurso de odio.</li>
          <li>Compartir datos personales (tuyos o de otros): teléfonos, direcciones, redes.</li>
          <li>Grabar al interlocutor o hacer capturas para difundirlas.</li>
          <li>Spam, ventas, bots o enlaces sospechosos.</li>
        </ul>
      </section>
      <section>
        <h2>Consecuencias</h2>
        <p>
          Los incumplimientos se sancionan con suspensiones escaladas:
          <strong> 15 minutos → 24 horas → 7 días → permanente</strong>, según
          gravedad y reincidencia. Los casos que involucren menores pueden
          denunciarse a las autoridades.
        </p>
      </section>
      <section>
        <h2>Ayúdanos a moderar</h2>
        <p>
          Si alguien incumple las normas, pulsa el botón 🚩 Denunciar: se
          envía una captura de su video al equipo de moderación y pasarás al
          siguiente emparejamiento. No respondas a las provocaciones.
        </p>
      </section>
      <section>
        <h2>Tu seguridad</h2>
        <ul>
          <li>No compartas nunca datos que permitan identificarte o localizarte.</li>
          <li>Desconfía de quien te pida dinero, fotos o continuar en otra app.</li>
          <li>Si algo te incomoda, pulsa Siguiente o Detener: no le debes nada a nadie.</li>
        </ul>
      </section>
    </PaginaLegal>
  );
}
