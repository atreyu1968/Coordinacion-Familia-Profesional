---
name: Backup & restore (server migration)
description: Design rules and gotchas for the full-database ZIP backup/restore feature
---

# Backup & Restore for migration

Superadmin-only full-database export/import as a ZIP, for moving the platform
between servers. There is **no file storage** — resources are external URLs —
so a backup is purely the Postgres data (one `backup.json` inside the zip).

## Hard rules
- **Restore must validate completeness BEFORE the destructive delete.** Restore
  wipes every table then re-inserts. A backup that omits a table would otherwise
  silently drop that table's live data. So: reject (400) unless *every* table in
  the registry is present as an array of plain objects, and the format/version
  markers match. Validate first, mutate second.
- **Whole restore runs in a single DB transaction** (delete-all reverse order →
  insert parent-first, chunked → realign sequences). Any error rolls back, so a
  failed restore never leaves partial state.
- **Realign serial sequences after restore** via
  `setval(pg_get_serial_sequence('"<table>"','id'), GREATEST(MAX(id),1))`, or new
  inserts collide with restored ids. Table names come from the schema (trusted),
  so `sql.raw` interpolation is safe here.
- **Revive dates on import:** JSON timestamps are ISO strings; Drizzle timestamp
  columns (dataType `"date"`) need real `Date` objects. Convert per column using
  `getTableColumns`.
- **Bump the backup version marker** whenever the table set or row shape changes,
  and keep restore's version check in lockstep — an unsupported version must be
  rejected, never applied destructively.

## Binary endpoints bypass the OpenAPI client
The generated react-query client is JSON-only. Backup download (blob) and restore
(zip upload) are **plain `fetch` calls** from the frontend, not orval hooks. They
hit root-relative `/api/...` (shared proxy) with a `Bearer` token read from
localStorage — same URL/token convention the generated client uses.

**Why:** these were the review-blocking concerns — silent data loss from
incomplete backups, and binary payloads that don't fit the codegen pipeline.
