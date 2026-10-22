import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";

const remote = vi.hoisted(() => ({ enabled: false, fail: false, calls: [] as number[] }));
vi.mock("../src/lib/nextcloud", async importOriginal => ({
  ...await importOriginal<typeof import("../src/lib/nextcloud")>(),
  resolveNextcloudConfig: () => remote.enabled ? { url: "https://cloud.example.test", adminUser: "test", adminPassword: "test-only" } : null,
  resolveNextcloudUrl: () => remote.enabled ? "https://cloud.example.test" : null,
  disableTestTeacherNextcloudAccount: async (_config: unknown, id: number) => {
    remote.calls.push(id);
    if (remote.fail) throw new Error("Simulated external revocation failure");
  },
}));

let t: typeof import("@workspace/db");
let app: (typeof import("../src/app"))["default"];
let helpers: typeof import("./helpers");
let admin: Awaited<ReturnType<typeof import("./helpers")["createUser"]>>;
let real: typeof admin;
let coordinator: typeof admin;
const fixtureIds: number[] = [];
let centerId: number, moduleId: number, groupId: number, realReply: number;
const endpoint = "/api/users/test-teachers/cleanup";
const confirmation = "ELIMINAR DOCENTES DE PRUEBA";
const auth = () => helpers.authHeader(admin.token);
const preview = () => request(app).get(endpoint).set(auth());
const purge = (fingerprint: string) => request(app).post(endpoint).set(auth()).send({ fingerprint, confirmation });
const teacherCount = async () => (await t.db.select().from(t.usersTable).where(inArray(t.usersTable.email, [...t.TEST_TEACHER_EMAILS]))).length;

beforeAll(async () => {
  const root = process.env.COORDINA_CLEANUP_TEST_ROOT;
  if (!root || !/\/coordina-db-test\.[a-zA-Z0-9]+$/.test(root) || realpathSync(root) !== root) {
    throw new Error("Use bash deploy/test-db.sh --test-teachers-only. Never run these destructive fixtures on the app DB.");
  }
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.pathname !== "/coordina_test_teacher_cleanup" || url.searchParams.get("host") !== join(root, "socket")) {
    throw new Error("Refusing a connection outside the runner's private PostgreSQL socket.");
  }
  t = await import("@workspace/db");
  const identity = await t.db.execute(sql`SELECT current_database() AS name, current_setting('data_directory') AS directory, current_setting('listen_addresses') AS listeners`);
  expect(identity.rows[0]).toEqual({ name: "coordina_test_teacher_cleanup", directory: join(root, "data"), listeners: "" });
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("JWT_SECRET", "isolated-cleanup-regression-not-for-production");
  helpers = await import("./helpers");
  app = (await import("../src/app")).default;
  admin = await helpers.createUser({ role: "superadmin" });
  real = await helpers.createUser({ role: "teacher" });
  coordinator = await helpers.createUser({ role: "coordinator", provinceId: await helpers.createProvince() });
  // Even a lookalike reserved-domain address is NOT in the cleanup allowlist.
  await t.db.update(t.usersTable).set({ email: "unrelated@admin.coordina.test" }).where(eq(t.usersTable.id, real.user.id));
  centerId = await helpers.createCenter(await helpers.createProvince());
  [moduleId] = (await t.db.insert(t.modulesTable).values({ name: "Isolated cleanup module" }).returning({ id: t.modulesTable.id })).map(row => row.id);
  for (const [index, email] of t.TEST_TEACHER_EMAILS.entries()) {
    const teacher = await helpers.createUser({ role: "teacher", centerId });
    fixtureIds.push(teacher.user.id);
    await t.db.update(t.usersTable).set({
      email, name: `Docente de prueba ${index}`,
      ...(index === 3 ? { status: "inactive", deletedAt: new Date() } : {}),
    }).where(eq(t.usersTable.id, teacher.user.id));
    await t.db.insert(t.teachingAssignmentsTable).values({ teacherId: teacher.user.id, moduleId, centerId, schoolYear: "2099-2100" });
    await t.db.insert(t.teacherYearConfirmationsTable).values({ teacherId: teacher.user.id, schoolYear: "2099-2100", status: "confirmed", deadline: new Date() });
    await t.db.insert(t.notificationsTable).values({ userId: teacher.user.id, title: "Fixture notification" });
  }
  await t.db.insert(t.teachingAssignmentsTable).values([
    { teacherId: fixtureIds[0], moduleId, centerId, schoolYear: "2098-2099", deletedAt: new Date() },
    { teacherId: real.user.id, moduleId, centerId, schoolYear: "2099-2100" },
  ]);
  const [event] = await t.db.insert(t.eventsTable).values({ name: "Real event to preserve", type: "meeting", createdById: admin.user.id }).returning();
  await t.db.insert(t.eventAttendancesTable).values([
    { eventId: event.id, email: t.TEST_TEACHER_EMAILS[0], fullName: "Unlinked fixture CSV attendee", source: "csv", status: "confirmed" },
    { eventId: event.id, userId: real.user.id, email: "real@example.test", fullName: "Real attendee", source: "qr", status: "confirmed" },
  ]);
  [groupId] = (await t.db.insert(t.chatGroupsTable).values({ name: "Shared fixture group", type: "module", moduleId, createdById: fixtureIds[0] }).returning({ id: t.chatGroupsTable.id })).map(row => row.id);
  await t.db.insert(t.chatGroupMembersTable).values([...fixtureIds, real.user.id].map(userId => ({ userId, groupId })));
  const [testMessage] = await t.db.insert(t.messagesTable).values({ groupId, senderId: fixtureIds[0], content: "Test-only group message" }).returning();
  [realReply] = (await t.db.insert(t.messagesTable).values({ groupId, senderId: real.user.id, content: "Real group reply to preserve", replyToId: testMessage.id }).returning({ id: t.messagesTable.id })).map(row => row.id);
  await t.db.insert(t.messagesTable).values({ senderId: real.user.id, recipientId: fixtureIds[0], content: "Direct test conversation" });
  await t.db.insert(t.messageReactionsTable).values({ messageId: testMessage.id, userId: real.user.id, emoji: "ok" });
  await t.db.insert(t.passwordResetTokensTable).values({ userId: fixtureIds[0], codeHash: "test", expiresAt: new Date(Date.now() + 60000) });
  await t.db.insert(t.accountAuditTable).values({
    actorId: admin.user.id, actorName: "Test admin", targetId: fixtureIds[0],
    action: "update", changes: [], beforeRole: "teacher", afterRole: "teacher",
  });
});
afterAll(async () => { vi.unstubAllEnvs(); await t?.pool.end(); });

