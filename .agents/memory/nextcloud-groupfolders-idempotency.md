---
name: Nextcloud Group Folders add-group is not idempotent
description: Re-adding a group to a group folder throws HTTP 500 (DB unique violation), not an OCS "already exists" — guard before re-provisioning.
---

# Group Folders "add group to folder" is NOT idempotent

The OCS endpoint `POST /apps/groupfolders/folders/:id/groups` (adding a group to a
group folder) is **not** idempotent. Re-adding an already-assigned group returns
**HTTP 500** with a Postgres unique-violation body (`groups_folder_group`,
`duplicate key value violates unique constraint`), NOT the usual OCS
"already exists" code (102 / 400 / 409). So the generic `isAlreadyExists()` guard
does NOT catch it.

**Why it matters:** module-space provisioning calls `ensureGroupFolder()` early,
before the member-sync loop. An unguarded throw there aborts the whole
`provisionModuleSpace()`, so the route returns 502 and the `coordina-mod-*`
groups never get their members. Symptom: first open of a space "works" but groups
stay empty; every subsequent "Abrir espacio" fails with 502.

**How to apply:** before re-adding a group to a folder, check the folder list
(`GET /apps/groupfolders/folders`) — each folder object exposes a `groups` map;
skip the add when the group id is already present. Keep a defensive catch for the
duplicate 500 (helper `isDuplicateGroupAssignment`) in case the list omits groups.
The permission-update POST (`.../groups/:groupid` with `permissions`) IS an update
and stays idempotent. Contrast: group/user create and user↔group add/remove use
OCS code 102 and are handled by `isAlreadyExists()`.
