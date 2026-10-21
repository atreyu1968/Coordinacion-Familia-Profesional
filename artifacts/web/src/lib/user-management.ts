import type { Center, Role, User } from "@workspace/api-client-react";

export const ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadmin",
  coordinator: "Coordinador/a",
  prospector: "Prospector/a",
  department_head: "Jefe/a de departamento",
  teacher: "Profesor/a",
};

export const ROLE_RANK: Record<string, number> = {
  superadmin: 100,
  coordinator: 80,
  prospector: 60,
  department_head: 50,
  teacher: 20,
};

export const ALL_ROLES: Role[] = [
  "superadmin",
  "coordinator",
  "prospector",
  "department_head",
  "teacher",
] as Role[];

export const MANAGER_ROLES = ["superadmin", "coordinator", "department_head"];

export function isManagerRole(role: string | undefined | null): boolean {
  return MANAGER_ROLES.includes(role ?? "");
}

/** Roles the caller may assign: superadmin all; others strictly below own rank. */
export function assignableRoles(callerRole: string | undefined): Role[] {
  if (callerRole === "superadmin") return ALL_ROLES;
  const rank = ROLE_RANK[callerRole ?? ""] ?? 0;
  return ALL_ROLES.filter((r) => (ROLE_RANK[r] ?? 0) < rank);
}

/** Centers within the caller's scope (server remains final authority). */
export function scopedCenters(caller: User | null, centers: Center[]): Center[] {
  if (!caller) return [];
  if (caller.role === "superadmin") return centers;
  if (caller.role === "coordinator")
    return caller.provinceId == null
      ? []
      : centers.filter((c) => c.provinceId === caller.provinceId);
  if (caller.role === "department_head")
    return caller.centerId == null
      ? []
      : centers.filter((c) => c.id === caller.centerId);
  return centers;
}

export function getApiErrorMessage(error: unknown): string | undefined {
  if (error && typeof error === "object") {
    const data = (error as { data?: { message?: unknown } }).data;
    if (data && typeof data.message === "string" && data.message.trim())
      return data.message;
  }
  return undefined;
}
