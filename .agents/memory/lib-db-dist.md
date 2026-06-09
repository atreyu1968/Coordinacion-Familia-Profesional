---
name: lib/db dist declarations
description: Why api-server typecheck fails to see @workspace/db exports after schema edits
---

After editing Drizzle schema files in `lib/db/src/schema/`, rebuild the package's `dist/` (emit declarations, e.g. `npx tsc -p tsconfig.json` in lib/db) so consumers' typechecks resolve `@workspace/db` exports.

**Why:** The api-server typecheck resolves `@workspace/db` against its published `dist/` types, not the source. If `dist/` is stale or missing, new schema/table exports appear as missing-type errors even though the source is correct.

**How to apply:** Whenever you add/rename schema exports in lib/db, rebuild its dist before running api-server typecheck/build. Treat schema change + dist rebuild as one step.
