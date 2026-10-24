import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { realpathSync } from "node:fs";
import { mkdir, rm, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { inArray, sql, eq } from "drizzle-orm";

const TEST_YEAR = `chat-cleanup-${Date.now()}`;
const STORAGE_ROOT = process.env.COORDINA_CHAT_CLEANUP_TEST_ROOT
  ? join(process.env.COORDINA_CHAT_CLEANUP_TEST_ROOT, "chat-storage")
  : "";
const ATTACHMENT_PATH = "/objects/chat-cleanup/attachment/test-audio.webm";

let t: typeof import("@workspace/db");
let app: typeof import("../src/app").default;
let helpers: typeof import("./helpers");
let originalActiveYear: string | null = null;
let worker: typeof import("../src/lib/chatAttachmentDeletionWorker");

beforeAll(async () => {
  const root = process.env.COORDINA_CHAT_CLEANUP_TEST_ROOT;
  if (
    !root ||
    !/\/coordina-db-test\.[a-zA-Z0-9]+$/.test(root) ||
    realpathSync(root) !== root
  ) {
    throw new Error(
      "Use bash deploy/test-db.sh --chat-cleanup-only. Never run destructive chat fixtures on the app database.",
    );
  }
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (
    url.pathname !== "/coordina_chat_cleanup" ||
    url.searchParams.get("host") !== join(root, "socket")
  ) {
    throw new Error("Refusing a connection outside the isolated chat cleanup database.");
  }

  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_STORAGE_DIR = STORAGE_ROOT;
  process.env.JWT_SECRET = "isolated-chat-cleanup-test-only";

  t = await import("@workspace/db");
  const identity = await t.db.execute(
    sql`SELECT current_database() AS name, current_setting('data_directory') AS directory, current_setting('listen_addresses') AS listeners`,
  );
  expect(identity.rows[0]).toEqual({
    name: "coordina_chat_cleanup",
    directory: join(root, "data"),
    listeners: "",
  });

  const settings = await import("../src/lib/settings");
  originalActiveYear = (await settings.getActiveAcademicYear()) ?? null;
  const settingsRow = await settings.getSettings();
  await t.db
    .update(t.integrationSettingsTable)
    .set({ activeAcademicYear: null })
    .where(eq(t.integrationSettingsTable.id, settingsRow.id));

  await mkdir(join(STORAGE_ROOT, "private", "chat-cleanup", "attachment"), {
    recursive: true,
  });
  await writeFile(
    join(STORAGE_ROOT, "private", "chat-cleanup", "attachment", "test-audio.webm"),
    "test audio bytes",
  );

  helpers = await import("./helpers");
  worker = await import("../src/lib/chatAttachmentDeletionWorker");
  app = (await import("../src/app")).default;
}, 30_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (t) {
    const settings = await import("../src/lib/settings");
    const settingsRow = await settings.getSettings();
    await t.db
      .update(t.integrationSettingsTable)
      .set({ activeAcademicYear: originalActiveYear })
      .where(eq(t.integrationSettingsTable.id, settingsRow.id));
  }
  if (STORAGE_ROOT) await rm(STORAGE_ROOT, { recursive: true, force: true });
  if (t) await t.db.delete(t.chatAttachmentDeletionsTable);
});

