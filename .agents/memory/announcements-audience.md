---
name: Announcements (Tablón) audience + attachments
description: How announcements are scoped/visible and how downloadable attachments work, plus the legacy provinceId trap.
---

# Announcements use the shared audience model + attachments

Announcements (`Tablón`) were extended (NOT duplicated) to mirror the meetings
pattern: visibility is driven by the shared audience model (`audienceType` +
`audienceIds`), the same helpers as meetings/forms/surveys
(`validateAudience`, `isInAudience`, `canManageAudience`,
`resolveAudienceUserIds`). A user sees an announcement if they authored it, fall
in its audience, or can manage that audience. Created by superadmin + provincial
coordinator. Downloadable attachments live in a sibling table; bytes are in
object storage, ACL-bound to the author at create (owner check/set) BEFORE the
db transaction, and the download route re-authorizes by audience.

**Why:** consistency — anuncios had to behave exactly like videoconferences for
targeting and be visible on móvil. Reusing the audience lib avoids a parallel
visibility model.

**How to apply / the trap:** the `provinceId` column is LEGACY and is NO LONGER
written (kept only for backward compat). Visibility ignores it entirely. After
schema change, existing rows MUST be backfilled (`provinceId` →
`audienceType='province'`/`audienceIds=[provinceId]`, or `all` when null) or a
province-scoped legacy row left at the new defaults (`all` + `[]`) would leak
across provinces. If you ever reintroduce province scoping, go through the
audience model, never the legacy column.
