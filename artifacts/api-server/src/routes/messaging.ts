import { Router, type Request, type Response } from "express";
import { Readable } from "stream";
import { and, eq, inArray, desc, asc, isNull } from "drizzle-orm";
import {
  db,
  chatGroupsTable,
  chatGroupMembersTable,
  messagesTable,
  messageReactionsTable,
  announcementsTable,
  announcementAttachmentsTable,
  notificationsTable,
  pushTokensTable,
  usersTable,
  modulesTable,
  teachingAssignmentsTable,
  centersTable,
} from "@workspace/db";
import {
  ListChatGroupsResponse,
  CreateChatGroupBody,
  SyncModuleChatGroupsResponse,
  MarkChatReadParams,
  ListGroupMessagesParams,
  ListGroupMessagesResponse,
  SendGroupMessageParams,
  SendGroupMessageBody,
  ListChatMembersParams,
  ListChatMembersResponse,
  EditMessageParams,
  EditMessageBody,
  DeleteMessageParams,
  ReactToMessageParams,
  ReactToMessageBody,
  ForwardMessageParams,
  ForwardMessageBody,
  ListAnnouncementsResponse,
  CreateAnnouncementBody,
  DeleteAnnouncementParams,
  ListNotificationsResponse,
  MarkNotificationReadParams,
  RegisterPushTokenBody,
} from "@workspace/api-zod";
import {
  requireAuth,
  requireRole,
  hasScopeOver,
} from "../middlewares/auth";
import { syncModuleChatGroup } from "@workspace/db";
import {
  toChatGroup,
  toMessage,
  toChatMember,
  toAnnouncement,
  toNotification,
} from "../lib/mappers";
import { emitToGroup, emitToUser } from "../lib/realtime";
import { notifyUsers } from "../lib/notify";
import {
  getViewerContext,
  isInAudience,
  validateAudience,
  canManageAudience,
  resolveAudienceUserIds,
} from "../lib/audience";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { getObjectAclPolicy, setObjectAclPolicy } from "../lib/objectAcl";
import { sendPushToUsers } from "../lib/push";
import { sendEmail } from "../lib/email";
import { logger } from "../lib/logger";

const router = Router();
const objectStorageService = new ObjectStorageService();

