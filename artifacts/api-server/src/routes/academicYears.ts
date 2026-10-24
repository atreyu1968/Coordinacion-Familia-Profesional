import { Router, type IRouter } from "express";
import { copyAcademicYearData } from "../lib/academicYearTransition";
import {
  and,
  eq,
  isNull,
  isNotNull,
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
  chatGroupsTable,
  chatGroupMembersTable,
  messagesTable,
  messageReactionsTable,
  messageUserHidesTable,
  chatAttachmentDeletionsTable,
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
import { notifyUsers } from "../lib/notify";
import {
  getSettings,
  getActiveAcademicYear,
  getActiveFamily,
} from "../lib/settings";
import { sendEmail, buildYearConfirmationEmail } from "../lib/email";
import { getAppBaseUrl } from "../lib/appUrl";
import { logger } from "../lib/logger";
import { moduleFamilyFilter } from "../lib/familyCatalog";
import { syncModuleNextcloudMembership } from "../lib/moduleNextcloudSync";
import {
  enqueueChatAttachmentDeletions,
  processNextChatAttachmentDeletion,
  retryChatAttachmentDeletion,
} from "../lib/chatAttachmentDeletionWorker";

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
    const currentYear = await getActiveAcademicYear();
    const isChangingYear = currentYear !== name;
    if (isChangingYear && !parsed.data.confirmConversationDeletion) {
      res.status(400).json({
        message:
          "Confirma expresamente el borrado de todas las conversaciones antes de cambiar el curso activo",
      });
      return;
    }

    const settings = await getSettings();
    let affectedModuleIds: number[] = [];
    let chatCleanup:
      | {
          conversationsDeleted: number;
          messagesDeleted: number;
          attachmentsDeleted: number;
          attachmentDeletionFailures: number;
        }
      | undefined;

    if (currentYear !== name) {
      const yearNames = [currentYear, name].filter(
        (value): value is string => Boolean(value),
      );
      if (yearNames.length > 0) {
        const affected = await db
          .selectDistinct({ moduleId: teachingAssignmentsTable.moduleId })
          .from(teachingAssignmentsTable)
          .where(
            and(
              isNull(teachingAssignmentsTable.deletedAt),
              inArray(teachingAssignmentsTable.schoolYear, yearNames),
            ),
          );
        affectedModuleIds = affected.map(({ moduleId }) => moduleId);
        try {
          for (const moduleId of affectedModuleIds) {
            await syncModuleNextcloudMembership(moduleId, {
              schoolYear: name,
            });
          }
        } catch (err) {
          logger.error(
            { err, fromYear: currentYear, toYear: name },
            "Failed to sync Nextcloud before changing the active academic year",
          );
          for (const moduleId of affectedModuleIds) {
            try {
              await syncModuleNextcloudMembership(moduleId, {
                schoolYear: currentYear,
              });
            } catch (restoreErr) {
              logger.error(
                { err: restoreErr, moduleId, schoolYear: currentYear },
                "Failed to restore Nextcloud membership after active-year sync failure",
              );
            }
          }
          res.status(502).json({
            message:
              "No se pudo confirmar la actualización de permisos en Nextcloud; el curso activo no ha cambiado",
          });
          return;
        }
      }

      // Database rows and the active-year setting are changed atomically. If the
      // transaction fails, chat history and the active year remain unchanged.
      let attachmentPaths: string[] = [];
      let deletionIds: number[] = [];
      let deletedCounts: { conversationsDeleted: number; messagesDeleted: number };
      try {
        deletedCounts = await db.transaction(async (tx) => {
          const [conversationCount] = await tx
            .select({ value: count() })
            .from(chatGroupsTable);
          const [messageCount] = await tx
            .select({ value: count() })
            .from(messagesTable);
          const attachments = await tx
            .select({ path: messagesTable.attachmentPath })
            .from(messagesTable)
            .where(isNotNull(messagesTable.attachmentPath));
          attachmentPaths = Array.from(
            new Set(
              attachments
                .map((item) => item.path)
                .filter((path): path is string => Boolean(path)),
            ),
          );
          deletionIds = await enqueueChatAttachmentDeletions(tx, attachmentPaths);

          await tx.delete(messageReactionsTable);
          await tx.delete(messageUserHidesTable);
          await tx.delete(messagesTable);
          await tx.delete(chatGroupMembersTable);
          await tx.delete(chatGroupsTable);
          await tx
            .update(integrationSettingsTable)
            .set({ activeAcademicYear: name })
            .where(eq(integrationSettingsTable.id, settings.id));

          return {
            conversationsDeleted: Number(conversationCount?.value ?? 0),
            messagesDeleted: Number(messageCount?.value ?? 0),
          };
        });
      } catch (err) {
        logger.error(
          { err, fromYear: currentYear, toYear: name },
          "Failed to clear chat data while changing the active academic year",
        );
        if (currentYear) {
          for (const moduleId of affectedModuleIds) {
            try {
              await syncModuleNextcloudMembership(moduleId, {
                schoolYear: currentYear,
              });
            } catch (restoreErr) {
              logger.error(
                { err: restoreErr, moduleId, schoolYear: currentYear },
                "Failed to restore Nextcloud membership after chat cleanup rollback",
              );
            }
          }
        }
        res.status(500).json({
          message:
            "No se pudo completar el cambio; las conversaciones y el curso activo se mantienen sin cambios",
        });
        return;
      }

      for (const deletionId of deletionIds) {
        await processNextChatAttachmentDeletion(deletionId);
      }
      const deletionStates =
        deletionIds.length > 0
          ? await db
              .select({ status: chatAttachmentDeletionsTable.status })
              .from(chatAttachmentDeletionsTable)
              .where(inArray(chatAttachmentDeletionsTable.id, deletionIds))
          : [];
      const attachmentsDeleted = deletionStates.filter(
        (row) => row.status === "done",
      ).length;
      const attachmentDeletionFailures =
        deletionStates.length - attachmentsDeleted;
      if (attachmentDeletionFailures > 0) {
        logger.error(
          { attachmentDeletionFailures },
          "Some chat attachments could not be removed after an academic-year change",
        );
      }
      chatCleanup = {
        ...deletedCounts,
        attachmentsDeleted,
        attachmentDeletionFailures,
      };
    } else {
      await db
        .update(integrationSettingsTable)
        .set({ activeAcademicYear: name })
        .where(eq(integrationSettingsTable.id, settings.id));
    }

    res.json({
      ...(await buildYearsResponse()),
      ...(chatCleanup ? { chatCleanup } : {}),
    });
  },
);

