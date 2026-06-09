---
name: Scope-based delete affordances
description: How client UI delete/manage buttons must align with backend role+scope authorization in Coordina ADG.
---

# Scope-based delete affordances

Client delete/manage buttons must mirror the backend authorization exactly, or
managers see buttons the server rejects.

**Rule:** allow delete when `authorId === currentUser.id` OR role is
`superadmin`, OR role is `coordinator`/`department_head` AND the content is
**scoped** (its denormalized `centerId != null`). Global content
(`centerId == null`) is author/superadmin-only.

**Why:** the backend uses `hasScopeOver` — superadmin always; coordinator
matches `provinceId`; department_head matches `centerId`. For global content the
derived scope is `{provinceId:null, centerId:null}`, so a non-superadmin
manager's id never matches and the server returns 403. A role-only client check
showed delete buttons that 403'd on global threads.

**How to apply:** pass the content's `centerId` into the can-manage check.
Content list items carry `centerId` directly; for nested content (e.g. forum
posts, which lack their own `centerId`) propagate the parent thread's `centerId`
— on mobile, pass it through navigation params.
