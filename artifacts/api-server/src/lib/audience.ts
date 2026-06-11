import { eq, and, isNull, inArray, or, type SQL } from "drizzle-orm";
import {
  db,
  usersTable,
  centersTable,
  islandsTable,
  modulesTable,
  moduleMembershipsTable,
} from "@workspace/db";
import type { User } from "@workspace/db";

// Recipient/audience targeting shared by document forms, surveys and meetings.
// Role-based types ("department_head", "coordinator") target every user with
// that role; their audienceIds (when present) restrict the role to a set of
// provinces (empty = all provinces).
export const AUDIENCE_TYPES = [
  "all",
  "province",
  "island",
  "center",
  "module",
  "users",
  "department_head",
  "coordinator",
] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

// Audience types that target a role instead of a scope/list. Their audienceIds
// (if any) are province ids restricting the role; empty means all provinces.
export const ROLE_AUDIENCE_TYPES = ["department_head", "coordinator"] as const;
export function isRoleAudienceType(
  t: string,
): t is (typeof ROLE_AUDIENCE_TYPES)[number] {
  return (ROLE_AUDIENCE_TYPES as readonly string[]).includes(t);
}

export function isAudienceType(value: unknown): value is AudienceType {
  return (
    typeof value === "string" &&
    (AUDIENCE_TYPES as readonly string[]).includes(value)
  );
}

// Module ids the user is the coordinator of (active memberships only).
export async function getCoordinatedModuleIds(
  userId: number,
): Promise<number[]> {
  const rows = await db
    .select({ moduleId: moduleMembershipsTable.moduleId })
    .from(moduleMembershipsTable)
    .where(
      and(
        eq(moduleMembershipsTable.userId, userId),
        eq(moduleMembershipsTable.role, "coordinator"),
        isNull(moduleMembershipsTable.deletedAt),
      ),
    );
  return rows.map((r) => r.moduleId);
}

// Who may create forms/surveys: superadmin, provincial coordinator, or any
// user who is the coordinator of at least one module.
export async function canCreateFormsSurveys(caller: User): Promise<boolean> {
  if (caller.role === "superadmin" || caller.role === "coordinator") {
    return true;
  }
  const coordinated = await getCoordinatedModuleIds(caller.id);
  return coordinated.length > 0;
}

export type ViewerContext = {
  userId: number;
  role: string;
  provinceId: number | null;
  centerId: number | null;
  islandId: number | null;
  moduleIds: number[];
};

// Build the audience-membership context for a viewer: their province, the
// center they belong to (and its island/province), and the modules they are
// enrolled in (any role).
export async function getViewerContext(user: User): Promise<ViewerContext> {
  let provinceId = user.provinceId ?? null;
  let islandId: number | null = null;
  const centerId = user.centerId ?? null;

  if (centerId != null) {
    const [center] = await db
      .select({
        provinceId: centersTable.provinceId,
        islandId: centersTable.islandId,
      })
      .from(centersTable)
      .where(eq(centersTable.id, centerId));
    if (center) {
      islandId = center.islandId ?? null;
      if (provinceId == null) provinceId = center.provinceId ?? null;
    }
  }

  const memberships = await db
    .select({ moduleId: moduleMembershipsTable.moduleId })
    .from(moduleMembershipsTable)
    .where(
      and(
        eq(moduleMembershipsTable.userId, user.id),
        isNull(moduleMembershipsTable.deletedAt),
      ),
    );

  return {
    userId: user.id,
    role: user.role,
    provinceId,
    centerId,
    islandId,
    moduleIds: memberships.map((m) => m.moduleId),
  };
}

// Whether a viewer falls within the given audience.
export function isInAudience(
  audienceType: string,
  audienceIds: number[] | null | undefined,
  ctx: ViewerContext,
): boolean {
  const ids = audienceIds ?? [];
  switch (audienceType) {
    case "all":
      return true;
    case "province":
      return ctx.provinceId != null && ids.includes(ctx.provinceId);
    case "island":
      return ctx.islandId != null && ids.includes(ctx.islandId);
    case "center":
      return ctx.centerId != null && ids.includes(ctx.centerId);
    case "module":
      return ctx.moduleIds.some((m) => ids.includes(m));
    case "users":
      return ids.includes(ctx.userId);
    case "department_head":
    case "coordinator":
      // Role audience: the viewer must hold the role and, when restricted to a
      // set of provinces, belong to one of them (empty ids = all provinces).
      if (ctx.role !== audienceType) return false;
      return ids.length === 0 || (ctx.provinceId != null && ids.includes(ctx.provinceId));
    default:
      return false;
  }
}

