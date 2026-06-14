import { Router, type IRouter } from "express";
import {
  and,
  eq,
  isNull,
  ne,
  inArray,
  desc,
  count,
  type SQL,
} from "drizzle-orm";
import {
  db,
  academicYearsTable,
  teacherYearConfirmationsTable,
  integrationSettingsTable,
  groupsTable,
  teachingAssignmentsTable,
  trainingOfferTable,
  modulesTable,
  usersTable,
  centersTable,
  syncModuleChatGroup,
} from "@workspace/db";
import {
  CreateAcademicYearBody,
  SetActiveAcademicYearBody,
  TransitionAcademicYearBody,
  OpenYearConfirmationBody,
  ListYearConfirmationsQueryParams,
  ConfirmYearBody,
  RenameAcademicYearParams,
  RenameAcademicYearBody,
  DeleteAcademicYearParams,
} from "@workspace/api-zod";
import {
  requireAuth,
  requireRole,
  resolveReadScope,
} from "../middlewares/auth";
import {
  toAcademicYear,
  toTeacherYearConfirmation,
} from "../lib/mappers";
import { getSettings, getActiveAcademicYear } from "../lib/settings";
import { sendEmail, buildYearConfirmationEmail } from "../lib/email";
import { getAppBaseUrl } from "../lib/appUrl";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const DEFAULT_DEADLINE_DAYS = 15;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setActiveYear(name: string | null): Promise<void> {
  const settings = await getSettings();
  await db
    .update(integrationSettingsTable)
    .set({ activeAcademicYear: name })
    .where(eq(integrationSettingsTable.id, settings.id));
}

// Builds the official year list with per-year usage counts and the active course.
async function buildYearsResponse() {
  const activeYear = await getActiveAcademicYear();
  const years = await db
    .select()
    .from(academicYearsTable)
    .where(isNull(academicYearsTable.deletedAt))
    .orderBy(desc(academicYearsTable.name));

  const groupCounts = await db
    .select({ year: groupsTable.schoolYear, c: count() })
    .from(groupsTable)
    .where(isNull(groupsTable.deletedAt))
    .groupBy(groupsTable.schoolYear);
  const assignmentCounts = await db
    .select({ year: teachingAssignmentsTable.schoolYear, c: count() })
    .from(teachingAssignmentsTable)
    .where(isNull(teachingAssignmentsTable.deletedAt))
    .groupBy(teachingAssignmentsTable.schoolYear);
  const offerCounts = await db
    .select({ year: trainingOfferTable.schoolYear, c: count() })
    .from(trainingOfferTable)
    .where(isNull(trainingOfferTable.deletedAt))
    .groupBy(trainingOfferTable.schoolYear);

  const toMap = (
    rows: { year: string | null; c: number }[],
  ): Map<string, number> => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.year) map.set(row.year, Number(row.c));
    }
    return map;
  };
  const gMap = toMap(groupCounts);
  const aMap = toMap(assignmentCounts);
  const oMap = toMap(offerCounts);

  return {
    activeYear: activeYear ?? null,
    years: years.map((y) => ({
      id: y.id,
      name: y.name,
      active: y.name === activeYear,
      groupCount: gMap.get(y.name) ?? 0,
      assignmentCount: aMap.get(y.name) ?? 0,
      offerCount: oMap.get(y.name) ?? 0,
    })),
  };
}

// ---------------------------------------------------------------------------
// Academic year list + active course
// ---------------------------------------------------------------------------

router.get(
  "/academic-years",
  requireAuth,
  async (_req, res): Promise<void> => {
    res.json(await buildYearsResponse());
  },
);

router.post(
  "/academic-years",
  requireAuth,
  requireRole("superadmin"),
  async (req, res): Promise<void> => {
    const parsed = CreateAcademicYearBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const name = parsed.data.name.trim();
    if (!name) {
      res.status(400).json({ message: "El nombre no puede estar vacío" });
      return;
    }
    const [existing] = await db
      .select()
      .from(academicYearsTable)
      .where(eq(academicYearsTable.name, name));
    if (existing) {
      if (existing.deletedAt) {
        const [restored] = await db
          .update(academicYearsTable)
          .set({ deletedAt: null })
          .where(eq(academicYearsTable.id, existing.id))
          .returning();
        res.status(201).json(toAcademicYear(restored));
        return;
      }
      res.status(409).json({ message: "Ese curso ya existe" });
      return;
    }
    const [created] = await db
      .insert(academicYearsTable)
      .values({ name })
      .returning();
    res.status(201).json(toAcademicYear(created));
  },
);

