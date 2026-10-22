import { Router, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, meetingMinutesTable, meetingMinutesSourcesTable, meetingMinutesMessagesTable, meetingAiSettingsTable } from "@workspace/db";
import { SaveEventMinutesBody, AddEventMinutesSourceBody, GenerateEventMinutesBody, PublishEventMinutesBody, UpdateMeetingAiSettingsBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { loadAccessibleEvent } from "./events";
import { AttendanceError } from "../lib/eventCertificates";
import { aiStatus, canManageMinutes, workspace, lockMinutes, ownedSource, storage, sourceDto, allowedExtensions, multimediaExtension } from "../lib/meetingMinutes";

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
function parsed<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, body: unknown): T {
  const p = schema.safeParse(body); if (!p.success) throw new AttendanceError(400, "Revisa los datos, la revisión y la autorización de tratamiento."); return p.data!;
}
router.get("/events/:id/minutes", requireAuth, wrap(async (req, res) => {
  const { event, manage } = await eventFor(req); res.json(await workspace(event.id, manage));
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
  const extension = data.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!allowedExtensions.has(extension) || /[/\\\x00-\x1f]/.test(data.fileName)) throw new AttendanceError(400, "Formato o nombre de archivo no admitido.");
  if (data.purpose === "instruction" && !/^(mp3|wav|m4a|ogg|webm|mp4)$/.test(extension)) throw new AttendanceError(400, "El dictado debe ser una grabación de audio.");
  const status = await aiStatus();
  if ((multimediaExtension(data.fileName) || data.purpose === "instruction") && !(status.apiKeyConfigured || status.managedAvailable)) throw new AttendanceError(503, "Configura OpenAI para transcribir audio y analizar imágenes.");
  if (/^(pdf|mp3|wav|m4a|ogg|webm|mp4|mov|mkv)$/.test(extension) && !status.processingAvailable) throw new AttendanceError(503, "Instala ffmpeg y poppler-utils en el servidor.");
  await ownedSource(data.objectPath, req.user!.id, data.size);
  const created = await db.transaction(async tx => {
    const row = await lockMinutes(tx, event.id);
    if (!row.enabled) throw new AttendanceError(409, "Activa el acta antes de añadir fuentes.");
    const existing = await tx.select({ id: meetingMinutesSourcesTable.id }).from(meetingMinutesSourcesTable).where(eq(meetingMinutesSourcesTable.eventId, event.id));
    if (existing.length >= 20) throw new AttendanceError(400, "Se admiten hasta 20 fuentes por reunión.");
    // A domain-owned ACL prevents direct /storage access, including after the
    // uploader loses their coordinator role. No bytes are stored in PostgreSQL.
    await storage.trySetObjectEntityAclPolicy(data.objectPath, { owner: `meeting-minutes:${event.id}`, visibility: "private" });
    const [source] = await tx.insert(meetingMinutesSourcesTable).values({ eventId: event.id, ...data, consentBy: req.user!.id }).returning();
    await tx.update(meetingMinutesTable).set({ revision: row.revision + 1, updatedAt: new Date() }).where(eq(meetingMinutesTable.eventId, event.id));
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
    await tx.update(meetingMinutesTable).set({ publishedText: data.publish ? row.draftText : null, publishedAt: data.publish ? new Date() : null, publishedBy: data.publish ? req.user!.id : null, revision: row.revision + 1, updatedAt: new Date() }).where(eq(meetingMinutesTable.eventId, event.id));
  }); res.json(await workspace(event.id, true));
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
