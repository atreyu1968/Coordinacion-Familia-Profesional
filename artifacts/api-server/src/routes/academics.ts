import { Router, type IRouter } from "express";
import { eq, and, or, isNull, inArray, ilike, type SQL } from "drizzle-orm";
import {
  db,
  modulesTable,
  cyclesTable,
  trainingOfferTable,
  groupsTable,
  teachingAssignmentsTable,
  resourcesTable,
  usersTable,
  centersTable,
  moduleMembershipsTable,
  moduleLearningOutcomesTable,
  moduleEvaluationCriteriaTable,
} from "@workspace/db";
import type { User } from "@workspace/db";
import {
  ListModulesQueryParams,
  ListModulesResponse,
  CreateModuleBody,
  UpdateModuleParams,
  UpdateModuleBody,
  DeleteModuleParams,
  ListCyclesQueryParams,
  ListCyclesResponse,
  CreateCycleBody,
  UpdateCycleParams,
  UpdateCycleBody,
  DeleteCycleParams,
  ListCycleModulesParams,
  ListCycleModulesResponse,
  ListModuleMembersParams,
  ListModuleMembersResponse,
  AddModuleMemberParams,
  AddModuleMemberBody,
  UpdateModuleMemberParams,
  UpdateModuleMemberBody,
  RemoveModuleMemberParams,
  EnrollInModuleParams,
  LeaveModuleParams,
  ListGroupsQueryParams,
  ListGroupsResponse,
  CreateGroupBody,
  ListTeachingAssignmentsQueryParams,
  ListTeachingAssignmentsResponse,
  CreateTeachingAssignmentBody,
  TransferTeachingAssignmentsBody,
  TransferTeachingAssignmentsResponse,
  ListResourcesQueryParams,
  ListResourcesResponse,
  CreateResourceBody,
  DeleteResourceParams,
  ListLearningOutcomesParams,
  CreateLearningOutcomeParams,
  CreateLearningOutcomeBody,
  UpdateLearningOutcomeParams,
  UpdateLearningOutcomeBody,
  DeleteLearningOutcomeParams,
  CreateEvaluationCriterionParams,
  CreateEvaluationCriterionBody,
  UpdateEvaluationCriterionParams,
  UpdateEvaluationCriterionBody,
  DeleteEvaluationCriterionParams,
} from "@workspace/api-zod";
import {
  requireAuth,
  requireRole,
  hasScopeOver,
  resolveReadScope,
  isModuleMember,
  isModuleCoordinator,
} from "../middlewares/auth";
import {
  toModule,
  toCycle,
  toModuleMember,
  toGroup,
  toTeachingAssignment,
  toResource,
} from "../lib/mappers";

const router: IRouter = Router();

// Subquery of center ids belonging to a province (non-deleted).
function centerIdsInProvince(provinceId: number) {
  return db
    .select({ id: centersTable.id })
    .from(centersTable)
    .where(
      and(
        eq(centersTable.provinceId, provinceId),
        isNull(centersTable.deletedAt),
      ),
    );
}

// ---------------------------------------------------------------------------
// Modules (shared curriculum: centerId null = global, otherwise center-scoped)
// ---------------------------------------------------------------------------
router.get("/modules", requireAuth, async (req, res): Promise<void> => {
  const query = ListModulesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const scope = resolveReadScope(req.user!);

  const filters: SQL[] = [isNull(modulesTable.deletedAt)];
  if (query.data.centerId != null) {
    filters.push(eq(modulesTable.centerId, query.data.centerId));
  }
  if (query.data.cycleId != null) {
    filters.push(eq(modulesTable.cycleId, query.data.cycleId));
  }
  if (query.data.search) {
    const term = `%${query.data.search}%`;
    const match = or(
      ilike(modulesTable.name, term),
      ilike(modulesTable.code, term),
    );
    if (match) filters.push(match);
  }

  // Global modules (centerId IS NULL) are visible to everyone; scoped modules
  // are visible only within the caller's province/center.
  if (scope.kind === "province") {
    const scopeMatch = or(
      isNull(modulesTable.centerId),
      inArray(modulesTable.centerId, centerIdsInProvince(scope.provinceId)),
    );
    if (scopeMatch) filters.push(scopeMatch);
  } else if (scope.kind === "center") {
    const scopeMatch = or(
      isNull(modulesTable.centerId),
      eq(modulesTable.centerId, scope.centerId),
    );
    if (scopeMatch) filters.push(scopeMatch);
  } else if (scope.kind === "none") {
    filters.push(isNull(modulesTable.centerId));
  }

  const rows = await db
    .select()
    .from(modulesTable)
    .where(and(...filters))
    .orderBy(modulesTable.name);

  // Enrich each module with membership info: member count, who its coordinator
  // is, and whether the caller is enrolled (and in what role).
  const caller = req.user!;
  const moduleIds = rows.map((m) => m.id);
  const membershipRows = moduleIds.length
    ? await db
        .select({
          moduleId: moduleMembershipsTable.moduleId,
          userId: moduleMembershipsTable.userId,
          role: moduleMembershipsTable.role,
          userName: usersTable.name,
        })
        .from(moduleMembershipsTable)
        .leftJoin(usersTable, eq(usersTable.id, moduleMembershipsTable.userId))
        .where(
          and(
            inArray(moduleMembershipsTable.moduleId, moduleIds),
            isNull(moduleMembershipsTable.deletedAt),
          ),
        )
    : [];

  const agg = new Map<
    number,
    {
      count: number;
      coordinatorId: number | null;
      coordinatorName: string | null;
      myRole: string | null;
    }
  >();
  for (const id of moduleIds) {
    agg.set(id, {
      count: 0,
      coordinatorId: null,
      coordinatorName: null,
      myRole: null,
    });
  }
  for (const mr of membershipRows) {
    const a = agg.get(mr.moduleId)!;
    a.count += 1;
    if (mr.role === "coordinator") {
      a.coordinatorId = mr.userId;
      a.coordinatorName = mr.userName ?? null;
    }
    if (mr.userId === caller.id) a.myRole = mr.role;
  }

  res.json(
    ListModulesResponse.parse(
      rows.map((m) => {
        const a = agg.get(m.id)!;
        return toModule(m, {
          memberCount: a.count,
          coordinatorId: a.coordinatorId,
          coordinatorName: a.coordinatorName,
          enrolled: a.myRole !== null,
          myRole: a.myRole,
        });
      }),
    ),
  );
});

