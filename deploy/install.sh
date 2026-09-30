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
DOMAIN="${DOMAIN:-}"                        # nginx server_name; prompted below ("_" = any host/IP)
API_PORT="${API_PORT:-3001}"               # internal Node port (nginx proxies it)
DB_NAME="${DB_NAME:-coordina_adg}"
DB_USER="${DB_USER:-coordina_adg}"
LOCAL_STORAGE_DIR="${LOCAL_STORAGE_DIR:-/var/lib/coordina-adg/storage}"
NODE_MAJOR="${NODE_MAJOR:-24}"
PNPM_VERSION="${PNPM_VERSION:-10.26.1}"
ADMIN_NAME="${ADMIN_NAME:-Administrador}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"  # set + real DOMAIN to enable HTTPS
CLOUDFLARE_TUNNEL_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-}"  # optional cloudflared tunnel token

ENV_FILE="${APP_DIR}/.env"
EXPLICIT_DB_PASSWORD="${DB_PASSWORD:-}"

# PostgreSQL folds unquoted names to lower case and truncates names beyond 63
# bytes. Restrict installer-provided identifiers to a safe, portable subset;
# they are still quoted as identifiers when sent to PostgreSQL.
validate_pg_identifier() {
  local label="$1" value="$2"
  if [[ ! "${value}" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]; then
    echo "Invalid ${label}: use 1-63 lowercase letters, digits, or underscores; the first character must be a letter or underscore." >&2
    exit 1
  fi
}
validate_pg_identifier "DB_NAME" "${DB_NAME}"
validate_pg_identifier "DB_USER" "${DB_USER}"

encode_url_component() {
  URL_COMPONENT="$1" node -e \
    'process.stdout.write(encodeURIComponent(process.env.URL_COMPONENT ?? ""))'
}

# Read a value from the existing .env so reruns preserve generated secrets and
# optional settings instead of wiping them (keeps the installer idempotent).
env_get() {
  [[ -f "${ENV_FILE}" ]] || return 0
  grep "^$1=" "${ENV_FILE}" | head -n1 | cut -d= -f2-
}

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }

# Resolve a terminal to read prompts from. When the script is piped to bash
# (e.g. curl ... | sudo bash) stdin is the script itself, not the keyboard, so
# fall back to the controlling terminal /dev/tty. If neither is available we run
# fully non-interactive (values must come from env vars / defaults).
TTY_DEV=""
if [[ -t 0 ]]; then
  TTY_DEV="/dev/stdin"
elif [[ -r /dev/tty ]] && (exec 3</dev/tty) 2>/dev/null; then
  TTY_DEV="/dev/tty"
fi
is_tty() { [[ -n "${TTY_DEV}" ]]; }

# Discard any input already buffered on the terminal before prompting. When the
# install command is pasted as a block (or run via curl | bash), a leftover
# newline can sit in the buffer and get swallowed by the very first prompt —
# silently accepting its default (e.g. DOMAIN="_", which disables HTTPS and skips
# the collaborative space). Flushing first makes the first question actually wait.
drain_tty() {
  is_tty || return 0
  local junk
  while IFS= read -r -t 0.1 junk <"${TTY_DEV}" 2>/dev/null; do :; done
  return 0
}

# Prompt for a value with a default (only when interactive and unset).
prompt_default() {
  local var="$1" message="$2" default="$3" current
  current="${!var:-}"
  if [[ -n "${current}" ]]; then return; fi
  if is_tty; then
    read -r -p "${message} [${default}]: " current <"${TTY_DEV}" || true
  fi
  printf -v "${var}" '%s' "${current:-${default}}"
}

# Prompt for a secret (no echo).
prompt_secret() {
  local var="$1" message="$2" current
  current="${!var:-}"
  if [[ -n "${current}" ]]; then return; fi
  if is_tty; then
    read -r -s -p "${message}: " current <"${TTY_DEV}" || true
    echo
  fi
  printf -v "${var}" '%s' "${current}"
}

