import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull, inArray } from "drizzle-orm";
import {
  db,
  modulesTable,
  usersTable,
  moduleMembershipsTable,
  wikiModuleCollectionsTable,
  wikiModuleEditorsTable,
} from "@workspace/db";
import {
  GetWikiStatusResponse,
  OpenModuleWikiResponse,
  GetModuleWikiEditorsResponse,
  UpdateModuleWikiEditorsResponse,
  UpdateModuleWikiEditorsBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { getSettings } from "../lib/settings";
import {
  isOutlineConfigured,
  resolveOutlineConfig,
  resolveOutlineUrl,
  ensureModuleWiki,
  syncModuleWikiEditors,
  type ProvisionWikiMember,
} from "../lib/outline";
import { createTicket } from "../lib/oidc";
import { getAppBaseUrl } from "../lib/appUrl";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// --- Status ----------------------------------------------------------------

router.get("/wiki/status", requireAuth, async (_req, res): Promise<void> => {
  const settings = await getSettings();
  res.json(
    GetWikiStatusResponse.parse({
      configured: isOutlineConfigured(settings),
      outlineUrl: resolveOutlineUrl(settings),
    }),
  );
});

// --- Editor authorization --------------------------------------------------

/**
 * Decide whether `caller` may change the editor set for `moduleId`, and which
 * users they are allowed to grant edit access to.
 *
 * - superadmin: may manage every module; candidates are all active users.
 * - module coordinator (a `module_memberships` row with role "coordinator" for
 *   this module): may manage their module; candidates are that module's
 *   collaborating teachers (its members, coordinator included).
 * - everyone else: cannot manage; no candidates (read-only view).
 */
async function resolveEditorManagement(
  caller: { id: number; role: string },
  moduleId: number,
): Promise<{ canManage: boolean; candidateIds: number[] }> {
  if (caller.role === "superadmin") {
    const rows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(eq(usersTable.status, "active"), isNull(usersTable.deletedAt)),
      );
    return { canManage: true, candidateIds: rows.map((r) => r.id) };
  }

  const [coordinator] = await db
    .select({ id: moduleMembershipsTable.id })
    .from(moduleMembershipsTable)
    .where(
      and(
        eq(moduleMembershipsTable.moduleId, moduleId),
        eq(moduleMembershipsTable.userId, caller.id),
        eq(moduleMembershipsTable.role, "coordinator"),
        isNull(moduleMembershipsTable.deletedAt),
      ),
    );
  if (!coordinator) return { canManage: false, candidateIds: [] };

  const members = await db
    .select({ userId: moduleMembershipsTable.userId })
    .from(moduleMembershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, moduleMembershipsTable.userId))
    .where(
      and(
        eq(moduleMembershipsTable.moduleId, moduleId),
        isNull(moduleMembershipsTable.deletedAt),
        eq(usersTable.status, "active"),
        isNull(usersTable.deletedAt),
      ),
    );
  return {
    canManage: true,
    candidateIds: [...new Set(members.map((m) => m.userId))],
  };
}

/** Active (non-deleted) editor user ids for a module. */
async function currentEditorIds(moduleId: number): Promise<number[]> {
  const rows = await db
    .select({ userId: wikiModuleEditorsTable.userId })
    .from(wikiModuleEditorsTable)
    .where(
      and(
        eq(wikiModuleEditorsTable.moduleId, moduleId),
        isNull(wikiModuleEditorsTable.deletedAt),
      ),
    );
  return rows.map((r) => r.userId);
}

/** Resolve candidate users (for the management UI) by id. */
async function loadCandidates(ids: number[]): Promise<
  { id: number; name: string; email: string | null; role: string }[]
> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(and(inArray(usersTable.id, ids), isNull(usersTable.deletedAt)));
  return rows;
}

router.get(
  "/wiki/modules/:moduleId/editors",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const moduleId = Number(req.params["moduleId"]);
    if (!Number.isInteger(moduleId)) {
      res.status(400).json({ message: "Módulo inválido" });
      return;
    }
    const caller = req.user!;

    const { canManage, candidateIds } = await resolveEditorManagement(
      caller,
      moduleId,
    );
    const [editorIds, candidates] = await Promise.all([
      currentEditorIds(moduleId),
      canManage ? loadCandidates(candidateIds) : Promise.resolve([]),
    ]);

    res.json(
      GetModuleWikiEditorsResponse.parse({ canManage, editorIds, candidates }),
    );
  },
);

