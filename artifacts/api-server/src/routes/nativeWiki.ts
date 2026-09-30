import { Readable } from "node:stream";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  AddWikiExternalLinkBody,
  AddWikiAttachmentBody,
  CreateWikiPermissionGroupBody,
  CreateWikiPageBody,
  DeleteWikiAttachmentParams,
  DeleteWikiExternalLinkParams,
  DeleteWikiPageParams,
  DeleteWikiPermissionGroupParams,
  GetModuleWikiEditorsResponse,
  GetWikiPageParams,
  GetWikiPageResponse,
  ListWikiPagesQueryParams,
  ListWikiPagesResponse,
  RequestWikiUploadUrlBody,
  RequestWikiUploadUrlResponse,
  UpdateModuleWikiEditorsBody,
  UpdateModuleWikiEditorsResponse,
  UpdateWikiPermissionGroupBody,
  UpdateWikiPermissionGroupParams,
  UpdateWikiPermissionGroupResponse,
  UpdateWikiPageBody,
  UpdateWikiPageParams,
  UpdateWikiPageResponse,
} from "@workspace/api-zod";
import {
  db,
  modulesTable,
  moduleMembershipsTable,
  usersTable,
  wikiAttachmentsTable,
  wikiExternalLinksTable,
  wikiModulePermissionGroupMembersTable,
  wikiModuleEditorsTable,
  wikiPagesTable,
  wikiPermissionGroupsTable,
  wikiUploadIntentsTable,
} from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import { getAppBaseUrl } from "../lib/appUrl";
import { requireAuth } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;
const OBJECT_PATH_PATTERN = /^\/objects\/uploads\/[a-zA-Z0-9-]{20,80}$/;
type WikiActionPermissions = {
  canUpload: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

const NO_WIKI_PERMISSIONS: WikiActionPermissions = {
  canUpload: false,
  canEdit: false,
  canDelete: false,
};
const ALL_WIKI_PERMISSIONS: WikiActionPermissions = {
  canUpload: true,
  canEdit: true,
  canDelete: true,
};

function parsePositiveId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function sanitizeFileName(value: string): string {
  const name = value.replace(/\\/g, "/").split("/").pop() ?? "";
  return name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 240);
}

function normalizeExternalFileUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeTags(tags: string[]): string[] {
  return [
    ...new Set(
      tags.map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean),
    ),
  ].slice(0, 20);
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (candidate.code === "23505") return true;
  return Boolean(
    candidate.cause &&
    typeof candidate.cause === "object" &&
    (candidate.cause as { code?: unknown }).code === "23505",
  );
}

function mergePermissions(
  target: WikiActionPermissions,
  source: WikiActionPermissions,
): void {
  target.canUpload ||= source.canUpload;
  target.canEdit ||= source.canEdit;
  target.canDelete ||= source.canDelete;
}

async function getModulePermissionsForUser(
  user: { id: number; role: string },
  moduleIds: number[],
): Promise<Map<number, WikiActionPermissions>> {
  const permissions = new Map<number, WikiActionPermissions>();
  for (const moduleId of moduleIds) {
    permissions.set(
      moduleId,
      user.role === "superadmin"
        ? { ...ALL_WIKI_PERMISSIONS }
        : { ...NO_WIKI_PERMISSIONS },
    );
  }
  if (user.role === "superadmin" || moduleIds.length === 0) return permissions;

  const [directGrants, groupGrants] = await Promise.all([
    db
      .select({
        moduleId: wikiModuleEditorsTable.moduleId,
        canUpload: wikiModuleEditorsTable.canUpload,
        canEdit: wikiModuleEditorsTable.canEdit,
        canDelete: wikiModuleEditorsTable.canDelete,
      })
      .from(wikiModuleEditorsTable)
      .where(
        and(
          inArray(wikiModuleEditorsTable.moduleId, moduleIds),
          eq(wikiModuleEditorsTable.userId, user.id),
          isNull(wikiModuleEditorsTable.deletedAt),
        ),
      ),
    db
      .select({
        moduleId: wikiModulePermissionGroupMembersTable.moduleId,
        canUpload: wikiPermissionGroupsTable.canUpload,
        canEdit: wikiPermissionGroupsTable.canEdit,
        canDelete: wikiPermissionGroupsTable.canDelete,
      })
      .from(wikiModulePermissionGroupMembersTable)
      .innerJoin(
        wikiPermissionGroupsTable,
        eq(
          wikiPermissionGroupsTable.id,
          wikiModulePermissionGroupMembersTable.groupId,
        ),
      )
      .where(
        and(
          inArray(wikiModulePermissionGroupMembersTable.moduleId, moduleIds),
          eq(wikiModulePermissionGroupMembersTable.userId, user.id),
          isNull(wikiModulePermissionGroupMembersTable.deletedAt),
          isNull(wikiPermissionGroupsTable.deletedAt),
        ),
      ),
  ]);

  for (const grant of directGrants) {
    const target = permissions.get(grant.moduleId);
    if (target) mergePermissions(target, grant);
  }
  for (const grant of groupGrants) {
    const target = permissions.get(grant.moduleId);
    if (target) mergePermissions(target, grant);
  }
  return permissions;
}

async function getSectionPermissions(
  user: { id: number; role: string },
  moduleId: number | null,
): Promise<WikiActionPermissions> {
  if (moduleId === null) {
    return user.role === "superadmin"
      ? { ...ALL_WIKI_PERMISSIONS }
      : { ...NO_WIKI_PERMISSIONS };
  }
  const permissions = await getModulePermissionsForUser(user, [moduleId]);
  return permissions.get(moduleId) ?? { ...NO_WIKI_PERMISSIONS };
}