// A short human-readable label for an announcement's audience, shown on cards.
function announcementAudienceLabel(
  type: string,
  ids: number[] | null | undefined,
  moduleName?: string | null,
): string {
  const n = (ids ?? []).length;
  switch (type) {
    case "all":
      return "Todos los usuarios";
    case "module":
      return moduleName ?? (n > 1 ? `${n} módulos` : "Módulo");
    case "province":
      return n > 1 ? `${n} provincias` : "Provincia";
    case "island":
      return n > 1 ? `${n} islas` : "Isla";
    case "center":
      return n > 1 ? `${n} centros` : "Centro";
    case "users":
      return n > 1 ? `${n} usuarios` : "1 usuario";
    case "department_head":
      return "Jefes de departamento";
    case "coordinator":
      return "Coordinadores provinciales";
    default:
      return "Destinatarios";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function isGroupMember(
  groupId: number,
  userId: number,
): Promise<boolean> {
  const [m] = await db
    .select({ id: chatGroupMembersTable.id })
    .from(chatGroupMembersTable)
    .where(
      and(
        eq(chatGroupMembersTable.groupId, groupId),
        eq(chatGroupMembersTable.userId, userId),
      ),
    );
  return Boolean(m);
}

// The full set of message columns we read for the rich chat UI.
const messageColumns = {
  id: messagesTable.id,
  groupId: messagesTable.groupId,
  senderId: messagesTable.senderId,
  senderName: usersTable.name,
  recipientId: messagesTable.recipientId,
  content: messagesTable.content,
  kind: messagesTable.kind,
  replyToId: messagesTable.replyToId,
  forwardedFrom: messagesTable.forwardedFrom,
  attachmentPath: messagesTable.attachmentPath,
  attachmentName: messagesTable.attachmentName,
  attachmentType: messagesTable.attachmentType,
  attachmentSize: messagesTable.attachmentSize,
  editedAt: messagesTable.editedAt,
  deletedAt: messagesTable.deletedAt,
  createdAt: messagesTable.createdAt,
};

type MessageRow = {
  id: number;
  groupId: number | null;
  senderId: number;
  senderName: string | null;
  recipientId: number | null;
  content: string;
  kind: string;
  replyToId: number | null;
  forwardedFrom: string | null;
  attachmentPath: string | null;
  attachmentName: string | null;
  attachmentType: string | null;
  attachmentSize: number | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
};

// Enrich raw message rows with aggregated reactions, reply previews and read
// receipts, returning DTOs ready for the API contract. `memberReads` holds the
// per-member lastReadAt markers for the group (drives the read-receipt ticks).
async function assembleMessages(
  rows: MessageRow[],
  callerId: number,
  memberReads: { userId: number; lastReadAt: Date | null }[],
) {
  const ids = rows.map((r) => r.id);

  // Reactions, aggregated per message+emoji.
  const reactionRows = ids.length
    ? await db
        .select({
          messageId: messageReactionsTable.messageId,
          userId: messageReactionsTable.userId,
          emoji: messageReactionsTable.emoji,
        })
        .from(messageReactionsTable)
        .where(inArray(messageReactionsTable.messageId, ids))
        .orderBy(asc(messageReactionsTable.id))
    : [];
  const reactionMap = new Map<
    number,
    Map<string, { count: number; mine: boolean }>
  >();
  for (const r of reactionRows) {
    const m = reactionMap.get(r.messageId) ?? new Map();
    const e = m.get(r.emoji) ?? { count: 0, mine: false };
    e.count += 1;
    if (r.userId === callerId) e.mine = true;
    m.set(r.emoji, e);
    reactionMap.set(r.messageId, m);
  }

  // Reply/quote previews (a single lookup of the referenced messages).
  const replyIds = Array.from(
    new Set(rows.map((r) => r.replyToId).filter((x): x is number => x != null)),
  );
  const replyMap = new Map<
    number,
    { content: string; senderName: string | null; deletedAt: Date | null }
  >();
  if (replyIds.length) {
    const rrows = await db
      .select({
        id: messagesTable.id,
        content: messagesTable.content,
        senderName: usersTable.name,
        deletedAt: messagesTable.deletedAt,
      })
      .from(messagesTable)
      .leftJoin(usersTable, eq(usersTable.id, messagesTable.senderId))
      .where(inArray(messagesTable.id, replyIds));
    for (const rr of rrows) replyMap.set(rr.id, rr);
  }

  return rows.map((row) => {
    const rMap = reactionMap.get(row.id);
    const reactions = rMap
      ? Array.from(rMap.entries()).map(([emoji, v]) => ({
          emoji,
          count: v.count,
          reactedByMe: v.mine,
        }))
      : [];
    let replyToContent: string | null = null;
    let replyToSenderName: string | null = null;
    if (row.replyToId != null) {
      const rp = replyMap.get(row.replyToId);
      if (rp) {
        replyToContent = rp.deletedAt
          ? "Mensaje eliminado"
          : rp.content || "Archivo adjunto";
        replyToSenderName = rp.senderName;
      }
    }
    // A member (other than the sender) has "read" a message when their read
    // marker is at or after the message's timestamp.
    const readByCount = memberReads.filter(
      (m) =>
        m.userId !== row.senderId &&
        m.lastReadAt != null &&
        m.lastReadAt.getTime() >= row.createdAt.getTime(),
    ).length;
    return toMessage({
      ...row,
      replyToContent,
      replyToSenderName,
      reactions,
      readByCount,
    });
  });
}

async function groupMemberReads(groupId: number) {
  return db
    .select({
      userId: chatGroupMembersTable.userId,
      lastReadAt: chatGroupMembersTable.lastReadAt,
    })
    .from(chatGroupMembersTable)
    .where(eq(chatGroupMembersTable.groupId, groupId));
}

// Load + assemble a single message by id (used by edit/delete/react responses).
async function loadAssembledMessage(messageId: number, callerId: number) {
  const [row] = await db
    .select(messageColumns)
    .from(messagesTable)
    .leftJoin(usersTable, eq(usersTable.id, messagesTable.senderId))
    .where(eq(messagesTable.id, messageId));
  if (!row || row.groupId == null) return null;
  const reads = await groupMemberReads(row.groupId);
  const [dto] = await assembleMessages([row as MessageRow], callerId, reads);
  return dto ?? null;
}

// ---------------------------------------------------------------------------
// Chat groups
// ---------------------------------------------------------------------------
router.get("/chat/groups", requireAuth, async (req, res): Promise<void> => {
  const caller = req.user!;
  const memberships = await db
    .select({ groupId: chatGroupMembersTable.groupId })
    .from(chatGroupMembersTable)
    .where(eq(chatGroupMembersTable.userId, caller.id));
  const groupIds = memberships.map((m) => m.groupId);
  if (groupIds.length === 0) {
    res.json([]);
    return;
  }

  const groups = await db
    .select()
    .from(chatGroupsTable)
    .where(inArray(chatGroupsTable.id, groupIds))
    .orderBy(desc(chatGroupsTable.lastMessageAt));

  // The caller's per-group "last read" markers drive the unread counts.
  const callerMemberships = await db
    .select({
      groupId: chatGroupMembersTable.groupId,
      lastReadAt: chatGroupMembersTable.lastReadAt,
    })
    .from(chatGroupMembersTable)
    .where(
      and(
        eq(chatGroupMembersTable.userId, caller.id),
        inArray(chatGroupMembersTable.groupId, groupIds),
      ),
    );
  const lastReadByGroup = new Map<number, Date | null>();
  for (const m of callerMemberships) {
    lastReadByGroup.set(m.groupId, m.lastReadAt);
  }

  // Count messages from other members newer than the caller's read marker.
  const unreadRows = await db
    .select({
      groupId: messagesTable.groupId,
      createdAt: messagesTable.createdAt,
      senderId: messagesTable.senderId,
    })
    .from(messagesTable)
    .where(inArray(messagesTable.groupId, groupIds));
  const unreadByGroup = new Map<number, number>();
  for (const m of unreadRows) {
    if (m.groupId == null) continue;
    if (m.senderId === caller.id) continue;
    const lastRead = lastReadByGroup.get(m.groupId) ?? null;
    if (lastRead && m.createdAt.getTime() <= lastRead.getTime()) continue;
    unreadByGroup.set(m.groupId, (unreadByGroup.get(m.groupId) ?? 0) + 1);
  }

  // Member names, used to derive a display name for direct messages.
  const allMembers = await db
    .select({
      groupId: chatGroupMembersTable.groupId,
      userId: chatGroupMembersTable.userId,
      name: usersTable.name,
    })
    .from(chatGroupMembersTable)
    .leftJoin(usersTable, eq(usersTable.id, chatGroupMembersTable.userId))
    .where(inArray(chatGroupMembersTable.groupId, groupIds));

  const membersByGroup = new Map<
    number,
    { userId: number; name: string | null }[]
  >();
  for (const m of allMembers) {
    const list = membersByGroup.get(m.groupId) ?? [];
    list.push({ userId: m.userId, name: m.name });
    membersByGroup.set(m.groupId, list);
  }

  const result = groups.map((g) => {
    let name = g.name;
    if (g.type === "direct") {
      const other = (membersByGroup.get(g.id) ?? []).find(
        (m) => m.userId !== caller.id,
      );
      if (other?.name) name = other.name;
    }
    return toChatGroup({ ...g, name, unreadCount: unreadByGroup.get(g.id) ?? 0 });
  });

  res.json(ListChatGroupsResponse.parse(result));
});

router.post("/chat/groups", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateChatGroupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const caller = req.user!;
  const data = parsed.data;
  const type = data.type === "direct" ? "direct" : "group";
  const memberIds = Array.from(
    new Set([...(data.memberIds ?? []), caller.id]),
  ).filter((id) => Number.isInteger(id));

  // Direct messages: exactly one counterpart, deduped to an existing thread.
  if (type === "direct") {
    const others = memberIds.filter((id) => id !== caller.id);
    if (others.length !== 1) {
      res
        .status(400)
        .json({ message: "Un mensaje directo requiere un destinatario" });
      return;
    }
    const otherId = others[0]!;
    const callerDirect = await db
      .select({ groupId: chatGroupMembersTable.groupId })
      .from(chatGroupMembersTable)
      .innerJoin(
        chatGroupsTable,
        eq(chatGroupsTable.id, chatGroupMembersTable.groupId),
      )
      .where(
        and(
          eq(chatGroupMembersTable.userId, caller.id),
          eq(chatGroupsTable.type, "direct"),
        ),
      );
    const directIds = callerDirect.map((r) => r.groupId);
    if (directIds.length > 0) {
      const shared = await db
        .select({ groupId: chatGroupMembersTable.groupId })
        .from(chatGroupMembersTable)
        .where(
          and(
            inArray(chatGroupMembersTable.groupId, directIds),
            eq(chatGroupMembersTable.userId, otherId),
          ),
        );
      if (shared.length > 0) {
        const [existing] = await db
          .select()
          .from(chatGroupsTable)
          .where(eq(chatGroupsTable.id, shared[0]!.groupId));
        if (existing) {
          const [other] = await db
            .select({ name: usersTable.name })
            .from(usersTable)
            .where(eq(usersTable.id, otherId));
          res
            .status(200)
            .json(toChatGroup({ ...existing, name: other?.name ?? existing.name }));
          return;
        }
      }
    }
  }

  // All members must be active users.
  const validUsers = await db
    .select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable)
    .where(
      and(
        inArray(usersTable.id, memberIds),
        eq(usersTable.status, "active"),
        isNull(usersTable.deletedAt),
      ),
    );
  if (validUsers.length !== memberIds.length) {
    res.status(400).json({ message: "Algún destinatario no es válido" });
    return;
  }

  const group = await db.transaction(async (tx) => {
    const [g] = await tx
      .insert(chatGroupsTable)
      .values({
        name: data.name.trim(),
        type,
        provinceId: data.provinceId ?? null,
        centerId: data.centerId ?? null,
        createdById: caller.id,
        lastMessageAt: new Date(),
      })
      .returning();
    await tx
      .insert(chatGroupMembersTable)
      .values(memberIds.map((uid) => ({ groupId: g!.id, userId: uid })))
      .onConflictDoNothing();
    return g!;
  });

  let displayName = group.name;
  if (type === "direct") {
    const otherId = memberIds.find((id) => id !== caller.id);
    const other = validUsers.find((u) => u.id === otherId);
    if (other?.name) displayName = other.name;
  }

  res.status(201).json(toChatGroup({ ...group, name: displayName }));
});

