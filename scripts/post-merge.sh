#!/bin/bash
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${APP_DIR}"
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/web run typecheck
# Use the same reviewed, backed-up migrations as self-hosted updates.
DB_BACKUP_DIR="${DB_BACKUP_DIR:-${APP_DIR}/.local/post-merge-db-backups}" \
  bash deploy/db.sh migrate
pnpm --filter @workspace/scripts run seed-reference-data
