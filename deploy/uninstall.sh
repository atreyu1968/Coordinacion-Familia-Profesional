#!/usr/bin/env bash
# ===========================================================================
# Coordina ADG — uninstaller. Removes everything deploy/install.sh created so
# you can start from a clean slate (or remove the app entirely).
#
# It removes: the systemd service, the nginx sites, the published web root, the
# collaborative-space Docker stack (Nextcloud + Collabora) and — when you ask to
# purge data — the PostgreSQL database/role, the uploaded files and the .env
# files. It does NOT remove system packages (Node.js, PostgreSQL, nginx, Docker)
# or the cloned repository: those are shared and safe to keep.
#
# Usage (from the cloned repo root):
#   sudo bash deploy/uninstall.sh            # asks before deleting data
#   sudo PURGE_DATA=yes bash deploy/uninstall.sh   # delete DB + files, no prompt
#   sudo PURGE_DATA=no  bash deploy/uninstall.sh   # keep DB + files, no prompt
# ===========================================================================
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/uninstall.sh" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${APP_DIR}/.env"
COLLAB_DIR="${SCRIPT_DIR}/nextcloud"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
note() { printf '    %s\n' "$*"; }
is_tty() { [[ -t 0 ]]; }

# Database name/role to drop. Read the real DB name from .env when present so a
# custom DB_NAME is honored; fall back to the installer default otherwise.
DB_NAME="${DB_NAME:-}"
DB_USER="${DB_USER:-}"
if [[ -z "${DB_NAME}" && -f "${ENV_FILE}" ]]; then
  DB_NAME="$(grep '^DATABASE_URL=' "${ENV_FILE}" | head -n1 | sed -E 's#.*/([^/?]+).*#\1#')"
fi
DB_NAME="${DB_NAME:-coordina_adg}"
DB_USER="${DB_USER:-coordina_adg}"

# Decide whether to delete data (DB + uploaded files + collab data). Default to
# asking; for a clean reinstall you typically answer yes.
PURGE_DATA="${PURGE_DATA:-}"
if [[ -z "${PURGE_DATA}" ]]; then
  if is_tty; then
    echo "This removes the Coordina ADG service, nginx config and web files."
    read -r -p "Also DELETE the database, uploaded files and collaborative data? [yes/no] [no]: " PURGE_DATA || true
    PURGE_DATA="${PURGE_DATA:-no}"
  else
    PURGE_DATA="no"
  fi
fi
PURGE=0
[[ "${PURGE_DATA}" =~ ^[yY]([eE][sS])?$ ]] && PURGE=1

# --- 1. systemd service ----------------------------------------------------
log "Stopping and removing the systemd service"
systemctl stop coordina-adg.service 2>/dev/null || true
systemctl disable coordina-adg.service 2>/dev/null || true
rm -f /etc/systemd/system/coordina-adg.service
systemctl daemon-reload 2>/dev/null || true

# Remove the optional Cloudflare Tunnel (cloudflared) service only if the
# installer set it up — detected by a non-empty CLOUDFLARE_TUNNEL_TOKEN in our
# .env. This avoids tearing down an unrelated cloudflared the admin runs for
# other purposes. Leaves the binary in place (cheap to keep / reuse).
if [[ -f "${ENV_FILE}" ]] && \
   grep -qE '^CLOUDFLARE_TUNNEL_TOKEN=.+' "${ENV_FILE}" && \
   command -v cloudflared >/dev/null 2>&1; then
  log "Removing the Cloudflare Tunnel (cloudflared) service"
  systemctl stop cloudflared 2>/dev/null || true
  cloudflared service uninstall >/dev/null 2>&1 || true
fi