router.get(
  "/academic-years/chat-attachment-deletions",
  requireAuth,
  requireRole("superadmin"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({
        id: chatAttachmentDeletionsTable.id,
        status: chatAttachmentDeletionsTable.status,
        attempts: chatAttachmentDeletionsTable.attempts,
        lastError: chatAttachmentDeletionsTable.lastError,
        nextAttemptAt: chatAttachmentDeletionsTable.nextAttemptAt,
        createdAt: chatAttachmentDeletionsTable.createdAt,
        updatedAt: chatAttachmentDeletionsTable.updatedAt,
      })
      .from(chatAttachmentDeletionsTable)
      .where(
        and(
          isNotNull(chatAttachmentDeletionsTable.objectPath),
          inArray(chatAttachmentDeletionsTable.status, [
            "pending",
            "processing",
            "failed",
          ]),
        ),
      )
      .orderBy(desc(chatAttachmentDeletionsTable.createdAt));
    res.json(
      rows.map((row) => ({
        ...row,
        lastError: row.lastError
          ? "No se pudo borrar el archivo en Object Storage."
          : null,
      })),
    );
  },
);

router.post(
  "/academic-years/chat-attachment-deletions/:id/retry",
  requireAuth,
  requireRole("superadmin"),
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      res.status(400).json({ message: "Identificador no válido" });
      return;
    }
    const retried = await retryChatAttachmentDeletion(id);
    if (!retried) {
      const [existing] = await db
        .select({ id: chatAttachmentDeletionsTable.id })
        .from(chatAttachmentDeletionsTable)
        .where(eq(chatAttachmentDeletionsTable.id, id));
      if (!existing) {
        res.status(404).json({ message: "Borrado pendiente no encontrado" });
        return;
      }
      res.status(409).json({
        message: "El borrado ya está en curso o no se puede reintentar.",
      });
      return;
    }
    const [row] = await db
      .select({
        id: chatAttachmentDeletionsTable.id,
        status: chatAttachmentDeletionsTable.status,
        attempts: chatAttachmentDeletionsTable.attempts,
        lastError: chatAttachmentDeletionsTable.lastError,
        nextAttemptAt: chatAttachmentDeletionsTable.nextAttemptAt,
        createdAt: chatAttachmentDeletionsTable.createdAt,
        updatedAt: chatAttachmentDeletionsTable.updatedAt,
      })
      .from(chatAttachmentDeletionsTable)
      .where(eq(chatAttachmentDeletionsTable.id, id));
    if (!row) {
      res.status(404).json({ message: "Borrado pendiente no encontrado" });
      return;
    }
    res.json({
      ...row,
      lastError: row.lastError
        ? "No se pudo borrar el archivo en Object Storage."
        : null,
    });
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

    const { groupsCopied, offerCopied, assignmentsCopied, touchedModuleIds } =
      await copyAcademicYearData({
        fromYear, toYear, copyGroups, copyTrainingOffer, copyAssignments,
      });

    if ((await getActiveAcademicYear()) === toYear) {
      try {
        for (const moduleId of touchedModuleIds) {
          await syncModuleNextcloudMembership(moduleId);
        }
      } catch (err) {
        logger.error(
          { err, moduleIds: touchedModuleIds },
          "syncModuleNextcloudMembership (transition) failed",
        );
        res.status(502).json({
          message:
            "No se pudo confirmar la actualización de permisos en Nextcloud; revisa el curso antes de volver a intentarlo",
        });
        return;
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
    const newlyPendingTeacherIds: number[] = [];

    for (const teacher of teachers) {
      if (alreadyOpen.has(teacher.id)) continue;
      await db.insert(teacherYearConfirmationsTable).values({
        teacherId: teacher.id,
        schoolYear: year,
        status: "pending",
        deadline,
      });
      created += 1;
      newlyPendingTeacherIds.push(teacher.id);

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

    if (newlyPendingTeacherIds.length > 0) {
      await notifyUsers(newlyPendingTeacherIds, {
        title: `Confirma tu curso ${year}`,
        body: `Revisa tu centro y módulos antes del ${deadline.toLocaleDateString("es-ES")}.`,
        type: "year_confirmation",
        data: { schoolYear: year },
      });
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
        doesNotTeach: teacherYearConfirmationsTable.doesNotTeach,
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
      res.json({ year: year ?? null, status: "none", doesNotTeach: false });
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
      res.json({ year, status: "none", doesNotTeach: false });
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
      doesNotTeach: confirmation.doesNotTeach,
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
    if (
      confirmation.status !== "pending" &&
      confirmation.status !== "confirmed"
    ) {
      res.status(409).json({
        message: "La confirmación de este curso ya no está disponible",
      });
      return;
    }
    if (confirmation.deadline.getTime() < Date.now()) {
      res.status(409).json({
        message: "El plazo de confirmación ha finalizado",
      });
      return;
    }

    const [center] = await db
      .select()
      .from(centersTable)
      .where(
        and(
          eq(centersTable.id, caller.centerId ?? -1),
          isNull(centersTable.deletedAt),
        ),
      );
    if (!center || parsed.data.centerId !== center.id) {
      res.status(409).json({
        message:
          "Tu centro debe ser asignado por un administrador antes de confirmar",
      });
      return;
    }
    if (center.provinceId !== caller.provinceId) {
      res.status(409).json({
        message:
          "El ámbito de tu cuenta no coincide con el centro; contacta con un administrador",
      });
      return;
    }

    const activeFamily = await getActiveFamily();
    if (!center.families.includes(activeFamily)) {
      res.status(409).json({
        message: "Tu centro no pertenece a la familia profesional activa",
      });
      return;
    }

    const moduleIds = Array.from(new Set(parsed.data.moduleIds));
    const doesNotTeach = parsed.data.doesNotTeach;
    if (
      (doesNotTeach && moduleIds.length > 0) ||
      (!doesNotTeach && moduleIds.length === 0)
    ) {
      res.status(400).json({
        message: doesNotTeach
          ? "No selecciones módulos si declaras que no impartes clase"
          : "Selecciona un módulo o declara que no impartes clase",
      });
      return;
    }
    if (moduleIds.length > 0) {
      const validModules = await db
        .select({ id: modulesTable.id, centerId: modulesTable.centerId })
        .from(modulesTable)
        .where(
          and(
            inArray(modulesTable.id, moduleIds),
            isNull(modulesTable.deletedAt),
            moduleFamilyFilter(activeFamily),
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

    const touchedModuleIds = new Set<number>();
    const confirmedAt = new Date();
    const updated = await db.transaction(async (tx) => {
      // Lock the teacher first (matching the scheduler's lock order), then
      // reread the assigned center under that lock. A concurrent manager
      // transfer must either precede this snapshot or wait until assignments
      // and the confirmation are committed.
      const [lockedUser] = await tx
        .select({
          id: usersTable.id,
          centerId: usersTable.centerId,
          provinceId: usersTable.provinceId,
        })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.id, caller.id),
            eq(usersTable.role, "teacher"),
            eq(usersTable.status, "active"),
            isNull(usersTable.deletedAt),
          ),
        )
        .for("update");
      if (!lockedUser || lockedUser.centerId !== parsed.data.centerId) {
        return undefined;
      }

      const [center] = await tx
        .select()
        .from(centersTable)
        .where(
          and(
            eq(centersTable.id, lockedUser.centerId),
            isNull(centersTable.deletedAt),
          ),
        )
        .for("update");
      if (
        !center ||
        center.provinceId !== lockedUser.provinceId ||
        !center.families.includes(activeFamily)
      ) {
        return undefined;
      }

      const [lockedConfirmation] = await tx
        .select()
        .from(teacherYearConfirmationsTable)
        .where(
          and(
            eq(teacherYearConfirmationsTable.id, confirmation.id),
            eq(teacherYearConfirmationsTable.teacherId, caller.id),
            eq(teacherYearConfirmationsTable.schoolYear, year),
          ),
        )
        .for("update");
      if (
        !lockedConfirmation ||
        (lockedConfirmation.status !== "pending" &&
          lockedConfirmation.status !== "confirmed") ||
        lockedConfirmation.deadline.getTime() < Date.now()
      ) {
        return undefined;
      }

      const assignments = await tx
        .select()
        .from(teachingAssignmentsTable)
        .where(
          and(
            eq(teachingAssignmentsTable.teacherId, caller.id),
            eq(teachingAssignmentsTable.schoolYear, year),
          ),
        );
      const selectedModules = new Set(moduleIds);
      const activeAssignments = assignments.filter((a) => a.deletedAt == null);

      for (const assignment of activeAssignments) {
        if (selectedModules.has(assignment.moduleId)) continue;
        await tx
          .update(teachingAssignmentsTable)
          .set({ deletedAt: confirmedAt })
          .where(eq(teachingAssignmentsTable.id, assignment.id));
        touchedModuleIds.add(assignment.moduleId);
      }

      for (const moduleId of moduleIds) {
        const moduleAssignments = assignments.filter(
          (assignment) => assignment.moduleId === moduleId,
        );
        const activeForModule = moduleAssignments.filter(
          (assignment) => assignment.deletedAt == null,
        );
        if (activeForModule.length > 0) {
          for (const assignment of activeForModule) {
            if (assignment.centerId === center.id) continue;
            await tx
              .update(teachingAssignmentsTable)
              .set({ centerId: center.id, groupId: null })
              .where(eq(teachingAssignmentsTable.id, assignment.id));
            touchedModuleIds.add(moduleId);
          }
          continue;
        }

        const previous = moduleAssignments.find(
          (assignment) => assignment.deletedAt != null,
        );
        if (previous) {
          await tx
            .update(teachingAssignmentsTable)
            .set({
              deletedAt: null,
              centerId: center.id,
              groupId:
                previous.centerId === center.id ? previous.groupId : null,
            })
            .where(eq(teachingAssignmentsTable.id, previous.id));
        } else {
          await tx.insert(teachingAssignmentsTable).values({
            teacherId: caller.id,
            moduleId,
            centerId: center.id,
            schoolYear: year,
          });
        }
        touchedModuleIds.add(moduleId);
      }

      const [result] = await tx
        .update(teacherYearConfirmationsTable)
        .set({
          status: "confirmed",
          confirmedAt,
          centerId: center.id,
          doesNotTeach,
        })
        .where(eq(teacherYearConfirmationsTable.id, confirmation.id))
        .returning();
      if (!result) return undefined;
      return {
        confirmation: result,
        previousAssignments: assignments,
        previousConfirmation: lockedConfirmation,
      };
    });
    if (!updated) {
      res.status(409).json({
        message:
          "La confirmación, el plazo o tu centro han cambiado; vuelve a cargar e inténtalo de nuevo",
      });
      return;
    }

    try {
      for (const moduleId of touchedModuleIds) {
        await syncModuleNextcloudMembership(moduleId);
      }
    } catch (err) {
      await db.transaction(async (tx) => {
        const previousIds = new Set(
          updated.previousAssignments.map((row) => row.id),
        );
        const current = await tx
          .select({ id: teachingAssignmentsTable.id })
          .from(teachingAssignmentsTable)
          .where(
            and(
              eq(teachingAssignmentsTable.teacherId, caller.id),
              eq(teachingAssignmentsTable.schoolYear, year),
            ),
          );
        const insertedIds = current
          .map((row) => row.id)
          .filter((id) => !previousIds.has(id));
        if (insertedIds.length > 0) {
          await tx
            .delete(teachingAssignmentsTable)
            .where(inArray(teachingAssignmentsTable.id, insertedIds));
        }
        for (const assignment of updated.previousAssignments) {
          await tx
            .update(teachingAssignmentsTable)
            .set({
              teacherId: assignment.teacherId,
              moduleId: assignment.moduleId,
              groupId: assignment.groupId,
              centerId: assignment.centerId,
              schoolYear: assignment.schoolYear,
              deletedAt: assignment.deletedAt,
            })
            .where(eq(teachingAssignmentsTable.id, assignment.id));
        }
        await tx
          .update(teacherYearConfirmationsTable)
          .set({
            status: updated.previousConfirmation.status,
            centerId: updated.previousConfirmation.centerId,
            doesNotTeach: updated.previousConfirmation.doesNotTeach,
            deadline: updated.previousConfirmation.deadline,
            confirmedAt: updated.previousConfirmation.confirmedAt,
          })
          .where(
            eq(
              teacherYearConfirmationsTable.id,
              updated.previousConfirmation.id,
            ),
          );
      });
      for (const moduleId of touchedModuleIds) {
        try {
          await syncModuleNextcloudMembership(moduleId);
        } catch (restoreErr) {
          logger.error(
            { err: restoreErr, moduleId },
            "syncModuleNextcloudMembership (confirmation rollback) failed",
          );
        }
      }
      logger.error(
        { err, moduleIds: [...touchedModuleIds] },
        "syncModuleNextcloudMembership (confirm) failed",
      );
      res.status(502).json({
        message:
          "No se pudo confirmar la actualización de permisos en Nextcloud; se restauraron las asignaciones anteriores",
      });
      return;
    }

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
      toTeacherYearConfirmation({
        ...updated.confirmation,
        teacherName: caller.name,
      }),
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
