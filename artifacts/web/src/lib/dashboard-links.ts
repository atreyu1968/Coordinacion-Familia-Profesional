/** Resource cards should open the repository's normal, unfiltered route. */
export const RESOURCE_CARD_HREF = "/recursos";

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
