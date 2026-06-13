#!/usr/bin/env bash
# ===========================================================================
# Coordina ADG — collaborative space installer (Nextcloud + Collabora).
#
# Run AFTER the main deploy/install.sh (install.sh runs it automatically when a
# real HTTPS domain is present). It:
#   - brings up the dockerized Nextcloud + Collabora stack (compose),
#   - configures host nginx subpaths (/nextcloud, /collabora) on the main domain,
#   - installs/enables the Nextcloud apps used by the platform
#     (group folders + OIDC login) and registers the OIDC provider,
#   - writes the connection details into the main app .env and restarts it, so
#     the integration works automatically (no manual control-panel step).
#
# Safe to re-run (idempotent). Usage from the repo root:
#   sudo bash deploy/nextcloud/install-collab.sh
# You only need the MAIN app domain: Nextcloud and Collabora are served as
# subpaths of it (https://<domain>/nextcloud and https://<domain>/collabora), so
# no extra subdomains or DNS records are required, and HTTPS is covered by the
# main domain's certificate. On a standalone run the domain is auto-detected from
# the main app .env.
#
# Non-interactive: pass just the main domain, e.g.
#   sudo APP_DOMAIN=adg.example.org \
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
# Collabora are served as subpaths of it (https://<domain>/nextcloud and
# https://<domain>/collabora), so a single domain is enough and the SSO cookie
# is naturally shared (same origin). install.sh passes APP_DOMAIN; on a
# standalone run we auto-detect it from the main app .env, and only ask if we
# still can't find it.
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
  echo "The collaborative space is served as subpaths of it over HTTPS." >&2
  exit 1
fi
# Public base URLs — subpaths of the single main domain.
NEXTCLOUD_URL_PUBLIC="https://${APP_DOMAIN}/nextcloud"
COLLABORA_URL_PUBLIC="https://${APP_DOMAIN}/collabora"
note "Main domain        : ${APP_DOMAIN}"
note "Nextcloud (Drive)  : ${NEXTCLOUD_URL_PUBLIC}"
note "Collabora (Office) : ${COLLABORA_URL_PUBLIC}"

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
APP_DOMAIN=${APP_DOMAIN}
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
# Subpath install: only the main domain is trusted, and the overwrite.* values
# make Nextcloud generate URLs under /nextcloud. Set them via occ too (not just
# compose env) so reruns — and migrations from an older drive./office. subdomain
# install — are corrected: the image only applies the OVERWRITE* env on first
# install.
occ config:system:set trusted_domains 0 --value="${APP_DOMAIN}" >/dev/null || true
# Trust the loopback host:port too, so the api-server can call the OCS admin API
# directly at http://127.0.0.1:${NEXTCLOUD_PORT} (bypassing the public proxy /
# tunnel) without Nextcloud rejecting it as an untrusted domain.
occ config:system:set trusted_domains 1 --value="127.0.0.1:${NEXTCLOUD_PORT}" >/dev/null || true
occ config:system:set overwritehost --value="${APP_DOMAIN}" >/dev/null || true
occ config:system:set overwriteprotocol --value="https" >/dev/null || true
occ config:system:set overwritewebroot --value="/nextcloud" >/dev/null || true
occ config:system:set overwrite.cli.url --value="${NEXTCLOUD_URL_PUBLIC}" >/dev/null || true
occ config:system:set trusted_proxies 0 --value="127.0.0.1" >/dev/null || true
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
occ config:app:set richdocuments wopi_url --value="${COLLABORA_URL_PUBLIC}" >/dev/null 2>&1 || true

# --- Brand the workspace + trim the UI (idempotent) ------------------------
log "Branding Nextcloud and trimming the UI to the module workspace"
occ app:enable theming >/dev/null 2>&1 || true
occ theming:config name "Coordina ADG" >/dev/null 2>&1 || true
# Primary brand colour. The config key was renamed across NC versions, so try
# the newer name first and fall back to the older one.
occ theming:config primary_color "#0050b3" >/dev/null 2>&1 || \
  occ theming:config color "#0050b3" >/dev/null 2>&1 || true
# Push the app logo into the container, then register it with the Theming app:
# the colour logo for the (light) login page, the white logo for the coloured
# top bar.
nc_cp()    { docker compose -f "${SCRIPT_DIR}/docker-compose.yml" cp "$1" "nextcloud:$2" >/dev/null 2>&1 || true; }
nc_chown() { docker compose -f "${SCRIPT_DIR}/docker-compose.yml" exec -T -u root nextcloud chown www-data:www-data "$1" >/dev/null 2>&1 || true; }
if [[ -f "${SCRIPT_DIR}/brand-logo.png" ]]; then
  nc_cp "${SCRIPT_DIR}/brand-logo.png" /tmp/brand-logo.png
  nc_chown /tmp/brand-logo.png
  occ theming:config logo /tmp/brand-logo.png >/dev/null 2>&1 || true