export type AudienceValidation =
  | { ok: true; audienceType: AudienceType; audienceIds: number[] }
  | { ok: false; message: string };

// Validate (and normalize) a requested audience against the caller's authority.
// - superadmin: any audience.
// - provincial coordinator: only targets within their own province.
// - module coordinator: only their own modules, or members of those modules.
export async function validateAudience(
  caller: User,
  rawType: string | undefined,
  rawIds: number[] | undefined,
): Promise<AudienceValidation> {
  const audienceType: AudienceType = isAudienceType(rawType) ? rawType : "all";
  const ids = Array.from(
    new Set((rawIds ?? []).filter((n) => Number.isInteger(n) && n > 0)),
  );

  if (audienceType === "all") {
    if (caller.role === "superadmin") {
      return { ok: true, audienceType: "all", audienceIds: [] };
    }
    return {
      ok: false,
      message: "No tienes permiso para enviar a todos los destinatarios",
    };
  }

  // Role audiences (jefes de departamento / coordinadores). audienceIds are the
  // provinces the role is restricted to (empty = all provinces). Superadmin may
  // target the whole org or pick provinces; a provincial coordinator is pinned
  // to their own province; module coordinators cannot use role audiences.
  if (isRoleAudienceType(audienceType)) {
    if (caller.role === "superadmin") {
      return { ok: true, audienceType, audienceIds: ids };
    }
    if (caller.role === "coordinator") {
      if (caller.provinceId == null) {
        return { ok: false, message: "No tienes una provincia asignada" };
      }
      return { ok: true, audienceType, audienceIds: [caller.provinceId] };
    }
    return {
      ok: false,
      message: "No tienes permiso para enviar a ese tipo de destinatario",
    };
  }

  if (ids.length === 0) {
    return { ok: false, message: "Debes seleccionar al menos un destinatario" };
  }

  if (caller.role === "superadmin") {
    return { ok: true, audienceType, audienceIds: ids };
  }

  if (caller.role === "coordinator") {
    if (caller.provinceId == null) {
      return { ok: false, message: "No tienes una provincia asignada" };
    }
    const p = caller.provinceId;
    const ok = await idsBelongToProvince(audienceType, ids, p);
    if (!ok) {
      return {
        ok: false,
        message: "Solo puedes enviar a destinatarios de tu provincia",
      };
    }
    return { ok: true, audienceType, audienceIds: ids };
  }

  // Module coordinator: restricted to their own modules / members thereof.
  const coordinated = await getCoordinatedModuleIds(caller.id);
  if (coordinated.length === 0) {
    return { ok: false, message: "Permiso denegado" };
  }
  if (audienceType === "module") {
    const allowed = new Set(coordinated);
    if (!ids.every((id) => allowed.has(id))) {
      return {
        ok: false,
        message: "Solo puedes enviar a los módulos que coordinas",
      };
    }
    return { ok: true, audienceType, audienceIds: ids };
  }
  if (audienceType === "users") {
    const members = await db
      .select({ userId: moduleMembershipsTable.userId })
      .from(moduleMembershipsTable)
      .where(
        and(
          inArray(moduleMembershipsTable.moduleId, coordinated),
          isNull(moduleMembershipsTable.deletedAt),
        ),
      );
    const allowed = new Set(members.map((m) => m.userId));
    if (!ids.every((id) => allowed.has(id))) {
      return {
        ok: false,
        message:
          "Solo puedes enviar a miembros de los módulos que coordinas",
      };
    }
    return { ok: true, audienceType, audienceIds: ids };
  }
  return {
    ok: false,
    message: "Como coordinador de módulo solo puedes elegir módulo o usuarios",
  };
}

// Whether a caller may manage (delete / view submissions / view results) a
// form or survey with the given audience. Management authority mirrors the
// authority required to target that audience: superadmin manages anything;
// a provincial coordinator manages items whose audience falls within their
// province; "all" (global) items are superadmin-only.
export async function canManageAudience(
  caller: User,
  audienceType: string,
  audienceIds: number[] | null | undefined,
): Promise<boolean> {
  if (caller.role === "superadmin") return true;
  if (caller.role === "coordinator") {
    if (caller.provinceId == null) return false;
    if (!isAudienceType(audienceType) || audienceType === "all") return false;
    return idsBelongToProvince(
      audienceType,
      audienceIds ?? [],
      caller.provinceId,
    );
  }
  return false;
}