async function loadPage(pageId: number, user: { id: number; role: string }) {
  const [page] = await db
    .select({
      id: wikiPagesTable.id,
      moduleId: wikiPagesTable.moduleId,
      parentId: wikiPagesTable.parentId,
      title: wikiPagesTable.title,
      content: wikiPagesTable.content,
      tags: wikiPagesTable.tags,
      createdAt: wikiPagesTable.createdAt,
      updatedAt: wikiPagesTable.updatedAt,
      moduleName: modulesTable.name,
    })
    .from(wikiPagesTable)
    .leftJoin(modulesTable, eq(modulesTable.id, wikiPagesTable.moduleId))
    .where(
      and(
        eq(wikiPagesTable.id, pageId),
        isNull(wikiPagesTable.deletedAt),
        sql`(
          ${wikiPagesTable.moduleId} IS NULL OR
          (${modulesTable.id} IS NOT NULL AND ${modulesTable.deletedAt} IS NULL)
        )`,
      ),
    )
    .limit(1);
  if (!page) return null;

  const attachments = await db
    .select({
      id: wikiAttachmentsTable.id,
      fileName: wikiAttachmentsTable.fileName,
      contentType: wikiAttachmentsTable.contentType,
      size: wikiAttachmentsTable.size,
      indexStatus: wikiAttachmentsTable.indexStatus,
      createdAt: wikiAttachmentsTable.createdAt,
    })
    .from(wikiAttachmentsTable)
    .where(
      and(
        eq(wikiAttachmentsTable.pageId, pageId),
        isNull(wikiAttachmentsTable.deletedAt),
      ),
    )
    .orderBy(asc(wikiAttachmentsTable.createdAt));
  const externalLinks = await db
    .select({
      id: wikiExternalLinksTable.id,
      title: wikiExternalLinksTable.title,
      url: wikiExternalLinksTable.url,
      createdAt: wikiExternalLinksTable.createdAt,
    })
    .from(wikiExternalLinksTable)
    .where(
      and(
        eq(wikiExternalLinksTable.pageId, pageId),
        isNull(wikiExternalLinksTable.deletedAt),
      ),
    )
    .orderBy(asc(wikiExternalLinksTable.createdAt));

  const permissions = await getSectionPermissions(user, page.moduleId);
  return {
    ...page,
    tags: page.tags ?? [],
    attachments,
    externalLinks,
    attachmentCount: attachments.length,
    ...permissions,
  };
}

// All search and read routes require authentication. The full-text query covers
// page text, exact tags, attachment names, external-link names/URLs, and text
// extracted from supported ZIP/Office files by the asynchronous indexer.
router.get(
  "/wiki/pages",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const parsedQuery = ListWikiPagesQueryParams.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({ message: "Filtros de búsqueda no válidos" });
      return;
    }
    const query = parsedQuery.data.q?.trim().slice(0, 200) ?? "";
    const queryTag = query.toLocaleLowerCase();
    const moduleId = parsedQuery.data.moduleId;
    const globalOnly = parsedQuery.data.globalOnly === true;
    const tag = parsedQuery.data.tag?.trim().toLocaleLowerCase();
    const kind = parsedQuery.data.kind ?? "all";

    if (
      (moduleId !== undefined && globalOnly) ||
      !["all", "files", "zip"].includes(kind)
    ) {
      res.status(400).json({ message: "Filtros incompatibles" });
      return;
    }

    const filters = [
      isNull(wikiPagesTable.deletedAt),
      sql`(
        ${wikiPagesTable.moduleId} IS NULL OR
        (${modulesTable.id} IS NOT NULL AND ${modulesTable.deletedAt} IS NULL)
      )`,
    ];
    if (moduleId !== undefined)
      filters.push(eq(wikiPagesTable.moduleId, moduleId));
    if (globalOnly) filters.push(isNull(wikiPagesTable.moduleId));
    if (tag) {
      filters.push(sql`${wikiPagesTable.tags} @> ARRAY[${tag}]::text[]`);
    }
    if (query) {
      filters.push(sql`(
        to_tsvector(
          'simple',
          coalesce(${wikiPagesTable.title}, '') || ' ' ||
          coalesce(${wikiPagesTable.content}, '')
        ) @@ websearch_to_tsquery('simple', ${query})
        OR ${wikiPagesTable.tags} @> ARRAY[${queryTag}]::text[]
        OR EXISTS (
          SELECT 1
          FROM wiki_attachments wa
          WHERE wa.page_id = ${wikiPagesTable.id}
            AND wa.deleted_at IS NULL
            AND to_tsvector(
              'simple',
              regexp_replace(coalesce(wa.file_name, ''), '[^[:alnum:]]+', ' ', 'g')
              || ' ' || coalesce(wa.indexed_text, '')
            ) @@ websearch_to_tsquery('simple', ${query})
        )
        OR EXISTS (
          SELECT 1
          FROM wiki_external_links wel
          WHERE wel.page_id = ${wikiPagesTable.id}
            AND wel.deleted_at IS NULL
            AND to_tsvector(
              'simple',
              coalesce(wel.title, '') || ' ' || coalesce(wel.url, '')
            ) @@ websearch_to_tsquery('simple', ${query})
        )
      )`);
    }
    if (kind === "files") {
      filters.push(sql`(EXISTS (
        SELECT 1 FROM wiki_attachments wa
        WHERE wa.page_id = ${wikiPagesTable.id} AND wa.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM wiki_external_links wel
        WHERE wel.page_id = ${wikiPagesTable.id} AND wel.deleted_at IS NULL
      ))`);
    } else if (kind === "zip") {
      filters.push(sql`EXISTS (
        SELECT 1 FROM wiki_attachments wa
        WHERE wa.page_id = ${wikiPagesTable.id}
          AND wa.deleted_at IS NULL
          AND (
            lower(wa.file_name) LIKE '%.zip' OR
            lower(wa.file_name) LIKE '%.rar'
          )
      )`);
    }

    const rows = await db
      .select({
        id: wikiPagesTable.id,
        moduleId: wikiPagesTable.moduleId,
        moduleName: modulesTable.name,
        title: wikiPagesTable.title,
        tags: wikiPagesTable.tags,
        updatedAt: wikiPagesTable.updatedAt,
      })
      .from(wikiPagesTable)
      .leftJoin(modulesTable, eq(modulesTable.id, wikiPagesTable.moduleId))
      .where(and(...filters))
      .orderBy(desc(wikiPagesTable.updatedAt))
      .limit(250);

    const pageIds = rows.map((row) => row.id);
    const attachmentRows =
      pageIds.length > 0
        ? await db
            .select({
              pageId: wikiAttachmentsTable.pageId,
              fileName: wikiAttachmentsTable.fileName,
            })
            .from(wikiAttachmentsTable)
            .where(
              and(
                inArray(wikiAttachmentsTable.pageId, pageIds),
                isNull(wikiAttachmentsTable.deletedAt),
              ),
            )
        : [];
    const attachmentCounts = new Map<number, number>();
    for (const attachment of attachmentRows) {
      attachmentCounts.set(
        attachment.pageId,
        (attachmentCounts.get(attachment.pageId) ?? 0) + 1,
      );
    }

    const editorModuleIds = [
      ...new Set(
        rows
          .map((row) => row.moduleId)
          .filter((id): id is number => id !== null),
      ),
    ];
    const caller = req.user!;
    const modulePermissions = await getModulePermissionsForUser(
      caller,
      editorModuleIds,
    );

    const items = rows.map((row) => ({
      ...row,
      tags: row.tags ?? [],
      attachmentCount: attachmentCounts.get(row.id) ?? 0,
      ...(row.moduleId === null
        ? caller.role === "superadmin"
          ? ALL_WIKI_PERMISSIONS
          : NO_WIKI_PERMISSIONS
        : (modulePermissions.get(row.moduleId) ?? NO_WIKI_PERMISSIONS)),
    }));
    const canCreate =
      moduleId !== undefined
        ? (await getSectionPermissions(caller, moduleId)).canEdit
        : globalOnly && caller.role === "superadmin";

    res.json(ListWikiPagesResponse.parse({ items, canCreate }));
  },
);

