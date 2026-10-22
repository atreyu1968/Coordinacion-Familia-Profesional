import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, centersTable, integrationSettingsTable, modulesTable, usersTable,
  teacherYearConfirmationsTable, teachingAssignmentsTable,
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

describe("managed teacher profile integrity", () => {
  const management = (token: string, query: Record<string, string | number> = {}) =>
    request(app).get("/api/users/management").query(query).set(authHeader(token));

  it("matches the access guard for invalid centers, province mismatches and historical modules", async () => {
    const admin = await createUser({ role: "superadmin" });
    const teacher = await createUser();
    const query = { search: teacher.email };
    const check = async (missing: string[]) => {
      const result = await management(admin.token, query);
      expect(result.status).toBe(200);
      expect(result.body.users[0].teachingProfile).toEqual({ complete: !missing.length, missing });
      expect(result.body.incompleteTeacherProfiles).toBe(missing.length ? 1 : 0);
      expect((await groups(teacher.token)).status).toBe(missing.length ? 403 : 200);
    };
    await check([]);
    await db.update(usersTable).set({ provinceId: null }).where(eq(usersTable.id, teacher.user.id));
    await check(["province"]);
    await db.update(usersTable).set({ provinceId: await createProvince() }).where(eq(usersTable.id, teacher.user.id));
    await check(["province"]);
    await db.update(usersTable).set({ provinceId: teacher.user.provinceId }).where(eq(usersTable.id, teacher.user.id));
    await db.update(centersTable).set({ families: [] }).where(eq(centersTable.id, teacher.user.centerId!));
    await check(["center", "province", "modules"]);
    await db.update(centersTable).set({ families: [await getActiveFamily()], deletedAt: new Date() })
      .where(eq(centersTable.id, teacher.user.centerId!));
    await check(["center", "province", "modules"]);
    await db.update(centersTable).set({ deletedAt: null }).where(eq(centersTable.id, teacher.user.centerId!));
    await db.update(teachingAssignmentsTable).set({ schoolYear: `${year}-old` })
      .where(eq(teachingAssignmentsTable.teacherId, teacher.user.id));
    await check(["modules"]);
    await db.update(usersTable).set({ centerId: null }).where(eq(usersTable.id, teacher.user.id));
    await check(["center", "province", "modules"]);
  });

  it("does not count foreign-center, deleted or unavailable modules as current assignments", async () => {
    const admin = await createUser({ role: "superadmin" });
    const province = await createProvince();
    const center = await createCenter(province);
    const otherCenter = await createCenter(province);
    const teacher = await createUser({ incompleteProfile: true, centerId: center, provinceId: province });
    const foreignModule = await createModule({ centerId: otherCenter });
    await createTeachingAssignment({
      teacherId: teacher.user.id, centerId: otherCenter, moduleId: foreignModule, schoolYear: year,
    });
    const check = async (complete: boolean) => {
      const result = await management(admin.token, { search: teacher.email });
      expect(result.status).toBe(200);
      expect(result.body.users[0].teachingProfile).toEqual({ complete, missing: complete ? [] : ["modules"] });
    };
    await check(false);
    // Even a malformed assignment pointing at the saved center cannot make a
    // module belonging to another center count toward integrity.
    await createTeachingAssignment({
      teacherId: teacher.user.id, centerId: center, moduleId: foreignModule, schoolYear: year,
    });
    await check(false);
    const moduleId = await createModule({ centerId: center });
    await createTeachingAssignment({ teacherId: teacher.user.id, centerId: center, moduleId, schoolYear: year });
    await check(true);
    await db.update(modulesTable).set({ deletedAt: new Date() }).where(eq(modulesTable.id, moduleId));
    await check(false);
    await db.update(modulesTable).set({ deletedAt: null }).where(eq(modulesTable.id, moduleId));
    await db.update(teachingAssignmentsTable).set({ deletedAt: new Date() })
      .where(eq(teachingAssignmentsTable.moduleId, moduleId));
    await check(false);
  });

  it("filters before pagination, summarizes only the scoped set and keeps lifecycle independent", async () => {
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const otherCenter = await createCenter(provinceId);
    const coordinator = await createUser({ role: "coordinator", provinceId });
    const head = await createUser({ role: "department_head", centerId, provinceId });
    const complete = await createUser({ centerId });
    const incomplete = await createUser({ centerId, provinceId, incompleteProfile: true });
    const inactive = await createUser({ centerId, provinceId, incompleteProfile: true, status: "inactive" });
    const other = await createUser({ centerId: otherCenter, provinceId, incompleteProfile: true });
    const outsider = await createUser({ incompleteProfile: true, provinceId: await createProvince() });
    await db.insert(teacherYearConfirmationsTable).values([
      { teacherId: complete.user.id, schoolYear: year, status: "pending", deadline: new Date() },
      { teacherId: incomplete.user.id, schoolYear: year, status: "confirmed", deadline: new Date(), confirmedAt: new Date() },
    ]);
    const result = await management(head.token, { teachingProfile: "incomplete", pageSize: 1, page: 999 });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ total: 2, page: 2, incompleteTeacherProfiles: 2, activeYear: year });
    expect(result.body.users).toHaveLength(1);
    expect([incomplete.user.id, inactive.user.id]).toContain(result.body.users[0].id);
    const all = await management(head.token);
    expect(all.body.users.find((u: { id: number }) => u.id === head.user.id).teachingProfile).toBeNull();
    expect(all.body.users.find((u: { id: number }) => u.id === complete.user.id).teachingProfile.complete).toBe(true);
    expect(all.body.users.map((u: { id: number }) => u.id)).not.toContain(other.user.id);
    const provinceResult = await management(coordinator.token, { teachingProfile: "incomplete" });
    expect(provinceResult.body.total).toBe(3);
    expect(provinceResult.body.incompleteTeacherProfiles).toBe(3);
    expect(provinceResult.body.users.map((u: { id: number }) => u.id)).not.toContain(outsider.user.id);
    expect((await management(head.token, { centerId: otherCenter, teachingProfile: "incomplete" })).body.total).toBe(0);
    const active = await management(head.token, { teachingProfile: "incomplete", status: "active" });
    expect(active.body).toMatchObject({ total: 1, incompleteTeacherProfiles: 1 });
    const valid = await management(head.token, { teachingProfile: "complete" });
    expect(valid.body).toMatchObject({ total: 1, incompleteTeacherProfiles: 2 });
    expect(valid.body.users[0].id).toBe(complete.user.id);
    expect((await management(head.token, { role: "coordinator", teachingProfile: "incomplete" })).body.total).toBe(0);
    const serialized = JSON.stringify(provinceResult.body);
    for (const privateField of ["moduleIds", "assignments", "passwordHash", "sessionNonce"]) {
      expect(serialized).not.toContain(`"${privateField}"`);
    }
    const [stored] = await db.select().from(usersTable).where(eq(usersTable.id, incomplete.user.id));
    expect(stored.status).toBe("active");
    const [confirmation] = await db.select().from(teacherYearConfirmationsTable)
      .where(eq(teacherYearConfirmationsTable.teacherId, incomplete.user.id));
    expect(confirmation.status).toBe("confirmed");
    expect((await management(complete.token)).status).toBe(403);
    expect((await management(head.token, { teachingProfile: "unknown" })).status).toBe(400);
  });

  it("requires no modules without an active year, but still requires center and province", async () => {
    const admin = await createUser({ role: "superadmin" });
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const teacher = await createUser({ incompleteProfile: true, centerId, provinceId });
    await db.update(integrationSettingsTable).set({ activeAcademicYear: null }).where(eq(integrationSettingsTable.id, settingsId));
    try {
      const result = await management(admin.token, { search: teacher.email, teachingProfile: "complete" });
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ activeYear: null, total: 1, incompleteTeacherProfiles: 0 });
      expect(result.body.users[0].teachingProfile).toEqual({ complete: true, missing: [] });
      await db.update(usersTable).set({ provinceId: null }).where(eq(usersTable.id, teacher.user.id));
      const missing = await management(admin.token, { search: teacher.email });
      expect(missing.body.users[0].teachingProfile.missing).toEqual(["province"]);
    } finally {
      await db.update(integrationSettingsTable).set({ activeAcademicYear: year }).where(eq(integrationSettingsTable.id, settingsId));
    }
  });
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
      .set(authHeader(teacher.token)).send({ centerId, moduleIds, doesNotTeach: false });
    expect((await save([])).status).toBe(400);
    expect((await save([moduleId])).status).toBe(200);
    expect((await groups(teacher.token)).status).toBe(200);
    await db.update(modulesTable).set({ deletedAt: new Date() }).where(eq(modulesTable.id, moduleId));
    expect((await groups(teacher.token)).status).toBe(403);
  });
  it("unlocks access when a teacher explicitly declares no teaching for the active year", async () => {
    const admin = await createUser({ role: "superadmin" });
    const teacher = await createUser({
      role: "teacher",
      incompleteProfile: true,
    });
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);

    const saved = await request(app)
      .patch("/api/auth/me/teaching-profile")
      .set(authHeader(teacher.token))
      .send({ centerId, moduleIds: [], doesNotTeach: true });
    expect(saved.status).toBe(200);
    expect(saved.body.doesNotTeach).toBe(true);
    expect(saved.body.moduleIds).toEqual([]);
    expect((await groups(teacher.token)).status).toBe(200);

    const managed = await request(app)
      .get("/api/users/management")
      .query({ search: teacher.email, teachingProfile: "complete" })
      .set(authHeader(admin.token));
    expect(managed.status).toBe(200);
    expect(managed.body.users).toHaveLength(1);
    expect(managed.body.users[0].teachingProfile).toEqual({
      complete: true,
      missing: [],
    });
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
