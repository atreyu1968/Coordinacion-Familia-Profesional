export function matchesDashboardIsland(
  islandId: number | null | undefined,
  islandNames: ReadonlyMap<number, string>,
  requestedIsland: string,
): boolean {
  if (requestedIsland === "Sin isla") return islandId == null;
  return islandId != null && islandNames.get(islandId) === requestedIsland;
}

export function matchesDashboardMonth(
  value: string | null | undefined,
  month: string | null | undefined,
): boolean {
  if (!value || !month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 7) === month;
}

export function dashboardRoleFromSearch<T extends string>(
  value: string | null,
  allowedRoles: readonly T[],
): T | null {
  return value != null && allowedRoles.includes(value as T) ? (value as T) : null;
}

export function dashboardSurveyStatusFromSearch(
  value: string | null,
): "draft" | "open" | "closed" | null {
  return value === "draft" || value === "open" || value === "closed" ? value : null;
}

export function dashboardRoleForLabel(label: string): string | null {
  const roles: Record<string, string> = {
    Superadministración: "superadmin",
    Coordinación: "coordinator",
    Prospección: "prospector",
    "Jefatura de departamento": "department_head",
    Profesorado: "teacher",
  };
  return roles[label] ?? null;
}

export function dashboardSurveyStatusForLabel(label: string): string | null {
  const statuses: Record<string, string> = {
    Borrador: "draft",
    Abierta: "open",
    Cerrada: "closed",
  };
  return statuses[label] ?? null;
}
