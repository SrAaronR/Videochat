# Videochat aleatorio (tipo Omegle/Uhmegle)

Plataforma web de videochat y chat de texto aleatorio 1 contra 1, con
moderación integrada. Especificación completa en
[`prompt-clon-videochat.md`](./prompt-clon-videochat.md).

**Estado actual: MVP completo (Fases 1-5)** —
señalización + matchmaking (intereses, país, anti-repetición), WebRTC
completo con TURN de respaldo, modo solo texto, moderación completa
(denuncias con frame, detector NSFW, baneos escalados, filtro de texto,
panel `/admin`, rate limiting), landing con gate 18+/Términos, páginas
legales y [guía de despliegue en VPS](docs/despliegue-vps.md).

## Estructura del monorepo

```
.
├── apps/
│   ├── web/                  # Frontend Next.js 14 (App Router) + Tailwind
│   │   ├── app/
│   │   │   ├── page.tsx      # Landing: propuesta de valor + gate 18+ + criterios
│   │   │   ├── chat/page.tsx # Sala (video o solo texto) + swipe móvil
│   │   │   ├── admin/page.tsx# Panel de moderación (denuncias/baneos/métricas)
│   │   │   ├── terminos/ · privacidad/ · normas/   # Páginas legales (borrador)
│   │   ├── components/PanelChat.tsx · PaginaLegal.tsx
│   │   ├── lib/webrtc.ts     # Servidores ICE (STUN/TURN) y restricciones
│   │   ├── lib/paises.ts     # Lista de países del filtro
│   │   ├── lib/identidad.ts  # Fingerprint del navegador (FingerprintJS)
│   │   ├── lib/moderacion.ts # Captura de frames + muestreo NSFW (tfjs)
│   │   ├── lib/aceptacion.ts # Gate 18+/Términos en localStorage
│   │   ├── public/modelos/nsfw/  # Modelo NSFWJS mobilenet_v2 (MIT, 2,7 MB)
│   │   └── Dockerfile
│   └── signaling/            # Node + Socket.IO + Redis + Prisma
│       ├── src/index.ts      # Matchmaking, chat moderado, relay `signal`
│       ├── src/moderacion.ts # Baneos, strikes, filtros, rate limit, métricas
│       ├── src/admin.ts      # API del panel (JWT)
│       ├── prisma/           # Esquema y migraciones (Denuncia, Ban)
│       └── Dockerfile
├── packages/
│   └── shared/               # Contrato de eventos Socket.IO (TypeScript)
├── docker/
│   └── coturn/turnserver.conf.example
├── deploy/Caddyfile.example  # Proxy inverso HTTPS para producción
├── docs/despliegue-vps.md    # Guía paso a paso de despliegue con HTTPS/WSS
├── docker-compose.yml        # web + signaling + redis + postgres + coturn
├── .env.example
└── package.json              # npm workspaces
```

## Requisitos

- Node.js ≥ 20 y npm ≥ 10 (para desarrollo local), o
- Docker + Docker Compose (para levantar todo el stack).

## Cómo probar

### Opción A: con Docker Compose

```bash
cp .env.example .env          # ajusta las contraseñas si quieres
docker compose up --build
```

Abre **http://localhost:3000** en DOS pestañas del navegador, pulsa
"Empezar a chatear" en ambas: se emparejan y pueden chatear por texto.

### Opción B: desarrollo local sin Docker

```bash
npm install

# Necesitas Redis y PostgreSQL locales. Con Docker:
docker run --rm -p 6379:6379 redis:7-alpine
docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=videochat postgres:16-alpine

# Crea las tablas de moderación (una vez):
cd apps/signaling
DATABASE_URL='postgresql://postgres:videochat@localhost:5432/postgres' npx prisma migrate dev
cd ../..

# Arranca signaling (puerto 4000) y web (puerto 3000) en paralelo
# (exporta antes DATABASE_URL, ADMIN_PASSWORD y HASH_SALT — ver .env.example):
npm run dev
```

Abre **http://localhost:3000** en dos pestañas y entra al chat en ambas.

> Nota: el navegador solo permite cámara/micrófono en `http://localhost` o
> bajo HTTPS. Para probar desde un móvil u otra máquina necesitas HTTPS
> (guía de despliegue en la Fase 5). Para probar en una sola máquina con
> dos pestañas, `localhost` es suficiente.

### Despliegue en producción

Para publicarla en un VPS con dominio, HTTPS/WSS y TURN operativo (y poder
probarla desde un móvil real), sigue la guía paso a paso:
[**docs/despliegue-vps.md**](docs/despliegue-vps.md).