router.get(
  "/wiki/pages/:pageId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const params = GetWikiPageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: "Página no válida" });
      return;
    }
    const page = await loadPage(params.data.pageId, req.user!);
    if (!page) {
      res.status(404).json({ message: "Página no encontrada" });
      return;
    }
    res.json(GetWikiPageResponse.parse(page));
  },
);

router.post(
  "/wiki/pages",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateWikiPageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Datos de página no válidos" });
      return;
    }
    const input = parsed.data;
    if (!(await getSectionPermissions(req.user!, input.moduleId)).canEdit) {
      res
        .status(403)
        .json({ message: "No tienes permiso para crear páginas aquí" });
      return;
    }

    if (input.moduleId !== null) {
      const [module] = await db
        .select({ id: modulesTable.id })
        .from(modulesTable)
        .where(
          and(
            eq(modulesTable.id, input.moduleId),
            isNull(modulesTable.deletedAt),
          ),
        )
        .limit(1);
      if (!module) {
        res.status(404).json({ message: "Módulo no encontrado" });
        return;
      }
    }
    if (input.parentId !== null) {
      const [parent] = await db
        .select({ moduleId: wikiPagesTable.moduleId })
        .from(wikiPagesTable)
        .where(
          and(
            eq(wikiPagesTable.id, input.parentId),
            isNull(wikiPagesTable.deletedAt),
          ),
        )
        .limit(1);
      if (!parent || parent.moduleId !== input.moduleId) {
        res
          .status(400)
          .json({ message: "La página superior no pertenece a esta sección" });
        return;
      }
    }

    const [created] = await db
      .insert(wikiPagesTable)
      .values({
        moduleId: input.moduleId,
        parentId: input.parentId,
        title: input.title.trim(),
        content: input.content,
        tags: normalizeTags(input.tags),
        createdBy: req.user!.id,
        updatedBy: req.user!.id,
      })
      .onConflictDoNothing()
      .returning({ id: wikiPagesTable.id });
    if (!created) {
      res.status(409).json({
        message: "Ya existe una página con ese título en esta ubicación",
      });
      return;
    }
    const page = await loadPage(created.id, req.user!);
    res.status(201).json(GetWikiPageResponse.parse(page));
  },
);

router.patch(
  "/wiki/pages/:pageId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const params = UpdateWikiPageParams.safeParse(req.params);
    const parsed = UpdateWikiPageBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ message: "Datos de página no válidos" });
      return;
    }
    const existing = await loadPage(params.data.pageId, req.user!);
    if (!existing) {
      res.status(404).json({ message: "Página no encontrada" });
      return;
    }
    if (!existing.canEdit) {
      res
        .status(403)
        .json({ message: "No tienes permiso para editar esta página" });
      return;
    }

    const changes = parsed.data;
    if (
      changes.title === undefined &&
      changes.content === undefined &&
      changes.tags === undefined
    ) {
      res.status(400).json({ message: "No se recibieron cambios" });
      return;
    }
    try {
      await db
        .update(wikiPagesTable)
        .set({
          ...(changes.title !== undefined
            ? { title: changes.title.trim() }
            : {}),
          ...(changes.content !== undefined
            ? { content: changes.content }
            : {}),
          ...(changes.tags !== undefined
            ? { tags: normalizeTags(changes.tags) }
            : {}),
          updatedBy: req.user!.id,
          updatedAt: new Date(),
        })
        .where(eq(wikiPagesTable.id, params.data.pageId));
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({
          message: "Ya existe una página con ese título en esta ubicación",
        });
        return;
      }
      throw error;
    }
    const page = await loadPage(params.data.pageId, req.user!);
    res.json(UpdateWikiPageResponse.parse(page));
  },
);

