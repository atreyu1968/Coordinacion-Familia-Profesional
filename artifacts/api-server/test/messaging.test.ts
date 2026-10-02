import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  messagesTable,
  chatGroupsTable,
  chatGroupMembersTable,
  teachingAssignmentsTable,
  usersTable,
  notificationsTable,
  syncModuleChatGroup,
} from "@workspace/db";
import app from "../src/app";
import {
  createUser,
  cleanup,
  authHeader,
  trackGroup,
  createCenter,
  createModule,
  createProvince,
} from "./helpers";
import { ObjectStorageService } from "../src/lib/objectStorage";
import { logger } from "../src/lib/logger";

afterEach(() => {
  vi.restoreAllMocks();
});

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
  it("removes empty groups from storage when listing chats", async () => {
    const caller = await createUser({ role: "teacher" });
    const [emptyGroup] = await db
      .insert(chatGroupsTable)
      .values({ name: "Grupo vacío", type: "group" })
      .returning();
    trackGroup(emptyGroup!.id);

    const res = await request(app)
      .get("/api/chat/groups")
      .set(authHeader(caller.token));

    expect(res.status).toBe(200);
    expect(res.body).not.toContainEqual(
      expect.objectContaining({ id: emptyGroup!.id }),
    );
    const remaining = await db
      .select()
      .from(chatGroupsTable)
      .where(eq(chatGroupsTable.id, emptyGroup!.id));
    expect(remaining).toHaveLength(0);
  });

  it("removes only unreferenced attachments from messages in empty groups", async () => {
    const caller = await createUser({ role: "teacher" });
    const [emptyGroup] = await db
      .insert(chatGroupsTable)
      .values({ name: "Grupo vacío con adjuntos", type: "group" })
      .returning();
    const [activeGroup] = await db
      .insert(chatGroupsTable)
      .values({ name: "Grupo activo", type: "group" })
      .returning();
    trackGroup(emptyGroup!.id);
    trackGroup(activeGroup!.id);
    await db.insert(chatGroupMembersTable).values({
      groupId: activeGroup!.id,
      userId: caller.user.id,
    });

    const orphanedPath = "/objects/uploads/orphaned-chat-file";
    const sharedPath = "/objects/uploads/shared-chat-file";
    await db.insert(messagesTable).values([
      {
        groupId: emptyGroup!.id,
        senderId: caller.user.id,
        content: "",
        kind: "file",
        attachmentPath: orphanedPath,
      },
      {
        groupId: emptyGroup!.id,
        senderId: caller.user.id,
        content: "",
        kind: "file",
        attachmentPath: sharedPath,
      },
      {
        groupId: activeGroup!.id,
        senderId: caller.user.id,
        content: "",
        kind: "file",
        attachmentPath: sharedPath,
      },
    ]);

    const deleteObject = vi
      .spyOn(ObjectStorageService.prototype, "deleteObjectEntity")
      .mockResolvedValue();
    const res = await request(app)
      .get("/api/chat/groups")
      .set(authHeader(caller.token));

    expect(res.status).toBe(200);
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith(orphanedPath);
  });

  it("keeps inbox listing available and logs storage cleanup failures", async () => {
    const caller = await createUser({ role: "teacher" });
    const [emptyGroup] = await db
      .insert(chatGroupsTable)
      .values({ name: "Grupo vacío con adjunto fallido", type: "group" })
      .returning();
    trackGroup(emptyGroup!.id);
    await db.insert(messagesTable).values({
      groupId: emptyGroup!.id,
      senderId: caller.user.id,
      content: "",
      kind: "file",
      attachmentPath: "/objects/uploads/storage-failure",
    });

    vi.spyOn(ObjectStorageService.prototype, "deleteObjectEntity").mockRejectedValue(
      new Error("storage unavailable"),
    );
    const logError = vi.spyOn(logger, "error");
    const res = await request(app)
      .get("/api/chat/groups")
      .set(authHeader(caller.token));

    expect(res.status).toBe(200);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Failed to remove an attachment from a deleted chat message",
    );
    const remainingGroup = await db
      .select()
      .from(chatGroupsTable)
      .where(eq(chatGroupsTable.id, emptyGroup!.id));
    expect(remainingGroup).toHaveLength(0);
  });

  it("hides direct conversations when the other account is inactive", async () => {
    const caller = await createUser({ role: "teacher" });
    const counterpart = await createUser({ role: "teacher" });
    const group = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(caller.token))
      .send({
        name: "Conversación",
        type: "direct",
        memberIds: [counterpart.user.id],
      });
    expect(group.status).toBe(201);
    trackGroup(group.body.id);

    await db
      .update(usersTable)
      .set({ status: "inactive" })
      .where(eq(usersTable.id, counterpart.user.id));

    const listed = await request(app)
      .get("/api/chat/groups")
      .set(authHeader(caller.token));

    expect(listed.status).toBe(200);
    expect(listed.body).not.toContainEqual(
      expect.objectContaining({ id: group.body.id }),
    );

    const history = await request(app)
      .get(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(caller.token));
    expect(history.status).toBe(403);
  });

  it("only creates automatic module chats with more than one member", async () => {
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const moduleId = await createModule({ centerId });
    const teacher = await createUser({ role: "teacher", centerId });
    await db.insert(teachingAssignmentsTable).values({
      teacherId: teacher.user.id,
      moduleId,
      centerId,
    });

    const status = await syncModuleChatGroup(moduleId);
    const [group] = await db
      .select()
      .from(chatGroupsTable)
      .where(eq(chatGroupsTable.moduleId, moduleId));

    if (group) {
      trackGroup(group.id);
      const members = await db
        .select()
        .from(chatGroupMembersTable)
        .where(eq(chatGroupMembersTable.groupId, group.id));
      expect(members.length).toBeGreaterThan(1);
    } else {
      expect(status).toBe("skipped");
    }
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
