---
name: Academic year management (cursos académicos)
description: How the managed academic-year entity drives app-wide filtering, the transition wizard, and the annual teacher confirmation lifecycle.
---

# Academic year (curso académico) management

`school_year` stays a free TEXT course name everywhere (e.g. "2025/2026"); there are NO hard FKs to the year table. The official list lives in `academic_years` and the active one in `integration_settings.activeAcademicYear`. The list is seeded from existing distinct `school_year` values on startup.

## Active year is the DEFAULT filter — not "all"
**Rule:** any page/list that is year-scoped must default to the *active* year, never to "Todos los cursos" (ALL_YEARS).
**Why:** the core requirement is that the active course filters app behavior by default; defaulting to ALL shows cross-year data and contradicts the spec. A review caught the Académica page initializing to ALL_YEARS — that is a regression to avoid.
**How to apply:** initialize the filter state empty and set it from `useAcademicYears().activeYear` in a `useEffect` once loaded (same pattern as the settings panel). When no schoolYear param is sent, the backend defaults to the active year (`resolveYearFilter`), so omitting the param before the value resolves is also correct. ALL is an explicit opt-in only.

## Mixed-semantics gotcha (Profesorado tab)
The teacher-confirmation list is inherently per-year (backend returns active-year confirmations when no schoolYear). If the page shows ALL years, the assignment/module counts are all-years while confirmation status would be a single year — mixed semantics. **Hide the confirmation column when ALL is selected** (gate on `showConfirmation = canManage && year && year !== ALL_YEARS`), and gate the confirmations query `enabled` on the same flag.

## Annual teacher confirmation lifecycle
- Activating a year creates pending confirmations for role=teacher with a deadline (default 15 days) and sends a reminder email only if email is configured.
- Teacher confirms center + modules → generates teaching assignments for that year.
- A daily scheduler (setInterval-based, started in api-server index) deactivates teachers (role=teacher only) with an overdue pending confirmation. Inactive login shows a specific message; manual reactivation reopens the confirmation.

## "Pasar de curso" transition
POST /academic-years/transition clones selectable blocks (groups, training offer, assignments) from a source year to a destination year and must be idempotent (re-running doesn't duplicate).
