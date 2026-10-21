import { and, eq, exists, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import {
  db, centersTable, modulesTable, teachingAssignmentsTable, usersTable, type User,
} from "@workspace/db";
import { getSettings, professionalFamilyOf } from "./settings";
import { moduleFamilyFilter } from "./familyCatalog";

export const TEACHING_PROFILE_REQUIRED = "TEACHING_PROFILE_REQUIRED";
export const TEACHING_PROFILE_REQUIRED_MESSAGE =
  "Completa los datos obligatorios de tu perfil docente antes de continuar.";

// Also used for realtime delivery, so a socket opened before a year/center
// change cannot continue receiving application data with an incomplete profile.
export async function getTeachingProfileEligibleUserIds(
  userIds: number[],
): Promise<Set<number>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Set();
  const settings = await getSettings();
  const family = professionalFamilyOf(settings);
  const activeYear = settings.activeAcademicYear?.trim() || null;
  const assignment = db
    .select({ id: teachingAssignmentsTable.id })
    .from(teachingAssignmentsTable)
    .innerJoin(modulesTable, eq(modulesTable.id, teachingAssignmentsTable.moduleId))
    .where(and(
      eq(teachingAssignmentsTable.teacherId, usersTable.id),
      eq(teachingAssignmentsTable.centerId, usersTable.centerId),
      eq(teachingAssignmentsTable.schoolYear, activeYear ?? ""),
      isNull(teachingAssignmentsTable.deletedAt),
      isNull(modulesTable.deletedAt),
      or(isNull(modulesTable.centerId), eq(modulesTable.centerId, usersTable.centerId)),
      moduleFamilyFilter(family),
    ));
  const rows = await db.select({ id: usersTable.id }).from(usersTable)
    .leftJoin(centersTable, eq(centersTable.id, usersTable.centerId))
    .where(and(
      inArray(usersTable.id, ids),
      eq(usersTable.status, "active"),
      isNull(usersTable.deletedAt),
      or(
        ne(usersTable.role, "teacher"),
        and(
          isNotNull(usersTable.centerId),
          isNotNull(usersTable.provinceId),
          isNotNull(centersTable.id),
          isNull(centersTable.deletedAt),
          eq(centersTable.provinceId, usersTable.provinceId),
          sql`${centersTable.families} @> ${JSON.stringify([family])}::jsonb`,
          activeYear ? exists(assignment) : undefined,
        ),
      ),
    ));
  return new Set(rows.map((row) => row.id));
}

export async function hasCompleteTeachingProfile(
  user: Pick<User, "id" | "role">,
): Promise<boolean> {
  return user.role !== "teacher" ||
    (await getTeachingProfileEligibleUserIds([user.id])).has(user.id);
}
