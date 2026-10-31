import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, forumDigestEventsTable as events, forumDigestDeliveriesTable as deliveries,
  notificationsTable, usersTable, forumThreadsTable, forumThreadContextsTable,
  teachingAssignmentsTable, trainingOfferTable } from "@workspace/db";
vi.mock("../src/lib/realtime", async original => ({
  ...await original<object>(), emitToUser: vi.fn(),
}));
vi.mock("../src/lib/push", async original => ({
  ...await original<object>(), sendPushToUsers: vi.fn().mockResolvedValue(undefined),
}));
import { sendPushToUsers } from "../src/lib/push";
import { enqueueForumDigest, DIGEST_WINDOW_MS } from "../src/lib/forumDigestQueue";
import { processNextForumDigest } from "../src/lib/forumDigestWorker";
import { getActiveAcademicYear } from "../src/lib/settings";
import { createUser, createProvince, createCenter, createModule, cleanup, snapshotTestFixtures, restoreTestFixtures } from "./helpers";

const stamp = `digest-${Date.now()}`;
const eventTime = new Date(Math.floor(Date.now() / DIGEST_WINDOW_MS) * DIGEST_WINDOW_MS - 2 * DIGEST_WINDOW_MS);
const due = new Date(eventTime.getTime() + DIGEST_WINDOW_MS + 1);
let actor: Awaited<ReturnType<typeof createUser>>, teacher: typeof actor, outsider: typeof actor;
let moduleId: number, threadId: number, centerId: number;
const userIds = () => [actor.user.id, teacher.user.id, outsider.user.id];
async function queue(key = "one", now = eventTime) {
  await enqueueForumDigest(db, { moduleId, threadId, actorId: actor.user.id, eventKey: key, kind: "reply" }, now);
}
const notices = () => db.select().from(notificationsTable).where(inArray(notificationsTable.userId, userIds()));
async function clearOwnedDigests() {
  await db.delete(events).where(eq(events.moduleId, moduleId));
  await db.delete(deliveries).where(eq(deliveries.moduleId, moduleId));
  // Existing global managers can legitimately receive this fictitious module's
  // notices too. Clean by owned target, not just by the test account IDs.
  await db.delete(notificationsTable).where(and(eq(notificationsTable.type, "forum_digest"),
    sql`${notificationsTable.target}->>'kind' = 'forum_module'`,
    sql`${notificationsTable.target}->>'id' = ${String(moduleId)}`));
}
beforeAll(async () => {
  const provinceId = await createProvince(stamp);
  centerId = await createCenter(provinceId);
  moduleId = await createModule({ centerId: null, code: stamp, cycleName: stamp, name: `ENSAYO ${stamp}` });
  await db.insert(trainingOfferTable).values({ centerId, cycleName: stamp });
  actor = await createUser({ role: "superadmin", centerId, provinceId });
  teacher = await createUser({ role: "teacher", centerId, provinceId });
  outsider = await createUser({ role: "teacher", centerId, provinceId });
  await db.insert(teachingAssignmentsTable).values([
    { teacherId: teacher.user.id, moduleId, centerId, schoolYear: await getActiveAcademicYear() ?? "" },
    { teacherId: outsider.user.id, moduleId, centerId, schoolYear: "ENSAYO-ANTERIOR" },
  ]);
  const [thread] = await db.insert(forumThreadsTable).values({ moduleId, title: "ENSAYO, no oficial", authorId: actor.user.id }).returning();
  threadId = thread.id;
  await db.insert(forumThreadContextsTable).values({ threadId, moduleId, kind: "programming_section",
    stableKey: "PD-01", templateVersion: 1, curriculumVersion: "ENSAYO" });
}, 30000);
beforeEach(async () => {
  vi.mocked(sendPushToUsers).mockReset().mockResolvedValue(undefined as never);
  await clearOwnedDigests();
  await db.update(usersTable).set({ status: "active" }).where(eq(usersTable.id, teacher.user.id));
  await db.update(teachingAssignmentsTable).set({ deletedAt: null }).where(and(
    eq(teachingAssignmentsTable.teacherId, teacher.user.id), eq(teachingAssignmentsTable.moduleId, moduleId)));
  await db.update(forumThreadsTable).set({ deletedAt: null }).where(eq(forumThreadsTable.id, threadId));
});
afterAll(async () => {
  if (moduleId) {
    await clearOwnedDigests();
    if (threadId) {
      await db.delete(forumThreadContextsTable).where(eq(forumThreadContextsTable.threadId, threadId));
      await db.delete(forumThreadsTable).where(eq(forumThreadsTable.id, threadId));
    }
  }
  restoreTestFixtures({ ...snapshotTestFixtures(), schoolYears: [] }); await cleanup();
}, 30000);