### Qué comprobar

**Landing, gate 18+ y páginas legales (Fase 5):**

0. La landing muestra la propuesta de valor y NO deja entrar sin marcar la
   casilla de 18+ y aceptación de Términos (aviso en rojo). El acceso
   directo a `/chat` sin aceptación muestra el gate "Antes de continuar" y
   no abre ninguna conexión con el servidor. La aceptación se guarda en
   localStorage con timestamp y versión de los términos; las páginas
   `/terminos`, `/privacidad` y `/normas` son borradores marcados como
   "revisar con abogado" y están enlazadas en el footer.

**Matchmaking (Fase 3):**

1. La landing permite elegir modo (Video / Solo texto), intereses separados
   por comas y país del desconocido; las preferencias se recuerdan.
2. Intereses: si dos pestañas comparten un interés se emparejan al instante
   y ven el chip `#interés` en común; si no comparten ninguno, esperan hasta
   15 s y entonces se emparejan aleatoriamente (ajustable con
   `VENTANA_INTERESES_MS` para probar más rápido).
3. Anti-repetición: tras "Siguiente" las dos mismas pestañas NO vuelven a
   emparejarse entre sí (últimos 3 matches). Con solo 2 usuarios ambas se
   quedan en "Buscando pareja…": recarga una pestaña (sesión nueva) para
   que vuelvan a casar.
4. Filtro de país: en localhost GeoIP no resuelve la IP; arranca el
   signaling con `PAIS_POR_DEFECTO=ES` para simular país y probar el filtro.
5. Modo "Solo texto": no pide cámara; misma cola (separada de la de video),
   chat completo y botón Denunciar.
6. En móvil, deslizar horizontalmente sobre el video (o la sala de texto)
   equivale a "Siguiente".

**Videollamada (Fase 2):**

7. Al entrar en `/chat` en modo video el navegador pide cámara y micrófono
   (denegarlos muestra pantalla de error con "Reintentar").
8. Dos pestañas se ven y escuchan en menos de 5 s (con dos pestañas del
   mismo equipo el audio se acopla: silencia el micro).
9. El video local aparece en la esquina y se puede arrastrar (escritorio).
10. El chat funciona durante la llamada: hora, autoscroll y "está escribiendo…".
11. Cerrar una pestaña: la otra lo detecta, avisa y vuelve a buscar.
12. Si el WebRTC no se establece en 10 s, se descarta el match y se busca
    otra persona automáticamente.
13. "Detener" vuelve a la landing y te saca de la cola.
14. Salud del signaling: `curl http://localhost:4000/health` → `{"ok":true}`.

**Moderación (Fase 4):**

15. Denuncia: pulsa 🚩, elige motivo → verás "Denuncia enviada". Entra en
    **http://localhost:3000/admin** con `ADMIN_PASSWORD`: la denuncia
    aparece en la cola con la captura del video del denunciado en < 3 s.
16. Banear desde el panel: el denunciado ve al instante "Has sido
    suspendido" con motivo y duración, y NO puede volver a entrar ni
    abriendo otra pestaña (mismo fingerprint) ni cambiando de red durante
    el ban (IP hasheada). Escalado: 15 min → 24 h → 7 días → permanente.
    Desde la pestaña "Baneos" puedes levantarlo.
17. Filtro de texto: intenta enviar un email o un teléfono en el chat: el
    mensaje se bloquea con un aviso educativo y no le llega al otro.
    Los términos de `TERMINOS_PROHIBIDOS` también se bloquean.
18. Rate limiting: más de `RATE_MENSAJES_POR_SEGUNDO` mensajes por segundo
    o más de `RATE_MATCHES_POR_MINUTO` búsquedas por minuto → aviso y se
    ignoran los excesos.
19. Detector NSFW: muestrea tu video local cada 7 s con el modelo
    autoalojado. Al primer positivo verás el aviso amarillo; al segundo en
    una hora, expulsión con ban temporal y denuncia automática con frame en
    el panel. (Con la cámara falsa de pruebas no se dispara; se verificó
    inyectando un clasificador de prueba.)
20. Métricas en el panel: usuarios conectados, tamaño de las colas,
    matches y denuncias por hora.

## Variables de entorno

Documentadas en [`.env.example`](./.env.example). Las relevantes en Fase 1:

