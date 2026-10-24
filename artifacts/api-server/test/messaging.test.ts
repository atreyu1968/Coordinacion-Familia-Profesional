import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  messagesTable,
  chatGroupsTable,
  chatGroupMembersTable,
  teachingAssignmentsTable,
  usersTable,
  centersTable,
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
  it("notifies new group participants and revokes access when they leave", async () => {
    const creator = await createUser();
    const member = await createUser();
    const stranger = await createUser();
    const response = await request(app).post("/api/chat/groups").set(authHeader(creator.token))
      .send({ name: "Grupo voluntario", type: "group", memberIds: [member.user.id] });
    expect(response.status).toBe(201);
    const id = response.body.id;
    trackGroup(id);
    const notices = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, member.user.id));
    expect(notices.some((notice) => notice.type === "chat_group")).toBe(true);
    expect((await request(app).post(`/api/chat/groups/${id}/leave`).set(authHeader(stranger.token))).status).toBe(403);
    expect((await request(app).post(`/api/chat/groups/${id}/leave`).set(authHeader(member.token))).status).toBe(204);
    const list = await request(app).get("/api/chat/groups").set(authHeader(member.token));
    expect(list.body.some((group: { id: number }) => group.id === id)).toBe(false);
    expect((await request(app).get(`/api/chat/groups/${id}/messages`).set(authHeader(member.token))).status).toBe(403);
    expect((await request(app).post(`/api/chat/groups/${id}/messages`).set(authHeader(member.token)).send({ content: "No permitido" })).status).toBe(403);
    expect((await request(app).get(`/api/chat/groups/${id}/messages`).set(authHeader(creator.token))).status).toBe(200);
    expect((await request(app).post("/api/chat/groups").set(authHeader(creator.token))
      .send({ name: "Grupo vacío", type: "group", memberIds: [] })).status).toBe(400);
  });

  it("does not allow leaving automatic module groups independently of teaching assignments", async () => {
    const actor = await createUser();
    const moduleId = await createModule();
    const [group] = await db.insert(chatGroupsTable).values({ name: "Grupo automático", type: "group", moduleId }).returning();
    trackGroup(group!.id);
    await db.insert(chatGroupMembersTable).values({ groupId: group!.id, userId: actor.user.id });
    expect((await request(app).post(`/api/chat/groups/${group!.id}/leave`).set(authHeader(actor.token))).status).toBe(409);
    expect((await request(app).get(`/api/chat/groups/${group!.id}/members`).set(authHeader(actor.token))).status).toBe(200);
  });
  it("lists active contacts across provinces without leaking emails or disabled accounts", async () => {
    const provinceA = await createProvince();
    const provinceB = await createProvince();
    const centerA = await createCenter(provinceA);
    const centerB = await createCenter(provinceB);
    const sender = await createUser({ centerId: centerA, provinceId: provinceA, name: "Remitente de prueba" });
    const recipient = await createUser({ centerId: centerB, provinceId: provinceB, name: "Contacto distante" });
    const disabled = await createUser({
      centerId: centerB, provinceId: provinceB, name: "Contacto desactivado", status: "inactive",
    });
    const deleted = await createUser({ centerId: centerB, provinceId: provinceB, name: "Contacto eliminado" });
    await db.update(usersTable).set({ deletedAt: new Date() }).where(eq(usersTable.id, deleted.user.id));

    expect((await request(app).get("/api/chat/contacts")).status).toBe(401);
    const response = await request(app).get("/api/chat/contacts").set(authHeader(sender.token));
    expect(response.status).toBe(200);
    const ids = response.body.map((contact: { id: number }) => contact.id);
    expect(ids).toContain(recipient.user.id);
    expect(ids).not.toContain(sender.user.id);
    expect(ids).not.toContain(disabled.user.id);
    expect(ids).not.toContain(deleted.user.id);
    const center = await db.select({ name: centersTable.name }).from(centersTable)
      .where(eq(centersTable.id, centerB));
    expect(response.body.find((contact: { id: number }) => contact.id === recipient.user.id))
      .toEqual({ id: recipient.user.id, name: recipient.user.name, role: recipient.user.role, centerName: center[0]!.name });

    const filtered = await request(app).get("/api/chat/contacts")
      .query({ search: "distante" }).set(authHeader(sender.token));
    expect(filtered.status).toBe(200);
    expect(filtered.body.map((contact: { id: number }) => contact.id)).toContain(recipient.user.id);
    expect(filtered.body.map((contact: { id: number }) => contact.id)).not.toContain(disabled.user.id);
    const byCenter = await request(app).get("/api/chat/contacts")
      .query({ search: center[0]!.name }).set(authHeader(sender.token));
    expect(byCenter.status).toBe(200);
    expect(byCenter.body.map((contact: { id: number }) => contact.id)).toContain(recipient.user.id);
    const coordinator = await createUser({ role: "coordinator", centerId: centerA, provinceId: provinceA });
    await db.update(usersTable).set({ teachingCenterId: centerB }).where(eq(usersTable.id, coordinator.user.id));
    const personal = await request(app).get("/api/chat/contacts").set(authHeader(sender.token));
    expect(personal.body.find((contact: { id: number }) => contact.id === coordinator.user.id).centerName)
      .toBe(center[0]!.name);

    const conversation = await request(app).post("/api/chat/groups")
      .set(authHeader(sender.token)).send({
        name: recipient.user.name, type: "direct", memberIds: [recipient.user.id],
      });
    expect(conversation.status).toBe(201);
    trackGroup(conversation.body.id);
  });

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

  it("creates only one direct thread when the same pair requests it concurrently", async () => {
    const a = await createUser({ role: "teacher" });
    const b = await createUser({ role: "teacher" });
    const createRequest = () =>
      request(app)
        .post("/api/chat/groups")
        .set(authHeader(a.token))
        .send({ name: "Chat concurrente", type: "direct", memberIds: [b.user.id] });

    const [first, second] = await Promise.all([createRequest(), createRequest()]);

    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body.id).toBe(second.body.id);
    trackGroup(first.body.id);

    const callerThreads = await db
      .select({ groupId: chatGroupMembersTable.groupId })
      .from(chatGroupMembersTable)
      .innerJoin(
        chatGroupsTable,
        eq(chatGroupsTable.id, chatGroupMembersTable.groupId),
      )
      .where(
        and(
          eq(chatGroupMembersTable.userId, a.user.id),
          eq(chatGroupsTable.type, "direct"),
        ),
      );
    const matchingThreads = await db
      .select({ groupId: chatGroupMembersTable.groupId })
      .from(chatGroupMembersTable)
      .where(
        and(
          inArray(
            chatGroupMembersTable.groupId,
            callerThreads.map((thread) => thread.groupId),
          ),
          eq(chatGroupMembersTable.userId, b.user.id),
        ),
      );
    expect(matchingThreads).toHaveLength(1);
    expect(matchingThreads[0]!.groupId).toBe(first.body.id);
  });

  it.each(["inactive", "deleted"] as const)(
    "rejects reopening an archived direct thread when the counterpart is %s",
    async (counterpartState) => {
      const caller = await createUser({ role: "teacher" });
      const counterpart = await createUser({ role: "teacher" });
      const created = await request(app)
        .post("/api/chat/groups")
        .set(authHeader(caller.token))
        .send({ name: "Chat archivado", type: "direct", memberIds: [counterpart.user.id] });
      expect(created.status).toBe(201);
      trackGroup(created.body.id);

      const message = await request(app)
        .post(`/api/chat/groups/${created.body.id}/messages`)
        .set(authHeader(caller.token))
        .send({ content: "Historial que debe conservarse" });
      expect(message.status).toBe(201);

      const hiddenAt = new Date();
      await db
        .update(chatGroupMembersTable)
        .set({ hiddenAt })
        .where(
          and(
            eq(chatGroupMembersTable.groupId, created.body.id),
            eq(chatGroupMembersTable.userId, caller.user.id),
          ),
        );
      await db
        .update(usersTable)
        .set(
          counterpartState === "inactive"
            ? { status: "inactive" }
            : { deletedAt: new Date() },
        )
        .where(eq(usersTable.id, counterpart.user.id));

      const reopened = await request(app)
        .post("/api/chat/groups")
        .set(authHeader(caller.token))
        .send({ name: "Chat", type: "direct", memberIds: [counterpart.user.id] });
      expect(reopened.status).toBe(400);

      const [membership] = await db
        .select({ hiddenAt: chatGroupMembersTable.hiddenAt })
        .from(chatGroupMembersTable)
        .where(
          and(
            eq(chatGroupMembersTable.groupId, created.body.id),
            eq(chatGroupMembersTable.userId, caller.user.id),
          ),
        );
      expect(membership?.hiddenAt?.getTime()).toBe(hiddenAt.getTime());

      const retainedGroups = await db
        .select({ id: chatGroupsTable.id })
        .from(chatGroupsTable)
        .where(eq(chatGroupsTable.id, created.body.id));
      const retainedMessages = await db
        .select({ id: messagesTable.id, content: messagesTable.content })
        .from(messagesTable)
        .where(eq(messagesTable.groupId, created.body.id));
      expect(retainedGroups).toHaveLength(1);
      expect(retainedMessages).toEqual([
        { id: message.body.id, content: "Historial que debe conservarse" },
      ]);

      const inbox = await request(app)
        .get("/api/chat/groups?hidden=true")
        .set(authHeader(caller.token));
      expect(inbox.status).toBe(200);
      expect(inbox.body).not.toContainEqual(
        expect.objectContaining({ id: created.body.id }),
      );
    },
  );

  it("does not reopen an archived direct thread if the counterpart is deactivated during the request", async () => {
    const caller = await createUser({ role: "teacher" });
    const counterpart = await createUser({ role: "teacher" });
    const created = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(caller.token))
      .send({ name: "Chat archivado", type: "direct", memberIds: [counterpart.user.id] });
    expect(created.status).toBe(201);
    trackGroup(created.body.id);

    const message = await request(app)
      .post(`/api/chat/groups/${created.body.id}/messages`)
      .set(authHeader(caller.token))
      .send({ content: "Historial que debe conservarse" });
    expect(message.status).toBe(201);

    const hiddenAt = new Date();
    await db
      .update(chatGroupMembersTable)
      .set({ hiddenAt })
      .where(
        and(
          eq(chatGroupMembersTable.groupId, created.body.id),
          eq(chatGroupMembersTable.userId, caller.user.id),
        ),
      );

    let releaseLifecycleUpdate!: () => void;
    let signalLifecycleUpdateApplied!: () => void;
    const lifecycleUpdateHeld = new Promise<void>((resolve) => {
      releaseLifecycleUpdate = resolve;
    });
    const lifecycleUpdateApplied = new Promise<void>((resolve) => {
      signalLifecycleUpdateApplied = resolve;
    });
    const lifecycleUpdate = db.transaction(async (tx) => {
      await tx
        .update(usersTable)
        .set({ status: "inactive" })
        .where(eq(usersTable.id, counterpart.user.id));
      signalLifecycleUpdateApplied();
      await lifecycleUpdateHeld;
    });
    await lifecycleUpdateApplied;

    const reopening = request(app)
      .post("/api/chat/groups")
      .set(authHeader(caller.token))
      .send({ name: "Chat", type: "direct", memberIds: [counterpart.user.id] });

    // Let the request reach the lifecycle row lock before allowing the
    // deactivation transaction to commit.
    await new Promise((resolve) => setTimeout(resolve, 75));
    releaseLifecycleUpdate();
    await lifecycleUpdate;

    const reopened = await reopening;
    expect(reopened.status).toBe(400);

    const [membership] = await db
      .select({ hiddenAt: chatGroupMembersTable.hiddenAt })
      .from(chatGroupMembersTable)
      .where(
        and(
          eq(chatGroupMembersTable.groupId, created.body.id),
          eq(chatGroupMembersTable.userId, caller.user.id),
        ),
      );
    expect(membership?.hiddenAt?.getTime()).toBe(hiddenAt.getTime());

    const retainedMessages = await db
      .select({ id: messagesTable.id, content: messagesTable.content })
      .from(messagesTable)
      .where(eq(messagesTable.groupId, created.body.id));
    expect(retainedMessages).toEqual([
      { id: message.body.id, content: "Historial que debe conservarse" },
    ]);

    const inbox = await request(app)
      .get("/api/chat/groups")
      .set(authHeader(caller.token));
    expect(inbox.status).toBe(200);
    expect(inbox.body).not.toContainEqual(
      expect.objectContaining({ id: created.body.id }),
    );

    const history = await request(app)
      .get(`/api/chat/groups/${created.body.id}/messages`)
      .set(authHeader(caller.token));
    expect(history.status).toBe(403);
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

  it("omits direct conversations with deleted accounts from both inboxes without deleting their history", async () => {
    const caller = await createUser({ role: "teacher" });
    const regularCounterpart = await createUser({ role: "teacher" });
    const hiddenCounterpart = await createUser({ role: "teacher" });
    const regularGroup = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(caller.token))
      .send({
        name: "Conversación habitual",
        type: "direct",
        memberIds: [regularCounterpart.user.id],
      });
    const hiddenGroup = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(caller.token))
      .send({
        name: "Conversación archivada",
        type: "direct",
        memberIds: [hiddenCounterpart.user.id],
      });
    expect(regularGroup.status).toBe(201);
    expect(hiddenGroup.status).toBe(201);
    trackGroup(regularGroup.body.id);
    trackGroup(hiddenGroup.body.id);

    const regularMessage = await request(app)
      .post(`/api/chat/groups/${regularGroup.body.id}/messages`)
      .set(authHeader(caller.token))
      .send({ content: "Historial habitual" });
    const hiddenMessage = await request(app)
      .post(`/api/chat/groups/${hiddenGroup.body.id}/messages`)
      .set(authHeader(caller.token))
      .send({ content: "Historial archivado" });
    expect(regularMessage.status).toBe(201);
    expect(hiddenMessage.status).toBe(201);

    await db
      .update(chatGroupMembersTable)
      .set({ hiddenAt: new Date() })
      .where(
        and(
          eq(chatGroupMembersTable.groupId, hiddenGroup.body.id),
          eq(chatGroupMembersTable.userId, caller.user.id),
        ),
      );
    await db
      .update(usersTable)
      .set({ deletedAt: new Date() })
      .where(eq(usersTable.id, regularCounterpart.user.id));
    await db
      .update(usersTable)
      .set({ deletedAt: new Date() })
      .where(eq(usersTable.id, hiddenCounterpart.user.id));

    const regularList = await request(app)
      .get("/api/chat/groups?hidden=false")
      .set(authHeader(caller.token));
    const hiddenList = await request(app)
      .get("/api/chat/groups?hidden=true")
      .set(authHeader(caller.token));
    expect(regularList.status).toBe(200);
    expect(hiddenList.status).toBe(200);
    expect(regularList.body).not.toContainEqual(
      expect.objectContaining({ id: regularGroup.body.id }),
    );
    expect(hiddenList.body).not.toContainEqual(
      expect.objectContaining({ id: hiddenGroup.body.id }),
    );

    const retainedRegularGroup = await db
      .select({ id: chatGroupsTable.id })
      .from(chatGroupsTable)
      .where(
        eq(chatGroupsTable.id, regularGroup.body.id),
      );
    const retainedHiddenGroup = await db
      .select({ id: chatGroupsTable.id })
      .from(chatGroupsTable)
      .where(eq(chatGroupsTable.id, hiddenGroup.body.id));
    const retainedMessages = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(eq(messagesTable.groupId, regularGroup.body.id));
    const retainedHiddenMessages = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .where(eq(messagesTable.groupId, hiddenGroup.body.id));
    expect(retainedRegularGroup).toHaveLength(1);
    expect(retainedHiddenGroup).toHaveLength(1);
    expect(retainedMessages.map((message) => message.id)).toContain(regularMessage.body.id);
    expect(retainedHiddenMessages.map((message) => message.id)).toContain(hiddenMessage.body.id);
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
  it.each(["desactivada", "eliminada"] as const)(
    "denies direct-chat attachment downloads when the counterpart is %s",
    async (counterpartState) => {
      const caller = await createUser({ role: "teacher" });
      const counterpart = await createUser({ role: "teacher" });
      const group = await request(app)
        .post("/api/chat/groups")
        .set(authHeader(caller.token))
        .send({
          name: "Conversación con adjunto",
          type: "direct",
          memberIds: [counterpart.user.id],
        });
      expect(group.status).toBe(201);
      trackGroup(group.body.id);

      const attachmentContents = "contenido privado del adjunto";
      const [message] = await db
        .insert(messagesTable)
        .values({
          groupId: group.body.id,
          senderId: caller.user.id,
          content: "",
          kind: "file",
          attachmentPath: "/objects/uploads/private-chat-attachment",
          attachmentName: "privado.txt",
          attachmentType: "text/plain",
          attachmentSize: attachmentContents.length,
        })
        .returning();

      await db
        .update(usersTable)
        .set(
          counterpartState === "desactivada"
            ? { status: "inactive" }
            : { deletedAt: new Date() },
        )
        .where(eq(usersTable.id, counterpart.user.id));

      const getObject = vi
        .spyOn(ObjectStorageService.prototype, "getObjectEntityFile")
        .mockResolvedValue({ kind: "local", absPath: "/tmp/private-chat-attachment" });
      const downloadObject = vi
        .spyOn(ObjectStorageService.prototype, "downloadObject")
        .mockResolvedValue(new Response(attachmentContents));

      const response = await request(app)
        .get(`/api/chat/messages/${message!.id}/attachment`)
        .set(authHeader(caller.token));

      expect(response.status).toBe(403);
      expect(response.text).not.toContain(attachmentContents);
      expect(getObject).not.toHaveBeenCalled();
      expect(downloadObject).not.toHaveBeenCalled();
    },
  );

  it.each(["desactivada", "eliminada"] as const)(
    "does not expose hidden direct messages or allow restore when the counterpart is %s",
    async (counterpartState) => {
      const caller = await createUser({ role: "teacher" });
      const counterpart = await createUser({ role: "teacher" });
      const group = await request(app)
        .post("/api/chat/groups")
        .set(authHeader(caller.token))
        .send({
          name: "Conversación con cuenta no disponible",
          type: "direct",
          memberIds: [counterpart.user.id],
        });
      expect(group.status).toBe(201);
      trackGroup(group.body.id);

      const hiddenText = `Texto oculto tras cuenta ${counterpartState}`;
      const message = await request(app)
        .post(`/api/chat/groups/${group.body.id}/messages`)
        .set(authHeader(caller.token))
        .send({ content: hiddenText });
      expect(message.status).toBe(201);
      expect(
        (
          await request(app)
            .post(`/api/chat/messages/${message.body.id}/hide`)
            .set(authHeader(caller.token))
        ).status,
      ).toBe(204);

      await db
        .update(usersTable)
        .set(
          counterpartState === "desactivada"
            ? { status: "inactive" }
            : { deletedAt: new Date() },
        )
        .where(eq(usersTable.id, counterpart.user.id));

      const hiddenMessages = await request(app)
        .get("/api/chat/hidden-messages")
        .set(authHeader(caller.token));
      expect(hiddenMessages.status).toBe(200);
      expect(hiddenMessages.body).not.toContainEqual(
        expect.objectContaining({ id: message.body.id }),
      );
      expect(JSON.stringify(hiddenMessages.body)).not.toContain(hiddenText);

      const restore = await request(app)
        .post(`/api/chat/messages/${message.body.id}/restore`)
        .set(authHeader(caller.token));
      expect(restore.status).toBe(403);
    },
  );

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

  it("includes a participant's role and personal teaching center", async () => {
    const centerId = await createCenter(await createProvince());
    const [center] = await db
      .select({ name: centersTable.name })
      .from(centersTable)
      .where(eq(centersTable.id, centerId));
    const teacher = await createUser({ role: "teacher" });
    const coordinator = await createUser({ role: "coordinator" });
    await db
      .update(usersTable)
      .set({ teachingCenterId: centerId })
      .where(eq(usersTable.id, coordinator.user.id));
    const group = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(teacher.token))
      .send({
        name: coordinator.user.name,
        type: "direct",
        memberIds: [coordinator.user.id],
      });
    expect(group.status).toBe(201);
    trackGroup(group.body.id);

    const members = await request(app)
      .get(`/api/chat/groups/${group.body.id}/members`)
      .set(authHeader(teacher.token));
    expect(members.status).toBe(200);
    expect(members.body).toContainEqual(
      expect.objectContaining({
        userId: coordinator.user.id,
        role: "coordinator",
        centerName: center!.name,
      }),
    );
  });

  it("hides an author's message only for that author while preserving global deletion", async () => {
    const author = await createUser({ role: "teacher" });
    const recipient = await createUser({ role: "teacher" });
    const outsider = await createUser({ role: "teacher" });
    const group = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(author.token))
      .send({ name: "Chat", type: "direct", memberIds: [recipient.user.id] });
    trackGroup(group.body.id);

    const hidden = await request(app)
      .post(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(author.token))
      .send({ content: "Solo para la otra persona" });
    expect(hidden.status).toBe(201);

    const ownHide = await request(app)
      .post(`/api/chat/messages/${hidden.body.id}/hide`)
      .set(authHeader(author.token));
    expect(ownHide.status).toBe(204);
    const otherHide = await request(app)
      .post(`/api/chat/messages/${hidden.body.id}/hide`)
      .set(authHeader(recipient.token));
    expect(otherHide.status).toBe(403);
    const outsiderHide = await request(app)
      .post(`/api/chat/messages/${hidden.body.id}/hide`)
      .set(authHeader(outsider.token));
    expect(outsiderHide.status).toBe(403);

    const authorMessages = await request(app)
      .get(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(author.token));
    const recipientMessages = await request(app)
      .get(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(recipient.token));
    expect(authorMessages.body).not.toContainEqual(
      expect.objectContaining({ id: hidden.body.id }),
    );
    expect(recipientMessages.body).toContainEqual(
      expect.objectContaining({ id: hidden.body.id, content: "Solo para la otra persona" }),
    );
    const authorTrash = await request(app)
      .get(`/api/chat/groups/${group.body.id}/hidden-messages`)
      .set(authHeader(author.token));
    const recipientTrash = await request(app)
      .get(`/api/chat/groups/${group.body.id}/hidden-messages`)
      .set(authHeader(recipient.token));
    const outsiderTrash = await request(app)
      .get(`/api/chat/groups/${group.body.id}/hidden-messages`)
      .set(authHeader(outsider.token));
    expect(authorTrash.status).toBe(200);
    expect(authorTrash.body).toContainEqual(
      expect.objectContaining({ id: hidden.body.id, content: "Solo para la otra persona" }),
    );
    expect(recipientTrash.body).toEqual([]);
    expect(outsiderTrash.status).toBe(403);
    expect(
      (
        await request(app)
          .get("/api/chat/hidden-messages")
          .set(authHeader(author.token))
      ).body,
    ).toContainEqual(
      expect.objectContaining({
        id: hidden.body.id,
        conversationId: group.body.id,
        conversationName: "Chat",
        conversationType: "direct",
        content: "Solo para la otra persona",
        deleted: false,
      }),
    );
    expect(
      (
        await request(app)
          .get("/api/chat/hidden-messages")
          .set(authHeader(recipient.token))
      ).body,
    ).toEqual([]);
    expect(
      (
        await request(app)
          .get("/api/chat/hidden-messages")
          .set(authHeader(outsider.token))
      ).body,
    ).toEqual([]);
    expect((await request(app).get("/api/chat/hidden-messages")).status).toBe(401);
    expect(
      (
        await request(app)
          .post(`/api/chat/messages/${hidden.body.id}/restore`)
          .set(authHeader(recipient.token))
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/chat/messages/${hidden.body.id}/restore`)
          .set(authHeader(outsider.token))
      ).status,
    ).toBe(403);
    const restored = await request(app)
      .post(`/api/chat/messages/${hidden.body.id}/restore`)
      .set(authHeader(author.token));
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({
      id: hidden.body.id,
      content: "Solo para la otra persona",
      deleted: false,
    });
    const authorAfterRestore = await request(app)
      .get(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(author.token));
    expect(authorAfterRestore.body).toContainEqual(
      expect.objectContaining({ id: hidden.body.id, content: "Solo para la otra persona" }),
    );
    expect(recipientMessages.body).toContainEqual(
      expect.objectContaining({ id: hidden.body.id, content: "Solo para la otra persona" }),
    );

    const forEveryone = await request(app)
      .post(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(author.token))
      .send({ content: "Para eliminar para todos" });
    const globalDelete = await request(app)
      .delete(`/api/chat/messages/${forEveryone.body.id}`)
      .set(authHeader(author.token));
    expect(globalDelete.status).toBe(200);
    const recipientAfterDelete = await request(app)
      .get(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(recipient.token));
    expect(recipientAfterDelete.body).toContainEqual(
      expect.objectContaining({
        id: forEveryone.body.id,
        deleted: true,
      }),
    );

    const hiddenThenDeleted = await request(app)
      .post(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(author.token))
      .send({ content: "Tombstone no recuperable" });
    expect(
      (
        await request(app)
          .post(`/api/chat/messages/${hiddenThenDeleted.body.id}/hide`)
          .set(authHeader(author.token))
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .delete(`/api/chat/messages/${hiddenThenDeleted.body.id}`)
          .set(authHeader(author.token))
      ).status,
    ).toBe(200);
    const deletedHidden = await request(app)
      .get(`/api/chat/groups/${group.body.id}/hidden-messages`)
      .set(authHeader(author.token));
    expect(deletedHidden.body).toContainEqual(
      expect.objectContaining({
        id: hiddenThenDeleted.body.id,
        deleted: true,
        content: "",
      }),
    );
    const deletedGlobalHidden = await request(app)
      .get("/api/chat/hidden-messages")
      .set(authHeader(author.token));
    expect(deletedGlobalHidden.body).toContainEqual(
      expect.objectContaining({
        id: hiddenThenDeleted.body.id,
        conversationId: group.body.id,
        deleted: true,
        content: "",
        attachmentName: null,
      }),
    );
    const tombstoneRestore = await request(app)
      .post(`/api/chat/messages/${hiddenThenDeleted.body.id}/restore`)
      .set(authHeader(author.token));
    expect(tombstoneRestore.status).toBe(409);
    const recipientAfterTombstone = await request(app)
      .get(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(recipient.token));
    expect(recipientAfterTombstone.body).toContainEqual(
      expect.objectContaining({
        id: hiddenThenDeleted.body.id,
        deleted: true,
      }),
    );
  });

  it("does not list private message hides after leaving a conversation", async () => {
    const owner = await createUser({ role: "teacher" });
    const member = await createUser({ role: "teacher" });
    const group = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(owner.token))
      .send({ name: "Grupo con salida", type: "group", memberIds: [member.user.id] });
    expect(group.status).toBe(201);
    trackGroup(group.body.id);

    const message = await request(app)
      .post(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(member.token))
      .send({ content: "Oculto antes de salir" });
    expect(message.status).toBe(201);
    expect(
      (
        await request(app)
          .post(`/api/chat/messages/${message.body.id}/hide`)
          .set(authHeader(member.token))
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .get("/api/chat/hidden-messages")
          .set(authHeader(member.token))
      ).body,
    ).toContainEqual(expect.objectContaining({ id: message.body.id }));

    expect(
      (
        await request(app)
          .post(`/api/chat/groups/${group.body.id}/leave`)
          .set(authHeader(member.token))
      ).status,
    ).toBe(204);
    expect(
      (
        await request(app)
          .get("/api/chat/hidden-messages")
          .set(authHeader(member.token))
      ).body,
    ).toEqual([]);
  });

  it("hides a conversation only for its caller and resurfaces it after activity or reopening", async () => {
    const caller = await createUser({ role: "teacher" });
    const other = await createUser({ role: "teacher" });
    const outsider = await createUser({ role: "teacher" });
    const group = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(caller.token))
      .send({ name: "Chat", type: "direct", memberIds: [other.user.id] });
    expect(group.status).toBe(201);
    trackGroup(group.body.id);

    const hidden = await request(app)
      .post(`/api/chat/groups/${group.body.id}/hide`)
      .set(authHeader(caller.token));
    expect(hidden.status).toBe(204);
    const outsiderHide = await request(app)
      .post(`/api/chat/groups/${group.body.id}/hide`)
      .set(authHeader(outsider.token));
    expect(outsiderHide.status).toBe(403);

    const callerList = await request(app)
      .get("/api/chat/groups")
      .set(authHeader(caller.token));
    const otherList = await request(app)
      .get("/api/chat/groups")
      .set(authHeader(other.token));
    expect(callerList.body).not.toContainEqual(
      expect.objectContaining({ id: group.body.id }),
    );
    expect(otherList.body).toContainEqual(
      expect.objectContaining({ id: group.body.id }),
    );

    await request(app)
      .post(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(other.token))
      .send({ content: "Nueva actividad" });
    const afterActivity = await request(app)
      .get("/api/chat/groups")
      .set(authHeader(caller.token));
    expect(afterActivity.body).toContainEqual(
      expect.objectContaining({ id: group.body.id }),
    );

    await request(app)
      .post(`/api/chat/groups/${group.body.id}/hide`)
      .set(authHeader(caller.token));
    const reopened = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(caller.token))
      .send({ name: other.user.name, type: "direct", memberIds: [other.user.id] });
    expect(reopened.status).toBe(200);
    const afterReopening = await request(app)
      .get("/api/chat/groups")
      .set(authHeader(caller.token));
    expect(afterReopening.body).toContainEqual(
      expect.objectContaining({ id: group.body.id }),
    );
  });

  it("lists hidden conversations and restores them only for the caller", async () => {
    const caller = await createUser({ role: "teacher" });
    const other = await createUser({ role: "teacher" });
    const outsider = await createUser({ role: "teacher" });
    const group = await request(app)
      .post("/api/chat/groups")
      .set(authHeader(caller.token))
      .send({ name: "Grupo privado", type: "group", memberIds: [other.user.id] });
    expect(group.status).toBe(201);
    trackGroup(group.body.id);

    const message = await request(app)
      .post(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(other.token))
      .send({ content: "Historial conservado" });
    expect(message.status).toBe(201);

    const hidden = await request(app)
      .post(`/api/chat/groups/${group.body.id}/hide`)
      .set(authHeader(caller.token));
    expect(hidden.status).toBe(204);

    const hiddenList = await request(app)
      .get("/api/chat/groups?hidden=true")
      .set(authHeader(caller.token));
    expect(hiddenList.status).toBe(200);
    expect(hiddenList.body).toContainEqual(
      expect.objectContaining({ id: group.body.id }),
    );
    const otherHiddenList = await request(app)
      .get("/api/chat/groups?hidden=true")
      .set(authHeader(other.token));
    expect(otherHiddenList.body).not.toContainEqual(
      expect.objectContaining({ id: group.body.id }),
    );
    const invalidFilter = await request(app)
      .get("/api/chat/groups?hidden=anything")
      .set(authHeader(caller.token));
    expect(invalidFilter.status).toBe(400);

    const otherHide = await request(app)
      .post(`/api/chat/groups/${group.body.id}/hide`)
      .set(authHeader(other.token));
    expect(otherHide.status).toBe(204);
    const outsiderRestore = await request(app)
      .post(`/api/chat/groups/${group.body.id}/restore`)
      .set(authHeader(outsider.token));
    expect(outsiderRestore.status).toBe(403);

    const beforeRestoreMemberships = await db
      .select()
      .from(chatGroupMembersTable)
      .where(eq(chatGroupMembersTable.groupId, group.body.id));
    expect(beforeRestoreMemberships).toHaveLength(2);
    const restored = await request(app)
      .post(`/api/chat/groups/${group.body.id}/restore`)
      .set(authHeader(caller.token));
    expect(restored.status).toBe(204);

    const callerList = await request(app)
      .get("/api/chat/groups")
      .set(authHeader(caller.token));
    expect(callerList.body).toContainEqual(
      expect.objectContaining({ id: group.body.id }),
    );
    const otherList = await request(app)
      .get("/api/chat/groups")
      .set(authHeader(other.token));
    expect(otherList.body).not.toContainEqual(
      expect.objectContaining({ id: group.body.id }),
    );
    const otherHiddenAfterRestore = await request(app)
      .get("/api/chat/groups?hidden=true")
      .set(authHeader(other.token));
    expect(otherHiddenAfterRestore.body).toContainEqual(
      expect.objectContaining({ id: group.body.id }),
    );
    const afterRestoreMemberships = await db
      .select()
      .from(chatGroupMembersTable)
      .where(eq(chatGroupMembersTable.groupId, group.body.id));
    expect(afterRestoreMemberships).toHaveLength(2);
    const callerMembership = afterRestoreMemberships.find(
      (membership) => membership.userId === caller.user.id,
    );
    expect(callerMembership?.hiddenAt).toBeNull();

    const messages = await request(app)
      .get(`/api/chat/groups/${group.body.id}/messages`)
      .set(authHeader(caller.token));
    expect(messages.body).toContainEqual(
      expect.objectContaining({
        id: message.body.id,
        content: "Historial conservado",
      }),
    );
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