// Provision/sync a group chat for every teaching module within the caller's
// scope, with the module's assigned teachers as members. Idempotent: creating
// the groups is a one-tap action that never duplicates them.
router.post(
  "/chat/groups/sync-modules",
  requireAuth,
  requireRole("superadmin", "coordinator", "department_head"),
  async (req, res): Promise<void> => {
    const caller = req.user!;

    // Modules that currently have at least one active assigned teacher, paired
    // with the centers those assignments belong to (used for scope filtering).
    const rows = await db
      .selectDistinct({
        moduleId: teachingAssignmentsTable.moduleId,
        centerId: teachingAssignmentsTable.centerId,
      })
      .from(teachingAssignmentsTable)
      .innerJoin(
        usersTable,
        eq(usersTable.id, teachingAssignmentsTable.teacherId),
      )
      .where(
        and(
          isNull(teachingAssignmentsTable.deletedAt),
          eq(usersTable.status, "active"),
          isNull(usersTable.deletedAt),
        ),
      );

    const centerIds = Array.from(new Set(rows.map((r) => r.centerId)));
    const centers = centerIds.length
      ? await db
          .select({ id: centersTable.id, provinceId: centersTable.provinceId })
          .from(centersTable)
          .where(inArray(centersTable.id, centerIds))
      : [];
    const provinceByCenter = new Map(centers.map((c) => [c.id, c.provinceId]));

    const moduleCenters = new Map<number, number[]>();
    for (const r of rows) {
      const list = moduleCenters.get(r.moduleId) ?? [];
      list.push(r.centerId);
      moduleCenters.set(r.moduleId, list);
    }

    let created = 0;
    let updated = 0;
    for (const [moduleId, cIds] of moduleCenters) {
      // syncModuleChatGroup recomputes membership from ALL of the module's
      // assignments, so a scoped manager may only bulk-sync modules whose
      // assignments fall entirely within their scope. Modules spanning scopes
      // are provisioned by superadmin or by the auto-sync on assignment edits.
      const inScope = cIds.every((cid) =>
        hasScopeOver(caller, {
          provinceId: provinceByCenter.get(cid) ?? null,
          centerId: cid,
        }),
      );
      if (!inScope) continue;
      const status = await syncModuleChatGroup(moduleId);
      if (status === "created") created += 1;
      else if (status === "updated") updated += 1;
    }

    res.json(SyncModuleChatGroupsResponse.parse({ created, updated }));
  },
);

