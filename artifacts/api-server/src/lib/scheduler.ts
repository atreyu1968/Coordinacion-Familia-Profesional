import { and, eq, exists, isNull, lt } from "drizzle-orm";
import {
  db,
  usersTable,
  teacherYearConfirmationsTable,
  integrationSettingsTable,
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
  const deactivated = await db.transaction(async (tx) => {
    // Hold the settings row so an active-year change cannot turn this run into
    // a sweep of a now-historical year.
    const [settings] = await tx
      .select({ activeYear: integrationSettingsTable.activeAcademicYear })
      .from(integrationSettingsTable)
      .limit(1)
      .for("update");
    const activeYear = settings?.activeYear?.trim();
    if (!activeYear) return 0;

    const overdue = await tx
      .select({
        confirmationId: teacherYearConfirmationsTable.id,
        teacherId: teacherYearConfirmationsTable.teacherId,
      })
      .from(teacherYearConfirmationsTable)
      .where(
        and(
          eq(teacherYearConfirmationsTable.schoolYear, activeYear),
          eq(teacherYearConfirmationsTable.status, "pending"),
          lt(teacherYearConfirmationsTable.deadline, now),
        ),
      );

    let count = 0;
    for (const row of overdue) {
      // Acquire locks in user-then-confirmation order, matching reactivation's
      // user-then-confirmation updates. Recheck under the confirmation-row lock
      // so a concurrent successful confirmation wins instead of being undone.
      const [user] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.id, row.teacherId),
            eq(usersTable.role, "teacher"),
            eq(usersTable.status, "active"),
            isNull(usersTable.deletedAt),
          ),
        )
        .for("update");
      if (!user) continue;

      const [confirmation] = await tx
        .select({ id: teacherYearConfirmationsTable.id })
        .from(teacherYearConfirmationsTable)
        .where(
          and(
            eq(teacherYearConfirmationsTable.id, row.confirmationId),
            eq(teacherYearConfirmationsTable.teacherId, row.teacherId),
            eq(teacherYearConfirmationsTable.schoolYear, activeYear),
            eq(teacherYearConfirmationsTable.status, "pending"),
            lt(teacherYearConfirmationsTable.deadline, now),
          ),
        )
        .for("update");
      if (!confirmation) continue;

      // Keep the final predicate in the UPDATE as well: deactivation is
      // conditional on this exact active-year confirmation still being overdue.
      const result = await tx
        .update(usersTable)
        .set({ status: "inactive" })
        .where(
          and(
            eq(usersTable.id, row.teacherId),
            eq(usersTable.role, "teacher"),
            eq(usersTable.status, "active"),
            isNull(usersTable.deletedAt),
            exists(
              tx
                .select({ id: teacherYearConfirmationsTable.id })
                .from(teacherYearConfirmationsTable)
                .where(
                  and(
                    eq(
                      teacherYearConfirmationsTable.id,
                      confirmation.id,
                    ),
                    eq(
                      teacherYearConfirmationsTable.teacherId,
                      usersTable.id,
                    ),
                    eq(teacherYearConfirmationsTable.schoolYear, activeYear),
                    eq(teacherYearConfirmationsTable.status, "pending"),
                    lt(teacherYearConfirmationsTable.deadline, now),
                  ),
                ),
            ),
          ),
        )
        .returning({ id: usersTable.id });
      if (result.length > 0) count += 1;
    }
    return count;
  });

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
