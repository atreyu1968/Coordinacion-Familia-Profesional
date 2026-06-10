#!/usr/bin/env bash
# ===========================================================================
# Coordina ADG — collaborative space installer (Nextcloud + Collabora).
#
# Run AFTER the main deploy/install.sh (install.sh runs it automatically when a
# real HTTPS domain is present). It:
#   - brings up the dockerized Nextcloud + Collabora stack (compose),
#   - configures host nginx subdomains (and HTTPS via certbot),
#   - installs/enables the Nextcloud apps used by the platform
#     (group folders + OIDC login) and registers the OIDC provider,
#   - writes the connection details into the main app .env and restarts it, so
#     the integration works automatically (no manual control-panel step).
#
# Safe to re-run (idempotent). Usage from the repo root:
#   sudo bash deploy/nextcloud/install-collab.sh
# You only need the MAIN app domain: Nextcloud and Collabora are placed on
# subdomains of it automatically (drive.<domain> and office.<domain>). On a
# standalone run the domain is auto-detected from the main app .env.
#
# Non-interactive: pass just the main domain, e.g.
#   sudo APP_DOMAIN=adg.example.org LETSENCRYPT_EMAIL=you@example.org \
#        bash deploy/nextcloud/install-collab.sh
# Optional overrides (only if you need custom subdomain names):
#   sudo NEXTCLOUD_DOMAIN=drive.example.org COLLABORA_DOMAIN=office.example.org \
#        APP_DOMAIN=adg.example.org LETSENCRYPT_EMAIL=you@example.org \
#        bash deploy/nextcloud/install-collab.sh
# ===========================================================================
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/nextcloud/install-collab.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="$(cd "${DEPLOY_DIR}/.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }

is_tty() { [[ -t 0 ]]; }
prompt_default() {
  local var="$1" message="$2" default="$3" current
  current="${!var:-}"
  if [[ -n "${current}" ]]; then return; fi
  if is_tty; then read -r -p "${message} [${default}]: " current || true; fi
  printf -v "${var}" '%s' "${current:-${default}}"
}

# Read a value from the existing .env so reruns preserve generated secrets.
env_get() { [[ -f "${ENV_FILE}" ]] || return 0; grep "^$1=" "${ENV_FILE}" | head -n1 | cut -d= -f2-; }
# Read a value from the MAIN app .env (to auto-detect the app domain on a
# standalone run, so the admin only ever supplies the main domain).
main_env_get() { [[ -f "${APP_DIR}/.env" ]] || return 0; grep "^$1=" "${APP_DIR}/.env" | head -n1 | cut -d= -f2-; }
# Extract the bare host from a URL (drop scheme and any path).
url_host() { printf '%s' "$1" | sed -E 's#^https?://##; s#/.*$##'; }
rand() { openssl rand -hex 16; }

# --- Docker (install once) -------------------------------------------------
log "Ensuring Docker is installed"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 plugin is required (docker compose). Aborting." >&2
  exit 1
fi

# --- Configuration ---------------------------------------------------------
log "Gathering configuration"
# The admin only ever supplies the MAIN application domain. Nextcloud and
# Collabora are placed on subdomains of it automatically (drive.<domain> and
# office.<domain>) so the SSO cookie — scoped to the registrable domain — is
# shared. install.sh passes APP_DOMAIN; on a standalone run we auto-detect it
# from the main app .env, and only ask if we still can't find it.
APP_DOMAIN="${APP_DOMAIN:-_}"
if [[ "${APP_DOMAIN}" == "_" || -z "${APP_DOMAIN}" ]]; then
  DETECTED="$(url_host "$(main_env_get PUBLIC_APP_URL)")"
  [[ -z "${DETECTED}" ]] && DETECTED="$(url_host "$(main_env_get MOBILE_WEB_URL)")"
  APP_DOMAIN=""
  prompt_default APP_DOMAIN "Main application domain (e.g. adg.example.org)" "${DETECTED}"
fi
# Reject a missing / placeholder / bare-IP domain: SSO and HTTPS need real
# subdomains of a registrable domain.
if [[ -z "${APP_DOMAIN}" || "${APP_DOMAIN}" == "_" || "${APP_DOMAIN}" =~ ^[0-9.]+$ ]]; then
  echo "A real main domain is required (e.g. adg.example.org)." >&2
  echo "The collaborative space needs subdomains of it (drive./office.) over HTTPS." >&2
  exit 1
