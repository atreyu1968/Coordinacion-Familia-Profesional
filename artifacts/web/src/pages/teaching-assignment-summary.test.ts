import { describe, expect, it } from "vitest";
import { summarizeTeachingAssignments } from "./teaching-assignment-summary";

describe("summarizeTeachingAssignments", () => {
  it("deduplicates repeated rows and keeps teacher and module counts in sync", () => {
    const summary = summarizeTeachingAssignments([
      { teacherId: 10, teacherName: "Ana", moduleId: 21 },
      { teacherId: 10, teacherName: "Ana", moduleId: 21 },
      { teacherId: 10, teacherName: "Ana", moduleId: 22 },
      { teacherId: 11, teacherName: "Luis", moduleId: 21 },
    ]);

    expect(summary.moduleCountsByTeacher.get(10)).toBe(2);
    expect(summary.moduleCountsByTeacher.get(11)).toBe(1);
    expect(summary.teachersByModule.get(21)).toEqual([
      { teacherId: 10, name: "Ana" },
      { teacherId: 11, name: "Luis" },
    ]);
    expect(summary.teachersByModule.get(22)).toEqual([
      { teacherId: 10, name: "Ana" },
    ]);

    const totalTeacherModulePairs = [...summary.moduleCountsByTeacher.values()]
      .reduce((total, count) => total + count, 0);
    const totalModuleTeacherPairs = [...summary.teachersByModule.values()]
      .reduce((total, teachers) => total + teachers.length, 0);
    expect(totalTeacherModulePairs).toBe(totalModuleTeacherPairs);
  });
});