# ---------------------------------------------------------------------------
log "Gathering configuration"
drain_tty
prompt_default DOMAIN "Domain for the WEB app, e.g. adg.example.org (use _ for any host/IP)" "_"
# Normalize and validate the domain. Uppercase, spaces or accents (a common
# copy/paste or typo mistake, e.g. "coordinación.example.org") would make nginx
# and certbot fail later in confusing ways, so reject them up front. "_" (any
# host) and bare IPs are allowed.
DOMAIN="$(printf '%s' "${DOMAIN}" | tr '[:upper:]' '[:lower:]' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
# Use grep under LC_ALL=C so the a-z/0-9 ranges match by byte: a bash =~ test
# would let accented UTF-8 letters slip through under a UTF-8 locale. Internal
# spaces are rejected here (not silently removed) so typos surface clearly.
if [[ "${DOMAIN}" != "_" ]] && \
   ! LC_ALL=C grep -qE '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$' <<<"${DOMAIN}"; then
  echo "Invalid domain: '${DOMAIN}'." >&2
  echo "Use only a-z, 0-9, dots and hyphens (no accents or spaces), e.g." >&2
  echo "  adg.example.org    — or '_' for any host." >&2
  exit 1
fi
prompt_default ADMIN_EMAIL "Email for the first administrator" "${ADMIN_EMAIL:-admin@${DOMAIN/_/localhost}}"
prompt_secret  ADMIN_PASSWORD "Password for the first administrator"
# Public URL of the installable mobile app (PWA). The mobile app is built from
# the Expo project and published under /app on the same domain, so it defaults to
# https://DOMAIN/app for a real domain. Editable here or later from the control
# panel. Left blank (no real HTTPS domain) keeps the "App Móvil" page disabled,
# since PWA install + push require HTTPS.
MOBILE_WEB_URL="${MOBILE_WEB_URL:-$(env_get MOBILE_WEB_URL)}"
if [[ -z "${MOBILE_WEB_URL}" && "${DOMAIN}" != "_" && ! "${DOMAIN}" =~ ^[0-9.]+$ ]]; then
  MOBILE_WEB_URL="https://${DOMAIN}/app"
fi
prompt_default MOBILE_WEB_URL "Public HTTPS URL for the mobile app (editable later in the panel)" "${MOBILE_WEB_URL}"
# Collaborative space (Nextcloud Drive + Collabora). It self-installs AND
# integrates automatically (running deploy/nextcloud/install-collab.sh, which
# also writes the connection details into this app's .env). Defaults to "yes"
# when a real HTTPS domain is present — the space is served as subpaths of it
# (/nextcloud, /collabora), so no extra subdomains are needed — and to "no" for
# a bare IP / "_".
DEFAULT_COLLAB="no"
if [[ "${DOMAIN}" != "_" && ! "${DOMAIN}" =~ ^[0-9.]+$ ]]; then DEFAULT_COLLAB="yes"; fi
# Keep INSTALL_COLLAB empty unless explicitly set via env, otherwise prompt_default
# would see a value and skip the question entirely (it returns when the var is set).
INSTALL_COLLAB="${INSTALL_COLLAB:-}"
prompt_default INSTALL_COLLAB "Install the collaborative space (Nextcloud + Collabora)? [yes/no]" "${DEFAULT_COLLAB}"
# Documentation wiki (Outline) is optional and is never installed unless
# explicitly requested. It needs its own subdomain because it cannot be served
# from a subpath.
DEFAULT_WIKI="no"
INSTALL_WIKI="${INSTALL_WIKI:-}"
prompt_default INSTALL_WIKI "Install the documentation wiki (Outline, needs its own subdomain)? [yes/no]" "${DEFAULT_WIKI}"
OUTLINE_DOMAIN="${OUTLINE_DOMAIN:-$(env_get OUTLINE_DOMAIN)}"
if [[ "${INSTALL_WIKI}" =~ ^[yY]([eE][sS])?$ && "${DOMAIN}" != "_" && ! "${DOMAIN}" =~ ^[0-9.]+$ ]]; then
  prompt_default OUTLINE_DOMAIN "Wiki subdomain (its own DNS record, e.g. docs.${DOMAIN})" "docs.${DOMAIN}"
fi
# Optional Cloudflare Tunnel (cloudflared). If you paste a tunnel token, the
# installer installs cloudflared (when missing) and runs it as a service, so the
# server is reachable through Cloudflare without opening firewall ports or
# managing local TLS — Cloudflare terminates HTTPS and forwards to the local
# nginx. Point the tunnel's public hostname at http://localhost:80 in the
# Cloudflare dashboard. Leave blank to skip; reused across reruns from .env.
CLOUDFLARE_TUNNEL_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-$(env_get CLOUDFLARE_TUNNEL_TOKEN)}"
prompt_secret CLOUDFLARE_TUNNEL_TOKEN "Cloudflare Tunnel token (optional, blank to skip)"
if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  echo "ADMIN_PASSWORD is required (set it via env for non-interactive installs)." >&2
  exit 1
