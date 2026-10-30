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
- Web: `apariencia-settings.tsx` reads `professionalFamilyLocked`; the family is a
  `Select` dropdown (options from `lib/professional-families.ts`, the 26 canonical
  INCUAL families + any current value not in the list); when locked it is
  `disabled` with a permanent-lock note and the change-confirm dialog never fires.
- Panel de Control shows an Outline status card (`outlineConfigured`) mirroring the
  Nextcloud one, so its connection state is visible like Nextcloud's.
**Why presence-based:** a fresh/self-hosted install must still be able to pick a
non-default family ONCE; locking on the raw column (not the resolved fallback)
allows that one selection, then freezes it.

**Why:** centers store `families`, but cycles and modules are global catalog
rows without a family column. The official Grados D source assigns families
to cycles; requiring a center's training offer to discover that membership
hid nearly every official module on installations without offers.

**How to apply — module/cycle catalog:** match known official cycles against
their source family membership, including cycles cross-listed in two families;
only custom or unknown cycles fall back to active-family centers' training
offers. A center's offer in the wrong family must not make an official module
visible outside its official family. Center-specific modules additionally
require their own center to belong to the active family. Keep the catalog
available even if no center has recorded an offer yet.

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
- Forum module lists, thread creation, and thread access: center-scoped modules
  qualify only when their center includes the active family; global modules
  qualify only when an active-family center offers their cycle (match cycle ID,
  with a cycle-name fallback for legacy rows). Existing out-of-family forum data
  remains stored but is hidden and inaccessible, not deleted.
- `GET /modules`, `GET /cycles`, and `GET /cycles/:id/modules` use the same
  official-family rules. Official cycles do not require a local offer;
  module totals count only active-family modules.

**Deliberately left scope-based (NOT family-filtered):** events, surveys,
alerts, usersByRole — these are province/regional scoped, not center-bound, so
family filtering would be artificial. usersByRole counts can therefore diverge
from family-locked teacher/resource counts; that is intentional (org-scope).

The web Centros page has no family selector — the list is implicitly locked.

**How to apply — user-directory geographic and module filters:** derive
province/island options only from non-deleted centers in the active family.
Derive module options from non-deleted teaching assignments at the active
academic year and apply `moduleFamilyFilter`; if no year is configured, use
all non-deleted assignments. Keep coordinator facets and module-assignment
matches within the coordinator's province.

**Why:** the generic center and module endpoints have caller-specific scopes
that can omit valid family-wide dropdown options; the dedicated facets must
retain active-family rules without widening account-management permissions.

**Rule — directory compatibility:** all supported teacher directory URLs must
apply the same family-wide read policy, including legacy list URLs. Build the
center selector from the family catalog, not the currently filtered user rows.

**Why:** a corrected new directory does not help clients still using an older
URL; deriving centers from filtered rows also removes valid center choices.

**How to apply:** test both list URLs across centers and provinces, including
entry from a scoped dashboard; keep administrative write permissions separate.
