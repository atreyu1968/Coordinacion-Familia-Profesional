import { db, usersTable, accountAuditTable, type User, type AccountAuditField, type AccountAuditChange } from "@workspace/db";
import { eq, type SQL } from "drizzle-orm";
import { canManageUser } from "../middlewares/auth";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Action = typeof accountAuditTable.$inferInsert.action;
const fields: AccountAuditField[] = ["name", "role", "centerId", "provinceId", "status"];

// null means the validated snapshot changed while the request was in flight.
// Lock before writing so concurrent requests cannot overwrite an unlogged change.
export async function changeAccount(
  caller: User,
  expected: User,
  action: Action,
  updates: { [K in keyof User]?: User[K] | SQL },
  afterUpdate?: (tx: Transaction, user: User) => Promise<void>,
): Promise<User | null> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(usersTable).where(eq(usersTable.id, expected.id)).for("update");
    if (!before || fields.some((field) => before[field] !== expected[field]) ||
        before.deletedAt?.getTime() !== expected.deletedAt?.getTime() ||
        before.updatedAt.getTime() !== expected.updatedAt.getTime() ||
        (caller.role !== "superadmin" && !canManageUser(caller, before))) return null;
    const [after] = await tx.update(usersTable).set(updates).where(eq(usersTable.id, before.id)).returning();
    const changes: AccountAuditChange[] = fields.flatMap((field) =>
      before[field] === after[field] ? [] : [{
        field,
        before: before[field] == null ? null : String(before[field]),
        after: after[field] == null ? null : String(after[field]),
      }],
    );
    // A legacy inactive record can still have its access flag restored.
    if (changes.length || before.deletedAt?.getTime() !== after.deletedAt?.getTime()) {
      await tx.insert(accountAuditTable).values({
        actorId: caller.id, actorName: caller.name, targetId: before.id, action, changes,
        beforeProvinceId: before.provinceId, afterProvinceId: after.provinceId,
        beforeCenterId: before.centerId, afterCenterId: after.centerId,
        beforeRole: before.role, afterRole: after.role,
      });
    }
    await afterUpdate?.(tx, after);
    return after;
  });
}
