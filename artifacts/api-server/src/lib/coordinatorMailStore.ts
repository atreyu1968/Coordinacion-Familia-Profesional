import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  coordinatorMailAccountsTable, coordinatorMailAttachmentsTable, coordinatorMailCaseNotesTable,
  coordinatorMailCasesTable, coordinatorMailMessagesTable, coordinatorMailOutboxTable,
  coordinatorMailSettingsTable, db, usersTable,
} from "@workspace/db";
import { getAppBaseUrl } from "./appUrl";
import { aiStatus } from "./meetingMinutes";
import { getGmailConfiguration } from "./coordinatorMailGmail";
import type { Request } from "express";
import { AttendanceError } from "./eventCertificates";

export const CASE_PAGE_SIZE = 20;
export const MESSAGE_PAGE_SIZE = 40;

export async function requireMailCoordinator(request: Request): Promise<{ id: number; name: string; email: string; role: string }> {
  const [id] = [Number(request.user?.id)];
  if (!Number.isSafeInteger(id) || id <= 0) throw new AttendanceError(401, "Inicia sesión para acceder a tu correo de coordinación.");
  const [user] = await db.select({
    id: usersTable.id, name: usersTable.name, email: usersTable.email,
    role: usersTable.role, status: usersTable.status,
  }).from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user || user.status !== "active") throw new AttendanceError(403, "Esta cuenta no está activa.");
  if (user.role !== "coordinator" && user.role !== "superadmin") throw new AttendanceError(403, "Solo la coordinación tiene acceso a esta sección privada.");
  return user;
}

export async function requireMailAdmin(request: Request): Promise<{ id: number; name: string; email: string }> {
  const user = await requireMailCoordinator(request);
  if (user.role !== "superadmin") throw new AttendanceError(403, "Solo la superadministración puede configurar la conexión Gmail de la aplicación.");
  return user;
}

export function mailCaseId(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new AttendanceError(400, "Identificador de asunto no válido.");
  return id;
}

export async function getOwnedCase(ownerId: number, id: number) {
  const [row] = await db.select().from(coordinatorMailCasesTable)
    .where(and(eq(coordinatorMailCasesTable.id, id), eq(coordinatorMailCasesTable.ownerId, ownerId)))
    .limit(1);
  if (!row) throw new AttendanceError(404, "No se encontró el asunto.");
  return row;
}

export function safeStatus(value: unknown): "open" | "waiting" | "closed" {
  if (value !== "open" && value !== "waiting" && value !== "closed") {
    throw new AttendanceError(400, "Estado de asunto no válido.");
  }
  return value;
}

function latestOutboxStatus(status: string | undefined): string | null {
  if (!status) return null;
  return ["queued", "sending", "sent", "failed", "unknown"].includes(status) ? status : "unknown";
}

export async function connectionDto(ownerId: number) {
  const [account] = await db.select().from(coordinatorMailAccountsTable)
    .where(eq(coordinatorMailAccountsTable.userId, ownerId)).limit(1);
  const config = await getGmailConfiguration().catch(() => null);
  const connected = !!(account?.email && account.accessTokenEncrypted && account.refreshTokenEncrypted);
  let status: "idle" | "queued" | "syncing" | "error" | "needs_reauthorization" | "needs_configuration";
  if (!config) status = "needs_configuration";
  else if (!connected) status = "idle";
  else if (account.syncStatus === "syncing") status = "syncing";
  else if (account.syncStatus === "queued") status = "queued";
  else if (account.syncStatus === "needs_reauthorization") status = "needs_reauthorization";
  else if (account.syncStatus === "error") status = "error";
  else status = "idle";
  return {
    connected, email: connected ? account.email : null, status,
    syncError: account?.syncError ?? null,
    lastSyncAt: account?.lastSyncAt ?? null,
    messagesImported: account?.syncMessagesImported ?? 0,
    oauthAvailable: !!config,
  };
}

export async function getMailAdminSettings(request: Request) {
  const base = getAppBaseUrl(request);
  const expectedRedirect = `${base}/api/coordinator-mail/gmail/callback`;
  const [settings] = await db.select().from(coordinatorMailSettingsTable)
    .where(eq(coordinatorMailSettingsTable.id, 1)).limit(1);
  return {
    clientId: settings?.googleClientId ?? null,
    clientSecretConfigured: !!settings?.googleClientSecretEncrypted,
    redirectUri: settings?.googleRedirectUri ?? expectedRedirect,
    ready: !!(settings?.googleClientId && settings.googleClientSecretEncrypted &&
      (settings.googleRedirectUri ?? expectedRedirect) === expectedRedirect),
  };
}

