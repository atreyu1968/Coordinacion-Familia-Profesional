import { and, eq, asc, desc, sql } from "drizzle-orm";
import { db, eventsTable, meetingMinutesTable, meetingMinutesSourcesTable, meetingMinutesMessagesTable, meetingAiSettingsTable } from "@workspace/db";
import { getSettings, isDeepseekConfigured } from "./settings";
import { AttendanceError } from "./eventCertificates";
import { getObjectAclPolicy } from "./objectAcl";
import { ObjectStorageService } from "./objectStorage";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const storage = new ObjectStorageService();
export const exec = promisify(execFile);
export const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
export const allowedExtensions = new Set(["txt", "md", "csv", "docx", "pptx", "xlsx", "pdf", "jpg", "jpeg", "png", "webp", "mp3", "wav", "m4a", "ogg", "webm", "mp4", "mov", "mkv"]);
export const multimediaExtension = (name: string) => /\.(mp3|wav|m4a|ogg|webm|mp4|mov|mkv|jpg|jpeg|png|webp)$/i.test(name);
export function canManageMinutes(user: { role: string; provinceId?: number | null }, event: { provinceId: number | null }): boolean {
  return user.role === "superadmin" || (user.role === "coordinator" && user.provinceId != null && event.provinceId === user.provinceId);
}
export async function aiConfig() {
  const [row] = await db.select().from(meetingAiSettingsTable).where(eq(meetingAiSettingsTable.id, 1));
  return row ?? { id: 1, apiKey: null, transcriptionModel: "gpt-4o-mini-transcribe", visionModel: "gpt-4o-mini" };
}
let toolsCache: { until: number; available: boolean } | undefined;
export async function processingAvailable() {
  if (toolsCache && toolsCache.until > Date.now()) return toolsCache.available;
  const available = await Promise.all(["ffmpeg", "ffprobe", "pdftotext", "pdftoppm"].map(command =>
    exec(command, command === "pdftotext" || command === "pdftoppm" ? ["-v"] : ["-version"], { timeout: 5000, maxBuffer: 1024 * 1024 }).then(() => true, () => false),
  )).then(results => results.every(Boolean));
  toolsCache = { until: Date.now() + 60_000, available };
  return available;
}
export async function aiStatus() {
  const config = await aiConfig();
  const managedAvailable = !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
  return {
    apiKeyConfigured: !!config.apiKey,
    managedAvailable,
    writingConfigured: isDeepseekConfigured(await getSettings()) || !!config.apiKey || managedAvailable,
    processingAvailable: await processingAvailable(),
    transcriptionModel: config.transcriptionModel,
    visionModel: config.visionModel,
  };
}
export async function workspace(eventId: number, manage: boolean) {
  const [row] = await db.select().from(meetingMinutesTable).where(eq(meetingMinutesTable.eventId, eventId));
  const status = manage ? await aiStatus() : null;
  return {
    eventId, enabled: manage ? (row?.enabled ?? false) : !!(row?.enabled && row.publishedText),
    canManage: manage, revision: manage ? (row?.revision ?? 0) : 0,
    draftText: manage ? (row?.draftText ?? "") : null,
    publishedText: row?.enabled ? (row.publishedText ?? null) : null,
    publishedAt: row?.enabled ? (row.publishedAt?.toISOString() ?? null) : null,
    generationStatus: manage ? (row?.generationStatus ?? "idle") : "idle",
    generationError: manage ? (row?.generationError ?? null) : null,
    writingConfigured: status?.writingConfigured ?? false,
    multimediaConfigured: !!(status?.apiKeyConfigured || status?.managedAvailable),
    processingAvailable: status?.processingAvailable ?? false,
    sources: manage ? (await db.select().from(meetingMinutesSourcesTable).where(eq(meetingMinutesSourcesTable.eventId, eventId)).orderBy(asc(meetingMinutesSourcesTable.id))).map(sourceDto) : [],
    messages: manage ? (await db.select().from(meetingMinutesMessagesTable).where(eq(meetingMinutesMessagesTable.eventId, eventId)).orderBy(desc(meetingMinutesMessagesTable.id)).limit(50)).reverse().map(m => ({
      id: m.id, role: m.role, content: m.content, createdAt: m.createdAt.toISOString(),
    })) : [],
  };
}
export function sourceDto(s: typeof meetingMinutesSourcesTable.$inferSelect) {
  return { id: s.id, fileName: s.fileName, contentType: s.contentType, size: s.size, purpose: s.purpose, status: s.status, extractedText: s.extractedText, error: s.error, createdAt: s.createdAt.toISOString() };
}
export async function lockMinutes(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], eventId: number, revision?: number) {
  await tx.insert(meetingMinutesTable).values({ eventId }).onConflictDoNothing();
  const [row] = await tx.select().from(meetingMinutesTable).where(eq(meetingMinutesTable.eventId, eventId)).for("update");
  if (!row || (revision !== undefined && row.revision !== revision)) throw new AttendanceError(409, "El acta ha cambiado en otra sesión. Actualiza antes de guardar; conserva tus cambios para no perderlos.");
  return row;
}
export async function ownedSource(path: string, userId: number, expectedBytes: number) {
  if (!/^\/objects\/uploads\/[a-f0-9-]{36}$/i.test(path)) throw new AttendanceError(400, "La ruta del archivo no es válida.");
  const file = await storage.getObjectEntityFile(path).catch(() => { throw new AttendanceError(404, "El archivo no se ha recibido."); });
  const acl = await getObjectAclPolicy(file);
  if (acl && (acl.owner !== String(userId) || acl.visibility !== "private" || (acl.aclRules?.length ?? 0) > 0)) throw new AttendanceError(403, "El archivo no es una subida privada disponible de tu cuenta.");
  const response = await storage.downloadObject(file, 0);
  try {
    const size = Number(response.headers.get("content-length"));
    if (!response.ok || !Number.isSafeInteger(size) || size !== expectedBytes || size > MAX_SOURCE_BYTES) throw new AttendanceError(400, "El tamaño real del archivo no coincide con la subida.");
  } finally { await response.body?.cancel(); }
  return file;
}
