#!/usr/bin/env bash
# Source after defining occ(). Capture the full output before inspecting it:
# grep -q in a pipe can close stdout early and make Docker/PHP fail with
# SIGPIPE under the installer's `set -o pipefail`.
wait_for_nextcloud() {
  local attempts="${1:-60}" delay="${2:-5}" status attempt
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if status="$(occ status --no-ansi 2>/dev/null)"; then
      if grep -Eq '^[[:space:]]*-[[:space:]]*installed:[[:space:]]*true[[:space:]]*$' <<< "${status}" &&
         grep -Eq '^[[:space:]]*-[[:space:]]*maintenance:[[:space:]]*false[[:space:]]*$' <<< "${status}" &&
         grep -Eq '^[[:space:]]*-[[:space:]]*needsDbUpgrade:[[:space:]]*false[[:space:]]*$' <<< "${status}"; then
        return 0
      fi
    fi
    if ((attempt < attempts)); then sleep "${delay}"; fi
  done
  echo "Nextcloud readiness could not be confirmed (installation, maintenance or database upgrade)." >&2
  echo "Inspect: docker compose exec -T -u www-data nextcloud php occ status" >&2
  echo "Existing volumes have not been deleted; do not run docker compose down -v." >&2
  return 1
}