router.put(
  "/wiki/modules/:moduleId/editors",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const moduleId = Number(req.params["moduleId"]);
    if (!Number.isInteger(moduleId)) {
      res.status(400).json({ message: "Módulo inválido" });
      return;
    }
    const caller = req.user!;

    const parsed = UpdateModuleWikiEditorsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Datos inválidos" });
      return;
    }
    const desired = [...new Set(parsed.data.userIds)];

    const { canManage, candidateIds } = await resolveEditorManagement(
      caller,
      moduleId,
    );
    if (!canManage) {
      res.status(403).json({ message: "Sin permiso para gestionar editores" });
      return;
    }
    // Every requested user must be within the caller's candidate set.
    const candidateSet = new Set(candidateIds);
    if (desired.some((id) => !candidateSet.has(id))) {
      res
        .status(400)
        .json({ message: "Algún usuario no es un editor permitido" });
      return;
    }

    const [module] = await db
      .select()
      .from(modulesTable)
      .where(and(eq(modulesTable.id, moduleId), isNull(modulesTable.deletedAt)));
    if (!module) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }

    // Reconcile the editor set in our DB (soft-delete removals, upsert grants).
    const existing = await currentEditorIds(moduleId);
    const existingSet = new Set(existing);
    const desiredSet = new Set(desired);
    const toRemove = existing.filter((id) => !desiredSet.has(id));
    const toAdd = desired.filter((id) => !existingSet.has(id));

    if (toRemove.length > 0) {
      await db
        .update(wikiModuleEditorsTable)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(wikiModuleEditorsTable.moduleId, moduleId),
            inArray(wikiModuleEditorsTable.userId, toRemove),
          ),
        );
    }
    for (const userId of toAdd) {
      await db
        .insert(wikiModuleEditorsTable)
        .values({ moduleId, userId })
        .onConflictDoUpdate({
          target: [
            wikiModuleEditorsTable.moduleId,
            wikiModuleEditorsTable.userId,
          ],
          set: { deletedAt: null },
        });
    }

    // Reconcile Outline membership to match (best-effort; configuration may be
    // absent in dev — the DB is still the source of truth).
    const settings = await getSettings();
    const config = resolveOutlineConfig(settings);
    if (config) {
      try {
        const mapping = await ensureModuleWiki(config, {
          id: module.id,
          name: module.name,
          code: module.code,
        });
        const editorUsers = await loadCandidates(desired);
        const members: ProvisionWikiMember[] = editorUsers.map((u) => ({
          userId: u.id,
          name: u.name,
          email: u.email,
        }));
        await syncModuleWikiEditors(config, mapping.editorGroupId, members);
      } catch (err) {
        logger.error({ err, moduleId }, "Failed to sync Outline wiki editors");
        res
          .status(502)
          .json({ message: "No se pudieron sincronizar los editores" });
        return;
      }
    }

    const candidates = await loadCandidates(candidateIds);
    res.json(
      UpdateModuleWikiEditorsResponse.parse({
        canManage: true,
        editorIds: desired,
        candidates,
      }),
    );
  },
);

// --- Open (provision + SSO deep link) --------------------------------------
//
// Every authenticated user may open any module's wiki — all documents are
// readable by everyone. Provisioning is idempotent; editing rights are governed
// separately by the editor group.

router.post(
  "/wiki/modules/:moduleId/space",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const moduleId = Number(req.params["moduleId"]);
    if (!Number.isInteger(moduleId)) {
      res.status(400).json({ message: "Módulo inválido" });
      return;
    }
    const caller = req.user!;

    const settings = await getSettings();
    if (!isOutlineConfigured(settings)) {
      res.status(503).json({ message: "La documentación no está configurada" });
      return;
    }
    const config = resolveOutlineConfig(settings)!;
    const outlineUrl = resolveOutlineUrl(settings)!;

    const [module] = await db
      .select()
      .from(modulesTable)
      .where(and(eq(modulesTable.id, moduleId), isNull(modulesTable.deletedAt)));
    if (!module) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }

    try {
      await ensureModuleWiki(config, {
        id: module.id,
        name: module.name,
        code: module.code,
      });
    } catch (err) {
      logger.error({ err, moduleId }, "Failed to provision module wiki");
      res.status(502).json({ message: "No se pudo preparar la documentación" });
      return;
    }

    const ticket = createTicket(caller.id, module.id, "outline");
    const url = `${getAppBaseUrl(req)}/api/oidc/start?ticket=${encodeURIComponent(ticket)}`;
    res.json(OpenModuleWikiResponse.parse({ url, outlineUrl }));
  },
);

export default router;
