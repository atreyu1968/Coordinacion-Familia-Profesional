import type { Server as HttpServer } from "node:http";
import { Server as IOServer, type Socket } from "socket.io";
import { eq, and } from "drizzle-orm";
import { db, chatGroupMembersTable } from "@workspace/db";
import { verifyToken } from "./auth";
import { logger } from "./logger";

let io: IOServer | null = null;

interface AuthedSocket extends Socket {
  userId?: number;
}

export function initRealtime(server: HttpServer): void {
  io = new IOServer(server, {
    path: "/api/socket.io",
    cors: { origin: "*" },
    serveClient: false,
  });

  io.use((socket: AuthedSocket, next) => {
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
    socket.userId = payload.sub;
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
