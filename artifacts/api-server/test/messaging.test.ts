import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  messagesTable,
  chatGroupsTable,
  notificationsTable,
} from "@workspace/db";
import app from "../src/app";
import {
  createUser,
  cleanup,
  authHeader,
  trackGroup,
} from "./helpers";

afterAll(async () => {
  await cleanup();
});

describe("chat groups", () => {
  it("creates a direct message thread between two users", async () => {
    const a = await createUser({ role: "teacher" });
    const b = await createUser({ role: "teacher" });

    const res = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(a.token))
      .send({ name: "Chat", type: "direct", memberIds: [b.user.id] });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTypeOf("number");
    expect(res.body.type).toBe("direct");
    // For a direct thread the display name is the counterpart's name.
    expect(res.body.name).toBe(b.user.name);
    trackGroup(res.body.id);
  });

  it("dedups direct threads: a second create returns the existing thread", async () => {
    const a = await createUser({ role: "teacher" });
    const b = await createUser({ role: "teacher" });

    const first = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(a.token))
      .send({ name: "Chat", type: "direct", memberIds: [b.user.id] });
    expect(first.status).toBe(201);
    trackGroup(first.body.id);

    // Same pair, initiated from the other side — must resolve to the same row.
    const second = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(b.token))
      .send({ name: "Chat", type: "direct", memberIds: [a.user.id] });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);

    const rows = await db
      .select()
      .from(chatGroupsTable)
      .where(eq(chatGroupsTable.id, first.body.id));
    expect(rows).toHaveLength(1);
  });

  it("rejects a direct thread without exactly one recipient", async () => {
    const a = await createUser({ role: "teacher" });
    const b = await createUser({ role: "teacher" });
    const c = await createUser({ role: "teacher" });

    const res = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(a.token))
      .send({ name: "Chat", type: "direct", memberIds: [b.user.id, c.user.id] });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/chat/groups")
      .send({ name: "Chat", type: "group", memberIds: [] });
    expect(res.status).toBe(401);
  });
});

describe("messages", () => {
  it("persists a sent message and bumps the group's lastMessageAt", async () => {
    const a = await createUser({ role: "teacher" });
    const b = await createUser({ role: "teacher" });

    const group = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(a.token))
      .send({ name: "Chat", type: "direct", memberIds: [b.user.id] });
    trackGroup(group.body.id);

    const before = await db
      .select()
      .from(chatGroupsTable)
      .where(eq(chatGroupsTable.id, group.body.id));

    const res = await request(app)
      .post(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(a.token))
      .send({ content: "  hola mundo  " });

    expect(res.status).toBe(201);
    // Content is trimmed on the way in.
    expect(res.body.content).toBe("hola mundo");
    expect(res.body.senderId).toBe(a.user.id);

    const stored = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.groupId, group.body.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]!.content).toBe("hola mundo");

    const after = await db
      .select()
      .from(chatGroupsTable)
      .where(eq(chatGroupsTable.id, group.body.id));
    expect(after[0]!.lastMessageAt!.getTime()).toBeGreaterThanOrEqual(
      before[0]!.lastMessageAt!.getTime(),
    );
  });

  it("forbids sending to a group the caller does not belong to", async () => {
    const a = await createUser({ role: "teacher" });
    const b = await createUser({ role: "teacher" });
    const outsider = await createUser({ role: "teacher" });

    const group = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(a.token))
      .send({ name: "Chat", type: "direct", memberIds: [b.user.id] });
    trackGroup(group.body.id);

    const res = await request(app)
      .post(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(outsider.token))
      .send({ content: "intruso" });
    expect(res.status).toBe(403);
  });

  it("returns messages only to members in chronological order", async () => {
    const a = await createUser({ role: "teacher" });
    const b = await createUser({ role: "teacher" });

    const group = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(a.token))
      .send({ name: "Chat", type: "direct", memberIds: [b.user.id] });
    trackGroup(group.body.id);

    await request(app)
      .post(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(a.token))
      .send({ content: "primero" });
    await request(app)
      .post(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(b.token))
      .send({ content: "segundo" });

    const list = await request(app)
      .get(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(b.token));
    expect(list.status).toBe(200);
    expect(list.body.map((m: { content: string }) => m.content)).toEqual([
      "primero",
      "segundo",
    ]);
  });
});

describe("notifications", () => {
  it("lists only the caller's notifications", async () => {
    const a = await createUser({ role: "teacher" });
    const b = await createUser({ role: "teacher" });
    await db.insert(notificationsTable).values([
      { userId: a.user.id, title: "Para A", type: "general" },
      { userId: b.user.id, title: "Para B", type: "general" },
    ]);

    const res = await request(app)
      .get("/api/notifications")
      .set(authHeader(a.token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("Para A");
  });

  it("marks a single notification as read (and only the caller's own)", async () => {
    const a = await createUser({ role: "teacher" });
    const b = await createUser({ role: "teacher" });
    const [mine] = await db
      .insert(notificationsTable)
      .values({ userId: a.user.id, title: "Mía" })
      .returning();
    const [theirs] = await db
      .insert(notificationsTable)
      .values({ userId: b.user.id, title: "Suya" })
      .returning();

    const res = await request(app)
      .post(`/api/notifications/${mine!.id}/read`)
      .set(authHeader(a.token));
    expect(res.status).toBe(200);

    const [mineAfter] = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.id, mine!.id));
    expect(mineAfter!.readAt).not.toBeNull();

    // A cannot read B's notification: marking it has no effect.
    const cross = await request(app)
      .post(`/api/notifications/${theirs!.id}/read`)
      .set(authHeader(a.token));
    expect(cross.status).toBe(200);
    const [theirsAfter] = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.id, theirs!.id));
    expect(theirsAfter!.readAt).toBeNull();
  });

  it("marks all of the caller's unread notifications as read", async () => {
    const a = await createUser({ role: "teacher" });
    await db.insert(notificationsTable).values([
      { userId: a.user.id, title: "n1" },
      { userId: a.user.id, title: "n2" },
      { userId: a.user.id, title: "n3" },
    ]);

    const res = await request(app)
      .post("/api/notifications/read-all")
      .set(authHeader(a.token));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const all = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, a.user.id));
    expect(all.every((n) => n.readAt !== null)).toBe(true);
  });
});
