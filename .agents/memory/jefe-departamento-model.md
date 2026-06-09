---
name: Jefe de Departamento model
description: How "Jefe de Departamento ADG por centro" is modeled in Coordina ADG (role, not entity).
---

The "Jefe de Departamento ADG por centro" concept is represented by the `department_head` **role** assigned to a user scoped to a **center** — there is no `departments` table or `departmentId` column.

**Why:** A standalone departments entity (table, `departmentId` on users/invitations, `/departments` endpoints, a "Departamentos" web section) was removed because the only thing ADG needs is "who is the department head at each center." Modeling it as a center-scoped role is simpler and matches how scope resolution already works (`resolveReadScope`/`hasScopeOver` are center-based).

**How to apply:** Keep `department_head` everywhere it matters — role enums, auth/middleware, notifications, UI role labels, role-based nav visibility, and invitation/register flows (which map `provinceId` + `centerId`, never a department). Do NOT reintroduce a departments entity/endpoint/page to satisfy a "department head" requirement; assign the role to a user at a center instead.
