---
name: Express per-route auth guards
description: Why router.use(requireAuth) in path-less sub-routers breaks sibling routers
---

In this Express api-server, apply auth as per-route middleware (`router.get('/x', requireAuth, handler)` and `requireAuth, requireRole(...)` in that order), NOT as `router.use(requireAuth)` at the top of a sub-router.

**Why:** Sub-routers are mounted without a path prefix and share the middleware chain. A `router.use(requireAuth)` inside one of them runs for ALL subsequent routers in the chain, so public routes (e.g. `/provinces`) started returning 401. Symptom: a public endpoint unexpectedly requires auth depending on router registration order.

**How to apply:** Guard each protected route inline. Keep public routes guard-free. For role checks, order middleware as `requireAuth, requireRole(...)`.
