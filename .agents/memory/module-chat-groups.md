---
name: Module group chats (auto-provisioned)
description: How per-module group chats stay in sync with teaching_assignments, and the scope rule for bulk sync.
---

# Module group chats

Each teaching module can have exactly one auto-managed group chat, enforced by a
unique index on `chat_groups.module_id` (NULL = manual groups, many allowed).

- Membership = active `teaching_assignments` teachers **∪ scoped managers**
  (NOT `module_memberships`). Managers must be inserted as members because
  `GET /chat/groups` is **member-only** — authz alone does not make a group
  visible. Scoped managers = superadmin (all) + coordinator (province of the
  module's centers) + department_head (those centers), active & non-deleted.
- **Scope comes from `teaching_assignments.centerId`, not `modules.centerId`**
  (the latter is typically NULL; the real module↔center link is the assignments).
  Use distinct active assignment centers (`moduleCenterIds`) to resolve
  provinces/centers. A coordinator with NULL province is naturally excluded.
  Backfills must join through `teaching_assignments`, never `modules.centerId`.
- Create skip-guard stays keyed only on teacher count (`!existing &&
  teacherIds.length===0 => skipped`): managers alone never create a group.
- Newly added managers get `lastReadAt=null`, so pre-existing messages count as
  unread (acceptable; optional to init to now).
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
