---
name: Forum module visibility
description: Access policy for module forums and management exceptions.
---

Ordinary teacher accounts should only see modules assigned to them for the active academic year. The family-wide module catalog remains available to authorized managers according to their existing scope.

**Why:** The user reported that teachers were seeing the full module catalog instead of only their assigned modules.

**How to apply:** Filter teacher-facing module listings by non-deleted assignments for the current teacher, their assigned center, and the active academic year; keep the active-family restriction. Do not narrow manager catalogs used to administer modules and assignments.

Teaching-profile completion and annual-confirmation forms still need the full module options for the selected center. Use the teaching-profile endpoint for those choices; the teacher module listing is assignment-only.

**Why:** Otherwise, teachers with missing assignments cannot choose modules to complete their required profile or annual confirmation.

**How to apply:** Keep profile-repair and confirmation catalogs distinct from ordinary teacher module browsing in both web and mobile clients.

Ordinary users may access only forums for modules assigned to them as teaching work in the active academic year. A module being global or belonging to the user's center does not by itself grant access. Preserve exceptions for scoped managers, module coordinators, and explicitly appointed forum moderators.

**Why:** The user asked to restrict forums to modules each person teaches and chose to retain management and moderation exceptions.

**How to apply:** Enforce the same rule for module listings, thread reads and writes, moderation history, and forum notifications. Apply the active-family restriction as well.
