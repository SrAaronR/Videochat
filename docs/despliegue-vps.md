# Guía de despliegue en un VPS (HTTPS + WSS + TURN)

Objetivo: dejar la plataforma funcionando en un VPS con dominio propio,
accesible desde móviles reales (los navegadores solo dan acceso a la
cámara bajo HTTPS).

## Opción rápida: script automático (~10 minutos)

Con el DNS del paso 1 ya configurado y la clave de Stripe del paso 2.5 a
mano, en el VPS (como root):

```bash
git clone <URL_DEL_REPO> videochat && cd videochat
sudo bash deploy/instalar-vps.sh tudominio.com sk_live_TU_CLAVE_DE_STRIPE
```

El script instala Docker si falta, genera todas las contraseñas (quedan en
`.env`, incluida la del panel de admin, que imprime al final), escribe el
Caddyfile con tus dominios, abre el firewall y levanta todo con
`docker-compose.prod.yml` (Caddy + HTTPS automático + coturn con IP
pública). Al terminar: `https://app.tudominio.com`.

Si omites la clave de Stripe, todo arranca igualmente pero **el chat queda
cerrado**: la verificación de edad "falla cerrada" y el servidor no
empareja a nadie hasta que la configures en `.env` (el propio script te
imprime los pasos al final).

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

# Verificación de edad (OBLIGATORIA — ver paso 2.5)
PROVEEDOR_EDAD=stripe
AGE_JWT_SECRET=...            # genera con: openssl rand -hex 32
STRIPE_SECRET_KEY=sk_live_...
PERMITIR_VERIFICACION_TEST=   # vacía SIEMPRE en producción
```

> Las variables `NEXT_PUBLIC_*` se INCRUSTAN en el build de la web: si las
> cambias, ejecuta `docker compose build web` de nuevo.

## 2.5. Verificación de edad (Stripe Identity)

El servidor **no empareja a nadie** sin un token de edad emitido tras una
verificación real (diseño "falla cerrada" — ver la sección del README).
Para tenerla operativa:

1. Crea una cuenta en [stripe.com](https://stripe.com) y complétala hasta
   poder operar en vivo (datos de la entidad responsable del servicio).
2. Activa **Identity** en el dashboard (Products → Identity). Stripe cobra
   por verificación realizada; consulta su precio vigente.
3. Copia la clave secreta en vivo (`sk_live_…`) de Developers → API keys y
   ponla en `STRIPE_SECRET_KEY`, con `PROVEEDOR_EDAD=stripe`.
4. Genera un `AGE_JWT_SECRET` propio (`openssl rand -hex 32`). Si lo rotas,
   todos los usuarios tendrán que verificarse de nuevo.

Comprobación rápida tras arrancar (paso 6):

```bash
curl https://senal.tudominio.com/verificacion/estado-proveedor
# → {"proveedor":"stripe","activo":true}
```

Si devuelve `"activo":false`, revisa los logs del signaling: al arrancar
imprime exactamente qué falta (`[verificacion] …`).

> **Nunca uses `PROVEEDOR_EDAD=test` en un servidor público**: ese modo
> SIMULA la verificación (no comprueba ninguna edad) y existe solo para
> desarrollo local. Por eso exige además la variable
> `PERMITIR_VERIFICACION_TEST=si-entiendo-que-no-verifica-edad`.

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
curl https://senal.tudominio.com/verificacion/estado-proveedor
#   → {"proveedor":"stripe","activo":true}  (si no, el chat está cerrado)
```

## 7. Prueba desde un móvil real (criterio de aceptación)

1. Abre `https://app.tudominio.com` en el móvil (Chrome Android o Safari iOS).
2. Marca el gate 18+ y pulsa "Empezar a chatear": la primera vez te llevará
   a `/verificar-edad`. Completa la verificación con Stripe (documento +
   selfie); al confirmar, vuelve sola a la app con el token guardado.
3. Pulsa de nuevo "Empezar a chatear" y concede cámara/micro
   (funciona porque es HTTPS; en iOS el video usa `playsInline`).
4. Abre otra pestaña/dispositivo (también verificado): deben verse y
   escucharse en < 5 s.
5. Prueba el gesto de deslizar horizontalmente → "Siguiente".
6. Panel de moderación: `https://app.tudominio.com/admin`.
7. Para verificar que el TURN funciona (usuarios detrás de NAT estrictos):
   en `chrome://webrtc-internals`, en una llamada debe aparecer al menos un
   candidato `relay` cuando la conexión directa no sea posible.

## 8. Operación

- **Logs:** `docker compose logs -f signaling web coturn`
- **Backup de PostgreSQL:**
  `docker compose exec postgres pg_dump -U videochat videochat > backup.sql`
- **Actualizar:** `git pull && docker compose build && docker compose up -d`
- **Métricas rápidas:** pestaña "Métricas" del panel `/admin`.

> Actualiza siempre así (por SSH, incremental): NO recrees la máquina en
> cada cambio. Recrearla borra la base de datos (denuncias y baneos) y
> repite los certificados de Let's Encrypt, que tienen un límite semanal
> de duplicados por dominio.

### Actualizar un despliegue anterior a la verificación de edad

Si el servidor ya estaba desplegado con una versión sin verificación de
edad, tras el `git pull` añade a su `.env` las variables del paso 2.5
(`PROVEEDOR_EDAD`, `AGE_JWT_SECRET`, `STRIPE_SECRET_KEY`,
`PERMITIR_VERIFICACION_TEST=`) y reconstruye **ambos** servicios — la web
también, porque las páginas de verificación forman parte de su build:

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml build web signaling
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
curl https://senal.tudominio.com/verificacion/estado-proveedor  # → "activo":true
```

Hasta que añadas las variables, el servicio arranca pero nadie puede
emparejarse (falla cerrada): es el comportamiento esperado, no un fallo.

## Problemas frecuentes

| Síntoma | Causa probable |
| --- | --- |
| La cámara no se pide en el móvil | Estás entrando por HTTP o por IP: usa el dominio con HTTPS. |
| Se emparejan pero no hay video | Puertos UDP del TURN cerrados o `--external-ip` sin configurar. |
| `connect_error` en la web | `CORS_ORIGIN` no coincide con el dominio de la web, o `NEXT_PUBLIC_SIGNALING_URL` quedó incrustada con el valor antiguo (rebuild de `web`). |
| El panel /admin da 503 | Falta `ADMIN_PASSWORD` en `.env`. |
| Nadie se empareja y la web redirige a `/verificar-edad` | Es el candado de edad. Si a los usuarios verificados también les pasa, revisa `PROVEEDOR_EDAD`/`AGE_JWT_SECRET` (¿rotado?) y los logs `[verificacion]` del signaling. |
| `/verificar-edad` avisa de que no está configurada | Faltan `PROVEEDOR_EDAD` + `AGE_JWT_SECRET` (+ `STRIPE_SECRET_KEY`) en el `.env` del signaling — ver paso 2.5. |
| Stripe rechaza crear la sesión de verificación | Identity no está activado en la cuenta, o la clave es de test (`sk_test_…`) o está revocada. El error concreto sale en los logs del signaling. |