fi
note "App directory : ${APP_DIR}"
note "Service user  : ${SERVICE_USER}"
note "Domain        : ${DOMAIN}"
note "API port      : ${API_PORT}"
note "Storage dir   : ${LOCAL_STORAGE_DIR}"
# With a real domain we also publish the mobile app (PWA) at https://DOMAIN/app
# automatically, and (when enabled) the collaborative space as subpaths of it.
if [[ "${DOMAIN}" != "_" && ! "${DOMAIN}" =~ ^[0-9.]+$ ]]; then
  note "Mobile app    : https://${DOMAIN}/app (built and published automatically)"
  if [[ "${INSTALL_COLLAB}" =~ ^[yY]([eE][sS])?$ ]]; then
    note "Collaborative : https://${DOMAIN}/nextcloud + https://${DOMAIN}/collabora"
    note "  → No extra DNS records or certificates needed: both are served as"
    note "    subpaths of ${DOMAIN}, covered by its HTTPS certificate."
  fi
  if [[ "${INSTALL_WIKI}" =~ ^[yY]([eE][sS])?$ ]]; then
    note "Wiki (Outline): https://${OUTLINE_DOMAIN:-docs.${DOMAIN}}"
    note "  → Needs its OWN DNS record (A/AAAA) pointing at this server and its"
    note "    own HTTPS certificate (obtained automatically via certbot)."
  fi
fi

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
# Reuse the existing DB password on reruns. An explicitly different value is
# rejected before touching the PostgreSQL role; role rotation must be a separate
# operation after an operator-created backup.
EXISTING_DB_URL="$(env_get DATABASE_URL)"
EXISTING_DB_PASSWORD=""
if [[ -n "${EXISTING_DB_URL}" ]]; then
  EXISTING_DB_PASSWORD="$(
      EXISTING_DATABASE_URL="${EXISTING_DB_URL}" node -e '
        try {
          const url = new URL(process.env.EXISTING_DATABASE_URL);
          if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.password) {
            throw new Error();
          }
          process.stdout.write(decodeURIComponent(url.password));
        } catch {
          process.stderr.write("Cannot read the existing PostgreSQL password from .env; refusing to rotate it implicitly.\n");
          process.exit(1);
        }
      '
  )"
  if [[ -n "${EXPLICIT_DB_PASSWORD}" && "${EXPLICIT_DB_PASSWORD}" != "${EXISTING_DB_PASSWORD}" ]]; then
    echo "DB_PASSWORD differs from the saved DATABASE_URL. Refusing to rotate the PostgreSQL role before backup; use a separate, backed-up password-rotation procedure." >&2
    exit 1
  fi
  DB_PASSWORD="${EXISTING_DB_PASSWORD}"
elif [[ -n "${EXPLICIT_DB_PASSWORD}" ]]; then
  DB_PASSWORD="${EXPLICIT_DB_PASSWORD}"
else
  DB_PASSWORD="$(openssl rand -hex 16)"
fi
if [[ "${DB_PASSWORD}" == *$'\n'* || "${DB_PASSWORD}" == *$'\r'* ]]; then
  echo "DB_PASSWORD cannot contain line breaks." >&2
  exit 1
fi
# Create a missing role only. Never reset an existing role password before the
# database backup/migration; use the saved .env value to connect on reruns.
export DB_USER DB_PASSWORD DB_NAME
ROLE_EXISTS=0
if sudo -u postgres psql --no-psqlrc -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  ROLE_EXISTS=1
fi
if [[ "${ROLE_EXISTS}" -eq 1 && -z "${EXISTING_DB_URL}" ]]; then
  echo "PostgreSQL role ${DB_USER} already exists but no DATABASE_URL is saved; refusing to change its password or continue without a verified backup." >&2
  exit 1
fi
if [[ "${ROLE_EXISTS}" -eq 0 ]] && ! sudo -u postgres --preserve-env=DB_USER,DB_PASSWORD psql \
  --set=ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
\getenv db_user DB_USER
\getenv db_password DB_PASSWORD
SELECT format(
  'CREATE ROLE %I WITH LOGIN PASSWORD %L',
  :'db_user',
  :'db_password'
) \gexec
SQL
then
  echo "Unable to create the PostgreSQL role; no database password was displayed." >&2
  exit 1
