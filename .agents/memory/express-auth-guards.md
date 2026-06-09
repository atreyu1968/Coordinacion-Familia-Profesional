---
name: Express per-route auth guards
description: Why router.use(requireAuth) in path-less sub-routers breaks sibling routers
---

In this Express api-server, apply auth as per-route middleware (`router.get('/x', requireAuth, handler)` and `requireAuth, requireRole(...)` in that order), NOT as `router.use(requireAuth)` at the top of a sub-router.

**Why:** Sub-routers are mounted without a path prefix and share the middleware chain. A `router.use(requireAuth)` inside one of them runs for ALL subsequent routers in the chain, so public routes (e.g. `/provinces`) started returning 401. Symptom: a public endpoint unexpectedly requires auth depending on router registration order.

**How to apply:** Guard each protected route inline. Keep public routes guard-free. For role checks, order middleware as `requireAuth, requireRole(...)`.

## Non-HTTP auth paths must mirror requireAuth

The Socket.io handshake middleware (and any other non-HTTP auth path) must do the SAME checks as `requireAuth`: not just `verifyToken`, but also load the user and reject unless it exists, `status === "active"`, and `deletedAt IS NULL`.

**Why:** JWTs are long-lived (30d). Verifying only the signature lets a deactivated/deleted user keep a realtime session and receive chat/notifications — a confidentiality regression.

**How to apply:** Decode the JWT, then query `usersTable` and reject the handshake (`next(new Error(...))`) on missing/inactive/deleted user before joining any rooms. Consider a shared helper to prevent drift between HTTP and socket auth.
