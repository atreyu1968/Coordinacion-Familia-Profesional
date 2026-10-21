import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, centersTable, integrationSettingsTable, modulesTable, usersTable,
} from "@workspace/db";
import app from "../src/app";
import { getSettings, getActiveFamily } from "../src/lib/settings";
import {
  authHeader, cleanup, createCenter, createModule, createProvince, createTeachingAssignment, createUser,
} from "./helpers";

const year = `profile-access-${Date.now()}`;
let settingsId: number;
let previousYear: string | null;
beforeAll(async () => {
  const settings = await getSettings();
  settingsId = settings.id;
  previousYear = settings.activeAcademicYear;
  await db.update(integrationSettingsTable).set({ activeAcademicYear: year })
    .where(eq(integrationSettingsTable.id, settingsId));
});
afterAll(async () => {
  await db.update(integrationSettingsTable).set({ activeAcademicYear: previousYear })
    .where(eq(integrationSettingsTable.id, settingsId));
  await cleanup();
});
const groups = (token: string) => request(app).get("/api/chat/groups").set(authHeader(token));

describe("mandatory teacher profile API guard", () => {
  it("denies direct reads and writes but permits self-profile repair and public center discovery", async () => {
    const teacher = await createUser({ role: "teacher", incompleteProfile: true });
    expect((await groups(teacher.token)).body.code).toBe("TEACHING_PROFILE_REQUIRED");
    expect((await groups(teacher.token)).status).toBe(403);
    expect((await request(app).post("/api/chat/groups").set(authHeader(teacher.token)).send({})).status).toBe(403);
    expect((await request(app).get("/api/auth/me").set(authHeader(teacher.token))).status).toBe(200);
    expect((await request(app).patch("/api/auth/me").set(authHeader(teacher.token)).send({ name: "Teacher repaired" })).status).toBe(200);
    expect((await request(app).get("/api/auth/me/teaching-profile").set(authHeader(teacher.token))).status).toBe(200);
    expect((await request(app).get("/api/academic-years/my-confirmation").set(authHeader(teacher.token))).status).toBe(200);
    expect((await request(app).post("/api/academic-years/confirm").set(authHeader(teacher.token)).send({})).status).toBe(400);
    expect((await request(app).get("/api/centers").set(authHeader(teacher.token))).status).toBe(200);
    expect((await request(app).get("/api/storage/public-objects/missing-test-object").set(authHeader(teacher.token))).status).toBe(403);
  });
  it("unlocks access after saving a valid profile and rejects an empty active-year module list", async () => {
    const teacher = await createUser({ role: "teacher", incompleteProfile: true });
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const moduleId = await createModule({ centerId });
    const save = (moduleIds: number[]) => request(app).patch("/api/auth/me/teaching-profile")
      .set(authHeader(teacher.token)).send({ centerId, moduleIds });
    expect((await save([])).status).toBe(400);
    expect((await save([moduleId])).status).toBe(200);
    expect((await groups(teacher.token)).status).toBe(200);
    await db.update(modulesTable).set({ deletedAt: new Date() }).where(eq(modulesTable.id, moduleId));
    expect((await groups(teacher.token)).status).toBe(403);
  });
  it("checks current province, center family/deletion and active year instead of trusting stored IDs", async () => {
    const teacher = await createUser();
    expect((await groups(teacher.token)).status).toBe(200);
    const centerId = teacher.user.centerId!;
    await db.update(usersTable).set({ provinceId: null }).where(eq(usersTable.id, teacher.user.id));
    expect((await groups(teacher.token)).status).toBe(403);
    await db.update(usersTable).set({ provinceId: await createProvince() }).where(eq(usersTable.id, teacher.user.id));
    expect((await groups(teacher.token)).status).toBe(403);
    await db.update(usersTable).set({ provinceId: teacher.user.provinceId }).where(eq(usersTable.id, teacher.user.id));
    await db.update(centersTable).set({ families: [] }).where(eq(centersTable.id, centerId));
    expect((await groups(teacher.token)).status).toBe(403);
    await db.update(centersTable).set({ families: [await getActiveFamily()], deletedAt: new Date() }).where(eq(centersTable.id, centerId));
    expect((await groups(teacher.token)).status).toBe(403);
    await db.update(centersTable).set({ deletedAt: null }).where(eq(centersTable.id, centerId));
    expect((await groups(teacher.token)).status).toBe(200);
    const noModules = await createUser({
      role: "teacher", centerId, provinceId: teacher.user.provinceId, incompleteProfile: true,
    });
    await createTeachingAssignment({
      teacherId: noModules.user.id, centerId, moduleId: await createModule({ centerId }),
      schoolYear: `${year}-historical`,
    });
    expect((await groups(noModules.token)).status).toBe(403);
  });
  it("does not require modules without an active year, and never applies the teacher obligation to other roles", async () => {
    const teacher = await createUser({ incompleteProfile: true });
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    await db.update(usersTable).set({ centerId, provinceId }).where(eq(usersTable.id, teacher.user.id));
    expect((await groups(teacher.token)).status).toBe(403);
    await db.update(integrationSettingsTable).set({ activeAcademicYear: null }).where(eq(integrationSettingsTable.id, settingsId));
    try {
      expect((await groups(teacher.token)).status).toBe(200);
      const coordinator = await createUser({ role: "coordinator" });
      expect((await groups(coordinator.token)).status).toBe(200);
    } finally {
      await db.update(integrationSettingsTable).set({ activeAcademicYear: year }).where(eq(integrationSettingsTable.id, settingsId));
    }
  });
});
