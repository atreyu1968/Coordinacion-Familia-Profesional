import type { Request, Response, NextFunction } from "express";
import { eq, and, isNull } from "drizzle-orm";
import { db, usersTable, moduleMembershipsTable } from "@workspace/db";
import type { User } from "@workspace/db";
import { verifyToken } from "../lib/auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ message: "No autenticado" });
    return;
  }

  const token = header.slice("Bearer ".length).trim();
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ message: "Token inválido o expirado" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, payload.sub), isNull(usersTable.deletedAt)));

  if (!user || user.status !== "active") {
    res.status(401).json({ message: "Usuario no válido" });
    return;
  }

  req.user = user;
  next();
}

export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: "No autenticado" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    next();
  };
}

const INVITE_MATRIX: Record<string, string[]> = {
  superadmin: ["coordinator", "prospector", "department_head", "teacher"],
  coordinator: ["prospector", "department_head"],
  department_head: ["teacher"],
};

export function canInvite(inviterRole: string, targetRole: string): boolean {
  return (INVITE_MATRIX[inviterRole] ?? []).includes(targetRole);
}

const ROLE_RANK: Record<string, number> = {
  superadmin: 100,
  coordinator: 80,
  prospector: 60,
  department_head: 50,
  teacher: 20,
};

export function roleRank(role: string): number {
  return ROLE_RANK[role] ?? 0;
}

type Scope = { provinceId?: number | null; centerId?: number | null };

/**
 * Read-visibility scope for list/aggregate endpoints. This is ROLE-DRIVEN (not
 * field-presence-driven) so that a center-bound role whose record also carries a
 * provinceId cannot widen its visibility to the whole province.
 *
 * - superadmin: global
 * - province roles (coordinator, prospector): bound to their province
 * - center roles (department_head, teacher): bound to their center
 * - anyone missing the required id: "none" (default-deny)
 */
export type ReadScope =
  | { kind: "global" }
  | { kind: "province"; provinceId: number }
  | { kind: "center"; centerId: number }
  | { kind: "none" };

const PROVINCE_ROLES = new Set(["coordinator", "prospector"]);
const CENTER_ROLES = new Set(["department_head", "teacher"]);

export function resolveReadScope(caller: User): ReadScope {
  if (caller.role === "superadmin") return { kind: "global" };
  if (PROVINCE_ROLES.has(caller.role)) {
    return caller.provinceId != null
      ? { kind: "province", provinceId: caller.provinceId }
      : { kind: "none" };
  }
  if (CENTER_ROLES.has(caller.role)) {
    return caller.centerId != null
      ? { kind: "center", centerId: caller.centerId }
      : { kind: "none" };
  }
  return { kind: "none" };
}

/**
 * Whether `caller` has administrative authority over a resource located in the
 * given scope (province/center). Superadmin is global; coordinator is bound to
 * its province; department_head is bound to its center; everyone else has none.
 */
export function hasScopeOver(caller: User, scope: Scope): boolean {
  if (caller.role === "superadmin") return true;
  if (caller.role === "coordinator") {
    return caller.provinceId != null && scope.provinceId === caller.provinceId;
  }
  if (caller.role === "department_head") {
    return caller.centerId != null && scope.centerId === caller.centerId;
  }
  return false;
}

/**
 * Whether `caller` may modify/deactivate `target`. Requires the caller to
 * strictly outrank the target AND have scope authority over the target. This
 * blocks self-management and lateral/upward privilege changes.
 */
export function canManageUser(caller: User, target: User): boolean {
  if (caller.id === target.id) return false;
  if (roleRank(caller.role) <= roleRank(target.role)) return false;
  return hasScopeOver(caller, target);
}

/**
 * Active (non-deleted) module membership for a user in a module, or undefined.
 */
export async function getModuleMembership(
  userId: number,
  moduleId: number,
): Promise<{ role: string } | undefined> {
  const [row] = await db
    .select({ role: moduleMembershipsTable.role })
    .from(moduleMembershipsTable)
    .where(
      and(
        eq(moduleMembershipsTable.userId, userId),
        eq(moduleMembershipsTable.moduleId, moduleId),
        isNull(moduleMembershipsTable.deletedAt),
      ),
    );
  return row;
}

/** Whether `userId` is an active member (any role) of `moduleId`. */
export async function isModuleMember(
  userId: number,
  moduleId: number,
): Promise<boolean> {
  return (await getModuleMembership(userId, moduleId)) !== undefined;
}

/** Whether `userId` is the coordinator of `moduleId`. */
export async function isModuleCoordinator(
  userId: number,
  moduleId: number,
): Promise<boolean> {
  const m = await getModuleMembership(userId, moduleId);
  return m?.role === "coordinator";
}