// Resolve a catalog cycle to its display name (or null if unset/not found).
async function resolveCycleName(
  cycleId: number | null | undefined,
): Promise<{ ok: true; name: string | null } | { ok: false }> {
  if (cycleId == null) return { ok: true, name: null };
  const [cycle] = await db
    .select()
    .from(cyclesTable)
    .where(and(eq(cyclesTable.id, cycleId), isNull(cyclesTable.deletedAt)));
  if (!cycle) return { ok: false };
  return { ok: true, name: cycle.name };
}

router.post(
  "/modules",
  requireAuth,
  requireRole("superadmin"),
  async (req, res): Promise<void> => {
    const parsed = CreateModuleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }

    // When a catalog cycle is referenced, derive the (back-compat) cycleName
    // from it; otherwise fall back to any free-text cycleName provided.
    let cycleName = parsed.data.cycleName ?? null;
    if (parsed.data.cycleId != null) {
      const resolved = await resolveCycleName(parsed.data.cycleId);
      if (!resolved.ok) {
        res.status(404).json({ message: "Ciclo no encontrado" });
        return;
      }
      cycleName = resolved.name;
    }

    const [created] = await db
      .insert(modulesTable)
      .values({
        code: parsed.data.code ?? null,
        name: parsed.data.name,
        cycleName,
        cycleId: parsed.data.cycleId ?? null,
        centerId: parsed.data.centerId ?? null,
      })
      .returning();
    res.status(201).json(toModule(created));
  },
);

router.patch(
  "/modules/:moduleId",
  requireAuth,
  requireRole("superadmin"),
  async (req, res): Promise<void> => {
    const params = UpdateModuleParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const parsed = UpdateModuleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }

    const existing = await loadModule(params.data.moduleId);
    if (!existing) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }

    const updates: Partial<typeof modulesTable.$inferInsert> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.code !== undefined) updates.code = parsed.data.code ?? null;
    if (parsed.data.centerId !== undefined)
      updates.centerId = parsed.data.centerId ?? null;
    if (parsed.data.cycleId !== undefined) {
      const resolved = await resolveCycleName(parsed.data.cycleId);
      if (!resolved.ok) {
        res.status(404).json({ message: "Ciclo no encontrado" });
        return;
      }
      updates.cycleId = parsed.data.cycleId ?? null;
      updates.cycleName = resolved.name;
    }

    const [updated] = await db
      .update(modulesTable)
      .set(updates)
      .where(eq(modulesTable.id, params.data.moduleId))
      .returning();
    res.json(toModule(updated));
  },
);

router.delete(
  "/modules/:moduleId",
  requireAuth,
  requireRole("superadmin"),
  async (req, res): Promise<void> => {
    const params = DeleteModuleParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const existing = await loadModule(params.data.moduleId);
    if (!existing) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }
    await db
      .update(modulesTable)
      .set({ deletedAt: new Date() })
      .where(eq(modulesTable.id, params.data.moduleId));
    res.status(204).end();
  },
);

// ---------------------------------------------------------------------------
// Cycles (global catalog of training cycles). Read is broad (for dropdowns);
// create/update/delete are superadmin-only.
// ---------------------------------------------------------------------------
router.get("/cycles", requireAuth, async (req, res): Promise<void> => {
  const query = ListCyclesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const filters: SQL[] = [isNull(cyclesTable.deletedAt)];
  if (query.data.search) {
    const term = `%${query.data.search}%`;
    const match = or(
      ilike(cyclesTable.name, term),
      ilike(cyclesTable.code, term),
    );
    if (match) filters.push(match);
  }

  const rows = await db
    .select()
    .from(cyclesTable)
    .where(and(...filters))
    .orderBy(cyclesTable.name);

  const cycleIds = rows.map((c) => c.id);
  const counts = new Map<number, number>();
  if (cycleIds.length) {
    const modRows = await db
      .select({ cycleId: modulesTable.cycleId })
      .from(modulesTable)
      .where(
        and(
          inArray(modulesTable.cycleId, cycleIds),
          isNull(modulesTable.deletedAt),
        ),
      );
    for (const m of modRows) {
      if (m.cycleId != null)
        counts.set(m.cycleId, (counts.get(m.cycleId) ?? 0) + 1);
    }
  }

  res.json(
    ListCyclesResponse.parse(
      rows.map((c) => toCycle(c, { moduleCount: counts.get(c.id) ?? 0 })),
    ),
  );
});

router.post(
  "/cycles",
  requireAuth,
  requireRole("superadmin"),
  async (req, res): Promise<void> => {
    const parsed = CreateCycleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const [created] = await db
      .insert(cyclesTable)
      .values({
        name: parsed.data.name,
        code: parsed.data.code ?? null,
        level: parsed.data.level ?? null,
        createdBy: req.user!.id,
      })
      .returning();
    res.status(201).json(toCycle(created));
  },
);

