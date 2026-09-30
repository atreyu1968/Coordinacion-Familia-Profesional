#!/usr/bin/env bash
# ===========================================================================
# Coordina ADG — update an existing installation to the latest code.
# Pulls the newest commit, reinstalls, rebuilds, applies schema changes and
# restarts the service. Run from the repo root: sudo bash deploy/update.sh
# ===========================================================================
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/update.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${APP_DIR}"

SERVICE_USER="${SERVICE_USER:-${SUDO_USER:-root}}"
ENV_FILE="${APP_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "No .env found at ${ENV_FILE}. Run deploy/install.sh first." >&2
  exit 1
fi

NGINX_CONF="/etc/nginx/sites-available/coordina-adg"

# shellcheck disable=SC1090
DATABASE_URL="$(grep '^DATABASE_URL=' "${ENV_FILE}" | head -n1 | cut -d= -f2- || true)"
export DATABASE_URL SERVICE_USER
if [[ -z "${DATABASE_URL}" ]]; then
  echo "DATABASE_URL is missing from ${ENV_FILE}; database migration cannot proceed." >&2
  exit 1
fi
# Honor values passed on the command line (e.g. sudo DOMAIN=adg.example.org ...
# or MOBILE_WEB_URL=...), falling back to whatever is already in .env.
MOBILE_WEB_URL="${MOBILE_WEB_URL:-$(grep '^MOBILE_WEB_URL=' "${ENV_FILE}" | head -n1 | cut -d= -f2-)}"
PUBLIC_APP_URL="${PUBLIC_APP_URL:-$(grep '^PUBLIC_APP_URL=' "${ENV_FILE}" | head -n1 | cut -d= -f2-)}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-$(grep '^LETSENCRYPT_EMAIL=' "${ENV_FILE}" | head -n1 | cut -d= -f2-)}"
API_PORT="$(grep '^PORT=' "${ENV_FILE}" | head -n1 | cut -d= -f2- || true)"
API_PORT="${API_PORT:-3001}"
DOMAIN="${DOMAIN:-}"

is_tty() { [[ -t 0 ]]; }
url_host() { printf '%s' "$1" | sed -E 's#^https?://##; s#/.*$##'; }
url_path() { printf '%s' "$1" | sed -E 's#^https?://[^/]+##; s#/$##'; }
# Normalize a host (trim ends + lowercase) and echo it back only when it is a
# valid public DNS domain (a-z, 0-9, dots, hyphens; at least two labels). Echoes
# empty for "_"/localhost/bare IPs and anything invalid (uppercase, accents,
# internal spaces, typos). grep runs under LC_ALL=C so a-z matches by byte and
# accented UTF-8 letters are rejected even under a UTF-8 locale.
clean_domain() {
  local h
  h="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
  case "${h}" in _|localhost) return 0 ;; esac
  [[ "${h}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && return 0
  LC_ALL=C grep -qE '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]*[a-z0-9])?$' <<<"${h}" \
    && printf '%s' "${h}"
}

# Upsert KEY=VALUE in .env without sed-escaping pitfalls and without leaving
# duplicate lines behind: drop every existing line for the key, then append one.
set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" "${ENV_FILE}" > "${tmp}" || true
  printf '%s=%s\n' "${key}" "${value}" >> "${tmp}"
  cat "${tmp}" > "${ENV_FILE}"
  rm -f "${tmp}"
}

# The domain set in the app's control panel is stored in the DATABASE, not in
# .env. Read it so an update can build and publish the mobile app (/app) using
# whatever the admin configured there, even when .env was never updated.
DB_MOBILE_WEB_URL=""
if [[ -n "${DATABASE_URL}" ]]; then
  # Best-effort: a transient DB outage or an older schema (missing column) must
  # NOT abort the update before git pull / schema push, so swallow any failure.
  DB_MOBILE_WEB_URL="$(DATABASE_URL="${DATABASE_URL}" bash "${SCRIPT_DIR}/db.sh" mobile-url 2>/dev/null)" || \
    DB_MOBILE_WEB_URL=""
fi

