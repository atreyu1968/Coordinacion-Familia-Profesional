#!/usr/bin/env bash
# ===========================================================================
# Coordina ADG — documentation wiki installer (Outline).
#
# Run AFTER the main deploy/install.sh (install.sh runs it automatically when a
# real HTTPS domain is present and the wiki is enabled). It:
#   - brings up the dockerized Outline + Postgres + Redis stack (compose),
#   - configures a dedicated host nginx server block for the wiki SUBDOMAIN
#     (Outline cannot be served from a subpath, so it needs its own subdomain),
#   - obtains an HTTPS certificate for that subdomain (certbot),
#   - writes the connection details into the main app .env and restarts it, so
#     the integration works automatically (no manual control-panel step).
#
# Safe to re-run (idempotent). Usage from the repo root:
#   sudo bash deploy/outline/install-outline.sh
#
# Unlike the collaborative space (served as subpaths of the main domain), the
# wiki needs its OWN SUBDOMAIN and a matching DNS A/AAAA record pointing at this
# server, e.g. docs.<main-domain>. By default we derive it as docs.<main-domain>.
#
# Non-interactive: pass the main domain (and optionally the wiki subdomain):
#   sudo APP_DOMAIN=adg.example.org OUTLINE_DOMAIN=docs.adg.example.org \
#        LETSENCRYPT_EMAIL=admin@example.org \
#        bash deploy/outline/install-outline.sh
# ===========================================================================
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/outline/install-outline.sh" >&2
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
# The admin supplies the MAIN application domain (used as the OIDC issuer host).
# install.sh passes APP_DOMAIN; on a standalone run we auto-detect it from the
# main app .env, and only ask if we still can't find it.
APP_DOMAIN="${APP_DOMAIN:-_}"
if [[ "${APP_DOMAIN}" == "_" || -z "${APP_DOMAIN}" ]]; then
  DETECTED="$(url_host "$(main_env_get PUBLIC_APP_URL)")"
  [[ -z "${DETECTED}" ]] && DETECTED="$(url_host "$(main_env_get MOBILE_WEB_URL)")"
  APP_DOMAIN=""
  prompt_default APP_DOMAIN "Main application domain (e.g. adg.example.org)" "${DETECTED}"
fi
# Reject a missing / placeholder / bare-IP domain: SSO and HTTPS need a real
# registrable domain.
if [[ -z "${APP_DOMAIN}" || "${APP_DOMAIN}" == "_" || "${APP_DOMAIN}" =~ ^[0-9.]+$ ]]; then
  echo "A real main domain is required (e.g. adg.example.org)." >&2
  echo "The documentation wiki authenticates against it over OIDC SSO." >&2
  exit 1
fi

# Wiki subdomain. Outline cannot live on a subpath, so it needs its own host.
# Default to docs.<main-domain>; allow override. A DNS record for it must point
# at this server before certbot can issue the certificate.
OUTLINE_DOMAIN="${OUTLINE_DOMAIN:-$(env_get OUTLINE_DOMAIN)}"
if [[ -z "${OUTLINE_DOMAIN}" ]]; then
  prompt_default OUTLINE_DOMAIN "Wiki subdomain (its own DNS record, e.g. docs.${APP_DOMAIN})" "docs.${APP_DOMAIN}"
fi
if [[ -z "${OUTLINE_DOMAIN}" || "${OUTLINE_DOMAIN}" =~ ^[0-9.]+$ ]]; then
  echo "A real wiki subdomain is required (e.g. docs.${APP_DOMAIN})." >&2
  exit 1
fi
OUTLINE_URL_PUBLIC="https://${OUTLINE_DOMAIN}"
note "Main domain        : ${APP_DOMAIN}"
note "Wiki (Outline)     : ${OUTLINE_URL_PUBLIC}"

OUTLINE_PORT="${OUTLINE_PORT:-$(env_get OUTLINE_PORT)}"; OUTLINE_PORT="${OUTLINE_PORT:-3500}"
OUTLINE_DB_NAME="${OUTLINE_DB_NAME:-$(env_get OUTLINE_DB_NAME)}"; OUTLINE_DB_NAME="${OUTLINE_DB_NAME:-outline}"
OUTLINE_DB_USER="${OUTLINE_DB_USER:-$(env_get OUTLINE_DB_USER)}"; OUTLINE_DB_USER="${OUTLINE_DB_USER:-outline}"
# Preserve generated secrets across reruns; generate on first install.
OUTLINE_DB_PASSWORD="${OUTLINE_DB_PASSWORD:-$(env_get OUTLINE_DB_PASSWORD)}"; OUTLINE_DB_PASSWORD="${OUTLINE_DB_PASSWORD:-$(rand)}"
OUTLINE_SECRET_KEY="${OUTLINE_SECRET_KEY:-$(env_get OUTLINE_SECRET_KEY)}"; OUTLINE_SECRET_KEY="${OUTLINE_SECRET_KEY:-$(openssl rand -hex 32)}"
OUTLINE_UTILS_SECRET="${OUTLINE_UTILS_SECRET:-$(env_get OUTLINE_UTILS_SECRET)}"; OUTLINE_UTILS_SECRET="${OUTLINE_UTILS_SECRET:-$(openssl rand -hex 32)}"
# OIDC client Outline uses against the api-server. Distinct from the Nextcloud
# client id so the api-server can resolve them independently.
OIDC_CLIENT_ID="${OIDC_CLIENT_ID:-$(env_get OIDC_CLIENT_ID)}"; OIDC_CLIENT_ID="${OIDC_CLIENT_ID:-coordina-outline}"
OIDC_CLIENT_SECRET="${OIDC_CLIENT_SECRET:-$(env_get OIDC_CLIENT_SECRET)}"; OIDC_CLIENT_SECRET="${OIDC_CLIENT_SECRET:-$(openssl rand -hex 24)}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"

