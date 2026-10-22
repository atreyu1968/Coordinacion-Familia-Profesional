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

## Center discovery while repairing a profile

Keep the ordinary `GET /centers` directory available to incomplete teachers so they can
find a valid center during profile repair. Dashboard drilldowns must request the explicit
`dashboardOnly` filter and enforce the caller's read scope; do not turn the public directory
into a broadly authenticated endpoint just to scope dashboard links.

**Why:** the normal auth guard blocks incomplete profiles, while center discovery was already
available and is needed to repair a missing or unavailable center. Dashboard totals still
must not expose a wider record set than the caller's scope.

**How to apply:** preserve the profile-repair exception for `/centers`; add a distinct,
authenticated scoped mode for any dashboard-specific center listing.