router.patch(
  "/cycles/:id",
  requireAuth,
  requireRole("superadmin"),
  async (req, res): Promise<void> => {
    const params = UpdateCycleParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const parsed = UpdateCycleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const [existing] = await db
      .select()
      .from(cyclesTable)
      .where(
        and(eq(cyclesTable.id, params.data.id), isNull(cyclesTable.deletedAt)),
      );
    if (!existing) {
      res.status(404).json({ message: "Ciclo no encontrado" });
      return;
    }

    const updates: Partial<typeof cyclesTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.code !== undefined) updates.code = parsed.data.code ?? null;
    if (parsed.data.level !== undefined)
      updates.level = parsed.data.level ?? null;

    const [updated] = await db
      .update(cyclesTable)
      .set(updates)
      .where(eq(cyclesTable.id, params.data.id))
      .returning();

    // Keep modules' back-compat cycleName in sync with the catalog rename.
    if (parsed.data.name !== undefined) {
      await db
        .update(modulesTable)
        .set({ cycleName: updated.name })
        .where(eq(modulesTable.cycleId, updated.id));
      await db
        .update(trainingOfferTable)
        .set({ cycleName: updated.name })
        .where(eq(trainingOfferTable.cycleId, updated.id));
    }

    res.json(toCycle(updated));
  },
);

router.delete(
  "/cycles/:id",
  requireAuth,
  requireRole("superadmin"),
  async (req, res): Promise<void> => {
    const params = DeleteCycleParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const [existing] = await db
      .select()
      .from(cyclesTable)
      .where(
        and(eq(cyclesTable.id, params.data.id), isNull(cyclesTable.deletedAt)),
      );
    if (!existing) {
      res.status(404).json({ message: "Ciclo no encontrado" });
      return;
    }
    await db
      .update(cyclesTable)
      .set({ deletedAt: new Date() })
      .where(eq(cyclesTable.id, params.data.id));
    res.status(204).end();
  },
);

router.get(
  "/cycles/:id/modules",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ListCycleModulesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const rows = await db
      .select()
      .from(modulesTable)
      .where(
        and(
          eq(modulesTable.cycleId, params.data.id),
          isNull(modulesTable.deletedAt),
        ),
      )
      .orderBy(modulesTable.name);
    res.json(ListCycleModulesResponse.parse(rows.map((m) => toModule(m))));
  },
);

// ---------------------------------------------------------------------------
// Module memberships: teachers self-enroll into modules (multi-module) and
// managers (gestor) add/remove teachers and designate the per-module
// coordinator (exactly one per module).
// ---------------------------------------------------------------------------

async function loadModule(moduleId: number) {
  const [module] = await db
    .select()
    .from(modulesTable)
    .where(and(eq(modulesTable.id, moduleId), isNull(modulesTable.deletedAt)));
  return module;
}

// Whether the caller may administer the membership of a module. Superadmin
// always; provincial coordinators for global modules and modules in their
// province; department heads for modules in their own center.
async function canManageModule(
  caller: User,
  module: { centerId: number | null },
): Promise<boolean> {
  if (caller.role === "superadmin") return true;
  if (module.centerId == null) return caller.role === "coordinator";
  const [center] = await db
    .select({ provinceId: centersTable.provinceId })
    .from(centersTable)
    .where(eq(centersTable.id, module.centerId));
  return hasScopeOver(caller, {
    provinceId: center?.provinceId ?? null,
    centerId: module.centerId,
  });
}

// Whether the caller may manage a module's roster (add/remove teachers): any
// manager in scope, plus the module's own coordinator who invites the module's
// teachers. Designating/transferring the coordinator stays manager-only.
async function canManageMembers(
  caller: User,
  module: { id: number; centerId: number | null },
): Promise<boolean> {
  if (await canManageModule(caller, module)) return true;
  return isModuleCoordinator(caller.id, module.id);
}

// Whether the caller may see (and therefore self-enroll into) a module, using
// the same visibility rules as the module listing.
async function moduleVisibleToCaller(
  caller: User,
  module: { centerId: number | null },
): Promise<boolean> {
  if (module.centerId == null) return true;
  const scope = resolveReadScope(caller);
  if (scope.kind === "global") return true;
  if (scope.kind === "center") return module.centerId === scope.centerId;
  if (scope.kind === "province") {
    const [center] = await db
      .select({ provinceId: centersTable.provinceId })
      .from(centersTable)
      .where(eq(centersTable.id, module.centerId));
    return center?.provinceId === scope.provinceId;
  }
  return false;
}

// Insert or revive a membership. When promoting to coordinator, demote the
// module's current coordinator first so there is always at most one.
async function upsertMembership(
  moduleId: number,
  userId: number,
  role: string,
) {
  if (role === "coordinator") {
    await db
      .update(moduleMembershipsTable)
      .set({ role: "member" })
      .where(
        and(
          eq(moduleMembershipsTable.moduleId, moduleId),
          eq(moduleMembershipsTable.role, "coordinator"),
          isNull(moduleMembershipsTable.deletedAt),
        ),
      );
  }
  const [row] = await db
    .insert(moduleMembershipsTable)
    .values({ moduleId, userId, role })
    .onConflictDoUpdate({
      target: [moduleMembershipsTable.moduleId, moduleMembershipsTable.userId],
      set: { role, deletedAt: null },
    })
    .returning();
  return row!;
}

// List the members of a module (members + managers in scope).
router.get(
  "/modules/:moduleId/members",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ListModuleMembersParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;
    const module = await loadModule(params.data.moduleId);
    if (!module) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }
    const allowed =
      (await canManageModule(caller, module)) ||
      (await isModuleMember(caller.id, module.id));
    if (!allowed) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    const rows = await db
      .select({
        id: moduleMembershipsTable.id,
        moduleId: moduleMembershipsTable.moduleId,
        userId: moduleMembershipsTable.userId,
        role: moduleMembershipsTable.role,
        createdAt: moduleMembershipsTable.createdAt,
        userName: usersTable.name,
        email: usersTable.email,
      })
      .from(moduleMembershipsTable)
      .leftJoin(usersTable, eq(usersTable.id, moduleMembershipsTable.userId))
      .where(
        and(
          eq(moduleMembershipsTable.moduleId, module.id),
          isNull(moduleMembershipsTable.deletedAt),
        ),
      )
      .orderBy(moduleMembershipsTable.role, usersTable.name);

    res.json(ListModuleMembersResponse.parse(rows.map(toModuleMember)));
  },
);