// Mark a chat group as read for the caller, persisting the marker server-side
// so unread counts stay accurate across devices and reinstalls.
router.post(
  "/chat/groups/:id/read",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = MarkChatReadParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;
    const groupId = params.data.id;
    if (!(await isGroupMember(groupId, caller.id))) {
      res.status(403).json({ message: "No perteneces a este chat" });
      return;
    }
    await db
      .update(chatGroupMembersTable)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(chatGroupMembersTable.groupId, groupId),
          eq(chatGroupMembersTable.userId, caller.id),
        ),
      );
    res.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
router.get(
  "/chat/groups/:id/messages",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ListGroupMessagesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;
    const groupId = params.data.id;
    if (!(await isGroupMember(groupId, caller.id))) {
      res.status(403).json({ message: "No perteneces a este chat" });
      return;
    }

    const rows = (await db
      .select(messageColumns)
      .from(messagesTable)
      .leftJoin(usersTable, eq(usersTable.id, messagesTable.senderId))
      .where(eq(messagesTable.groupId, groupId))
      .orderBy(asc(messagesTable.createdAt))
      .limit(200)) as MessageRow[];

    const reads = await groupMemberReads(groupId);
    const dtos = await assembleMessages(rows, caller.id, reads);
    res.json(ListGroupMessagesResponse.parse(dtos));
  },
);

// List the members of a chat group (everyone who belongs to it). Used by the
// "members" panel and to label direct vs group conversations.
router.get(
  "/chat/groups/:id/members",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ListChatMembersParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;
    const groupId = params.data.id;
    if (!(await isGroupMember(groupId, caller.id))) {
      res.status(403).json({ message: "No perteneces a este chat" });
      return;
    }

    const rows = await db
      .select({
        userId: chatGroupMembersTable.userId,
        name: usersTable.name,
        role: usersTable.role,
        lastReadAt: chatGroupMembersTable.lastReadAt,
      })
      .from(chatGroupMembersTable)
      .leftJoin(usersTable, eq(usersTable.id, chatGroupMembersTable.userId))
      .where(eq(chatGroupMembersTable.groupId, groupId))
      .orderBy(asc(usersTable.name));

    res.json(ListChatMembersResponse.parse(rows.map(toChatMember)));
  },
);

