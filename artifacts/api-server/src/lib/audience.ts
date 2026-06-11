import { eq, and, isNull, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  centersTable,
  islandsTable,
  modulesTable,
  moduleMembershipsTable,
} from "@workspace/db";
import type { User } from "@workspace/db";

// Recipient/audience targeting shared by document forms and surveys.
export const AUDIENCE_TYPES = [
  "all",
  "province",
  "island",
  "center",
  "module",
  "users",
] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

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
    default:
      return false;
  }
}