fi
# Derive the subdomains from the main domain. Priority: explicit env override >
# previously-saved value (rerun idempotency) > derived default. Never concatenate.
DEFAULT_NC="drive.${APP_DOMAIN}"; DEFAULT_CO="office.${APP_DOMAIN}"
NEXTCLOUD_DOMAIN="${NEXTCLOUD_DOMAIN:-$(env_get NEXTCLOUD_DOMAIN)}"; NEXTCLOUD_DOMAIN="${NEXTCLOUD_DOMAIN:-${DEFAULT_NC}}"
COLLABORA_DOMAIN="${COLLABORA_DOMAIN:-$(env_get COLLABORA_DOMAIN)}"; COLLABORA_DOMAIN="${COLLABORA_DOMAIN:-${DEFAULT_CO}}"
note "Main domain        : ${APP_DOMAIN}"
note "Nextcloud (Drive)  : ${NEXTCLOUD_DOMAIN}"
note "Collabora (Office) : ${COLLABORA_DOMAIN}"

NEXTCLOUD_PORT="${NEXTCLOUD_PORT:-$(env_get NEXTCLOUD_PORT)}"; NEXTCLOUD_PORT="${NEXTCLOUD_PORT:-8081}"
COLLABORA_PORT="${COLLABORA_PORT:-$(env_get COLLABORA_PORT)}"; COLLABORA_PORT="${COLLABORA_PORT:-9980}"
NEXTCLOUD_DB_NAME="${NEXTCLOUD_DB_NAME:-$(env_get NEXTCLOUD_DB_NAME)}"; NEXTCLOUD_DB_NAME="${NEXTCLOUD_DB_NAME:-nextcloud}"
NEXTCLOUD_DB_USER="${NEXTCLOUD_DB_USER:-$(env_get NEXTCLOUD_DB_USER)}"; NEXTCLOUD_DB_USER="${NEXTCLOUD_DB_USER:-nextcloud}"
NEXTCLOUD_ADMIN_USER="${NEXTCLOUD_ADMIN_USER:-$(env_get NEXTCLOUD_ADMIN_USER)}"; NEXTCLOUD_ADMIN_USER="${NEXTCLOUD_ADMIN_USER:-admin}"
COLLABORA_ADMIN_USER="${COLLABORA_ADMIN_USER:-$(env_get COLLABORA_ADMIN_USER)}"; COLLABORA_ADMIN_USER="${COLLABORA_ADMIN_USER:-admin}"
# Preserve generated secrets across reruns; generate on first install.
NEXTCLOUD_DB_PASSWORD="${NEXTCLOUD_DB_PASSWORD:-$(env_get NEXTCLOUD_DB_PASSWORD)}"; NEXTCLOUD_DB_PASSWORD="${NEXTCLOUD_DB_PASSWORD:-$(rand)}"
NEXTCLOUD_ADMIN_PASSWORD="${NEXTCLOUD_ADMIN_PASSWORD:-$(env_get NEXTCLOUD_ADMIN_PASSWORD)}"; NEXTCLOUD_ADMIN_PASSWORD="${NEXTCLOUD_ADMIN_PASSWORD:-$(rand)}"
COLLABORA_ADMIN_PASSWORD="${COLLABORA_ADMIN_PASSWORD:-$(env_get COLLABORA_ADMIN_PASSWORD)}"; COLLABORA_ADMIN_PASSWORD="${COLLABORA_ADMIN_PASSWORD:-$(rand)}"
# OIDC client the Nextcloud user_oidc app uses against the api-server.
OIDC_CLIENT_ID="${OIDC_CLIENT_ID:-$(env_get OIDC_CLIENT_ID)}"; OIDC_CLIENT_ID="${OIDC_CLIENT_ID:-coordina-nextcloud}"
OIDC_CLIENT_SECRET="${OIDC_CLIENT_SECRET:-$(env_get OIDC_CLIENT_SECRET)}"; OIDC_CLIENT_SECRET="${OIDC_CLIENT_SECRET:-$(openssl rand -hex 24)}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"

