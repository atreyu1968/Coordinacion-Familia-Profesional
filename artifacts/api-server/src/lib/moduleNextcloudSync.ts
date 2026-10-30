import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  centersTable,
  modulesTable,
  teachingAssignmentsTable,
  usersTable,
} from "@workspace/db";
import {
  moduleFolderName,
  provisionModuleSpace,
  resolveNextcloudConfig,
  type ProvisionMember,
} from "./nextcloud";
import { getActiveAcademicYear, getSettings } from "./settings";

export async function getModuleNextcloudMembers(
  module: { id: number; centerId: number | null },
  provinceId: number | null,
  options: { schoolYear?: string | null; includeUserId?: number } = {},
): Promise<ProvisionMember[]> {
  const schoolYear =
    options.schoolYear === undefined
      ? await getActiveAcademicYear()
      : options.schoolYear;
  const memberIds = new Set<number>();
  if (options.includeUserId != null) memberIds.add(options.includeUserId);

  const assignmentFilters = [
    eq(teachingAssignmentsTable.moduleId, module.id),
    isNull(teachingAssignmentsTable.deletedAt),
  ];
  if (schoolYear) {
    assignmentFilters.push(eq(teachingAssignmentsTable.schoolYear, schoolYear));
  }
  const assignments = await db
    .select({ teacherId: teachingAssignmentsTable.teacherId })
    .from(teachingAssignmentsTable)
    .where(and(...assignmentFilters));
  for (const assignment of assignments) memberIds.add(assignment.teacherId);

  if (provinceId != null) {
    const coordinators = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, "coordinator"),
          eq(usersTable.provinceId, provinceId),
          eq(usersTable.status, "active"),
          isNull(usersTable.deletedAt),
        ),
      );
    for (const coordinator of coordinators) memberIds.add(coordinator.id);
  }

  if (memberIds.size === 0) return [];
  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(
      and(
        inArray(usersTable.id, [...memberIds]),
        eq(usersTable.status, "active"),
        isNull(usersTable.deletedAt),
      ),
    );
  return rows.map((row) => ({
    userId: row.id,
    name: row.name,
    email: row.email,
  }));
}

/**
 * Reconcile one module's Nextcloud group against the current assignment year.
 * Throws when a remote membership change cannot be confirmed so callers can
 * report the failure instead of claiming access was revoked.
 */
export async function syncModuleNextcloudMembership(
  moduleId: number,
  options: { schoolYear?: string | null; includeUserId?: number } = {},
): Promise<void> {
  const settings = await getSettings();
  const config = resolveNextcloudConfig(settings);
  if (!config) return;

  const [module] = await db
    .select()
    .from(modulesTable)
    .where(and(eq(modulesTable.id, moduleId), isNull(modulesTable.deletedAt)));
  if (!module) return;

  let provinceId: number | null = null;
  if (module.centerId != null) {
    const [center] = await db
      .select({ provinceId: centersTable.provinceId })
      .from(centersTable)
      .where(eq(centersTable.id, module.centerId));
    provinceId = center?.provinceId ?? null;
  }

  const members = await getModuleNextcloudMembers(module, provinceId, options);
  await provisionModuleSpace(config, {
    moduleId,
    mount: moduleFolderName({
      moduleId: module.id,
      name: module.name,
      code: module.code,
    }),
    members,
  });
}
