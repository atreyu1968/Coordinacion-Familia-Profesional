---
name: Scope checks — read vs manage
description: Which authorization helper to use when validating a write target's center/province.
---

# Read-scope vs management-scope on writes

When validating that a caller may attach a record to a given center/province, choose the helper by **who is allowed to perform the action**, not reflexively `hasScopeOver`.

- `hasScopeOver(caller, {provinceId, centerId})` returns true **only for managers**: superadmin (global), coordinator (own province), department_head (own center). Teachers/students/prospectors always get false.
- `resolveReadScope(caller)` returns the set of centers the caller can *see/belong to* (global / province / center / none).

**Why:** Teachers (non-managers) must be able to upload resources to their own center. Guarding `POST /resources` with `hasScopeOver` would wrongly 403 every teacher. So resource creation validates the supplied `centerId` against `resolveReadScope` (center in their own center/province, or anything for superadmin). Management-only actions (create module/group/assignment, transfer target teacher) still use `hasScopeOver`.

**How to apply:** For an endpoint open to non-managers, validate the target center with read-scope logic. For an endpoint restricted to managers, use `hasScopeOver`. Always validate cross-entity write targets, not just the submitted `centerId`: confirm referenced teacher/module/group rows exist, have the expected role, and are coherent with the assignment's center (teacher bound to that center; module global or same center; group same center). A teacher row may have `provinceId` null but a non-null `centerId`, so resolve the center's province before a province scope check.

## Province-scoped + global visibility pattern (company alerts)

For records that are visible province-wide plus optionally global, the convention is: a row's `provinceId` null means **global/visible to everyone**; a non-null `provinceId` scopes it to that province only. List queries for non-superadmin callers OR `provinceId IS NULL` with `provinceId = <caller's effective province>`. Center-role callers have no `provinceId` of their own, so derive it from their center before filtering.

**Why:** FCT company alerts must reach teachers across a whole province while still allowing global postings; teachers carry a center, not a province.

**How to apply:** Create is role-gated (superadmin/coordinator/prospector); non-superadmin publishers are **pinned to their own province** server-side regardless of the submitted body. Delete authz = creator OR superadmin OR coordinator within the row's province. Side-effect notifications (email to teachers in the province) must be best-effort: fire after the insert with `Promise.allSettled`, never block or fail the response.