# Resolve the public host (and sub-path) the mobile app should be built for, in
# priority order: explicit MOBILE_WEB_URL, the control-panel value (DB),
# PUBLIC_APP_URL, an explicit DOMAIN= override, then the nginx server_name.
# e.g. https://adg.example.org/app -> host "adg.example.org", path "/app".
MOBILE_HOST="$(url_host "${MOBILE_WEB_URL}")"
MOBILE_PATH="$(url_path "${MOBILE_WEB_URL}")"
if [[ -z "${MOBILE_HOST}" && -n "${DB_MOBILE_WEB_URL}" ]]; then
  MOBILE_HOST="$(url_host "${DB_MOBILE_WEB_URL}")"
  MOBILE_PATH="$(url_path "${DB_MOBILE_WEB_URL}")"
fi
if [[ -z "${MOBILE_HOST}" ]]; then
  MOBILE_HOST="$(url_host "${PUBLIC_APP_URL}")"
fi
if [[ -z "${MOBILE_HOST}" && -n "${DOMAIN}" ]]; then
  MOBILE_HOST="$(url_host "${DOMAIN}")"
fi
if [[ -z "${MOBILE_HOST}" && -f "${NGINX_CONF}" ]]; then
  MOBILE_HOST="$(grep -E '^[[:space:]]*server_name' "${NGINX_CONF}" | head -n1 | sed -E 's/.*server_name[[:space:]]+//; s/;.*//; s/[[:space:]].*//')"
fi
# A real domain is required for the PWA to install and receive push; reduce the
# fully-resolved host to a valid public domain (empty for "_", localhost, bare
# IPs, or any invalid value such as uppercase/accents/typos).
MOBILE_HOST="$(clean_domain "${MOBILE_HOST}")"
# If no real domain was ever configured, ask for it now (interactive runs only)
# so this update can build the mobile app (/app) and install the collaborative
# space. Non-interactive runs (e.g. cron) keep the old behavior and skip these
# domain-only steps. Pass DOMAIN=... to set it without a prompt.
if [[ -z "${MOBILE_HOST}" ]]; then
  RAW_DOMAIN=""
  if [[ -n "${DOMAIN}" ]]; then
    RAW_DOMAIN="${DOMAIN}"
  elif is_tty; then
    read -r -p "Public domain for Coordina ADG (e.g. adg.example.org), blank to skip: " RAW_DOMAIN || true
  fi
  MOBILE_HOST="$(clean_domain "$(url_host "${RAW_DOMAIN}")")"
  if [[ -n "${RAW_DOMAIN}" && -z "${MOBILE_HOST}" ]]; then
    echo "Ignoring invalid domain '${RAW_DOMAIN}' (use e.g. adg.example.org)." >&2
  fi
fi
if [[ -n "${MOBILE_HOST}" && -z "${MOBILE_PATH}" ]]; then
  MOBILE_PATH="/app"
fi
if [[ -n "${MOBILE_HOST}" && -n "${MOBILE_PATH}" ]]; then
  DESIRED_MOBILE_WEB_URL="https://${MOBILE_HOST}${MOBILE_PATH}"
  if [[ "${DESIRED_MOBILE_WEB_URL}" != "${MOBILE_WEB_URL}" ]]; then
    echo "==> Setting MOBILE_WEB_URL=${DESIRED_MOBILE_WEB_URL} in .env"
    set_env MOBILE_WEB_URL "${DESIRED_MOBILE_WEB_URL}"
    MOBILE_WEB_URL="${DESIRED_MOBILE_WEB_URL}"
  fi
  # Keep PUBLIC_APP_URL (absolute links / stored-file URLs) pointing at the same
  # domain, de-duplicating any older or blank entries. Only fill it when unset.
  if [[ -z "${PUBLIC_APP_URL}" ]]; then
    echo "==> Setting PUBLIC_APP_URL=https://${MOBILE_HOST} in .env"
    set_env PUBLIC_APP_URL "https://${MOBILE_HOST}"
    PUBLIC_APP_URL="https://${MOBILE_HOST}"
  fi
fi

