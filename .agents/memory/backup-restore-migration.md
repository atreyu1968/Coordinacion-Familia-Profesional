---
name: Backup & restore (server migration)
description: Fail-closed restore, separately managed object bytes, and session invalidation across restores
---

# Backup & Restore for migration

Superadmin-only ZIP export/import for moving the platform between servers.
The ZIP contains database rows and an inventory of managed object hashes,
**not the object bytes**. Copy the associated object storage separately before
restoring on another server.

## Hard rules
- **Rule:** reject incomplete, legacy, or schema-incompatible archives before
  any mutation; compare every managed destination object against the archived
  digest and size, failing closed if it is missing or unverifiable. Replace rows
  and realign sequences inside one database transaction.
  **Why:** a partial table set loses data, and an existing object path can refer
  to different bytes on a new server. Storage and Postgres cannot be locked in
  a single transaction.
  **How to apply:** keep the archive format/schema fingerprint in lockstep with
  the schema; never reinterpret an older format as a complete backup. For a
  server move, copy objects first and verify them before invoking restore.
- **Rule:** every restored account receives a fresh random session identifier,
  and live sockets are disconnected after commit.
  **Why:** incrementing a stored token version alone can resurrect an old JWT
  when an account was absent from the live database before restoration.
  **How to apply:** issue and verify the identifier in all user and LMS bearer
  tokens; rotate it for *all* restored users, including accounts not present
  before the restore.

## Binary endpoints bypass the OpenAPI client
The generated react-query client is JSON-only. Backup download (blob) and restore
(zip upload) are **plain `fetch` calls** from the frontend, not orval hooks. They
hit root-relative `/api/...` (shared proxy) with a `Bearer` token read from
localStorage — same URL/token convention the generated client uses.

**Why:** binary payloads do not fit the JSON-only generated client.