describe("PUT /api/academic-years/active chat cleanup", () => {
  it("purges only completed deletions older than the retention period", async () => {
    const now = new Date("2026-10-24T12:00:00.000Z");
    const expiredAt = new Date(
      now.getTime() - worker.CHAT_ATTACHMENT_DELETE_RETENTION_MS - 1,
    );
    const recentAt = new Date(
      now.getTime() - worker.CHAT_ATTACHMENT_DELETE_RETENTION_MS + 1,
    );
    const inserted = await t.db
      .insert(t.chatAttachmentDeletionsTable)
      .values([
        { status: "done", objectPath: null, completedAt: expiredAt },
        { status: "done", objectPath: null, completedAt: recentAt },
        { status: "done", objectPath: null, completedAt: null },
        {
          status: "done",
          objectPath: "/objects/chat-cleanup/unresolved-done",
          completedAt: expiredAt,
        },
        {
          status: "pending",
          objectPath: "/objects/chat-cleanup/pending",
          completedAt: expiredAt,
        },
        {
          status: "processing",
          objectPath: "/objects/chat-cleanup/processing",
          completedAt: expiredAt,
        },
        {
          status: "failed",
          objectPath: "/objects/chat-cleanup/failed",
          completedAt: expiredAt,
        },
      ])
      .returning({
        id: t.chatAttachmentDeletionsTable.id,
        status: t.chatAttachmentDeletionsTable.status,
        objectPath: t.chatAttachmentDeletionsTable.objectPath,
        completedAt: t.chatAttachmentDeletionsTable.completedAt,
      });
    const expiredDoneId = inserted.find(
      (row) =>
        row.status === "done" &&
        row.objectPath === null &&
        row.completedAt?.getTime() === expiredAt.getTime(),
    )!.id;

    expect(await worker.purgeCompletedChatAttachmentDeletions(now)).toBe(1);
    const remaining = await t.db
      .select({ id: t.chatAttachmentDeletionsTable.id })
      .from(t.chatAttachmentDeletionsTable)
      .where(
        inArray(
          t.chatAttachmentDeletionsTable.id,
          inserted.map((row) => row.id),
        ),
      );
    expect(remaining.map((row) => row.id)).not.toContain(expiredDoneId);
    expect(remaining).toHaveLength(inserted.length - 1);
  });

  it("requires explicit confirmation and is superadmin-only", async () => {
    const admin = await helpers.createUser({ role: "superadmin" });
    const coordinator = await helpers.createUser({ role: "coordinator" });
    const year = `${TEST_YEAR}-authorization`;
    await helpers.createAcademicYear(year);

    const missingConfirmation = await request(app)
      .put("/api/academic-years/active")
      .set(helpers.authHeader(admin.token))
      .send({ name: year, confirmConversationDeletion: false });
    expect(missingConfirmation.status).toBe(400);

    const forbidden = await request(app)
      .put("/api/academic-years/active")
      .set(helpers.authHeader(coordinator.token))
      .send({ name: year, confirmConversationDeletion: true });
    expect(forbidden.status).toBe(403);
  });

  it("permanently removes conversations, participants, messages, reactions, hides, and attachments after confirmation", async () => {
    const admin = await helpers.createUser({ role: "superadmin" });
    const recipient = await helpers.createUser({ role: "teacher" });
    const year = `${TEST_YEAR}-confirmed`;
    await helpers.createAcademicYear(year);

    const [group] = await t.db
      .insert(t.chatGroupsTable)
      .values({ name: "Conversación de prueba", type: "group" })
      .returning();
    expect(group).toBeTruthy();
    await t.db.insert(t.chatGroupMembersTable).values([
      { groupId: group!.id, userId: admin.user.id },
      { groupId: group!.id, userId: recipient.user.id },
    ]);
    const [groupMessage] = await t.db
      .insert(t.messagesTable)
      .values({
        groupId: group!.id,
        senderId: admin.user.id,
        content: "Historial que debe eliminarse",
        attachmentPath: ATTACHMENT_PATH,
      })
      .returning();
    await t.db.insert(t.messagesTable).values({
      senderId: admin.user.id,
      recipientId: recipient.user.id,
      content: "Mensaje directo antiguo",
    });
    await t.db.insert(t.messageReactionsTable).values({
      messageId: groupMessage!.id,
      userId: recipient.user.id,
      emoji: "👍",
    });
    await t.db.insert(t.messageUserHidesTable).values({
      messageId: groupMessage!.id,
      userId: recipient.user.id,
    });

    const response = await request(app)
      .put("/api/academic-years/active")
      .set(helpers.authHeader(admin.token))
      .send({ name: year, confirmConversationDeletion: true });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.activeYear).toBe(year);
    expect(response.body.chatCleanup).toEqual({
      conversationsDeleted: 1,
      messagesDeleted: 2,
      attachmentsDeleted: 1,
      attachmentDeletionFailures: 0,
    });
    expect(await t.db.select().from(t.chatGroupsTable)).toHaveLength(0);
    expect(await t.db.select().from(t.chatGroupMembersTable)).toHaveLength(0);
    expect(await t.db.select().from(t.messagesTable)).toHaveLength(0);
    expect(await t.db.select().from(t.messageReactionsTable)).toHaveLength(0);
    expect(await t.db.select().from(t.messageUserHidesTable)).toHaveLength(0);
    await expect(
      access(join(STORAGE_ROOT, "private", "chat-cleanup", "attachment", "test-audio.webm")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("automatically retries a failed deletion and removes the private path when successful", async () => {
    const admin = await helpers.createUser({ role: "superadmin" });
    const recipient = await helpers.createUser({ role: "teacher" });
    const year = `${TEST_YEAR}-auto-retry`;
    const attachmentPath = `/objects/chat-cleanup/retry-${Date.now()}`;
    await helpers.createAcademicYear(year);
    await t.db.insert(t.messagesTable).values({
      senderId: admin.user.id,
      recipientId: recipient.user.id,
      content: "Mensaje que se eliminará",
      attachmentPath,
    });

    const { ObjectStorageService } = await import("../src/lib/objectStorage");
    const deleteSpy = vi
      .spyOn(ObjectStorageService.prototype, "deleteObjectEntity")
      .mockRejectedValueOnce(new Error("private object location and content"))
      .mockResolvedValue(undefined);
    const response = await request(app)
      .put("/api/academic-years/active")
      .set(helpers.authHeader(admin.token))
      .send({ name: year, confirmConversationDeletion: true });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.activeYear).toBe(year);
    expect(response.body.chatCleanup).toMatchObject({
      attachmentsDeleted: 0,
      attachmentDeletionFailures: 1,
    });
    const currentSuperadmin = await helpers.createUser({ role: "superadmin" });
    const pendingResponse = await request(app)
      .get("/api/academic-years/chat-attachment-deletions")
      .set(helpers.authHeader(currentSuperadmin.token));
    expect(pendingResponse.status, JSON.stringify(pendingResponse.body)).toBe(200);
    const pending = pendingResponse.body.find(
      (row: { status: string }) => row.status === "pending",
    );
    expect(pending).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "No se pudo borrar el archivo en Object Storage.",
    });
    expect(pending).not.toHaveProperty("objectPath");

    const [queueRow] = await t.db
      .select()
      .from(t.chatAttachmentDeletionsTable)
      .where(eq(t.chatAttachmentDeletionsTable.objectPath, attachmentPath));
    expect(queueRow).toBeTruthy();
    await t.db
      .update(t.chatAttachmentDeletionsTable)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(t.chatAttachmentDeletionsTable.id, queueRow!.id));
    expect(await worker.processNextChatAttachmentDeletion(queueRow!.id)).toBe(true);

    const [completed] = await t.db
      .select()
      .from(t.chatAttachmentDeletionsTable)
      .where(eq(t.chatAttachmentDeletionsTable.id, queueRow!.id));
    expect(completed).toMatchObject({
      status: "done",
      attempts: 2,
      objectPath: null,
      lastError: null,
    });
    expect(deleteSpy).toHaveBeenCalledTimes(2);
  });

  it("treats an already-missing object as a successful deletion", async () => {
    const admin = await helpers.createUser({ role: "superadmin" });
    const recipient = await helpers.createUser({ role: "teacher" });
    const year = `${TEST_YEAR}-missing-object`;
    const attachmentPath = `/objects/chat-cleanup/does-not-exist-${Date.now()}`;
    await helpers.createAcademicYear(year);
    await t.db.insert(t.messagesTable).values({
      senderId: admin.user.id,
      recipientId: recipient.user.id,
      content: "Mensaje con objeto ya inexistente",
      attachmentPath,
    });

    const response = await request(app)
      .put("/api/academic-years/active")
      .set(helpers.authHeader(admin.token))
      .send({ name: year, confirmConversationDeletion: true });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.chatCleanup).toMatchObject({
      attachmentsDeleted: 1,
      attachmentDeletionFailures: 0,
    });
  });

  it("keeps persistent failures visible without blocking the course and lets a superadmin retry", async () => {
    const admin = await helpers.createUser({ role: "superadmin" });
    const recipient = await helpers.createUser({ role: "teacher" });
    const year = `${TEST_YEAR}-persistent-failure`;
    const attachmentPath = `/objects/chat-cleanup/persistent-${Date.now()}`;
    await helpers.createAcademicYear(year);
    await t.db.insert(t.messagesTable).values({
      senderId: admin.user.id,
      recipientId: recipient.user.id,
      content: "Mensaje con borrado persistentemente fallido",
      attachmentPath,
    });

    const { ObjectStorageService } = await import("../src/lib/objectStorage");
    const deleteSpy = vi
      .spyOn(ObjectStorageService.prototype, "deleteObjectEntity")
      .mockRejectedValue(new Error("private storage details"));
    const response = await request(app)
      .put("/api/academic-years/active")
      .set(helpers.authHeader(admin.token))
      .send({ name: year, confirmConversationDeletion: true });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.activeYear).toBe(year);
    expect(response.body.chatCleanup.attachmentDeletionFailures).toBe(1);

    const [queueRow] = await t.db
      .select()
      .from(t.chatAttachmentDeletionsTable)
      .where(eq(t.chatAttachmentDeletionsTable.objectPath, attachmentPath));
    expect(queueRow?.status).toBe("pending");
    for (let attempt = 2; attempt <= worker.CHAT_ATTACHMENT_DELETE_MAX_ATTEMPTS; attempt += 1) {
      await t.db
        .update(t.chatAttachmentDeletionsTable)
        .set({ nextAttemptAt: new Date(0) })
        .where(eq(t.chatAttachmentDeletionsTable.id, queueRow!.id));
      expect(await worker.processNextChatAttachmentDeletion(queueRow!.id)).toBe(true);
    }
    const [failed] = await t.db
      .select()
      .from(t.chatAttachmentDeletionsTable)
      .where(eq(t.chatAttachmentDeletionsTable.id, queueRow!.id));
    expect(failed).toMatchObject({
      status: "failed",
      attempts: worker.CHAT_ATTACHMENT_DELETE_MAX_ATTEMPTS,
      lastError: "No se pudo borrar el archivo en Object Storage.",
    });

    deleteSpy.mockResolvedValue(undefined);
    const currentSuperadmin = await helpers.createUser({ role: "superadmin" });
    const manualRetry = await request(app)
      .post(`/api/academic-years/chat-attachment-deletions/${queueRow!.id}/retry`)
      .set(helpers.authHeader(currentSuperadmin.token));
    expect(manualRetry.status, JSON.stringify(manualRetry.body)).toBe(200);
    expect(manualRetry.body).toMatchObject({
      id: queueRow!.id,
      status: "done",
      attempts: 1,
      lastError: null,
    });
    expect(manualRetry.body).not.toHaveProperty("objectPath");
  });
});
