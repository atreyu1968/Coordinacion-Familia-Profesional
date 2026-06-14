---
name: Active professional-family lock
description: How the whole app is locked to the single configured familia profesional, and the surfaces that must enforce it.
---

# Active professional-family lock

The instance is locked to ONE active professional family for ALL users.
Active family = `professionalFamilyOf(getSettings())` (helper `getActiveFamily()`
in `lib/settings.ts`), fallback `"Administración y Gestión"`. Superadmin changes
it in Configuración → Apariencia, gated behind a double confirmation
(AlertDialog + acknowledgement checkbox).

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