router.post(
  "/chat/groups/:id/messages",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = SendGroupMessageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const body = SendGroupMessageBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
      return;
    }
    const caller = req.user!;
    const groupId = params.data.id;
    if (!(await isGroupMember(groupId, caller.id))) {
      res.status(403).json({ message: "No perteneces a este chat" });
      return;
    }

    const data = body.data;
    const allowedKinds = ["text", "image", "file", "audio"];
    const kind =
      data.kind && allowedKinds.includes(data.kind) ? data.kind : "text";
    const content = (data.content ?? "").trim();

    // A message must carry either text or an attachment.
    if (kind === "text" && !content) {
      res.status(400).json({ message: "El mensaje está vacío" });
      return;
    }
    if (kind !== "text" && !data.attachmentPath) {
      res.status(400).json({ message: "Falta el archivo adjunto" });
      return;
    }

    // Bind the uploaded object to the caller (verifies existence + ownership),
    // mirroring the announcement-attachment flow. Done BEFORE the insert.
    if (data.attachmentPath) {
      const ownerId = String(caller.id);
      let objectFile;
      try {
        objectFile = await objectStorageService.getObjectEntityFile(
          data.attachmentPath,
        );
      } catch (err) {
        if (err instanceof ObjectNotFoundError) {
          res.status(400).json({ message: "Archivo no encontrado" });
          return;
        }
        throw err;
      }
      const policy = await getObjectAclPolicy(objectFile);
      if (policy?.owner && policy.owner !== ownerId) {
        res.status(403).json({ message: "No puedes usar este archivo" });
        return;
      }
      if (!policy?.owner) {
        await setObjectAclPolicy(objectFile, {
          owner: ownerId,
          visibility: "private",
        });
      }
    }

    // A reply must reference a message in the same group.
    let replyToId: number | null = null;
    if (data.replyToId != null) {
      const [target] = await db
        .select({ id: messagesTable.id, groupId: messagesTable.groupId })
        .from(messagesTable)
        .where(eq(messagesTable.id, data.replyToId));
      if (target && target.groupId === groupId) replyToId = target.id;
    }

    const [created] = await db
      .insert(messagesTable)
      .values({
        groupId,
        senderId: caller.id,
        content,
        kind,
        replyToId,
        forwardedFrom: data.forwardedFrom?.trim() || null,
        attachmentPath: data.attachmentPath ?? null,
        attachmentName: data.attachmentName ?? null,
        attachmentType: data.attachmentType ?? null,
        attachmentSize: data.attachmentSize ?? null,
      })
      .returning();

    await db
      .update(chatGroupsTable)
      .set({ lastMessageAt: created!.createdAt })
      .where(eq(chatGroupsTable.id, groupId));

    const reads = await groupMemberReads(groupId);
    const [mapped] = await assembleMessages(
      [{ ...created!, senderName: caller.name } as MessageRow],
      caller.id,
      reads,
    );

    // Real-time delivery to everyone currently in the chat room.
    emitToGroup(groupId, "message", mapped);

    // Notify other members' personal rooms for chat-list/badge updates.
    const otherMemberIds = reads
      .map((m) => m.userId)
      .filter((id) => id !== caller.id);
    for (const userId of otherMemberIds) {
      emitToUser(userId, "chat_update", { groupId });
    }

    // Best-effort device push so members are alerted when the app is closed.
    // Real-time socket delivery (above) covers the foreground case; chat
    // messages are intentionally not persisted as in-app notifications, so we
    // push directly. The `groupId` lets a tapped notification deep-link to the
    // chat. Fire-and-forget: push failures never block sending a message.
    if (otherMemberIds.length > 0) {
      const [group] = await db
        .select({ name: chatGroupsTable.name })
        .from(chatGroupsTable)
        .where(eq(chatGroupsTable.id, groupId));
      const preview =
        kind === "image"
          ? "📷 Foto"
          : kind === "audio"
            ? "🎤 Mensaje de voz"
            : kind === "file"
              ? `📎 ${data.attachmentName ?? "Archivo"}`
              : content;
      void sendPushToUsers(otherMemberIds, {
        title: group?.name ?? "Nuevo mensaje",
        body: `${caller.name}: ${preview}`,
        data: { type: "message", groupId },
      });
    }

    res.status(201).json(mapped);
  },
);

// ---------------------------------------------------------------------------
// Message actions: edit, delete, react, forward, attachment streaming
// ---------------------------------------------------------------------------

// Edit one's own message. Author-only; sets editedAt. Deleted messages and
// attachment/voice messages cannot be edited (only text content).
router.patch(
  "/chat/messages/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = EditMessageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const body = EditMessageBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
      return;
    }
    const caller = req.user!;
    const [msg] = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.id, params.data.id));
    if (!msg) {
      res.status(404).json({ message: "Mensaje no encontrado" });
      return;
    }
    if (msg.senderId !== caller.id) {
      res.status(403).json({ message: "Solo puedes editar tus mensajes" });
      return;
    }
    if (msg.deletedAt) {
      res.status(403).json({ message: "El mensaje fue eliminado" });
      return;
    }
    if (msg.kind !== "text") {
      res.status(403).json({ message: "Solo se pueden editar mensajes de texto" });
      return;
    }
    const content = body.data.content.trim();
    if (!content) {
      res.status(400).json({ message: "El mensaje está vacío" });
      return;
    }

    await db
      .update(messagesTable)
      .set({ content, editedAt: new Date() })
      .where(eq(messagesTable.id, msg.id));

    const mapped = await loadAssembledMessage(msg.id, caller.id);
    if (msg.groupId != null) emitToGroup(msg.groupId, "message_edited", mapped);
    res.json(mapped);
  },
);

// Delete one's own message (soft delete → tombstone "Mensaje eliminado").
router.delete(
  "/chat/messages/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DeleteMessageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;
    const [msg] = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.id, params.data.id));
    if (!msg) {
      res.status(404).json({ message: "Mensaje no encontrado" });
      return;
    }
    if (msg.senderId !== caller.id) {
      res.status(403).json({ message: "Solo puedes eliminar tus mensajes" });
      return;
    }
    if (!msg.deletedAt) {
      await db
        .update(messagesTable)
        .set({ deletedAt: new Date() })
        .where(eq(messagesTable.id, msg.id));
      // Reactions on a deleted message are meaningless — clear them.
      await db
        .delete(messageReactionsTable)
        .where(eq(messageReactionsTable.messageId, msg.id));
    }

    const mapped = await loadAssembledMessage(msg.id, caller.id);
    if (msg.groupId != null) emitToGroup(msg.groupId, "message_deleted", mapped);
    res.json(mapped);
  },
);