router.put(
  "/academic-years/active",
  requireAuth,
  requireRole("superadmin"),
  async (req, res): Promise<void> => {
    const parsed = SetActiveAcademicYearBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const name = parsed.data.name.trim();
    if (!name) {
      res.status(400).json({ message: "El nombre no puede estar vacío" });
      return;
    }
    const [year] = await db
      .select()
      .from(academicYearsTable)
      .where(
        and(
          eq(academicYearsTable.name, name),
          isNull(academicYearsTable.deletedAt),
        ),
      );
    if (!year) {
      res.status(404).json({ message: "Curso no encontrado" });
      return;
    }
    await setActiveYear(name);
    res.json(await buildYearsResponse());
  },
);

// ---------------------------------------------------------------------------
// Pasar de curso (transition wizard)
// ---------------------------------------------------------------------------

router.post(
  "/academic-years/transition",
  requireAuth,
  requireRole("superadmin"),
  async (req, res): Promise<void> => {
    const parsed = TransitionAcademicYearBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const fromYear = parsed.data.fromYear.trim();
    const toYear = parsed.data.toYear.trim();
    if (!fromYear || !toYear || fromYear === toYear) {
      res
        .status(400)
        .json({ message: "Indica un curso de origen y otro de destino" });
      return;
    }
    const [destYear] = await db
      .select()
      .from(academicYearsTable)
      .where(
        and(
          eq(academicYearsTable.name, toYear),
          isNull(academicYearsTable.deletedAt),
        ),
      );
    if (!destYear) {
      res
        .status(404)
        .json({ message: "El curso de destino no está en la lista oficial" });
      return;
    }

    const copyGroups = parsed.data.copyGroups ?? true;
    const copyTrainingOffer = parsed.data.copyTrainingOffer ?? true;
    const copyAssignments = parsed.data.copyAssignments ?? true;

    let groupsCopied = 0;
    let offerCopied = 0;
    let assignmentsCopied = 0;

    if (copyGroups) {
      const source = await db
        .select()
        .from(groupsTable)
        .where(
          and(
            eq(groupsTable.schoolYear, fromYear),
            isNull(groupsTable.deletedAt),
          ),
        );
      const existing = await db
        .select({ centerId: groupsTable.centerId, name: groupsTable.name })
        .from(groupsTable)
        .where(
          and(
            eq(groupsTable.schoolYear, toYear),
            isNull(groupsTable.deletedAt),
          ),
        );
      const seen = new Set(
        existing.map((r) => `${r.centerId}|${r.name}`),
      );
      for (const g of source) {
        const key = `${g.centerId}|${g.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await db.insert(groupsTable).values({
          centerId: g.centerId,
          name: g.name,
          cycleName: g.cycleName,
          schoolYear: toYear,
        });
        groupsCopied += 1;
      }
    }

    if (copyTrainingOffer) {
      const source = await db
        .select()
        .from(trainingOfferTable)
        .where(
          and(
            eq(trainingOfferTable.schoolYear, fromYear),
            isNull(trainingOfferTable.deletedAt),
          ),
        );
      const existing = await db
        .select({
          centerId: trainingOfferTable.centerId,
          cycleName: trainingOfferTable.cycleName,
          shift: trainingOfferTable.shift,
        })
        .from(trainingOfferTable)
        .where(
          and(
            eq(trainingOfferTable.schoolYear, toYear),
            isNull(trainingOfferTable.deletedAt),
          ),
        );
      const seen = new Set(
        existing.map((r) => `${r.centerId}|${r.cycleName}|${r.shift ?? ""}`),
      );
      for (const o of source) {
        const key = `${o.centerId}|${o.cycleName}|${o.shift ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await db.insert(trainingOfferTable).values({
          centerId: o.centerId,
          cycleId: o.cycleId,
          cycleName: o.cycleName,
          level: o.level,
          shift: o.shift,
          schoolYear: toYear,
        });
        offerCopied += 1;
      }
    }

    const touchedModuleIds = new Set<number>();
    if (copyAssignments) {
      const source = await db
        .select()
        .from(teachingAssignmentsTable)
        .where(
          and(
            eq(teachingAssignmentsTable.schoolYear, fromYear),
            isNull(teachingAssignmentsTable.deletedAt),
          ),
        );
      const existing = await db
        .select({
          teacherId: teachingAssignmentsTable.teacherId,
          moduleId: teachingAssignmentsTable.moduleId,
          centerId: teachingAssignmentsTable.centerId,
        })
        .from(teachingAssignmentsTable)
        .where(
          and(
            eq(teachingAssignmentsTable.schoolYear, toYear),
            isNull(teachingAssignmentsTable.deletedAt),
          ),
        );
      const seen = new Set(
        existing.map((r) => `${r.teacherId}|${r.moduleId}|${r.centerId}`),
      );
      for (const a of source) {
        const key = `${a.teacherId}|${a.moduleId}|${a.centerId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await db.insert(teachingAssignmentsTable).values({
          teacherId: a.teacherId,
          moduleId: a.moduleId,
          groupId: a.groupId,
          centerId: a.centerId,
          schoolYear: toYear,
        });
        assignmentsCopied += 1;
        touchedModuleIds.add(a.moduleId);
      }
    }

    for (const moduleId of touchedModuleIds) {
      try {
        await syncModuleChatGroup(moduleId);
      } catch (err) {
        logger.error({ err, moduleId }, "syncModuleChatGroup (transition) failed");
      }
    }

    res.json({ groupsCopied, offerCopied, assignmentsCopied });
  },
);

// ---------------------------------------------------------------------------
// Annual teacher confirmation window
// ---------------------------------------------------------------------------

router.post(
  "/academic-years/open-confirmation",
  requireAuth,
  requireRole("superadmin"),
  async (req, res): Promise<void> => {
    const parsed = OpenYearConfirmationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const year = parsed.data.year.trim();
    if (!year) {
      res.status(400).json({ message: "Indica el curso" });
      return;
    }
    const days = parsed.data.deadlineDays ?? DEFAULT_DEADLINE_DAYS;
    const deadline = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const teachers = await db
      .select()
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "teacher"),
          eq(usersTable.status, "active"),
          isNull(usersTable.deletedAt),
        ),
      );

    const existing = await db
      .select({ teacherId: teacherYearConfirmationsTable.teacherId })
      .from(teacherYearConfirmationsTable)
      .where(eq(teacherYearConfirmationsTable.schoolYear, year));
    const alreadyOpen = new Set(existing.map((r) => r.teacherId));

    const appUrl = getAppBaseUrl(req);
    let created = 0;
    let emailed = 0;
    let emailPending = false;

    for (const teacher of teachers) {
      if (alreadyOpen.has(teacher.id)) continue;
      await db.insert(teacherYearConfirmationsTable).values({
        teacherId: teacher.id,
        schoolYear: year,
        status: "pending",
        deadline,
      });
      created += 1;

      const email = buildYearConfirmationEmail({
        teacherName: teacher.name,
        schoolYear: year,
        deadline,
        appUrl,
      });
      const result = await sendEmail({
        to: teacher.email,
        subject: email.subject,
        html: email.html,
      });
      if (result.sent) emailed += 1;
      if (result.pending) emailPending = true;
    }

    res.json({ created, emailed, emailPending, deadline });
  },
);

router.get(
  "/academic-years/confirmations",
  requireAuth,
  requireRole("superadmin", "coordinator", "department_head"),
  async (req, res): Promise<void> => {
    const query = ListYearConfirmationsQueryParams.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ message: query.error.message });
      return;
    }
    const year =
      (query.data.schoolYear ?? "").trim() ||
      (await getActiveAcademicYear()) ||
      null;
    if (!year) {
      res.json([]);
      return;
    }

    const scope = resolveReadScope(req.user!);
    if (scope.kind === "none") {
      res.json([]);
      return;
    }

    const filters: SQL[] = [eq(teacherYearConfirmationsTable.schoolYear, year)];
    // Confirmations are scoped by the teacher's own province/center, since a
    // pending row has no centerId until the teacher confirms.
    if (scope.kind === "province") {
      filters.push(
        inArray(
          usersTable.centerId,
          db
            .select({ id: centersTable.id })
            .from(centersTable)
            .where(
              and(
                eq(centersTable.provinceId, scope.provinceId),
                isNull(centersTable.deletedAt),
              ),
            ),
        ),
      );
    } else if (scope.kind === "center") {
      filters.push(eq(usersTable.centerId, scope.centerId));
    }

    const rows = await db
      .select({
        id: teacherYearConfirmationsTable.id,
        teacherId: teacherYearConfirmationsTable.teacherId,
        teacherName: usersTable.name,
        schoolYear: teacherYearConfirmationsTable.schoolYear,
        status: teacherYearConfirmationsTable.status,
        centerId: teacherYearConfirmationsTable.centerId,
        deadline: teacherYearConfirmationsTable.deadline,
        confirmedAt: teacherYearConfirmationsTable.confirmedAt,
        createdAt: teacherYearConfirmationsTable.createdAt,
        updatedAt: teacherYearConfirmationsTable.updatedAt,
      })
      .from(teacherYearConfirmationsTable)
      .innerJoin(
        usersTable,
        eq(usersTable.id, teacherYearConfirmationsTable.teacherId),
      )
      .where(and(...filters))
      .orderBy(usersTable.name);

    res.json(rows.map(toTeacherYearConfirmation));
  },
);

router.get(
  "/academic-years/my-confirmation",
  requireAuth,
  async (req, res): Promise<void> => {
    const caller = req.user!;
    const year = await getActiveAcademicYear();
    if (caller.role !== "teacher" || !year) {
      res.json({ year: year ?? null, status: "none" });
      return;
    }

    const [confirmation] = await db
      .select()
      .from(teacherYearConfirmationsTable)
      .where(
        and(
          eq(teacherYearConfirmationsTable.teacherId, caller.id),
          eq(teacherYearConfirmationsTable.schoolYear, year),
        ),
      );
    if (!confirmation) {
      res.json({ year, status: "none" });
      return;
    }

    const assignments = await db
      .select({ moduleId: teachingAssignmentsTable.moduleId })
      .from(teachingAssignmentsTable)
      .where(
        and(
          eq(teachingAssignmentsTable.teacherId, caller.id),
          eq(teachingAssignmentsTable.schoolYear, year),
          isNull(teachingAssignmentsTable.deletedAt),
        ),
      );

    res.json({
      year,
      status: confirmation.status,
      deadline: confirmation.deadline,
      confirmedAt: confirmation.confirmedAt,
      centerId: confirmation.centerId,
      moduleIds: assignments.map((a) => a.moduleId),
    });
  },
);

router.post(
  "/academic-years/confirm",
  requireAuth,
  requireRole("teacher"),
  async (req, res): Promise<void> => {
    const parsed = ConfirmYearBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const caller = req.user!;
    const year = await getActiveAcademicYear();
    if (!year) {
      res.status(409).json({ message: "No hay un curso activo" });
      return;
    }

    const [confirmation] = await db
      .select()
      .from(teacherYearConfirmationsTable)
      .where(
        and(
          eq(teacherYearConfirmationsTable.teacherId, caller.id),
          eq(teacherYearConfirmationsTable.schoolYear, year),
        ),
      );
    if (!confirmation) {
      res.status(409).json({
        message: "No tienes una confirmación abierta para el curso activo",
      });
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

    const moduleIds = Array.from(new Set(parsed.data.moduleIds));
    if (moduleIds.length > 0) {
      const validModules = await db
        .select({ id: modulesTable.id, centerId: modulesTable.centerId })
        .from(modulesTable)
        .where(
          and(
            inArray(modulesTable.id, moduleIds),
            isNull(modulesTable.deletedAt),
          ),
        );
      const validIds = new Set(validModules.map((m) => m.id));
      const invalid = moduleIds.filter((id) => !validIds.has(id));
      if (invalid.length > 0) {
        res.status(400).json({ message: "Algún módulo no es válido" });
        return;
      }
      // Modules must be global (centerId null) or belong to the chosen center.
      const outOfCenter = validModules.filter(
        (m) => m.centerId != null && m.centerId !== center.id,
      );
      if (outOfCenter.length > 0) {
        res.status(400).json({
          message: "Algún módulo no pertenece al centro indicado",
        });
        return;
      }
    }

    // Reflect a possible center move on the teacher's own record.
    if (caller.centerId !== center.id) {
      await db
        .update(usersTable)
        .set({ centerId: center.id, provinceId: center.provinceId })
        .where(eq(usersTable.id, caller.id));
    }

    // Generate teaching assignments for the year (idempotent per module).
    const existing = await db
      .select({ moduleId: teachingAssignmentsTable.moduleId })
      .from(teachingAssignmentsTable)
      .where(
        and(
          eq(teachingAssignmentsTable.teacherId, caller.id),
          eq(teachingAssignmentsTable.schoolYear, year),
          isNull(teachingAssignmentsTable.deletedAt),
        ),
      );
    const existingModules = new Set(existing.map((a) => a.moduleId));
    const touchedModuleIds = new Set<number>();
    for (const moduleId of moduleIds) {
      if (existingModules.has(moduleId)) continue;
      await db.insert(teachingAssignmentsTable).values({
        teacherId: caller.id,
        moduleId,
        centerId: center.id,
        schoolYear: year,
      });
      touchedModuleIds.add(moduleId);
    }

    const [updated] = await db
      .update(teacherYearConfirmationsTable)
      .set({
        status: "confirmed",
        confirmedAt: new Date(),
        centerId: center.id,
      })
      .where(eq(teacherYearConfirmationsTable.id, confirmation.id))
      .returning();

    for (const moduleId of touchedModuleIds) {
      try {
        await syncModuleChatGroup(moduleId);
      } catch (err) {
        logger.error(
          { err, moduleId },
          "syncModuleChatGroup (confirm) failed",
        );
      }
    }

    res.json(
      toTeacherYearConfirmation({ ...updated, teacherName: caller.name }),
    );
  },
);

// ---------------------------------------------------------------------------
// Rename / delete an academic year (after the literal routes above)
// ---------------------------------------------------------------------------

router.patch(
  "/academic-years/:id",
  requireAuth,
  requireRole("superadmin"),
  async (req, res): Promise<void> => {
    const params = RenameAcademicYearParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const parsed = RenameAcademicYearBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const name = parsed.data.name.trim();
    if (!name) {
      res.status(400).json({ message: "El nombre no puede estar vacío" });
      return;
    }

    const [year] = await db
      .select()
      .from(academicYearsTable)
      .where(
        and(
          eq(academicYearsTable.id, params.data.id),
          isNull(academicYearsTable.deletedAt),
        ),
      );
    if (!year) {
      res.status(404).json({ message: "Curso no encontrado" });
      return;
    }
    if (name !== year.name) {
      const [clash] = await db
        .select()
        .from(academicYearsTable)
        .where(
          and(
            eq(academicYearsTable.name, name),
            ne(academicYearsTable.id, year.id),
          ),
        );
      if (clash) {
        res.status(409).json({ message: "Ese curso ya existe" });
        return;
      }
    }

    // Rename cascades to the free-text school_year on the dependent rows and the
    // active-course setting so the rename is consistent across the app.
    await db
      .update(academicYearsTable)
      .set({ name })
      .where(eq(academicYearsTable.id, year.id));
    if (name !== year.name) {
      await db
        .update(groupsTable)
        .set({ schoolYear: name })
        .where(eq(groupsTable.schoolYear, year.name));
      await db
        .update(teachingAssignmentsTable)
        .set({ schoolYear: name })
        .where(eq(teachingAssignmentsTable.schoolYear, year.name));
      await db
        .update(trainingOfferTable)
        .set({ schoolYear: name })
        .where(eq(trainingOfferTable.schoolYear, year.name));
      await db
        .update(teacherYearConfirmationsTable)
        .set({ schoolYear: name })
        .where(eq(teacherYearConfirmationsTable.schoolYear, year.name));
      const active = await getActiveAcademicYear();
      if (active === year.name) await setActiveYear(name);
    }

    const groupCount = await countYear(name, "groups");
    const assignmentCount = await countYear(name, "assignments");
    const offerCount = await countYear(name, "offer");

    res.json({
      id: year.id,
      name,
      active: (await getActiveAcademicYear()) === name,
      groupCount,
      assignmentCount,
      offerCount,
    });
  },
);

async function countYear(
  name: string,
  table: "groups" | "assignments" | "offer",
): Promise<number> {
  if (table === "groups") {
    const [r] = await db
      .select({ c: count() })
      .from(groupsTable)
      .where(
        and(eq(groupsTable.schoolYear, name), isNull(groupsTable.deletedAt)),
      );
    return Number(r?.c ?? 0);
  }
  if (table === "assignments") {
    const [r] = await db
      .select({ c: count() })
      .from(teachingAssignmentsTable)
      .where(
        and(
          eq(teachingAssignmentsTable.schoolYear, name),
          isNull(teachingAssignmentsTable.deletedAt),
        ),
      );
    return Number(r?.c ?? 0);
  }
  const [r] = await db
    .select({ c: count() })
    .from(trainingOfferTable)
    .where(
      and(
        eq(trainingOfferTable.schoolYear, name),
        isNull(trainingOfferTable.deletedAt),
      ),
    );
  return Number(r?.c ?? 0);
}

router.delete(
  "/academic-years/:id",
  requireAuth,
  requireRole("superadmin"),
  async (req, res): Promise<void> => {
    const params = DeleteAcademicYearParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const [year] = await db
      .select()
      .from(academicYearsTable)
      .where(
        and(
          eq(academicYearsTable.id, params.data.id),
          isNull(academicYearsTable.deletedAt),
        ),
      );
    if (!year) {
      res.status(404).json({ message: "Curso no encontrado" });
      return;
    }
    const active = await getActiveAcademicYear();
    if (active === year.name) {
      res.status(409).json({
        message: "No puedes eliminar el curso activo",
      });
      return;
    }
    // Guard against removing a year still referenced by academic data.
    const [{ c: usage }] = await db
      .select({ c: count() })
      .from(groupsTable)
      .where(
        and(eq(groupsTable.schoolYear, year.name), isNull(groupsTable.deletedAt)),
      );
    const [{ c: offerUsage }] = await db
      .select({ c: count() })
      .from(trainingOfferTable)
      .where(
        and(
          eq(trainingOfferTable.schoolYear, year.name),
          isNull(trainingOfferTable.deletedAt),
        ),
      );
    if (Number(usage) > 0 || Number(offerUsage) > 0) {
      res.status(409).json({
        message: "El curso tiene datos asociados y no puede eliminarse",
      });
      return;
    }
    await db
      .update(academicYearsTable)
      .set({ deletedAt: new Date() })
      .where(eq(academicYearsTable.id, year.id));
    res.status(204).end();
  },
);

// ---------------------------------------------------------------------------
// Startup seed: backfill the official list from existing free-text years and
// default the active course to the most recent one when unset.
// ---------------------------------------------------------------------------

export async function seedAcademicYears(): Promise<void> {
  const distinct = await db
    .select({ year: groupsTable.schoolYear })
    .from(groupsTable)
    .where(isNull(groupsTable.deletedAt))
    .groupBy(groupsTable.schoolYear)
    .union(
      db
        .select({ year: teachingAssignmentsTable.schoolYear })
        .from(teachingAssignmentsTable)
        .where(isNull(teachingAssignmentsTable.deletedAt))
        .groupBy(teachingAssignmentsTable.schoolYear),
    )
    .union(
      db
        .select({ year: trainingOfferTable.schoolYear })
        .from(trainingOfferTable)
        .where(isNull(trainingOfferTable.deletedAt))
        .groupBy(trainingOfferTable.schoolYear),
    );

  const names = Array.from(
    new Set(
      distinct
        .map((r) => (r.year ?? "").trim())
        .filter((v): v is string => v.length > 0),
    ),
  );

  const existing = await db
    .select({ name: academicYearsTable.name })
    .from(academicYearsTable);
  const known = new Set(existing.map((r) => r.name));
  const missing = names.filter((n) => !known.has(n));
  if (missing.length > 0) {
    await db
      .insert(academicYearsTable)
      .values(missing.map((name) => ({ name })))
      .onConflictDoNothing();
    logger.info({ added: missing.length }, "Seeded academic years from data");
  }

  const active = await getActiveAcademicYear();
  if (!active) {
    const [latest] = await db
      .select()
      .from(academicYearsTable)
      .where(isNull(academicYearsTable.deletedAt))
      .orderBy(desc(academicYearsTable.name))
      .limit(1);
    if (latest) {
      await setActiveYear(latest.name);
      logger.info({ year: latest.name }, "Defaulted active academic year");
    }
  }
}

export default router;