// Add a teacher to a module (manager in scope).
router.post(
  "/modules/:moduleId/members",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = AddModuleMemberParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const body = AddModuleMemberBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
      return;
    }
    const caller = req.user!;
    const module = await loadModule(params.data.moduleId);
    if (!module) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }
    if (!(await canManageMembers(caller, module))) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    // Only managers may designate the coordinator; coordinators inviting
    // teachers can only add plain members.
    const requestedRole = body.data.role ?? "member";
    if (
      requestedRole === "coordinator" &&
      !(await canManageModule(caller, module))
    ) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    const [target] = await db
      .select()
      .from(usersTable)
      .where(
        and(eq(usersTable.id, body.data.userId), isNull(usersTable.deletedAt)),
      );
    if (!target) {
      res.status(404).json({ message: "Usuario no encontrado" });
      return;
    }
    const role = body.data.role ?? "member";
    const member = await upsertMembership(module.id, target.id, role);
    res.status(201).json(
      toModuleMember({
        ...member,
        userName: target.name,
        email: target.email,
      }),
    );
  },
);

// Set a member's role (designate/transfer the module coordinator).
router.patch(
  "/modules/:moduleId/members/:userId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UpdateModuleMemberParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const body = UpdateModuleMemberBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
      return;
    }
    const caller = req.user!;
    const module = await loadModule(params.data.moduleId);
    if (!module) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }
    if (!(await canManageModule(caller, module))) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    const [existing] = await db
      .select()
      .from(moduleMembershipsTable)
      .where(
        and(
          eq(moduleMembershipsTable.moduleId, module.id),
          eq(moduleMembershipsTable.userId, params.data.userId),
          isNull(moduleMembershipsTable.deletedAt),
        ),
      );
    if (!existing) {
      res.status(404).json({ message: "Miembro no encontrado" });
      return;
    }
    const member = await upsertMembership(
      module.id,
      params.data.userId,
      body.data.role,
    );
    const [u] = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, params.data.userId));
    res.json(
      toModuleMember({
        ...member,
        userName: u?.name ?? null,
        email: u?.email ?? null,
      }),
    );
  },
);

// Remove a teacher from a module (manager in scope) — soft delete.
router.delete(
  "/modules/:moduleId/members/:userId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = RemoveModuleMemberParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;
    const module = await loadModule(params.data.moduleId);
    if (!module) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }
    if (!(await canManageMembers(caller, module))) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    const [existing] = await db
      .select()
      .from(moduleMembershipsTable)
      .where(
        and(
          eq(moduleMembershipsTable.moduleId, module.id),
          eq(moduleMembershipsTable.userId, params.data.userId),
          isNull(moduleMembershipsTable.deletedAt),
        ),
      );
    if (!existing) {
      res.status(404).json({ message: "Miembro no encontrado" });
      return;
    }
    // A module coordinator may manage the roster but not remove the module's
    // coordinator (that designation is reserved for managers).
    if (
      existing.role === "coordinator" &&
      !(await canManageModule(caller, module))
    ) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    await db
      .update(moduleMembershipsTable)
      .set({ deletedAt: new Date() })
      .where(eq(moduleMembershipsTable.id, existing.id));
    res.sendStatus(204);
  },
);

// Self-enroll the current user into a module (multi-module).
router.post(
  "/modules/:moduleId/enroll",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = EnrollInModuleParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;
    const module = await loadModule(params.data.moduleId);
    if (!module) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }
    if (!(await moduleVisibleToCaller(caller, module))) {
      res.status(403).json({ message: "Módulo fuera de tu ámbito" });
      return;
    }
    // Revive a previous membership or create a new one. Preserve an existing
    // role on conflict so re-enrolling never strips a coordinator.
    const [row] = await db
      .insert(moduleMembershipsTable)
      .values({ moduleId: module.id, userId: caller.id, role: "member" })
      .onConflictDoUpdate({
        target: [
          moduleMembershipsTable.moduleId,
          moduleMembershipsTable.userId,
        ],
        set: { deletedAt: null },
      })
      .returning();
    res.status(201).json(
      toModuleMember({
        ...row!,
        userName: caller.name,
        email: caller.email,
      }),
    );
  },
);

// Leave a module the current user is enrolled in — soft delete.
router.delete(
  "/modules/:moduleId/enroll",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = LeaveModuleParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;
    const [existing] = await db
      .select()
      .from(moduleMembershipsTable)
      .where(
        and(
          eq(moduleMembershipsTable.moduleId, params.data.moduleId),
          eq(moduleMembershipsTable.userId, caller.id),
          isNull(moduleMembershipsTable.deletedAt),
        ),
      );
    if (!existing) {
      res.status(404).json({ message: "No estás inscrito en este módulo" });
      return;
    }
    await db
      .update(moduleMembershipsTable)
      .set({ deletedAt: new Date() })
      .where(eq(moduleMembershipsTable.id, existing.id));
    res.sendStatus(204);
  },
);

// ---------------------------------------------------------------------------
// Learning outcomes (RA) and evaluation criteria (CE) of a module. Reading is
// available to anyone who can see the module; creating/updating/deleting is
// restricted to superadmin and the module's own coordinator.
// ---------------------------------------------------------------------------

