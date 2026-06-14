import { and, eq, isNull, lt } from "drizzle-orm";
import {
  db,
  usersTable,
  teacherYearConfirmationsTable,
} from "@workspace/db";
import { logger } from "./logger";

/**
 * Deactivates teachers who never confirmed the academic year before their
 * deadline. Only role=teacher accounts are affected. Deactivation sets the
 * account status to "inactive" but keeps deletedAt null, so the account still
 * shows up at login (with a clear "ask the administrator to reactivate" message)
 * and managers can reactivate it. Idempotent: already-inactive teachers and
 * confirmed/over-deadline rows are skipped.
 */
export async function deactivateOverdueTeachers(): Promise<number> {
  const now = new Date();
  const overdue = await db
    .select({ teacherId: teacherYearConfirmationsTable.teacherId })
    .from(teacherYearConfirmationsTable)
    .innerJoin(
      usersTable,
      eq(usersTable.id, teacherYearConfirmationsTable.teacherId),
    )
    .where(
      and(
        eq(teacherYearConfirmationsTable.status, "pending"),
        lt(teacherYearConfirmationsTable.deadline, now),
        eq(usersTable.role, "teacher"),
        eq(usersTable.status, "active"),
        isNull(usersTable.deletedAt),
      ),
    );

  let deactivated = 0;
  for (const row of overdue) {
    const result = await db
      .update(usersTable)
      .set({ status: "inactive" })
      .where(
        and(
          eq(usersTable.id, row.teacherId),
          eq(usersTable.role, "teacher"),
          eq(usersTable.status, "active"),
          isNull(usersTable.deletedAt),
        ),
      )
      .returning({ id: usersTable.id });
    if (result.length > 0) deactivated += 1;
  }

  if (deactivated > 0) {
    logger.info(
      { deactivated },
      "Deactivated teachers with overdue year confirmation",
    );
  }
  return deactivated;
}

let timer: NodeJS.Timeout | null = null;

/**
 * Starts a daily job that auto-deactivates teachers with an overdue confirmation.
 * Runs once shortly after boot and then every 24h. No external scheduler exists
 * in the api-server, so this in-process interval is the mechanism.
 */
export function startConfirmationScheduler(): void {
  if (timer) return;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const run = (): void => {
    void deactivateOverdueTeachers().catch((err) => {
      logger.error({ err }, "deactivateOverdueTeachers failed");
    });
  };
  // Defer the first run a minute after boot so startup isn't blocked.
  setTimeout(run, 60 * 1000);
  timer = setInterval(run, DAY_MS);
}