router.delete(
  "/wiki/pages/:pageId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const params = DeleteWikiPageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: "Página no válida" });
      return;
    }
    const page = await loadPage(params.data.pageId, req.user!);
    if (!page) {
      res.status(404).json({ message: "Página no encontrada" });
      return;
    }
    if (!page.canDelete) {
      res
        .status(403)
        .json({ message: "No tienes permiso para eliminar esta página" });
      return;
    }
    const deletedAt = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(wikiPagesTable)
        .set({ deletedAt, updatedAt: deletedAt, updatedBy: req.user!.id })
        .where(eq(wikiPagesTable.id, params.data.pageId));
      await tx
        .update(wikiAttachmentsTable)
        .set({ deletedAt })
        .where(
          and(
            eq(wikiAttachmentsTable.pageId, params.data.pageId),
            isNull(wikiAttachmentsTable.deletedAt),
          ),
        );
    });
    res.sendStatus(204);
  },
);

router.post(
  "/wiki/uploads/request-url",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = RequestWikiUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Datos del archivo no válidos" });
      return;
    }
    const page = await loadPage(parsed.data.pageId, req.user!);
    if (!page) {
      res.status(404).json({ message: "Página no encontrada" });
      return;
    }
    if (!page.canUpload) {
      res
        .status(403)
        .json({ message: "No tienes permiso para subir archivos aquí" });
      return;
    }
    const fileName = sanitizeFileName(parsed.data.fileName);
    if (
      !fileName ||
      !Number.isSafeInteger(parsed.data.size) ||
      parsed.data.size < 1 ||
      parsed.data.size > MAX_UPLOAD_BYTES
    ) {
      res
        .status(400)
        .json({ message: "El nombre o tamaño del archivo no es válido" });
      return;
    }

    try {
      const uploadURL = new URL(
        await objectStorage.getObjectEntityUploadURL({
          maxBytes: parsed.data.size,
          expectedBytes: parsed.data.size,
        }),
        getAppBaseUrl(req),
      ).toString();
      const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
      if (!OBJECT_PATH_PATTERN.test(objectPath)) {
        req.log.error(
          { objectPath },
          "Storage produced an unexpected wiki upload path",
        );
        res.status(500).json({ message: "No se pudo preparar la subida" });
        return;
      }

      const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_MS);
      await db.insert(wikiUploadIntentsTable).values({
        objectPath,
        pageId: parsed.data.pageId,
        userId: req.user!.id,
        fileName,
        contentType: parsed.data.contentType,
        size: parsed.data.size,
        expiresAt,
      });
      res.json(
        RequestWikiUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          expiresAt,
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Could not create wiki upload URL");
      res.status(500).json({ message: "No se pudo preparar la subida" });
    }
  },
);

