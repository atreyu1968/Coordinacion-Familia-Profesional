---
name: Audience model with role targets
description: Shared audience model (Forms/Surveys/Meetings) — role-based targets and the active-user filtering rule.
---

# Shared audience model + role targets

`artifacts/api-server/src/lib/audience.ts` is the single source of truth for
"who is this addressed to", reused by Forms, Surveys and Meetings
(videoconferencias). AUDIENCE_TYPES includes geographic/entity targets plus two
ROLE targets: `department_head` (jefes de departamento) and `coordinator`
(coordinadores provinciales).

**Role-target semantics:** `audienceIds` for a role type are PROVINCE ids; empty
ids = all provinces. `isInAudience` matches `viewer.role === type AND (ids empty
OR viewer.provinceId ∈ ids)`. `validateAudience`: superadmin may target all or
specific provinces; a provincial coordinator is pinned to `[provinceId]`; a
module coordinator may not create role-targeted audiences. Module coordinators
target their teachers via the `module` audience type instead.

**Critical rule — always filter recipients to active users.** Every branch of
`resolveAudienceUserIds` must apply `status='active' AND deletedAt IS NULL`
(the `active` SQL fragment). The `module` branch in particular must `innerJoin`
usersTable and apply `active` — selecting userIds straight from
module_memberships would notify inactive/deleted accounts.
**Why:** a regression here silently emails/notifies disabled users.
**How to apply:** when adding a new audience type, mirror the active filter used
by the existing branches; never return raw membership/user ids unfiltered.