// Whether the caller may edit a module's learning outcomes / criteria.
async function canEditOutcomes(
  caller: User,
  module: { id: number },
): Promise<boolean> {
  if (caller.role === "superadmin") return true;
  return isModuleCoordinator(caller.id, module.id);
}

// Load a learning outcome together with its (non-deleted) module.
async function loadOutcome(outcomeId: number) {
  const [outcome] = await db
    .select()
    .from(moduleLearningOutcomesTable)
    .where(
      and(
        eq(moduleLearningOutcomesTable.id, outcomeId),
        isNull(moduleLearningOutcomesTable.deletedAt),
      ),
    );
  if (!outcome) return undefined;
  const module = await loadModule(outcome.moduleId);
  if (!module) return undefined;
  return { outcome, module };
}

// Load a criterion together with its outcome and module.
async function loadCriterion(criterionId: number) {
  const [criterion] = await db
    .select()
    .from(moduleEvaluationCriteriaTable)
    .where(
      and(
        eq(moduleEvaluationCriteriaTable.id, criterionId),
        isNull(moduleEvaluationCriteriaTable.deletedAt),
      ),
    );
  if (!criterion) return undefined;
  const loaded = await loadOutcome(criterion.outcomeId);
  if (!loaded) return undefined;
  return { criterion, outcome: loaded.outcome, module: loaded.module };
}

router.get(
  "/modules/:moduleId/learning-outcomes",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ListLearningOutcomesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;
    const module = await loadModule(params.data.moduleId);
    if (!module) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }
    const allowed =
      (await moduleVisibleToCaller(caller, module)) ||
      (await isModuleMember(caller.id, module.id));
    if (!allowed) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    const outcomes = await db
      .select()
      .from(moduleLearningOutcomesTable)
      .where(
        and(
          eq(moduleLearningOutcomesTable.moduleId, module.id),
          isNull(moduleLearningOutcomesTable.deletedAt),
        ),
      )
      .orderBy(moduleLearningOutcomesTable.order, moduleLearningOutcomesTable.id);

    const outcomeIds = outcomes.map((o) => o.id);
    const criteria =
      outcomeIds.length > 0
        ? await db
            .select()
            .from(moduleEvaluationCriteriaTable)
            .where(
              and(
                inArray(moduleEvaluationCriteriaTable.outcomeId, outcomeIds),
                isNull(moduleEvaluationCriteriaTable.deletedAt),
              ),
            )
            .orderBy(
              moduleEvaluationCriteriaTable.order,
              moduleEvaluationCriteriaTable.id,
            )
        : [];

    res.json(
      outcomes.map((o) => ({
        id: o.id,
        moduleId: o.moduleId,
        code: o.code,
        description: o.description,
        order: o.order,
        criteria: criteria
          .filter((c) => c.outcomeId === o.id)
          .map((c) => ({
            id: c.id,
            outcomeId: c.outcomeId,
            code: c.code,
            description: c.description,
            order: c.order,
          })),
      })),
    );
  },
);

router.post(
  "/modules/:moduleId/learning-outcomes",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = CreateLearningOutcomeParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const parsed = CreateLearningOutcomeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const caller = req.user!;
    const module = await loadModule(params.data.moduleId);
    if (!module) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }
    if (!(await canEditOutcomes(caller, module))) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    const [created] = await db
      .insert(moduleLearningOutcomesTable)
      .values({
        moduleId: module.id,
        code: parsed.data.code,
        description: parsed.data.description,
        order: parsed.data.order ?? 0,
      })
      .returning();
    res.status(201).json({
      id: created!.id,
      moduleId: created!.moduleId,
      code: created!.code,
      description: created!.description,
      order: created!.order,
      criteria: [],
    });
  },
);

router.patch(
  "/learning-outcomes/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UpdateLearningOutcomeParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const parsed = UpdateLearningOutcomeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const caller = req.user!;
    const loaded = await loadOutcome(params.data.id);
    if (!loaded) {
      res.status(404).json({ message: "Resultado de aprendizaje no encontrado" });
      return;
    }
    if (!(await canEditOutcomes(caller, loaded.module))) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    const updates: Partial<typeof moduleLearningOutcomesTable.$inferInsert> = {};
    if (parsed.data.code !== undefined) updates.code = parsed.data.code;
    if (parsed.data.description !== undefined)
      updates.description = parsed.data.description;
    if (parsed.data.order !== undefined) updates.order = parsed.data.order;

    const [updated] = await db
      .update(moduleLearningOutcomesTable)
      .set(updates)
      .where(eq(moduleLearningOutcomesTable.id, loaded.outcome.id))
      .returning();

    const criteria = await db
      .select()
      .from(moduleEvaluationCriteriaTable)
      .where(
        and(
          eq(moduleEvaluationCriteriaTable.outcomeId, updated!.id),
          isNull(moduleEvaluationCriteriaTable.deletedAt),
        ),
      )
      .orderBy(
        moduleEvaluationCriteriaTable.order,
        moduleEvaluationCriteriaTable.id,
      );

    res.json({
      id: updated!.id,
      moduleId: updated!.moduleId,
      code: updated!.code,
      description: updated!.description,
      order: updated!.order,
      criteria: criteria.map((c) => ({
        id: c.id,
        outcomeId: c.outcomeId,
        code: c.code,
        description: c.description,
        order: c.order,
      })),
    });
  },
);