# --- 2. collaborative space (Docker) ---------------------------------------
if command -v docker >/dev/null 2>&1; then
  log "Removing the collaborative space (Nextcloud + Collabora) containers"
  # Tear the stack down. Supply placeholder values so compose's required-var
  # interpolation (VAR:?) succeeds even when nextcloud/.env is already gone.
  DOWN_FLAGS="--remove-orphans"
  [[ "${PURGE}" -eq 1 ]] && DOWN_FLAGS="${DOWN_FLAGS} --volumes"
  # shellcheck disable=SC2086
  APP_DOMAIN=x NEXTCLOUD_DB_PASSWORD=x \
  NEXTCLOUD_ADMIN_USER=x NEXTCLOUD_ADMIN_PASSWORD=x COLLABORA_ADMIN_PASSWORD=x \
    docker compose -f "${COLLAB_DIR}/docker-compose.yml" down ${DOWN_FLAGS} 2>/dev/null || true
  if [[ "${PURGE}" -eq 1 ]]; then
    # Belt and braces: drop the named volumes in case the project name differed.
    docker volume rm nextcloud_nextcloud-db nextcloud_nextcloud-data 2>/dev/null || true
  fi
else
  note "Docker not installed; skipping the collaborative space."
fi

# --- 3. nginx --------------------------------------------------------------
log "Removing nginx configuration"
rm -f /etc/nginx/sites-enabled/coordina-adg \
      /etc/nginx/sites-enabled/coordina-adg-collab \
      /etc/nginx/sites-available/coordina-adg \
      /etc/nginx/sites-available/coordina-adg-collab \
      /etc/nginx/snippets/coordina-adg-collab-locations.conf \
      /etc/nginx/conf.d/coordina-adg-upgrade.conf
if command -v nginx >/dev/null 2>&1; then
  # Restore the stock default site if nothing else is enabled, so nginx still
  # starts cleanly after we remove our config.
  if [[ -z "$(ls -A /etc/nginx/sites-enabled 2>/dev/null)" && -f /etc/nginx/sites-available/default ]]; then
    ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default
  fi
  if nginx -t 2>/dev/null; then
    systemctl reload nginx 2>/dev/null || systemctl restart nginx 2>/dev/null || true
  else
    note "nginx config test failed; check /etc/nginx manually."
  fi
fi

# --- 4. published web files -------------------------------------------------
log "Removing published web files (/var/www/coordina-adg)"
rm -rf /var/www/coordina-adg

# --- 5. data (only when purging) -------------------------------------------
if [[ "${PURGE}" -eq 1 ]]; then
  log "Dropping the PostgreSQL database and role (${DB_NAME} / ${DB_USER})"
  if command -v psql >/dev/null 2>&1; then
    # Terminate any lingering connections before dropping the database.
    sudo -u postgres psql -tAc \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid<>pg_backend_pid()" \
      >/dev/null 2>&1 || true
    sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${DB_NAME};" >/dev/null 2>&1 || true
    sudo -u postgres psql -c "DROP ROLE IF EXISTS ${DB_USER};" >/dev/null 2>&1 || true
  else
    note "psql not found; skipping database removal."
  fi

  log "Removing uploaded files (/var/lib/coordina-adg)"
  rm -rf /var/lib/coordina-adg

  log "Removing environment files"
  rm -f "${ENV_FILE}" "${COLLAB_DIR}/.env"
else
  note "Keeping the database, uploaded files and .env (PURGE_DATA=no)."
fi

# --- 6. optional: HTTPS certificates ---------------------------------------
# Left in place by default — Let's Encrypt certs are harmless to keep and avoid
# rate-limit issues on reinstall. Remove them yourself if you really need to:
#   certbot certificates   # list
#   certbot delete --cert-name <name>

log "Done. Coordina ADG has been removed."
if [[ "${PURGE}" -eq 1 ]]; then
  note "Data was deleted. For a clean install, run: sudo bash deploy/install.sh"
else
  note "Data was kept. Re-run deploy/install.sh to reinstall against it."
fi
note "System packages (Node.js, PostgreSQL, nginx, Docker) were left installed."
