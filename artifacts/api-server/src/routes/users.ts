import { Router, type IRouter } from "express";
import { eq, and, isNull, ilike, or, desc, count, sql, not, inArray, getTableColumns, type SQL } from "drizzle-orm";
import {
  db,
  usersTable,
  centersTable,
  teacherYearConfirmationsTable,
  accountAuditTable,
  type User,
} from "@workspace/db";
import {
  ListUsersQueryParams,
  ListUsersResponse,
  GetUserParams,
  GetUserResponse,
  UpdateUserParams,
  UpdateUserBody,
  UpdateUserResponse,
  DeactivateUserParams,
  ReactivateUserParams,
  ListManagedUsersQueryParams,
  ListManagedUsersResponse,
  ListUserAuditParams,
  ListUserAuditQueryParams,
  ListUserAuditResponse,
} from "@workspace/api-zod";
import { changeAccount } from "../lib/accountAudit";
import { getActiveAcademicYear, getActiveFamily, getSettings, professionalFamilyOf } from "../lib/settings";
import { teachingProfilePredicates } from "../lib/teachingProfileAccess";
import {
  requireAuth,
  requireRole,
  hasScopeOver,
  canManageUser,
  roleRank,
  resolveReadScope,
} from "../middlewares/auth";

const router: IRouter = Router();

function mayManageAccount(caller: User, target: User): boolean {
  return caller.id !== target.id &&
    (caller.role === "superadmin" || canManageUser(caller, target));
}

// Separate administration from the directory: ordinary users and existing
// directory consumers must not gain access to soft-deactivated accounts.
router.get("/users/management", requireAuth,
  requireRole("superadmin", "coordinator", "department_head"),
  async (req, res): Promise<void> => {
    const query = ListManagedUsersQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ message: "Filtros o paginación no válidos" });
      return;
    }
    const caller = req.user!;
    const { role, provinceId, centerId, search, status = "all", page: requestedPage = 1, pageSize = 25 } = query.data;
    const filters: SQL[] = [];
    if (status === "active") {
      const scope = resolveReadScope(caller);
      const activeFamily = await getActiveFamily();
      const centerFilters: SQL[] = [
        isNull(centersTable.deletedAt),
        sql`${centersTable.families} @> ${JSON.stringify([activeFamily])}::jsonb`,
      ];
      if (scope.kind === "province") {
        centerFilters.push(eq(centersTable.provinceId, scope.provinceId));
      } else if (scope.kind === "center") {
        centerFilters.push(eq(centersTable.id, scope.centerId));
      } else if (scope.kind === "global" && provinceId != null) {
        centerFilters.push(eq(centersTable.provinceId, provinceId));
      }
      const familyCenterIds = db
        .select({ id: centersTable.id })
        .from(centersTable)
        .where(and(...centerFilters));

      if (scope.kind === "global" && provinceId == null) {
        filters.push(
          or(inArray(usersTable.centerId, familyCenterIds), isNull(usersTable.centerId))!,
        );
      } else if (scope.kind === "global" && provinceId != null) {
        filters.push(
          or(
            inArray(usersTable.centerId, familyCenterIds),
            and(isNull(usersTable.centerId), eq(usersTable.provinceId, provinceId)),
          )!,
        );
      } else if (scope.kind === "province") {
        filters.push(
          or(
            inArray(usersTable.centerId, familyCenterIds),
            and(isNull(usersTable.centerId), eq(usersTable.provinceId, scope.provinceId)),
          )!,
        );
      } else if (scope.kind === "center") {
        filters.push(inArray(usersTable.centerId, familyCenterIds));
      } else {
        filters.push(eq(usersTable.id, -1));
      }
      filters.push(eq(usersTable.status, "active"));
      filters.push(isNull(usersTable.deletedAt));
    } else {
      if (caller.role === "coordinator") {
        if (caller.provinceId == null) {
          res.status(403).json({ message: "Tu cuenta no tiene una provincia asignada" });
          return;
        }
        filters.push(eq(usersTable.provinceId, caller.provinceId));
      } else if (caller.role === "department_head") {
        if (caller.centerId == null) {
          res.status(403).json({ message: "Tu cuenta no tiene un centro asignado" });
          return;
        }
        filters.push(eq(usersTable.centerId, caller.centerId));
      }
    }
    if (role) filters.push(eq(usersTable.role, role));
    if (provinceId != null && status !== "active")
      filters.push(eq(usersTable.provinceId, provinceId));
    if (centerId != null) filters.push(eq(usersTable.centerId, centerId));
    if (status === "inactive") filters.push(eq(usersTable.status, "inactive"));
    if (status !== "active") {
      // A soft-deactivated record is retained for recovery, never hard-deleted.
      filters.push(or(isNull(usersTable.deletedAt), eq(usersTable.status, "inactive"))!);
    }
    if (search?.trim()) {
      const term = `%${search.trim().replace(/[\\%_]/g, "\\$&")}%`;
      filters.push(or(ilike(usersTable.name, term), ilike(usersTable.email, term))!);
    }
    const settings = await getSettings();
    const activeYear = settings.activeAcademicYear?.trim() || null;
    const profile = teachingProfilePredicates(professionalFamilyOf(settings), activeYear);
    // Only teachers lower in the hierarchy and inside the already applied
    // account scope are diagnosed. Correlated predicates never return rosters.
    const incomplete = and(eq(usersTable.role, "teacher"), not(profile.complete))!;
    const profileFilter = query.data.teachingProfile;
    const result = await db.transaction(async (tx) => {
      const [integritySummary] = await tx.select({ total: count() }).from(usersTable)
        .where(and(...filters, incomplete));
      if (profileFilter === "incomplete") filters.push(incomplete);
      if (profileFilter === "complete") filters.push(and(eq(usersTable.role, "teacher"), profile.complete)!);
      const [summary] = await tx.select({ total: count() }).from(usersTable).where(and(...filters));
      const total = summary.total;
      const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
      const rows = await tx.select({
        ...getTableColumns(usersTable),
        profileCenter: profile.center,
        profileProvince: profile.province,
        profileModules: profile.modules,
      }).from(usersTable).where(and(...filters))
        .orderBy(desc(usersTable.createdAt), desc(usersTable.id))
        .limit(pageSize).offset((page - 1) * pageSize);
      return {
        users: rows.map(({ profileCenter, profileProvince, profileModules, ...target }) => {
          const canManage = mayManageAccount(caller, target);
          const missing = [
            ...(!profileCenter ? ["center"] : []),
            ...(!profileProvince ? ["province"] : []),
            ...(!profileModules ? ["modules"] : []),
          ];
          return {
            ...target, canManage,
            teachingProfile: target.role === "teacher" && canManage
              ? { complete: missing.length === 0, missing } : null,
          };
        }),
        total, page, pageSize, activeYear,
        incompleteTeacherProfiles: integritySummary.total,
      };
    }, { isolationLevel: "repeatable read", accessMode: "read only" });
    res.json(ListManagedUsersResponse.parse(result));
  },
);

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

