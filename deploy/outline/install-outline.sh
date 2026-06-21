#!/usr/bin/env bash
# ===========================================================================
# Coordina ADG — documentation wiki installer (Outline).
#
# Run AFTER the main deploy/install.sh (install.sh runs it automatically when a
# real HTTPS domain is present and the wiki is enabled). It:
#   - brings up the dockerized Outline + Postgres + Redis + MinIO stack (compose),
#   - configures dedicated host nginx server blocks for the wiki SUBDOMAIN
#     (Outline cannot be served from a subpath, so it needs its own subdomain)
#     and for the S3 storage SUBDOMAIN (MinIO, for browser-reachable file URLs),
#   - obtains HTTPS certificates for both subdomains (certbot),
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

# Storage (MinIO S3) subdomain. Outline mints pre-signed download URLs against
# this origin, so it must be browser-reachable; like the wiki it needs its own
# DNS record + certificate. Default to files.<main-domain>; allow override.
OUTLINE_S3_DOMAIN="${OUTLINE_S3_DOMAIN:-$(env_get OUTLINE_S3_DOMAIN)}"
if [[ -z "${OUTLINE_S3_DOMAIN}" ]]; then
  prompt_default OUTLINE_S3_DOMAIN "Storage subdomain (its own DNS record, e.g. files.${APP_DOMAIN})" "files.${APP_DOMAIN}"
fi
if [[ -z "${OUTLINE_S3_DOMAIN}" || "${OUTLINE_S3_DOMAIN}" =~ ^[0-9.]+$ ]]; then
  echo "A real storage subdomain is required (e.g. files.${APP_DOMAIN})." >&2
  exit 1
fi
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
# Decide the public scheme up front so the URL Outline bakes in, FORCE_HTTPS, and
# the nginx/certbot steps all agree. HTTPS only when we have an email to obtain a
# certificate (and a real, non-IP subdomain); otherwise serve plain HTTP so the
# wiki is still reachable (SSO needs https, so a certificate is recommended).
if [[ -n "${LETSENCRYPT_EMAIL}" && ! "${OUTLINE_DOMAIN}" =~ ^[0-9.]+$ ]]; then
  OUTLINE_SCHEME="https"; OUTLINE_FORCE_HTTPS="true"
else
  OUTLINE_SCHEME="http";  OUTLINE_FORCE_HTTPS="false"
fi
OUTLINE_URL_PUBLIC="${OUTLINE_SCHEME}://${OUTLINE_DOMAIN}"
# The storage (MinIO) origin must use the SAME scheme as Outline: when Outline
# forces https, pre-signed URLs are https and the browser would block mixed http.
OUTLINE_S3_PUBLIC_URL="${OUTLINE_SCHEME}://${OUTLINE_S3_DOMAIN}"
note "Main domain        : ${APP_DOMAIN}"
note "Wiki (Outline)     : ${OUTLINE_URL_PUBLIC}"
note "Storage (MinIO)    : ${OUTLINE_S3_PUBLIC_URL}"
[[ "${OUTLINE_SCHEME}" == "http" ]] && note "  (no HTTPS: set LETSENCRYPT_EMAIL to enable TLS — required for SSO login)"

OUTLINE_PORT="${OUTLINE_PORT:-$(env_get OUTLINE_PORT)}"; OUTLINE_PORT="${OUTLINE_PORT:-3500}"
# Interface the Outline/MinIO host ports bind to. Default loopback (reverse proxy
# on this same host). Set to this server's LAN IP when the proxy / Cloudflare
# Tunnel runs on a DIFFERENT machine and must reach the ports across the LAN.
# Read from the existing .env first so a rerun/update never silently reverts a
# manually-set LAN IP back to loopback (which re-breaks a cross-host tunnel).
OUTLINE_BIND_ADDR="${OUTLINE_BIND_ADDR:-$(env_get OUTLINE_BIND_ADDR)}"
if [[ -z "${OUTLINE_BIND_ADDR}" ]]; then
  prompt_default OUTLINE_BIND_ADDR "Bind address for Outline/MinIO ports (use this server's LAN IP if the reverse proxy / Cloudflare Tunnel runs on another host)" "127.0.0.1"