// Resolve an audience to the set of active user ids it targets. Aggregate
// counterpart of isInAudience, used to notify recipients (e.g. new meeting).
export async function resolveAudienceUserIds(
  audienceType: string,
  audienceIds: number[] | null | undefined,
): Promise<number[]> {
  const ids = audienceIds ?? [];
  const active = and(
    eq(usersTable.status, "active"),
    isNull(usersTable.deletedAt),
  );

  const selectUsers = async (where: SQL | undefined): Promise<number[]> => {
    const rows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .leftJoin(centersTable, eq(usersTable.centerId, centersTable.id))
      .where(where);
    return Array.from(new Set(rows.map((r) => r.id)));
  };

  switch (audienceType) {
    case "all":
      return selectUsers(active);
    case "province":
      if (ids.length === 0) return [];
      return selectUsers(
        and(
          active,
          or(
            inArray(usersTable.provinceId, ids),
            inArray(centersTable.provinceId, ids),
          ),
        ),
      );
    case "island":
      if (ids.length === 0) return [];
      return selectUsers(and(active, inArray(centersTable.islandId, ids)));
    case "center":
      if (ids.length === 0) return [];
      return selectUsers(and(active, inArray(usersTable.centerId, ids)));
    case "users":
      if (ids.length === 0) return [];
      return selectUsers(and(active, inArray(usersTable.id, ids)));
    case "department_head":
    case "coordinator": {
      const roleCond = eq(usersTable.role, audienceType);
      if (ids.length === 0) return selectUsers(and(active, roleCond));
      return selectUsers(
        and(
          active,
          roleCond,
          or(
            inArray(usersTable.provinceId, ids),
            inArray(centersTable.provinceId, ids),
          ),
        ),
      );
    }
    case "module": {
      if (ids.length === 0) return [];
      const rows = await db
        .select({ userId: usersTable.id })
        .from(moduleMembershipsTable)
        .innerJoin(
          usersTable,
          eq(usersTable.id, moduleMembershipsTable.userId),
        )
        .where(
          and(
            inArray(moduleMembershipsTable.moduleId, ids),
            isNull(moduleMembershipsTable.deletedAt),
            active,
          ),
        );
      return Array.from(new Set(rows.map((r) => r.userId)));
    }
    default:
      return [];
  }
}

async function idsBelongToProvince(
  audienceType: AudienceType,
  ids: number[],
  provinceId: number,
): Promise<boolean> {
  switch (audienceType) {
    case "province":
      return ids.length === 1 && ids[0] === provinceId;
    case "island": {
      const rows = await db
        .select({ id: islandsTable.id })
        .from(islandsTable)
        .where(
          and(
            inArray(islandsTable.id, ids),
            eq(islandsTable.provinceId, provinceId),
          ),
        );
      return rows.length === ids.length;
    }
    case "center": {
      const rows = await db
        .select({ id: centersTable.id })
        .from(centersTable)
        .where(
          and(
            inArray(centersTable.id, ids),
            eq(centersTable.provinceId, provinceId),
          ),
        );
      return rows.length === ids.length;
    }
    case "module": {
      // A module belongs to the province via its center.
      const rows = await db
        .select({ id: modulesTable.id })
        .from(modulesTable)
        .innerJoin(centersTable, eq(modulesTable.centerId, centersTable.id))
        .where(
          and(
            inArray(modulesTable.id, ids),
            eq(centersTable.provinceId, provinceId),
          ),
        );
      return rows.length === ids.length;
    }
    case "users": {
      // A user belongs to the province directly, or via their center.
      const rows = await db
        .select({
          id: usersTable.id,
          provinceId: usersTable.provinceId,
          centerProvinceId: centersTable.provinceId,
        })
        .from(usersTable)
        .leftJoin(centersTable, eq(usersTable.centerId, centersTable.id))
        .where(inArray(usersTable.id, ids));
      if (rows.length !== ids.length) return false;
      return rows.every(
        (r) => r.provinceId === provinceId || r.centerProvinceId === provinceId,
      );
    }
    case "department_head":
    case "coordinator":
      // Role audience restricted to exactly this province (org-wide role
      // audiences, with empty ids, are superadmin-managed only).
      return ids.length > 0 && ids.every((i) => i === provinceId);
    default:
      return false;
  }
}
