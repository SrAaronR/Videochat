import type { Metadata } from 'next';
import PaginaLegal from '@/components/PaginaLegal';

export const metadata: Metadata = { title: 'Política de Privacidad — Videochat aleatorio' };

export default function PaginaPrivacidad() {
  return (
    <PaginaLegal titulo="Política de Privacidad" actualizado="18 de julio de 2026">
      <section>
        <h2>1. Sin cuentas ni perfiles</h2>
        <p>
          No pedimos registro, nombre, correo ni ningún dato identificativo
          para usar el servicio.
        </p>
      </section>
      <section>
        <h2>2. Qué datos tratamos y por qué</h2>
        <ul>
          <li>
            <strong>Dirección IP (transformada):</strong> nunca almacenamos tu
            IP en claro; guardamos un hash irreversible con sal, usado solo
            para aplicar límites anti-abuso y bloqueos. De la IP también se
            deriva el país aproximado para el filtro de emparejamiento.
          </li>
          <li>
            <strong>Huella técnica del navegador (fingerprint):</strong> un
            identificador derivado de características técnicas del navegador,
            usado exclusivamente para que los bloqueos por mala conducta no se
            puedan eludir abriendo otra pestaña.
          </li>
          <li>
            <strong>Mensajes de chat:</strong> pasan por el servidor para
            aplicar los filtros de moderación; no se conservan una vez
            entregados.
          </li>
          <li>
            <strong>Video y audio:</strong> viajan cifrados de navegador a
            navegador (WebRTC, DTLS-SRTP) y NO se graban ni se almacenan.
            Única excepción: al denunciar a alguien (o cuando el detector
            automático se activa) se captura una imagen fija como evidencia,
            que revisa el equipo de moderación.
          </li>
          <li>
            <strong>Denuncias y bloqueos:</strong> guardamos la denuncia, la
            imagen de evidencia y los identificadores anteriores durante el
            tiempo necesario para gestionar la moderación.
          </li>
        </ul>
      </section>
      <section>
        <h2>3. Almacenamiento local en tu dispositivo</h2>
        <p>
          Usamos localStorage (no cookies de seguimiento) para recordar: tu
          aceptación de los términos con su fecha, tus preferencias de
          búsqueda y la huella técnica. Puedes borrarlo desde la
          configuración de tu navegador.
        </p>
      </section>
      <section>
        <h2>4. Terceros</h2>
        <p>
          No vendemos datos ni usamos publicidad de terceros. El tráfico de
          video puede atravesar nuestro servidor TURN cuando la conexión
          directa no es posible; ese tránsito está cifrado y no se conserva.
        </p>
      </section>
      <section>
        <h2>5. Tus derechos</h2>
        <p>
          Puedes solicitar acceso, rectificación o supresión de los datos de
          moderación que te conciernan escribiendo a [correo de contacto
          pendiente de definir]. Ten en cuenta que, al no haber cuentas,
          necesitaremos elementos que permitan localizar los registros.
        </p>
      </section>
      <section>
        <h2>6. Menores</h2>
        <p>
          El servicio está prohibido a menores de 18 años. No tratamos
          conscientemente datos de menores; las denuncias que los involucren
          se priorizan y pueden comunicarse a las autoridades.
        </p>
      </section>
    </PaginaLegal>
  );
}
