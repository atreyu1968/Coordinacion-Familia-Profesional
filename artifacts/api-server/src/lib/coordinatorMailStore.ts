import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  coordinatorMailAccountsTable, coordinatorMailAttachmentsTable, coordinatorMailCaseNotesTable,
  coordinatorMailCaseGroupsTable, coordinatorMailCasesTable, coordinatorMailMessagesTable, coordinatorMailOutboxTable,
  coordinatorMailSettingsTable, db, usersTable,
} from "@workspace/db";
import { getAppBaseUrl } from "./appUrl";
import { aiStatus } from "./meetingMinutes";
import { getGmailConfiguration } from "./coordinatorMailGmail";
import type { Request } from "express";
import { AttendanceError } from "./eventCertificates";

export const CASE_PAGE_SIZE = 20;
export const MESSAGE_PAGE_SIZE = 40;

export async function requireMailCoordinator(request: Request): Promise<{ id: number; name: string; email: string; role: string; provinceId: number | null }> {
  const [id] = [Number(request.user?.id)];
  if (!Number.isSafeInteger(id) || id <= 0) throw new AttendanceError(401, "Inicia sesión para acceder a tu correo de coordinación.");
  const [user] = await db.select({
    id: usersTable.id, name: usersTable.name, email: usersTable.email,
    role: usersTable.role, status: usersTable.status, provinceId: usersTable.provinceId,
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

async function ownedGroupCases(ownerId: number, row: typeof coordinatorMailCasesTable.$inferSelect) {
  if (row.groupId == null) return [row];
  const [group] = await db.select({ id: coordinatorMailCaseGroupsTable.id })
    .from(coordinatorMailCaseGroupsTable)
    .where(and(eq(coordinatorMailCaseGroupsTable.id, row.groupId), eq(coordinatorMailCaseGroupsTable.ownerId, ownerId)))
    .limit(1);
  if (!group) return [row];
  return db.select().from(coordinatorMailCasesTable)
    .where(and(eq(coordinatorMailCasesTable.ownerId, ownerId), eq(coordinatorMailCasesTable.groupId, row.groupId)))
    .orderBy(coordinatorMailCasesTable.id);
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
    sql`(${coordinatorMailCasesTable.groupId} IS NULL OR ${coordinatorMailCasesTable.id} = (
      SELECT MIN(group_root.id) FROM coordinator_mail_cases AS group_root
      WHERE group_root.owner_id = ${ownerId} AND group_root.group_id = ${coordinatorMailCasesTable.groupId}
    ))`,
    query.status ? eq(coordinatorMailCasesTable.status, query.status) : undefined,
    query.search ? sql`exists (
      select 1 from coordinator_mail_cases as related_case
      where related_case.owner_id = ${ownerId}
        and (
          related_case.id = ${coordinatorMailCasesTable.id}
          or (${coordinatorMailCasesTable.groupId} is not null and related_case.group_id = ${coordinatorMailCasesTable.groupId})
        )
        and (
          related_case.title ilike ${`%${query.search}%`}
          or exists (
            select 1 from coordinator_mail_messages as related_message
            where related_message.owner_id = ${ownerId}
              and related_message.case_id = related_case.id
              and (related_message.subject ilike ${`%${query.search}%`}
                or related_message.sender_email ilike ${`%${query.search}%`}
                or related_message.body_text ilike ${`%${query.search}%`})
          )
        )
    )` : undefined,
  ].filter(Boolean);
  const condition = and(...where);
  const [{ total }] = await db.select({ total: count() }).from(coordinatorMailCasesTable).where(condition);
  const cases = await db.select().from(coordinatorMailCasesTable).where(condition)
    .orderBy(desc(coordinatorMailCasesTable.lastActivityAt), desc(coordinatorMailCasesTable.id))
    .limit(CASE_PAGE_SIZE).offset((page - 1) * CASE_PAGE_SIZE);
  const groupIds = cases.map(c => c.groupId).filter((id): id is number => id != null);
  const memberCases = cases.length ? await db.select({
    id: coordinatorMailCasesTable.id, title: coordinatorMailCasesTable.title,
    groupId: coordinatorMailCasesTable.groupId, lastActivityAt: coordinatorMailCasesTable.lastActivityAt,
  }).from(coordinatorMailCasesTable).where(and(
    eq(coordinatorMailCasesTable.ownerId, ownerId),
    or(inArray(coordinatorMailCasesTable.id, cases.map(c => c.id)),
      ...(groupIds.length ? [inArray(coordinatorMailCasesTable.groupId, groupIds)] : [])),
  )) : [];
  const rootByCase = new Map<number, number>();
  const membersByRoot = new Map<number, typeof memberCases>();
  for (const root of cases) membersByRoot.set(root.id, []);
  for (const member of memberCases) {
    const root = member.groupId == null ? member.id
      : cases.find(c => c.groupId === member.groupId)?.id ?? member.id;
    rootByCase.set(member.id, root);
    membersByRoot.set(root, [...(membersByRoot.get(root) ?? []), member]);
  }
  const allMemberIds = memberCases.map(c => c.id);
  const messageCounts = allMemberIds.length ? await db.select({
    caseId: coordinatorMailMessagesTable.caseId, total: count(),
  }).from(coordinatorMailMessagesTable)
    .where(and(eq(coordinatorMailMessagesTable.ownerId, ownerId), inArray(coordinatorMailMessagesTable.caseId, allMemberIds)))
    .groupBy(coordinatorMailMessagesTable.caseId) : [];
  const latestMessages = cases.length ? await Promise.all(cases.map(async c => {
    const memberIds = (membersByRoot.get(c.id) ?? [c]).map(member => member.id);
    const [message] = await db.select().from(coordinatorMailMessagesTable)
      .where(and(eq(coordinatorMailMessagesTable.ownerId, ownerId), inArray(coordinatorMailMessagesTable.caseId, memberIds)))
      .orderBy(desc(coordinatorMailMessagesTable.receivedAt), desc(coordinatorMailMessagesTable.id)).limit(1);
    return message;
  })) : [];
  const attachmentsPerCase = allMemberIds.length ? await db.select({
    caseId: coordinatorMailMessagesTable.caseId, total: count(),
  }).from(coordinatorMailAttachmentsTable)
    .innerJoin(coordinatorMailMessagesTable, eq(coordinatorMailMessagesTable.id, coordinatorMailAttachmentsTable.messageId))
    .where(and(eq(coordinatorMailMessagesTable.ownerId, ownerId), inArray(coordinatorMailMessagesTable.caseId, allMemberIds)))
    .groupBy(coordinatorMailMessagesTable.caseId) : [];
  const outboxes = cases.length ? await Promise.all(cases.map(async c => {
    const [outbox] = await db.select().from(coordinatorMailOutboxTable)
      .where(eq(coordinatorMailOutboxTable.caseId, c.id))
      .orderBy(desc(coordinatorMailOutboxTable.id)).limit(1);
    return outbox;
  })) : [];
  const messageCountByCase = new Map(messageCounts.map(row => [row.caseId, Number(row.total)]));
  const attachmentCountByCase = new Map(attachmentsPerCase.map(row => [row.caseId, Number(row.total)]));
  const latestMessageByCase = new Map<number, typeof latestMessages[number]>();
  for (const message of latestMessages) {
    const root = rootByCase.get(message.caseId);
    if (root != null && !latestMessageByCase.has(root)) latestMessageByCase.set(root, message);
  }
  const outboxByCase = new Map(outboxes.filter(Boolean).map(row => [row.caseId, row.status]));
  const ai = await aiStatus().catch(() => ({ writingConfigured: false }));
  return {
    ownerId, page, pageSize: CASE_PAGE_SIZE, total: Number(total),
    connection: await connectionDto(ownerId), aiAvailable: ai.writingConfigured,
    items: cases.map(c => {
      const latest = latestMessageByCase.get(c.id);
      const members = membersByRoot.get(c.id) ?? [c];
      const messageCount = members.reduce((n, member) => n + (messageCountByCase.get(member.id) ?? 0), 0);
      const attachmentCount = members.reduce((n, member) => n + (attachmentCountByCase.get(member.id) ?? 0), 0);
      const lastActivityAt = members.reduce((latestDate, member) =>
        member.lastActivityAt > latestDate ? member.lastActivityAt : latestDate, c.lastActivityAt);
      return {
        id: c.id, title: c.title, status: safeStatus(c.status), dueAt: c.dueAt,
        revision: c.revision, lastActivityAt,
        messageCount, attachmentCount, linkedCaseCount: members.length,
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
  const linkedCases = await ownedGroupCases(ownerId, row);
  const caseIds = linkedCases.map(c => c.id);
  const titleByCase = new Map(linkedCases.map(c => [c.id, c.title]));
  const [{ total }] = await db.select({ total: count() }).from(coordinatorMailMessagesTable)
    .where(and(eq(coordinatorMailMessagesTable.ownerId, ownerId), inArray(coordinatorMailMessagesTable.caseId, caseIds)));
  const messages = await db.select().from(coordinatorMailMessagesTable)
    .where(and(eq(coordinatorMailMessagesTable.ownerId, ownerId), inArray(coordinatorMailMessagesTable.caseId, caseIds)))
    .orderBy(desc(coordinatorMailMessagesTable.receivedAt), desc(coordinatorMailMessagesTable.id))
    .limit(MESSAGE_PAGE_SIZE).offset((requestedPage - 1) * MESSAGE_PAGE_SIZE);
  const [latestMessage] = requestedPage === 1 ? messages : await db.select().from(coordinatorMailMessagesTable)
    .where(and(eq(coordinatorMailMessagesTable.ownerId, ownerId), inArray(coordinatorMailMessagesTable.caseId, caseIds)))
    .orderBy(desc(coordinatorMailMessagesTable.receivedAt), desc(coordinatorMailMessagesTable.id)).limit(1);
  const messageIds = messages.map(m => m.id);
  const attachments = messageIds.length ? await db.select().from(coordinatorMailAttachmentsTable)
    .where(inArray(coordinatorMailAttachmentsTable.messageId, messageIds))
    .orderBy(coordinatorMailAttachmentsTable.id) : [];
  const attachmentByMessage = new Map<number, typeof attachments>();
  for (const attachment of attachments) attachmentByMessage.set(attachment.messageId, [...(attachmentByMessage.get(attachment.messageId) ?? []), attachment]);
  const notesRows = await db.select({
    id: coordinatorMailCaseNotesTable.id,
    caseId: coordinatorMailCasesTable.id,
    caseTitle: coordinatorMailCasesTable.title,
    kind: coordinatorMailCaseNotesTable.kind,
    content: coordinatorMailCaseNotesTable.content,
    createdAt: coordinatorMailCaseNotesTable.createdAt,
    author: usersTable.name,
  }).from(coordinatorMailCaseNotesTable)
    .innerJoin(coordinatorMailCasesTable, eq(coordinatorMailCasesTable.id, coordinatorMailCaseNotesTable.caseId))
    .leftJoin(usersTable, eq(usersTable.id, coordinatorMailCaseNotesTable.createdBy))
    .where(and(eq(coordinatorMailCasesTable.ownerId, ownerId), inArray(coordinatorMailCaseNotesTable.caseId, caseIds)))
    .orderBy(desc(coordinatorMailCaseNotesTable.createdAt), desc(coordinatorMailCaseNotesTable.id))
    .limit(100);
  const [latestOutbox] = await db.select().from(coordinatorMailOutboxTable)
    .where(eq(coordinatorMailOutboxTable.caseId, id))
    .orderBy(desc(coordinatorMailOutboxTable.id)).limit(1);
  const [{ total: attachmentTotal }] = await db.select({ total: count() })
    .from(coordinatorMailAttachmentsTable)
    .innerJoin(coordinatorMailMessagesTable, eq(coordinatorMailMessagesTable.id, coordinatorMailAttachmentsTable.messageId))
    .where(and(eq(coordinatorMailMessagesTable.ownerId, ownerId), inArray(coordinatorMailMessagesTable.caseId, caseIds)));
  return {
    id: row.id, title: row.title, status: safeStatus(row.status), dueAt: row.dueAt,
    revision: row.revision, lastActivityAt: row.lastActivityAt,
    messageCount: Number(total), attachmentCount: Number(attachmentTotal), linkedCaseCount: linkedCases.length,
    latestSubject: latestMessage?.subject ?? null, latestSender: latestMessage?.senderEmail ?? null,
    aiStatus: ["idle", "queued", "processing", "error"].includes(row.aiStatus) ? row.aiStatus : "error",
    aiError: row.aiError, draftTo: row.draftTo, draftSubject: row.draftSubject,
    draftBody: row.draftBody, outboxStatus: latestOutboxStatus(latestOutbox?.status),
    linkedCases: linkedCases.map(c => ({ id: c.id, title: c.title, isCurrent: c.id === id })),
    notes: notesRows.reverse().map(n => ({ ...n, author: n.author || "Usuario eliminado" })),
    messages: {
      items: messages.map(m => ({
        id: m.id, caseId: m.caseId, caseTitle: titleByCase.get(m.caseId) ?? "Caso original",
        direction: m.direction === "sent" ? "sent" : "received",
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
