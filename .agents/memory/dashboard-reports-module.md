---
name: Dashboard, statistics & annual reports module
description: Scoping rules and gotchas for /dashboard/* and /reports aggregation endpoints
---

# Dashboard & Annual Reports (Task #7)

Aggregation endpoints live in one router (`dashboard.ts`, mounted at root, so
`/reports` is a sibling of `/dashboard/summary`). Scope is derived from
`resolveReadScope` → a local `DashboardScope {provinceId, centerId, empty}`.

## Scoping rules (non-obvious)
- **Resources have no provinceId** — they hang off a center. Province scope =
  `centerId IN (centers of province) OR centerId IS NULL`; center scope =
  `centerId = X`. Anything else double-counts or leaks.
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
