import { Readable } from "node:stream";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  AddWikiAttachmentBody,
  CreateWikiPageBody,
  DeleteWikiAttachmentParams,
  DeleteWikiPageParams,
  GetModuleWikiEditorsResponse,
  GetWikiPageParams,
  GetWikiPageResponse,
  ListWikiPagesQueryParams,
  ListWikiPagesResponse,
  RequestWikiUploadUrlBody,
  RequestWikiUploadUrlResponse,
  UpdateModuleWikiEditorsBody,
  UpdateModuleWikiEditorsResponse,
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
  wikiModuleEditorsTable,
  wikiPagesTable,
  wikiUploadIntentsTable,
} from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;
const OBJECT_PATH_PATTERN = /^\/objects\/uploads\/[a-zA-Z0-9-]{20,80}$/;

function parsePositiveId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function sanitizeFileName(value: string): string {
  const name = value.replace(/\\/g, "/").split("/").pop() ?? "";
  return name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 240);
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean))].slice(0, 20);
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

async function canEditSection(
  user: { id: number; role: string },
  moduleId: number | null,
): Promise<boolean> {
  if (moduleId === null) return user.role === "superadmin";
  const [grant] = await db
    .select({ id: wikiModuleEditorsTable.id })
    .from(wikiModuleEditorsTable)
    .where(
      and(
        eq(wikiModuleEditorsTable.moduleId, moduleId),
        eq(wikiModuleEditorsTable.userId, user.id),
        isNull(wikiModuleEditorsTable.deletedAt),
      ),
    )
    .limit(1);
  return Boolean(grant);
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

  const canEdit = await canEditSection(user, page.moduleId);
  return { ...page, tags: page.tags ?? [], attachments, attachmentCount: attachments.length, canEdit };
}

