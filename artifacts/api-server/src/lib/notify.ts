import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  usersTable,
  centersTable,
  notificationsTable,
} from "@workspace/db";
import { emitToUser } from "./realtime";
import { sendPushToUsers } from "./push";
import { toNotification } from "./mappers";
import { logger } from "./logger";

type Role =
  | "superadmin"
  | "coordinator"
  | "prospector"
  | "department_head"
  | "teacher";

/**
 * Resolve the set of active user ids in a province audience.
 * - provinceId null => every active user (global announcements)
 * - provinceId set  => users whose own provinceId matches, or whose center
 *   belongs to that province.
 */
export async function resolveProvinceAudience(
  provinceId: number | null,
  excludeUserId?: number,
): Promise<number[]> {
  const rows = await db
    .select({
      id: usersTable.id,
      userProvinceId: usersTable.provinceId,
      centerProvinceId: centersTable.provinceId,
    })
    .from(usersTable)
    .leftJoin(centersTable, eq(centersTable.id, usersTable.centerId))
    .where(and(eq(usersTable.status, "active"), isNull(usersTable.deletedAt)));

  let ids = rows
    .filter(
      (r) =>
        provinceId == null ||
        r.userProvinceId === provinceId ||
        r.centerProvinceId === provinceId,
    )
    .map((r) => r.id);

  if (excludeUserId != null) ids = ids.filter((id) => id !== excludeUserId);
  return ids;
}

/**
 * Resolve active users with a given role within a province audience.
 */
export async function resolveRoleAudienceInProvince(
  role: Role,
  provinceId: number | null,
  excludeUserId?: number,
): Promise<number[]> {
  const rows = await db
    .select({
      id: usersTable.id,
      userProvinceId: usersTable.provinceId,
      centerProvinceId: centersTable.provinceId,
    })
    .from(usersTable)
    .leftJoin(centersTable, eq(centersTable.id, usersTable.centerId))
    .where(
      and(
        eq(usersTable.role, role),
        eq(usersTable.status, "active"),
        isNull(usersTable.deletedAt),
      ),
    );

  let ids = rows
    .filter(
      (r) =>
        provinceId == null ||
        r.userProvinceId === provinceId ||
        r.centerProvinceId === provinceId,
    )
    .map((r) => r.id);

  if (excludeUserId != null) ids = ids.filter((id) => id !== excludeUserId);
  return ids;
}

/**
 * Persist an in-app notification for each user, push it in real time over the
 * socket, and attempt a best-effort device push. Persistence is the source of
 * truth; socket + push are best-effort and never throw to the caller.
 */
export async function notifyUsers(
  userIds: number[],
  notification: { title: string; body?: string | null; type?: string | null },
): Promise<number> {
  if (userIds.length === 0) return 0;
  try {
    const rows = await db
      .insert(notificationsTable)
      .values(
        userIds.map((uid) => ({
          userId: uid,
          title: notification.title,
          body: notification.body ?? null,
          type: notification.type ?? null,
        })),
      )
      .returning();

    for (const row of rows) {
      emitToUser(row.userId, "notification", toNotification(row));
    }

    void sendPushToUsers(userIds, {
      title: notification.title,
      body: notification.body ?? null,
      data: { type: notification.type ?? "general" },
    });

    return rows.length;
  } catch (err) {
    logger.error({ err }, "notifyUsers failed");
    return 0;
  }
}
