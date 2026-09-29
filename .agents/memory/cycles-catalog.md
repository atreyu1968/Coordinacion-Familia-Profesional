---
name: Global cycles→modules catalog
description: How the global cycle catalog relates to modules, training-offer, and the Configuración tabs surface.
---

# Global cycles→modules catalog

`cyclesTable` is a GLOBAL catalog (not center-scoped). CRUD is superadmin-only.
`modules.cycleId` and `trainingOffer.cycleId` reference it; both also keep a
denormalized `cycleName` for compat/display, populated FROM the catalog on write.
New cycle creation must choose an active-family center and add the initial offer
in the same transaction; otherwise the family-filtered list hides it before a
center can select it.

**Why:** centers should pick which catalog cycles they offer (via training-offer
in the Centros tab) rather than retyping free-text cycle names — previously cycle
was free text on module/group/training-offer forms, causing drift.

**How to apply:**
- Forms (module/group/training-offer dialogs) select a catalog cycle via dropdown.
  Module dialog & training-offer send `cycleId`; group form sends the selected
  cycle's `cycleName` (CreateGroupInput has no cycleId).
- Renaming a cycle (PATCH /cycles/:id) syncs `cycleName` on dependent modules +
  training_offer rows.
- Catalog module mutations (POST/PATCH/DELETE /modules) are superadmin-only; the
  "Ciclos y módulos" tab creates GLOBAL modules (centerId=null). Pre-existing
  center-scoped modules still exist and are intentionally NOT removed.
- Configuración lives at route /panel-control as a tabbed page
  (Integraciones/Copias, Invitaciones, Centros, Ciclos y módulos). It embeds the
  existing standalone pages as tabs and is guarded superadmin-only at the page
  level (sidebar hiding alone is not a guard). Coordinator/department_head keep
  their standalone /invitaciones and /centros routes.
