import { describe, expect, it } from "vitest";
import { matchesDashboardPeriod } from "./dashboard-record-filters";

describe("dashboard activity list dates", () => {
  const params = new URLSearchParams({ startDate: "2026-09-01", endDate: "2026-09-30" });
  it.each(["resources", "surveys", "events", "alerts"])("keeps both inclusive day boundaries for %s", () => {
    const dates = [
      "2026-08-31T23:59:59.999Z", "2026-09-01T00:00:00Z",
      "2026-09-30T23:59:59.999Z", "2026-10-01T00:00:00Z",
    ];
    expect(dates.filter((date) => matchesDashboardPeriod(date, params))).toEqual(dates.slice(1, 3));
  });
  it("does not include missing or invalid dates in a filtered period", () => {
    for (const date of [null, undefined, "", "not-a-date"]) expect(matchesDashboardPeriod(date, params)).toBe(false);
  });
  it("preserves all records when no date interval is selected", () => {
    expect(matchesDashboardPeriod(undefined, new URLSearchParams())).toBe(true);
  });
  it("compares UTC dates rather than the timestamp's local calendar date", () => {
    expect(matchesDashboardPeriod("2026-10-01T00:30:00+02:00", params)).toBe(true);
  });
});