fi
# Create database (idempotent).
if ! sudo -u postgres psql --no-psqlrc -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
fi
DATABASE_URL="postgresql://$(encode_url_component "${DB_USER}"):$(encode_url_component "${DB_PASSWORD}")@127.0.0.1:5432/$(encode_url_component "${DB_NAME}")"
export DATABASE_URL SERVICE_USER

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
# MOBILE_WEB_URL was already resolved (and prompted) during configuration; it may
# also be edited later from the control panel. The "App Móvil" page shows its
# install QR only when this (or the panel value) is set.
JAAS_APP_ID="${JAAS_APP_ID:-$(env_get JAAS_APP_ID)}"
JAAS_KID="${JAAS_KID:-$(env_get JAAS_KID)}"
JAAS_PRIVATE_KEY="${JAAS_PRIVATE_KEY:-$(env_get JAAS_PRIVATE_KEY)}"
RESEND_API_KEY="${RESEND_API_KEY:-$(env_get RESEND_API_KEY)}"
RESEND_FROM="${RESEND_FROM:-$(env_get RESEND_FROM)}"
# Persist the Let's Encrypt email so a later `deploy/update.sh` can install the
# main domain over HTTPS without re-asking (the collaborative space reuses it).
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-$(env_get LETSENCRYPT_EMAIL)}"
umask 077
cat > "${ENV_FILE}" <<EOF
NODE_ENV=production
PORT=${API_PORT}
DATABASE_URL=${DATABASE_URL}
JWT_SECRET=${JWT_SECRET}
LOG_LEVEL=info
STORAGE_DRIVER=local
LOCAL_STORAGE_DIR=${LOCAL_STORAGE_DIR}
PUBLIC_APP_URL=${PUBLIC_APP_URL:-}
# Public URL of the installable mobile app (PWA). Enables the "App Móvil" page.
MOBILE_WEB_URL=${MOBILE_WEB_URL:-}
# Optional JaaS video (single-line PEM with \\n). Leave blank to use meet.jit.si.
JAAS_APP_ID=${JAAS_APP_ID:-}
JAAS_KID=${JAAS_KID:-}
JAAS_PRIVATE_KEY=${JAAS_PRIVATE_KEY:-}
# Optional email (Resend) for password resets.
RESEND_API_KEY=${RESEND_API_KEY:-}
RESEND_FROM=${RESEND_FROM:-}
# Email used for Let's Encrypt (HTTPS). Reused by deploy/update.sh.
LETSENCRYPT_EMAIL=${LETSENCRYPT_EMAIL:-}
# Optional Cloudflare Tunnel (cloudflared) token. Used by the installer to set up
# the cloudflared service; the app itself does not read it.
CLOUDFLARE_TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN:-}
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
run_as_user_preserving_env() {
  local variables="$1" command="$2"
  if [[ "${SERVICE_USER}" == "root" ]]; then
    bash -lc "${command}"
  else
    sudo -u "${SERVICE_USER}" -H --preserve-env="${variables}" -- bash -lc "${command}"
  fi
}
run_db_helper() {
  local command="$1"
  DATABASE_URL="${DATABASE_URL}" DB_BACKUP_DIR="${DB_BACKUP_DIR:-/var/backups/coordina-adg}" \
    SERVICE_USER="${SERVICE_USER}" bash "${SCRIPT_DIR}/db.sh" "${command}"
}
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}" 2>/dev/null || true

run_as_user "cd '${APP_DIR}' && corepack prepare pnpm@${PNPM_VERSION} --activate >/dev/null 2>&1 || true"
# ---------------------------------------------------------------------------
log "Applying database schema"
# Back up and validate/migrate the database before building code that depends on
# the target schema. No API artifact or live web tree has changed at this point.
run_db_helper backup
run_db_helper prepare
run_db_helper apply

# ---------------------------------------------------------------------------
log "Preloading reference data (provinces, islands, municipalities, FP centers)"
run_as_user_preserving_env "DATABASE_URL" \
  "cd '${APP_DIR}' && pnpm --filter @workspace/scripts run seed-reference-data"

# ---------------------------------------------------------------------------
log "Creating the first administrator (if needed)"
SEED_ADMIN_EMAIL="${ADMIN_EMAIL}" SEED_ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  SEED_ADMIN_NAME="${ADMIN_NAME}" \
  run_as_user_preserving_env \
    "DATABASE_URL,SEED_ADMIN_EMAIL,SEED_ADMIN_PASSWORD,SEED_ADMIN_NAME" \
    "cd '${APP_DIR}' && pnpm --filter @workspace/scripts run seed-admin"

