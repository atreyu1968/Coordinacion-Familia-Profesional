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

**How to apply:** Tasks #2–#8 add new resources — replicate this pattern (role guard + object-level scope check) on every write and detail endpoint. IDs in this DB are integers, so scope fields are `number | null`.