router.delete(
  "/learning-outcomes/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DeleteLearningOutcomeParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;
    const loaded = await loadOutcome(params.data.id);
    if (!loaded) {
      res.status(404).json({ message: "Resultado de aprendizaje no encontrado" });
      return;
    }
    if (!(await canEditOutcomes(caller, loaded.module))) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    const now = new Date();
    await db
      .update(moduleLearningOutcomesTable)
      .set({ deletedAt: now })
      .where(eq(moduleLearningOutcomesTable.id, loaded.outcome.id));
    await db
      .update(moduleEvaluationCriteriaTable)
      .set({ deletedAt: now })
      .where(
        and(
          eq(moduleEvaluationCriteriaTable.outcomeId, loaded.outcome.id),
          isNull(moduleEvaluationCriteriaTable.deletedAt),
        ),
      );
    res.sendStatus(204);
  },
);

router.post(
  "/learning-outcomes/:id/criteria",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = CreateEvaluationCriterionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const parsed = CreateEvaluationCriterionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const caller = req.user!;
    const loaded = await loadOutcome(params.data.id);
    if (!loaded) {
      res.status(404).json({ message: "Resultado de aprendizaje no encontrado" });
      return;
    }
    if (!(await canEditOutcomes(caller, loaded.module))) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    const [created] = await db
      .insert(moduleEvaluationCriteriaTable)
      .values({
        outcomeId: loaded.outcome.id,
        code: parsed.data.code,
        description: parsed.data.description,
        order: parsed.data.order ?? 0,
      })
      .returning();
    res.status(201).json({
      id: created!.id,
      outcomeId: created!.outcomeId,
      code: created!.code,
      description: created!.description,
      order: created!.order,
    });
  },
);

router.patch(
  "/evaluation-criteria/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UpdateEvaluationCriterionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const parsed = UpdateEvaluationCriterionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const caller = req.user!;
    const loaded = await loadCriterion(params.data.id);
    if (!loaded) {
      res.status(404).json({ message: "Criterio de evaluación no encontrado" });
      return;
    }
    if (!(await canEditOutcomes(caller, loaded.module))) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    const updates: Partial<typeof moduleEvaluationCriteriaTable.$inferInsert> =
      {};
    if (parsed.data.code !== undefined) updates.code = parsed.data.code;
    if (parsed.data.description !== undefined)
      updates.description = parsed.data.description;
    if (parsed.data.order !== undefined) updates.order = parsed.data.order;

    const [updated] = await db
      .update(moduleEvaluationCriteriaTable)
      .set(updates)
      .where(eq(moduleEvaluationCriteriaTable.id, loaded.criterion.id))
      .returning();
    res.json({
      id: updated!.id,
      outcomeId: updated!.outcomeId,
      code: updated!.code,
      description: updated!.description,
      order: updated!.order,
    });
  },
);

router.delete(
  "/evaluation-criteria/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DeleteEvaluationCriterionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;
    const loaded = await loadCriterion(params.data.id);
    if (!loaded) {
      res.status(404).json({ message: "Criterio de evaluación no encontrado" });
      return;
    }
    if (!(await canEditOutcomes(caller, loaded.module))) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }
    await db
      .update(moduleEvaluationCriteriaTable)
      .set({ deletedAt: new Date() })
      .where(eq(moduleEvaluationCriteriaTable.id, loaded.criterion.id));
    res.sendStatus(204);
  },
);

// ---------------------------------------------------------------------------
// Groups (always center-scoped)
// ---------------------------------------------------------------------------
router.get("/groups", requireAuth, async (req, res): Promise<void> => {
  const query = ListGroupsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const scope = resolveReadScope(req.user!);
  if (scope.kind === "none") {
    res.json(ListGroupsResponse.parse([]));
    return;
  }

  const filters: SQL[] = [isNull(groupsTable.deletedAt)];
  if (query.data.centerId != null) {
    filters.push(eq(groupsTable.centerId, query.data.centerId));
  }
  if (scope.kind === "province") {
    filters.push(
      inArray(groupsTable.centerId, centerIdsInProvince(scope.provinceId)),
    );
  } else if (scope.kind === "center") {
    filters.push(eq(groupsTable.centerId, scope.centerId));
  }

  const rows = await db
    .select()
    .from(groupsTable)
    .where(and(...filters))
    .orderBy(groupsTable.name);
  res.json(ListGroupsResponse.parse(rows.map(toGroup)));
});

router.post(
  "/groups",
  requireAuth,
  requireRole("superadmin", "coordinator", "department_head"),
  async (req, res): Promise<void> => {
    const parsed = CreateGroupBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const [center] = await db
      .select()
      .from(centersTable)
      .where(
        and(
          eq(centersTable.id, parsed.data.centerId),
          isNull(centersTable.deletedAt),
        ),
      );
    if (!center) {
      res.status(404).json({ message: "Centro no encontrado" });
      return;
    }
    if (
      !hasScopeOver(req.user!, {
        provinceId: center.provinceId,
        centerId: center.id,
      })
    ) {
      res.status(403).json({ message: "Centro fuera de tu ámbito" });
      return;
    }
    const [created] = await db
      .insert(groupsTable)
      .values({
        centerId: parsed.data.centerId,
        name: parsed.data.name,
        cycleName: parsed.data.cycleName ?? null,
        schoolYear: parsed.data.schoolYear ?? null,
      })
      .returning();
    res.status(201).json(toGroup(created));
  },
);

