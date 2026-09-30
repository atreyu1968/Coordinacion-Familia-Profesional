import type { Server as HttpServer } from "node:http";
import { Server as IOServer, type Socket } from "socket.io";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { db, chatGroupMembersTable, usersTable } from "@workspace/db";
import { verifyToken } from "./auth";
import { logger } from "./logger";
import { isCurrentTokenVersion } from "./sessionVersion";

let io: IOServer | null = null;

interface AuthedSocket extends Socket {
  userId?: number;
  userName?: string;
  tokenVersion?: number;
  sessionNonce?: string;
}

// Revalidate room membership before every group delivery. Module-chat sync can
// revoke a member outside this process, so joining once is not sufficient.
async function activeGroupSockets(
  groupId: number,
  requiredUserIds: number[] = [],
): Promise<{ sockets: AuthedSocket[]; memberIds: Set<number> }> {
  const server = io;
  if (!server) return { sockets: [], memberIds: new Set() };

  const room = `group:${groupId}`;
  const sockets = [...server.sockets.sockets.values()]
    .map((socket) => socket as AuthedSocket)
    .filter((socket) => socket.rooms.has(room));
  const userIds = [
    ...new Set(
      [
        ...sockets
          .map((socket) => socket.userId)
          .filter((userId): userId is number => userId != null),
        ...requiredUserIds,
      ],
    ),
  ];
  if (userIds.length === 0) {
    await Promise.all(sockets.map((socket) => socket.leave(room)));
    return { sockets: [], memberIds: new Set() };
  }

  try {
    const memberships = await db
      .select({
        userId: chatGroupMembersTable.userId,
        tokenVersion: usersTable.tokenVersion,
        sessionNonce: usersTable.sessionNonce,
      })
      .from(chatGroupMembersTable)
      .innerJoin(usersTable, eq(usersTable.id, chatGroupMembersTable.userId))
      .where(
        and(
          eq(chatGroupMembersTable.groupId, groupId),
          inArray(chatGroupMembersTable.userId, userIds),
          eq(usersTable.status, "active"),
          isNull(usersTable.deletedAt),
        ),
      );
    const memberIds = new Set(memberships.map((membership) => membership.userId));
    const currentSessions = new Map(
      memberships.map((membership) => [
        membership.userId,
        {
          tokenVersion: membership.tokenVersion,
          sessionNonce: membership.sessionNonce,
        },
      ]),
    );
    const activeSockets: AuthedSocket[] = [];
    for (const socket of sockets) {
      const currentSession =
        socket.userId == null ? undefined : currentSessions.get(socket.userId);
      if (
        socket.userId != null &&
        currentSession != null &&
        (!isCurrentTokenVersion(
          socket.tokenVersion ?? -1,
          currentSession.tokenVersion,
        ) ||
          typeof socket.sessionNonce !== "string" ||
          socket.sessionNonce !== currentSession.sessionNonce)
      ) {
        socket.disconnect(true);
      } else if (socket.userId != null && memberIds.has(socket.userId)) {
        activeSockets.push(socket);
      } else {
        await socket.leave(room);
      }
    }
    return { sockets: activeSockets, memberIds };
  } catch (err) {
    // Fail closed if membership cannot be verified; stale room subscriptions
    // must never be allowed to receive a group event.
    await Promise.all(sockets.map((socket) => socket.leave(room)));
    logger.error({ err, groupId }, "Could not revalidate chat room members");
    return { sockets: [], memberIds: new Set() };
  }
}

