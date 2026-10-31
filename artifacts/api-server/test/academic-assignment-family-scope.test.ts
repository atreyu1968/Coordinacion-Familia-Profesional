import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, centersTable } from "@workspace/db";
import app from "../src/app";
import {
  authHeader,
  cleanup,
  createCenter,
  createModule,
  createProvince,
  createTeachingAssignment,
  createUser,
} from "./helpers";
import { getActiveAcademicYear, getActiveFamily } from "../src/lib/settings";
import { fpCycleFamilies } from "../src/lib/generated/fpCycleFamilies";

afterAll(cleanup);

describe("academic assignments in the active family", () => {
  it("lists only assignments for active-family centers and modules", async () => {
    const provinceId = await createProvince();
    const familyCenterId = await createCenter(provinceId);
    const otherFamilyCenterId = await createCenter(provinceId);
    const activeFamily = await getActiveFamily();
    await db
      .update(centersTable)
      .set({ families: [`${activeFamily} (otra)`] })
      .where(eq(centersTable.id, otherFamilyCenterId));

    const activeCycle = Object.entries(fpCycleFamilies)
      .find(([, families]) => families.includes(activeFamily))?.[0];
    expect(activeCycle).toBeTruthy();

    const activeModuleId = await createModule({ cycleName: activeCycle });
    const otherFamilyModuleId = await createModule({
      centerId: otherFamilyCenterId,
    });
    const teacher = await createUser({ centerId: familyCenterId });
    const schoolYear = await getActiveAcademicYear() ?? "2026/2027";

    const visibleId = await createTeachingAssignment({
      teacherId: teacher.user.id,
      centerId: familyCenterId,
      moduleId: activeModuleId,
      schoolYear,
    });
    const otherCenterAssignmentId = await createTeachingAssignment({
      teacherId: teacher.user.id,
      centerId: otherFamilyCenterId,
      moduleId: activeModuleId,
      schoolYear,
    });
    const foreignModuleAssignmentId = await createTeachingAssignment({
      teacherId: teacher.user.id,
      centerId: otherFamilyCenterId,
      moduleId: otherFamilyModuleId,
      schoolYear,
    });
    const wrongFamilyModuleAssignmentId = await createTeachingAssignment({
      teacherId: teacher.user.id,
      centerId: familyCenterId,
      moduleId: otherFamilyModuleId,
      schoolYear,
    });

    const admin = await createUser({ role: "superadmin" });
    const response = await request(app)
      .get("/api/teaching-assignments")
      .query({ schoolYear, teacherId: teacher.user.id })
      .set(authHeader(admin.token));

    expect(response.status).toBe(200);
    const returnedIds = new Set(
      response.body.map((assignment: { id: number }) => assignment.id),
    );
    expect(returnedIds.has(visibleId)).toBe(true);
    expect(returnedIds.has(otherCenterAssignmentId)).toBe(false);
    expect(returnedIds.has(foreignModuleAssignmentId)).toBe(false);
    expect(returnedIds.has(wrongFamilyModuleAssignmentId)).toBe(false);
  });

  it("rejects creating an assignment at a center outside the active family", async () => {
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const activeFamily = await getActiveFamily();
    await db
      .update(centersTable)
      .set({ families: [`${activeFamily} (otra)`] })
      .where(eq(centersTable.id, centerId));

    const cycleName = Object.entries(fpCycleFamilies)
      .find(([, families]) => families.includes(activeFamily))?.[0];
    expect(cycleName).toBeTruthy();
    const moduleId = await createModule({ cycleName });
    const teacher = await createUser({ centerId });
    const admin = await createUser({ role: "superadmin" });

    const response = await request(app)
      .post("/api/teaching-assignments")
      .set(authHeader(admin.token))
      .send({
        teacherId: teacher.user.id,
        centerId,
        moduleId,
        schoolYear: await getActiveAcademicYear() ?? "2026/2027",
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain(
      "El centro no pertenece a la familia profesional activa",
    );
  });
});
