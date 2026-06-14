import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { db } from "./index";
import {
  centersTable,
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

// Centers where a module is actually taught. The module<->center link lives on
// the teaching assignments (modules.centerId is typically null), so scope is
// derived from where its teachers are assigned.
async function moduleCenterIds(moduleId: number): Promise<number[]> {
  const rows = await db
    .selectDistinct({ centerId: teachingAssignmentsTable.centerId })
    .from(teachingAssignmentsTable)
    .where(
      and(
        eq(teachingAssignmentsTable.moduleId, moduleId),
        isNull(teachingAssignmentsTable.deletedAt),
      ),
    );
  return rows
    .map((r) => r.centerId)
    .filter((c): c is number => c != null);
}

// Resolve the active managers whose scope covers a module so they also belong to
// its group chat (and can therefore see and moderate it):
//   - superadmin: every module
//   - coordinator: modules taught in their province
//   - department_head: modules taught in their center
// Scope is keyed off the module's teaching centers (see moduleCenterIds), and
// recomputed on every sync so role/scope changes are reflected without orphans.
async function scopedManagerIds(centerIds: number[]): Promise<number[]> {
  const scopeConds: SQL[] = [eq(usersTable.role, "superadmin")];

  if (centerIds.length > 0) {
    const centers = await db
      .select({ provinceId: centersTable.provinceId })
      .from(centersTable)
      .where(inArray(centersTable.id, centerIds));
    const provinceIds = Array.from(
      new Set(
        centers
          .map((c) => c.provinceId)
          .filter((p): p is number => p != null),
      ),
    );
    if (provinceIds.length > 0) {
      scopeConds.push(
        and(
          eq(usersTable.role, "coordinator"),
          inArray(usersTable.provinceId, provinceIds),
        )!,
      );
    }
    scopeConds.push(
      and(
        eq(usersTable.role, "department_head"),
        inArray(usersTable.centerId, centerIds),
      )!,
    );
  }

  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.status, "active"),
        isNull(usersTable.deletedAt),
        or(...scopeConds),
      ),
    );
  return rows.map((r) => r.id);
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
  const name = moduleGroupName(module.code, module.name);

  const [existing] = await db
    .select()
    .from(chatGroupsTable)
    .where(eq(chatGroupsTable.moduleId, moduleId));

  // Only teaching activity earns a module its group: an unassigned module with
  // no group yet stays without one (managers alone never create a group).
  if (!existing && teacherIds.length === 0) return "skipped";

  // Members = the assigned teachers plus the managers whose scope covers the
  // module, so coordinators/department heads/superadmins can see and moderate it.
  const managerIds = await scopedManagerIds(await moduleCenterIds(moduleId));
  const desired = new Set([...teacherIds, ...managerIds]);

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
      const memberIds = [...desired];
      if (memberIds.length > 0) {
        await tx
          .insert(chatGroupMembersTable)
          .values(memberIds.map((uid) => ({ groupId: g!.id, userId: uid })))
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
