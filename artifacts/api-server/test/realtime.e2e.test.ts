import { describe, it, expect, afterAll, beforeAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { io as ioClient, type Socket } from "socket.io-client";
import app from "../src/app";
import { initRealtime } from "../src/lib/realtime";
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

describe("realtime socket auth", () => {
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
