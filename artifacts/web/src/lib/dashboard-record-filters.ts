/** Match the dashboard's inclusive UTC-day bounds; missing dates do not match a period. */
export function matchesDashboardPeriod(value: string | null | undefined, params: URLSearchParams): boolean {
  const from = params.get("startDate");
  const to = params.get("endDate");
  if (!from && !to) return true;
  if (!value) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const day = date.toISOString().slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
}
