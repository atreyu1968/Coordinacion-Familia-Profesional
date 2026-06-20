---
name: Active professional-family lock
description: How the whole app is locked to the single configured familia profesional, and the surfaces that must enforce it.
---

# Active professional-family lock

The instance is locked to ONE active professional family for ALL users.
Active family = `professionalFamilyOf(getSettings())` (helper `getActiveFamily()`
in `lib/settings.ts`), fallback `"Administración y Gestión"`.

**The family is PERMANENT once explicitly persisted — it can never be changed
"bajo ningún concepto".** Superadmin makes a ONE-TIME selection in Configuración
→ Apariencia (gated behind a double-confirm AlertDialog + acknowledgement
checkbox). After the first save it is locked forever.
**Lock mechanism (presence-based, no extra schema/migration):** the lock is
keyed off the PRESENCE of a non-empty raw `integration_settings.professional_family`
column (NOT the resolved value, which always falls back to the default).
- Contract: `BrandingSettings.professionalFamilyLocked: boolean` (required) in
  `openapi.yaml` — added so the client can distinguish "persisted (locked)" from
  "still showing the fallback default". `brandingResponse()` sets it to
  `!!(s.professionalFamily ?? "").trim()`.
- Backend guard: `PUT /settings/branding` returns **409** if a non-empty family
  is already persisted and the incoming value differs (first-set and idempotent
  no-op are allowed).
- Web: `apariencia-settings.tsx` reads `professionalFamilyLocked`; when true the
  input is `disabled`/`readOnly` with a permanent-lock note and the change-confirm
  dialog never fires.
**Why presence-based:** a fresh/self-hosted install must still be able to pick a
non-default family ONCE; locking on the raw column (not the resolved fallback)
allows that one selection, then freezes it.

**Why:** family is a CENTER-level concept — it lives ONLY on `centers.families`
(jsonb array). Modules (`centerId` NULL in practice) and the cycles catalog are
global, so they are intentionally NOT family-filtered (filtering would break
pickers / hide unassigned items).

**How to apply — every center-read and center-by-id surface must add the
predicate** `families @> '["<activeFamily>"]'::jsonb`:
- `GET /centers` (list), `GET /centers/:id` (404 if out of family),
  `GET /centers/:id/training-offer` (guard the center first),
  PATCH/DELETE `/centers/:id`, POST `/centers/:id/training-offer`.
- `GET /centers/facets`: filter `center_type`/`nature` by `@>`, but for the
  `families` facet you must ALSO filter the expanded elements
  (`jsonb_array_elements_text(families) AS elem ... AND elem = activeFamily`) —
  a center can list several families, so a plain `@>` still leaks the others.
- Dashboard/report center-derived figures (centers, teachers, resources,
  centersByIsland, resourcesByMonth, gatherReportStats) anchor on
  active-family center ids (helpers `centerInActiveFamily`,
  `activeFamilyCenterIds`). Teachers/resources join via center → center-less
  rows are excluded by design.

**Deliberately left scope-based (NOT family-filtered):** events, surveys,
alerts, usersByRole — these are province/regional scoped, not center-bound, so
family filtering would be artificial. usersByRole counts can therefore diverge
from family-locked teacher/resource counts; that is intentional (org-scope).

The web Centros page has no family selector — the list is implicitly locked.