# ---------------------------------------------------------------------------
if [[ "${SEED_TEST_TEACHERS:-no}" =~ ^[yY]([eE][sS])?$ ]]; then
  log "Seeding test teachers (Administración y Gestión)"
  if [[ -n "${TEST_TEACHER_PASSWORD:-}" ]]; then
    TEST_TEACHER_PASSWORD="${TEST_TEACHER_PASSWORD}" \
      run_as_user_preserving_env "DATABASE_URL,TEST_TEACHER_PASSWORD" \
        "cd '${APP_DIR}' && pnpm --filter @workspace/scripts run seed-test-teachers"
  else
    run_as_user_preserving_env "DATABASE_URL" \
      "cd '${APP_DIR}' && pnpm --filter @workspace/scripts run seed-test-teachers"
  fi
fi
run_db_helper verify

# Save the previous API build in a protected temporary directory before compiling
# over it. Restore it on any build/readiness failure; the database is not rolled
# back automatically.
API_DIST="${APP_DIR}/artifacts/api-server/dist"
API_BACKUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/coordina-api-dist.XXXXXX")"
API_DIST_BACKUP="${API_BACKUP_DIR}/dist"
API_DIST_WAS_PRESENT=0
API_BUILD_STARTED=0
API_RESTART_ATTEMPTED=0
API_HEALTHY=0
API_RESTORE_FAILED=0
if [[ -e "${API_DIST}" || -L "${API_DIST}" ]]; then
  if ! cp -a -- "${API_DIST}" "${API_DIST_BACKUP}"; then
    rm -rf -- "${API_BACKUP_DIR}"
    echo "ERROR: could not save the previous API distribution; refusing to build over it." >&2
    exit 1
  fi
  API_DIST_WAS_PRESENT=1
fi
restore_api_dist_on_failure() {
  local status="$1"
  if [[ "${status}" -ne 0 && "${API_BUILD_STARTED}" -eq 1 && "${API_HEALTHY}" -eq 0 ]]; then
    echo "==> Build/readiness failed; restoring the previous API distribution." >&2
    if [[ ( -e "${API_DIST}" || -L "${API_DIST}" ) ]] && ! rm -rf -- "${API_DIST}"; then
      API_RESTORE_FAILED=1
      echo "ERROR: could not remove the failed API distribution at ${API_DIST}." >&2
      echo "WARNING: PostgreSQL changes and installed dependencies are not automatically rolled back; use the pre-migration database backup and matching previous code if needed." >&2
      return 0
    fi
    if [[ "${API_DIST_WAS_PRESENT}" -eq 1 ]]; then
      if ! cp -a -- "${API_DIST_BACKUP}" "${API_DIST}"; then
        API_RESTORE_FAILED=1
        echo "ERROR: could not restore the previous API distribution from ${API_DIST_BACKUP}." >&2
      fi
    fi
    if [[ "${API_RESTART_ATTEMPTED}" -eq 1 && "${API_DIST_WAS_PRESENT}" -eq 1 && "${API_RESTORE_FAILED}" -eq 0 ]]; then
      systemctl restart coordina-adg.service || \
        echo "ERROR: could not restart the service after restoring the previous API distribution." >&2
    fi
    echo "WARNING: PostgreSQL changes and installed dependencies are not automatically rolled back; use the pre-migration database backup and matching previous code if needed." >&2
  fi
}
cleanup_api_dist() {
  local status=$?
  trap - EXIT
  restore_api_dist_on_failure "${status}"
  if [[ "${status}" -ne 0 && "${API_BUILD_STARTED}" -eq 0 ]]; then
    echo "WARNING: PostgreSQL changes and installed dependencies are not automatically rolled back; use the pre-migration database backup and matching previous code if needed." >&2
  fi
  if [[ -d "${API_BACKUP_DIR}" && "${API_RESTORE_FAILED}" -eq 0 ]]; then rm -rf -- "${API_BACKUP_DIR}"; fi
  if [[ "${API_RESTORE_FAILED}" -eq 1 ]]; then
    echo "WARNING: the protected API distribution backup remains at ${API_BACKUP_DIR}." >&2
  fi
  exit "${status}"
}
trap cleanup_api_dist EXIT

# Web build needs PORT (vite requirement, dummy here) and BASE_PATH=/ (root).
run_as_user "cd '${APP_DIR}' && PORT=5173 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/web run build"
# API build writes over the live repository dist; the prior output above is kept
# until the service proves it can start against the migrated database.
API_BUILD_STARTED=1
run_as_user "cd '${APP_DIR}' && pnpm --filter @workspace/api-server run build"