describe("Avisos agrupados intercentros", () => {
  it("queues idempotently and rolls the event back with its source transaction", async () => {
    await queue(); await queue();
    expect(await db.select().from(events).where(eq(events.moduleId, moduleId))).toHaveLength(1);
    await expect(db.transaction(async tx => {
      await enqueueForumDigest(tx, { moduleId, threadId, actorId: actor.user.id, eventKey: "rollback", kind: "synthesis" }, eventTime);
      throw new Error("ENSAYO de rollback");
    })).rejects.toThrow("rollback");
    expect(await db.select().from(events).where(eq(events.moduleId, moduleId))).toHaveLength(1);
  });
  it("waits for the window and groups concurrent dispatches without notifying self or an old-year teacher", async () => {
    await queue("one"); await queue("two");
    expect(await processNextForumDigest(eventTime)).toBe(false);
    await Promise.all([processNextForumDigest(due), processNextForumDigest(due)]);
    const rows = await notices();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(teacher.user.id);
    expect(rows[0].target).toEqual({ kind: "forum_module", id: moduleId });
    expect(vi.mocked(sendPushToUsers)).toHaveBeenCalledTimes(1);
    expect((vi.mocked(sendPushToUsers).mock.calls[0][1].data as any).path).toBe(`/foros/modulo/${moduleId}`);
  });
  it("does not resurrect read or deleted notices on retry or a late source commit", async () => {
    await queue(); await processNextForumDigest(due);
    const [notice] = await notices();
    await db.update(notificationsTable).set({ readAt: due }).where(eq(notificationsTable.id, notice.id));
    await queue("late"); await processNextForumDigest(due);
    expect(await notices()).toHaveLength(1);
    expect((await notices())[0].readAt).not.toBeNull();
    await db.delete(notificationsTable).where(eq(notificationsTable.id, notice.id));
    await queue("later"); await processNextForumDigest(due);
    expect(await notices()).toHaveLength(0);
    const [receipt] = await db.select().from(deliveries).where(and(
      eq(deliveries.moduleId, moduleId), eq(deliveries.userId, teacher.user.id)));
    expect(receipt.notificationId).toBeNull();
  });
  it("keeps a failed transaction pending with backoff, then safely retries", async () => {
    await queue();
    const fail = vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("ENSAYO temporal"));
    await processNextForumDigest(due);
    fail.mockRestore();
    const [pending] = await db.select().from(events).where(eq(events.moduleId, moduleId));
    expect(pending.processedAt).toBeNull();
    expect(pending.attempts).toBe(1);
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(due.getTime());
    expect(await notices()).toHaveLength(0);
    await processNextForumDigest(new Date(pending.nextAttemptAt.getTime() + 1));
    expect(await notices()).toHaveLength(1);
  });
  it("rechecks deactivation, assignment revocation and deleted source threads at dispatch", async () => {
    await queue();
    await db.update(usersTable).set({ status: "inactive" }).where(eq(usersTable.id, teacher.user.id));
    await processNextForumDigest(due);
    expect(await notices()).toHaveLength(0);
    await db.update(usersTable).set({ status: "active" }).where(eq(usersTable.id, teacher.user.id));
    await db.update(teachingAssignmentsTable).set({ deletedAt: due }).where(and(
      eq(teachingAssignmentsTable.teacherId, teacher.user.id), eq(teachingAssignmentsTable.moduleId, moduleId)));
    await queue("revoked"); await processNextForumDigest(due);
    expect(await notices()).toHaveLength(0);
    await db.update(teachingAssignmentsTable).set({ deletedAt: null }).where(eq(teachingAssignmentsTable.teacherId, teacher.user.id));
    await db.update(forumThreadsTable).set({ deletedAt: due }).where(eq(forumThreadsTable.id, threadId));
    await queue("deleted"); await processNextForumDigest(due);
    expect(await notices()).toHaveLength(0);
  });
  it("preserves the in-app notice when push fails without duplicating it on the next tick", async () => {
    await queue();
    vi.mocked(sendPushToUsers).mockRejectedValueOnce(new Error("ENSAYO push no disponible"));
    await processNextForumDigest(due);
    expect(await notices()).toHaveLength(1);
    expect(await processNextForumDigest(due)).toBe(false);
    expect(await notices()).toHaveLength(1);
  });
});
