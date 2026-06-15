import type { Server as HttpServer } from "node:http";
import { Server as IOServer, type Socket } from "socket.io";
import { eq, and, isNull } from "drizzle-orm";
import { db, chatGroupMembersTable, usersTable } from "@workspace/db";
import { verifyToken } from "./auth";
import { logger } from "./logger";

let io: IOServer | null = null;

interface AuthedSocket extends Socket {
  userId?: number;
  userName?: string;
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
    // Mirror requireAuth: the user must still exist and be active. A JWT alone
    // is not enough — tokens are long-lived, so a deactivated/deleted user must
    // not keep a realtime session.
    const [user] = await db
      .select({
        id: usersTable.id,
        status: usersTable.status,
        name: usersTable.name,
      })
      .from(usersTable)
      .where(and(eq(usersTable.id, payload.sub), isNull(usersTable.deletedAt)));
    if (!user || user.status !== "active") {
      next(new Error("Usuario no válido"));
      return;
    }
    socket.userId = user.id;
    socket.userName = user.name;
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
      if (!Number.isInteger(groupId)) return;
      const [member] = await db
        .select({ id: chatGroupMembersTable.id })
        .from(chatGroupMembersTable)
        .where(
          and(
            eq(chatGroupMembersTable.groupId, groupId),
            eq(chatGroupMembersTable.userId, userId),
          ),
        );
      if (member) void socket.join(`group:${groupId}`);
    });

    socket.on("leave", (rawGroupId: unknown) => {
      const groupId = Number(rawGroupId);
      if (Number.isInteger(groupId)) void socket.leave(`group:${groupId}`);
    });

    // Typing indicator relay. Only members already in the room (verified at
    // join) can broadcast typing; we forward to the rest of the room, never
    // back to the sender. Ephemeral — nothing is persisted.
    const relayTyping = (rawGroupId: unknown, typing: boolean) => {
      const groupId = Number(rawGroupId);
      if (!Number.isInteger(groupId)) return;
      if (!socket.rooms.has(`group:${groupId}`)) return;
      socket.to(`group:${groupId}`).emit(typing ? "typing" : "stop_typing", {
        groupId,
        userId,
        name: socket.userName ?? null,
      });
    };
    socket.on("typing", (rawGroupId: unknown) => relayTyping(rawGroupId, true));
    socket.on("stop_typing", (rawGroupId: unknown) =>
      relayTyping(rawGroupId, false),
    );
  });

  logger.info("Realtime (Socket.io) initialised at /api/socket.io");
}

export function emitToGroup(
  groupId: number,
  event: string,
  payload: unknown,
): void {
  io?.to(`group:${groupId}`).emit(event, payload);
}

export function emitToUser(
  userId: number,
  event: string,
  payload: unknown,
): void {
  io?.to(`user:${userId}`).emit(event, payload);
}
