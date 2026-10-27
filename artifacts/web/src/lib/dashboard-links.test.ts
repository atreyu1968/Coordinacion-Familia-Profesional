import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildDashboardHref, RESOURCE_CARD_HREF } from "./dashboard-links";

const period = { startDate: "2026-09-01", endDate: "2027-08-31" };

describe("Dashboard drilldown consistency", () => {
  it("opens the resource card at the normal unfiltered repository route", () => {
    const url = new URL(RESOURCE_CARD_HREF, "https://example.test");
    expect(url.pathname).toBe("/recursos");
    expect(url.search).toBe("");
  });
  it("uses that canonical route for the resource card", () => {
    const dashboardSource = readFileSync("src/pages/dashboard.tsx", "utf8");
    const resourceCard = dashboardSource.match(
      /label: isPeriodFiltered \? "Recursos del periodo" : "Recursos"[\s\S]*?href:\s*([^,\n]+)/,
    );
    expect(resourceCard?.[1].trim()).toBe("RESOURCE_CARD_HREF");
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
});
