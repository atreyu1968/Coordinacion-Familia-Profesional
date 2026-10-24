import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { realpathSync } from "node:fs";
import { mkdir, rm, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { sql, eq } from "drizzle-orm";

const TEST_YEAR = `chat-cleanup-${Date.now()}`;
const STORAGE_ROOT = process.env.COORDINA_CHAT_CLEANUP_TEST_ROOT
  ? join(process.env.COORDINA_CHAT_CLEANUP_TEST_ROOT, "chat-storage")
  : "";
const ATTACHMENT_PATH = "/objects/chat-cleanup/attachment/test-audio.webm";

let t: typeof import("@workspace/db");
let app: typeof import("../src/app").default;
let helpers: typeof import("./helpers");
let originalActiveYear: string | null = null;

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
  app = (await import("../src/app")).default;
}, 30_000);

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
});

describe("PUT /api/academic-years/active chat cleanup", () => {
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

    expect(response.status).toBe(200);
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
});