export function initRealtime(server: HttpServer): void {
  io = new IOServer(server, {
    path: "/api/socket.io",
    cors: { origin: "*" },
    serveClient: false,
  });

  io.use(async (socket: AuthedSocket, next) => {
    const token =
      (socket.handshake.auth?.["token"] as string | undefined) ??
      (socket.handshake.query?.["token"] as string | undefined);
    if (!token) {
      next(new Error("No autenticado"));
      return;
    }
    const payload = verifyToken(token);
    if (!payload) {
      next(new Error("Token inválido"));
      return;
    }
    const sessionNonce = (
      payload as typeof payload & { sessionNonce?: unknown }
    ).sessionNonce;
    if (typeof sessionNonce !== "string" || sessionNonce.length === 0) {
      next(new Error("Token revocado"));
      return;
    }
    // Mirror requireAuth: the user must still exist and be active. A JWT alone
    // is not enough — tokens are long-lived, so a deactivated/deleted user must
    // not keep a realtime session.
    const [user] = await db
      .select({
        id: usersTable.id,
        status: usersTable.status,
        name: usersTable.name,
        tokenVersion: usersTable.tokenVersion,
        sessionNonce: usersTable.sessionNonce,
      })
      .from(usersTable)
      .where(and(eq(usersTable.id, payload.sub), isNull(usersTable.deletedAt)));
    if (!user || user.status !== "active") {
      next(new Error("Usuario no válido"));
      return;
    }
    if (
      !isCurrentTokenVersion(payload.tokenVersion, user.tokenVersion) ||
      sessionNonce !== user.sessionNonce
    ) {
      next(new Error("Token revocado"));
      return;
    }
    socket.userId = user.id;
    socket.userName = user.name;
    socket.tokenVersion = user.tokenVersion;
    socket.sessionNonce = sessionNonce;
    next();
  });

  io.on("connection", (socket: AuthedSocket) => {
    const userId = socket.userId;
    if (userId == null) {
      socket.disconnect(true);
      return;
    }
    // Personal room for direct notifications.
    void socket.join(`user:${userId}`);

    // Join a chat group room only after verifying membership.
    socket.on("join", async (rawGroupId: unknown) => {
      const groupId = Number(rawGroupId);
      if (!Number.isInteger(groupId) || groupId <= 0) return;
      const room = `group:${groupId}`;
      try {
        const [member] = await db
          .select({
            id: chatGroupMembersTable.id,
            tokenVersion: usersTable.tokenVersion,
            sessionNonce: usersTable.sessionNonce,
          })
          .from(chatGroupMembersTable)
          .innerJoin(usersTable, eq(usersTable.id, chatGroupMembersTable.userId))
          .where(
            and(
              eq(chatGroupMembersTable.groupId, groupId),
              eq(chatGroupMembersTable.userId, userId),
              eq(usersTable.status, "active"),
              isNull(usersTable.deletedAt),
            ),
          );
        if (
          member &&
          isCurrentTokenVersion(socket.tokenVersion ?? -1, member.tokenVersion) &&
          typeof socket.sessionNonce === "string" &&
          socket.sessionNonce === member.sessionNonce
        ) {
          await socket.join(room);
        } else if (member) {
          socket.disconnect(true);
        } else {
          await socket.leave(room);
        }
      } catch (err) {
        await socket.leave(room);
        logger.error({ err, groupId, userId }, "Could not authorize chat room join");
      }
    });

    socket.on("leave", (rawGroupId: unknown) => {
      const groupId = Number(rawGroupId);
      if (Number.isInteger(groupId)) void socket.leave(`group:${groupId}`);
    });

    // Typing indicator relay. Only members already in the room (verified at
    // join) can broadcast typing; we forward to the rest of the room, never
    // back to the sender. Ephemeral — nothing is persisted.
    const relayTyping = async (
      rawGroupId: unknown,
      typing: boolean,
    ): Promise<void> => {
      const groupId = Number(rawGroupId);
      if (!Number.isInteger(groupId) || groupId <= 0) return;
      const room = `group:${groupId}`;
      if (!socket.rooms.has(room)) return;
      const { sockets, memberIds } = await activeGroupSockets(groupId);
      if (
        !memberIds.has(userId) ||
        !sockets.some((member) => member.id === socket.id)
      ) {
        return;
      }
      const payload = {
        groupId,
        userId,
        name: socket.userName ?? null,
      };
      const event = typing ? "typing" : "stop_typing";
      for (const member of sockets) {
        if (member.id !== socket.id) member.emit(event, payload);
      }
    };
    socket.on("typing", (rawGroupId: unknown) => relayTyping(rawGroupId, true));
    socket.on("stop_typing", (rawGroupId: unknown) =>
      relayTyping(rawGroupId, false),
    );
  });

  logger.info("Realtime (Socket.io) initialised at /api/socket.io");
}

export async function emitToGroup(
  groupId: number,
  event: string,
  payload: unknown,
  senderUserId: number,
): Promise<void> {
  const { sockets, memberIds } = await activeGroupSockets(groupId, [
    senderUserId,
  ]);
  if (!memberIds.has(senderUserId)) return;
  for (const member of sockets) member.emit(event, payload);
}

export async function emitToGroupMembers(
  groupId: number,
  senderUserId: number,
  recipientUserIds: number[],
  event: string,
  payload: unknown,
): Promise<void> {
  const recipients = [...new Set(recipientUserIds)];
  const { memberIds } = await activeGroupSockets(groupId, [
    senderUserId,
    ...recipients,
  ]);
  if (!memberIds.has(senderUserId)) return;
  for (const recipientId of recipients) {
    if (memberIds.has(recipientId)) {
      emitToUser(recipientId, event, payload);
    }
  }
}

// Password-reset flows call this immediately after incrementing tokenVersion so
// all existing sessions for the user are closed, not just future connections.
export function disconnectUserSessions(userId: number): void {
  if (!Number.isInteger(userId) || userId <= 0) return;
  const server = io;
  if (!server) return;
  server.in(`user:${userId}`).disconnectSockets(true);
  for (const socket of server.sockets.sockets.values()) {
    if ((socket as AuthedSocket).userId === userId) socket.disconnect(true);
  }
}

export function emitToUser(
  userId: number,
  event: string,
  payload: unknown,
): void {
  io?.to(`user:${userId}`).emit(event, payload);
}
