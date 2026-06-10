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
DATABASE_URL="$(grep '^DATABASE_URL=' "${ENV_FILE}" | head -n1 | cut -d= -f2-)"
# Honor values passed on the command line (e.g. sudo DOMAIN=adg.example.org ...
# or MOBILE_WEB_URL=...), falling back to whatever is already in .env.
MOBILE_WEB_URL="${MOBILE_WEB_URL:-$(grep '^MOBILE_WEB_URL=' "${ENV_FILE}" | head -n1 | cut -d= -f2-)}"
PUBLIC_APP_URL="${PUBLIC_APP_URL:-$(grep '^PUBLIC_APP_URL=' "${ENV_FILE}" | head -n1 | cut -d= -f2-)}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-$(grep '^LETSENCRYPT_EMAIL=' "${ENV_FILE}" | head -n1 | cut -d= -f2-)}"
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
if [[ -n "${DATABASE_URL}" ]] && command -v psql >/dev/null 2>&1; then
  # Best-effort: a transient DB outage or an older schema (missing column) must
  # NOT abort the update before git pull / schema push, so swallow any failure.
  DB_MOBILE_WEB_URL="$(psql "${DATABASE_URL}" -tAc \
    "SELECT mobile_web_url FROM integration_settings WHERE mobile_web_url IS NOT NULL AND mobile_web_url <> '' ORDER BY id LIMIT 1" \
    2>/dev/null | head -n1 | tr -d '[:space:]')" || DB_MOBILE_WEB_URL=""
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

echo "==> Pulling latest code"
run_as_user "cd '${APP_DIR}' && git pull --ff-only"

echo "==> Installing dependencies"
run_as_user "cd '${APP_DIR}' && pnpm install --frozen-lockfile"

echo "==> Building web + API"
run_as_user "cd '${APP_DIR}' && PORT=5173 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/web run build"
run_as_user "cd '${APP_DIR}' && pnpm --filter @workspace/api-server run build"

# Rebuild the mobile app (PWA) when it is configured to live under a sub-path on
# this server (e.g. https://DOMAIN/app). Skipped for blank or root URLs.
BUILD_MOBILE=0
if [[ -n "${MOBILE_HOST}" && -n "${MOBILE_PATH}" ]]; then
  echo "==> Building the mobile app (PWA) for ${MOBILE_PATH}"
  # This runs BEFORE the web root is wiped below, so a build failure aborts the
  # whole update (set -e) and the previously published mobile app stays live.
  run_as_user "cd '${APP_DIR}' && EXPO_PUBLIC_DOMAIN='${MOBILE_HOST}' EXPO_PUBLIC_BASE_PATH='${MOBILE_PATH}' pnpm --filter @workspace/movil run build:web"
  if [[ ! -f "${APP_DIR}/artifacts/movil/dist/index.html" ]]; then
    echo "ERROR: mobile build produced no index.html; aborting before touching the live site." >&2
    exit 1
  fi
  BUILD_MOBILE=1
fi

echo "==> Publishing web files to /var/www/coordina-adg"
WEB_ROOT="/var/www/coordina-adg"
mkdir -p "${WEB_ROOT}"
rm -rf "${WEB_ROOT:?}/"*
cp -a "${APP_DIR}/artifacts/web/dist/public/." "${WEB_ROOT}/"
if [[ "${BUILD_MOBILE}" -eq 1 ]]; then
  echo "==> Publishing the mobile app to ${WEB_ROOT}${MOBILE_PATH}"
  mkdir -p "${WEB_ROOT}${MOBILE_PATH}"
  cp -a "${APP_DIR}/artifacts/movil/dist/." "${WEB_ROOT}${MOBILE_PATH}/"
fi
chown -R www-data:www-data "${WEB_ROOT}"

# Migrate older installs whose nginx root still points inside the repo (e.g.
# /root/... or /home/user/...) — those home dirs are not traversable by www-data
# and cause a site-wide 500. Repoint nginx at the new web root and reload.
if [[ -f "${NGINX_CONF}" ]]; then
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
  if nginx -t; then
    systemctl reload nginx
  else
    echo "WARNING: nginx config test failed; not reloading. Check ${NGINX_CONF}" >&2
  fi
fi

echo "==> Applying database schema"
run_as_user "cd '${APP_DIR}' && DATABASE_URL='${DATABASE_URL}' pnpm --filter @workspace/db run push"

echo "==> Restarting service"
systemctl restart coordina-adg.service

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

echo "==> Done. Logs: journalctl -u coordina-adg -f"
