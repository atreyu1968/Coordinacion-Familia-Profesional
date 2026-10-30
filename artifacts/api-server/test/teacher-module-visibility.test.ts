import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  teachingAssignmentsTable,
} from "@workspace/db";
import app from "../src/app";
import {
  authHeader,
  cleanup,
  createModule,
  createTeachingAssignment,
  createUser,
} from "./helpers";
import { getActiveAcademicYear } from "../src/lib/settings";

afterAll(cleanup);

describe("teacher module directory", () => {
  it("shows teachers only the active-family modules assigned to them", async () => {
    const teacher = await createUser();
    const centerId = teacher.user.centerId;
    if (centerId == null) throw new Error("Test teacher needs a center");

    const activeYear = await getActiveAcademicYear();
    const schoolYear = activeYear ?? "Prueba sin curso activo";
    const existingAssignments = await db
      .select({ moduleId: teachingAssignmentsTable.moduleId })
      .from(teachingAssignmentsTable)
      .where(and(
        eq(teachingAssignmentsTable.teacherId, teacher.user.id),
        eq(teachingAssignmentsTable.centerId, centerId),
        isNull(teachingAssignmentsTable.deletedAt),
        activeYear
          ? eq(teachingAssignmentsTable.schoolYear, activeYear)
          : undefined,
      ));

    const assignedModuleIds = new Set(existingAssignments.map((row) => row.moduleId));
    const additionalAssignedModuleId = await createModule({ centerId });
    await createTeachingAssignment({
      teacherId: teacher.user.id,
      centerId,
      moduleId: additionalAssignedModuleId,
      schoolYear,
    });
    assignedModuleIds.add(additionalAssignedModuleId);

    const unassignedModuleId = await createModule({ centerId });
    const [teacherModules, teacherProfile, adminModules] = await Promise.all([
      request(app).get("/api/modules").set(authHeader(teacher.token)),
      request(app)
        .get("/api/auth/me/teaching-profile")
        .query({ targetCenterId: centerId })
        .set(authHeader(teacher.token)),
      request(app).get("/api/modules").set(authHeader((await createUser({ role: "superadmin" })).token)),
    ]);

    expect(teacherModules.status).toBe(200);
    expect(teacherModules.body.map((module: { id: number }) => module.id).sort())
      .toEqual([...assignedModuleIds].sort());
    expect(teacherModules.body.some((module: { id: number }) => module.id === unassignedModuleId))
      .toBe(false);
    expect(teacherProfile.status).toBe(200);
    expect(teacherProfile.body.modules.some((module: { id: number }) => module.id === unassignedModuleId))
      .toBe(true);
    expect(teacherProfile.body.moduleIds.sort()).toEqual(
      activeYear ? [...assignedModuleIds].sort() : [],
    );
    expect(adminModules.status).toBe(200);
    expect(adminModules.body.some((module: { id: number }) => module.id === unassignedModuleId))
      .toBe(true);
  });
});
