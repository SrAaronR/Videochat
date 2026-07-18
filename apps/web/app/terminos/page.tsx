import type { Metadata } from 'next';
import PaginaLegal from '@/components/PaginaLegal';

export const metadata: Metadata = { title: 'Términos y Condiciones — BoredChat' };

export default function PaginaTerminos() {
  return (
    <PaginaLegal titulo="Términos y Condiciones" actualizado="18 de julio de 2026">
      <section>
        <h2>1. El servicio</h2>
        <p>
          Esta plataforma permite conversar por video, audio y texto con
          personas desconocidas emparejadas al azar, sin registro previo. El
          servicio se ofrece &quot;tal cual&quot;, sin garantía de
          disponibilidad ni de resultados.
        </p>
      </section>
      <section>
        <h2>2. Mayoría de edad (18+)</h2>
        <p>
          El servicio está estrictamente reservado a personas mayores de 18
          años. Al marcar la casilla de aceptación declaras bajo tu
          responsabilidad que tienes al menos 18 años. Si detectamos o se nos
          denuncia la presencia de un menor, cortaremos la sesión, aplicaremos
          un bloqueo y podremos informar a las autoridades competentes.
        </p>
      </section>
      <section>
        <h2>3. Conductas prohibidas</h2>
        <ul>
          <li>Cualquier contenido o conducta que involucre a menores.</li>
          <li>Desnudez, contenido sexual explícito o exhibicionismo.</li>
          <li>Acoso, amenazas, discurso de odio o incitación a la violencia.</li>
          <li>Spam, publicidad, estafas o suplantación de identidad.</li>
          <li>Grabar o difundir la imagen del interlocutor sin su consentimiento.</li>
          <li>Eludir bloqueos o interferir técnicamente con el servicio.</li>
        </ul>
        <p>
          El incumplimiento conlleva la suspensión temporal o permanente del
          acceso (ver Normas de la comunidad) sin necesidad de preaviso.
        </p>
      </section>
      <section>
        <h2>4. Moderación</h2>
        <p>
          Para proteger a la comunidad, los mensajes de texto pasan por
          filtros automáticos, existe un botón de denuncia que captura una
          imagen del video del denunciado como evidencia, y un sistema
          automático puede analizar tu propio video en tu dispositivo para
          detectar contenido no permitido. Las conversaciones de video no se
          graban ni se almacenan.
        </p>
      </section>
      <section>
        <h2>5. Responsabilidad</h2>
        <p>
          Hablas con desconocidos bajo tu propia responsabilidad. No
          controlamos ni respondemos del comportamiento de otros usuarios.
          En la máxima medida permitida por la ley, no seremos responsables
          de daños derivados del uso del servicio.
        </p>
      </section>
      <section>
        <h2>6. Cambios</h2>
        <p>
          Podemos modificar estos términos en cualquier momento. Si lo
          hacemos, se te pedirá aceptar la nueva versión antes de volver a
          conectar.
        </p>
      </section>
      <section>
        <h2>7. Contacto</h2>
        <p>
          Para cualquier consulta sobre estos términos: [correo de contacto
          pendiente de definir].
        </p>
      </section>
    </PaginaLegal>
  );
}
