# Videochat aleatorio (tipo Omegle/Uhmegle)

Plataforma web de videochat y chat de texto aleatorio 1 contra 1, con
moderación integrada. Especificación completa en
[`prompt-clon-videochat.md`](./prompt-clon-videochat.md).

**Estado actual: Fase 2 completada** — WebRTC completo (video + audio P2P
con STUN de Google y TURN de respaldo), botón Siguiente con re-match
automático, estados de conexión, y UI de sala: video remoto grande, video
local arrastrable, chat lateral/inferior y controles (micro, cámara,
pantalla completa, Denunciar).

## Estructura del monorepo

```
.
├── apps/
│   ├── web/                  # Frontend Next.js 14 (App Router) + Tailwind
│   │   ├── app/
│   │   │   ├── page.tsx      # Landing mínima (la completa llega en Fase 5)
│   │   │   └── chat/page.tsx # Sala de videochat (WebRTC + chat de texto)
│   │   ├── components/PanelChat.tsx
│   │   ├── lib/webrtc.ts     # Servidores ICE (STUN/TURN) y restricciones
│   │   └── Dockerfile
│   └── signaling/            # Node + Socket.IO + Redis
│       ├── src/index.ts      # Matchmaking, relay de chat y de `signal`
│       └── Dockerfile
├── packages/
│   └── shared/               # Contrato de eventos Socket.IO (TypeScript)
├── docker/
│   └── coturn/turnserver.conf.example
├── docker-compose.yml        # web + signaling + redis + postgres + coturn
├── .env.example
└── package.json              # npm workspaces
```

## Requisitos

- Node.js ≥ 20 y npm ≥ 10 (para desarrollo local), o
- Docker + Docker Compose (para levantar todo el stack).

## Cómo probar (Fases 1 y 2)

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

# Necesitas un Redis local. Con Docker:
docker run --rm -p 6379:6379 redis:7-alpine
# ...o con el binario del sistema: redis-server

# Arranca signaling (puerto 4000) y web (puerto 3000) en paralelo:
npm run dev
```

Abre **http://localhost:3000** en dos pestañas y entra al chat en ambas.

> Nota: el navegador solo permite cámara/micrófono en `http://localhost` o
> bajo HTTPS. Para probar desde un móvil u otra máquina necesitas HTTPS
> (guía de despliegue en la Fase 5). Para probar en una sola máquina con
> dos pestañas, `localhost` es suficiente.

### Qué comprobar

1. Al entrar en `/chat` el navegador pide cámara y micrófono (denegarlos
   muestra pantalla de error con "Reintentar").
2. La primera pestaña queda en "Buscando pareja…"; al entrar la segunda,
   ambas pasan por "Conectando…" y en menos de 5 s se ven y escuchan
   (con dos pestañas del mismo equipo el audio se acopla: silencia el micro).
3. El video local aparece en la esquina y se puede arrastrar (escritorio).
4. El chat funciona durante la llamada: mensajes con hora, autoscroll y
   "El desconocido está escribiendo…".
5. Controles: silenciar micro, apagar cámara (el recuadro local se atenúa),
   pantalla completa y botón Denunciar (🚩) siempre visible con su diálogo
   de motivos (el envío al backend llega en la Fase 4).
6. "Siguiente" corta la llamada: la otra pestaña ve "El desconocido se ha
   desconectado" y ambas se reemparejan solas en ~2 s con video de nuevo.
7. Cerrar una pestaña: la otra lo detecta, avisa y vuelve a buscar.
8. Si el WebRTC no se establece en 10 s, se descarta el match y se busca
   otra persona automáticamente.
9. "Detener" vuelve a la landing y te saca de la cola.
10. Salud del signaling: `curl http://localhost:4000/health` → `{"ok":true}`.

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
| `POSTGRES_*` | Declaradas para la Fase 4 (postgres levanta pero aún no se usa). |

## Decisiones de arquitectura

- **P2P puro vs SFU (mediasoup):** para 1v1 el P2P es más simple, más barato
  (el servidor no procesa media) y con menor latencia; un SFU solo compensa
  con 3+ participantes o grabación. Elegimos **P2P + TURN de respaldo**.
- **Chat por Socket.IO y no por data channel:** el servidor debe ver los
  mensajes para poder moderarlos (filtros y baneos de la Fase 4).
- **Cola de emparejamiento en Redis (`LPOP`/`RPUSH` atómicos):** evita
  dobles emparejamientos en peticiones concurrentes y deja el terreno
  preparado para intereses y anti-repetición (Fase 3).

## Deuda técnica pendiente (declarada)

- Las **salas activas viven en memoria** del signaling: solo se soporta una
  instancia. Para escalar: salas en Redis + `@socket.io/redis-adapter`.
- Las **credenciales TURN son estáticas** y viajan en el bundle del cliente;
  en producción deben ser efímeras (REST API de coturn, `use-auth-secret`)
  servidas desde el backend.
- El signaling se ejecuta con `tsx` en producción; migrar a build con `tsc`
  cuando el proyecto se estabilice.
- La denuncia (🚩) es solo UI: la captura de frame y el registro en
  PostgreSQL llegan en la Fase 4.
- Sin renegociación WebRTC (p. ej. cambiar de cámara a mitad de llamada):
  cada match crea una conexión nueva.
- Sin anti-repetición de matches (los últimos 3) ni matching por intereses — Fase 3.
- Sin rate limiting, filtro de texto ni baneos — Fase 4.
- Sin gate 18+/Términos ni páginas legales — Fase 5.
- `postgres` levanta en compose pero aún no tiene consumidores.
- Sin tests automatizados en el repo (las Fases 1 y 2 se verificaron con
  pruebas E2E de Socket.IO y de navegador con media falsa); añadir
  Vitest + Playwright.