# Fail early if the web build didn't produce the entry point nginx will serve.
if [[ ! -f "${APP_DIR}/artifacts/web/dist/public/index.html" ]]; then
  echo "ERROR: web build did not produce artifacts/web/dist/public/index.html" >&2
  echo "       Check the build output above and re-run the installer." >&2
  exit 1
fi

# Mobile app (Expo web export), published under /app so phones get the real
# mobile app instead of the desktop web. Only built with a real HTTPS domain:
# the bundled API base URL and PWA install/push all require https://DOMAIN.
BUILD_MOBILE=0
if [[ "${DOMAIN}" != "_" && ! "${DOMAIN}" =~ ^[0-9.]+$ ]]; then
  BUILD_MOBILE=1
fi
if [[ "${BUILD_MOBILE}" -eq 1 ]]; then
  log "Building the mobile app (PWA) for /app"
  run_as_user "cd '${APP_DIR}' && EXPO_PUBLIC_DOMAIN='${DOMAIN}' EXPO_PUBLIC_BASE_PATH=/app pnpm --filter @workspace/movil run build:web"
  if [[ ! -f "${APP_DIR}/artifacts/movil/dist/index.html" ]]; then
    echo "ERROR: mobile build did not produce artifacts/movil/dist/index.html" >&2
    echo "       Check the build output above and re-run the installer." >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
log "Configuring the systemd service"
SERVICE_FILE="/etc/systemd/system/coordina-adg.service"
sed -e "s|__SERVICE_USER__|${SERVICE_USER}|g" \
    -e "s|__APP_DIR__|${APP_DIR}|g" \
    -e "s|__NODE_BIN__|${NODE_BIN}|g" \
    "${SCRIPT_DIR}/coordina-adg.service.template" > "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable coordina-adg.service
API_RESTART_ATTEMPTED=1
systemctl restart coordina-adg.service

# ---------------------------------------------------------------------------
log "Configuring nginx"
# Serve the web from a standard location nginx can always read. Serving directly
# from the clone (e.g. /root/... or /home/user/...) fails because those home
# directories are not traversable by www-data, producing a site-wide 500.
WEB_ROOT="/var/www/coordina-adg"
WEB_PARENT="$(dirname "${WEB_ROOT}")"
mkdir -p "${WEB_PARENT}"
WEB_STAGE="$(mktemp -d "${WEB_PARENT}/.coordina-adg.stage.XXXXXX")"
WEB_PREVIOUS="${WEB_PARENT}/.coordina-adg.previous.$$"
NGINX_CONF="/etc/nginx/sites-available/coordina-adg"
NGINX_ENABLED_CONF="/etc/nginx/sites-enabled/coordina-adg"
NGINX_UPGRADE_CONF="/etc/nginx/conf.d/coordina-adg-upgrade.conf"
NGINX_DEFAULT_CONF="/etc/nginx/sites-enabled/default"
NGINX_BACKUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/coordina-nginx.XXXXXX")"
NGINX_CONF_BACKUP="${NGINX_BACKUP_DIR}/site"
NGINX_ENABLED_BACKUP="${NGINX_BACKUP_DIR}/enabled"
NGINX_UPGRADE_BACKUP="${NGINX_BACKUP_DIR}/upgrade"
NGINX_DEFAULT_BACKUP="${NGINX_BACKUP_DIR}/default"
NGINX_CONF_WAS_PRESENT=0
NGINX_ENABLED_WAS_PRESENT=0
NGINX_UPGRADE_WAS_PRESENT=0
NGINX_DEFAULT_WAS_PRESENT=0
NGINX_TOUCHED=0
PUBLISH_STARTED=0
for path_info in \
  "${NGINX_CONF}|${NGINX_CONF_BACKUP}|NGINX_CONF_WAS_PRESENT" \
  "${NGINX_ENABLED_CONF}|${NGINX_ENABLED_BACKUP}|NGINX_ENABLED_WAS_PRESENT" \
  "${NGINX_UPGRADE_CONF}|${NGINX_UPGRADE_BACKUP}|NGINX_UPGRADE_WAS_PRESENT" \
  "${NGINX_DEFAULT_CONF}|${NGINX_DEFAULT_BACKUP}|NGINX_DEFAULT_WAS_PRESENT"; do
  IFS='|' read -r source backup flag <<<"${path_info}"
  if [[ -e "${source}" || -L "${source}" ]]; then
    cp -a -- "${source}" "${backup}"
    printf -v "${flag}" '1'
  fi