router.get("/users/:id/audit", requireAuth,
  requireRole("superadmin", "coordinator", "department_head"),
  async (req, res): Promise<void> => {
    const params = ListUserAuditParams.safeParse(req.params);
    const query = ListUserAuditQueryParams.safeParse(req.query);
    if (!params.success || !query.success) {
      res.status(400).json({ message: "Cuenta o paginación no válida" });
      return;
    }
    const caller = req.user!;
    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.id));
    if (!target || !(caller.role === "superadmin" || mayManageAccount(caller, target))) {
      res.status(404).json({ message: "Usuario no encontrado" });
      return;
    }
    const filters: SQL[] = [eq(accountAuditTable.targetId, target.id)];
    if (caller.role !== "superadmin") {
      const scope = caller.role === "coordinator" ? "ProvinceId" : "CenterId";
      const scopeId = caller.role === "coordinator" ? caller.provinceId : caller.centerId;
      if (scopeId == null) {
        res.status(404).json({ message: "Usuario no encontrado" });
        return;
      }
      filters.push(eq(accountAuditTable[`before${scope}`], scopeId), eq(accountAuditTable[`after${scope}`], scopeId));
      const lowerRoles = (["superadmin", "coordinator", "department_head", "teacher", "prospector"] as const)
        .filter((role) => roleRank(role) < roleRank(caller.role));
      filters.push(sql`${accountAuditTable.beforeRole} in (${sql.join(lowerRoles.map((r) => sql`${r}`), sql`, `)})`);
      filters.push(sql`${accountAuditTable.afterRole} in (${sql.join(lowerRoles.map((r) => sql`${r}`), sql`, `)})`);
    }
    const page = query.data.page ?? 1;
    const rows = await db.select().from(accountAuditTable).where(and(...filters))
      .orderBy(desc(accountAuditTable.id)).limit(26).offset((page - 1) * 25);
    res.json(ListUserAuditResponse.parse({
      events: rows.slice(0, 25).map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
      hasMore: rows.length > 25,
    }));
  },
);

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
      .where(eq(usersTable.id, params.data.id));

    if (!target) {
      res.status(404).json({ message: "Usuario no encontrado" });
      return;
    }

    const caller = req.user!;
    const updates = { ...parsed.data };
    if (!mayManageAccount(caller, target)) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    if (updates.name !== undefined) {
      updates.name = updates.name.trim();
      if (!updates.name) {
        res.status(400).json({ message: "El nombre no puede estar vacío" });
        return;
      }
    }
    if (updates.status !== undefined && updates.status !== target.status) {
      res.status(400).json({ message: "Utiliza las acciones Desactivar o Reactivar para cambiar el acceso" });
      return;
    }

    const destinationCenterId =
      updates.centerId !== undefined ? updates.centerId : target.centerId;
    let destinationProvinceId =
      updates.provinceId !== undefined ? updates.provinceId : target.provinceId;
    if (destinationCenterId != null) {
      const [destinationCenter] = await db
        .select()
        .from(centersTable)
        .where(
          and(
            eq(centersTable.id, destinationCenterId),
            isNull(centersTable.deletedAt),
          ),
        );
      if (!destinationCenter) {
        res.status(400).json({ message: "El centro de destino no es válido" });
        return;
      }
      if (
        updates.provinceId !== undefined &&
        destinationCenter.provinceId !== updates.provinceId
      ) {
        res.status(400).json({
          message: "La provincia debe corresponder al centro de destino",
        });
        return;
      }
      if (updates.centerId !== undefined) {
        const activeFamily = await getActiveFamily();
        if (!destinationCenter.families.includes(activeFamily)) {
          res.status(400).json({
            message: "El centro de destino no pertenece a la familia activa",
          });
          return;
        }
        if (updates.provinceId === undefined) {
          destinationProvinceId = destinationCenter.provinceId;
          updates.provinceId = destinationCenter.provinceId;
        }
      }
    }

    const newRole = updates.role ?? target.role;
    if (["coordinator", "prospector"].includes(newRole) && destinationProvinceId == null) {
      res.status(400).json({ message: "Este rol requiere una provincia" });
      return;
    }
    if (["department_head", "teacher"].includes(newRole) && destinationCenterId == null) {
      // Allow unrelated edits to legacy incomplete teachers; onboarding will
      // still require a center. Do not allow newly assigning an unscoped role.
      if (updates.role !== undefined || updates.centerId !== undefined) {
        res.status(400).json({ message: "Este rol requiere un centro" });
        return;
      }
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
        provinceId: destinationProvinceId,
        centerId: destinationCenterId,
      };
      if (!hasScopeOver(caller, candidate)) {
        res.status(403).json({
          message: "No puede asignar un ámbito fuera del suyo",
        });
        return;
      }
    }

    const user = await changeAccount(caller, target, "update", updates);
    if (!user) {
      res.status(409).json({ message: "La cuenta ha cambiado. Recarga antes de continuar." });
      return;
    }

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
    if (!mayManageAccount(caller, target)) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    const updated = await changeAccount(caller, target, "deactivate", {
      status: "inactive", deletedAt: new Date(), tokenVersion: sql`${usersTable.tokenVersion} + 1`,
    });
    if (!updated) {
      res.status(409).json({ message: "La cuenta ha cambiado. Recarga antes de continuar." });
      return;
    }

    res.sendStatus(204);
  },
);

