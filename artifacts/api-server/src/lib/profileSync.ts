import { and, eq, isNull, or, inArray } from "drizzle-orm";
import { db, usersTable, type User } from "@workspace/db";
import { canManageUser } from "../middlewares/auth";
import { emitToUser } from "./realtime";
import { logger } from "./logger";

/** Invalidate authorized clients only after the complete profile save succeeds. */
export async function notifyTeachingProfileChanged(before: User, after: User) {
  try {
    const candidates = await db.select().from(usersTable).where(and(
      eq(usersTable.status, "active"), isNull(usersTable.deletedAt),
      or(eq(usersTable.id, after.id), inArray(usersTable.role, ["superadmin", "coordinator", "department_head"])),
    ));
    await Promise.all(candidates.filter((viewer) => viewer.id === after.id ||
      viewer.role === "superadmin" || canManageUser(viewer, before) || canManageUser(viewer, after))
      .map((viewer) => emitToUser(viewer.id, "teaching_profile:updated", {})));
  } catch (err) {
    // A notification outage must not turn a committed save into a reported failure.
    logger.warn({ err }, "Could not notify clients of a teaching profile update");
  }
}