# --- Write the compose .env (idempotent) -----------------------------------
log "Writing ${ENV_FILE}"
umask 077
cat > "${ENV_FILE}" <<EOF
NEXTCLOUD_DOMAIN=${NEXTCLOUD_DOMAIN}
COLLABORA_DOMAIN=${COLLABORA_DOMAIN}
NEXTCLOUD_PORT=${NEXTCLOUD_PORT}
COLLABORA_PORT=${COLLABORA_PORT}
NEXTCLOUD_DB_NAME=${NEXTCLOUD_DB_NAME}
NEXTCLOUD_DB_USER=${NEXTCLOUD_DB_USER}
NEXTCLOUD_DB_PASSWORD=${NEXTCLOUD_DB_PASSWORD}
NEXTCLOUD_ADMIN_USER=${NEXTCLOUD_ADMIN_USER}
NEXTCLOUD_ADMIN_PASSWORD=${NEXTCLOUD_ADMIN_PASSWORD}
COLLABORA_ADMIN_USER=${COLLABORA_ADMIN_USER}
COLLABORA_ADMIN_PASSWORD=${COLLABORA_ADMIN_PASSWORD}
OIDC_CLIENT_ID=${OIDC_CLIENT_ID}
OIDC_CLIENT_SECRET=${OIDC_CLIENT_SECRET}
EOF
umask 022

# --- Bring up the stack ----------------------------------------------------
log "Starting Nextcloud + Collabora (docker compose up -d)"
( cd "${SCRIPT_DIR}" && docker compose pull && docker compose up -d )

# Wait for Nextcloud to finish first-run installation.
log "Waiting for Nextcloud to become ready"
occ() { docker compose -f "${SCRIPT_DIR}/docker-compose.yml" exec -T -u www-data nextcloud php occ "$@"; }
for _ in $(seq 1 60); do
  if occ status 2>/dev/null | grep -q "installed: true"; then break; fi
  sleep 5
done
occ status | grep -q "installed: true" || { echo "Nextcloud did not become ready in time." >&2; exit 1; }

# --- Configure Nextcloud apps + OIDC (idempotent) --------------------------
log "Configuring Nextcloud apps and OIDC provider"
occ config:system:set trusted_domains 1 --value="${NEXTCLOUD_DOMAIN}" >/dev/null || true
occ app:install groupfolders >/dev/null 2>&1 || true
occ app:enable  groupfolders >/dev/null 2>&1 || true
occ app:install user_oidc    >/dev/null 2>&1 || true
occ app:enable  user_oidc    >/dev/null 2>&1 || true

# The api-server publishes its discovery at https://APP_DOMAIN/api/oidc.
ISSUER_BASE="https://${APP_DOMAIN}/api/oidc"
if [[ "${APP_DOMAIN}" == "_" ]]; then
  note "APP_DOMAIN not set — skipping automatic OIDC provider registration."
  note "Register it later with: occ user_oidc:provider Coordina ..."
else
  # Re-register so reruns pick up secret/URL changes (idempotent upsert).
  occ user_oidc:provider Coordina \
    --clientid="${OIDC_CLIENT_ID}" \
    --clientsecret="${OIDC_CLIENT_SECRET}" \
    --discoveryuri="${ISSUER_BASE}/.well-known/openid-configuration" \
    --scope="openid profile email" \
    --unique-uid=0 \
    --mapping-uid=sub \
    --mapping-display-name=name \
    --mapping-email=email >/dev/null 2>&1 || \
    note "Could not auto-register the OIDC provider; configure it in Nextcloud → user_oidc."
fi

# --- Configure Collabora in Nextcloud --------------------------------------
occ app:install richdocuments >/dev/null 2>&1 || true
occ app:enable  richdocuments >/dev/null 2>&1 || true
occ config:app:set richdocuments wopi_url --value="https://${COLLABORA_DOMAIN}" >/dev/null 2>&1 || true

