---
name: Dashboard, statistics & annual reports module
description: Scoping rules and gotchas for /dashboard/* and /reports aggregation endpoints
---

# Dashboard & Annual Reports

Aggregation endpoints live in one router (`dashboard.ts`, mounted at root, so
`/reports` is a sibling of `/dashboard/summary`). Scope is derived from
`resolveReadScope` → a local `DashboardScope {provinceId, centerId, empty}`.

## Scoping rules (non-obvious)
- **Resources have no provinceId** — the dashboard derives scope from their
  centers in the active family. Center-less resources are excluded from these
  family-attributed figures; do not infer a province directly on resources.
- **Province-scoped tables** (surveys, events, company_alerts, annual_reports)
  use `provinceId NULL = regional/autonómica, visible to everyone`. A province
  caller sees `provinceId = X OR NULL`; a **center caller** (no province col to
  match) sees **only `NULL`** rows.
- **`scope.empty` (ReadScope.none) is default-deny**: return zeros / `[]`, never
  regional rows. Treating empty like center scope is a data leak (caught in review).

## Annual reports generation (`POST /reports`)
- Roles: superadmin + coordinator only (`requireRole`).
- **Coordinator with no `provinceId` → 403**, never falls back to autonómica.
  Superadmin picks `body.provinceId ?? null` (null = whole region).
- DeepSeek call mirrors `ai.ts`: 503 `{code:"ai_not_configured"}` when key absent.
  **Also 503 (do not persist) if the model returns blank content.**

**Why:** these three were the review-blocking defects — broken access control on
empty scope + coordinator-without-province, and empty-report persistence.

## Contract note
DashboardStatistics was extended with `eventsByMonth` (TimeSeriesPoint[]) and
`surveysByStatus` (CategoryCount[]). "Matrículas" (enrollment) charts were
**skipped — no enrollment/student-count data source exists** in the schema.

## User statistics
Dashboard user totals and users-by-role charts count active, non-deleted
accounts only. Center-assigned accounts are limited to centers in the active
professional-family footprint; province-level accounts without a center remain
in their assigned province.

**Why:** inactive accounts and users attached to centers outside the configured
family make live totals disagree with the platform's usable population.

**How to apply:** keep the summary teacher count and users-by-role chart on the
same status and family-scope rules when changing dashboard aggregates.

## Dashboard period semantics
Centers and active users are **current population totals**, never registrations
within the selected course. Include existing centers/users created before that
course; use the same user-scope rules in the teacher card, role chart and active
directory, including center-less accounts only where authorized.

**Why:** counting registration dates made the main panel omit real, still-active
centers and teachers each new academic year; the teacher card also disagreed
with the role chart for center-less accounts.

**How to apply:** date-filter activity metrics only. Current-population
drilldowns must preserve province/role/status but omit creation-date bounds.
Label both types explicitly; an older course selection is not a historical
population snapshot.

Academic-year labels in `YYYY/YYYY` format map to the inclusive UTC date range
September 1 through August 31. Other dashboard periods are explicit inclusive
date ranges; the API implements the last day as an exclusive next-day boundary.
Activity aggregates use creation time, except events, which use their
start time and fall back to creation time. Existing active/non-deleted filters
still describe current state, not a historical snapshot.

**Why:** activity aggregates do not share an academic-year column; date bounds
give their summary figures and charts one consistent period.

**How to apply:** keep the same date semantics in new dashboard aggregates and
exports, and test both boundary dates and authorization scope.
