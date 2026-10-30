import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, centersTable, modulesTable, teachingAssignmentsTable, type User } from "@workspace/db";
import { getActiveAcademicYear, getActiveFamily } from "./settings";
import { teachingCenterId } from "./teachingProfileAccess";
import { moduleFamilyFilter } from "./familyCatalog";
import type { RequestHandler } from "express";

export function assignmentLimitedModules(role: string): boolean {
  return role === "teacher" || role === "department_head";
}

export function assignedTeachingModuleIds(user: User, family: string, year: string | null) {
  const centerId = teachingCenterId(user);
  return db.select({ moduleId: teachingAssignmentsTable.moduleId })
    .from(teachingAssignmentsTable)
    .innerJoin(centersTable, eq(centersTable.id, teachingAssignmentsTable.centerId))
    .innerJoin(modulesTable, eq(modulesTable.id, teachingAssignmentsTable.moduleId))
    .where(and(
      eq(teachingAssignmentsTable.teacherId, user.id),
      centerId == null ? sql`false` : eq(teachingAssignmentsTable.centerId, centerId),
      isNull(teachingAssignmentsTable.deletedAt),
      isNull(centersTable.deletedAt),
      sql`${centersTable.families} @> ${JSON.stringify([family])}::jsonb`,
      isNull(modulesTable.deletedAt),
      centerId == null ? sql`false` : or(isNull(modulesTable.centerId), eq(modulesTable.centerId, centerId)),
      moduleFamilyFilter(family),
      year ? eq(teachingAssignmentsTable.schoolYear, year) : undefined,
    ));
}

export async function hasTeachingModuleAccess(user: User, moduleId: number): Promise<boolean> {
  const family = await getActiveFamily();
  const year = await getActiveAcademicYear();
  const [module] = await db.select({ id: modulesTable.id }).from(modulesTable)
    .where(and(
      eq(modulesTable.id, moduleId),
      inArray(modulesTable.id, assignedTeachingModuleIds(user, family, year)),
    )).limit(1);
  return module != null;
}

// Path-scoped guard: do not attach authentication to sibling, unrelated routes.
export const requireHeadTeachingModule: RequestHandler = async (req, res, next) => {
  if (req.user?.role !== "department_head") return next();
  const moduleId = Number(req.params.moduleId);
  if (!Number.isSafeInteger(moduleId) || moduleId < 1) return next();
  try {
    if (!(await hasTeachingModuleAccess(req.user, moduleId))) {
      res.status(403).json({ message: "Este módulo no está entre tus asignaciones docentes" });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};