# --- Host nginx subdomains -------------------------------------------------
log "Configuring nginx for ${NEXTCLOUD_DOMAIN} and ${COLLABORA_DOMAIN}"
# Reuse the upgrade map from the main install; define a local fallback if absent.
if [[ ! -f /etc/nginx/conf.d/coordina-adg-upgrade.conf ]]; then
  cat > /etc/nginx/conf.d/coordina-adg-upgrade.conf <<'EOF'
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
EOF
fi
sed -e "s|__NEXTCLOUD_DOMAIN__|${NEXTCLOUD_DOMAIN}|g" \
    -e "s|__COLLABORA_DOMAIN__|${COLLABORA_DOMAIN}|g" \
    -e "s|__NEXTCLOUD_PORT__|${NEXTCLOUD_PORT}|g" \
    -e "s|__COLLABORA_PORT__|${COLLABORA_PORT}|g" \
    "${DEPLOY_DIR}/nginx-collab.conf.template" > /etc/nginx/sites-available/coordina-adg-collab
ln -sf /etc/nginx/sites-available/coordina-adg-collab /etc/nginx/sites-enabled/coordina-adg-collab
nginx -t
systemctl reload nginx

# --- HTTPS -----------------------------------------------------------------
if [[ -n "${LETSENCRYPT_EMAIL}" ]]; then
  log "Requesting HTTPS certificates"
  apt-get install -y certbot python3-certbot-nginx >/dev/null 2>&1 || true
  certbot --nginx -d "${NEXTCLOUD_DOMAIN}" -d "${COLLABORA_DOMAIN}" \
    --non-interactive --agree-tos -m "${LETSENCRYPT_EMAIL}" --redirect || \
    note "certbot failed — sites still work over HTTP. Re-run once DNS resolves."
fi

# --- Integrate with the main app automatically -----------------------------
# Write the connection details into the api-server's .env so the collaborative
# space works out of the box, with no manual copy-paste into the control panel.
# The api-server resolves Nextcloud admin (url+user+password) and the OIDC client
# (id+secret) from these env vars when no in-panel DB values are set.
MAIN_ENV="${APP_DIR}/.env"
if [[ -f "${MAIN_ENV}" ]]; then
  log "Integrating with Coordina ADG (${MAIN_ENV})"
  # Upsert KEY=VALUE without sed, so values with special chars (#, &, \) are
  # written verbatim: drop any existing line, then append the new one.
  set_main_env() {
    local key="$1" value="$2" tmp
    tmp="$(mktemp)"
    grep -v "^${key}=" "${MAIN_ENV}" > "${tmp}" || true
    printf '%s=%s\n' "${key}" "${value}" >> "${tmp}"
    cat "${tmp}" > "${MAIN_ENV}"
    rm -f "${tmp}"
  }
  set_main_env NEXTCLOUD_URL "https://${NEXTCLOUD_DOMAIN}"
  set_main_env NEXTCLOUD_ADMIN_USER "${NEXTCLOUD_ADMIN_USER}"
  set_main_env NEXTCLOUD_ADMIN_PASSWORD "${NEXTCLOUD_ADMIN_PASSWORD}"
  set_main_env NEXTCLOUD_OIDC_CLIENT_ID "${OIDC_CLIENT_ID}"
  set_main_env NEXTCLOUD_OIDC_CLIENT_SECRET "${OIDC_CLIENT_SECRET}"
  if systemctl list-unit-files 2>/dev/null | grep -q '^coordina-adg\.service'; then
    systemctl restart coordina-adg.service || \
      note "Could not restart coordina-adg.service; restart it to apply: systemctl restart coordina-adg"
  fi
  INTEGRATED=1
else
  INTEGRATED=0
  note "Main app .env not found at ${MAIN_ENV}; enter the values below in the panel."
fi

# ---------------------------------------------------------------------------
if [[ "${INTEGRATED}" -eq 1 ]]; then
  log "Done! The collaborative space is installed and integrated automatically."
  note "No manual step needed. For reference (also in ${ENV_FILE}, root-only):"
else
  log "Done! Paste these into the control panel → Espacio colaborativo:"
fi
note "URL de Nextcloud   : https://${NEXTCLOUD_DOMAIN}"
note "URL de Collabora   : https://${COLLABORA_DOMAIN}"
note "Usuario admin      : ${NEXTCLOUD_ADMIN_USER}"
note "Contraseña admin   : ${NEXTCLOUD_ADMIN_PASSWORD}"
note "OIDC Client ID     : ${OIDC_CLIENT_ID}"
note "OIDC Client Secret : ${OIDC_CLIENT_SECRET}"