router.post(
  "/wiki/pages/:pageId/attachments",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const params = GetWikiPageParams.safeParse(req.params);
    const parsed = AddWikiAttachmentBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ message: "Datos del archivo no válidos" });
      return;
    }
    const page = await loadPage(params.data.pageId, req.user!);
    if (!page) {
      res.status(404).json({ message: "Página no encontrada" });
      return;
    }
    if (!page.canUpload) {
      res
        .status(403)
        .json({ message: "No tienes permiso para adjuntar archivos" });
      return;
    }

    const fileName = sanitizeFileName(parsed.data.fileName);
    const objectPath = parsed.data.objectPath;
    if (
      !fileName ||
      !OBJECT_PATH_PATTERN.test(objectPath) ||
      parsed.data.size > MAX_UPLOAD_BYTES
    ) {
      res.status(400).json({ message: "Ruta o tamaño del archivo no válidos" });
      return;
    }

    const [intent] = await db
      .select()
      .from(wikiUploadIntentsTable)
      .where(
        and(
          eq(wikiUploadIntentsTable.objectPath, objectPath),
          eq(wikiUploadIntentsTable.pageId, params.data.pageId),
          eq(wikiUploadIntentsTable.userId, req.user!.id),
          isNull(wikiUploadIntentsTable.consumedAt),
          gte(wikiUploadIntentsTable.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (
      !intent ||
      intent.fileName !== fileName ||
      intent.size !== parsed.data.size ||
      intent.contentType !== parsed.data.contentType
    ) {
      res.status(400).json({
        message: "La subida no pertenece a esta sesión o ha caducado",
      });
      return;
    }

    try {
      const storedObject = await objectStorage.getObjectEntityFile(objectPath);
      const fileResponse = await objectStorage.downloadObject(storedObject, 0);
      const actualSize = Number(
        fileResponse.headers.get("content-length") ?? 0,
      );
      await fileResponse.body?.cancel();
      if (
        actualSize > MAX_UPLOAD_BYTES ||
        (actualSize > 0 && actualSize !== intent.size)
      ) {
        res
          .status(400)
          .json({ message: "El tamaño real del archivo no coincide" });
        return;
      }

      await objectStorage.trySetObjectEntityAclPolicy(objectPath, {
        owner: String(req.user!.id),
        visibility: "private",
      });
      const attachment = await db.transaction(async (tx) => {
        const [consumed] = await tx
          .update(wikiUploadIntentsTable)
          .set({ consumedAt: new Date() })
          .where(
            and(
              eq(wikiUploadIntentsTable.id, intent.id),
              isNull(wikiUploadIntentsTable.consumedAt),
              gte(wikiUploadIntentsTable.expiresAt, new Date()),
            ),
          )
          .returning({ id: wikiUploadIntentsTable.id });
        if (!consumed) return null;

        const [created] = await tx
          .insert(wikiAttachmentsTable)
          .values({
            pageId: params.data.pageId,
            fileName,
            objectPath,
            contentType: parsed.data.contentType,
            size: intent.size,
            uploadedBy: req.user!.id,
          })
          .returning();
        return created;
      });
      if (!attachment) {
        res.status(400).json({ message: "La subida ya se ha utilizado" });
        return;
      }

      const updatedPage = await loadPage(params.data.pageId, req.user!);
      res.status(201).json(GetWikiPageResponse.parse(updatedPage));
    } catch (error) {
      req.log.warn(
        { err: error, pageId: params.data.pageId },
        "Could not attach wiki file",
      );
      res
        .status(400)
        .json({ message: "No se pudo comprobar el archivo subido" });
    }
  },
);

router.post(
  "/wiki/pages/:pageId/external-links",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const params = GetWikiPageParams.safeParse(req.params);
    const parsed = AddWikiExternalLinkBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ message: "Datos del enlace no válidos" });
      return;
    }

    const page = await loadPage(params.data.pageId, req.user!);
    if (!page) {
      res.status(404).json({ message: "Página no encontrada" });
      return;
    }
    if (!page.canUpload) {
      res
        .status(403)
        .json({ message: "No tienes permiso para añadir enlaces" });
      return;
    }

    const title = parsed.data.title.trim();
    const url = normalizeExternalFileUrl(parsed.data.url);
    if (!title || title.length > 240 || !url) {
      res.status(400).json({
        message: "Indica un nombre y una dirección HTTP o HTTPS válida",
      });
      return;
    }

    await db.insert(wikiExternalLinksTable).values({
      pageId: params.data.pageId,
      title,
      url,
      createdBy: req.user!.id,
    });
    const updatedPage = await loadPage(params.data.pageId, req.user!);
    res.status(201).json(GetWikiPageResponse.parse(updatedPage));
  },
);

router.delete(
  "/wiki/external-links/:externalLinkId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const params = DeleteWikiExternalLinkParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: "Enlace no válido" });
      return;
    }
    const [externalLink] = await db
      .select({
        id: wikiExternalLinksTable.id,
        pageId: wikiExternalLinksTable.pageId,
      })
      .from(wikiExternalLinksTable)
      .where(
        and(
          eq(wikiExternalLinksTable.id, params.data.externalLinkId),
          isNull(wikiExternalLinksTable.deletedAt),
        ),
      )
      .limit(1);
    if (!externalLink) {
      res.status(404).json({ message: "Enlace no encontrado" });
      return;
    }
    const page = await loadPage(externalLink.pageId, req.user!);
    if (!page || !page.canDelete) {
      res
        .status(403)
        .json({ message: "No tienes permiso para retirar este enlace" });
      return;
    }
    await db
      .update(wikiExternalLinksTable)
      .set({ deletedAt: new Date() })
      .where(eq(wikiExternalLinksTable.id, externalLink.id));
    res.sendStatus(204);
  },
);

router.delete(
  "/wiki/attachments/:attachmentId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const params = DeleteWikiAttachmentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: "Archivo no válido" });
      return;
    }
    const [attachment] = await db
      .select({
        id: wikiAttachmentsTable.id,
        pageId: wikiAttachmentsTable.pageId,
      })
      .from(wikiAttachmentsTable)
      .where(
        and(
          eq(wikiAttachmentsTable.id, params.data.attachmentId),
          isNull(wikiAttachmentsTable.deletedAt),
        ),
      )
      .limit(1);
    if (!attachment) {
      res.status(404).json({ message: "Archivo no encontrado" });
      return;
    }
    const page = await loadPage(attachment.pageId, req.user!);
    if (!page || !page.canDelete) {
      res
        .status(403)
        .json({ message: "No tienes permiso para retirar este archivo" });
      return;
    }
    await db
      .update(wikiAttachmentsTable)
      .set({ deletedAt: new Date() })
      .where(eq(wikiAttachmentsTable.id, attachment.id));
    res.sendStatus(204);
  },
);

router.get(
  "/wiki/attachments/:attachmentId/download",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const params = DeleteWikiAttachmentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: "Archivo no válido" });
      return;
    }
    const [attachment] = await db
      .select({
        id: wikiAttachmentsTable.id,
        pageId: wikiAttachmentsTable.pageId,
        fileName: wikiAttachmentsTable.fileName,
        objectPath: wikiAttachmentsTable.objectPath,
      })
      .from(wikiAttachmentsTable)
      .innerJoin(
        wikiPagesTable,
        eq(wikiPagesTable.id, wikiAttachmentsTable.pageId),
      )
      .leftJoin(modulesTable, eq(modulesTable.id, wikiPagesTable.moduleId))
      .where(
        and(
          eq(wikiAttachmentsTable.id, params.data.attachmentId),
          isNull(wikiAttachmentsTable.deletedAt),
          isNull(wikiPagesTable.deletedAt),
          sql`(
            ${wikiPagesTable.moduleId} IS NULL OR
            (${modulesTable.id} IS NOT NULL AND ${modulesTable.deletedAt} IS NULL)
          )`,
        ),
      )
      .limit(1);
    if (!attachment) {
      res.status(404).json({ message: "Archivo no encontrado" });
      return;
    }
    if (!(await loadPage(attachment.pageId, req.user!))) {
      res.status(404).json({ message: "Archivo no encontrado" });
      return;
    }

    try {
      const storedObject = await objectStorage.getObjectEntityFile(
        attachment.objectPath,
      );
      const download = await objectStorage.downloadObject(storedObject, 0);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      );
      const length = download.headers.get("content-length");
      if (length) res.setHeader("Content-Length", length);
      if (download.body) {
        Readable.fromWeb(
          download.body as import("node:stream/web").ReadableStream,
        ).pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error(
        { err: error, attachmentId: attachment.id },
        "Wiki attachment download failed",
      );
      res.status(404).json({ message: "Archivo no encontrado" });
    }
  },
);

