#!/usr/bin/env bash
# No Docker, network, credentials or existing installation required.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/readiness.sh"

ready() {
  printf '  - installed: true\n  - version: 30.0.17.2\n  - maintenance: false\n  - needsDbUpgrade: false\n'
}
occ() { ready; }
wait_for_nextcloud 1 0

# Emulate a producer still writing after grep has found "installed".
occ() {
  ready
  local i
  for ((i = 0; i < 10000; i++)); do printf '  - additional-status: value\n'; done
}
wait_for_nextcloud 1 0

occ() { ready; return 1; }
if wait_for_nextcloud 1 0 2>/dev/null; then echo "FAIL: nonzero occ status accepted"; exit 1; fi

for field in installed maintenance needsDbUpgrade; do
  occ() {
    case "${field}" in
      installed) printf '  - installed: false\n  - maintenance: false\n  - needsDbUpgrade: false\n' ;;
      maintenance) printf '  - installed: true\n  - maintenance: true\n  - needsDbUpgrade: false\n' ;;
      needsDbUpgrade) printf '  - installed: true\n  - maintenance: false\n  - needsDbUpgrade: true\n' ;;
    esac
  }
  if wait_for_nextcloud 1 0 2>/dev/null; then echo "FAIL: unsafe ${field} accepted"; exit 1; fi
done

occ() { printf '  - installed: true\n'; }
if wait_for_nextcloud 1 0 2>/dev/null; then echo "FAIL: incomplete status accepted"; exit 1; fi

# Persist the count outside command substitution's subshell.
counter="$(mktemp)"
trap 'rm -f "${counter}"' EXIT
printf '0\n' > "${counter}"
occ() {
  local count
  read -r count < "${counter}"
  printf '%s\n' "$((count + 1))" > "${counter}"
  if ((count == 0)); then return 1; fi
  ready
}
wait_for_nextcloud 2 0
[[ "$(cat "${counter}")" == 2 ]]
echo "PASS: ready, large output, command failure, unsafe states, missing fields and retry."
