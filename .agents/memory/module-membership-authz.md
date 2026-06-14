---
name: Module membership & meeting access authz
description: Authorization rules tying teachers to modules, the per-module coordinator, and how meeting join-tokens must be gated.
---

# Module membership & meeting access authz

Teachers self-enroll into modules (multi-module) via `module_memberships`
(`role` = "member" | "coordinator"; at most one coordinator per module). The
per-module coordinator is a membership role, not a global account role.

## Roster management (academics.ts)
- `canManageMembers(caller, module)` = manager-in-scope (`canManageModule`) **OR**
  the module's own coordinator (`isModuleCoordinator`).
- Add/remove member use `canManageMembers`. **Designating/transferring the
  coordinator stays manager-only** (`canManageModule`): add-member rejects
  `role:"coordinator"` and remove-member rejects removing a `coordinator` row
  unless the caller is a manager.
- **Why:** a module coordinator must be able to invite the module's teachers, but
  must not be able to crown/replace coordinators — that designation belongs to
  superadmin / provincial coordinator / department head in scope.

## Meeting access (meetings.ts)
- `callerCanSeeMeeting(caller,ctx,row)` = host OR superadmin OR (moduleId != null
  AND (member via `ctx.moduleIds` OR `managerScopeOverModule`)) OR
  (specific non-"all" audience AND `isInAudience`) OR `canManageAudience`.
  Legacy/null-module meetings are visible only to host + scoped managers.
- **GOTCHA:** `meetings.audience_type` column DEFAULTS to `"all"`. So a meeting
  inserted without going through `validateAudience` (legacy rows, test helpers)
  silently gets audience `"all"`. Treating `"all"` as a public visibility grant
  (plain `isInAudience`) leaks every such meeting to every user — that was the
  bug. For meetings, `"all"` is NOT a public grant: visibility must run through
  module-membership / manager-scope / specific-audience instead.
- **`POST /meetings/token` must look up the meeting by `roomName` and enforce
  `canAccessMeeting` before issuing a join URL.** Otherwise a leaked/guessed room
  name is an IDOR — any authenticated user could join.
  **How to apply:** ad-hoc rooms (1:1 chat calls) have no meeting row and stay
  open to any authenticated caller who already holds the room name; only gate
  rooms that resolve to a stored meeting.
- Moderator (signed JaaS JWT) = scoped manager role OR host OR module coordinator.
- GET /meetings visibility for non-superadmins is built with `or(...)` over: own
  hosted, enrolled-module meetings, and (for coordinators) province/global module
  meetings + legacy null. Create uses `managerScopeOverModule` (or module
  coordinator for that module), not a flat role check.

Regression tests live in `test/meetings.test.ts` (token IDOR deny/allow, ad-hoc
open, GET visibility, coordinator can add member but not designate).
