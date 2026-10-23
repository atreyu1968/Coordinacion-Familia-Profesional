import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  modulesTable,
  centersTable,
  teachingAssignmentsTable,
} from "@workspace/db";
import {
  GetCollabStatusResponse,
  OpenModuleSpaceResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { getActiveAcademicYear, getSettings } from "../lib/settings";
import {
  isNextcloudConfigured,
  resolveNextcloudConfig,
  resolveNextcloudUrl,
  decideModuleAccess,
  moduleFolderName,
  provisionModuleSpace,
} from "../lib/nextcloud";
import { getModuleNextcloudMembers } from "../lib/moduleNextcloudSync";
import { createTicket } from "../lib/oidc";
import { getAppBaseUrl } from "../lib/appUrl";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/collab/status", requireAuth, async (_req, res): Promise<void> => {
  const settings = await getSettings();
  res.json(
    GetCollabStatusResponse.parse({
      configured: isNextcloudConfigured(settings),
      nextcloudUrl: resolveNextcloudUrl(settings),
    }),
  );
});

router.post(
  "/collab/modules/:moduleId/space",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const moduleId = Number(req.params["moduleId"]);
    if (!Number.isInteger(moduleId)) {
      res.status(400).json({ message: "Módulo inválido" });
      return;
    }
    const caller = req.user!;

    const settings = await getSettings();
    if (!isNextcloudConfigured(settings)) {
      res.status(503).json({ message: "Espacio colaborativo no configurado" });
      return;
    }
    const config = resolveNextcloudConfig(settings)!;
    const nextcloudUrl = resolveNextcloudUrl(settings)!;

    const [module] = await db
      .select()
      .from(modulesTable)
      .where(and(eq(modulesTable.id, moduleId), isNull(modulesTable.deletedAt)));
    if (!module) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }

    // Province that owns the module (null for global/shared modules).
    let moduleProvinceId: number | null = null;
    if (module.centerId != null) {
      const [center] = await db
        .select({ provinceId: centersTable.provinceId })
        .from(centersTable)
        .where(eq(centersTable.id, module.centerId));
      moduleProvinceId = center?.provinceId ?? null;
    }

    const activeYear = await getActiveAcademicYear();
    const [assignment] = await db
      .select({ id: teachingAssignmentsTable.id })
      .from(teachingAssignmentsTable)
      .where(
        and(
          eq(teachingAssignmentsTable.moduleId, moduleId),
          eq(teachingAssignmentsTable.teacherId, caller.id),
          isNull(teachingAssignmentsTable.deletedAt),
          ...(activeYear
            ? [eq(teachingAssignmentsTable.schoolYear, activeYear)]
            : []),
        ),
      );

    const allowed = decideModuleAccess({
      role: caller.role,
      userCenterId: caller.centerId,
      userProvinceId: caller.provinceId,
      moduleCenterId: module.centerId,
      moduleProvinceId,
      isAssigned: Boolean(assignment),
    });
    if (!allowed) {
      res.status(403).json({ message: "Sin acceso a este módulo" });
      return;
    }

    const mount = moduleFolderName({
      moduleId: module.id,
      name: module.name,
      code: module.code,
    });
    try {
      const members = await getModuleNextcloudMembers(module, moduleProvinceId, {
        includeUserId: caller.id,
      });
      await provisionModuleSpace(config, {
        moduleId: module.id,
        mount,
        members,
      });
    } catch (err) {
      logger.error({ err, moduleId }, "Failed to provision module space");
      res
        .status(502)
        .json({ message: "No se pudo preparar el espacio colaborativo" });
      return;
    }

    const ticket = createTicket(caller.id, module.id);
    const url = `${getAppBaseUrl(req)}/api/oidc/start?ticket=${encodeURIComponent(ticket)}`;
    res.json(OpenModuleSpaceResponse.parse({ url, nextcloudUrl }));
  },
);

export default router;