// Toggle an emoji reaction on a message. Adding the same emoji again removes it.
router.post(
  "/chat/messages/:id/react",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ReactToMessageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const body = ReactToMessageBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
      return;
    }
    const caller = req.user!;
    const emoji = body.data.emoji.trim();
    if (!emoji) {
      res.status(400).json({ message: "Emoji no válido" });
      return;
    }
    const [msg] = await db
      .select({
        id: messagesTable.id,
        groupId: messagesTable.groupId,
        deletedAt: messagesTable.deletedAt,
      })
      .from(messagesTable)
      .where(eq(messagesTable.id, params.data.id));
    if (!msg || msg.groupId == null) {
      res.status(404).json({ message: "Mensaje no encontrado" });
      return;
    }
    if (msg.deletedAt) {
      res.status(403).json({ message: "El mensaje fue eliminado" });
      return;
    }
    if (!(await isGroupMember(msg.groupId, caller.id))) {
      res.status(403).json({ message: "No perteneces a este chat" });
      return;
    }

    const [existing] = await db
      .select({ id: messageReactionsTable.id })
      .from(messageReactionsTable)
      .where(
        and(
          eq(messageReactionsTable.messageId, msg.id),
          eq(messageReactionsTable.userId, caller.id),
          eq(messageReactionsTable.emoji, emoji),
        ),
      );
    if (existing) {
      await db
        .delete(messageReactionsTable)
        .where(eq(messageReactionsTable.id, existing.id));
    } else {
      await db
        .insert(messageReactionsTable)
        .values({ messageId: msg.id, userId: caller.id, emoji })
        .onConflictDoNothing();
    }

    const mapped = await loadAssembledMessage(msg.id, caller.id);
    emitToGroup(msg.groupId, "message_reaction", mapped);
    res.json(mapped);
  },
);

// Forward a message to one or more of the caller's chats.
router.post(
  "/chat/messages/:id/forward",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ForwardMessageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const body = ForwardMessageBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ message: body.error.message });
      return;
    }
    const caller = req.user!;
    const [src] = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.id, params.data.id));
    if (!src || src.deletedAt) {
      res.status(404).json({ message: "Mensaje no encontrado" });
      return;
    }
    // The caller must be able to see the source message.
    if (src.groupId == null || !(await isGroupMember(src.groupId, caller.id))) {
      res.status(403).json({ message: "No puedes reenviar este mensaje" });
      return;
    }

    // Resolve the original sender's name for the "Reenviado" label.
    const [origSender] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, src.senderId));
    const forwardedFrom = src.forwardedFrom ?? origSender?.name ?? null;

    const targetIds = Array.from(new Set(body.data.groupIds ?? [])).filter(
      (id) => Number.isInteger(id),
    );
    const results = [];
    for (const targetId of targetIds) {
      if (!(await isGroupMember(targetId, caller.id))) continue;
      const [created] = await db
        .insert(messagesTable)
        .values({
          groupId: targetId,
          senderId: caller.id,
          content: src.content,
          kind: src.kind,
          forwardedFrom,
          attachmentPath: src.attachmentPath,
          attachmentName: src.attachmentName,
          attachmentType: src.attachmentType,
          attachmentSize: src.attachmentSize,
        })
        .returning();
      await db
        .update(chatGroupsTable)
        .set({ lastMessageAt: created!.createdAt })
        .where(eq(chatGroupsTable.id, targetId));

      const reads = await groupMemberReads(targetId);
      const [mapped] = await assembleMessages(
        [{ ...created!, senderName: caller.name } as MessageRow],
        caller.id,
        reads,
      );
      emitToGroup(targetId, "message", mapped);
      for (const userId of reads
        .map((m) => m.userId)
        .filter((uid) => uid !== caller.id)) {
        emitToUser(userId, "chat_update", { groupId: targetId });
      }
      results.push(mapped);
    }

    res.status(201).json(results);
  },
);

// Stream a chat attachment (image/file/voice). Membership-gated; the raw object
// path is never exposed. The frontend fetches this with its Authorization
// header (so it is not generated as a typed client hook).
router.get(
  "/chat/messages/:id/attachment",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const messageId = Number(req.params.id);
    if (!Number.isInteger(messageId) || messageId <= 0) {
      res.status(400).json({ message: "Identificador no válido" });
      return;
    }
    const caller = req.user!;
    const [msg] = await db
      .select({
        groupId: messagesTable.groupId,
        attachmentPath: messagesTable.attachmentPath,
        attachmentName: messagesTable.attachmentName,
        attachmentType: messagesTable.attachmentType,
        deletedAt: messagesTable.deletedAt,
      })
      .from(messagesTable)
      .where(eq(messagesTable.id, messageId));
    if (!msg || msg.deletedAt || !msg.attachmentPath || msg.groupId == null) {
      res.status(404).json({ message: "Archivo no encontrado" });
      return;
    }
    if (!(await isGroupMember(msg.groupId, caller.id))) {
      res.status(403).json({ message: "No perteneces a este chat" });
      return;
    }

    try {
      const objectFile = await objectStorageService.getObjectEntityFile(
        msg.attachmentPath,
      );
      const response = await objectStorageService.downloadObject(objectFile);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (msg.attachmentType) res.setHeader("Content-Type", msg.attachmentType);
      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ message: "Archivo no encontrado" });
        return;
      }
      req.log.error({ err: error }, "Error serving chat attachment");
      res.status(500).json({ message: "No se pudo servir el archivo" });
    }
  },
);