// Editor grants are still managed in Coordina ADG. They now authorize edits in
// this native wiki and no longer provision or synchronize an external service.
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
    return { canManage: true, candidateIds: rows.map((row) => row.id) };
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
    )
    .limit(1);
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
    candidateIds: [...new Set(members.map((member) => member.userId))],
  };
}

async function loadCandidates(ids: number[]) {
  if (ids.length === 0) return [];
  return db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(and(inArray(usersTable.id, ids), isNull(usersTable.deletedAt)));
}

function permissionGroupResponse(group: {
  id: number;
  name: string;
  canUpload: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  return {
    id: group.id,
    name: group.name,
    permissions: {
      canUpload: group.canUpload,
      canEdit: group.canEdit,
      canDelete: group.canDelete,
    },
  };
}

async function loadModuleEditorSettings(
  moduleId: number,
  candidateIds: number[],
  canManage: boolean,
  canManageGroups: boolean,
) {
  if (!canManage) {
    return {
      canManage: false,
      canManageGroups: false,
      candidates: [],
      groups: [],
    };
  }
  const [users, directRows, groupRows, rawGroups] = await Promise.all([
    loadCandidates(candidateIds),
    db
      .select({
        userId: wikiModuleEditorsTable.userId,
        canUpload: wikiModuleEditorsTable.canUpload,
        canEdit: wikiModuleEditorsTable.canEdit,
        canDelete: wikiModuleEditorsTable.canDelete,
      })
      .from(wikiModuleEditorsTable)
      .where(
        and(
          eq(wikiModuleEditorsTable.moduleId, moduleId),
          isNull(wikiModuleEditorsTable.deletedAt),
        ),
      ),
    db
      .select({
        userId: wikiModulePermissionGroupMembersTable.userId,
        groupId: wikiModulePermissionGroupMembersTable.groupId,
      })
      .from(wikiModulePermissionGroupMembersTable)
      .innerJoin(
        wikiPermissionGroupsTable,
        eq(
          wikiPermissionGroupsTable.id,
          wikiModulePermissionGroupMembersTable.groupId,
        ),
      )
      .where(
        and(
          eq(wikiModulePermissionGroupMembersTable.moduleId, moduleId),
          isNull(wikiModulePermissionGroupMembersTable.deletedAt),
          isNull(wikiPermissionGroupsTable.deletedAt),
        ),
      ),
    db
      .select({
        id: wikiPermissionGroupsTable.id,
        name: wikiPermissionGroupsTable.name,
        canUpload: wikiPermissionGroupsTable.canUpload,
        canEdit: wikiPermissionGroupsTable.canEdit,
        canDelete: wikiPermissionGroupsTable.canDelete,
      })
      .from(wikiPermissionGroupsTable)
      .where(isNull(wikiPermissionGroupsTable.deletedAt))
      .orderBy(asc(wikiPermissionGroupsTable.name)),
  ]);

  const candidateSet = new Set(candidateIds);
  const directByUser = new Map<number, WikiActionPermissions>();
  for (const row of directRows) {
    if (candidateSet.has(row.userId)) {
      directByUser.set(row.userId, {
        canUpload: row.canUpload,
        canEdit: row.canEdit,
        canDelete: row.canDelete,
      });
    }
  }
  const groupsByUser = new Map<number, number[]>();
  for (const row of groupRows) {
    if (!candidateSet.has(row.userId)) continue;
    const assigned = groupsByUser.get(row.userId) ?? [];
    assigned.push(row.groupId);
    groupsByUser.set(row.userId, assigned);
  }

  return {
    canManage,
    canManageGroups,
    candidates: users.map((user) => ({
      ...user,
      directPermissions: directByUser.get(user.id) ?? {
        ...NO_WIKI_PERMISSIONS,
      },
      groupIds: groupsByUser.get(user.id) ?? [],
    })),
    groups: rawGroups.map(permissionGroupResponse),
  };
}

router.get(
  "/wiki/modules/:moduleId/editors",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const moduleId = parsePositiveId(req.params["moduleId"]);
    if (moduleId === null) {
      res.status(400).json({ message: "Módulo inválido" });
      return;
    }
    const [module] = await db
      .select({ id: modulesTable.id })
      .from(modulesTable)
      .where(and(eq(modulesTable.id, moduleId), isNull(modulesTable.deletedAt)))
      .limit(1);
    if (!module) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }
    const { canManage, candidateIds } = await resolveEditorManagement(
      req.user!,
      moduleId,
    );
    const settings = await loadModuleEditorSettings(
      moduleId,
      candidateIds,
      canManage,
      req.user!.role === "superadmin",
    );
    res.json(GetModuleWikiEditorsResponse.parse(settings));
  },
);

