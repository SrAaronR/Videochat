# Checklist de lanzamiento público

Estado de los requisitos NO negociables antes de abrir el servicio al
público. Un videochat aleatorio con desconocidos es una categoría de alto
riesgo (Omegle cerró en 2023 por demandas de abuso de menores): sin TODOS
los puntos bloqueantes cubiertos, no debe publicarse.

## Qué está hecho (código, en esta rama)

- [x] Producto completo: matchmaking por intereses/país, WebRTC, chat
      moderado, denuncias, baneos escalados, panel de admin, sala de
      vigilancia, detector NSFW, rate limiting, marca BoredChat.
- [x] **Verificación de edad obligatoria** con diseño "falla cerrada": sin
      token emitido tras verificación real, el servidor no empareja a
      nadie. Proveedor Stripe Identity implementado; modo test solo para
      desarrollo. Probado (typecheck, build, e2e del candado).
- [x] Rate limiting de las rutas de verificación (cada sesión de Stripe
      cuesta dinero).
- [x] Despliegue con HTTPS automático en un comando
      (`deploy/instalar-vps.sh`, guía en `despliegue-vps.md`).
- [x] Procedimiento de moderación y denuncia a autoridades escrito
      (`operacion-moderacion.md`).

## Bloqueantes (por hacer, requieren a la persona operadora)

### 1. Cuenta de Stripe con Identity (verificación de edad real)

- [ ] Crear cuenta en stripe.com a nombre de la entidad responsable
      (punto 3) y completar la activación para operar en vivo.
- [ ] Activar **Identity** (Products → Identity en el dashboard). Cobran
      por verificación realizada.
- [ ] Poner en el `.env` del servidor: `PROVEEDOR_EDAD=stripe`,
      `STRIPE_SECRET_KEY=sk_live_…` y un `AGE_JWT_SECRET` aleatorio.
- [ ] Comprobar: `curl https://senal.<dominio>/verificacion/estado-proveedor`
      → `"activo":true`, y hacer una verificación real de prueba.

### 2. Equipo de moderación humana

- [ ] Personas asignadas y horario de cobertura definido (la sala de
      vigilancia atendida siempre que el servicio esté abierto).
- [ ] Equipo formado en `operacion-moderacion.md`, en especial el
      protocolo CSAM (sección 4) y los contactos de denuncia
      (Policía Nacional / Guardia Civil GDT / INCIBE 017 / NCMEC / INHOPE).
- [ ] Log interno de incidentes creado y accesible al equipo.

### 3. Entidad responsable y revisión legal

- [ ] Entidad o persona identificable que opera el servicio (autónomo o
      sociedad), con sus datos en el Aviso Legal / Términos.
- [ ] **Abogado** revisa Términos, Privacidad y Normas (los textos
      actuales son borradores de MVP y están marcados como tales),
      incluyendo: supervisión de cámara (RGPD), datos de la verificación
      de edad (Stripe es quien trata el documento), plazos de retención
      de denuncias, obligaciones de denuncia de CSAM y, si opera en la
      UE, DSA. Encargos de tratamiento (DPA) con Stripe y el hosting.
- [ ] Actualizar los textos legales con el resultado y subir
      `VERSION_TERMINOS` en `apps/web/lib/aceptacion.ts` (invalida las
      aceptaciones antiguas y obliga a re-aceptar).

### 4. Infraestructura e higiene de credenciales

- [ ] En `console.hetzner.cloud`: borrar todos los servidores de
      desarrollo sobrantes y dejar solo el de producción (se pagan por
      horas aunque no se usen).
- [ ] **Rotar/borrar el token de API de Hetzner** usado durante el
      desarrollo (Security → API tokens).
- [ ] Redesplegar el servidor de producción con esta rama y las variables
      de verificación (sección "Actualizar un despliegue anterior" de
      `despliegue-vps.md`) — la versión desplegada actualmente NO tiene
      el candado de edad.
- [ ] A partir de ahí, actualizaciones incrementales por SSH: no recrear
      la máquina (borra la BD y agota el límite de certificados).
- [ ] Backups periódicos de PostgreSQL programados (comando en la guía).

## Orden recomendado

1. Entidad responsable (3) — la necesitas para abrir la cuenta de Stripe.
2. Stripe Identity (1) y redespliegue (4) — el candado queda operativo.
3. Revisión legal (3) mientras se forma el equipo de moderación (2).
4. Limpieza de Hetzner y rotación del token (4) — hoy mismo, no cuesta nada.

Cuando todas las casillas estén marcadas, y solo entonces, tiene sentido
hacer difusión pública del servicio.
