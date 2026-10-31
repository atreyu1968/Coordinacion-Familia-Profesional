import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, forumDigestEventsTable as events, forumDigestDeliveriesTable as deliveries,
  notificationsTable, modulesTable, forumThreadsTable, forumThreadContextsTable } from "@workspace/db";
import { agreementParticipants } from "./forumAgreementSupport";
import { emitToUser } from "./realtime";
import { toNotification } from "./mappers";
import { sendPushToUsers, withPushPath } from "./push";
import { logger } from "./logger";

/** At most one persisted notification per recipient/module/window, across processes and retries. */
export async function processNextForumDigest(now = new Date()): Promise<boolean> {
  const [job] = await db.select().from(events).where(and(
    isNull(events.processedAt), lte(events.nextAttemptAt, now))).orderBy(asc(events.nextAttemptAt), asc(events.id)).limit(1);
  if (!job) return false;
  const group = and(eq(events.moduleId, job.moduleId), eq(events.bucketAt, job.bucketAt));
  try {
    const created = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(1952, ${job.moduleId})`);
      const pending = await tx.select().from(events).where(and(group, isNull(events.processedAt), lte(events.nextAttemptAt, now)));
      if (!pending.length) return [];
      // Re-evaluate recipients, family, current academic-year access and account
      // status at dispatch. No enrollment snapshot grants permanent permission.
      const participants = await agreementParticipants(job.moduleId);
      const validThreads = await tx.select({ id: forumThreadsTable.id }).from(forumThreadsTable)
        .innerJoin(forumThreadContextsTable, eq(forumThreadContextsTable.threadId, forumThreadsTable.id)).where(and(
        eq(forumThreadsTable.moduleId, job.moduleId), isNull(forumThreadsTable.deletedAt)));
      const liveIds = new Set(validThreads.map(t => t.id));
      const live = pending.filter(e => liveIds.has(e.threadId));
      const [module] = await tx.select({ name: modulesTable.name }).from(modulesTable)
        .where(and(eq(modulesTable.id, job.moduleId), isNull(modulesTable.deletedAt)));
      const rows: (typeof notificationsTable.$inferSelect)[] = [];
      if (module) for (const user of participants) {
        if (!live.some(e => e.actorId !== user.id)) continue;
        const [receipt] = await tx.select().from(deliveries).where(and(
          eq(deliveries.moduleId, job.moduleId), eq(deliveries.bucketAt, job.bucketAt), eq(deliveries.userId, user.id)));
        // A receipt also survives dismissal/deletion of the notification. Never
        // resurrect a read or deleted notice on retry or a late transaction.
        if (receipt) continue;
        const [notice] = await tx.insert(notificationsTable).values({
          userId: user.id, title: `Novedades intercentros · ${module.name}`,
          body: "Hay nuevos debates, aportaciones o cambios en las síntesis y acuerdos. Abre el módulo para revisarlos. Las propuestas no implican aprobación institucional.",
          type: "forum_digest", target: { kind: "forum_module", id: job.moduleId },
        }).returning();
        await tx.insert(deliveries).values({
          moduleId: job.moduleId, bucketAt: job.bucketAt, userId: user.id, notificationId: notice.id,
        });
        rows.push(notice);
      }
      await tx.update(events).set({ processedAt: now })
        .where(inArray(events.id, pending.map(e => e.id)));
      return rows;
    });
    // The transaction above is the durable delivery. Network channels are
    // best-effort, as with existing notifications, and cannot roll it back.
    if (created.length) {
      const first = created[0];
      const payload = withPushPath({ title: first.title, body: first.body ?? undefined,
        data: { type: "forum_digest", moduleId: job.moduleId, target: first.target } });
      for (const row of created) {
        try { emitToUser(row.userId, "notification", { ...toNotification(row), data: payload.data }); }
        catch { logger.warn("Forum digest socket delivery failed; in-app notice preserved"); }
      }
      try { await sendPushToUsers(created.map(r => r.userId), payload); }
      catch { logger.warn("Forum digest push delivery failed; in-app notices preserved"); }
    }
    return true;
  } catch {
    // Rollback leaves both events and delivery receipts untouched. Never infer
    // success from notifyUsers(), which intentionally swallows its DB errors.
    const delay = Math.min(6 * 60 * 60_000, 60_000 * 2 ** Math.min(job.attempts, 8));
    await db.update(events).set({ attempts: sql`${events.attempts} + 1`, nextAttemptAt: new Date(now.getTime() + delay) })
      .where(and(group, isNull(events.processedAt)));
    logger.warn({ moduleId: job.moduleId }, "Forum digest deferred after delivery transaction failure");
    return true;
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
export function startForumDigestWorker() {
  if (timer) return;
  let running = false;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      for (let i = 0; i < 5; i++) if (!await processNextForumDigest()) break;
    })().catch(() => logger.warn("Forum digest queue temporarily unavailable"))
      .finally(() => { running = false; });
  }, 30_000);
  timer.unref();
}
