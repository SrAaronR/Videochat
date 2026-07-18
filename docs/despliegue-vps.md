# Guía de despliegue en un VPS (HTTPS + WSS + TURN)

Objetivo: dejar la plataforma funcionando en un VPS con dominio propio,
accesible desde móviles reales (los navegadores solo dan acceso a la
cámara bajo HTTPS).

## Opción rápida: script automático (~10 minutos)

Con el DNS del paso 1 ya configurado, en el VPS (como root):

```bash
git clone <URL_DEL_REPO> videochat && cd videochat
sudo bash deploy/instalar-vps.sh tudominio.com
```

El script instala Docker si falta, genera todas las contraseñas (quedan en
`.env`, incluida la del panel de admin, que imprime al final), escribe el
Caddyfile con tus dominios, abre el firewall y levanta todo con
`docker-compose.prod.yml` (Caddy + HTTPS automático + coturn con IP
pública). Al terminar: `https://app.tudominio.com`.

El resto de esta guía explica los mismos pasos a mano, por si prefieres
controlarlos uno a uno o algo falla.

## 0. Qué necesitas

- Un VPS con Ubuntu 22.04/24.04, 2 GB de RAM o más, con IP pública.
- Un dominio (ejemplos abajo con `tudominio.com`).
- Docker y Docker Compose en el VPS:
  `curl -fsSL https://get.docker.com | sh`

## 1. DNS

Crea dos registros A apuntando a la IP pública del VPS:

| Registro | Tipo | Valor |
| --- | --- | --- |
| `app.tudominio.com` | A | IP del VPS |
| `senal.tudominio.com` | A | IP del VPS |
| `turn.tudominio.com` | A | IP del VPS |

(`app` sirve la web, `senal` el Socket.IO/WSS y `turn` el coturn.)

## 2. Clonar y configurar

```bash
git clone <URL_DEL_REPO> videochat && cd videochat
cp .env.example .env
```

Edita `.env` con valores de producción:

```bash
# Contraseñas FUERTES y distintas (genera con: openssl rand -hex 24)
POSTGRES_PASSWORD=...
ADMIN_PASSWORD=...
ADMIN_JWT_SECRET=...
HASH_SALT=...
TURN_PASSWORD=...

# URLs vistas desde el navegador (¡https!)
NEXT_PUBLIC_SIGNALING_URL=https://senal.tudominio.com
CORS_ORIGIN=https://app.tudominio.com

# TURN propio
TURN_REALM=turn.tudominio.com
NEXT_PUBLIC_TURN_URL=turn:turn.tudominio.com:3478
NEXT_PUBLIC_TURN_USERNAME=videochat
NEXT_PUBLIC_TURN_PASSWORD=<el mismo TURN_PASSWORD>

# Producción: sin país por defecto (GeoIP real) y ventana estándar
PAIS_POR_DEFECTO=
VENTANA_INTERESES_MS=15000
```

> Las variables `NEXT_PUBLIC_*` se INCRUSTAN en el build de la web: si las
> cambias, ejecuta `docker compose build web` de nuevo.

## 3. Proxy inverso con HTTPS automático (Caddy)

Todo esto ya está preparado en
[`docker-compose.prod.yml`](../docker-compose.prod.yml): añade el servicio
Caddy (que emite y renueva los certificados de Let's Encrypt solo), deja
`web` y `signaling` accesibles únicamente desde localhost y añade la IP
pública al coturn. Solo necesitas el Caddyfile con tus dominios: copia
[`deploy/Caddyfile.example`](../deploy/Caddyfile.example) a
`deploy/Caddyfile` y sustituye `tudominio.com`.

## 4. coturn en producción

`docker-compose.prod.yml` pasa `--external-ip=${TURN_EXTERNAL_IP}` al
coturn: pon la IP pública del VPS en esa variable del `.env`.
Para TURN sobre TLS (5349, recomendado porque algunos firewalls corporativos
solo dejan salir TLS), monta los certificados que Caddy guarda en su volumen
o usa certbot aparte — ver `docker/coturn/turnserver.conf.example`.

## 5. Firewall (ufw)

```bash
ufw allow 22/tcp        # SSH
ufw allow 80,443/tcp    # web + certificados
ufw allow 3478/tcp      # TURN
ufw allow 3478/udp      # TURN
ufw allow 49160:49200/udp  # relays de medios TURN
ufw enable
```

## 6. Arrancar

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f signaling
# debe aplicar migraciones y escuchar en :4000
```

Comprobaciones:

```bash
curl https://senal.tudominio.com/health   # → {"ok":true}
curl -I https://app.tudominio.com         # → 200
```

## 7. Prueba desde un móvil real (criterio de aceptación)

1. Abre `https://app.tudominio.com` en el móvil (Chrome Android o Safari iOS).
2. Marca el gate 18+, pulsa "Empezar a chatear" y concede cámara/micro
   (funciona porque es HTTPS; en iOS el video usa `playsInline`).
3. Abre otra pestaña/dispositivo: deben verse y escucharse en < 5 s.
4. Prueba el gesto de deslizar horizontalmente → "Siguiente".
5. Panel de moderación: `https://app.tudominio.com/admin`.
6. Para verificar que el TURN funciona (usuarios detrás de NAT estrictos):
   en `chrome://webrtc-internals`, en una llamada debe aparecer al menos un
   candidato `relay` cuando la conexión directa no sea posible.

## 8. Operación

- **Logs:** `docker compose logs -f signaling web coturn`
- **Backup de PostgreSQL:**
  `docker compose exec postgres pg_dump -U videochat videochat > backup.sql`
- **Actualizar:** `git pull && docker compose build && docker compose up -d`
- **Métricas rápidas:** pestaña "Métricas" del panel `/admin`.

## Problemas frecuentes

| Síntoma | Causa probable |
| --- | --- |
| La cámara no se pide en el móvil | Estás entrando por HTTP o por IP: usa el dominio con HTTPS. |
| Se emparejan pero no hay video | Puertos UDP del TURN cerrados o `--external-ip` sin configurar. |
| `connect_error` en la web | `CORS_ORIGIN` no coincide con el dominio de la web, o `NEXT_PUBLIC_SIGNALING_URL` quedó incrustada con el valor antiguo (rebuild de `web`). |
| El panel /admin da 503 | Falta `ADMIN_PASSWORD` en `.env`. |