describe("Permanent fixture cleanup, including production", () => {
  it("requires a superadministrator and never deletes on preview", async () => {
    expect((await request(app).get(endpoint)).status).toBe(401);
    expect((await request(app).post(endpoint).set(helpers.authHeader(real.token)).send({})).status).toBe(403);
    expect((await request(app).get(endpoint).set(helpers.authHeader(coordinator.token))).status).toBe(403);
    const result = await preview();
    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toContain("no-store");
    expect(result.body.accounts).toHaveLength(4);
    expect(result.body.assignments).toBe(5);
    expect(result.body.history).toContainEqual({ label: "Confirmaciones de curso", count: 4 });
    expect(result.body.blockedReasons).toEqual([]);
    expect(JSON.stringify(result.body)).not.toContain("passwordHash");
    expect(await teacherCount()).toBe(4);
  });
  it("requires the typed confirmation and rejects a stale snapshot", async () => {
    const before = await preview();
    expect((await request(app).post(endpoint).set(auth()).send({ fingerprint: before.body.fingerprint, confirmation: "yes" })).status).toBe(400);
    await t.db.insert(t.notificationsTable).values({ userId: fixtureIds[0], title: "Activity after preview" });
    expect((await purge(before.body.fingerprint)).status).toBe(409);
    expect(await teacherCount()).toBe(4);
    expect((await t.db.select().from(t.teachingAssignmentsTable)).length).toBe(6);
  });
  it("protects real replies to an owned shared thread", async () => {
    const [thread] = await t.db.insert(t.forumThreadsTable).values({ title: "Test thread with real participation", moduleId, authorId: fixtureIds[0] }).returning();
    const [post] = await t.db.insert(t.forumPostsTable).values({ threadId: thread.id, authorId: real.user.id, content: "Preserve me" }).returning();
    const state = await preview();
    expect(state.body.blockedReasons).toContain("Respuestas reales a hilos de prueba");
    expect((await purge(state.body.fingerprint)).status).toBe(409);
    expect(await teacherCount()).toBe(4);
    expect((await t.db.select().from(t.forumPostsTable).where(eq(t.forumPostsTable.id, post.id)))).toHaveLength(1);
    await t.db.delete(t.forumPostsTable).where(eq(t.forumPostsTable.id, post.id));
    await t.db.delete(t.forumThreadsTable).where(eq(t.forumThreadsTable.id, thread.id));
  });
  it("blocks an allowlisted identity whose role changed", async () => {
    await t.db.update(t.usersTable).set({ role: "coordinator" }).where(eq(t.usersTable.id, fixtureIds[0]));
    const state = await preview();
    expect(state.body.blockedReasons.length).toBeGreaterThan(0);
    expect((await purge(state.body.fingerprint)).status).toBe(409);
    await t.db.update(t.usersTable).set({ role: "teacher" }).where(eq(t.usersTable.id, fixtureIds[0]));
  });
  it("rolls back everything if an unknown foreign reference prevents deletion", async () => {
    await t.db.execute(sql`CREATE TABLE cleanup_custom_guard (user_id integer REFERENCES users(id))`);
    await t.db.execute(sql`INSERT INTO cleanup_custom_guard VALUES (${fixtureIds[0]})`);
    expect((await purge((await preview()).body.fingerprint)).status).toBe(409);
    expect(await teacherCount()).toBe(4);
    expect((await t.db.select().from(t.teachingAssignmentsTable))).toHaveLength(6);
    expect((await t.db.select().from(t.messagesTable))).toHaveLength(3);
    expect((await t.db.select().from(t.accountAuditTable).where(eq(t.accountAuditTable.action, t.TEST_TEACHER_PURGE_ACTION)))).toHaveLength(0);
    await t.db.execute(sql`DROP TABLE cleanup_custom_guard`);
  });
  it("does not delete locally if external access revocation fails", async () => {
    remote.enabled = true; remote.fail = true;
    expect((await purge((await preview()).body.fingerprint)).status).toBe(503);
    expect(await teacherCount()).toBe(4);
    expect((await t.db.select().from(t.teachingAssignmentsTable))).toHaveLength(6);
    remote.fail = false;
  });
  it("permanently removes only fixture accounts, assignments and history", async () => {
    const result = await purge((await preview()).body.fingerprint);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ accountsDeleted: 4, assignmentsDeleted: 5 });
    expect(result.body.historyDeleted).toBeGreaterThan(0);
    expect(remote.calls).toEqual(expect.arrayContaining(fixtureIds));
    expect(await teacherCount()).toBe(0);
    for (const table of [t.teacherYearConfirmationsTable, t.passwordResetTokensTable, t.notificationsTable, t.messageReactionsTable]) {
      expect((await t.db.select().from(table))).toHaveLength(0);
    }
    expect((await t.db.select().from(t.teachingAssignmentsTable))).toEqual([expect.objectContaining({ teacherId: real.user.id })]);
    expect((await t.db.select().from(t.eventAttendancesTable))).toEqual([expect.objectContaining({ userId: real.user.id })]);
    expect((await t.db.select().from(t.eventsTable))).toHaveLength(1);
    expect((await t.db.select().from(t.usersTable).where(eq(t.usersTable.id, real.user.id)))).toHaveLength(1);
    expect((await t.db.select().from(t.centersTable).where(eq(t.centersTable.id, centerId)))).toHaveLength(1);
    expect((await t.db.select().from(t.modulesTable).where(eq(t.modulesTable.id, moduleId)))).toHaveLength(1);
    expect((await t.db.select().from(t.chatGroupsTable).where(eq(t.chatGroupsTable.id, groupId)))[0].createdById).toBeNull();
    expect((await t.db.select().from(t.chatGroupMembersTable))).toHaveLength(1);
    const messages = await t.db.select().from(t.messagesTable);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: realReply, replyToId: null, content: "Real group reply to preserve" });
    expect((await t.db.select().from(t.accountAuditTable))).toEqual([expect.objectContaining({ action: t.TEST_TEACHER_PURGE_ACTION, targetId: admin.user.id })]);
  });
  it("prevents the installer from recreating removed fixtures", async () => {
    const result = spawnSync("pnpm", ["--filter", "@workspace/scripts", "run", "seed-test-teachers"], {
      cwd: join(process.cwd(), "../.."), encoding: "utf8", timeout: 30000, env: process.env,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("automatic recreation is disabled");
    expect(await teacherCount()).toBe(0);
    const again = await purge((await preview()).body.fingerprint);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ accountsDeleted: 0, assignmentsDeleted: 0, historyDeleted: 0 });
  });
});
