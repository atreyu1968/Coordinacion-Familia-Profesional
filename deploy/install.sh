#!/usr/bin/env bash
# ===========================================================================
# Coordina ADG — one-shot installer for a bare Ubuntu server.
#
# Installs and configures everything needed to run the app in production:
#   system packages, Node.js 24, pnpm, PostgreSQL, the app build, database
#   schema, the first admin account, nginx (reverse proxy) and a systemd
#   service. Safe to re-run (idempotent).
#
# Usage (from the cloned repo root):
#   sudo bash deploy/install.sh
#
# Non-interactive: pre-set any of the variables below as environment vars, e.g.
#   sudo DOMAIN=adg.example.org ADMIN_EMAIL=admin@example.org \
#        ADMIN_PASSWORD='S3cret!' LETSENCRYPT_EMAIL=you@example.org \
#        bash deploy/install.sh
# ===========================================================================
set -euo pipefail

# --- must run as root ------------------------------------------------------
if [[ "${EUID}" -ne 0 ]]; then
  echo "This installer must run as root. Try: sudo bash deploy/install.sh" >&2
  exit 1
fi

# --- locate the repository -------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${APP_DIR}"

# The non-root user who will own the app and run the service.
SERVICE_USER="${SERVICE_USER:-${SUDO_USER:-root}}"

# --- configuration (overridable via env) -----------------------------------
DOMAIN="${DOMAIN:-_}"                       # nginx server_name; "_" = any host/IP
API_PORT="${API_PORT:-3001}"               # internal Node port (nginx proxies it)
DB_NAME="${DB_NAME:-coordina_adg}"
DB_USER="${DB_USER:-coordina_adg}"
LOCAL_STORAGE_DIR="${LOCAL_STORAGE_DIR:-/var/lib/coordina-adg/storage}"
NODE_MAJOR="${NODE_MAJOR:-24}"
PNPM_VERSION="${PNPM_VERSION:-10.26.1}"
ADMIN_NAME="${ADMIN_NAME:-Administrador}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"  # set + real DOMAIN to enable HTTPS

ENV_FILE="${APP_DIR}/.env"

# Read a value from the existing .env so reruns preserve generated secrets and
# optional settings instead of wiping them (keeps the installer idempotent).
env_get() {
  [[ -f "${ENV_FILE}" ]] || return 0
  grep "^$1=" "${ENV_FILE}" | head -n1 | cut -d= -f2-
}

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }

is_tty() { [[ -t 0 ]]; }

# Prompt for a value with a default (only when interactive and unset).
prompt_default() {
  local var="$1" message="$2" default="$3" current
  current="${!var:-}"
  if [[ -n "${current}" ]]; then return; fi
  if is_tty; then
    read -r -p "${message} [${default}]: " current || true
  fi
  printf -v "${var}" '%s' "${current:-${default}}"
}

# Prompt for a secret (no echo).
prompt_secret() {
  local var="$1" message="$2" current
  current="${!var:-}"
  if [[ -n "${current}" ]]; then return; fi
  if is_tty; then
    read -r -s -p "${message}: " current || true
    echo
  fi
  printf -v "${var}" '%s' "${current}"
}

# ---------------------------------------------------------------------------
log "Gathering configuration"
prompt_default DOMAIN "Domain or IP for the site (use _ for any)" "${DOMAIN}"
prompt_default ADMIN_EMAIL "Email for the first administrator" "${ADMIN_EMAIL:-admin@${DOMAIN/_/localhost}}"
prompt_secret  ADMIN_PASSWORD "Password for the first administrator"
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  echo "ADMIN_PASSWORD is required (set it via env for non-interactive installs)." >&2
  exit 1
fi
note "App directory : ${APP_DIR}"
note "Service user  : ${SERVICE_USER}"
note "Domain        : ${DOMAIN}"
note "API port      : ${API_PORT}"
note "Storage dir   : ${LOCAL_STORAGE_DIR}"

# ---------------------------------------------------------------------------
log "Installing system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git build-essential openssl \
  nginx postgresql postgresql-contrib