fi
# Address the local nginx block and the readiness probe use to reach the
# container. 0.0.0.0 binds all interfaces (incl. loopback), so target 127.0.0.1.
UPSTREAM_ADDR="${OUTLINE_BIND_ADDR}"; [[ "${UPSTREAM_ADDR}" == "0.0.0.0" ]] && UPSTREAM_ADDR="127.0.0.1"
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
# S3 (MinIO) storage settings. Preserve the generated secret across reruns.
OUTLINE_S3_PORT="${OUTLINE_S3_PORT:-$(env_get OUTLINE_S3_PORT)}"; OUTLINE_S3_PORT="${OUTLINE_S3_PORT:-3501}"
OUTLINE_S3_BUCKET="${OUTLINE_S3_BUCKET:-$(env_get OUTLINE_S3_BUCKET)}"; OUTLINE_S3_BUCKET="${OUTLINE_S3_BUCKET:-outline}"
OUTLINE_S3_REGION="${OUTLINE_S3_REGION:-$(env_get OUTLINE_S3_REGION)}"; OUTLINE_S3_REGION="${OUTLINE_S3_REGION:-us-east-1}"
OUTLINE_S3_ACCESS_KEY="${OUTLINE_S3_ACCESS_KEY:-$(env_get OUTLINE_S3_ACCESS_KEY)}"; OUTLINE_S3_ACCESS_KEY="${OUTLINE_S3_ACCESS_KEY:-coordina-outline}"
OUTLINE_S3_SECRET_KEY="${OUTLINE_S3_SECRET_KEY:-$(env_get OUTLINE_S3_SECRET_KEY)}"; OUTLINE_S3_SECRET_KEY="${OUTLINE_S3_SECRET_KEY:-$(openssl rand -hex 24)}"

# --- Write the compose .env (idempotent) -----------------------------------
log "Writing ${ENV_FILE}"
umask 077
cat > "${ENV_FILE}" <<EOF
APP_DOMAIN=${APP_DOMAIN}
OUTLINE_DOMAIN=${OUTLINE_DOMAIN}
OUTLINE_URL=${OUTLINE_URL_PUBLIC}
OUTLINE_FORCE_HTTPS=${OUTLINE_FORCE_HTTPS}
OUTLINE_PORT=${OUTLINE_PORT}
OUTLINE_BIND_ADDR=${OUTLINE_BIND_ADDR}
OUTLINE_DB_NAME=${OUTLINE_DB_NAME}
OUTLINE_DB_USER=${OUTLINE_DB_USER}
OUTLINE_DB_PASSWORD=${OUTLINE_DB_PASSWORD}
OUTLINE_SECRET_KEY=${OUTLINE_SECRET_KEY}
OUTLINE_UTILS_SECRET=${OUTLINE_UTILS_SECRET}
OIDC_CLIENT_ID=${OIDC_CLIENT_ID}
OIDC_CLIENT_SECRET=${OIDC_CLIENT_SECRET}
OUTLINE_S3_DOMAIN=${OUTLINE_S3_DOMAIN}
OUTLINE_S3_PUBLIC_URL=${OUTLINE_S3_PUBLIC_URL}
OUTLINE_S3_PORT=${OUTLINE_S3_PORT}
OUTLINE_S3_BUCKET=${OUTLINE_S3_BUCKET}
OUTLINE_S3_REGION=${OUTLINE_S3_REGION}
OUTLINE_S3_ACCESS_KEY=${OUTLINE_S3_ACCESS_KEY}
OUTLINE_S3_SECRET_KEY=${OUTLINE_S3_SECRET_KEY}
EOF
umask 022

