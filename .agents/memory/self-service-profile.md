---
name: self-service profile editing
description: Why user self-service profile edits use a dedicated /auth/me endpoint instead of the admin user-update route
---

# Self-service profile editing

Users edit their own name/email/password via `PATCH /auth/me` (operationId `updateProfile`),
NOT via the admin `PATCH /users/{id}` route.

**Why:** the admin route is role-scoped and its `canManageUser(caller, target)` helper
returns false when `caller.id === target.id`, so it deliberately blocks self-management.
A separate `requireAuth`-only endpoint is required for a user to edit themselves.

**How to apply:**
- Any "let the logged-in user change their own account" work belongs on `auth.ts` under
  `requireAuth`, keyed off `req.user.id` — never loosen `canManageUser`.
- Keep `PATCH /auth/me` limited to name, email, and password (current + new); do not
  add role, status, center, or province fields there. Teacher center and active-year
  assignments belong on a separate teacher-only self-service endpoint, with province
  derived from the selected center.
- Email uniqueness on self-update must exclude the caller in SQL (`email = ? AND id != caller.id`),
  not by comparing strings, so case/normalization variants of the user's own email aren't
  rejected as duplicates.