done

restore_nginx_path() {
  local source="$1" backup="$2" was_present="$3"
  rm -f -- "${source}"
  if [[ "${was_present}" -eq 1 ]]; then
    cp -a -- "${backup}" "${source}"
  fi
}

cleanup_install_publish() {
  local status=$?
  trap - EXIT
  if [[ "${status}" -ne 0 ]]; then
    restore_api_dist_on_failure "${status}"
    if [[ "${API_HEALTHY}" -eq 1 || "${API_BUILD_STARTED}" -eq 0 ]]; then
      echo "WARNING: PostgreSQL changes and installed dependencies are not automatically rolled back; use the pre-migration database backup and matching previous code if needed." >&2
    fi
    if [[ "${PUBLISH_STARTED}" -eq 1 ]]; then
      echo "==> Installation failed after publication began; restoring previous web files and nginx configuration." >&2
      if [[ -e "${WEB_ROOT}" || -L "${WEB_ROOT}" ]]; then rm -rf -- "${WEB_ROOT}"; fi
      if [[ -e "${WEB_PREVIOUS}" || -L "${WEB_PREVIOUS}" ]]; then
        mv -- "${WEB_PREVIOUS}" "${WEB_ROOT}" || \
          echo "ERROR: could not restore the previous web root." >&2
      fi
    fi
    if [[ "${NGINX_TOUCHED}" -eq 1 ]]; then
      restore_nginx_path "${NGINX_CONF}" "${NGINX_CONF_BACKUP}" "${NGINX_CONF_WAS_PRESENT}" || true
      restore_nginx_path "${NGINX_ENABLED_CONF}" "${NGINX_ENABLED_BACKUP}" "${NGINX_ENABLED_WAS_PRESENT}" || true
      restore_nginx_path "${NGINX_UPGRADE_CONF}" "${NGINX_UPGRADE_BACKUP}" "${NGINX_UPGRADE_WAS_PRESENT}" || true
      restore_nginx_path "${NGINX_DEFAULT_CONF}" "${NGINX_DEFAULT_BACKUP}" "${NGINX_DEFAULT_WAS_PRESENT}" || true
      if nginx -t >/dev/null 2>&1; then
        systemctl reload nginx >/dev/null 2>&1 || \
          echo "ERROR: could not reload nginx with its restored configuration." >&2
      else
        echo "ERROR: restored nginx configuration did not pass nginx -t; inspect /etc/nginx." >&2
      fi
    fi
  fi
  if [[ -d "${WEB_STAGE}" ]]; then rm -rf -- "${WEB_STAGE}"; fi
  if [[ -d "${NGINX_BACKUP_DIR}" ]]; then rm -rf -- "${NGINX_BACKUP_DIR}"; fi
  if [[ -d "${API_BACKUP_DIR}" && "${API_RESTORE_FAILED}" -eq 0 ]]; then rm -rf -- "${API_BACKUP_DIR}"; fi
  if [[ "${API_RESTORE_FAILED}" -eq 1 ]]; then
    echo "WARNING: the protected API distribution backup remains at ${API_BACKUP_DIR}." >&2
  fi
  exit "${status}"
}
trap cleanup_install_publish EXIT

cp -a "${APP_DIR}/artifacts/web/dist/public/." "${WEB_STAGE}/"
# Publish the mobile app (PWA) under /app on the same root.
if [[ "${BUILD_MOBILE}" -eq 1 ]]; then
  mkdir -p "${WEB_STAGE}/app"
  cp -a "${APP_DIR}/artifacts/movil/dist/." "${WEB_STAGE}/app/"
fi
chown -R www-data:www-data "${WEB_STAGE}"
# Map needed for WebSocket (Socket.io) upgrades — http-level, set once.
NGINX_TOUCHED=1
cat > /etc/nginx/conf.d/coordina-adg-upgrade.conf <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
EOF
sed -e "s|__SERVER_NAME__|${DOMAIN}|g" \
    -e "s|__WEB_ROOT__|${WEB_ROOT}|g" \
    -e "s|__API_PORT__|${API_PORT}|g" \
    "${SCRIPT_DIR}/nginx-site.conf.template" > "${NGINX_CONF}"
ln -sf "${NGINX_CONF}" "${NGINX_ENABLED_CONF}"

PUBLISH_STARTED=1
if [[ -e "${WEB_ROOT}" || -L "${WEB_ROOT}" ]]; then
  mv -- "${WEB_ROOT}" "${WEB_PREVIOUS}"