| Variable | Descripción |
| --- | --- |
| `NEXT_PUBLIC_SIGNALING_URL` | URL del signaling vista desde el navegador (se incrusta en build). |
| `NEXT_PUBLIC_STUN_URLS` | Lista de STUN separada por comas (Google por defecto). |
| `NEXT_PUBLIC_TURN_URL` / `_USERNAME` / `_PASSWORD` | TURN de respaldo (el coturn de compose). |
| `TURN_*` | Credenciales del servicio coturn en docker-compose. |
| `CORS_ORIGIN` | Orígenes permitidos en el signaling, separados por comas. |
| `REDIS_URL` | Conexión a Redis del signaling (solo dev sin Docker). |
| `PAIS_POR_DEFECTO` | País asumido si GeoIP no resuelve (solo desarrollo). |
| `VENTANA_INTERESES_MS` | Ventana de match por intereses (15000 por defecto). |
| `POSTGRES_*`, `DATABASE_URL` | PostgreSQL: denuncias y baneos (Prisma). |
| `ADMIN_PASSWORD`, `ADMIN_JWT_SECRET` | Acceso y sesión del panel `/admin`. |
| `HASH_SALT` | Sal del hash de IPs (nunca se guarda la IP en claro). |
| `TERMINOS_PROHIBIDOS` | Términos bloqueados en el chat, separados por comas. |
| `RATE_*` | Límites por IP: búsquedas/min, mensajes/s, denuncias/min. |
| `NEXT_PUBLIC_NSFW_*` | Umbral, intervalo y URL del modelo del detector NSFW. |

## Decisiones de arquitectura

- **P2P puro vs SFU (mediasoup):** para 1v1 el P2P es más simple, más barato
  (el servidor no procesa media) y con menor latencia; un SFU solo compensa
  con 3+ participantes o grabación. Elegimos **P2P + TURN de respaldo**.
- **Chat por Socket.IO y no por data channel:** el servidor debe ver los
  mensajes para poder moderarlos (filtros y baneos de la Fase 4).
- **Cola de emparejamiento en Redis (un hash por modo, reclamo con `HDEL`
  atómico):** el paso de emparejamiento (inmediato al encolar + periódico
  cada 2 s) aplica las reglas de la spec: intereses en común durante 15 s,
  luego aleatorio; nunca los últimos 3 matches; filtro de país en ambos
  sentidos. El reclamo atómico evita dobles emparejamientos concurrentes.

## Deuda técnica pendiente (declarada)

- Las **salas activas y el historial de matches viven en memoria** del
  signaling: solo se soporta una instancia. Para escalar: moverlos a Redis
  + `@socket.io/redis-adapter`.
- Con poblaciones muy pequeñas (2-3 usuarios) la anti-repetición puede
  dejar a todos esperando tras "Siguiente" (comportamiento exigido por la
  spec: nunca repetir los últimos 3). Valorar relajarla si la cola supera
  cierto tiempo de espera.
- La detección GeoIP usa la base de datos embebida de `geoip-lite` (se
  actualiza reinstalando el paquete) y confía en `x-forwarded-for` sin
  validar el proxy; en producción, fijar `trust proxy` correctamente.
- Las **credenciales TURN son estáticas** y viajan en el bundle del cliente;
  en producción deben ser efímeras (REST API de coturn, `use-auth-secret`)
  servidas desde el backend.
- El **detector NSFW corre solo en el cliente** (puede desactivarlo un
  usuario malicioso con devtools): el evento `nsfw_alerta` cumple el rol de
  "verificación en servidor" guardando la evidencia y decidiendo el ban,
  pero falta re-clasificar el frame en servidor (tfjs-node) para no confiar
  en el veredicto del cliente.
- Los **frames de denuncia se guardan en PostgreSQL** (bytea); con volumen
  real conviene moverlos a almacenamiento de objetos con caducidad.
- El filtro de términos es un `includes` simple: no detecta evasiones
  (l33t, espacios); valorar una librería de normalización.
- El fingerprint es la versión open-source de FingerprintJS (colisiones
  posibles entre navegadores idénticos; suficiente para MVP).
- El signaling se ejecuta con `tsx` en producción; migrar a build con `tsc`
  cuando el proyecto se estabilice.
- Sin renegociación WebRTC (p. ej. cambiar de cámara a mitad de llamada):
  cada match crea una conexión nueva.
- Los **textos legales son borradores** generados para el MVP: deben
  revisarse con un abogado antes del lanzamiento (protección de datos,
  menores, jurisdicción y correo de contacto pendientes).
- El gate 18+ es declarativo (checkbox): la verificación de edad robusta
  queda fuera del alcance del MVP.
- Sin tests automatizados en el repo (las Fases 1-5 se verificaron con
  pruebas E2E de Socket.IO y de navegador con media falsa); añadir
  Vitest + Playwright.