router.post(
  "/users/:id/reactivate",
  requireAuth,
  requireRole("superadmin", "coordinator", "department_head"),
  async (req, res): Promise<void> => {
    const params = ReactivateUserParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }

    // A deactivated account may have deletedAt set (manual deactivation) or null
    // (auto-deactivation for an unconfirmed year), so we do not filter on it.
    const [target] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, params.data.id));

    if (!target) {
      res.status(404).json({ message: "Usuario no encontrado" });
      return;
    }

    const caller = req.user!;
    if (!mayManageAccount(caller, target)) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    if (target.status === "active" && target.deletedAt == null) {
      res.json(UpdateUserResponse.parse(target));
      return;
    }

    const updated = await changeAccount(caller, target, "reactivate", {
      status: "active", deletedAt: null, tokenVersion: sql`${usersTable.tokenVersion} + 1`,
    }, async (tx, updated) => {

    // Reopen the annual confirmation for the active course so the reactivated
    // teacher gets a fresh window instead of being immediately re-deactivated.
    if (updated.role === "teacher") {
      const year = await getActiveAcademicYear();
      if (year) {
        const deadline = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
        const [existing] = await tx
          .select()
          .from(teacherYearConfirmationsTable)
          .where(
            and(
              eq(teacherYearConfirmationsTable.teacherId, updated.id),
              eq(teacherYearConfirmationsTable.schoolYear, year),
            ),
          );
        if (existing) {
          await tx
            .update(teacherYearConfirmationsTable)
            .set({ status: "pending", deadline, confirmedAt: null })
            .where(eq(teacherYearConfirmationsTable.id, existing.id));
        } else {
          await tx.insert(teacherYearConfirmationsTable).values({
            teacherId: updated.id,
            schoolYear: year,
            status: "pending",
            deadline,
          });
        }
      }
    }
    });
    if (!updated) {
      res.status(409).json({ message: "La cuenta ha cambiado. Recarga antes de continuar." });
      return;
    }

    res.json(UpdateUserResponse.parse(updated));
  },
);

export default router;
