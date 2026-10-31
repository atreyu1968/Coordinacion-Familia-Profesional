import { createHash } from "node:crypto";
import { Router } from "express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db, resourcesTable, resourceCurriculumTable, resourceLearningTargetsTable,
  moduleLearningOutcomesTable, moduleEvaluationCriteriaTable, wikiAttachmentsTable, wikiPagesTable,
} from "@workspace/db";
import { CreateCurriculumResourceBody, UpdateResourceCurriculumBody, type ResourceCurriculumInput } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { authorizedCurriculumResources, canReadCurriculumModule, canReadResourceCenter, canEditCurriculumResource } from "../lib/resourceCurriculumAccess";
import { structure } from "./forumCollaboration";
import { toResource } from "../lib/mappers";

const router = Router();
class Rejected extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function canonicalResourceUrl(value: string): string {
  if (/^\/api\/wiki\/attachments\/[1-9]\d*\/download$/.test(value)) return value;
  let url: URL;
  try { url = new URL(value); } catch { throw new Rejected(400, "Usa una URL HTTPS estable o un adjunto protegido de Documentación."); }
  if (url.protocol !== "https:" || url.username || url.password ||
    /^\/(?:index\.php\/)?s\/[^/]+/.test(url.pathname) ||
    [...url.searchParams.keys()].some(k => /token|secret|password|signature|credential|session|authorization|^code$|^state$/i.test(k))) {
    throw new Rejected(400, "No se admiten enlaces temporales, credenciales ni tokens. Usa una referencia estable.");
  }
  url.hash = "";
  url.searchParams.sort();
  return url.toString();
}

router.use("/forum/modules/:moduleId/resources", requireAuth, async (req, res, next) => {
  const id = Number(req.params.moduleId);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ message: "Módulo no válido" }); return; }
  if (!await canReadCurriculumModule(req.user!, id)) { res.status(403).json({ message: "No tienes acceso a los recursos de este módulo de Administración y Gestión." }); return; }
  next();
});

router.get("/forum/modules/:moduleId/resources", async (req, res) => {
  const rows = await db.select({ resource: resourcesTable }).from(resourcesTable)
    .innerJoin(resourceCurriculumTable, eq(resourceCurriculumTable.resourceId, resourcesTable.id))
    .where(and(eq(resourceCurriculumTable.moduleId, Number(req.params.moduleId)), isNull(resourcesTable.deletedAt)));
  const result = await authorizedCurriculumResources(rows.map(r => r.resource), req.user!, true);
  res.json(result.map(r => ({ ...toResource(r), curriculum: r.curriculum })));
});

