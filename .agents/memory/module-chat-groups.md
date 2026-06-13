---
name: Module group chats (auto-provisioned)
description: How per-module group chats stay in sync with teaching_assignments, and the scope rule for bulk sync.
---

# Module group chats

Each teaching module can have exactly one auto-managed group chat, enforced by a
unique index on `chat_groups.module_id` (NULL = manual groups, many allowed).

- Membership source of truth = active `teaching_assignments` for the module
  (distinct active teachers). NOT `module_memberships`.
- `syncModuleChatGroup(moduleId)` is convergent/idempotent: creates the group if
  missing, otherwise adds/removes member drift and renames. Re-running never
  duplicates. It recomputes membership from **all** of the module's assignments
  across every center — the group is module-global, not per-center.
- Auto-sync fires best-effort after teaching-assignment **create** and
  **transfer** (wrapped in try/catch so a sync failure never breaks the write).

## Bulk sync scope rule
**Rule:** `POST /chat/groups/sync-modules` (manager-only) may only bulk-sync a
module when **every** center the module is taught in is within the caller's
scope (`cIds.every(hasScopeOver...)`), not `some`.

**Why:** the helper rewrites the whole module's membership. With `some`, a
province-A coordinator could mutate membership of a module also taught in
province B (cross-scope write). Superadmin passes `every` trivially.

**How to apply:** modules spanning scopes are provisioned by superadmin or by
the auto-sync that runs on each scoped assignment edit — not by a scoped
manager's bulk button.