// ---------------------------------------------------------------------------
// Teaching assignments
// ---------------------------------------------------------------------------
router.get(
  "/teaching-assignments",
  requireAuth,
  async (req, res): Promise<void> => {
    const query = ListTeachingAssignmentsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ message: query.error.message });
      return;
    }
    const scope = resolveReadScope(req.user!);
    if (scope.kind === "none") {
      res.json(ListTeachingAssignmentsResponse.parse([]));
      return;
    }

    const filters: SQL[] = [isNull(teachingAssignmentsTable.deletedAt)];
    if (query.data.centerId != null) {
      filters.push(eq(teachingAssignmentsTable.centerId, query.data.centerId));
    }
    if (query.data.teacherId != null) {
      filters.push(
        eq(teachingAssignmentsTable.teacherId, query.data.teacherId),
      );
    }
    if (scope.kind === "province") {
      filters.push(
        inArray(
          teachingAssignmentsTable.centerId,
          centerIdsInProvince(scope.provinceId),
        ),
      );
    } else if (scope.kind === "center") {
      filters.push(eq(teachingAssignmentsTable.centerId, scope.centerId));
    }

    const rows = await db
      .select({
        id: teachingAssignmentsTable.id,
        teacherId: teachingAssignmentsTable.teacherId,
        teacherName: usersTable.name,
        moduleId: teachingAssignmentsTable.moduleId,
        moduleName: modulesTable.name,
        groupId: teachingAssignmentsTable.groupId,
        centerId: teachingAssignmentsTable.centerId,
        schoolYear: teachingAssignmentsTable.schoolYear,
      })
      .from(teachingAssignmentsTable)
      .leftJoin(usersTable, eq(usersTable.id, teachingAssignmentsTable.teacherId))
      .leftJoin(
        modulesTable,
        eq(modulesTable.id, teachingAssignmentsTable.moduleId),
      )
      .where(and(...filters));
    res.json(
      ListTeachingAssignmentsResponse.parse(rows.map(toTeachingAssignment)),
    );
  },
);

router.post(
  "/teaching-assignments",
  requireAuth,
  requireRole("superadmin", "coordinator", "department_head"),
  async (req, res): Promise<void> => {
    const parsed = CreateTeachingAssignmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const [center] = await db
      .select()
      .from(centersTable)
      .where(
        and(
          eq(centersTable.id, parsed.data.centerId),
          isNull(centersTable.deletedAt),
        ),
      );
    if (!center) {
      res.status(404).json({ message: "Centro no encontrado" });
      return;
    }
    if (
      !hasScopeOver(req.user!, {
        provinceId: center.provinceId,
        centerId: center.id,
      })
    ) {
      res.status(403).json({ message: "Centro fuera de tu ámbito" });
      return;
    }

    // The teacher must be a real, active teacher bound to this same center.
    const [teacher] = await db
      .select()
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, parsed.data.teacherId),
          isNull(usersTable.deletedAt),
        ),
      );
    if (!teacher || teacher.role !== "teacher") {
      res.status(400).json({ message: "Profesor no válido" });
      return;
    }
    if (teacher.centerId !== parsed.data.centerId) {
      res
        .status(403)
        .json({ message: "El profesor no pertenece a este centro" });
      return;
    }

    // The module must exist and be either global or belong to this center.
    const [module] = await db
      .select()
      .from(modulesTable)
      .where(
        and(
          eq(modulesTable.id, parsed.data.moduleId),
          isNull(modulesTable.deletedAt),
        ),
      );
    if (!module) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }
    if (module.centerId != null && module.centerId !== parsed.data.centerId) {
      res
        .status(403)
        .json({ message: "El módulo pertenece a otro centro" });
      return;
    }

    // If a group is given it must exist and belong to this center.
    if (parsed.data.groupId != null) {
      const [group] = await db
        .select()
        .from(groupsTable)
        .where(
          and(
            eq(groupsTable.id, parsed.data.groupId),
            isNull(groupsTable.deletedAt),
          ),
        );
      if (!group) {
        res.status(404).json({ message: "Grupo no encontrado" });
        return;
      }
      if (group.centerId !== parsed.data.centerId) {
        res
          .status(403)
          .json({ message: "El grupo pertenece a otro centro" });
        return;
      }
    }

    const [created] = await db
      .insert(teachingAssignmentsTable)
      .values({
        teacherId: parsed.data.teacherId,
        moduleId: parsed.data.moduleId,
        groupId: parsed.data.groupId ?? null,
        centerId: parsed.data.centerId,
        schoolYear: parsed.data.schoolYear ?? null,
      })
      .returning();
    res.status(201).json(
      toTeachingAssignment({
        ...created,
        teacherName: null,
        moduleName: null,
      }),
    );
  },
);

// Transfer a teacher's modules to another teacher. Reassigns the teaching
// assignments only — resource authorship (originalAuthorName) is untouched so
// the original uploader keeps credit even after a relocation or baja.
router.post(
  "/teaching-assignments/transfer",
  requireAuth,
  requireRole("superadmin", "coordinator", "department_head"),
  async (req, res): Promise<void> => {
    const parsed = TransferTeachingAssignmentsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const { fromTeacherId, toTeacherId, moduleIds } = parsed.data;

    // The destination must be a real, active teacher within the caller's scope.
    const [target] = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.id, toTeacherId), isNull(usersTable.deletedAt)));
    if (!target || target.role !== "teacher") {
      res.status(400).json({ message: "Profesor de destino no válido" });
      return;
    }
    if (target.centerId == null) {
      res
        .status(400)
        .json({ message: "El profesor de destino no tiene centro asignado" });
      return;
    }
    let targetProvinceId = target.provinceId;
    if (targetProvinceId == null && target.centerId != null) {
      const [c] = await db
        .select()
        .from(centersTable)
        .where(eq(centersTable.id, target.centerId));
      targetProvinceId = c?.provinceId ?? null;
    }
    if (
      !hasScopeOver(req.user!, {
        provinceId: targetProvinceId,
        centerId: target.centerId,
      })
    ) {
      res
        .status(403)
        .json({ message: "Profesor de destino fuera de tu ámbito" });
      return;
    }

    const conditions: SQL[] = [
      isNull(teachingAssignmentsTable.deletedAt),
      eq(teachingAssignmentsTable.teacherId, fromTeacherId),
      // Center coherence: only move assignments belonging to the destination
      // teacher's center, mirroring the create-assignment invariant.
      eq(teachingAssignmentsTable.centerId, target.centerId),
    ];
    if (moduleIds && moduleIds.length > 0) {
      conditions.push(inArray(teachingAssignmentsTable.moduleId, moduleIds));
    }

    // Only transfer assignments within the caller's scope.
    const scope = resolveReadScope(req.user!);
    if (scope.kind === "province") {
      conditions.push(
        inArray(
          teachingAssignmentsTable.centerId,
          centerIdsInProvince(scope.provinceId),
        ),
      );
    } else if (scope.kind === "center") {
      conditions.push(eq(teachingAssignmentsTable.centerId, scope.centerId));
    } else if (scope.kind === "none") {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    await db
      .update(teachingAssignmentsTable)
      .set({ teacherId: toTeacherId })
      .where(and(...conditions));

    res.json(TransferTeachingAssignmentsResponse.parse({ ok: true }));
  },
);