# ---------------------------------------------------------------------------
log "Installing Node.js ${NODE_MAJOR} and pnpm"
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  CURRENT_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [[ "${CURRENT_MAJOR}" -ge "${NODE_MAJOR}" ]] && NEED_NODE=0
fi
if [[ "${NEED_NODE}" -eq 1 ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi
corepack enable
corepack prepare "pnpm@${PNPM_VERSION}" --activate
NODE_BIN="$(command -v node)"
note "node $(node -v) / pnpm $(pnpm -v)"

# ---------------------------------------------------------------------------
log "Configuring PostgreSQL"
systemctl enable --now postgresql
# Reuse the existing DB password on reruns; only generate one on first install.
if [[ -z "${DB_PASSWORD:-}" ]]; then
  EXISTING_DB_URL="$(env_get DATABASE_URL)"
  if [[ "${EXISTING_DB_URL}" =~ ://[^:]+:([^@]+)@ ]]; then
    DB_PASSWORD="${BASH_REMATCH[1]}"
  else
    DB_PASSWORD="$(openssl rand -hex 16)"
  fi
fi
# Create role (idempotent).
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -c "ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';" >/dev/null
else
  sudo -u postgres psql -c "CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';" >/dev/null
fi
# Create database (idempotent).
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
fi
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5432/${DB_NAME}"

# ---------------------------------------------------------------------------
log "Writing environment file (${ENV_FILE})"
if [[ -z "${JWT_SECRET:-}" ]]; then
  if [[ -f "${ENV_FILE}" ]] && grep -q '^JWT_SECRET=' "${ENV_FILE}"; then
    JWT_SECRET="$(grep '^JWT_SECRET=' "${ENV_FILE}" | head -n1 | cut -d= -f2-)"
  else
    JWT_SECRET="$(openssl rand -hex 32)"
  fi
fi
# Preserve optional integration settings across reruns unless overridden by env.
PUBLIC_APP_URL="${PUBLIC_APP_URL:-$(env_get PUBLIC_APP_URL)}"
JAAS_APP_ID="${JAAS_APP_ID:-$(env_get JAAS_APP_ID)}"
JAAS_KID="${JAAS_KID:-$(env_get JAAS_KID)}"
JAAS_PRIVATE_KEY="${JAAS_PRIVATE_KEY:-$(env_get JAAS_PRIVATE_KEY)}"
RESEND_API_KEY="${RESEND_API_KEY:-$(env_get RESEND_API_KEY)}"
RESEND_FROM="${RESEND_FROM:-$(env_get RESEND_FROM)}"
umask 077
cat > "${ENV_FILE}" <<EOF
NODE_ENV=production
PORT=${API_PORT}
DATABASE_URL=${DATABASE_URL}
JWT_SECRET=${JWT_SECRET}
LOG_LEVEL=info
STORAGE_DRIVER=local
LOCAL_STORAGE_DIR=${LOCAL_STORAGE_DIR}
PUBLIC_APP_URL=
# Optional JaaS video (single-line PEM with \\n). Leave blank to use meet.jit.si.
JAAS_APP_ID=${JAAS_APP_ID:-}
JAAS_KID=${JAAS_KID:-}
JAAS_PRIVATE_KEY=${JAAS_PRIVATE_KEY:-}
# Optional email (Resend) for password resets.
RESEND_API_KEY=${RESEND_API_KEY:-}
RESEND_FROM=${RESEND_FROM:-}
EOF
umask 022
chown "${SERVICE_USER}:${SERVICE_USER}" "${ENV_FILE}" 2>/dev/null || true

# Storage directory, owned by the service user.
mkdir -p "${LOCAL_STORAGE_DIR}/private" "${LOCAL_STORAGE_DIR}/public"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${LOCAL_STORAGE_DIR}" 2>/dev/null || true

# ---------------------------------------------------------------------------
log "Installing dependencies and building (this can take a few minutes)"
run_as_user() {
  if [[ "${SERVICE_USER}" == "root" ]]; then
    bash -lc "$*"
  else
    sudo -u "${SERVICE_USER}" -H bash -lc "$*"
  fi
}
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}" 2>/dev/null || true

run_as_user "cd '${APP_DIR}' && corepack prepare pnpm@${PNPM_VERSION} --activate >/dev/null 2>&1 || true"
run_as_user "cd '${APP_DIR}' && pnpm install --frozen-lockfile"

# Web build needs PORT (vite requirement, dummy here) and BASE_PATH=/ (root).
run_as_user "cd '${APP_DIR}' && PORT=5173 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/web run build"
# API build.
run_as_user "cd '${APP_DIR}' && pnpm --filter @workspace/api-server run build"

# Fail early if the web build didn't produce the entry point nginx will serve.
if [[ ! -f "${APP_DIR}/artifacts/web/dist/public/index.html" ]]; then
  echo "ERROR: web build did not produce artifacts/web/dist/public/index.html" >&2
  echo "       Check the build output above and re-run the installer." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
log "Applying database schema"
run_as_user "cd '${APP_DIR}' && DATABASE_URL='${DATABASE_URL}' pnpm --filter @workspace/db run push"

# ---------------------------------------------------------------------------
log "Creating the first administrator (if needed)"
run_as_user "cd '${APP_DIR}' && DATABASE_URL='${DATABASE_URL}' \
  SEED_ADMIN_EMAIL='${ADMIN_EMAIL}' SEED_ADMIN_PASSWORD='${ADMIN_PASSWORD}' \
  SEED_ADMIN_NAME='${ADMIN_NAME}' pnpm --filter @workspace/scripts run seed-admin"

# ---------------------------------------------------------------------------
log "Configuring the systemd service"
SERVICE_FILE="/etc/systemd/system/coordina-adg.service"
sed -e "s|__SERVICE_USER__|${SERVICE_USER}|g" \
    -e "s|__APP_DIR__|${APP_DIR}|g" \
    -e "s|__NODE_BIN__|${NODE_BIN}|g" \
    "${SCRIPT_DIR}/coordina-adg.service.template" > "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable coordina-adg.service
systemctl restart coordina-adg.service

# ---------------------------------------------------------------------------
log "Configuring nginx"
# Serve the web from a standard location nginx can always read. Serving directly
# from the clone (e.g. /root/... or /home/user/...) fails because those home
# directories are not traversable by www-data, producing a site-wide 500.
WEB_ROOT="/var/www/coordina-adg"
mkdir -p "${WEB_ROOT}"
rm -rf "${WEB_ROOT:?}/"*
cp -a "${APP_DIR}/artifacts/web/dist/public/." "${WEB_ROOT}/"
chown -R www-data:www-data "${WEB_ROOT}"
# Map needed for WebSocket (Socket.io) upgrades — http-level, set once.
cat > /etc/nginx/conf.d/coordina-adg-upgrade.conf <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
EOF
sed -e "s|__SERVER_NAME__|${DOMAIN}|g" \
    -e "s|__WEB_ROOT__|${WEB_ROOT}|g" \
    -e "s|__API_PORT__|${API_PORT}|g" \
    "${SCRIPT_DIR}/nginx-site.conf.template" > /etc/nginx/sites-available/coordina-adg
ln -sf /etc/nginx/sites-available/coordina-adg /etc/nginx/sites-enabled/coordina-adg
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl restart nginx

# ---------------------------------------------------------------------------
if [[ -n "${LETSENCRYPT_EMAIL}" && "${DOMAIN}" != "_" && ! "${DOMAIN}" =~ ^[0-9.]+$ ]]; then
  log "Requesting HTTPS certificate via Let's Encrypt"
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${LETSENCRYPT_EMAIL}" --redirect || \
    note "certbot failed — the site still works over HTTP. Re-run certbot once DNS points here."
fi

# ---------------------------------------------------------------------------
log "Done!"
SCHEME="http"
[[ -n "${LETSENCRYPT_EMAIL}" && "${DOMAIN}" != "_" ]] && SCHEME="https"
HOST_SHOWN="${DOMAIN}"
[[ "${DOMAIN}" == "_" ]] && HOST_SHOWN="<server-ip>"
note "Open:    ${SCHEME}://${HOST_SHOWN}/"
note "Login:   ${ADMIN_EMAIL}"
note "Service: systemctl status coordina-adg   |  journalctl -u coordina-adg -f"
note "Update:  sudo bash deploy/update.sh"
