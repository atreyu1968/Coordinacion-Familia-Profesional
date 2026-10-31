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

## User-verified ADG curriculum source

The user confirmed on 2026-10-31 that their reviewed spreadsheet is correct and
verified for the Administración y Gestión family. Treat its module catalog,
cycle assignments, codes and names, RA/CE, normative references, versions,
territory, and review information as the authoritative baseline. Do not replace
or “correct” that data using scraped or independently inferred sources.

**Why:** This is the user's verified curricular source of truth; external catalogs
can differ in naming, curriculum version, or family scope.

**How to apply:** Use the reviewed spreadsheet as the baseline for curriculum
seeding, imports, and discrepancy checks. Preserve its explicit review states;
ask before overriding any user-verified entry.

La confirmación de la hoja incluye sus fuentes normativas, versiones y
territorios; no exigir al coordinador volver a introducirlos o verificar el mismo
contenido para configurar la colaboración.

**Why:** El usuario aclaró que ya había aportado y verificado esa información
en el Excel, no solamente los textos de RA y CE.

**How to apply:** Heredar esa revisión cuando los datos registrados coincidan
exactamente con la hoja. Mantener separada la activación del piloto y solicitar
otra revisión solo si cambia la fuente o el contenido curricular.

Los módulos compartidos por varios ciclos pueden conservar el mismo código
oficial. Esa coincidencia entre ciclos no invalida el currículo verificado.

**Why:** La hoja confirmada por el usuario contiene módulos oficiales comunes a
distintos ciclos; exigir códigos globalmente únicos produciría incidencias falsas.

**How to apply:** Evaluar la identidad curricular en su ciclo y contexto, sin
inventar códigos distintos ni fusionar automáticamente sus foros o asignaciones.

La verificación de la hoja de origen no equivale a una revisión personal del
coordinador que activa o configura un piloto. No atribuirle esa revisión sin
una confirmación expresa, aunque el currículo coincida con la fuente importada.

**Why:** La procedencia de una fuente y la autoría de una revisión local son
hechos distintos; dar por confirmada la segunda inventa una actuación humana.

**How to apply:** Mantener explícita la confirmación personal al guardar una
configuración y no deducirla de que el currículo esté verificado.

El diagnóstico de herencia debe representar las etapas reales de la importación,
no limitarse a comparar la hoja con el estado anterior a la carga.

**Why:** La carga puede completar filas ausentes y corregir identidades antiguas
antes de comprobar la coincidencia exacta; una comparación previa puede anunciar
una omisión que nunca ocurrirá.

**How to apply:** Compartir las reglas de planificación entre carga e informe,
simular solo los cambios permitidos y conservar como bloqueos las ediciones,
eliminaciones y ambigüedades locales.
