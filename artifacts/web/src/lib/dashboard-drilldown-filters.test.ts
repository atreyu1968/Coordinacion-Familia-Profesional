import { describe, expect, it } from "vitest";
import {
  dashboardRoleForLabel,
  dashboardRoleFromSearch,
  dashboardSurveyStatusForLabel,
  dashboardSurveyStatusFromSearch,
  matchesDashboardIsland,
  matchesDashboardMonth,
} from "./dashboard-drilldown-filters";
import { buildDashboardHref } from "./dashboard-links";

const period = { startDate: "2026-09-01", endDate: "2027-08-31" };
const allowedRoles = [
  "superadmin",
  "coordinator",
  "prospector",
  "department_head",
  "teacher",
] as const;

describe("dashboard chart drilldowns", () => {
  it("opens each chart's destination with the counted role, island, status, or month", () => {
    const chartLinks = [
      {
        path: "/centros",
        filters: { dashboard: "centers", island: "Gran Canaria" },
        needsPeriod: false,
      },
      {
        path: "/usuarios",
        filters: { dashboard: "users", role: "teacher", status: "active" },
        needsPeriod: false,
      },
      {
        path: "/eventos",
        filters: { dashboard: "events", month: "2026-10" },
        needsPeriod: true,
      },
      {
        path: "/encuestas",
        filters: { status: "open" },
        needsPeriod: true,
      },
    ];

    for (const chart of chartLinks) {
      const url = new URL(
        buildDashboardHref(chart.path, chart.filters, 7, period),
        "https://example.test",
      );
      expect(url.pathname).toBe(chart.path);
      for (const [key, value] of Object.entries(chart.filters)) {
        expect(url.searchParams.get(key)).toBe(value);
      }
      expect(url.searchParams.get("provinceId")).toBe("7");
      expect(url.searchParams.has("startDate")).toBe(chart.needsPeriod);
      expect(url.searchParams.has("endDate")).toBe(chart.needsPeriod);
    }
  });

  it("connects the four chart point handlers to their filtered list routes", async () => {
    const { readFileSync } = await import("node:fs");
    const dashboard = readFileSync("src/pages/dashboard.tsx", "utf8");
    expect(dashboard).toMatch(/dashboardHref\("\/centros",\s*\{\s*dashboard:\s*"centers",\s*island:\s*point\.label/);
    expect(dashboard).toMatch(/dashboardHref\("\/usuarios",\s*\{[\s\S]*?dashboard:\s*"users",[\s\S]*?role,[\s\S]*?status:\s*"active"/);
    expect(dashboard).toMatch(/dashboardHref\("\/eventos",\s*\{[\s\S]*?dashboard:\s*"events",[\s\S]*?month:\s*point\.label/);
    expect(dashboard).toMatch(/dashboardHref\("\/encuestas",\s*\{\s*status\s*\}/);
  });

  it("matches island names and retains the chart's no-island centers", () => {
    const names = new Map([[1, "Gran Canaria"], [2, "Tenerife"]]);
    expect(matchesDashboardIsland(1, names, "Gran Canaria")).toBe(true);
    expect(matchesDashboardIsland(2, names, "Gran Canaria")).toBe(false);
    expect(matchesDashboardIsland(null, names, "Sin isla")).toBe(true);
    expect(matchesDashboardIsland(undefined, names, "Sin isla")).toBe(true);
    expect(matchesDashboardIsland(1, names, "Sin isla")).toBe(false);
  });

  it("matches the event's UTC month while retaining both boundary instants", () => {
    expect(matchesDashboardMonth("2026-10-01T00:00:00Z", "2026-10")).toBe(true);
    expect(matchesDashboardMonth("2026-10-31T23:59:59.999Z", "2026-10")).toBe(true);
    expect(matchesDashboardMonth("2026-09-30T23:59:59.999Z", "2026-10")).toBe(false);
    expect(matchesDashboardMonth("2026-11-01T00:00:00Z", "2026-10")).toBe(false);
    expect(matchesDashboardMonth("fecha incorrecta", "2026-10")).toBe(false);
    expect(matchesDashboardMonth("2026-10-01T00:00:00Z", "2026-13")).toBe(false);
  });

  it("maps displayed role and status labels to valid list filters only", () => {
    expect(dashboardRoleForLabel("Profesorado")).toBe("teacher");
    expect(dashboardRoleForLabel("Jefatura de departamento")).toBe("department_head");
    expect(dashboardRoleFromSearch("teacher", allowedRoles)).toBe("teacher");
    expect(dashboardRoleFromSearch("unknown", allowedRoles)).toBeNull();

    expect(dashboardSurveyStatusForLabel("Abierta")).toBe("open");
    expect(dashboardSurveyStatusForLabel("Cerrada")).toBe("closed");
    expect(dashboardSurveyStatusFromSearch("open")).toBe("open");
    expect(dashboardSurveyStatusFromSearch("unknown")).toBeNull();
  });

  it("applies URL filters in each destination and keeps regional and province-only rows", async () => {
    const { readFileSync } = await import("node:fs");
    const centers = readFileSync("src/pages/centros.tsx", "utf8");
    const users = readFileSync("src/pages/usuarios.tsx", "utf8");
    const events = readFileSync("src/pages/eventos.tsx", "utf8");
    const surveys = readFileSync("src/pages/encuestas.tsx", "utf8");
    const usersApi = readFileSync("../api-server/src/routes/users.ts", "utf8");
    const dashboardApi = readFileSync("../api-server/src/routes/dashboard.ts", "utf8");

    expect(centers).toMatch(/searchParams\.get\("island"\)/);
    expect(centers).toMatch(/matchesDashboardIsland\(center\.islandId,\s*islandName,\s*dashboardIsland\)/);
    expect(users).toMatch(/dashboardRoleFromSearch\(requestedRole,\s*ALL_ROLES\)/);
    expect(users).toMatch(/if\s*\(role\)\s*managedParams\.role\s*=\s*role/);
    expect(users).toMatch(/status,\s*teachingProfile,\s*page,\s*pageSize/);
    expect(events).toMatch(/matchesDashboardMonth\(event\.startAt\s*\?\?\s*event\.createdAt,\s*dashboardMonth\)/);
    expect(events).toMatch(/matchesDashboardPeriod\(event\.startAt\s*\?\?\s*event\.createdAt,\s*params\)/);
    expect(surveys).toMatch(/dashboardSurveyStatusFromSearch\(searchParams\.get\("status"\)\)/);
    expect(surveys).toMatch(/surveyParams\.status\s*=\s*requestedStatus/);
    expect(surveys).toMatch(/matchesDashboardPeriod\(survey\.createdAt,\s*searchParams\)/);

    // The chart count includes center-less accounts assigned to this province;
    // the active directory endpoint must preserve that same population.
    expect(dashboardApi).toMatch(/isNull\(usersTable\.centerId\)[\s\S]*?eq\(usersTable\.provinceId,\s*scope\.provinceId\)/);
    // The current directory uses an explicit location filter, including the
    // teaching center before falling back to the account's province.
    expect(usersApi).toMatch(/function userLocationPredicate\(/);
    expect(usersApi).toMatch(/and\(\s*isNull\(usersTable\.centerId\),\s*isNull\(usersTable\.teachingCenterId\),\s*eq\(usersTable\.provinceId,\s*provinceId\)/);
    // Regional surveys and events stay in scope instead of being dropped by a province filter.
    expect(surveys).toMatch(/surveyParams\.provinceId\s*=\s*requestedProvinceId/);
    expect(events).toMatch(/eventParams\.provinceId\s*=\s*requestedProvinceId/);
    expect(readFileSync("../api-server/src/routes/surveys.ts", "utf8")).toMatch(/isNull\(surveysTable\.provinceId\)/);
    expect(readFileSync("../api-server/src/routes/events.ts", "utf8")).toMatch(/isNull\(eventsTable\.provinceId\)/);
  });
});
