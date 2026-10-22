import { and, eq, exists, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  db, centersTable, modulesTable, teachingAssignmentsTable,
  teacherYearConfirmationsTable, usersTable, type User,
} from "@workspace/db";
import { getSettings, professionalFamilyOf } from "./settings";
import { moduleFamilyFilter } from "./familyCatalog";

export const TEACHING_PROFILE_REQUIRED = "TEACHING_PROFILE_REQUIRED";
export const TEACHING_PROFILE_REQUIRED_MESSAGE =
  "Completa los datos obligatorios de tu perfil docente antes de continuar.";

// Integrity is independent of account status and annual confirmation. Keep the
// access guard and management diagnostics on these exact same predicates.
export function teachingProfilePredicates(family: string, activeYear: string | null) {
  const validCenter = and(
    eq(centersTable.id, usersTable.centerId),
    isNull(centersTable.deletedAt),
    sql`${centersTable.families} @> ${JSON.stringify([family])}::jsonb`,
  );
  const center = exists(db.select({ id: centersTable.id }).from(centersTable)
    .where(validCenter));
  const province = exists(db.select({ id: centersTable.id }).from(centersTable)
    .where(and(validCenter, eq(centersTable.provinceId, usersTable.provinceId))));
  const assignments = activeYear ? exists(db
    .select({ id: teachingAssignmentsTable.id })
    .from(teachingAssignmentsTable)
    .innerJoin(modulesTable, eq(modulesTable.id, teachingAssignmentsTable.moduleId))
    .where(and(
      eq(teachingAssignmentsTable.teacherId, usersTable.id),
      eq(teachingAssignmentsTable.centerId, usersTable.centerId),
      eq(teachingAssignmentsTable.schoolYear, activeYear),
      isNull(teachingAssignmentsTable.deletedAt),
      isNull(modulesTable.deletedAt),
      or(isNull(modulesTable.centerId), eq(modulesTable.centerId, usersTable.centerId)),
      moduleFamilyFilter(family),
    ))) : sql<boolean>`true`;
  const noTeachingDeclaration = activeYear
    ? exists(db
        .select({ id: teacherYearConfirmationsTable.id })
        .from(teacherYearConfirmationsTable)
        .where(and(
          eq(teacherYearConfirmationsTable.teacherId, usersTable.id),
          eq(teacherYearConfirmationsTable.schoolYear, activeYear),
          eq(teacherYearConfirmationsTable.centerId, usersTable.centerId),
          eq(teacherYearConfirmationsTable.doesNotTeach, true),
          eq(teacherYearConfirmationsTable.status, "confirmed"),
        )))
    : sql<boolean>`true`;
  const modules = or(assignments, noTeachingDeclaration)!;
  return { center, province, modules, complete: and(center, province, modules)! };
}

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
  const profile = teachingProfilePredicates(family, activeYear);
  const rows = await db.select({ id: usersTable.id }).from(usersTable)
    .where(and(
      inArray(usersTable.id, ids),
      eq(usersTable.status, "active"),
      isNull(usersTable.deletedAt),
      or(
        ne(usersTable.role, "teacher"),
        profile.complete,
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