router.put(
  "/wiki/modules/:moduleId/editors",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const moduleId = parsePositiveId(req.params["moduleId"]);
    const parsed = UpdateModuleWikiEditorsBody.safeParse(req.body);
    if (moduleId === null || !parsed.success) {
      res.status(400).json({ message: "Datos de editores no válidos" });
      return;
    }
    const [module] = await db
      .select({ id: modulesTable.id })
      .from(modulesTable)
      .where(and(eq(modulesTable.id, moduleId), isNull(modulesTable.deletedAt)))
      .limit(1);
    if (!module) {
      res.status(404).json({ message: "Módulo no encontrado" });
      return;
    }
    const { canManage, candidateIds } = await resolveEditorManagement(
      req.user!,
      moduleId,
    );
    if (!canManage) {
      res.status(403).json({ message: "Sin permiso para gestionar editores" });
      return;
    }
    const candidateSet = new Set(candidateIds);
    const requestedUsers = parsed.data.users;
    const requestedIds = requestedUsers.map((entry) => entry.userId);
    const requestedSet = new Set(requestedIds);
    if (
      new Set(requestedIds).size !== requestedIds.length ||
      requestedUsers.some((entry) => !candidateSet.has(entry.userId)) ||
      candidateIds.some((candidateId) => !requestedSet.has(candidateId))
    ) {
      res.status(400).json({
        message:
          "La lista de usuarios ha cambiado. Recarga los permisos e inténtalo de nuevo.",
      });
      return;
    }
    const requestedGroupIds = [
      ...new Set(requestedUsers.flatMap((entry) => entry.groupIds)),
    ];
    const activeGroups =
      requestedGroupIds.length > 0
        ? await db
            .select({ id: wikiPermissionGroupsTable.id })
            .from(wikiPermissionGroupsTable)
            .where(
              and(
                inArray(wikiPermissionGroupsTable.id, requestedGroupIds),
                isNull(wikiPermissionGroupsTable.deletedAt),
              ),
            )
        : [];
    const activeGroupIds = new Set(activeGroups.map((group) => group.id));
    if (requestedGroupIds.some((groupId) => !activeGroupIds.has(groupId))) {
      res.status(400).json({ message: "Algún grupo de permisos no existe" });
      return;
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      const existingDirectRows = await tx
        .select({ userId: wikiModuleEditorsTable.userId })
        .from(wikiModuleEditorsTable)
        .where(
          and(
            eq(wikiModuleEditorsTable.moduleId, moduleId),
            isNull(wikiModuleEditorsTable.deletedAt),
          ),
        );
      const existingMembershipRows = await tx
        .select({
          userId: wikiModulePermissionGroupMembersTable.userId,
          groupId: wikiModulePermissionGroupMembersTable.groupId,
        })
        .from(wikiModulePermissionGroupMembersTable)
        .where(
          and(
            eq(wikiModulePermissionGroupMembersTable.moduleId, moduleId),
            isNull(wikiModulePermissionGroupMembersTable.deletedAt),
          ),
        );

      // A coordinator's candidate set can shrink when a teacher leaves a
      // module. Revoke such stale direct grants and group memberships on save.
      const staleDirectIds = existingDirectRows
        .map((row) => row.userId)
        .filter((userId) => !candidateSet.has(userId));
      if (staleDirectIds.length > 0) {
        await tx
          .update(wikiModuleEditorsTable)
          .set({ deletedAt: now })
          .where(
            and(
              eq(wikiModuleEditorsTable.moduleId, moduleId),
              inArray(wikiModuleEditorsTable.userId, staleDirectIds),
              isNull(wikiModuleEditorsTable.deletedAt),
            ),
          );
      }
      const staleMemberIds = [
        ...new Set(
          existingMembershipRows
            .map((row) => row.userId)
            .filter((userId) => !candidateSet.has(userId)),
        ),
      ];
      if (staleMemberIds.length > 0) {
        await tx
          .update(wikiModulePermissionGroupMembersTable)
          .set({ deletedAt: now })
          .where(
            and(
              eq(wikiModulePermissionGroupMembersTable.moduleId, moduleId),
              inArray(
                wikiModulePermissionGroupMembersTable.userId,
                staleMemberIds,
              ),
              isNull(wikiModulePermissionGroupMembersTable.deletedAt),
            ),
          );
      }

      for (const entry of requestedUsers) {
        const { userId, directPermissions } = entry;
        if (
          directPermissions.canUpload ||
          directPermissions.canEdit ||
          directPermissions.canDelete
        ) {
          await tx
            .insert(wikiModuleEditorsTable)
            .values({
              moduleId,
              userId,
              canUpload: directPermissions.canUpload,
              canEdit: directPermissions.canEdit,
              canDelete: directPermissions.canDelete,
              deletedAt: null,
            })
            .onConflictDoUpdate({
              target: [
                wikiModuleEditorsTable.moduleId,
                wikiModuleEditorsTable.userId,
              ],
              set: {
                canUpload: directPermissions.canUpload,
                canEdit: directPermissions.canEdit,
                canDelete: directPermissions.canDelete,
                deletedAt: null,
              },
            });
        } else {
          await tx
            .update(wikiModuleEditorsTable)
            .set({ deletedAt: now })
            .where(
              and(
                eq(wikiModuleEditorsTable.moduleId, moduleId),
                eq(wikiModuleEditorsTable.userId, userId),
                isNull(wikiModuleEditorsTable.deletedAt),
              ),
            );
        }

        const desiredGroups = new Set(entry.groupIds);
        const currentGroups = new Set(
          existingMembershipRows
            .filter((row) => row.userId === userId)
            .map((row) => row.groupId),
        );
        const toRemove = [...currentGroups].filter(
          (groupId) => !desiredGroups.has(groupId),
        );
        if (toRemove.length > 0) {
          await tx
            .update(wikiModulePermissionGroupMembersTable)
            .set({ deletedAt: now })
            .where(
              and(
                eq(wikiModulePermissionGroupMembersTable.moduleId, moduleId),
                eq(wikiModulePermissionGroupMembersTable.userId, userId),
                inArray(
                  wikiModulePermissionGroupMembersTable.groupId,
                  toRemove,
                ),
                isNull(wikiModulePermissionGroupMembersTable.deletedAt),
              ),
            );
        }
        for (const groupId of desiredGroups) {
          if (currentGroups.has(groupId)) continue;
          await tx
            .insert(wikiModulePermissionGroupMembersTable)
            .values({
              moduleId,
              userId,
              groupId,
              createdBy: req.user!.id,
              deletedAt: null,
            })
            .onConflictDoUpdate({
              target: [
                wikiModulePermissionGroupMembersTable.moduleId,
                wikiModulePermissionGroupMembersTable.groupId,
                wikiModulePermissionGroupMembersTable.userId,
              ],
              set: { deletedAt: null, createdBy: req.user!.id },
            });
        }
      }
    });
    const settings = await loadModuleEditorSettings(
      moduleId,
      candidateIds,
      true,
      req.user!.role === "superadmin",
    );
    res.json(UpdateModuleWikiEditorsResponse.parse(settings));
  },
);