// ---------------------------------------------------------------------------
// Resources (programming & material repository)
// ---------------------------------------------------------------------------
router.get("/resources", requireAuth, async (req, res): Promise<void> => {
  const query = ListResourcesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const scope = resolveReadScope(req.user!);

  const filters: SQL[] = [isNull(resourcesTable.deletedAt)];
  if (query.data.moduleId != null) {
    filters.push(eq(resourcesTable.moduleId, query.data.moduleId));
  }
  if (query.data.centerId != null) {
    filters.push(eq(resourcesTable.centerId, query.data.centerId));
  }
  if (query.data.search) {
    const term = `%${query.data.search}%`;
    const match = or(
      ilike(resourcesTable.title, term),
      ilike(resourcesTable.description, term),
    );
    if (match) filters.push(match);
  }

  // Global resources (centerId IS NULL) are shared; scoped ones are visible
  // only within the caller's province/center.
  if (scope.kind === "province") {
    const scopeMatch = or(
      isNull(resourcesTable.centerId),
      inArray(resourcesTable.centerId, centerIdsInProvince(scope.provinceId)),
    );
    if (scopeMatch) filters.push(scopeMatch);
  } else if (scope.kind === "center") {
    const scopeMatch = or(
      isNull(resourcesTable.centerId),
      eq(resourcesTable.centerId, scope.centerId),
    );
    if (scopeMatch) filters.push(scopeMatch);
  } else if (scope.kind === "none") {
    filters.push(isNull(resourcesTable.centerId));
  }

  const rows = await db
    .select({
      id: resourcesTable.id,
      title: resourcesTable.title,
      description: resourcesTable.description,
      type: resourcesTable.type,
      fileUrl: resourcesTable.fileUrl,
      authorId: resourcesTable.authorId,
      authorName: usersTable.name,
      originalAuthorName: resourcesTable.originalAuthorName,
      moduleId: resourcesTable.moduleId,
      centerId: resourcesTable.centerId,
      createdAt: resourcesTable.createdAt,
    })
    .from(resourcesTable)
    .leftJoin(usersTable, eq(usersTable.id, resourcesTable.authorId))
    .where(and(...filters))
    .orderBy(resourcesTable.createdAt);
  res.json(ListResourcesResponse.parse(rows.map(toResource)));
});

router.post("/resources", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateResourceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const caller = req.user!;

  // If a center is specified it must be within the caller's read scope (their
  // own center, a center in their province, or anything for superadmin) so a
  // user cannot attach a resource to an out-of-scope center. Otherwise default
  // to the uploader's own center (null for unscoped roles = shared/global).
  let centerId = parsed.data.centerId ?? caller.centerId ?? null;
  if (parsed.data.centerId != null) {
    const [center] = await db
      .select()
      .from(centersTable)
      .where(
        and(
          eq(centersTable.id, parsed.data.centerId),
          isNull(centersTable.deletedAt),
        ),
      );
    if (!center) {
      res.status(404).json({ message: "Centro no encontrado" });
      return;
    }
    const scope = resolveReadScope(caller);
    const inScope =
      scope.kind === "global"
        ? true
        : scope.kind === "center"
          ? center.id === scope.centerId
          : scope.kind === "province"
            ? center.provinceId === scope.provinceId
            : false;
    if (!inScope) {
      res.status(403).json({ message: "Centro fuera de tu ámbito" });
      return;
    }
    centerId = center.id;
  }

  const [created] = await db
    .insert(resourcesTable)
    .values({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      type: parsed.data.type,
      fileUrl: parsed.data.fileUrl ?? null,
      authorId: caller.id,
      originalAuthorName: caller.name,
      moduleId: parsed.data.moduleId ?? null,
      centerId,
    })
    .returning();
  res.status(201).json(
    toResource({ ...created, authorName: caller.name }),
  );
});

router.delete("/resources/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteResourceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ message: params.error.message });
    return;
  }
  const [resource] = await db
    .select()
    .from(resourcesTable)
    .where(
      and(eq(resourcesTable.id, params.data.id), isNull(resourcesTable.deletedAt)),
    );
  if (!resource) {
    res.status(404).json({ message: "Recurso no encontrado" });
    return;
  }

  const caller = req.user!;
  // Authors may delete their own uploads; managers may delete within scope.
  let centerProvinceId: number | null = null;
  if (resource.centerId != null) {
    const [center] = await db
      .select()
      .from(centersTable)
      .where(eq(centersTable.id, resource.centerId));
    centerProvinceId = center?.provinceId ?? null;
  }
  const isAuthor = resource.authorId === caller.id;
  const canManage = hasScopeOver(caller, {
    provinceId: centerProvinceId,
    centerId: resource.centerId,
  });
  if (!isAuthor && !canManage) {
    res.status(403).json({ message: "Permiso denegado" });
    return;
  }

  await db
    .update(resourcesTable)
    .set({ deletedAt: new Date() })
    .where(eq(resourcesTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;
