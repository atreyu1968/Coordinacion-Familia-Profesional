#!/usr/bin/env bash
# Real clients + real API, exclusively on a disposable, socket-only PostgreSQL.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Never pass workspace credentials/integrations to the test app or Expo build.
if [[ "${COORDINA_PROFILE_UI_CLEAN_ENV:-}" != 1 ]]; then
  exec env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" \
    COORDINA_PROFILE_UI_CLEAN_ENV=1 bash "$0" "$@"
fi
[[ "$EUID" != 0 ]] || { echo "Run as an unprivileged user." >&2; exit 1; }
for tool in initdb pg_ctl createdb openssl pnpm node; do
  command -v "$tool" >/dev/null || { echo "Missing test tool: $tool" >&2; exit 1; }
done
cd "$APP_DIR"
TEST_ROOT="$(mktemp -d "${TMPDIR}/coordina-profile-ui.XXXXXX")"
export COORDINA_PROFILE_UI_ROOT="$TEST_ROOT"
mkdir -m 700 "$TEST_ROOT/socket" "$TEST_ROOT/metro-cache"
SERVER_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  pg_ctl -D "$TEST_ROOT/data" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
initdb -D "$TEST_ROOT/data" --username=postgres --auth-local=trust --auth-host=reject >"$TEST_ROOT/initdb.log"
pg_ctl -D "$TEST_ROOT/data" -l "$TEST_ROOT/postgres.log" \
  -o "-F -k $TEST_ROOT/socket -p 55439 -c listen_addresses=''" -w start >/dev/null
createdb --host="$TEST_ROOT/socket" --port=55439 --username=postgres coordina_profile_ui
export DATABASE_URL="postgresql://postgres@localhost:55439/coordina_profile_ui?host=$TEST_ROOT/socket"
export DB_BACKUP_DIR="$TEST_ROOT/backups"
echo "==> Preparing private test database"
bash deploy/db.sh migrate >"$TEST_ROOT/migration.log" 2>&1 || { cat "$TEST_ROOT/migration.log"; exit 1; }

# Obtain two free loopback ports without touching any preview workflow.
read -r WEB_PORT MOBILE_PORT < <(node --input-type=module -e '
  import net from "node:net";
  const servers = await Promise.all([0, 1].map(() => new Promise(resolve => {
    const s = net.createServer(); s.listen(0, "127.0.0.1", () => resolve(s));
  })));
  console.log(servers.map(s => s.address().port).join(" "));
  servers.forEach(s => s.close());
')
export PROFILE_UI_WEB_URL="https://127.0.0.1:$WEB_PORT"
export PROFILE_UI_MOBILE_URL="https://127.0.0.1:$MOBILE_PORT"
export NODE_ENV=production LOG_LEVEL=error
export JWT_SECRET=profile-ui-disposable-test-only SESSION_SECRET=profile-ui-disposable-test-only
export STORAGE_DRIVER=local LOCAL_STORAGE_DIR="$TEST_ROOT/storage"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=localhost' \
  -keyout "$TEST_ROOT/key.pem" -out "$TEST_ROOT/cert.pem" >/dev/null 2>&1
echo "==> Building desktop client"
PORT="$WEB_PORT" BASE_PATH=/ pnpm --filter @workspace/web exec vite build \
  --outDir "$TEST_ROOT/web" >"$TEST_ROOT/web-build.log" 2>&1 || { cat "$TEST_ROOT/web-build.log"; exit 1; }
echo "==> Building mobile web client (Expo/PWA)"
TMPDIR="$TEST_ROOT/metro-cache" EXPO_NO_DOTENV=1 EXPO_PUBLIC_DOMAIN="127.0.0.1:$MOBILE_PORT" CI=1 \
  pnpm --filter @workspace/movil exec expo export --platform web --clear \
    --output-dir "$TEST_ROOT/mobile" >"$TEST_ROOT/mobile-build.log" 2>&1 || { cat "$TEST_ROOT/mobile-build.log"; exit 1; }
echo "==> Starting isolated API and both clients"
# exec avoids leaving a pnpm wrapper or a child API process after cleanup.
node --import "$APP_DIR/scripts/node_modules/tsx/dist/loader.mjs" \
  artifacts/api-server/test-ui/server.ts >"$TEST_ROOT/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 120); do
  [[ -f "$TEST_ROOT/ready.json" ]] && break
  kill -0 "$SERVER_PID" 2>/dev/null || { cat "$TEST_ROOT/server.log"; exit 1; }
  sleep 1
done
[[ -f "$TEST_ROOT/ready.json" ]] || { cat "$TEST_ROOT/server.log"; echo "Test server readiness timed out"; exit 1; }
echo "==> Running persistent browser regressions"
pnpm --filter @workspace/api-server exec playwright test --config playwright.profile.config.ts "$@" || {
  cat "$TEST_ROOT/server.log"; exit 1;
}
