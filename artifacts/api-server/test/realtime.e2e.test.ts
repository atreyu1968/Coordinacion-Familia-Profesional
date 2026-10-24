import { describe, it, expect, afterAll, beforeAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { io as ioClient, type Socket } from "socket.io-client";
import app from "../src/app";
import { initRealtime, emitToUser } from "../src/lib/realtime";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createUser, cleanup, authHeader, trackGroup } from "./helpers";

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer(app);
  initRealtime(server);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await cleanup();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function connect(token: string): Socket {
  return ioClient(baseUrl, {
    path: "/api/socket.io",
    auth: { token },
    transports: ["websocket"],
    reconnection: false,
  });
}

function waitForSocketEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for Socket.io event "${event}"`));
    }, 3000);
    const onEvent = (payload: T) => {
      clearTimeout(timeout);
      resolve(payload);
    };
    socket.on(event, onEvent);
  });
}

async function expectNoSocketEvent(
  socket: Socket,
  event: string,
  durationMs = 200,
): Promise<void> {
  let received = false;
  const onEvent = () => {
    received = true;
  };
  socket.on(event, onEvent);
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  socket.off(event, onEvent);
  expect(received, `unexpected Socket.io event "${event}"`).toBe(false);
}

describe("realtime socket auth", () => {
  it("rejects teachers with an incomplete profile with a recoverable error code", async () => {
    const teacher = await createUser({ incompleteProfile: true });
    const socket = connect(teacher.token);
    try {
      const err = await new Promise<Error & { data?: { code?: string } }>((resolve) => {
        socket.on("connect_error", resolve);
      });
      expect(err.data?.code).toBe("TEACHING_PROFILE_REQUIRED");
      expect(socket.connected).toBe(false);
    } finally {
      socket.close();
    }
  });
  it("stops delivery and disconnects an existing socket if its profile becomes incomplete", async () => {
    const teacher = await createUser();
    const socket = connect(teacher.token);
    let received = false;
    socket.on("profile-test-message", () => { received = true; });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on("connect", resolve);
        socket.on("connect_error", reject);
      });
      await db.update(usersTable).set({ centerId: null }).where(eq(usersTable.id, teacher.user.id));
      const disconnected = new Promise<void>((resolve) => { socket.on("disconnect", () => resolve()); });
      await emitToUser(teacher.user.id, "profile-test-message", { private: true });
      await disconnected;
      expect(received).toBe(false);
    } finally {
      socket.close();
    }
  });
  it("rechecks the profile before accepting packets from an already connected socket", async () => {
    const teacher = await createUser();
    const socket = connect(teacher.token);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on("connect", resolve);
        socket.on("connect_error", reject);
      });
      await db.update(usersTable).set({ provinceId: null }).where(eq(usersTable.id, teacher.user.id));
      const disconnected = new Promise<void>((resolve) => { socket.on("disconnect", () => resolve()); });
      socket.emit("join", -1);
      await disconnected;
    } finally {
      socket.close();
    }
  });
  it("rejects a connection without a token", async () => {
    const socket = ioClient(baseUrl, {
      path: "/api/socket.io",
      transports: ["websocket"],
      reconnection: false,
    });
    const err = await new Promise<Error>((resolve) => {
      socket.on("connect_error", (e) => resolve(e as Error));
    });
    expect(err.message).toContain("autenticado");
    socket.close();
  });

  it("rejects a connection with an invalid token", async () => {
    const socket = connect("not-a-real-token");
    const err = await new Promise<Error>((resolve) => {
      socket.on("connect_error", (e) => resolve(e as Error));
    });
    expect(err.message).toContain("inválido");
    socket.close();
  });
});

describe("end-to-end: login -> send message -> receive over socket", () => {
  it("delivers a message in real time to a connected group member", async () => {
    const sender = await createUser({ role: "teacher" });
    const recipient = await createUser({ role: "teacher" });

    // 1. Sender logs in with real credentials to obtain a token.
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: sender.email, password: sender.password });
    expect(login.status).toBe(200);
    const senderToken = login.body.token as string;

    // 2. A direct thread is created between the two users.
    const group = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(senderToken))
      .send({ name: "Chat", type: "direct", memberIds: [recipient.user.id] });
    expect(group.status).toBe(201);
    const groupId = group.body.id as number;
    trackGroup(groupId);

    // 3. The recipient connects over the socket and joins the group room.
    const socket = connect(recipient.token);
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", () => resolve());
      socket.on("connect_error", (e) => reject(e));
    });

    const received = new Promise<{ content: string; senderId: number }>(
      (resolve) => {
        socket.on("message", (payload) => resolve(payload));
      },
    );

    socket.emit("join", groupId);
    // Give the server a moment to process the room join before sending.
    await new Promise((r) => setTimeout(r, 200));

    // 4. Sender posts a message over HTTP; it should arrive on the socket.
    const send = await request(app)
      .post(`/api/chat/groups/${groupId}/messages`)
      .set(authHeader(senderToken))
      .send({ content: "tiempo real" });
    expect(send.status).toBe(201);

    const payload = await received;
    expect(payload.content).toBe("tiempo real");
    expect(payload.senderId).toBe(sender.user.id);

    socket.close();
  });

  it("notifies a member's personal room on chat_update", async () => {
    const sender = await createUser({ role: "teacher" });
    const recipient = await createUser({ role: "teacher" });

    const group = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(sender.token))
      .send({ name: "Chat", type: "direct", memberIds: [recipient.user.id] });
    trackGroup(group.body.id);
    const groupId = group.body.id as number;

    // Recipient connects but does NOT join the group room; they still receive a
    // chat_update on their personal room so badges/lists can refresh.
    const socket = connect(recipient.token);
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", () => resolve());
      socket.on("connect_error", (e) => reject(e));
    });

    const update = new Promise<{ groupId: number }>((resolve) => {
      socket.on("chat_update", (payload) => resolve(payload));
    });

    await request(app)
      .post(`/api/chat/groups/${groupId}/messages`)
      .set(authHeader(sender.token))
      .send({ content: "ping" });

    const payload = await update;
    expect(payload.groupId).toBe(groupId);

    socket.close();
  });
});

describe("end-to-end: private message trash updates across sessions", () => {
  it("syncs hide and restore only to the same account and broadcasts safe deletion tombstones", async () => {
    const author = await createUser({ role: "teacher" });
    const recipient = await createUser({ role: "teacher" });
    const group = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(author.token))
      .send({ name: "Chat", type: "direct", memberIds: [recipient.user.id] });
    expect(group.status).toBe(201);
    trackGroup(group.body.id);
    const groupId = group.body.id as number;
    const sent = await request(app)
      .post(`/api/chat/groups/${groupId}/messages`)
      .set(authHeader(author.token))
      .send({ content: "Contenido privado de prueba" });
    expect(sent.status).toBe(201);
    const messageId = sent.body.id as number;

    const authorSessionA = connect(author.token);
    const authorSessionB = connect(author.token);
    const recipientSession = connect(recipient.token);
    const sockets = [authorSessionA, authorSessionB, recipientSession];

    try {
      await Promise.all(
        sockets.map(
          (socket) =>
            new Promise<void>((resolve, reject) => {
              socket.once("connect", resolve);
              socket.once("connect_error", reject);
            }),
        ),
      );
      for (const socket of sockets) socket.emit("join", groupId);
      // The server verifies group membership asynchronously before joining.
      await new Promise((resolve) => setTimeout(resolve, 150));

      const hiddenForA = waitForSocketEvent<{ groupId: number; messageId: number }>(
        authorSessionA,
        "message_hidden_for_me",
      );
      const hiddenForB = waitForSocketEvent<{ groupId: number; messageId: number }>(
        authorSessionB,
        "message_hidden_for_me",
      );
      const hideResponse = await request(app)
        .post(`/api/chat/messages/${messageId}/hide`)
        .set(authHeader(author.token));
      expect(hideResponse.status).toBe(204);
      await expect(hiddenForA).resolves.toEqual({ groupId, messageId });
      await expect(hiddenForB).resolves.toEqual({ groupId, messageId });
      await expectNoSocketEvent(recipientSession, "message_hidden_for_me");

      const authorTrash = await request(app)
        .get(`/api/chat/groups/${groupId}/hidden-messages`)
        .set(authHeader(author.token));
      expect(authorTrash.body).toContainEqual(
        expect.objectContaining({
          id: messageId,
          content: "Contenido privado de prueba",
          deleted: false,
        }),
      );

      const restoredForA = waitForSocketEvent<{
        groupId: number;
        message: { id: number; content: string; deleted: boolean };
      }>(authorSessionA, "message_restored_for_me");
      const restoredForB = waitForSocketEvent<{
        groupId: number;
        message: { id: number; content: string; deleted: boolean };
      }>(authorSessionB, "message_restored_for_me");
      const restoreResponse = await request(app)
        .post(`/api/chat/messages/${messageId}/restore`)
        .set(authHeader(author.token));
      expect(restoreResponse.status).toBe(200);
      const [restoreEventA, restoreEventB] = await Promise.all([
        restoredForA,
        restoredForB,
      ]);
      for (const event of [restoreEventA, restoreEventB]) {
        expect(event).toMatchObject({
          groupId,
          message: {
            id: messageId,
            content: "Contenido privado de prueba",
            deleted: false,
          },
        });
      }
      await expectNoSocketEvent(recipientSession, "message_restored_for_me");

      const rehiddenForA = waitForSocketEvent(authorSessionA, "message_hidden_for_me");
      const rehiddenForB = waitForSocketEvent(authorSessionB, "message_hidden_for_me");
      expect(
        (
          await request(app)
            .post(`/api/chat/messages/${messageId}/hide`)
            .set(authHeader(author.token))
        ).status,
      ).toBe(204);
      await Promise.all([rehiddenForA, rehiddenForB]);
      await expectNoSocketEvent(recipientSession, "message_hidden_for_me");

      const deletedForA = waitForSocketEvent<{
        id: number;
        groupId: number;
        content: string;
        deleted: boolean;
      }>(authorSessionA, "message_deleted");
      const deletedForB = waitForSocketEvent<{
        id: number;
        groupId: number;
        content: string;
        deleted: boolean;
      }>(authorSessionB, "message_deleted");
      const deletedForRecipient = waitForSocketEvent<{
        id: number;
        groupId: number;
        content: string;
        deleted: boolean;
      }>(recipientSession, "message_deleted");
      const deleteResponse = await request(app)
        .delete(`/api/chat/messages/${messageId}`)
        .set(authHeader(author.token));
      expect(deleteResponse.status).toBe(200);
      const deletionEvents = await Promise.all([
        deletedForA,
        deletedForB,
        deletedForRecipient,
      ]);
      for (const event of deletionEvents) {
        expect(event).toMatchObject({
          id: messageId,
          groupId,
          deleted: true,
        });
        expect(event.content).not.toContain("Contenido privado de prueba");
      }
      expect(deleteResponse.body.content).not.toContain(
        "Contenido privado de prueba",
      );

      const deletedTrash = await request(app)
        .get(`/api/chat/groups/${groupId}/hidden-messages`)
        .set(authHeader(author.token));
      expect(deletedTrash.body).toContainEqual(
        expect.objectContaining({
          id: messageId,
          content: "",
          deleted: true,
        }),
      );
    } finally {
      sockets.forEach((socket) => socket.close());
    }
  });
});