// ---------------------------------------------------------------------------
// Announcements (Tablón)
// ---------------------------------------------------------------------------
// List announcements: a user sees an announcement if they authored it, fall
// within its audience, or have management authority over that audience
// (superadmin always; provincial coordinators within their province). Each
// announcement carries its downloadable attachments.
router.get("/announcements", requireAuth, async (req, res): Promise<void> => {
  const caller = req.user!;

  const rows = await db
    .select({
      id: announcementsTable.id,
      title: announcementsTable.title,
      body: announcementsTable.body,
      authorId: announcementsTable.authorId,
      authorName: usersTable.name,
      provinceId: announcementsTable.provinceId,
      moduleId: announcementsTable.moduleId,
      moduleName: modulesTable.name,
      audienceType: announcementsTable.audienceType,
      audienceIds: announcementsTable.audienceIds,
      createdAt: announcementsTable.createdAt,
      deletedAt: announcementsTable.deletedAt,
    })
    .from(announcementsTable)
    .leftJoin(usersTable, eq(usersTable.id, announcementsTable.authorId))
    .leftJoin(modulesTable, eq(modulesTable.id, announcementsTable.moduleId))
    .where(isNull(announcementsTable.deletedAt))
    .orderBy(desc(announcementsTable.createdAt))
    .limit(200);

  const ctx = await getViewerContext(caller);
  const visible = [];
  for (const row of rows) {
    const ok =
      row.authorId === caller.id ||
      isInAudience(row.audienceType, row.audienceIds, ctx) ||
      (await canManageAudience(caller, row.audienceType, row.audienceIds));
    if (ok) visible.push(row);
  }

  // Load attachments for the visible announcements in a single query.
  const ids = visible.map((r) => r.id);
  const attachments = ids.length
    ? await db
        .select({
          id: announcementAttachmentsTable.id,
          announcementId: announcementAttachmentsTable.announcementId,
          fileName: announcementAttachmentsTable.fileName,
          contentType: announcementAttachmentsTable.contentType,
          size: announcementAttachmentsTable.size,
        })
        .from(announcementAttachmentsTable)
        .where(inArray(announcementAttachmentsTable.announcementId, ids))
        .orderBy(asc(announcementAttachmentsTable.id))
    : [];
  const byAnnouncement = new Map<number, typeof attachments>();
  for (const a of attachments) {
    const list = byAnnouncement.get(a.announcementId) ?? [];
    list.push(a);
    byAnnouncement.set(a.announcementId, list);
  }

  res.json(
    ListAnnouncementsResponse.parse(
      visible.map((r) =>
        toAnnouncement({
          ...r,
          audienceLabel: announcementAudienceLabel(
            r.audienceType,
            r.audienceIds,
            r.moduleName,
          ),
          attachments: byAnnouncement.get(r.id) ?? [],
        }),
      ),
    ),
  );
});

router.post(
  "/announcements",
  requireAuth,
  requireRole("superadmin", "coordinator"),
  async (req, res): Promise<void> => {
    const parsed = CreateAnnouncementBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const caller = req.user!;
    const data = parsed.data;

    // Validate/normalize the requested audience against the caller's authority.
    const audience = await validateAudience(
      caller,
      data.audienceType,
      data.audienceIds,
    );
    if (!audience.ok) {
      res.status(400).json({ message: audience.message });
      return;
    }

    // When the audience is a single module, mirror it on `moduleId` so the card
    // can show the module name.
    let moduleId: number | null = null;
    let moduleName: string | null = null;
    if (
      audience.audienceType === "module" &&
      audience.audienceIds.length === 1
    ) {
      moduleId = audience.audienceIds[0]!;
      const [module] = await db
        .select({ name: modulesTable.name })
        .from(modulesTable)
        .where(
          and(eq(modulesTable.id, moduleId), isNull(modulesTable.deletedAt)),
        );
      if (!module) {
        res.status(404).json({ message: "Módulo no encontrado" });
        return;
      }
      moduleName = module.name;
    }

    // Bind each uploaded attachment to the caller before accepting it. This both
    // verifies the object exists and prevents attaching an object owned by
    // someone else (path-reuse). Storage I/O happens BEFORE the db transaction.
    const ownerId = String(caller.id);
    const inputs = data.attachments ?? [];
    for (const att of inputs) {
      let objectFile;
      try {
        objectFile = await objectStorageService.getObjectEntityFile(
          att.objectPath,
        );
      } catch (err) {
        if (err instanceof ObjectNotFoundError) {
          res
            .status(400)
            .json({ message: `Documento no encontrado: ${att.fileName}` });
          return;
        }
        throw err;
      }
      const policy = await getObjectAclPolicy(objectFile);
      if (policy?.owner && policy.owner !== ownerId) {
        res
          .status(403)
          .json({ message: `No puedes usar este documento: ${att.fileName}` });
        return;
      }
      if (!policy?.owner) {
        await setObjectAclPolicy(objectFile, {
          owner: ownerId,
          visibility: "private",
        });
      }
    }

    const { created, attachments } = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(announcementsTable)
        .values({
          title: data.title.trim(),
          body: data.body.trim(),
          authorId: caller.id,
          moduleId,
          audienceType: audience.audienceType,
          audienceIds: audience.audienceIds,
        })
        .returning();

      let inserted: (typeof announcementAttachmentsTable.$inferSelect)[] = [];
      if (inputs.length > 0) {
        inserted = await tx
          .insert(announcementAttachmentsTable)
          .values(
            inputs.map((att) => ({
              announcementId: row!.id,
              objectPath: att.objectPath,
              fileName: att.fileName.trim(),
              contentType: att.contentType ?? null,
              size: att.size ?? null,
            })),
          )
          .returning();
      }
      return { created: row!, attachments: inserted };
    });

    // In-app + push to every user in the audience (urgent coordinator notice).
    const recipientIds = (
      await resolveAudienceUserIds(audience.audienceType, audience.audienceIds)
    ).filter((id) => id !== caller.id);
    if (recipientIds.length > 0) {
      await notifyUsers(recipientIds, {
        title: created.title,
        body: created.body,
        type: "announcement",
      });
    }

    // Best-effort email backup; degrades gracefully when Resend is absent.
    let emailPending = false;
    try {
      if (recipientIds.length > 0) {
        const recipients = await db
          .select({ email: usersTable.email })
          .from(usersTable)
          .where(
            and(
              inArray(usersTable.id, recipientIds),
              eq(usersTable.status, "active"),
            ),
          );
        if (recipients.length > 0) {
          const html = `<h2>${created.title}</h2><p>${created.body.replace(/\n/g, "<br/>")}</p><p style="color:#666">— ${caller.name}, Coordina ADG</p>`;
          const results = await Promise.allSettled(
            recipients.map((r) =>
              sendEmail({ to: r.email, subject: created.title, html }),
            ),
          );
          emailPending = results.some(
            (r) => r.status === "fulfilled" && r.value.pending,
          );
        }
      }
    } catch (err) {
      logger.error({ err }, "Announcement email backup failed");
    }

    res.status(201).json({
      ...toAnnouncement({
        ...created,
        authorName: caller.name,
        moduleName,
        audienceLabel: announcementAudienceLabel(
          audience.audienceType,
          audience.audienceIds,
          moduleName,
        ),
        attachments,
      }),
      notifiedCount: recipientIds.length,
      emailPending,
    });
  },
);