async function save(req: import("express").Request, resourceId?: number) {
  const user = req.user!;
  const moduleId = Number(req.params.moduleId);
  const parsed = resourceId == null ? CreateCurriculumResourceBody.safeParse(req.body) : UpdateResourceCurriculumBody.safeParse(req.body);
  if (!parsed.success) throw new Rejected(400, "Revisa licencia, versión, confirmación de derechos y asociaciones RA/CE.");
  const input: ResourceCurriculumInput = parsed.data;
  if (!input.license.trim() || !input.version.trim()) throw new Rejected(400, "Licencia y versión son obligatorias.");
  if (input.restricted && input.audience !== "teachers") throw new Rejected(400, "Un solucionario restringido no puede destinarse al alumnado.");
  const savedId = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(1948, ${moduleId})`);
    let resource;
    if (resourceId != null) {
      [resource] = await tx.select().from(resourcesTable).where(and(eq(resourcesTable.id, resourceId), isNull(resourcesTable.deletedAt))).for("update");
      if (!resource) throw new Rejected(404, "Recurso no encontrado");
      if (!await canReadResourceCenter(resource, user) || !await canEditCurriculumResource(resource, moduleId, user)) throw new Rejected(403, "No puedes gestionar este recurso.");
      if (resource.moduleId != null && resource.moduleId !== moduleId) throw new Rejected(400, "El recurso pertenece a otro módulo; no se reasigna automáticamente.");
    }
    const [previous] = resource ? await tx.select().from(resourceCurriculumTable).where(eq(resourceCurriculumTable.resourceId, resource.id)) : [];
    if (previous && previous.moduleId !== moduleId) throw new Rejected(409, "El recurso ya está asociado a otro currículo.");
    if (input.revision !== (previous?.revision ?? 0)) throw new Rejected(409, "El recurso ha cambiado. Actualiza la ficha antes de guardar.");
    // Retirement must remain possible even after a curriculum/source disappears.
    if (previous && input.archived) {
      await tx.update(resourceCurriculumTable).set({ archived: true, revision: previous.revision + 1, updatedAt: new Date() }).where(eq(resourceCurriculumTable.resourceId, previous.resourceId));
      return previous.resourceId;
    }
    const state = await structure(tx, moduleId, user);
    if (!state.enabled || !state.verificationCurrent || state.diagnostics.length || state.fingerprint !== input.fingerprint) {
      throw new Rejected(409, "El currículo no está activado y revisado o ha cambiado. Solicita su revisión antes de publicar.");
    }
    const keys = input.targets.map(t => t.criterionId == null ? `RA:${t.outcomeId}` : `CE:${t.criterionId}`);
    if (new Set(keys).size !== keys.length) throw new Rejected(400, "Hay asociaciones repetidas.");
    const outcomes = await tx.select().from(moduleLearningOutcomesTable).where(and(eq(moduleLearningOutcomesTable.moduleId, moduleId), isNull(moduleLearningOutcomesTable.deletedAt)));
    const criteria = outcomes.length ? await tx.select().from(moduleEvaluationCriteriaTable).where(and(
      inArray(moduleEvaluationCriteriaTable.outcomeId, outcomes.map(o => o.id)), isNull(moduleEvaluationCriteriaTable.deletedAt))) : [];
    if (input.targets.some(t => !outcomes.some(o => o.id === t.outcomeId) || t.criterionId != null &&
      !criteria.some(c => c.id === t.criterionId && c.outcomeId === t.outcomeId))) throw new Rejected(400, "Cada criterio debe pertenecer al RA y al módulo indicados.");
    const creation = resourceId == null ? CreateCurriculumResourceBody.parse(req.body) : null;
    if (creation && (!creation.title.trim() || !creation.type.trim())) throw new Rejected(400, "Título y tipo son obligatorios.");
    const rawUrl = (resource?.fileUrl ?? creation?.fileUrl ?? "").trim();
    const canonical = canonicalResourceUrl(rawUrl);
    const canonicalKey = createHash("sha256").update(canonical).digest("hex");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${canonical}, 1949))`);
    const wikiMatch = /^\/api\/wiki\/attachments\/([1-9]\d*)\/download$/.exec(canonical);
    if (input.restricted && !wikiMatch) throw new Rejected(400,
      "Los solucionarios requieren un adjunto protegido de Documentación del mismo módulo. Un enlace público no se vuelve privado al etiquetarlo.");
    if (wikiMatch) {
      const [attachment] = await tx.select({ pageId: wikiPagesTable.id, moduleId: wikiPagesTable.moduleId }).from(wikiAttachmentsTable)
        .innerJoin(wikiPagesTable, eq(wikiPagesTable.id, wikiAttachmentsTable.pageId))
        .where(and(eq(wikiAttachmentsTable.id, Number(wikiMatch[1])), isNull(wikiAttachmentsTable.deletedAt), isNull(wikiPagesTable.deletedAt)));
      const { loadPage } = await import("./nativeWiki");
      if (!attachment || input.restricted && attachment.moduleId !== moduleId || !await loadPage(attachment.pageId, user)) {
        throw new Rejected(403, "No tienes acceso al documento de origen o no pertenece al módulo.");
      }
    }
    const [duplicate] = await tx.select().from(resourceCurriculumTable).where(eq(resourceCurriculumTable.canonicalKey, canonicalKey));
    if (duplicate && duplicate.resourceId !== resource?.id) throw new Rejected(409, "Esta referencia ya está en la biblioteca. Vincula su recurso existente; no dupliques el archivo.");
    if (creation) {
      if (input.archived || input.revision !== 0) throw new Rejected(400, "Un recurso nuevo comienza activo y con revisión cero.");
      // Legacy URLs have no normalized hash. Compare without rewriting their
      // original references, including fragments and query-order variations.
      const legacy = await tx.select({ id: resourcesTable.id, fileUrl: resourcesTable.fileUrl }).from(resourcesTable).where(isNull(resourcesTable.deletedAt));
      const existing = legacy.find(r => {
        if (!r.fileUrl) return false;
        try { return canonicalResourceUrl(r.fileUrl) === canonical; } catch { return false; }
      });
      if (existing) throw new Rejected(409, "Esta referencia ya está en la biblioteca. Asocia el recurso existente a los RA/CE.");
      [resource] = await tx.insert(resourcesTable).values({ title: creation.title.trim(), description: creation.description?.trim() || null,
        type: creation.type.trim(), fileUrl: rawUrl, moduleId, centerId: null, authorId: user.id, originalAuthorName: user.name }).returning();
    }
    if (!resource) throw new Rejected(404, "Recurso no encontrado");
    const metadata = { moduleId, revision: (previous?.revision ?? 0) + 1, canonicalKey,
      originCenterId: previous?.originCenterId ?? resource.centerId ?? (resource.authorId === user.id ? user.centerId : null),
      license: input.license.trim(), version: input.version.trim(), audience: input.audience,
      restricted: input.restricted, archived: input.archived, fingerprint: state.fingerprint,
      curriculumVersion: state.configuration!.curriculumVersion, updatedAt: new Date() };
    await tx.insert(resourceCurriculumTable).values({ resourceId: resource.id, ...metadata })
      .onConflictDoUpdate({ target: resourceCurriculumTable.resourceId, set: metadata });
    await tx.delete(resourceLearningTargetsTable).where(eq(resourceLearningTargetsTable.resourceId, resource.id));
    await tx.insert(resourceLearningTargetsTable).values(input.targets.map((target, i) => ({ resourceId: resource!.id,
      outcomeId: target.outcomeId, criterionId: target.criterionId, stableKey: keys[i] })));
    return resource.id;
  });
  const [row] = await db.select().from(resourcesTable).where(eq(resourcesTable.id, savedId));
  const [result] = await authorizedCurriculumResources([row], user, true);
  return { ...toResource(result), curriculum: result.curriculum };
}

function handleError(error: unknown, res: import("express").Response, next: import("express").NextFunction) {
  if (error instanceof Rejected) { res.status(error.status).json({ message: error.message }); return; }
  if ((error as { code?: string }).code === "23505" || (error as { cause?: { code?: string } }).cause?.code === "23505") {
    res.status(409).json({ message: "La referencia ya existe. Actualiza la biblioteca para vincularla." }); return;
  }
  next(error);
}
router.post("/forum/modules/:moduleId/resources", async (req, res, next) => {
  try { res.status(201).json(await save(req)); } catch (error) { handleError(error, res, next); }
});
router.put("/forum/modules/:moduleId/resources/:resourceId", async (req, res, next) => {
  const id = Number(req.params.resourceId);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ message: "Recurso no válido" }); return; }
  try { res.json(await save(req, id)); } catch (error) { handleError(error, res, next); }
});
export default router;
