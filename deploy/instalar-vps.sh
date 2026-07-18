#!/usr/bin/env bash
# =============================================================================
# Lanzamiento en un VPS en un solo comando.
#
# Requisitos previos (lo único que no puede hacer este script):
#   1. Un VPS Ubuntu 22.04/24.04 con IP pública (2 GB RAM o más).
#   2. Un dominio con TRES registros A apuntando a la IP del VPS:
#        app.tudominio.com   senal.tudominio.com   turn.tudominio.com
#
# Uso (como root, desde la raíz del repositorio clonado):
#   sudo bash deploy/instalar-vps.sh tudominio.com
#
# Qué hace: instala Docker si falta, genera todas las contraseñas y las
# escribe en .env, crea el Caddyfile con tus dominios, abre el firewall,
# construye las imágenes y levanta todo con HTTPS automático.
# =============================================================================
set -euo pipefail

# --- Comprobaciones ----------------------------------------------------------

if [[ $(id -u) -ne 0 ]]; then
  echo "ERROR: ejecuta como root (sudo bash deploy/instalar-vps.sh tudominio.com)" >&2
  exit 1
fi

if [[ ! -f docker-compose.yml || ! -f deploy/instalar-vps.sh ]]; then
  echo "ERROR: ejecuta desde la raíz del repositorio clonado." >&2
  exit 1
fi

DOMINIO_BASE="${1:-}"
if [[ -z "$DOMINIO_BASE" ]]; then
  echo "ERROR: falta el dominio. Uso: sudo bash deploy/instalar-vps.sh tudominio.com" >&2
  exit 1
fi

DOMINIO_WEB="app.${DOMINIO_BASE}"
DOMINIO_SENAL="senal.${DOMINIO_BASE}"
DOMINIO_TURN="turn.${DOMINIO_BASE}"

if [[ -f .env ]]; then
  echo "ERROR: ya existe un .env. Si quieres regenerarlo, muévelo antes:" >&2
  echo "  mv .env .env.backup" >&2
  exit 1
fi

# --- Docker ------------------------------------------------------------------

if ! command -v docker >/dev/null 2>&1; then
  echo "→ Instalando Docker…"
  curl -fsSL https://get.docker.com | sh
fi

# --- IP pública (para coturn) --------------------------------------------------

echo "→ Detectando IP pública…"
IP_PUBLICA=$(curl -4 -fsS --max-time 10 https://ifconfig.me 2>/dev/null || true)
if [[ -z "$IP_PUBLICA" ]]; then
  read -r -p "No se pudo detectar la IP pública. Escríbela: " IP_PUBLICA
fi
echo "  IP pública: ${IP_PUBLICA}"

# --- Secretos y .env -----------------------------------------------------------

echo "→ Generando contraseñas y escribiendo .env…"
gen() { openssl rand -hex "$1"; }
ADMIN_PASSWORD=$(gen 12)
POSTGRES_PASSWORD=$(gen 16)
ADMIN_JWT_SECRET=$(gen 32)
HASH_SALT=$(gen 16)
TURN_PASSWORD=$(gen 12)

cat > .env <<EOF
# Generado por deploy/instalar-vps.sh el $(date -Is)

# --- PostgreSQL ---
POSTGRES_USER=videochat
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=videochat

# --- Moderación ---
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_JWT_SECRET=${ADMIN_JWT_SECRET}
HASH_SALT=${HASH_SALT}
TERMINOS_PROHIBIDOS=
RATE_MATCHES_POR_MINUTO=20
RATE_MENSAJES_POR_SEGUNDO=5
RATE_DENUNCIAS_POR_MINUTO=5
NEXT_PUBLIC_NSFW_UMBRAL=0.7
NEXT_PUBLIC_NSFW_INTERVALO_MS=7000
NEXT_PUBLIC_NSFWJS_MODEL_URL=/modelos/nsfw/model.json

# --- URLs públicas (¡se incrustan en el build de la web!) ---
NEXT_PUBLIC_SIGNALING_URL=https://${DOMINIO_SENAL}
CORS_ORIGIN=https://${DOMINIO_WEB}

# --- TURN ---
TURN_REALM=${DOMINIO_TURN}
TURN_USER=videochat
TURN_PASSWORD=${TURN_PASSWORD}
TURN_EXTERNAL_IP=${IP_PUBLICA}
NEXT_PUBLIC_STUN_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
NEXT_PUBLIC_TURN_URL=turn:${DOMINIO_TURN}:3478
NEXT_PUBLIC_TURN_USERNAME=videochat
NEXT_PUBLIC_TURN_PASSWORD=${TURN_PASSWORD}

# --- Matchmaking (valores de producción) ---
PAIS_POR_DEFECTO=
VENTANA_INTERESES_MS=15000
EOF
chmod 600 .env

# --- Caddyfile -----------------------------------------------------------------

echo "→ Escribiendo deploy/Caddyfile…"
cat > deploy/Caddyfile <<EOF
${DOMINIO_WEB} {
	reverse_proxy web:3000
}

${DOMINIO_SENAL} {
	reverse_proxy signaling:4000
}
EOF

# --- Firewall -------------------------------------------------------------------

if command -v ufw >/dev/null 2>&1; then
  echo "→ Configurando firewall (ufw)…"
  ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 3478/tcp >/dev/null
  ufw allow 3478/udp >/dev/null
  ufw allow 49160:49200/udp >/dev/null
  ufw --force enable >/dev/null
  echo "  Puertos abiertos: 22, 80, 443, 3478/tcp+udp, 49160-49200/udp"
else
  echo "AVISO: ufw no está instalado; abre tú los puertos 80, 443, 3478 y 49160-49200/udp."
fi

# --- Build y arranque ------------------------------------------------------------

echo "→ Construyendo imágenes (esto tarda unos minutos la primera vez)…"
docker compose -f docker-compose.yml -f docker-compose.prod.yml build

echo "→ Levantando servicios…"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

echo
echo "============================================================"
echo " LANZAMIENTO COMPLETADO"
echo "============================================================"
echo
echo "  Web:              https://${DOMINIO_WEB}"
echo "  Panel de admin:   https://${DOMINIO_WEB}/admin"
echo "  Contraseña admin: ${ADMIN_PASSWORD}"
echo
echo "  (Todas las credenciales quedan guardadas en .env)"
echo
echo "Caddy tardará ~1 minuto en emitir los certificados HTTPS la"
echo "primera vez. Comprueba:"
echo "  curl https://${DOMINIO_SENAL}/health   → {\"ok\":true}"
echo
echo "Logs:    docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f"
echo "Parar:   docker compose -f docker-compose.yml -f docker-compose.prod.yml down"
echo "============================================================"