// Delete an announcement (its author, or a manager of its audience). Soft
// delete so it disappears from every audience member's board.
router.delete(
  "/announcements/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DeleteAnnouncementParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;

    const [row] = await db
      .select({
        authorId: announcementsTable.authorId,
        audienceType: announcementsTable.audienceType,
        audienceIds: announcementsTable.audienceIds,
      })
      .from(announcementsTable)
      .where(
        and(
          eq(announcementsTable.id, params.data.id),
          isNull(announcementsTable.deletedAt),
        ),
      );
    if (!row) {
      res.status(404).json({ message: "Anuncio no encontrado" });
      return;
    }

    const canDelete =
      row.authorId === caller.id ||
      (await canManageAudience(caller, row.audienceType, row.audienceIds));
    if (!canDelete) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    await db
      .update(announcementsTable)
      .set({ deletedAt: new Date() })
      .where(eq(announcementsTable.id, params.data.id));
    res.status(204).end();
  },
);

// Download an announcement attachment (author OR audience member OR manager).
// Streamed binary — authorization enforced against the DB. Not generated as a
// typed client hook; the frontend fetches this with the Authorization header.
router.get(
  "/announcements/attachments/:attachmentId/file",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const attachmentId = Number(req.params.attachmentId);
    if (!Number.isInteger(attachmentId) || attachmentId <= 0) {
      res.status(400).json({ message: "Identificador no válido" });
      return;
    }
    const caller = req.user!;

    const [row] = await db
      .select({
        objectPath: announcementAttachmentsTable.objectPath,
        fileName: announcementAttachmentsTable.fileName,
        authorId: announcementsTable.authorId,
        audienceType: announcementsTable.audienceType,
        audienceIds: announcementsTable.audienceIds,
        deletedAt: announcementsTable.deletedAt,
      })
      .from(announcementAttachmentsTable)
      .innerJoin(
        announcementsTable,
        eq(announcementsTable.id, announcementAttachmentsTable.announcementId),
      )
      .where(eq(announcementAttachmentsTable.id, attachmentId));

    if (!row || row.deletedAt) {
      res.status(404).json({ message: "Documento no encontrado" });
      return;
    }

    const ctx = await getViewerContext(caller);
    const allowed =
      row.authorId === caller.id ||
      isInAudience(row.audienceType, row.audienceIds, ctx) ||
      (await canManageAudience(caller, row.audienceType, row.audienceIds));
    if (!allowed) {
      res.status(403).json({ message: "Permiso denegado" });
      return;
    }

    try {
      const objectFile = await objectStorageService.getObjectEntityFile(
        row.objectPath,
      );
      const response = await objectStorageService.downloadObject(objectFile);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (row.fileName) {
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(row.fileName)}"`,
        );
      }
      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ message: "Documento no encontrado" });
        return;
      }
      req.log.error({ err: error }, "Error serving announcement attachment");
      res.status(500).json({ message: "No se pudo servir el documento" });
    }
  },
);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const caller = req.user!;
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, caller.id))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(100);
  res.json(ListNotificationsResponse.parse(rows.map(toNotification)));
});

router.post(
  "/notifications/read-all",
  requireAuth,
  async (req, res): Promise<void> => {
    const caller = req.user!;
    await db
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notificationsTable.userId, caller.id),
          isNull(notificationsTable.readAt),
        ),
      );
    res.json({ ok: true });
  },
);

router.post(
  "/notifications/:id/read",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = MarkNotificationReadParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ message: params.error.message });
      return;
    }
    const caller = req.user!;
    await db
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notificationsTable.id, params.data.id),
          eq(notificationsTable.userId, caller.id),
        ),
      );
    res.json({ ok: true });
  },
);

// ---------------------------------------------------------------------------
// Push tokens
// ---------------------------------------------------------------------------
router.post("/push-tokens", requireAuth, async (req, res): Promise<void> => {
  const parsed = RegisterPushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const caller = req.user!;
  await db
    .insert(pushTokensTable)
    .values({
      userId: caller.id,
      token: parsed.data.token,
      platform: parsed.data.platform ?? null,
    })
    .onConflictDoUpdate({
      target: pushTokensTable.token,
      set: { userId: caller.id, platform: parsed.data.platform ?? null },
    });
  res.status(201).json({ ok: true });
});

export default router;