export async function mailWorkspace(ownerId: number, query: {
  page?: number; status?: string; search?: string;
}) {
  const page = query.page ?? 1;
  const where = [
    eq(coordinatorMailCasesTable.ownerId, ownerId),
    query.status ? eq(coordinatorMailCasesTable.status, query.status) : undefined,
    query.search ? or(
      ilike(coordinatorMailCasesTable.title, `%${query.search}%`),
      sql`exists (
        select 1 from ${coordinatorMailMessagesTable}
        where ${coordinatorMailMessagesTable.caseId} = ${coordinatorMailCasesTable.id}
        and (
          ${coordinatorMailMessagesTable.subject} ilike ${`%${query.search}%`} or
          ${coordinatorMailMessagesTable.senderEmail} ilike ${`%${query.search}%`} or
          ${coordinatorMailMessagesTable.bodyText} ilike ${`%${query.search}%`}
        )
      )`,
    ) : undefined,
  ].filter(Boolean);
  const condition = and(...where);
  const [{ total }] = await db.select({ total: count() }).from(coordinatorMailCasesTable).where(condition);
  const cases = await db.select().from(coordinatorMailCasesTable).where(condition)
    .orderBy(desc(coordinatorMailCasesTable.lastActivityAt), desc(coordinatorMailCasesTable.id))
    .limit(CASE_PAGE_SIZE).offset((page - 1) * CASE_PAGE_SIZE);
  const caseIds = cases.map(c => c.id);
  const messageCounts = caseIds.length ? await db.select({
    caseId: coordinatorMailMessagesTable.caseId, total: count(),
  }).from(coordinatorMailMessagesTable)
    .where(inArray(coordinatorMailMessagesTable.caseId, caseIds))
    .groupBy(coordinatorMailMessagesTable.caseId) : [];
  const latestMessages = caseIds.length ? await Promise.all(caseIds.map(async caseId => {
    const [message] = await db.select().from(coordinatorMailMessagesTable)
      .where(eq(coordinatorMailMessagesTable.caseId, caseId))
      .orderBy(desc(coordinatorMailMessagesTable.receivedAt), desc(coordinatorMailMessagesTable.id)).limit(1);
    return message;
  })) : [];
  const attachmentsPerCase = caseIds.length ? await db.select({
    caseId: coordinatorMailMessagesTable.caseId, total: count(),
  }).from(coordinatorMailAttachmentsTable)
    .innerJoin(coordinatorMailMessagesTable, eq(coordinatorMailMessagesTable.id, coordinatorMailAttachmentsTable.messageId))
    .where(inArray(coordinatorMailMessagesTable.caseId, caseIds))
    .groupBy(coordinatorMailMessagesTable.caseId) : [];
  const outboxes = caseIds.length ? await Promise.all(caseIds.map(async caseId => {
    const [outbox] = await db.select().from(coordinatorMailOutboxTable)
      .where(eq(coordinatorMailOutboxTable.caseId, caseId))
      .orderBy(desc(coordinatorMailOutboxTable.id)).limit(1);
    return outbox;
  })) : [];
  const messageCountByCase = new Map(messageCounts.map(row => [row.caseId, Number(row.total)]));
  const attachmentCountByCase = new Map(attachmentsPerCase.map(row => [row.caseId, Number(row.total)]));
  const latestMessageByCase = new Map(cases.map((row, i) => [row.id, latestMessages[i]]));
  const outboxByCase = new Map(outboxes.filter(Boolean).map(row => [row.caseId, row.status]));
  const ai = await aiStatus().catch(() => ({ writingConfigured: false }));
  return {
    ownerId, page, pageSize: CASE_PAGE_SIZE, total: Number(total),
    connection: await connectionDto(ownerId), aiAvailable: ai.writingConfigured,
    items: cases.map(c => {
      const latest = latestMessageByCase.get(c.id);
      return {
        id: c.id, title: c.title, status: safeStatus(c.status), dueAt: c.dueAt,
        revision: c.revision, lastActivityAt: c.lastActivityAt,
        messageCount: messageCountByCase.get(c.id) ?? 0,
        attachmentCount: attachmentCountByCase.get(c.id) ?? 0,
        latestSubject: latest?.subject ?? null, latestSender: latest?.senderEmail ?? null,
        aiStatus: ["idle", "queued", "processing", "error"].includes(c.aiStatus) ? c.aiStatus : "error",
        aiError: c.aiError, draftTo: c.draftTo, draftSubject: c.draftSubject,
        draftBody: c.draftBody, outboxStatus: latestOutboxStatus(outboxByCase.get(c.id)),
      };
    }),
  };
}

