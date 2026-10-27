/** Resource cards should open the repository's normal, unfiltered route. */
export const RESOURCE_CARD_HREF = "/recursos";

export function isKnownDashboardPeriod(
  period: string | null,
  academicYears: string[],
): boolean {
  if (period === "all" || period === "custom") return true;
  if (!period?.startsWith("year:")) return false;
  const year = period.slice("year:".length);
  return (
    academicYears.includes(year) &&
    /^(\d{4})\/(\d{4})$/.test(year) &&
    Number(year.slice(5)) === Number(year.slice(0, 4)) + 1
  );
}

export function resolveDashboardPeriod(
  requestedPeriod: string | null,
  academicYears: string[],
  activeYear: string | null | undefined,
): string {
  if (isKnownDashboardPeriod(requestedPeriod, academicYears)) {
    return requestedPeriod!;
  }
  const activePeriod = activeYear ? `year:${activeYear}` : null;
  return isKnownDashboardPeriod(activePeriod, academicYears)
    ? activePeriod!
    : "all";
}

/** Population totals are current; only activity drilldowns carry date bounds. */
export function buildDashboardHref(
  path: string,
  filters: Record<string, string>,
  provinceId?: number,
  period?: { startDate: string; endDate: string },
): string {
  const query = new URLSearchParams(filters);
  if (provinceId !== undefined) query.set("provinceId", String(provinceId));
  if (period && filters.dashboard !== "centers" && filters.dashboard !== "users") {
    query.set("startDate", period.startDate);
    query.set("endDate", period.endDate);
  }
  return `${path}?${query.toString()}`;
}
