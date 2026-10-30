import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildDashboardHref,
  isKnownDashboardPeriod,
  resolveDashboardPeriod,
  RESOURCE_CARD_HREF,
} from "./dashboard-links";

const period = { startDate: "2026-09-01", endDate: "2027-08-31" };
const readSource = (path: string) => readFileSync(path, "utf8");

describe("Dashboard drilldown consistency", () => {
  it("restores only available academic years and falls back to the active year", () => {
    const years = ["2025/2026", "2026/2027"];
    expect(isKnownDashboardPeriod("year:2025/2026", years)).toBe(true);
    expect(isKnownDashboardPeriod("year:2025/2027", years)).toBe(false);
    expect(resolveDashboardPeriod("year:2022/2023", years, "2026/2027")).toBe(
      "year:2026/2027",
    );
    expect(resolveDashboardPeriod(null, [], undefined)).toBe("all");
  });

  it("retains valid all-period and custom-range selections", () => {
    expect(isKnownDashboardPeriod("all", [])).toBe(true);
    expect(isKnownDashboardPeriod("custom", [])).toBe(true);
    expect(resolveDashboardPeriod("custom", [], undefined)).toBe("custom");
  });

  it("stores dashboard scope and period filters in the URL", () => {
    const dashboard = readSource("src/pages/dashboard.tsx");
    expect(dashboard).toContain("useSearchParams()");
    expect(dashboard).toContain('searchParams.get("provinceId")');
    expect(dashboard).toContain('searchParams.get("period")');
    expect(dashboard).toContain("setSearchParams(nextParams, { replace: true })");
  });

  it("opens the resource card at the normal unfiltered repository route", () => {
    const url = new URL(RESOURCE_CARD_HREF, "https://example.test");
    expect(url.pathname).toBe("/recursos");
    expect(url.search).toBe("");
  });
  it("uses that canonical route for the resource card", () => {
    const dashboardSource = readFileSync("src/pages/dashboard.tsx", "utf8");
    const resourceCard = dashboardSource.match(
      /label: isPeriodFiltered \? "Recursos del periodo" : "Recursos"[\s\S]*?description: isPeriodFiltered\s*\? "Recuento del periodo; abre el repositorio completo"\s*: "Abrir repositorio completo"[\s\S]*?href:\s*([^,\n]+)/,
    );
    expect(resourceCard?.[1].trim()).toBe("RESOURCE_CARD_HREF");
    expect(dashboardSource).toContain("{c.description ?? \"Abrir registros\"}");
  });

  it.each(["centers", "users"])("keeps %s totals independent of registration dates without dropping province scope", (kind) => {
    const url = new URL(buildDashboardHref("/directory", { dashboard: kind, role: "teacher" }, 7, period), "https://example.test");
    expect(url.searchParams.get("provinceId")).toBe("7");
    expect(url.searchParams.get("role")).toBe("teacher");
    expect(url.searchParams.has("startDate")).toBe(false);
    expect(url.searchParams.has("endDate")).toBe(false);
  });
  it.each(["resources", "events", "alerts"])("preserves activity dates and other filters for %s", (kind) => {
    const url = new URL(buildDashboardHref("/activity", { dashboard: kind, month: "2026-10" }, 7, period), "https://example.test");
    expect(url.searchParams.get("startDate")).toBe(period.startDate);
    expect(url.searchParams.get("endDate")).toBe(period.endDate);
    expect(url.searchParams.get("month")).toBe("2026-10");
    expect(url.searchParams.get("provinceId")).toBe("7");
  });
  it("does not invent a province for callers without a selected province", () => {
    expect(buildDashboardHref("/centros", { dashboard: "centers" })).toBe("/centros?dashboard=centers");
  });

  it("links each population and activity card with the filters used by its count", () => {
    const cards = [
      {
        path: "/centros",
        filters: { dashboard: "centers" },
        dates: false,
      },
      {
        path: "/usuarios",
        filters: { dashboard: "users", status: "active" },
        dates: false,
      },
      {
        path: "/encuestas",
        filters: { status: "open" },
        dates: true,
      },
      {
        path: "/eventos",
        filters: { dashboard: "events" },
        dates: true,
      },
      {
        path: "/fct",
        filters: { dashboard: "alerts" },
        dates: true,
      },
    ];

    for (const card of cards) {
      const href = buildDashboardHref(card.path, card.filters, 7, period);
      const url = new URL(href, "https://example.test");
      expect(url.pathname).toBe(card.path);
      for (const [key, value] of Object.entries(card.filters)) {
        expect(url.searchParams.get(key)).toBe(value);
      }
      expect(url.searchParams.get("provinceId")).toBe("7");
      expect(url.searchParams.has("startDate")).toBe(card.dates);
      expect(url.searchParams.has("endDate")).toBe(card.dates);
    }
  });

  it("keeps the card routes and filters wired to their respective destinations", () => {
    const dashboard = readSource("src/pages/dashboard.tsx");
    expect(dashboard).toMatch(/dashboardHref\("\/centros",\s*\{\s*dashboard:\s*"centers"/);
    expect(dashboard).toMatch(/dashboardHref\("\/usuarios",\s*\{[\s\S]*?dashboard:\s*"users",[\s\S]*?status:\s*"active"/);
    expect(dashboard).toMatch(/dashboardHref\("\/encuestas",\s*\{\s*status:\s*"open"/);
    expect(dashboard).toMatch(/dashboardHref\([\s\S]*?"\/eventos",[\s\S]*?dashboard:\s*"events"/);
    expect(dashboard).toMatch(/dashboardHref\("\/fct",\s*\{\s*dashboard:\s*"alerts"/);

    const centers = readSource("src/pages/centros.tsx");
    expect(centers).toMatch(/searchParams\.get\("dashboard"\)\s*===\s*"centers"/);
    expect(centers).toMatch(/if\s*\(dashboardOnly\)\s*params\.dashboardOnly\s*=\s*true/);
    expect(centers).toMatch(/searchParams\.get\("provinceId"\)/);
    expect(centers).toMatch(/searchParams\.get\("island"\)/);

    const users = readSource("src/pages/usuarios.tsx");
    expect(users).toMatch(/searchParams\.get\("dashboard"\)\s*===\s*"users"/);
    expect(users).toMatch(/searchParams\.get\("status"\)/);
    expect(users).toMatch(/searchParams\.get\("role"\)/);
    expect(users).toMatch(/searchParams\.get\("provinceId"\)/);
    expect(users).toMatch(/if\s*\(status\s*!==\s*"all"\)\s*list\s*=\s*list\.filter/);
    expect(users).toMatch(/useListManagedUsers\(managedParams/);
    expect(users).toMatch(/const managedParams:\s*ListManagedUsersParams\s*=\s*\{\s*status,/);
    expect(users).toMatch(/if\s*\(dashboardOnly\)\s*\{/);
    expect(users).toMatch(/isTeacher\s*\?\s*familyDirectoryCenters\s*:\s*centers/);
    expect(users).toMatch(/listedUser\.teachingCenterId/);

    const surveys = readSource("src/pages/encuestas.tsx");
    expect(surveys).toMatch(/searchParams\.get\("status"\)/);
    expect(surveys).toMatch(/surveyParams\.status\s*=\s*requestedStatus/);
    expect(surveys).toMatch(/searchParams\.get\("provinceId"\)/);
    expect(surveys).toMatch(/surveyParams\.provinceId\s*=\s*requestedProvinceId/);
    expect(surveys).toMatch(/useListSurveys\(surveyParams\)/);
    expect(surveys).toMatch(/matchesDashboardPeriod\(survey\.createdAt,\s*searchParams\)/);

    const events = readSource("src/pages/eventos.tsx");
    expect(events).toMatch(/params\.get\("provinceId"\)/);
    expect(events).toMatch(/params\.get\("period"\)\s*===\s*"upcoming"/);
    expect(events).toMatch(/if\s*\(upcomingOnly\)\s*\{[\s\S]*?event\.startAt[\s\S]*?start\s*<\s*now/);
    expect(events).toMatch(/matchesDashboardPeriod\(event\.startAt\s*\?\?\s*event\.createdAt,\s*params\)/);
    expect(events).toMatch(/params\.get\("month"\)/);
    expect(events).toMatch(/useListEvents\(eventParams\)/);

    const alerts = readSource("src/pages/fct.tsx");
    expect(alerts).toMatch(/searchParams\.get\("provinceId"\)/);
    expect(alerts).toMatch(/alert\.provinceId\s*==\s*null[\s\S]*?alert\.provinceId\s*===\s*selectedProvinceId/);
    expect(alerts).toMatch(/matchesDashboardPeriod\(alert\.createdAt,\s*searchParams\)/);
  });

  it("matches the card's population and visibility rules without dropping valid records", () => {
    const centersApi = readSource("../api-server/src/routes/centers.ts");
    expect(centersApi).toMatch(/filters:\s*SQL\[\]\s*=\s*\[isNull\(centersTable\.deletedAt\)\]/);
    expect(centersApi).toMatch(/scope\.kind\s*===\s*"province"[\s\S]*?eq\(centersTable\.provinceId,\s*scope\.provinceId\)/);
    expect(centersApi).toMatch(/scope\.kind\s*===\s*"center"[\s\S]*?eq\(centersTable\.id,\s*scope\.centerId\)/);
    expect(centersApi).toMatch(/centersTable\.families[\s\S]*?activeFamily/);

    const usersApi = readSource("../api-server/src/routes/users.ts");
    expect(usersApi).toMatch(/if\s*\(status\s*===\s*"active"\)[\s\S]*?eq\(usersTable\.status,\s*"active"\)/);
    expect(usersApi).toMatch(/inArray\(usersTable\.centerId,\s*familyCenterIds\)/);
    expect(usersApi).toMatch(/inArray\(usersTable\.teachingCenterId,\s*familyCenterIds\)/);
    expect(usersApi).toMatch(/and\(isNull\(usersTable\.centerId\),\s*isNull\(usersTable\.teachingCenterId\)\)/);
    expect(usersApi).toMatch(/eq\(usersTable\.provinceId,\s*provinceId\)/);

    const surveysApi = readSource("../api-server/src/routes/surveys.ts");
    expect(surveysApi).toMatch(/if\s*\(query\.data\.status\)[\s\S]*?eq\(surveysTable\.status,\s*query\.data\.status\)/);
    expect(surveysApi).toMatch(/isNull\(surveysTable\.provinceId\)/);
    expect(surveysApi).toMatch(/filterVisibleSurveys\(caller,\s*allRows\)/);

    const eventsApi = readSource("../api-server/src/routes/events.ts");
    expect(eventsApi).toMatch(/isNull\(eventsTable\.deletedAt\)/);
    expect(eventsApi).toMatch(/isNull\(eventsTable\.provinceId\)/);
    expect(eventsApi).toMatch(/eq\(eventsTable\.provinceId,\s*query\.data\.provinceId\)/);

    const alertsApi = readSource("../api-server/src/routes/fct.ts");
    expect(alertsApi).toMatch(/isNull\(companyAlertsTable\.deletedAt\)/);
    expect(alertsApi).toMatch(/isNull\(companyAlertsTable\.provinceId\)/);
    expect(alertsApi).toMatch(/eq\(companyAlertsTable\.provinceId,\s*query\.data\.provinceId\)/);
  });

  it("uses the same access and population predicates for panel counts and destination lists", () => {
    const dashboardApi = readSource("../api-server/src/routes/dashboard.ts");
    expect(dashboardApi).toMatch(/activeUserScopeFilters\(scope,\s*activeFamily\)/);
    expect(dashboardApi).toMatch(/isNull\(usersTable\.deletedAt\)[\s\S]*?eq\(usersTable\.status,\s*"active"\)/);
    expect(dashboardApi).toMatch(/surveysTable\.status,\s*"open"/);
    expect(dashboardApi).toMatch(/filterVisibleSurveys\(req\.user!,/);
    expect(dashboardApi).toMatch(/activityProvinceFilter\(eventsTable\.provinceId,\s*scope\)/);
    expect(dashboardApi).toMatch(/activityProvinceFilter\(companyAlertsTable\.provinceId,\s*scope\)/);
  });
});
