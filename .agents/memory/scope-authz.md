---
name: Scope checks — read vs manage
description: Which authorization helper to use when validating a write target's center/province.
---

# Read-scope vs management-scope on writes

When validating that a caller may attach a record to a given center/province, choose the helper by **who is allowed to perform the action**, not reflexively `hasScopeOver`.

- `hasScopeOver(caller, {provinceId, centerId})` returns true **only for managers**: superadmin (global), coordinator (own province), department_head (own center). Teachers/students/prospectors always get false.
- `resolveReadScope(caller)` returns the set of centers the caller can *see/belong to* (global / province / center / none).

**Why:** Teachers (non-managers) must be able to upload resources to their own center. Guarding `POST /resources` with `hasScopeOver` would wrongly 403 every teacher. So resource creation validates the supplied `centerId` against `resolveReadScope` (center in their own center/province, or anything for superadmin). Management-only actions (create module/group/assignment, transfer target teacher) still use `hasScopeOver`.

**How to apply:** For an endpoint open to non-managers, validate the target center with read-scope logic. For an endpoint restricted to managers, use `hasScopeOver`. Also validate cross-entity write targets (e.g. transfer's `toTeacherId`): confirm the row exists, has the expected role, and resolve its center's province before the scope check (a teacher row may have `provinceId` null but a non-null `centerId`).

Files: `artifacts/api-server/src/routes/academics.ts`, `artifacts/api-server/src/middlewares/auth.ts`.