router.post(
  "/wiki/permission-groups",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (req.user!.role !== "superadmin") {
      res
        .status(403)
        .json({ message: "Solo un superadministrador puede gestionar grupos" });
      return;
    }
    const parsed = CreateWikiPermissionGroupBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Datos de grupo no válidos" });
      return;
    }
    const name = parsed.data.name.trim();
    const permissions = parsed.data.permissions;
    if (
      name.length < 2 ||
      !(permissions.canUpload || permissions.canEdit || permissions.canDelete)
    ) {
      res
        .status(400)
        .json({ message: "El grupo debe tener nombre y al menos un permiso" });
      return;
    }
    try {
      const [created] = await db
        .insert(wikiPermissionGroupsTable)
        .values({
          name,
          ...permissions,
          createdBy: req.user!.id,
        })
        .returning({
          id: wikiPermissionGroupsTable.id,
          name: wikiPermissionGroupsTable.name,
          canUpload: wikiPermissionGroupsTable.canUpload,
          canEdit: wikiPermissionGroupsTable.canEdit,
          canDelete: wikiPermissionGroupsTable.canDelete,
        });
      res
        .status(201)
        .json(
          UpdateWikiPermissionGroupResponse.parse(
            permissionGroupResponse(created),
          ),
        );
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ message: "Ya existe un grupo con ese nombre" });
        return;
      }
      throw error;
    }
  },
);

router.put(
  "/wiki/permission-groups/:groupId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (req.user!.role !== "superadmin") {
      res
        .status(403)
        .json({ message: "Solo un superadministrador puede gestionar grupos" });
      return;
    }
    const params = UpdateWikiPermissionGroupParams.safeParse(req.params);
    const parsed = UpdateWikiPermissionGroupBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ message: "Datos de grupo no válidos" });
      return;
    }
    const name = parsed.data.name.trim();
    const permissions = parsed.data.permissions;
    if (
      name.length < 2 ||
      !(permissions.canUpload || permissions.canEdit || permissions.canDelete)
    ) {
      res
        .status(400)
        .json({ message: "El grupo debe tener nombre y al menos un permiso" });
      return;
    }
    try {
      const [updated] = await db
        .update(wikiPermissionGroupsTable)
        .set({ name, ...permissions, updatedAt: new Date() })
        .where(
          and(
            eq(wikiPermissionGroupsTable.id, params.data.groupId),
            isNull(wikiPermissionGroupsTable.deletedAt),
          ),
        )
        .returning({
          id: wikiPermissionGroupsTable.id,
          name: wikiPermissionGroupsTable.name,
          canUpload: wikiPermissionGroupsTable.canUpload,
          canEdit: wikiPermissionGroupsTable.canEdit,
          canDelete: wikiPermissionGroupsTable.canDelete,
        });
      if (!updated) {
        res.status(404).json({ message: "Grupo no encontrado" });
        return;
      }
      res.json(
        UpdateWikiPermissionGroupResponse.parse(
          permissionGroupResponse(updated),
        ),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ message: "Ya existe un grupo con ese nombre" });
        return;
      }
      throw error;
    }
  },
);

router.delete(
  "/wiki/permission-groups/:groupId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (req.user!.role !== "superadmin") {
      res
        .status(403)
        .json({ message: "Solo un superadministrador puede gestionar grupos" });
      return;
    }
    const params = DeleteWikiPermissionGroupParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: "Grupo no válido" });
      return;
    }
    const deletedAt = new Date();
    const deleted = await db.transaction(async (tx) => {
      const [group] = await tx
        .update(wikiPermissionGroupsTable)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(
          and(
            eq(wikiPermissionGroupsTable.id, params.data.groupId),
            isNull(wikiPermissionGroupsTable.deletedAt),
          ),
        )
        .returning({ id: wikiPermissionGroupsTable.id });
      if (!group) return null;
      await tx
        .update(wikiModulePermissionGroupMembersTable)
        .set({ deletedAt })
        .where(
          and(
            eq(wikiModulePermissionGroupMembersTable.groupId, group.id),
            isNull(wikiModulePermissionGroupMembersTable.deletedAt),
          ),
        );
      return group;
    });
    if (!deleted) {
      res.status(404).json({ message: "Grupo no encontrado" });
      return;
    }
    res.sendStatus(204);
  },
);

export default router;
