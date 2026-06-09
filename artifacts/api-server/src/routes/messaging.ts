import { Router } from "express";
import { and, eq, inArray, desc, asc, isNull } from "drizzle-orm";
import {
  db,
  chatGroupsTable,
  chatGroupMembersTable,
  messagesTable,
  announcementsTable,
  notificationsTable,
  pushTokensTable,
  usersTable,
} from "@workspace/db";
import {
  ListChatGroupsResponse,
  CreateChatGroupBody,
  ListGroupMessagesParams,
  ListGroupMessagesResponse,
  SendGroupMessageParams,
  SendGroupMessageBody,
  ListAnnouncementsQueryParams,
  ListAnnouncementsResponse,
  CreateAnnouncementBody,
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
import {
  notifyUsers,
  resolveProvinceAudience,
} from "../lib/notify";
import { sendPushToUsers } from "../lib/push";
import { sendEmail } from "../lib/email";
import { logger } from "../lib/logger";

const router = Router();

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
    return toChatGroup({ ...g, name });
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
router.get("/announcements", requireAuth, async (req, res): Promise<void> => {
  const query = ListAnnouncementsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ message: query.error.message });
    return;
  }
  const caller = req.user!;

  const rows = await db
    .select({
      id: announcementsTable.id,
      title: announcementsTable.title,
      body: announcementsTable.body,
      authorId: announcementsTable.authorId,
      authorName: usersTable.name,
      provinceId: announcementsTable.provinceId,
      createdAt: announcementsTable.createdAt,
    })
    .from(announcementsTable)
    .leftJoin(usersTable, eq(usersTable.id, announcementsTable.authorId))
    .orderBy(desc(announcementsTable.createdAt))
    .limit(200);

  // Visibility: global announcements (provinceId null) plus those of the
  // caller's province. Superadmins see everything. An optional provinceId
  // filter may only NARROW within what the caller can already see — it must
  // never expand visibility to other provinces.
  const filterProvince = query.data.provinceId;
  const visible = rows.filter((r) => {
    const allowed =
      caller.role === "superadmin" ||
      r.provinceId == null ||
      r.provinceId === caller.provinceId;
    if (!allowed) return false;
    if (filterProvince != null) return r.provinceId === filterProvince;
    return true;
  });

  res.json(ListAnnouncementsResponse.parse(visible.map(toAnnouncement)));
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

    // Coordinators are pinned to their own province; superadmins choose freely.
    let provinceId: number | null;
    if (caller.role === "superadmin") {
      provinceId = parsed.data.provinceId ?? null;
    } else {
      if (caller.provinceId == null) {
        res.status(403).json({ message: "No tienes una provincia asignada" });
        return;
      }
      provinceId = caller.provinceId;
    }

    const [created] = await db
      .insert(announcementsTable)
      .values({
        title: parsed.data.title.trim(),
        body: parsed.data.body.trim(),
        authorId: caller.id,
        provinceId,
      })
      .returning();

    // In-app + push to the audience (urgent coordinator notice).
    const audience = await resolveProvinceAudience(provinceId, caller.id);
    await notifyUsers(audience, {
      title: created!.title,
      body: created!.body,
      type: "announcement",
    });

    // Best-effort email backup; degrades gracefully when Resend is absent.
    let emailPending = false;
    try {
      const recipients = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(
          and(
            inArray(usersTable.id, audience),
            eq(usersTable.status, "active"),
          ),
        );
      if (recipients.length > 0) {
        const html = `<h2>${created!.title}</h2><p>${created!.body.replace(/\n/g, "<br/>")}</p><p style="color:#666">— ${caller.name}, Coordina ADG</p>`;
        const results = await Promise.allSettled(
          recipients.map((r) =>
            sendEmail({ to: r.email, subject: created!.title, html }),
          ),
        );
        emailPending = results.some(
          (r) => r.status === "fulfilled" && r.value.pending,
        );
      }
    } catch (err) {
      logger.error({ err }, "Announcement email backup failed");
    }

    res.status(201).json({
      ...toAnnouncement({ ...created!, authorName: caller.name }),
      notifiedCount: audience.length,
      emailPending,
    });
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
