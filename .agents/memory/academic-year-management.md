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
- Annual confirmation records the teacher's current center + modules; later corrections reconcile assignments for that year.
- A daily scheduler deactivates teachers only for overdue pending confirmation of the active year; confirmations and deactivation must serialize.

**Rule:** annual confirmation remains a separate, deadline-gated obligation and uses the teacher's saved center. Teachers may change their center immediately and edit active-year modules at any time from their teaching profile; province is derived from the selected center.
**Why:** the user explicitly chose immediate self-service center changes and anytime active-year module editing. Old-year assignments must remain untouched.
**How to apply:** keep the annual confirmation route's deadline and current-center checks. Put teacher-initiated changes on a dedicated authenticated endpoint; validate the destination against the active family, derive province server-side, reconcile only active-year assignments, and synchronize affected module chats.

## Required teacher profile before app access
**Rule:** a teacher cannot use the application until a center is saved and its derived province matches. For the active academic year, the teacher must either save at least one module they teach or explicitly declare that they do not teach. When there is no active year, only the center/province pair is required.
**Why:** the user explicitly requires teachers to complete missing profile information on entry rather than access the app with an incomplete teaching profile.
**How to apply:** gate navigation in both web and mobile until the teaching-profile endpoint confirms completion; do not offer a dismiss path. Enforce the obligation for protected API data and realtime, not just the form. The no-teaching declaration is an explicit alternative to module assignment, not to the required center. Keep self-profile editing and annual confirmation available as repair flows; otherwise the completeness guard can prevent the very confirmation needed to supply current-year modules.

**Rule:** teaching-profile completion also applies to department heads,
coordinators and superadministrators. An administrative role is not an
exemption from declaring center and modules (or explicitly no teaching).
**Why:** the user clarified: "como coordinador y administrador también soy docente".
**How to apply:** enforce the same entry check in desktop, mobile, protected
API reads and realtime eligibility, and allow these roles to save their own
teaching profile. Do not expand the teacher-only overdue annual-confirmation
deactivation process to administrative accounts.

**Rule:** editing personal teaching data must not enlarge administrative scope.
Coordinators keep their assigned province; department heads keep their assigned
management center. Superadministrator authority remains global.
**Why:** those fields also authorize management actions; unrestricted self-editing
would otherwise transfer administrative access without approval.
**How to apply:** validate scope against the locked account during profile saves.
Supporting a teaching center outside that management scope requires separating
personal teaching data from management scope, not relaxing the authorization check.

**Rule:** management indicators of profile integrity must remain informational and separate from annual confirmation and account activation.
**Why:** the requested management visibility must not introduce automatic account deactivation based on missing profile data.
**How to apply:** report pending center, province and active-year modules under the same access rules, without changing account status or annual confirmation records.

Integrity filters and their summaries must diagnose only accounts the caller
can manage, even though more administrative roles now have teaching profiles.
Do not include the caller's own account or non-manageable peers in the
complete/incomplete diagnostic filters.
**Why:** broadening teaching roles without preserving diagnostic eligibility
makes filtered lists include accounts whose profile details are intentionally hidden.

## "Pasar de curso" transition
POST /academic-years/transition clones selectable blocks (groups, training offer, assignments) from a source year to a destination year and must be idempotent (re-running doesn't duplicate).
