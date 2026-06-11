---
name: Learning outcomes (RA) & evaluation criteria (CE)
description: Per-module RA/CE model — tables, FK cascade, authorization, and the contract endpoints.
---

# Resultados de Aprendizaje (RA) y Criterios de Evaluación (CE)

Two own tables under the academics domain: learning outcomes belong to a module,
evaluation criteria belong to a learning outcome. Codes are entered manually
(per curricular legislation), each row has code + description + order.

**Data integrity:** both child tables use real Drizzle FKs with
`onDelete: "cascade"` (outcome→module, criterion→outcome). The codebase mostly
uses plain integer columns without FKs, but this feature was explicitly required
to model FKs, so it deviates intentionally. Routes still soft-delete (deletedAt)
rather than hard-delete; the cascade is a safety net, not the primary path.

**Authorization (enforced server-side, not just UI):**
- Read (list outcomes+criteria): anyone who can see the module
  (`moduleVisibleToCaller` OR `isModuleMember`).
- Write (create/update/delete RA and CE): superadmin OR the module's own
  coordinator only (`canEditOutcomes` = role superadmin || isModuleCoordinator).
  Note: provincial coordinators who are NOT the module coordinator may NOT edit.

**Why the frontend checks module membership:** the web edit affordances compute
`canEdit = superadmin || (member list contains me as role "coordinator")`. The
member list is fetched lazily (only when the RA/CE panel is expanded) and with
`retry:false`; a 403 just hides edit controls. Backend is the real gate.

**How to apply:** routes live in `routes/academics.ts`; contract endpoints are
`/modules/{moduleId}/learning-outcomes`, `/learning-outcomes/{id}`,
`/learning-outcomes/{id}/criteria`, `/evaluation-criteria/{id}`. UI is
`components/module-outcomes.tsx`, embedded per-module-row in `ciclos-modulos.tsx`.
