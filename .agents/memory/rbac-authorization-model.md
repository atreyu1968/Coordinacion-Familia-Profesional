---
name: Coordina ADG authorization model
description: The role hierarchy + scope rules every protected route must enforce
---

Coordina ADG uses role hierarchy + tenant scope for authorization. Helpers live in `artifacts/api-server/src/middlewares/auth.ts`: `roleRank`, `hasScopeOver(caller, {provinceId, centerId})`, `canManageUser(caller, target)`.

Rules every mutating/detail route MUST enforce (not just `requireAuth`):
- **superadmin**: global, no scope. Must NOT be scoped to a province (seed sets province_id NULL for superadmin).
- **coordinator**: bound to its `provinceId`.
- **department_head**: bound to its `centerId`.
- **teacher/prospector/student**: no admin authority; generic list endpoints default-deny to self only. Teachers have a separate read-only directory for active users in the active professional family; do not reuse that wider scope for other list consumers.

Patterns:
- Object-level checks: fetch the target row, then verify `hasScopeOver`/`canManageUser` before mutating. Never trust the `:id` alone.
- Invitation creation: for non-superadmin, FORCE province to inviter's; validate any caller-supplied center/department belongs to inviter scope (don't accept `?? inviter.x` fallbacks that let callers override).
- Detail reads out of scope return **404 (not 403)** to avoid leaking existence.

**Why:** A code review found IDOR / privilege escalation / cross-tenant exposure in invitations, users, centers, departments because routes only had `requireAuth` (or broad `requireRole`) without per-object scope/hierarchy checks.

**How to apply:** When adding any new resource, replicate this pattern (role guard + object-level scope check) on every write and detail endpoint. On user-update endpoints, validate the *post-update* role/scope, not just the current row — a manager must not be able to set a role >= their own or move a user outside their scope. IDs in this DB are integers, so scope fields are `number | null`.

## Read/list/aggregate scoping must be ROLE-driven, not field-presence-driven
For list/aggregate endpoints (e.g. `/departments`, `/dashboard/*`), use `resolveReadScope(caller)` in `middlewares/auth.ts` — returns `{kind: "global"|"province"|"center"|"none"}`. Province roles = coordinator, prospector (use `provinceId`); center roles = department_head, teacher, student (use `centerId`); superadmin = global (+ optional `?provinceId=` filter). `none` => default-deny (return empty).

**Why:** A code review found that branching on `caller.provinceId != null` *before* `caller.centerId` leaked province-wide data to center-bound roles, because a center user's record also carries the `provinceId` of its center. The fix keys scope off ROLE, never off which id happens to be populated.

**How to apply:** Never write `if (caller.provinceId) {...} else if (caller.centerId) {...}` for scoping. Call `resolveReadScope` and switch on `.kind`. Only superadmin may honor a caller-supplied `provinceId` filter; ignore it for everyone else.

## Account recovery is administration, not directory visibility

**Rule:** Keep recoverable deactivated accounts available to scoped managers without broadening the ordinary user directory or reinterpreting existing directory calls as administrative access.

**Why:** The user approved fixing accounts disappearing after deactivation while preserving accounts and histories. Directory consumers across web and mobile must not gain inactive-account visibility as a side effect of that repair.

**How to apply:** Preserve the distinction between directory reads and manager-only recovery. Editing and access actions must share server-authoritative scope/hierarchy checks; a manager's own access is handled separately from account administration.

## Active-family user directory

**Rule:** The user-list page may show teachers the active users associated with the configured professional family, including center names. It provides mailto and direct-chat actions; direct chat is only available for active, non-self accounts and uses the existing chat authorization. This is a read-only directory, not an expansion of account-management rights. Department heads may see active-family users, but `canManage`, profile-integrity details, and recovery of inactive accounts remain limited to their own center. Keep generic `/users` calls scoped for their existing consumers.

**Why:** The user explicitly chose visibility across the whole active family after reporting that center users only saw colleagues from their own center, then asked to contact people from that list. Visibility and contact must not grant management or reveal deactivated accounts from other centers.

**How to apply:** Use a dedicated family-directory endpoint for the user-list screen. Keep writes, audit, profile diagnostics, and inactive-account recovery behind the existing role and scope checks. Open emails with `mailto` and direct conversations through the existing chat APIs; never add an alternate path that can contact inactive accounts.
