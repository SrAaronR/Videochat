# PROMPT MAESTRO — Plataforma de videochat aleatorio tipo Uhmegle/Omegle

> Copia y pega todo lo que sigue en tu herramienta de IA para código (Claude Code, Cursor, etc.). Está diseñado para ejecutarse por fases: pide primero la Fase 1 y avanza en orden.

---

## ROL

Actúa como un equipo senior full-stack especializado en aplicaciones de comunicación en tiempo real (WebRTC, WebSockets) y trust & safety. Vas a construir desde cero una plataforma web de videochat y chat de texto aleatorio 1 contra 1, tipo Omegle/Uhmegle, con moderación integrada. Antes de escribir código, resume tu plan de arquitectura y espera mi confirmación.

## OBJETIVO DEL PRODUCTO

Una web donde un usuario, sin registrarse, pulsa "Empezar" y queda emparejado al azar con otro usuario conectado para hablar por video + audio + chat de texto. Puede pulsar "Siguiente" para saltar a otra persona al instante. Debe funcionar en navegador de escritorio y móvil, sin descargas.

## STACK TÉCNICO (obligatorio)

- **Frontend:** Next.js 14+ (App Router), React, TypeScript, Tailwind CSS.
- **Backend / señalización:** Node.js + Socket.IO en un servidor dedicado (no serverless: se necesitan conexiones WebSocket persistentes).
- **Video:** WebRTC peer-to-peer (getUserMedia + RTCPeerConnection). Servidores STUN públicos de Google + TURN propio con **coturn** (incluye docker-compose y config de ejemplo con credenciales por variable de entorno).
- **Estado y colas:** Redis (cola de emparejamiento, sesiones activas, rate limiting, lista de baneos).
- **Base de datos:** PostgreSQL con Prisma (reportes, baneos, logs de moderación, métricas).
- **Moderación de video:** NSFWJS (TensorFlow.js) ejecutado en el cliente sobre capturas periódicas del propio video local, + endpoint para verificación servidor si se supera el umbral.
- **Despliegue:** Docker Compose con servicios: web, signaling, redis, postgres, coturn. Incluye Dockerfile de cada servicio.

## FUNCIONALIDADES

### 1. Landing y acceso
- Landing con propuesta de valor, botón "Empezar a chatear", selector de modo **Video** o **Solo texto**, y campo opcional de **intereses** (tags tipo "gaming, música, viajes").
- **Gate obligatorio antes de conectar:** checkbox de aceptación de Términos + confirmación de ser mayor de 18 años. Sin aceptar, no se conecta. Guardar la aceptación en localStorage con timestamp.
- Páginas estáticas: Términos y Condiciones, Política de Privacidad, Normas de la comunidad (genera borradores razonables marcados como "revisar con abogado").

### 2. Emparejamiento (matchmaking)
- Cola en Redis. Algoritmo: (a) intentar match por intereses en común durante 15 segundos; (b) si no hay, match totalmente aleatorio; (c) nunca emparejar con el mismo usuario de los últimos 3 matches (guardar historial corto por sesión).
- Filtro opcional por país/región (detectado por IP con geoip-lite, seleccionable por el usuario).
- Estados visibles en UI: "Buscando pareja…", "Conectando…", "Conectado", "El desconocido se ha desconectado".
- Botones: **Siguiente** (corta y busca otro match al instante), **Detener** (vuelve a la landing). En móvil, gesto de deslizar para "Siguiente".

### 3. Sala de chat
- Layout: video remoto grande, video local en esquina (arrastrable en escritorio), panel de chat de texto superpuesto o lateral según viewport.
- Chat de texto por Socket.IO (no por data channel, para poder moderarlo en servidor): indicador "está escribiendo…", timestamps, autoscroll.
- Controles: silenciar micro, apagar cámara, pantalla completa, botón **Denunciar** siempre visible.
- Modo "Solo texto": misma lógica sin flujo de video.
- Reconexión automática de socket con backoff; si el peer WebRTC se cae, mostrar estado y ofrecer "Siguiente".