// All search and read routes require authentication. The full-text query covers
// page text, exact tags, attachment names, and text extracted from ZIP/Office
// files by the asynchronous indexer.
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

    if ((moduleId !== undefined && globalOnly) || !["all", "files", "zip"].includes(kind)) {
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
    if (moduleId !== undefined) filters.push(eq(wikiPagesTable.moduleId, moduleId));
    if (globalOnly) filters.push(isNull(wikiPagesTable.moduleId));
    if (tag) {
      filters.push(
        sql`${wikiPagesTable.tags} @> ARRAY[${tag}]::text[]`,
      );
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
              coalesce(wa.file_name, '') || ' ' || coalesce(wa.indexed_text, '')
            ) @@ websearch_to_tsquery('simple', ${query})
        )
      )`);
    }
    if (kind === "files") {
      filters.push(sql`EXISTS (
        SELECT 1 FROM wiki_attachments wa
        WHERE wa.page_id = ${wikiPagesTable.id} AND wa.deleted_at IS NULL
      )`);
    } else if (kind === "zip") {
      filters.push(sql`EXISTS (
        SELECT 1 FROM wiki_attachments wa
        WHERE wa.page_id = ${wikiPagesTable.id}
          AND wa.deleted_at IS NULL
          AND lower(wa.file_name) LIKE '%.zip'
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
    const editorGrants =
      editorModuleIds.length > 0
        ? await db
            .select({ moduleId: wikiModuleEditorsTable.moduleId })
            .from(wikiModuleEditorsTable)
            .where(
              and(
                inArray(wikiModuleEditorsTable.moduleId, editorModuleIds),
                eq(wikiModuleEditorsTable.userId, caller.id),
                isNull(wikiModuleEditorsTable.deletedAt),
              ),
            )
        : [];
    const editableModuleIds = new Set(editorGrants.map((grant) => grant.moduleId));

    const items = rows.map((row) => ({
      ...row,
      tags: row.tags ?? [],
      attachmentCount: attachmentCounts.get(row.id) ?? 0,
      canEdit:
        row.moduleId === null
          ? caller.role === "superadmin"
          : editableModuleIds.has(row.moduleId),
    }));
    const canCreate =
      moduleId !== undefined
        ? await canEditSection(caller, moduleId)
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
    if (!(await canEditSection(req.user!, input.moduleId))) {
      res.status(403).json({ message: "No tienes permiso para crear páginas aquí" });
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
        res.status(400).json({ message: "La página superior no pertenece a esta sección" });
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
      res.status(409).json({ message: "Ya existe una página con ese título en esta ubicación" });
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
      res.status(403).json({ message: "No tienes permiso para editar esta página" });
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
          ...(changes.title !== undefined ? { title: changes.title.trim() } : {}),
          ...(changes.content !== undefined ? { content: changes.content } : {}),
          ...(changes.tags !== undefined ? { tags: normalizeTags(changes.tags) } : {}),
          updatedBy: req.user!.id,
          updatedAt: new Date(),
        })
        .where(eq(wikiPagesTable.id, params.data.pageId));
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ message: "Ya existe una página con ese título en esta ubicación" });
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
    if (!page.canEdit) {
      res.status(403).json({ message: "No tienes permiso para eliminar esta página" });
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
    const fileName = sanitizeFileName(parsed.data.fileName);
    if (!fileName || parsed.data.size > MAX_UPLOAD_BYTES) {
      res.status(400).json({ message: "El nombre o tamaño del archivo no es válido" });
      return;
    }

    try {
      const uploadURL = await objectStorage.getObjectEntityUploadURL();
      const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
      if (!OBJECT_PATH_PATTERN.test(objectPath)) {
        req.log.error({ objectPath }, "Storage produced an unexpected wiki upload path");
        res.status(500).json({ message: "No se pudo preparar la subida" });
        return;
      }

      const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_MS);
      await db.insert(wikiUploadIntentsTable).values({
        objectPath,
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
    if (!page.canEdit) {
      res.status(403).json({ message: "No tienes permiso para adjuntar archivos" });
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
      res.status(400).json({ message: "La subida no pertenece a esta sesión o ha caducado" });
      return;
    }

    try {
      const storedObject = await objectStorage.getObjectEntityFile(objectPath);
      const fileResponse = await objectStorage.downloadObject(storedObject, 0);
      const actualSize = Number(fileResponse.headers.get("content-length") ?? 0);
      await fileResponse.body?.cancel();
      if (actualSize > MAX_UPLOAD_BYTES || (actualSize > 0 && actualSize !== intent.size)) {
        res.status(400).json({ message: "El tamaño real del archivo no coincide" });
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
      req.log.warn({ err: error, pageId: params.data.pageId }, "Could not attach wiki file");
      res.status(400).json({ message: "No se pudo comprobar el archivo subido" });
    }
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
    if (!page || !page.canEdit) {
      res.status(403).json({ message: "No tienes permiso para retirar este archivo" });
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
      .innerJoin(wikiPagesTable, eq(wikiPagesTable.id, wikiAttachmentsTable.pageId))
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
      const storedObject = await objectStorage.getObjectEntityFile(attachment.objectPath);
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
      req.log.error({ err: error, attachmentId: attachment.id }, "Wiki attachment download failed");
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
      .where(and(eq(usersTable.status, "active"), isNull(usersTable.deletedAt)));
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
  return rows.map((row) => row.userId);
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
    const [rawEditorIds, candidates] = await Promise.all([
      currentEditorIds(moduleId),
      canManage ? loadCandidates(candidateIds) : Promise.resolve([]),
    ]);
    const editorIds = canManage
      ? rawEditorIds.filter((id) => candidateIds.includes(id))
      : rawEditorIds;
    res.json(
      GetModuleWikiEditorsResponse.parse({ canManage, editorIds, candidates }),
    );
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
    const desired = [...new Set(parsed.data.userIds)];
    const { canManage, candidateIds } = await resolveEditorManagement(
      req.user!,
      moduleId,
    );
    if (!canManage) {
      res.status(403).json({ message: "Sin permiso para gestionar editores" });
      return;
    }
    const candidateSet = new Set(candidateIds);
    if (desired.some((id) => !candidateSet.has(id))) {
      res.status(400).json({ message: "Algún usuario no es un editor permitido" });
      return;
    }
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
          target: [wikiModuleEditorsTable.moduleId, wikiModuleEditorsTable.userId],
          set: { deletedAt: null },
        });
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

export default router;