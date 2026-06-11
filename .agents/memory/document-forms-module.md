---
name: Document-submission forms module
description: Frontend wiring, upload/download contract, and field-type model for the Formularios de entrega feature.
---

# Formularios de entrega (document-submission forms)

Mirrors the surveys pattern. Backend (schema, routes, object storage, openapi+codegen)
predates the frontend. Field types: `text | textarea | select | file`.

## Upload / download contract
- Upload is the generic presigned flow: `requestUploadUrl({name,size,contentType})`
  → `{uploadURL, objectPath}`; PUT bytes directly to `uploadURL` with matching
  `Content-Type`; store `objectPath` in the submission value. In RN, get bytes via
  `await (await fetch(uri)).blob()` (works web + native).
- Download is NOT a generated hook: `GET /api/document-forms/submission-values/:valueId/file`
  streams the private doc; **only admin or the author** may fetch. On web, fetch
  manually with `Authorization: Bearer <localStorage 'coordina_adg_token'>`, then
  blob → object URL → anchor click.

## Scoping / permissions
- Manager = `superadmin || coordinator`. Managers click a form card to open the
  results/submissions dialog; non-managers don't.
- **Audience is the source of truth** (`audienceType` + `audienceIds`), not the
  legacy `provinceId`. Creators: superadmin, provincial coordinator, and module
  coordinators (teachers with a coordinated module). Visibility filtered by viewer
  membership in the audience.
- Management authz (delete, list-submissions, file-download manager path) goes
  through `canManageAudience(caller, audienceType, audienceIds)` in `lib/audience.ts`,
  NOT `form.provinceId === caller.provinceId`. superadmin→all; provincial
  coordinator→non-`all` audiences within own province (via `idsBelongToProvince`);
  others→denied. **Why:** create only mirrors the legacy `provinceId` for
  single-`province` audiences (null for center/module/users), so a provinceId check
  silently strips coordinators of management over their own non-province items.
  Surveys delete uses the same helper. Same rule lives in `surveys-anonymity.md`.

## Mobile specifics
- Document picker: `expo-document-picker` (~14.0.x for SDK 54), added because
  `expo-image-picker` only handles images and documents may be PDFs.
- New screens must be registered in BOTH the file route AND `app/_layout.tsx`
  `<Stack.Screen>` list, and linked from `app/(tabs)/more.tsx` items.

**Why:** the download endpoint and the GCS PUT both sit outside the generated
orval client, so they need hand-written authed fetches — easy to miss.