# --- Host nginx subdomain (HTTP first, so certbot can complete the challenge) -
log "Configuring nginx server blocks for ${OUTLINE_DOMAIN} and ${OUTLINE_S3_DOMAIN}"
# Reuse the upgrade map from the main install; define a local fallback if absent.
if [[ ! -f /etc/nginx/conf.d/coordina-adg-upgrade.conf ]]; then
  cat > /etc/nginx/conf.d/coordina-adg-upgrade.conf <<'EOF'
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
EOF
fi
sed -e "s|__OUTLINE_SERVER_NAME__|${OUTLINE_DOMAIN}|g" \
    -e "s|__OUTLINE_PORT__|${OUTLINE_PORT}|g" \
    -e "s|__OUTLINE_S3_SERVER_NAME__|${OUTLINE_S3_DOMAIN}|g" \
    -e "s|__OUTLINE_S3_PORT__|${OUTLINE_S3_PORT}|g" \
    -e "s|__OUTLINE_UPSTREAM_ADDR__|${UPSTREAM_ADDR}|g" \
    "${DEPLOY_DIR}/nginx-outline.conf.template" > /etc/nginx/sites-available/coordina-adg-outline
ln -sf /etc/nginx/sites-available/coordina-adg-outline /etc/nginx/sites-enabled/coordina-adg-outline
nginx -t
systemctl reload nginx

# --- Bring up the stack ----------------------------------------------------
log "Starting Outline + Postgres + Redis + MinIO (docker compose up -d)"
( cd "${SCRIPT_DIR}" && docker compose pull && docker compose up -d )

# Wait for Outline to start serving (it runs DB migrations on first boot).
log "Waiting for Outline to become ready"
ready=0
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null "http://${UPSTREAM_ADDR}:${OUTLINE_PORT}/"; then ready=1; break; fi
  sleep 5
done
[[ "${ready}" -eq 1 ]] || note "Outline did not answer on ${UPSTREAM_ADDR}:${OUTLINE_PORT} yet; it may still be migrating. Check: docker compose -f ${SCRIPT_DIR}/docker-compose.yml logs -f outline"

# --- HTTPS for the subdomains ---------------------------------------------
if [[ -n "${LETSENCRYPT_EMAIL}" && ! "${OUTLINE_DOMAIN}" =~ ^[0-9.]+$ ]]; then
  log "Obtaining HTTPS certificate for ${OUTLINE_DOMAIN} and ${OUTLINE_S3_DOMAIN} (certbot)"
  if ! command -v certbot >/dev/null 2>&1; then
    apt-get update -y && apt-get install -y certbot python3-certbot-nginx
  fi
  certbot --nginx -d "${OUTLINE_DOMAIN}" -d "${OUTLINE_S3_DOMAIN}" --non-interactive --agree-tos -m "${LETSENCRYPT_EMAIL}" --redirect || \
    note "certbot failed — Outline is configured for https (FORCE_HTTPS) so it is NOT usable until certs are issued. Ensure DNS for ${OUTLINE_DOMAIN} and ${OUTLINE_S3_DOMAIN} point here, then re-run: sudo bash deploy/outline/install-outline.sh"
else
  note "No LETSENCRYPT_EMAIL — serving the wiki and storage over plain HTTP."
  note "SSO login requires https; set LETSENCRYPT_EMAIL and re-run to enable TLS."
fi

# --- Integrate with the main app automatically -----------------------------
# Write the connection details into the api-server's .env so the wiki works out
# of the box. The api-server resolves the Outline OIDC client (id+secret) and
# base URL from these env vars when no in-panel DB values are set. SSO login
# already works with just these (URL + OIDC client). The Outline API token —
# which enables the per-module collections — cannot be generated headlessly: log
# into Outline once from the platform (Recursos → Documentación), create it under
# Settings → API Tokens, and paste it into the control panel afterwards.
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
  note "SSO login already works. To finish enabling the per-module wikis:"
  note "  1) In Coordina ADG open Recursos → Documentación and click any module"
  note "     (you are signed into Outline automatically — first user = admin)."
  note "  2) In Outline: Settings → API Tokens → create a token."
  note "  3) Paste it into the control panel → Documentación and save."
else
  log "Done! Paste these into the control panel → Documentación:"
fi
note "URL de Outline     : ${OUTLINE_URL_PUBLIC}"
note "OIDC Client ID     : ${OIDC_CLIENT_ID}"
note "OIDC Client Secret : ${OIDC_CLIENT_SECRET}"
note "API Token          : (create in Outline → Settings → API Tokens, then paste in the panel)"
