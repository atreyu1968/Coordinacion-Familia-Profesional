import { Router, type Request, type Response } from "express";
import { Readable } from "stream";
import { and, eq, inArray, desc, asc, isNull } from "drizzle-orm";
import {
  db,
  chatGroupsTable,
  chatGroupMembersTable,
  messagesTable,
  announcementsTable,
  announcementAttachmentsTable,
  notificationsTable,
  pushTokensTable,
  usersTable,
  modulesTable,
} from "@workspace/db";
import {
  ListChatGroupsResponse,
  CreateChatGroupBody,
  MarkChatReadParams,
  ListGroupMessagesParams,
  ListGroupMessagesResponse,
  SendGroupMessageParams,
  SendGroupMessageBody,
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
} from "../middlewares/auth";
import {
  toChatGroup,
  toMessage,
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

    const rows = await db
      .select({
        id: messagesTable.id,
        groupId: messagesTable.groupId,
        senderId: messagesTable.senderId,
        senderName: usersTable.name,
        recipientId: messagesTable.recipientId,
        content: messagesTable.content,
        createdAt: messagesTable.createdAt,
      })
      .from(messagesTable)
      .leftJoin(usersTable, eq(usersTable.id, messagesTable.senderId))
      .where(eq(messagesTable.groupId, groupId))
      .orderBy(asc(messagesTable.createdAt))
      .limit(200);

    res.json(ListGroupMessagesResponse.parse(rows.map(toMessage)));
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

    const [created] = await db
      .insert(messagesTable)
      .values({
        groupId,
        senderId: caller.id,
        content: body.data.content.trim(),
      })
      .returning();

    await db
      .update(chatGroupsTable)
      .set({ lastMessageAt: created!.createdAt })
      .where(eq(chatGroupsTable.id, groupId));

    const mapped = toMessage({ ...created!, senderName: caller.name });

    // Real-time delivery to everyone currently in the chat room.
    emitToGroup(groupId, "message", mapped);

    // Notify other members' personal rooms for chat-list/badge updates.
    const members = await db
      .select({ userId: chatGroupMembersTable.userId })
      .from(chatGroupMembersTable)
      .where(eq(chatGroupMembersTable.groupId, groupId));
    const otherMemberIds = members
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
      void sendPushToUsers(otherMemberIds, {
        title: group?.name ?? "Nuevo mensaje",
        body: `${caller.name}: ${created!.content}`,
        data: { type: "message", groupId },
      });
    }

    res.status(201).json(mapped);
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
