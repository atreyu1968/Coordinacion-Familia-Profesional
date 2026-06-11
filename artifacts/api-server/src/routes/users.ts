import { Router, type IRouter } from "express";
import { eq, and, isNull, ilike, or, desc, type SQL } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  ListUsersQueryParams,
  ListUsersResponse,
  GetUserParams,
  GetUserResponse,
  UpdateUserParams,
  UpdateUserBody,
  UpdateUserResponse,
  DeactivateUserParams,
} from "@workspace/api-zod";
import {
  requireAuth,
  requireRole,
  hasScopeOver,
  canManageUser,
  roleRank,
} from "../middlewares/auth";

const router: IRouter = Router();

router.get("/users", requireAuth, async (req, res): Promise<void> => {
  const query = ListUsersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }

  const filters: SQL[] = [isNull(usersTable.deletedAt)];
  const caller = req.user!;

  if (caller.role === "superadmin") {
    // Global visibility — no scope filter.
  } else if (caller.role === "coordinator" && caller.provinceId != null) {
    filters.push(eq(usersTable.provinceId, caller.provinceId));
  } else if (
    (caller.role === "department_head" || caller.role === "teacher") &&
    caller.centerId != null
  ) {
    filters.push(eq(usersTable.centerId, caller.centerId));
  } else {
    // Unscoped roles (prospector) and misconfigured accounts may only
    // ever see themselves.
    filters.push(eq(usersTable.id, caller.id));
  }

  if (query.data.role) filters.push(eq(usersTable.role, query.data.role));
  if (query.data.provinceId != null)
    filters.push(eq(usersTable.provinceId, query.data.provinceId));
  if (query.data.centerId != null)
    filters.push(eq(usersTable.centerId, query.data.centerId));
  if (query.data.search) {
    const term = `%${query.data.search}%`;
    const match = or(ilike(usersTable.name, term), ilike(usersTable.email, term));
    if (match) filters.push(match);
  }

  const rows = await db
    .select()
    .from(usersTable)
    .where(and(...filters))
    .orderBy(desc(usersTable.createdAt));

  res.json(ListUsersResponse.parse(rows));
});

router.get("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: params.error.message });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, params.data.id), isNull(usersTable.deletedAt)));

  if (!user) {
    res.status(404).json({ message: "Usuario no encontrado" });
    return;
  }

  const caller = req.user!;
  const canView =
    caller.id === user.id ||
    hasScopeOver(caller, user) ||
    (caller.role === "teacher" &&
      caller.centerId != null &&
      user.centerId === caller.centerId);
  if (!canView) {
    // 404 (not 403) to avoid leaking the existence of out-of-scope users.
    res.status(404).json({ message: "Usuario no encontrado" });
    return;
  }

  res.json(GetUserResponse.parse(user));
});

router.patch(
  "/users/:id",
  requireAuth,
  requireRole("superadmin", "coordinator", "department_head"),
  async (req, res): Promise<void> => {
    const params = UpdateUserParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const parsed = UpdateUserBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }

    const [target] = await db
      .select()
      .from(usersTable)
      .where(
        and(eq(usersTable.id, params.data.id), isNull(usersTable.deletedAt)),
      );

    if (!target) {
      res.status(404).json({ message: "Usuario no encontrado" });
      return;
    }

    const caller = req.user!;
    if (caller.role !== "superadmin" && !canManageUser(caller, target)) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    if (caller.role !== "superadmin") {
      const newRole = parsed.data.role ?? target.role;
      if (roleRank(newRole) >= roleRank(caller.role)) {
        res.status(403).json({
          message: "No puede asignar un rol igual o superior al suyo",
        });
        return;
      }
      const candidate = {
        provinceId:
          parsed.data.provinceId !== undefined
            ? parsed.data.provinceId
            : target.provinceId,
        centerId:
          parsed.data.centerId !== undefined
            ? parsed.data.centerId
            : target.centerId,
      };
      if (!hasScopeOver(caller, candidate)) {
        res.status(403).json({
          message: "No puede asignar un ámbito fuera del suyo",
        });
        return;
      }
    }

    const [user] = await db
      .update(usersTable)
      .set(parsed.data)
      .where(
        and(eq(usersTable.id, params.data.id), isNull(usersTable.deletedAt)),
      )
      .returning();

    res.json(UpdateUserResponse.parse(user));
  },
);

router.delete(
  "/users/:id",
  requireAuth,
  requireRole("superadmin", "coordinator", "department_head"),
  async (req, res): Promise<void> => {
    const params = DeactivateUserParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }

    const [target] = await db
      .select()
      .from(usersTable)
      .where(
        and(eq(usersTable.id, params.data.id), isNull(usersTable.deletedAt)),
      );

    if (!target) {
      res.status(404).json({ message: "Usuario no encontrado" });
      return;
    }

    const caller = req.user!;
    if (caller.role !== "superadmin" && !canManageUser(caller, target)) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    await db
      .update(usersTable)
      .set({ status: "inactive", deletedAt: new Date() })
      .where(eq(usersTable.id, params.data.id));

    res.sendStatus(204);
  },
);

export default router;
