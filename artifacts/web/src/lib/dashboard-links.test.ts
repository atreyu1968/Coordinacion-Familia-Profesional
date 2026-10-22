import { describe, expect, it } from "vitest";
import { buildDashboardHref } from "./dashboard-links";

const period = { startDate: "2026-09-01", endDate: "2027-08-31" };

describe("Dashboard drilldown consistency", () => {
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