fi
if [[ -f "${SCRIPT_DIR}/brand-logo-white.png" ]]; then
  nc_cp "${SCRIPT_DIR}/brand-logo-white.png" /tmp/brand-logo-white.png
  nc_chown /tmp/brand-logo-white.png
  occ theming:config logoheader /tmp/brand-logo-white.png >/dev/null 2>&1 || true
fi
# Centre the workspace on the module folder: land users in Files (the SSO link
# already deep-links into their module group folder) and remove the Dashboard
# and Photos sections so the space is just the module folder.
occ config:system:set defaultapp --value=files >/dev/null 2>&1 || true
occ app:disable dashboard >/dev/null 2>&1 || true
occ app:disable photos    >/dev/null 2>&1 || true

# Surface silent no-ops: the steps above are best-effort (|| true) so a deploy is
# never aborted by them, but warn loudly if the trims/branding did not stick.
enabled_apps="$(occ app:list --enabled 2>/dev/null || true)"
case "${enabled_apps}" in
  *dashboard*) note "Nextcloud 'dashboard' is still enabled — disable manually: occ app:disable dashboard" ;;
esac
case "${enabled_apps}" in
  *photos*) note "Nextcloud 'photos' is still enabled — disable manually: occ app:disable photos" ;;
esac
case "$(occ theming:config name 2>/dev/null || true)" in
  *Coordina*) : ;;
  *) note "Could not confirm Nextcloud branding was applied — set name/logo in Nextcloud admin → Theming if missing." ;;
esac

# --- Host nginx subpaths ---------------------------------------------------
log "Configuring nginx subpaths (/nextcloud, /collabora) on ${APP_DOMAIN}"
# Reuse the upgrade map from the main install; define a local fallback if absent.
if [[ ! -f /etc/nginx/conf.d/coordina-adg-upgrade.conf ]]; then
  cat > /etc/nginx/conf.d/coordina-adg-upgrade.conf <<'EOF'
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
EOF
fi
# Render the location blocks into a snippet that the main site's server block
# includes (via a wildcard include). No separate server block — and no separate
# certbot run — is needed: HTTPS comes from the main domain's certificate.
mkdir -p /etc/nginx/snippets
sed -e "s|__NEXTCLOUD_PORT__|${NEXTCLOUD_PORT}|g" \
    -e "s|__COLLABORA_PORT__|${COLLABORA_PORT}|g" \
    "${DEPLOY_DIR}/nginx-collab.conf.template" > /etc/nginx/snippets/coordina-adg-collab-locations.conf

# Remove any stale subdomain server block from an older drive./office. install.
rm -f /etc/nginx/sites-enabled/coordina-adg-collab /etc/nginx/sites-available/coordina-adg-collab

# Ensure the main site config actually includes the snippet. Fresh installs get
# it from nginx-site.conf.template; installs created before subpaths existed need
# the include injected before the SPA catch-all `location / {` block (mirrors how
# update.sh patches this file in place).
MAIN_NGINX="/etc/nginx/sites-available/coordina-adg"
if [[ -f "${MAIN_NGINX}" ]] && ! grep -q "coordina-adg-collab-\*.conf" "${MAIN_NGINX}"; then
  log "Adding the collaborative-space include to ${MAIN_NGINX}"
  awk '
    /location \/ \{/ && !done {
      print "    include /etc/nginx/snippets/coordina-adg-collab-*.conf;";
      print "";
      done=1
    }
    { print }
  ' "${MAIN_NGINX}" > "${MAIN_NGINX}.tmp" && mv "${MAIN_NGINX}.tmp" "${MAIN_NGINX}"
fi
nginx -t
systemctl reload nginx

# --- HTTPS -----------------------------------------------------------------
# No separate certificate is required: the collaborative space lives on the main
# domain as subpaths (/nextcloud, /collabora), already covered by its TLS cert.

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
  set_main_env NEXTCLOUD_URL "${NEXTCLOUD_URL_PUBLIC}"
  # Admin OCS calls go straight to the local Nextcloud over loopback, avoiding a
  # public round-trip (and proxies/tunnels that don't route /ocs). NEXTCLOUD_URL
  # stays the public URL used for browser-facing links/SSO.
  set_main_env NEXTCLOUD_ADMIN_URL "http://127.0.0.1:${NEXTCLOUD_PORT}"
  set_main_env COLLABORA_URL "${COLLABORA_URL_PUBLIC}"
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
note "URL de Nextcloud   : ${NEXTCLOUD_URL_PUBLIC}"
note "URL de Collabora   : ${COLLABORA_URL_PUBLIC}"
note "Usuario admin      : ${NEXTCLOUD_ADMIN_USER}"
note "Contraseña admin   : ${NEXTCLOUD_ADMIN_PASSWORD}"
note "OIDC Client ID     : ${OIDC_CLIENT_ID}"
note "OIDC Client Secret : ${OIDC_CLIENT_SECRET}"