export async function mailCaseDetail(ownerId: number, id: number, requestedPage = 1) {
  const row = await getOwnedCase(ownerId, id);
  const [{ total }] = await db.select({ total: count() }).from(coordinatorMailMessagesTable)
    .where(eq(coordinatorMailMessagesTable.caseId, id));
  const messages = await db.select().from(coordinatorMailMessagesTable)
    .where(eq(coordinatorMailMessagesTable.caseId, id))
    .orderBy(desc(coordinatorMailMessagesTable.receivedAt), desc(coordinatorMailMessagesTable.id))
    .limit(MESSAGE_PAGE_SIZE).offset((requestedPage - 1) * MESSAGE_PAGE_SIZE);
  const messageIds = messages.map(m => m.id);
  const attachments = messageIds.length ? await db.select().from(coordinatorMailAttachmentsTable)
    .where(inArray(coordinatorMailAttachmentsTable.messageId, messageIds))
    .orderBy(coordinatorMailAttachmentsTable.id) : [];
  const attachmentByMessage = new Map<number, typeof attachments>();
  for (const attachment of attachments) attachmentByMessage.set(attachment.messageId, [...(attachmentByMessage.get(attachment.messageId) ?? []), attachment]);
  const notesRows = await db.select({
    id: coordinatorMailCaseNotesTable.id,
    kind: coordinatorMailCaseNotesTable.kind,
    content: coordinatorMailCaseNotesTable.content,
    createdAt: coordinatorMailCaseNotesTable.createdAt,
    author: usersTable.name,
  }).from(coordinatorMailCaseNotesTable)
    .leftJoin(usersTable, eq(usersTable.id, coordinatorMailCaseNotesTable.createdBy))
    .where(eq(coordinatorMailCaseNotesTable.caseId, id))
    .orderBy(desc(coordinatorMailCaseNotesTable.createdAt), desc(coordinatorMailCaseNotesTable.id))
    .limit(100);
  const [latestOutbox] = await db.select().from(coordinatorMailOutboxTable)
    .where(eq(coordinatorMailOutboxTable.caseId, id))
    .orderBy(desc(coordinatorMailOutboxTable.id)).limit(1);
  const [{ total: attachmentTotal }] = await db.select({ total: count() })
    .from(coordinatorMailAttachmentsTable)
    .innerJoin(coordinatorMailMessagesTable, eq(coordinatorMailMessagesTable.id, coordinatorMailAttachmentsTable.messageId))
    .where(eq(coordinatorMailMessagesTable.caseId, id));
  return {
    id: row.id, title: row.title, status: safeStatus(row.status), dueAt: row.dueAt,
    revision: row.revision, lastActivityAt: row.lastActivityAt,
    messageCount: Number(total), attachmentCount: Number(attachmentTotal),
    latestSubject: messages[0]?.subject ?? null, latestSender: messages[0]?.senderEmail ?? null,
    aiStatus: ["idle", "queued", "processing", "error"].includes(row.aiStatus) ? row.aiStatus : "error",
    aiError: row.aiError, draftTo: row.draftTo, draftSubject: row.draftSubject,
    draftBody: row.draftBody, outboxStatus: latestOutboxStatus(latestOutbox?.status),
    notes: notesRows.reverse().map(n => ({ ...n, author: n.author || "Usuario eliminado" })),
    messages: {
      items: messages.map(m => ({
        id: m.id, direction: m.direction === "sent" ? "sent" : "received",
        senderEmail: m.senderEmail, senderName: m.senderName,
        toEmails: m.toEmails, ccEmails: m.ccEmails,
        subject: m.subject, bodyText: m.bodyText,
        bodyTruncated: m.bodyTruncated,
        receivedAt: m.receivedAt,
        attachments: (attachmentByMessage.get(m.id) ?? []).map(a => ({
          id: a.id, fileName: a.fileName, contentType: a.contentType,
          size: a.size, status: ["queued", "ready", "error"].includes(a.status) ? a.status : "error",
          error: a.error,
        })),
      })),
      page: requestedPage, pageSize: MESSAGE_PAGE_SIZE, total: Number(total),
    },
  };
}
