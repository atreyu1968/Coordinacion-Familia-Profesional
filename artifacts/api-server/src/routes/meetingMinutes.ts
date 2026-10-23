import { Router, type Request, type Response } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, eventsTable, meetingMinutesTable, meetingMinutesSourcesTable, meetingMinutesSharedDocumentsTable, meetingMinutesMessagesTable, meetingAiSettingsTable } from "@workspace/db";
import {
  AddEventMinutesSharedDocumentBody,
  AddEventMinutesSharedDocumentResponse,
  DeleteEventMinutesSharedDocumentResponse,
  GetEventMinutesResponse,
  ListPublishedMinutesResponse,
  SaveEventMinutesBody,
  AddEventMinutesSourceBody,
  GenerateEventMinutesBody,
  PublishEventMinutesBody,
  UpdateMeetingAiSettingsBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { loadAccessibleEvent } from "./events";
import { AttendanceError } from "../lib/eventCertificates";
import { aiStatus, canManageMinutes, workspace, lockMinutes, ownedSource, storage, sourceDto, sharedDocumentDto, allowedExtensions, multimediaExtension } from "../lib/meetingMinutes";
import { notifyUsers, resolveProvinceAudience, resolveRoleAudienceInProvince } from "../lib/notify";

const router = Router();
type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (handler: Handler) => async (req: Request, res: Response, next: (e?: unknown) => void) => {
  res.setHeader("Cache-Control", "no-store");
  try { await handler(req, res); }
  catch (e) { if (e instanceof AttendanceError) res.status(e.status).json({ message: e.message }); else next(e); }
};
function id(value: unknown) {
  const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new AttendanceError(400, "Identificador no válido."); return n;
}
async function eventFor(req: Request, write = false) {
  const result = await loadAccessibleEvent(id(req.params.id), req.user!);
  if (!result.ok) throw new AttendanceError(result.status, result.message);
  const event = result.event;
  if (event.type !== "coordination_meeting") throw new AttendanceError(400, "Las actas están disponibles en reuniones de coordinación.");
  const manage = canManageMinutes(req.user!, event);
  if (write && !manage) throw new AttendanceError(403, "Solo la coordinación con permiso sobre esta reunión puede gestionar el acta.");
  return { event, manage };
}
async function publishedReaderEventFor(req: Request) {
  if (req.user!.role !== "department_head") return { ...(await eventFor(req)), departmentHeadView: false };
  const [event] = await db.select().from(eventsTable).where(and(
    eq(eventsTable.id, id(req.params.id)),
    isNull(eventsTable.deletedAt),
  )).limit(1);
  if (!event) throw new AttendanceError(404, "Evento no encontrado.");
  if (event.type !== "coordination_meeting") throw new AttendanceError(400, "Las actas están disponibles en reuniones de coordinación.");
  return { event, manage: false, departmentHeadView: true };
}
async function publishedFinalDocument(eventId: number, publishedAt: Date | null | undefined) {
  if (!publishedAt) return undefined;
  const documents = await db.select().from(meetingMinutesSourcesTable).where(and(
    eq(meetingMinutesSourcesTable.eventId, eventId),
    eq(meetingMinutesSourcesTable.purpose, "final_document"),
  )).orderBy(desc(meetingMinutesSourcesTable.createdAt), desc(meetingMinutesSourcesTable.id));
  return documents.find((document) => document.createdAt <= publishedAt);
}
function isVisibleInPublication(document: {
  createdAt: Date;
  removedAt: Date | null;
}, publishedAt: Date) {
  return document.createdAt <= publishedAt && (!document.removedAt || document.removedAt > publishedAt);
}
function parsed<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, body: unknown): T {
  const p = schema.safeParse(body); if (!p.success) throw new AttendanceError(400, "Revisa los datos, la revisión y la autorización de tratamiento."); return p.data!;
}
router.get("/events/:id/minutes", requireAuth, wrap(async (req, res) => {
  const { event, manage, departmentHeadView } = await publishedReaderEventFor(req);
  res.json(GetEventMinutesResponse.parse(await workspace(event.id, manage, departmentHeadView)));
}));
router.get("/events/:id/minutes/documents/:version", requireAuth, wrap(async (req, res) => {
  const version = req.params.version;
  if (version !== "draft" && version !== "published") throw new AttendanceError(400, "Versión de documento no válida.");
  const { event, manage, departmentHeadView } = version === "published"
    ? await publishedReaderEventFor(req)
    : { ...(await eventFor(req, true)), departmentHeadView: false };
  const [minutes] = await db.select().from(meetingMinutesTable).where(eq(meetingMinutesTable.eventId, event.id)).limit(1);
  if (!minutes?.enabled) throw new AttendanceError(404, "No hay documento disponible.");
  if (version === "draft" && !manage) throw new AttendanceError(403, "El borrador es privado.");
  if (version === "published" && (!minutes.publishedText || !minutes.publishedAt)) throw new AttendanceError(404, "No hay acta publicada.");
  const finalDocuments = version === "draft"
    ? await db.select().from(meetingMinutesSourcesTable).where(and(
      eq(meetingMinutesSourcesTable.eventId, event.id),
      eq(meetingMinutesSourcesTable.purpose, "final_document"),
    )).orderBy(sql`${meetingMinutesSourcesTable.createdAt} DESC`, sql`${meetingMinutesSourcesTable.id} DESC`)
    : [];
  const source = version === "draft"
    ? finalDocuments[0]
    : await publishedFinalDocument(event.id, minutes.publishedAt);
  if (version === "published" && departmentHeadView && !source) throw new AttendanceError(404, "No hay acta oficial subida y publicada.");
  if (!source) throw new AttendanceError(404, "No se encontró el documento adjunto.");
  const stored = await storage.getObjectEntityFile(source.objectPath);
  const fileResponse = await storage.downloadObject(stored, 0);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(source.fileName)}`);
  res.status(200);
  if (fileResponse.body) {
    await pipeline(Readable.fromWeb(fileResponse.body as ReadableStream<Uint8Array>), res);
  } else res.end();
}));
router.get("/minutes/published", requireAuth, wrap(async (req, res) => {
  if (req.user!.role !== "department_head") throw new AttendanceError(403, "Esta lista está disponible para jefaturas de departamento.");
  const candidates = await db.select({
    eventId: eventsTable.id,
    eventName: eventsTable.name,
    eventStartAt: eventsTable.startAt,
    eventLocation: eventsTable.location,
    publishedText: meetingMinutesTable.publishedText,
    publishedAt: meetingMinutesTable.publishedAt,
  }).from(eventsTable).innerJoin(meetingMinutesTable, eq(meetingMinutesTable.eventId, eventsTable.id))
    .where(and(
      eq(eventsTable.type, "coordination_meeting"),
      isNull(eventsTable.deletedAt),
      eq(meetingMinutesTable.enabled, true),
    )).orderBy(desc(meetingMinutesTable.publishedAt));
  const published = [];
  for (const candidate of candidates) {
    if (!candidate.publishedText || !candidate.publishedAt) continue;
    const actaDocument = await publishedFinalDocument(candidate.eventId, candidate.publishedAt);
    if (!actaDocument) continue;
    const documents = await db.select().from(meetingMinutesSharedDocumentsTable)
      .where(eq(meetingMinutesSharedDocumentsTable.eventId, candidate.eventId))
      .orderBy(meetingMinutesSharedDocumentsTable.createdAt);
    published.push({
      eventId: candidate.eventId,
      eventName: candidate.eventName,
      eventStartAt: candidate.eventStartAt?.toISOString() ?? null,
      eventLocation: candidate.eventLocation,
      publishedAt: candidate.publishedAt.toISOString(),
      actaDocument: {
        id: actaDocument.id,
        fileName: actaDocument.fileName,
        contentType: actaDocument.contentType,
        size: actaDocument.size,
      },
      sharedDocuments: documents
        .filter((document) => isVisibleInPublication(document, candidate.publishedAt!))
        .map((document) => sharedDocumentDto(document, false)),
    });
  }
  res.json(ListPublishedMinutesResponse.parse(published));
}));
router.post("/events/:id/minutes/shared-documents", requireAuth, wrap(async (req, res) => {
  const { event } = await eventFor(req, true);
  const data = parsed(AddEventMinutesSharedDocumentBody, req.body);
  if (!data.title.trim()) throw new AttendanceError(400, "Escribe un título para el documento compartido.");
  let fileValues: {
    objectPath: string;
    fileName: string;
    contentType: string;
    size: number;
  } | undefined;
  let linkUrl: string | undefined;
  if (data.kind === "link") {
    if (!data.url || data.objectPath || data.fileName || data.contentType || data.size != null) {
      throw new AttendanceError(400, "Para compartir un enlace, indica solo un enlace HTTPS y su título.");
    }
    let parsedUrl: URL;
    try { parsedUrl = new URL(data.url); } catch { throw new AttendanceError(400, "El enlace no es válido."); }
    if (parsedUrl.protocol !== "https:" || parsedUrl.username || parsedUrl.password) {
      throw new AttendanceError(400, "El enlace debe usar HTTPS y no puede incluir credenciales.");
    }
    linkUrl = parsedUrl.toString();
  } else {
    if (!data.objectPath || !data.fileName || !data.contentType || data.size == null ||
      data.url || /[/\\\x00-\x1f]/.test(data.fileName)) {
      throw new AttendanceError(400, "Para compartir un archivo, falta su archivo o metadato.");
    }
    const extension = data.fileName.split(".").pop()?.toLowerCase() ?? "";
    if (!allowedExtensions.has(extension)) throw new AttendanceError(400, "Formato de archivo no admitido.");
    await ownedSource(data.objectPath, req.user!.id, data.size);
    fileValues = {
      objectPath: data.objectPath,
      fileName: data.fileName,
      contentType: data.contentType,
      size: data.size,
    };
  }
  await db.transaction(async (tx) => {
    const row = await lockMinutes(tx, event.id);
    if (!row.enabled) throw new AttendanceError(409, "Activa primero el acta para compartir documentos.");
    const activeDocs = await tx.select({ id: meetingMinutesSharedDocumentsTable.id })
      .from(meetingMinutesSharedDocumentsTable)
      .where(and(
        eq(meetingMinutesSharedDocumentsTable.eventId, event.id),
        isNull(meetingMinutesSharedDocumentsTable.removedAt),
      ));
    if (activeDocs.length >= 30) throw new AttendanceError(400, "Se admiten hasta 30 documentos compartidos por reunión.");
    if (fileValues) {
      await storage.trySetObjectEntityAclPolicy(fileValues.objectPath, { owner: `meeting-minutes:${event.id}`, visibility: "private" });
    }
    await tx.insert(meetingMinutesSharedDocumentsTable).values({
      eventId: event.id,
      kind: data.kind,
      title: data.title.trim(),
      ...(fileValues ?? {}),
      ...(linkUrl ? { url: linkUrl } : {}),
      createdBy: req.user!.id,
    });
    await tx.update(meetingMinutesTable).set({ revision: row.revision + 1, updatedAt: new Date() })
      .where(eq(meetingMinutesTable.eventId, event.id));
  });
  res.status(201).json(AddEventMinutesSharedDocumentResponse.parse(await workspace(event.id, true)));
}));
router.delete("/events/:id/minutes/shared-documents/:documentId", requireAuth, wrap(async (req, res) => {
  const { event } = await eventFor(req, true);
  await db.transaction(async (tx) => {
    const row = await lockMinutes(tx, event.id);
    const [document] = await tx.select().from(meetingMinutesSharedDocumentsTable).where(and(
      eq(meetingMinutesSharedDocumentsTable.id, id(req.params.documentId)),
      eq(meetingMinutesSharedDocumentsTable.eventId, event.id),
    )).for("update");
    if (!document || document.removedAt) throw new AttendanceError(404, "El documento compartido no existe o ya se retiró.");
    await tx.update(meetingMinutesSharedDocumentsTable).set({ removedAt: new Date() })
      .where(eq(meetingMinutesSharedDocumentsTable.id, document.id));
    await tx.update(meetingMinutesTable).set({ revision: row.revision + 1, updatedAt: new Date() })
      .where(eq(meetingMinutesTable.eventId, event.id));
  });
  res.json(DeleteEventMinutesSharedDocumentResponse.parse(await workspace(event.id, true)));
}));
router.get("/events/:id/minutes/shared-documents/:documentId/download", requireAuth, wrap(async (req, res) => {
  const { event, manage } = await publishedReaderEventFor(req);
  const [minutes] = await db.select().from(meetingMinutesTable)
    .where(eq(meetingMinutesTable.eventId, event.id)).limit(1);
  if (!manage) {
    if (!minutes?.enabled || !minutes.publishedText || !minutes.publishedAt) {
      throw new AttendanceError(404, "No hay documentos publicados junto al acta.");
    }
    if (!(await publishedFinalDocument(event.id, minutes.publishedAt))) {
      throw new AttendanceError(404, "No hay acta oficial subida y publicada.");
    }
  }
  const [document] = await db.select().from(meetingMinutesSharedDocumentsTable).where(and(
    eq(meetingMinutesSharedDocumentsTable.id, id(req.params.documentId)),
    eq(meetingMinutesSharedDocumentsTable.eventId, event.id),
  )).limit(1);
  if (!document || document.kind !== "file") throw new AttendanceError(404, "No se encontró el archivo compartido.");
  if (!manage && !isVisibleInPublication(document, minutes!.publishedAt!)) {
    throw new AttendanceError(404, "El archivo no forma parte de la publicación vigente.");
  }
  const stored = await storage.getObjectEntityFile(document.objectPath!);
  const fileResponse = await storage.downloadObject(stored, 0);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName!)}`);
  res.status(200);
  if (fileResponse.body) await pipeline(Readable.fromWeb(fileResponse.body as ReadableStream<Uint8Array>), res);
  else res.end();
}));
router.put("/events/:id/minutes", requireAuth, wrap(async (req, res) => {
  const { event } = await eventFor(req, true);
  const data = parsed(SaveEventMinutesBody, req.body);
  await db.transaction(async tx => {
    const row = await lockMinutes(tx, event.id, data.revision);
    if (data.draftText !== undefined && !row.enabled && data.enabled !== true) throw new AttendanceError(409, "Activa primero el acta.");
    await tx.update(meetingMinutesTable).set({
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      ...(data.draftText !== undefined ? { draftText: data.draftText } : {}),
      revision: row.revision + 1, updatedAt: new Date(),
    }).where(eq(meetingMinutesTable.eventId, event.id));
  });
  res.json(await workspace(event.id, true));
}));
router.post("/events/:id/minutes/sources", requireAuth, wrap(async (req, res) => {
  const { event } = await eventFor(req, true);
  const data = parsed(AddEventMinutesSourceBody, req.body);
  if (data.purpose !== "final_document" && data.consent !== true) throw new AttendanceError(400, "Autoriza el tratamiento antes de subir evidencias o instrucciones.");
  const extension = data.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!allowedExtensions.has(extension) || /[/\\\x00-\x1f]/.test(data.fileName)) throw new AttendanceError(400, "Formato o nombre de archivo no admitido.");
  if (data.purpose === "final_document" && !/^(pdf|docx|odt)$/.test(extension)) throw new AttendanceError(400, "El documento definitivo debe ser PDF, DOCX u ODT.");
  if (data.purpose === "instruction" && !/^(mp3|wav|m4a|ogg|webm|mp4)$/.test(extension)) throw new AttendanceError(400, "El dictado debe ser una grabación de audio.");
  if (data.purpose !== "final_document") {
    const status = await aiStatus();
    if ((multimediaExtension(data.fileName) || data.purpose === "instruction") && !(status.apiKeyConfigured || status.managedAvailable)) throw new AttendanceError(503, "Configura OpenAI para transcribir audio y analizar imágenes.");
    if (extension === "pdf" && !status.pdfProcessingAvailable) throw new AttendanceError(503, "Instala poppler-utils en el servidor para procesar PDF.");
    if (/^(mp3|wav|m4a|ogg|webm|mp4|mov|mkv)$/.test(extension) && !status.mediaProcessingAvailable) throw new AttendanceError(503, "Instala ffmpeg y ffprobe en el servidor para procesar audio y vídeo.");
  }
  await ownedSource(data.objectPath, req.user!.id, data.size);
  const created = await db.transaction(async tx => {
    const row = await lockMinutes(tx, event.id);
    if (!row.enabled) throw new AttendanceError(409, "Activa el acta antes de añadir fuentes.");
    const existing = await tx.select({ id: meetingMinutesSourcesTable.id }).from(meetingMinutesSourcesTable).where(eq(meetingMinutesSourcesTable.eventId, event.id));
    if (existing.length >= 20) throw new AttendanceError(400, "Se admiten hasta 20 fuentes por reunión.");
    // A domain-owned ACL prevents direct /storage access, including after the
    // uploader loses their coordinator role. No bytes are stored in PostgreSQL.
    await storage.trySetObjectEntityAclPolicy(data.objectPath, { owner: `meeting-minutes:${event.id}`, visibility: "private" });
    const [source] = await tx.insert(meetingMinutesSourcesTable).values({
      eventId: event.id,
      objectPath: data.objectPath,
      fileName: data.fileName,
      contentType: data.contentType,
      size: data.size,
      purpose: data.purpose,
      consentBy: data.purpose === "final_document" ? null : req.user!.id,
      ...(data.purpose === "final_document" ? { status: "ready" } : {}),
    }).returning();
    await tx.update(meetingMinutesTable).set({
      ...(data.purpose === "final_document" ? { draftDocumentSourceId: source!.id } : {}),
      revision: row.revision + 1,
      updatedAt: new Date(),
    }).where(eq(meetingMinutesTable.eventId, event.id));
    return source!;
  });
  res.status(201).json(sourceDto(created));
}));
router.delete("/events/:id/minutes/sources/:sourceId", requireAuth, wrap(async (req, res) => {
  const { event } = await eventFor(req, true);
  await db.transaction(async tx => {
    const row = await lockMinutes(tx, event.id);
    const [source] = await tx.select().from(meetingMinutesSourcesTable).where(and(eq(meetingMinutesSourcesTable.id, id(req.params.sourceId)), eq(meetingMinutesSourcesTable.eventId, event.id))).for("update");
    if (!source) throw new AttendanceError(404, "Fuente no encontrada.");
    const finalDocuments = await tx.select().from(meetingMinutesSourcesTable).where(and(
      eq(meetingMinutesSourcesTable.eventId, event.id),
      eq(meetingMinutesSourcesTable.purpose, "final_document"),
    )).orderBy(sql`${meetingMinutesSourcesTable.createdAt} DESC`, sql`${meetingMinutesSourcesTable.id} DESC`);
    const publishedDocument = row.publishedText && row.publishedAt
      ? finalDocuments.find((document) => document.createdAt <= row.publishedAt!)
      : undefined;
    if (publishedDocument?.id === source.id) throw new AttendanceError(409, "Retira la publicación antes de eliminar el documento definitivo publicado.");
    if (source.status === "processing" && source.leaseUntil && source.leaseUntil > new Date()) throw new AttendanceError(409, "Espera a que termine el procesamiento antes de eliminar la fuente.");
    await storage.deleteObjectEntity(source.objectPath);
    await tx.delete(meetingMinutesSourcesTable).where(eq(meetingMinutesSourcesTable.id, source.id));
    await tx.update(meetingMinutesTable).set({ revision: row.revision + 1, updatedAt: new Date() }).where(eq(meetingMinutesTable.eventId, event.id));
  });
  res.json({ ok: true });
}));
router.post("/events/:id/minutes/sources/:sourceId/retry", requireAuth, wrap(async (req, res) => {
  const { event } = await eventFor(req, true);
  await db.transaction(async tx => {
    const row = await lockMinutes(tx, event.id);
    if (!row.enabled) throw new AttendanceError(409, "Activa primero el acta.");
    const updated = await tx.update(meetingMinutesSourcesTable).set({ status: "queued", error: null, leaseToken: null, leaseUntil: null, consentBy: req.user!.id }).where(and(eq(meetingMinutesSourcesTable.id, id(req.params.sourceId)), eq(meetingMinutesSourcesTable.eventId, event.id), eq(meetingMinutesSourcesTable.status, "error"))).returning();
    if (!updated.length) throw new AttendanceError(409, "Solo se pueden reintentar fuentes con error.");
    await tx.update(meetingMinutesTable).set({ revision: row.revision + 1, updatedAt: new Date() }).where(eq(meetingMinutesTable.eventId, event.id));
  }); res.json({ ok: true });
}));
router.post("/events/:id/minutes/generate", requireAuth, wrap(async (req, res) => {
  const { event } = await eventFor(req, true); const data = parsed(GenerateEventMinutesBody, req.body);
  if (!data.instructions.trim()) throw new AttendanceError(400, "Aporta instrucciones o ideas para redactar el acta.");
  if (!(await aiStatus()).writingConfigured) throw new AttendanceError(503, "Configura DeepSeek u OpenAI en el panel de control para redactar actas.");
  await db.transaction(async tx => {
    const row = await lockMinutes(tx, event.id, data.revision);
    if (!row.enabled) throw new AttendanceError(409, "Activa primero el acta.");
    if (["queued", "processing"].includes(row.generationStatus)) throw new AttendanceError(409, "Ya hay una redacción en curso.");
    const sources = await tx.select().from(meetingMinutesSourcesTable).where(eq(meetingMinutesSourcesTable.eventId, event.id));
    if (sources.some(s => s.purpose === "evidence" && s.status !== "ready")) throw new AttendanceError(409, "Procesa o elimina las fuentes pendientes o con error antes de redactar.");
    if (sources.reduce((sum, s) => sum + (s.purpose === "evidence" ? s.extractedText.length : 0), 0) > 180000) throw new AttendanceError(400, "Las fuentes superan el contexto de 180.000 caracteres; divide la reunión o reduce documentos.");
    await tx.insert(meetingMinutesMessagesTable).values({ eventId: event.id, role: "user", content: data.instructions, createdBy: req.user!.id });
    await tx.update(meetingMinutesTable).set({ generationStatus: "queued", generationInstructions: data.instructions, generationRevision: row.revision, generationRequestedBy: req.user!.id, generationError: null, leaseToken: null, leaseUntil: null }).where(eq(meetingMinutesTable.eventId, event.id));
  }); res.status(202).json(await workspace(event.id, true));
}));
router.post("/events/:id/minutes/publish", requireAuth, wrap(async (req, res) => {
  const { event } = await eventFor(req, true); const data = parsed(PublishEventMinutesBody, req.body);
  await db.transaction(async tx => {
    const row = await lockMinutes(tx, event.id, data.revision);
    if (data.publish && (!row.enabled || !data.reviewed || !row.draftText.trim() || ["queued", "processing"].includes(row.generationStatus))) throw new AttendanceError(409, "Activa, revisa y guarda el borrador antes de publicarlo; espera a que termine la IA.");
    await tx.update(meetingMinutesTable).set({
      publishedText: data.publish ? row.draftText : null,
      publishedAt: data.publish ? new Date() : null,
      publishedBy: data.publish ? req.user!.id : null,
      revision: row.revision + 1,
      updatedAt: new Date(),
    }).where(eq(meetingMinutesTable.eventId, event.id));
  });
  const result = await workspace(event.id, true);
  if (data.publish && result.publishedDocument) {
    const [provinceAudience, departmentHeads] = await Promise.all([
      resolveProvinceAudience(event.provinceId, req.user!.id),
      resolveRoleAudienceInProvince("department_head", null, req.user!.id),
    ]);
    await notifyUsers([...new Set([...provinceAudience, ...departmentHeads])], {
      title: "Nueva acta de coordinación publicada",
      body: `Ya está disponible el acta oficial de «${event.name}». Consulta Actas de coordinación en la aplicación.`,
      type: "meeting_minutes",
      data: { eventId: event.id },
    });
  }
  res.json(result);
}));
router.get("/settings/meeting-ai", requireAuth, wrap(async (req, res) => {
  if (req.user!.role !== "superadmin") throw new AttendanceError(403, "Solo superadministración puede configurar los servicios."); res.json(await aiStatus());
}));
router.put("/settings/meeting-ai", requireAuth, wrap(async (req, res) => {
  if (req.user!.role !== "superadmin") throw new AttendanceError(403, "Solo superadministración puede configurar los servicios.");
  const data = parsed(UpdateMeetingAiSettingsBody, req.body);
  if ([data.transcriptionModel, data.visionModel].some(m => m !== undefined && !/^[a-zA-Z0-9._:-]+$/.test(m))) throw new AttendanceError(400, "Nombre de modelo no válido.");
  if (data.clearApiKey && data.apiKey?.trim()) throw new AttendanceError(400, "No puedes guardar y borrar la clave a la vez.");
  const values = { ...(data.clearApiKey ? { apiKey: null } : data.apiKey?.trim() ? { apiKey: data.apiKey.trim() } : {}), ...(data.transcriptionModel ? { transcriptionModel: data.transcriptionModel } : {}), ...(data.visionModel ? { visionModel: data.visionModel } : {}) };
  if (!Object.keys(values).length) throw new AttendanceError(400, "No has indicado cambios.");
  await db.insert(meetingAiSettingsTable).values({ id: 1, ...values }).onConflictDoUpdate({ target: meetingAiSettingsTable.id, set: values });
  res.json(await aiStatus());
}));
export default router;
