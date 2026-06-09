---
name: Coordina ADG authorization model
description: The role hierarchy + scope rules every protected route must enforce
---

Coordina ADG uses role hierarchy + tenant scope for authorization. Helpers live in `artifacts/api-server/src/middlewares/auth.ts`: `roleRank`, `hasScopeOver(caller, {provinceId, centerId})`, `canManageUser(caller, target)`.

Rules every mutating/detail route MUST enforce (not just `requireAuth`):
- **superadmin**: global, no scope. Must NOT be scoped to a province (seed sets province_id NULL for superadmin).
- **coordinator**: bound to its `provinceId`.
- **department_head**: bound to its `centerId`.
- **teacher/prospector/student**: no admin authority; list endpoints default-deny to self only.

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