### 4. Moderación y seguridad (parte central, no opcional)
- **Denuncias:** al pulsar Denunciar, capturar 1 frame del video remoto (canvas), motivo seleccionable (desnudez, menor de edad, acoso, spam, otro) y enviarlo al backend. Guardar en PostgreSQL con IDs de sesión de ambos usuarios.
- **Detección automática:** en el cliente, muestrear el video local cada 5–10 s con NSFWJS. Si supera el umbral: primer aviso en pantalla; reincidencia → desconexión y ban temporal.
- **Baneos:** por combinación de IP (hasheada) + fingerprint de navegador (fingerprintjs). Escalado: 15 min → 24 h → 7 días → permanente. Lista en Redis con TTL; permanentes en PostgreSQL. Pantalla de "Has sido suspendido" con motivo y duración.
- **Filtro de texto:** lista configurable de términos prohibidos en servidor; bloquear envío de datos personales obvios (patrones de teléfono, email) con aviso educativo.
- **Panel de administración** en /admin (login con contraseña por variable de entorno, sesión JWT): cola de denuncias con frame capturado, acciones banear/descartar, lista de baneos activos, métricas básicas (usuarios conectados, matches/hora, denuncias/hora).
- **Rate limiting:** por IP en señalización (máx. matches por minuto, máx. mensajes por segundo) para frenar spam y bots.
- Todo el tráfico bajo HTTPS/WSS; WebRTC ya cifra los medios (DTLS-SRTP) — no almacenar nunca video, solo frames de denuncia.

### 5. Requisitos no funcionales
- Latencia de emparejamiento < 2 s con usuarios disponibles.
- Mobile-first, probado en Chrome/Safari iOS y Android (ojo: permisos de cámara y autoplay en iOS requieren playsInline y interacción del usuario).
- Accesibilidad básica (focus visible, aria-labels en controles).
- Sin dependencia de servicios de pago externos en el MVP.
- Código en TypeScript estricto, comentado en español, con README de instalación paso a paso.

## FLUJO WEBRTC (implementar exactamente así)

1. Cliente A y B reciben `match_found` con `roomId` por Socket.IO.
2. El servidor designa a A como *initiator*. A crea la offer, la envía por el socket (`signal` → relay del servidor → B).
3. B responde con answer; ambos intercambian candidatos ICE por el mismo canal.
4. Fallback a TURN si falla la conexión directa. Timeout de 10 s → error y re-match automático.
5. Al pulsar "Siguiente" o cerrar pestaña: cerrar RTCPeerConnection, notificar al peer, limpiar la sala en Redis y devolver a ambos a la cola (al que pulsó, inmediatamente; al otro, con aviso).

## FASES DE ENTREGA

- **Fase 1:** estructura del monorepo, docker-compose, servidor de señalización con matchmaking aleatorio básico y chat de texto funcionando entre 2 pestañas.
- **Fase 2:** WebRTC completo (video/audio), botón Siguiente, estados de conexión, UI de la sala.
- **Fase 3:** intereses, filtro por país, modo solo texto, pulido móvil.
- **Fase 4:** todo el bloque de moderación: denuncias, NSFWJS, baneos, panel admin, rate limiting.
- **Fase 5:** landing, páginas legales, gate 18+, README y guía de despliegue en un VPS.

## CRITERIOS DE ACEPTACIÓN

- Dos pestañas del navegador se emparejan y se ven/escuchan en < 5 s en red local.
- "Siguiente" nunca reconecta con el match inmediatamente anterior.
- Una denuncia aparece en el panel admin con su frame en < 3 s.
- Un usuario baneado no puede reconectar cambiando de pestaña (fingerprint) durante el periodo del ban.
- La app funciona en un móvil real accediendo por HTTPS.

## REGLAS DE TRABAJO

- No inventes APIs: si algo requiere una clave o servicio externo, decláralo en `.env.example` y documenta cómo obtenerlo.
- Tras cada fase, entrega: árbol de archivos, instrucciones para probar y lista de deuda técnica pendiente.
- Si una decisión de arquitectura tiene alternativas relevantes (p. ej., SFU tipo mediasoup vs P2P puro), explica el trade-off en 3 líneas y elige la más simple para el MVP.