run_as_user() {
  if [[ "${SERVICE_USER}" == "root" ]]; then bash -lc "$*"; else sudo -u "${SERVICE_USER}" -H bash -lc "$*"; fi
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

echo "==> Pulling latest code"
run_as_user "cd '${APP_DIR}' && git pull --ff-only"

echo "==> Installing dependencies"
run_as_user "cd '${APP_DIR}' && pnpm install --frozen-lockfile"

echo "==> Backing up and migrating the database"
run_db_helper backup
run_db_helper prepare
run_db_helper apply

echo "==> Preloading reference data (provinces, islands, municipalities, FP centers)"
run_as_user_preserving_env "DATABASE_URL" \
  "cd '${APP_DIR}' && pnpm --filter @workspace/scripts run seed-reference-data"

if [[ "${SEED_TEST_TEACHERS:-no}" =~ ^[yY]([eE][sS])?$ ]]; then
  echo "==> Seeding test teachers (Administración y Gestión)"
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

# Keep the previous API output in a mode-700 temporary directory until the new
# service passes its database-backed readiness check. Only the API build tree
# is restored here; dependencies and PostgreSQL are not automatically rolled back.
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

echo "==> Building web + API"
run_as_user "cd '${APP_DIR}' && PORT=5173 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/web run build"
API_BUILD_STARTED=1
run_as_user "cd '${APP_DIR}' && pnpm --filter @workspace/api-server run build"

# Rebuild the mobile app (PWA) when it is configured to live under a sub-path on
# this server (e.g. https://DOMAIN/app). Skipped for blank or root URLs.
BUILD_MOBILE=0
if [[ -n "${MOBILE_HOST}" && -n "${MOBILE_PATH}" ]]; then
  echo "==> Building the mobile app (PWA) for ${MOBILE_PATH}"
  # This runs before static publication so a failed build leaves the live web/PWA
  # untouched, and the API EXIT handler restores the previous API distribution.
  run_as_user "cd '${APP_DIR}' && EXPO_PUBLIC_DOMAIN='${MOBILE_HOST}' EXPO_PUBLIC_BASE_PATH='${MOBILE_PATH}' pnpm --filter @workspace/movil run build:web"
  if [[ ! -f "${APP_DIR}/artifacts/movil/dist/index.html" ]]; then
    echo "ERROR: mobile build produced no index.html; aborting before touching the live site." >&2
    exit 1
  fi
  BUILD_MOBILE=1
fi

# Keep the current web tree and nginx configuration until the new API passes its
# database-backed readiness check. Failed API builds/readiness restore the saved
# distribution; database changes and installed dependencies are not rolled back.
WEB_ROOT="/var/www/coordina-adg"
WEB_PARENT="$(dirname "${WEB_ROOT}")"
mkdir -p "${WEB_PARENT}"
WEB_STAGE="$(mktemp -d "${WEB_PARENT}/.coordina-adg.stage.XXXXXX")"
WEB_PREVIOUS="${WEB_PARENT}/.coordina-adg.previous.$$"
NGINX_BACKUP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/coordina-nginx.XXXXXX")"
NGINX_BACKUP="${NGINX_BACKUP_DIR}/coordina-adg"
NGINX_WAS_PRESENT=0
NGINX_TOUCHED=0
PUBLISH_STARTED=0
if [[ -e "${NGINX_CONF}" || -L "${NGINX_CONF}" ]]; then
  cp -a -- "${NGINX_CONF}" "${NGINX_BACKUP}"
  NGINX_WAS_PRESENT=1
fi

cleanup_update() {
  local status=$?
  trap - EXIT
  restore_api_dist_on_failure "${status}"
  if [[ "${status}" -ne 0 && ( "${API_HEALTHY}" -eq 1 || "${API_BUILD_STARTED}" -eq 0 ) ]]; then
    echo "WARNING: PostgreSQL changes and installed dependencies are not automatically rolled back; use the pre-migration database backup and matching previous code if needed." >&2
  fi
  if [[ "${status}" -ne 0 && "${PUBLISH_STARTED}" -eq 1 ]]; then
    echo "==> Update failed after publication began; restoring previous web files and nginx configuration." >&2
    if [[ -e "${WEB_ROOT}" || -L "${WEB_ROOT}" ]]; then
      rm -rf -- "${WEB_ROOT}"
    fi
    if [[ -e "${WEB_PREVIOUS}" || -L "${WEB_PREVIOUS}" ]]; then
      mv -- "${WEB_PREVIOUS}" "${WEB_ROOT}" || \
        echo "ERROR: could not restore the previous web root from ${WEB_PREVIOUS}." >&2
    fi
    if [[ "${NGINX_TOUCHED}" -eq 1 ]]; then
      if [[ "${NGINX_WAS_PRESENT}" -eq 1 ]]; then
        cp -a -- "${NGINX_BACKUP}" "${NGINX_CONF}" || \
          echo "ERROR: could not restore the previous nginx configuration." >&2
      else
        rm -f -- "${NGINX_CONF}"
      fi
      if nginx -t >/dev/null 2>&1; then
        systemctl reload nginx >/dev/null 2>&1 || \
          echo "ERROR: could not reload nginx with its restored configuration." >&2
      else
        echo "ERROR: restored nginx configuration did not pass nginx -t; inspect ${NGINX_CONF}." >&2
      fi
    fi
    echo "WARNING: PostgreSQL changes and the API build/service are not automatically rolled back; use the pre-migration backup and matching previous code if needed." >&2
  fi
  if [[ -d "${WEB_STAGE}" ]]; then rm -rf -- "${WEB_STAGE}"; fi
  if [[ -d "${NGINX_BACKUP_DIR}" ]]; then rm -rf -- "${NGINX_BACKUP_DIR}"; fi
  if [[ -d "${API_BACKUP_DIR}" && "${API_RESTORE_FAILED}" -eq 0 ]]; then rm -rf -- "${API_BACKUP_DIR}"; fi
  if [[ "${API_RESTORE_FAILED}" -eq 1 ]]; then
    echo "WARNING: the protected API distribution backup remains at ${API_BACKUP_DIR}." >&2
  fi
  exit "${status}"
}
trap cleanup_update EXIT

# Migrate older installs whose nginx root still points inside the repo (e.g.
# /root/... or /home/user/...) — those home dirs are not traversable by www-data.
cp -a "${APP_DIR}/artifacts/web/dist/public/." "${WEB_STAGE}/"
if [[ "${BUILD_MOBILE}" -eq 1 ]]; then
  echo "==> Staging the mobile app at ${MOBILE_PATH}"
  mkdir -p "${WEB_STAGE}${MOBILE_PATH}"
  cp -a "${APP_DIR}/artifacts/movil/dist/." "${WEB_STAGE}${MOBILE_PATH}/"
elif [[ -d "${WEB_ROOT}/app" ]]; then
  # Preserve the existing PWA when an update has no resolvable public domain.
  cp -a "${WEB_ROOT}/app" "${WEB_STAGE}/app"
fi
chown -R www-data:www-data "${WEB_STAGE}"

echo "==> Restarting service"
API_RESTART_ATTEMPTED=1
systemctl restart coordina-adg.service
systemctl is-active --quiet coordina-adg.service || {
  echo "ERROR: coordina-adg.service is not active after restart." >&2
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

PUBLISH_STARTED=1
if [[ -e "${WEB_ROOT}" ]]; then
  mv "${WEB_ROOT}" "${WEB_PREVIOUS}"
fi
if ! mv "${WEB_STAGE}" "${WEB_ROOT}"; then
  echo "ERROR: could not publish staged web assets; the failure handler will restore the previous files." >&2
  exit 1
fi

# Migrate older installs whose nginx root still points inside the repo and
# backfill the mobile-app route. Preserve existing TLS/SSL directives.
if [[ -f "${NGINX_CONF}" ]]; then
  NGINX_TOUCHED=1
  echo "==> Ensuring nginx serves from ${WEB_ROOT}"
  sed -i -E "s#^([[:space:]]*)root[[:space:]]+[^;]*;#\\1root ${WEB_ROOT};#" "${NGINX_CONF}"
  # Replace the catch-all server_name "_" with the real domain once we know it,
  # so HTTPS (certbot) and host-based features work. Behind Cloudflare this is
  # harmless: with a single server block nginx still serves any incoming Host.
  if [[ -n "${MOBILE_HOST}" ]] && grep -qE '^[[:space:]]*server_name[[:space:]]+_;' "${NGINX_CONF}"; then
    echo "==> Setting nginx server_name to ${MOBILE_HOST}"
    sed -i -E "s#^([[:space:]]*)server_name[[:space:]]+_;#\\1server_name ${MOBILE_HOST};#" "${NGINX_CONF}"
  fi
  # Backfill the mobile-app route for installs created before the PWA existed.
  # Path-aware so it matches whatever sub-path MOBILE_WEB_URL points to.
  if [[ "${BUILD_MOBILE}" -eq 1 ]] && ! grep -q "location ${MOBILE_PATH}/" "${NGINX_CONF}"; then
    echo "==> Adding the ${MOBILE_PATH} route to nginx for the mobile app"
    awk -v p="${MOBILE_PATH}" '
      /location \/ \{/ && !done {
        print "    location = " p " { return 301 " p "/; }";
        print "    location " p "/ {";
        print "        try_files $uri $uri/ " p "/index.html;";
        print "    }";
        print "";
        done=1
      }
      { print }
    ' "${NGINX_CONF}" > "${NGINX_CONF}.tmp" && mv "${NGINX_CONF}.tmp" "${NGINX_CONF}"
  fi
  nginx -t
  systemctl reload nginx
fi

rm -rf -- "${WEB_PREVIOUS}"
PUBLISH_STARTED=0

# Collaborative space (Nextcloud + Collabora). install-collab.sh is idempotent.
#  - If it was already installed (its .env exists), refresh it.
#  - If it was never installed but we now have a real domain, install it (default
#    yes, matching install.sh). Opt out with INSTALL_COLLAB=no.
COLLAB_DIR="${SCRIPT_DIR}/nextcloud"
COLLAB_ENV="${COLLAB_DIR}/.env"
if [[ -f "${COLLAB_ENV}" ]]; then
  echo "==> Updating the collaborative space (Nextcloud + Collabora)"
  bash "${COLLAB_DIR}/install-collab.sh" || \
    echo "WARNING: collaborative space update failed; re-run deploy/nextcloud/install-collab.sh" >&2
elif [[ -n "${MOBILE_HOST}" ]]; then
  WANT_COLLAB="${INSTALL_COLLAB:-yes}"
  if is_tty && [[ -z "${INSTALL_COLLAB:-}" ]]; then
    read -r -p "Install the collaborative space (Nextcloud + Collabora)? [yes/no] [yes]: " WANT_COLLAB || true
    WANT_COLLAB="${WANT_COLLAB:-yes}"
  fi
  if [[ "${WANT_COLLAB}" =~ ^[yY]([eE][sS])?$ ]]; then
    # The collaborative space is served as subpaths (/nextcloud, /collabora) of
    # the main domain, so it needs no certificate of its own — it reuses the main
    # domain's HTTPS certificate.
    echo "==> Installing the collaborative space (Nextcloud + Collabora)"
    APP_DOMAIN="${MOBILE_HOST}" \
      bash "${COLLAB_DIR}/install-collab.sh" || \
      echo "WARNING: collaborative space install failed; re-run deploy/nextcloud/install-collab.sh" >&2
  fi
else
  echo "==> Skipping the collaborative space (no public domain configured)."
fi

# Outline is deliberately untouched during ordinary app updates. Set
# INSTALL_WIKI=yes to explicitly install or update it; unlike the collaborative
# space, it needs its own subdomain (docs.<domain>).
WIKI_DIR="${SCRIPT_DIR}/outline"
WIKI_ENV="${WIKI_DIR}/.env"
if [[ "${INSTALL_WIKI:-no}" =~ ^[yY]([eE][sS])?$ ]]; then
  if [[ -f "${WIKI_ENV}" ]]; then
    echo "==> Updating the documentation wiki (Outline) by explicit request"
  else
    echo "==> Installing the documentation wiki (Outline) by explicit request"
  fi
  APP_DOMAIN="${MOBILE_HOST}" \
    bash "${WIKI_DIR}/install-outline.sh" || \
    echo "WARNING: documentation wiki operation failed; re-run deploy/outline/install-outline.sh" >&2
else
  echo "==> Leaving Outline untouched (set INSTALL_WIKI=yes to explicitly install/update it)."
fi

echo "==> Done. Logs: journalctl -u coordina-adg -f"
