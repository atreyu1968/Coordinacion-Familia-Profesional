export interface AssignmentSummaryRow {
  teacherId: number;
  teacherName?: string | null;
  moduleId: number;
}

export interface AssignedTeacher {
  teacherId: number;
  name: string;
}

export function summarizeTeachingAssignments(
  assignments: readonly AssignmentSummaryRow[],
) {
  const modulesByTeacher = new Map<number, Set<number>>();
  const teachersByModule = new Map<number, Map<number, string>>();

  for (const assignment of assignments) {
    const teacherModules = modulesByTeacher.get(assignment.teacherId) ?? new Set();
    teacherModules.add(assignment.moduleId);
    modulesByTeacher.set(assignment.teacherId, teacherModules);

    const moduleTeachers = teachersByModule.get(assignment.moduleId) ?? new Map();
    if (!moduleTeachers.has(assignment.teacherId)) {
      moduleTeachers.set(
        assignment.teacherId,
        assignment.teacherName?.trim() || `#${assignment.teacherId}`,
      );
    }
    teachersByModule.set(assignment.moduleId, moduleTeachers);
  }

  return {
    moduleCountsByTeacher: new Map(
      [...modulesByTeacher].map(([teacherId, modules]) => [
        teacherId,
        modules.size,
      ]),
    ),
    teachersByModule: new Map(
      [...teachersByModule].map(([moduleId, teachers]) => [
        moduleId,
        [...teachers].map(([teacherId, name]) => ({ teacherId, name })),
      ]),
    ),
  };
}
