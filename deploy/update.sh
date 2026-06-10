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

# shellcheck disable=SC1090
DATABASE_URL="$(grep '^DATABASE_URL=' "${ENV_FILE}" | head -n1 | cut -d= -f2-)"

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

echo "==> Publishing web files to /var/www/coordina-adg"
WEB_ROOT="/var/www/coordina-adg"
mkdir -p "${WEB_ROOT}"
rm -rf "${WEB_ROOT:?}/"*
cp -a "${APP_DIR}/artifacts/web/dist/public/." "${WEB_ROOT}/"
chown -R www-data:www-data "${WEB_ROOT}"

# Migrate older installs whose nginx root still points inside the repo (e.g.
# /root/... or /home/user/...) — those home dirs are not traversable by www-data
# and cause a site-wide 500. Repoint nginx at the new web root and reload.
NGINX_CONF="/etc/nginx/sites-available/coordina-adg"
if [[ -f "${NGINX_CONF}" ]]; then
  echo "==> Ensuring nginx serves from ${WEB_ROOT}"
  sed -i -E "s#^([[:space:]]*)root[[:space:]]+[^;]*;#\\1root ${WEB_ROOT};#" "${NGINX_CONF}"
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
echo "==> Done. Logs: journalctl -u coordina-adg -f"