fi
if ! mv -- "${WEB_STAGE}" "${WEB_ROOT}"; then
  echo "ERROR: could not publish staged web assets; the failure handler will restore the previous files." >&2
  exit 1
fi
rm -f -- "${NGINX_DEFAULT_CONF}"
nginx -t
systemctl enable nginx
systemctl restart nginx

# Verify both the managed service and its database-backed readiness endpoint
# before declaring installation complete.
systemctl is-active --quiet coordina-adg.service || {
  echo "ERROR: coordina-adg.service is not active after installation." >&2
  exit 1
}
READY=0
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error "http://127.0.0.1:${API_PORT}/api/readyz" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 2
done
if [[ "${READY}" -ne 1 ]]; then
  echo "ERROR: API/database readiness check failed at http://127.0.0.1:${API_PORT}/api/readyz." >&2
  exit 1
fi
run_db_helper verify
API_HEALTHY=1
if [[ "${API_RESTORE_FAILED}" -eq 0 ]]; then rm -rf -- "${API_BACKUP_DIR}"; fi
rm -rf -- "${WEB_PREVIOUS}"
PUBLISH_STARTED=0

# ---------------------------------------------------------------------------
if [[ -n "${LETSENCRYPT_EMAIL}" && "${DOMAIN}" != "_" && ! "${DOMAIN}" =~ ^[0-9.]+$ ]]; then
  log "Requesting HTTPS certificate via Let's Encrypt"
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${LETSENCRYPT_EMAIL}" --redirect || \
    note "certbot failed — the site still works over HTTP. Re-run certbot once DNS points here."
fi

# ---------------------------------------------------------------------------
if [[ "${INSTALL_COLLAB}" =~ ^[yY]([eE][sS])?$ ]]; then
  log "Installing the collaborative space (Nextcloud + Collabora)"
  APP_DOMAIN="${DOMAIN}" LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL}" \
    bash "${SCRIPT_DIR}/nextcloud/install-collab.sh" || \
    note "Collaborative space install failed — the main app still works. Re-run later: sudo bash deploy/nextcloud/install-collab.sh"
fi

# ---------------------------------------------------------------------------
if [[ "${INSTALL_WIKI}" =~ ^[yY]([eE][sS])?$ ]]; then
  log "Installing the documentation wiki (Outline)"
  APP_DOMAIN="${DOMAIN}" OUTLINE_DOMAIN="${OUTLINE_DOMAIN}" LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL}" \
    bash "${SCRIPT_DIR}/outline/install-outline.sh" || \
    note "Documentation wiki install failed — the main app still works. Re-run later: sudo bash deploy/outline/install-outline.sh"
fi

# ---------------------------------------------------------------------------
# Optional Cloudflare Tunnel (cloudflared). With a token, expose the server
# through Cloudflare without opening firewall ports or managing local TLS.
if [[ -n "${CLOUDFLARE_TUNNEL_TOKEN}" ]]; then
  log "Setting up the Cloudflare Tunnel (cloudflared)"
  if ! command -v cloudflared >/dev/null 2>&1; then
    note "Installing cloudflared"
    CF_ARCH="$(dpkg --print-architecture)"
    if curl -fsSL -o /tmp/cloudflared.deb \
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}.deb"; then
      apt-get install -y /tmp/cloudflared.deb || \
        note "cloudflared install failed; install it manually and re-run."
      rm -f /tmp/cloudflared.deb
    else
      note "Could not download cloudflared for arch '${CF_ARCH}'; skipping the tunnel."
    fi
  fi
  if command -v cloudflared >/dev/null 2>&1; then
    # Idempotent: drop any previous service so the (possibly new) token applies,
    # then (re)install. `cloudflared service install` also enables and starts it.
    systemctl stop cloudflared 2>/dev/null || true
    cloudflared service uninstall >/dev/null 2>&1 || true
    if cloudflared service install "${CLOUDFLARE_TUNNEL_TOKEN}"; then
      systemctl enable --now cloudflared 2>/dev/null || true
      note "Cloudflare Tunnel active — manage public hostnames/routes in the Cloudflare dashboard."
    else
      note "cloudflared service install failed — check the token and re-run."
    fi
  fi
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
if [[ -z "${MOBILE_WEB_URL}" ]]; then
  note "App Móvil: deshabilitada. Configura un dominio HTTPS y vuelve a ejecutar,"
  note "           o define MOBILE_WEB_URL=https://tu-dominio en .env y reinicia."
fi