# --- Write the compose .env (idempotent) -----------------------------------
log "Writing ${ENV_FILE}"
umask 077
cat > "${ENV_FILE}" <<EOF
APP_DOMAIN=${APP_DOMAIN}
OUTLINE_DOMAIN=${OUTLINE_DOMAIN}
OUTLINE_URL=${OUTLINE_URL_PUBLIC}
OUTLINE_PORT=${OUTLINE_PORT}
OUTLINE_DB_NAME=${OUTLINE_DB_NAME}
OUTLINE_DB_USER=${OUTLINE_DB_USER}
OUTLINE_DB_PASSWORD=${OUTLINE_DB_PASSWORD}
OUTLINE_SECRET_KEY=${OUTLINE_SECRET_KEY}
OUTLINE_UTILS_SECRET=${OUTLINE_UTILS_SECRET}
OIDC_CLIENT_ID=${OIDC_CLIENT_ID}
OIDC_CLIENT_SECRET=${OIDC_CLIENT_SECRET}
EOF
umask 022

# --- Host nginx subdomain (HTTP first, so certbot can complete the challenge) -
log "Configuring nginx server block for ${OUTLINE_DOMAIN}"
# Reuse the upgrade map from the main install; define a local fallback if absent.
if [[ ! -f /etc/nginx/conf.d/coordina-adg-upgrade.conf ]]; then
  cat > /etc/nginx/conf.d/coordina-adg-upgrade.conf <<'EOF'
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
EOF
fi
sed -e "s|__OUTLINE_SERVER_NAME__|${OUTLINE_DOMAIN}|g" \
    -e "s|__OUTLINE_PORT__|${OUTLINE_PORT}|g" \
    "${DEPLOY_DIR}/nginx-outline.conf.template" > /etc/nginx/sites-available/coordina-adg-outline
ln -sf /etc/nginx/sites-available/coordina-adg-outline /etc/nginx/sites-enabled/coordina-adg-outline
nginx -t
systemctl reload nginx

# --- Bring up the stack ----------------------------------------------------
log "Starting Outline + Postgres + Redis (docker compose up -d)"
( cd "${SCRIPT_DIR}" && docker compose pull && docker compose up -d )

# Wait for Outline to start serving (it runs DB migrations on first boot).
log "Waiting for Outline to become ready"
ready=0
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${OUTLINE_PORT}/"; then ready=1; break; fi
  sleep 5
done
[[ "${ready}" -eq 1 ]] || note "Outline did not answer on :${OUTLINE_PORT} yet; it may still be migrating. Check: docker compose -f ${SCRIPT_DIR}/docker-compose.yml logs -f outline"

# --- HTTPS for the subdomain ----------------------------------------------
if [[ -n "${LETSENCRYPT_EMAIL}" && ! "${OUTLINE_DOMAIN}" =~ ^[0-9.]+$ ]]; then
  log "Obtaining HTTPS certificate for ${OUTLINE_DOMAIN} (certbot)"
  if ! command -v certbot >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y certbot python3-certbot-nginx
  fi
  certbot --nginx -d "${OUTLINE_DOMAIN}" --non-interactive --agree-tos -m "${LETSENCRYPT_EMAIL}" --redirect || \
    note "certbot failed — the wiki still works over HTTP. Ensure DNS for ${OUTLINE_DOMAIN} points here, then re-run: certbot --nginx -d ${OUTLINE_DOMAIN}"
else
  note "No LETSENCRYPT_EMAIL — skipping HTTPS. SSO requires https; set FORCE_HTTPS only once a cert is in place."
fi

# --- Integrate with the main app automatically -----------------------------
# Write the connection details into the api-server's .env so the wiki works out
# of the box. The api-server resolves the Outline OIDC client (id+secret) and
# base URL from these env vars when no in-panel DB values are set. The Outline
# API token cannot be generated headlessly — it is created once in the Outline
# UI (Settings → API Tokens) and pasted into the control panel afterwards.
MAIN_ENV="${APP_DIR}/.env"
if [[ -f "${MAIN_ENV}" ]]; then
  log "Integrating with Coordina ADG (${MAIN_ENV})"
  set_main_env() {
    local key="$1" value="$2" tmp
    tmp="$(mktemp)"
    grep -v "^${key}=" "${MAIN_ENV}" > "${tmp}" || true
    printf '%s=%s\n' "${key}" "${value}" >> "${tmp}"
    cat "${tmp}" > "${MAIN_ENV}"
    rm -f "${tmp}"
  }
  set_main_env OUTLINE_URL "${OUTLINE_URL_PUBLIC}"
  set_main_env OUTLINE_OIDC_CLIENT_ID "${OIDC_CLIENT_ID}"
  set_main_env OUTLINE_OIDC_CLIENT_SECRET "${OIDC_CLIENT_SECRET}"
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
  log "Done! The documentation wiki is installed and integrated automatically."
  note "One manual step remains: create an Outline API token and paste it in the"
  note "control panel → Documentación (Settings → API Tokens in Outline)."
else
  log "Done! Paste these into the control panel → Documentación:"
fi
note "URL de Outline     : ${OUTLINE_URL_PUBLIC}"
note "OIDC Client ID     : ${OIDC_CLIENT_ID}"
note "OIDC Client Secret : ${OIDC_CLIENT_SECRET}"
note "API Token          : (create in Outline → Settings → API Tokens, then paste in the panel)"
