import { randomUUID } from "node:crypto";
import { and, eq, or, lt, isNull, asc, desc } from "drizzle-orm";
import { db, meetingMinutesTable as minutes, meetingMinutesSourcesTable as sources, meetingMinutesMessagesTable as messages, eventsTable, usersTable } from "@workspace/db";
import OpenAI from "openai";
import { canManageMinutes } from "./meetingMinutes";
import { draftMinutes, processMinutesSource } from "./meetingMinutesMedia";
import { logger } from "./logger";

const lease = () => new Date(Date.now() + 90000);
function safeError(error: unknown) {
  if (error instanceof OpenAI.APIError) return `El proveedor de IA no pudo completar el proceso (HTTP ${error.status ?? "sin respuesta"}). Revisa configuración, disponibilidad y modelo; después reintenta.`;
  return error instanceof Error ? error.message.slice(0, 600) : "No se pudo procesar la solicitud.";
}
async function stillAuthorized(userId: number | null, eventId: number) {
  if (!userId) return false;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const [event] = await db.select().from(eventsTable).where(eq(eventsTable.id, eventId));
  return !!user && user.status === "active" && !!event && !event.deletedAt && event.type === "coordination_meeting" && canManageMinutes(user, event);
}
export async function processOneMinutesJob() {
  const token = randomUUID();
  const source = await db.transaction(async tx => {
    const [candidate] = await tx.select({ source: sources }).from(sources)
      .innerJoin(minutes, eq(minutes.eventId, sources.eventId)).innerJoin(eventsTable, eq(eventsTable.id, sources.eventId))
      .where(and(eq(minutes.enabled, true), isNull(eventsTable.deletedAt), or(eq(sources.status, "queued"), and(eq(sources.status, "processing"), lt(sources.leaseUntil, new Date())))))
      .orderBy(asc(sources.id)).limit(1).for("update", { skipLocked: true, of: sources });
    if (!candidate) return null;
    const [claimed] = await tx.update(sources).set({ status: "processing", error: null, leaseToken: token, leaseUntil: lease() }).where(eq(sources.id, candidate.source.id)).returning();
    return claimed!;
  });
  if (source) {
    const heartbeat = setInterval(() => { void db.update(sources).set({ leaseUntil: lease() }).where(and(eq(sources.id, source.id), eq(sources.leaseToken, token))).catch(() => undefined); }, 20000);
    heartbeat.unref();
    try {
      if (!await stillAuthorized(source.consentBy, source.eventId)) throw new Error("La persona que autorizó la fuente ya no tiene permisos sobre esta reunión.");
      const text = await processMinutesSource(source);
      if (!text.trim() || text.length > 120000) throw new Error("La fuente está vacía o supera 120.000 caracteres extraídos. Divide el documento o la grabación.");
      if (!await stillAuthorized(source.consentBy, source.eventId)) throw new Error("Los permisos han cambiado durante el procesamiento.");
      await db.transaction(async tx => {
        const [row] = await tx.select().from(minutes).where(eq(minutes.eventId, source.eventId)).for("update");
        if (!row) return;
        const updated = await tx.update(sources).set({ status: "ready", extractedText: text, error: null, leaseToken: null, leaseUntil: null }).where(and(eq(sources.id, source.id), eq(sources.leaseToken, token))).returning({ id: sources.id });
        if (updated.length) await tx.update(minutes).set({ revision: row.revision + 1, updatedAt: new Date() }).where(eq(minutes.eventId, row.eventId));
      });
    } catch (error) {
      await db.update(sources).set({ status: "error", error: safeError(error), leaseToken: null, leaseUntil: null }).where(and(eq(sources.id, source.id), eq(sources.leaseToken, token)));
    } finally { clearInterval(heartbeat); }
    return true;
  }
  const job = await db.transaction(async tx => {
    const [candidate] = await tx.select({ row: minutes, event: eventsTable }).from(minutes).innerJoin(eventsTable, eq(eventsTable.id, minutes.eventId))
      .where(and(eq(minutes.enabled, true), isNull(eventsTable.deletedAt), or(eq(minutes.generationStatus, "queued"), and(eq(minutes.generationStatus, "processing"), lt(minutes.leaseUntil, new Date())))))
      .orderBy(asc(minutes.eventId)).limit(1).for("update", { skipLocked: true, of: minutes });
    if (!candidate) return null;
    await tx.update(minutes).set({ generationStatus: "processing", leaseToken: token, leaseUntil: lease() }).where(eq(minutes.eventId, candidate.row.eventId));
    return candidate;
  });
  if (!job) return false;
  const row = job.row;
  const heartbeat = setInterval(() => { void db.update(minutes).set({ leaseUntil: lease() }).where(and(eq(minutes.eventId, row.eventId), eq(minutes.leaseToken, token))).catch(() => undefined); }, 20000);
  heartbeat.unref();
  try {
    if (!await stillAuthorized(row.generationRequestedBy, row.eventId)) throw new Error("La coordinación que solicitó el acta ya no tiene permisos.");
    const material = await db.select().from(sources).where(eq(sources.eventId, row.eventId)).orderBy(asc(sources.id));
    if (material.some(s => s.purpose === "evidence" && s.status !== "ready")) throw new Error("Las fuentes han cambiado; revisa su estado antes de redactar.");
    const history = (await db.select().from(messages).where(eq(messages.eventId, row.eventId)).orderBy(desc(messages.id)).limit(8)).reverse();
    const text = await draftMinutes(row, job.event, material, history);
    if (!await stillAuthorized(row.generationRequestedBy, row.eventId)) throw new Error("Los permisos han cambiado durante la redacción.");
    await db.transaction(async tx => {
      const [current] = await tx.select().from(minutes).where(eq(minutes.eventId, row.eventId)).for("update");
      if (!current || current.leaseToken !== token) return;
      if (!current.enabled || current.revision !== row.generationRevision) throw new Error("El acta o sus fuentes cambiaron durante la redacción. Se han conservado tus cambios; solicita una nueva versión.");
      await tx.update(minutes).set({ draftText: text, revision: current.revision + 1, generationStatus: "idle", generationError: null, leaseToken: null, leaseUntil: null, updatedAt: new Date() }).where(eq(minutes.eventId, row.eventId));
      await tx.insert(messages).values({ eventId: row.eventId, role: "assistant", content: text, createdBy: row.generationRequestedBy });
    });
  } catch (error) {
    await db.update(minutes).set({ generationStatus: "error", generationError: safeError(error), leaseToken: null, leaseUntil: null }).where(and(eq(minutes.eventId, row.eventId), eq(minutes.leaseToken, token)));
  } finally { clearInterval(heartbeat); }
  return true;
}
let timer: ReturnType<typeof setInterval> | undefined;
export function startMeetingMinutesWorker() {
  if (timer) return;
  let running = false;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void processOneMinutesJob().catch(() => logger.warn("No se pudo comprobar la cola de actas; se reintentará.")).finally(() => { running = false; });
  }, 2000);
  timer.unref();
}
