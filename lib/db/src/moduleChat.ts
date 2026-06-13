import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./index";
import {
  chatGroupsTable,
  chatGroupMembersTable,
  modulesTable,
  teachingAssignmentsTable,
  usersTable,
} from "./schema";

export type ModuleChatSyncStatus = "created" | "updated" | "unchanged" | "skipped";

// A stable, human-readable name for a module's group chat.
function moduleGroupName(code: string | null, name: string): string {
  return code ? `${code} · ${name}` : name;
}

// Resolve the distinct set of active teachers currently assigned to a module
// through teaching_assignments (the academic link = "profesores adscritos").
async function assignedTeacherIds(moduleId: number): Promise<number[]> {
  const rows = await db
    .selectDistinct({ teacherId: teachingAssignmentsTable.teacherId })
    .from(teachingAssignmentsTable)
    .innerJoin(
      usersTable,
      eq(usersTable.id, teachingAssignmentsTable.teacherId),
    )
    .where(
      and(
        eq(teachingAssignmentsTable.moduleId, moduleId),
        isNull(teachingAssignmentsTable.deletedAt),
        eq(usersTable.status, "active"),
        isNull(usersTable.deletedAt),
      ),
    );
  return rows.map((r) => r.teacherId);
}

// Idempotently create (or update) the auto-managed group chat for a single
// module so its membership matches the teachers assigned to it. Safe to call
// repeatedly: it never duplicates groups (one per module, enforced by a unique
// index) and only mutates membership that drifted.
export async function syncModuleChatGroup(
  moduleId: number,
): Promise<ModuleChatSyncStatus> {
  const [module] = await db
    .select({
      id: modulesTable.id,
      code: modulesTable.code,
      name: modulesTable.name,
      centerId: modulesTable.centerId,
    })
    .from(modulesTable)
    .where(and(eq(modulesTable.id, moduleId), isNull(modulesTable.deletedAt)));
  if (!module) return "skipped";

  const teacherIds = await assignedTeacherIds(moduleId);
  const desired = new Set(teacherIds);
  const name = moduleGroupName(module.code, module.name);

  const [existing] = await db
    .select()
    .from(chatGroupsTable)
    .where(eq(chatGroupsTable.moduleId, moduleId));

  // Nothing to do for an unassigned module that has no group yet.
  if (!existing && desired.size === 0) return "skipped";

  if (!existing) {
    await db.transaction(async (tx) => {
      const [g] = await tx
        .insert(chatGroupsTable)
        .values({
          name,
          type: "group",
          moduleId,
          centerId: module.centerId ?? null,
          lastMessageAt: new Date(),
        })
        .returning();
      if (teacherIds.length > 0) {
        await tx
          .insert(chatGroupMembersTable)
          .values(teacherIds.map((uid) => ({ groupId: g!.id, userId: uid })))
          .onConflictDoNothing();
      }
    });
    return "created";
  }

  const current = await db
    .select({ userId: chatGroupMembersTable.userId })
    .from(chatGroupMembersTable)
    .where(eq(chatGroupMembersTable.groupId, existing.id));
  const currentIds = new Set(current.map((m) => m.userId));

  const toAdd = [...desired].filter((id) => !currentIds.has(id));
  const toRemove = [...currentIds].filter((id) => !desired.has(id));
  const nameChanged = existing.name !== name;

  if (toAdd.length === 0 && toRemove.length === 0 && !nameChanged) {
    return "unchanged";
  }

  await db.transaction(async (tx) => {
    if (nameChanged) {
      await tx
        .update(chatGroupsTable)
        .set({ name })
        .where(eq(chatGroupsTable.id, existing.id));
    }
    if (toAdd.length > 0) {
      await tx
        .insert(chatGroupMembersTable)
        .values(toAdd.map((uid) => ({ groupId: existing.id, userId: uid })))
        .onConflictDoNothing();
    }
    if (toRemove.length > 0) {
      await tx
        .delete(chatGroupMembersTable)
        .where(
          and(
            eq(chatGroupMembersTable.groupId, existing.id),
            inArray(chatGroupMembersTable.userId, toRemove),
          ),
        );
    }
  });
  return "updated";
}
