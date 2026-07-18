# Videochat aleatorio (tipo Omegle/Uhmegle)

Plataforma web de videochat y chat de texto aleatorio 1 contra 1, con
moderación integrada. Especificación completa en
[`prompt-clon-videochat.md`](./prompt-clon-videochat.md).

**Estado actual: Fase 1 completada** — estructura del monorepo,
docker-compose, servidor de señalización con matchmaking aleatorio básico
(cola en Redis) y chat de texto funcionando entre 2 pestañas.

## Estructura del monorepo

```
.
├── apps/
│   ├── web/                  # Frontend Next.js 14 (App Router) + Tailwind
│   │   ├── app/
│   │   │   ├── page.tsx      # Landing mínima (la completa llega en Fase 5)
│   │   │   └── chat/page.tsx # Sala de chat de texto
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

## Cómo probar la Fase 1

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

### Qué comprobar

1. La primera pestaña muestra "Buscando pareja…" hasta que entra la segunda.
2. Al entrar la segunda, ambas pasan a "Conectado con un desconocido".
3. Los mensajes llegan en ambos sentidos con hora y autoscroll.
4. Al teclear en una pestaña, la otra muestra "El desconocido está escribiendo…".
5. "Siguiente" corta la sala: la otra pestaña ve "El desconocido se ha
   desconectado" y puede pulsar "Buscar otro" para reemparejarse.
6. "Detener" vuelve a la landing y te saca de la cola.
7. Salud del signaling: `curl http://localhost:4000/health` → `{"ok":true}`.

## Variables de entorno

Documentadas en [`.env.example`](./.env.example). Las relevantes en Fase 1:

| Variable | Descripción |
| --- | --- |
| `NEXT_PUBLIC_SIGNALING_URL` | URL del signaling vista desde el navegador (se incrusta en build). |
| `CORS_ORIGIN` | Orígenes permitidos en el signaling, separados por comas. |
| `REDIS_URL` | Conexión a Redis del signaling (solo dev sin Docker). |
| `POSTGRES_*`, `TURN_*` | Declaradas ya para las fases 2 y 4 (postgres y coturn levantan pero aún no se usan). |

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
- El signaling se ejecuta con `tsx` en producción; migrar a build con `tsc`
  cuando el proyecto se estabilice.
- Sin anti-repetición de matches (los últimos 3) ni matching por intereses — Fase 3.
- Sin rate limiting, filtro de texto ni baneos — Fase 4.
- Sin gate 18+/Términos ni páginas legales — Fase 5.
- `postgres` y `coturn` levantan en compose pero aún no tienen consumidores.
- Sin tests automatizados en el repo (la Fase 1 se verificó con pruebas
  E2E manuales de Socket.IO y navegador); añadir Vitest + Playwright.
