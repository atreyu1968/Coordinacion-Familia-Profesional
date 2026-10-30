import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable, centersTable } from "@workspace/db";
import app from "../src/app";
import {
  authHeader,
  cleanup,
  createCenter,
  createIsland,
  createModule,
  createProvince,
  createTeachingAssignment,
  createUser,
} from "./helpers";
import { getActiveAcademicYear, getActiveFamily } from "../src/lib/settings";
import { fpCycleFamilies } from "../src/lib/generated/fpCycleFamilies";

afterAll(cleanup);

describe("scoped user administration", () => {
  it("keeps manually deactivated accounts recoverable without exposing them in the directory", async () => {
    const admin = await createUser({ role: "superadmin" });
    const teacher = await createUser();
    const headers = authHeader(admin.token);
    expect((await request(app).delete(`/api/users/${teacher.user.id}`).set(headers)).status).toBe(204);
    const inactive = await request(app).get("/api/users/management")
      .query({ search: teacher.email, status: "inactive" }).set(headers);
    expect(inactive.status).toBe(200);
    expect(inactive.body).toMatchObject({ total: 1, page: 1, pageSize: 25 });
    expect(inactive.body.users[0]).toMatchObject({ id: teacher.user.id, status: "inactive", canManage: true });
    expect(inactive.body.users[0]).not.toHaveProperty("passwordHash");
    expect(inactive.body.users[0]).not.toHaveProperty("sessionNonce");
    const directory = await request(app).get("/api/users").query({ search: teacher.email }).set(headers);
    expect(directory.body).toEqual([]);
    const edited = await request(app).patch(`/api/users/${teacher.user.id}`).set(headers)
      .send({ name: "  Cuenta recuperable  " });
    expect(edited.status).toBe(200);
    expect(edited.body.name).toBe("Cuenta recuperable");
    expect(edited.body.status).toBe("inactive");
    const reactivated = await request(app).post(`/api/users/${teacher.user.id}/reactivate`).set(headers);
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.status).toBe("active");
    const freshLogin = await request(app).post("/api/auth/login")
      .send({ email: teacher.email, password: teacher.password });
    expect(freshLogin.status).toBe(200);
    expect(freshLogin.body.token).toBeTruthy();
    expect((await request(app).get("/api/auth/me").set(authHeader(freshLogin.body.token))).status).toBe(200);
    const [stored] = await db.select().from(usersTable).where(eq(usersTable.id, teacher.user.id));
    expect(stored.deletedAt).toBeNull();
    // Reactivation must not resurrect bearer tokens from before deactivation.
    expect((await request(app).get("/api/auth/me").set(authHeader(teacher.token))).status).toBe(401);
    expect((await request(app).get("/api/users/management").query({ search: teacher.email, status: "active" }).set(headers)).body.total).toBe(1);
  });

  it("applies role hierarchy and province/center scope to both capabilities and writes", async () => {
    const province = await createProvince();
    const otherProvince = await createProvince();
    const center = await createCenter(province);
    const otherCenter = await createCenter(province);
    const foreignCenter = await createCenter(otherProvince);
    const otherFamilyCenter = await createCenter(otherProvince);
    const activeFamily = await getActiveFamily();
    await db.update(centersTable).set({ families: [`${activeFamily} (otra)`] })
      .where(eq(centersTable.id, otherFamilyCenter));
    const coordinator = await createUser({ role: "coordinator", provinceId: province });
    const peer = await createUser({ role: "coordinator", provinceId: province });
    const head = await createUser({ role: "department_head", provinceId: province, centerId: center });
    const teacher = await createUser({ centerId: center });
    const otherTeacher = await createUser({ centerId: otherCenter });
    const inactiveOtherTeacher = await createUser({ centerId: otherCenter, status: "inactive" });
    const outsider = await createUser({ centerId: foreignCenter });
    const otherFamilyTeacher = await createUser({ centerId: otherFamilyCenter });
    await db.update(usersTable).set({ status: "inactive", deletedAt: new Date() }).where(eq(usersTable.id, outsider.user.id));
    const headers = authHeader(coordinator.token);
    const response = await request(app).get("/api/users/management").set(headers);
    expect(response.status).toBe(200);
    const byId = new Map<number, { canManage: boolean }>(response.body.users.map((u: { id: number; canManage: boolean }) => [u.id, u]));
    expect(byId.get(coordinator.user.id)?.canManage).toBe(false);
    expect(byId.get(peer.user.id)?.canManage).toBe(false);
    expect(byId.get(teacher.user.id)?.canManage).toBe(true);
    expect(byId.has(outsider.user.id)).toBe(false);
    expect((await request(app).get("/api/users/management").query({ provinceId: otherProvince }).set(headers)).body.total).toBe(0);
    for (const id of [peer.user.id, outsider.user.id, coordinator.user.id]) {
      expect((await request(app).patch(`/api/users/${id}`).set(headers).send({ name: "Prohibido" })).status).toBe(403);
      expect((await request(app).post(`/api/users/${id}/reactivate`).set(headers)).status).toBe(403);
    }
    expect((await request(app).patch(`/api/users/${teacher.user.id}`).set(headers).send({ role: "coordinator" })).status).toBe(403);
    expect((await request(app).patch(`/api/users/${teacher.user.id}`).set(headers).send({ centerId: foreignCenter })).status).toBe(403);
    const headHeaders = authHeader(head.token);
    const headList = await request(app).get("/api/users/management").set(headHeaders);
    const visibleRemoteTeacher = headList.body.users.find((u: { id: number }) => u.id === otherTeacher.user.id);
    expect(visibleRemoteTeacher).toMatchObject({ canManage: false, teachingProfile: null, centerName: expect.any(String) });
    expect(headList.body.users.some((u: { id: number }) => u.id === inactiveOtherTeacher.user.id)).toBe(false);
    expect(headList.body.users.some((u: { id: number }) => u.id === otherFamilyTeacher.user.id)).toBe(false);
    expect((await request(app).delete(`/api/users/${otherTeacher.user.id}`).set(headHeaders)).status).toBe(403);
    expect((await request(app).patch(`/api/users/${otherTeacher.user.id}`).set(headHeaders).send({ name: "Prohibido" })).status).toBe(403);
    expect((await request(app).get("/api/users/management").set(authHeader(teacher.token))).status).toBe(403);
  });

  it("gives teachers a read-only directory for active users in the active family", async () => {
    const province = await createProvince();
    const otherProvince = await createProvince();
    const center = await createCenter(province);
    const familyCenter = await createCenter(otherProvince);
    const foreignFamilyCenter = await createCenter(otherProvince);
    const activeFamily = await getActiveFamily();
    await db.update(centersTable).set({ families: [`${activeFamily} (otra)`] })
      .where(eq(centersTable.id, foreignFamilyCenter));

    const caller = await createUser({ centerId: center });
    const colleague = await createUser({ centerId: familyCenter });
    const inactive = await createUser({ centerId: familyCenter, status: "inactive" });
    const foreignFamilyUser = await createUser({ centerId: foreignFamilyCenter });
    const coordinator = await createUser({ role: "coordinator", provinceId: province });

    for (const endpoint of ["/api/users/family-directory", "/api/users"]) {
      const response = await request(app).get(endpoint).set(authHeader(caller.token));
      expect(response.status).toBe(200);
      const visibleIds = new Set(response.body.map((user: { id: number }) => user.id));
      expect(visibleIds).toContain(caller.user.id);
      expect(visibleIds).toContain(colleague.user.id);
      expect(visibleIds).toContain(coordinator.user.id);
      expect(visibleIds).not.toContain(inactive.user.id);
      expect(visibleIds).not.toContain(foreignFamilyUser.user.id);
      expect(response.body.find((user: { id: number }) => user.id === colleague.user.id))
        .toMatchObject({ centerName: expect.any(String) });
      expect(response.body[0]).not.toHaveProperty("passwordHash");
      expect(response.body[0]).not.toHaveProperty("sessionNonce");
      const filtered = await request(app).get(endpoint)
        .query({ centerId: familyCenter, role: "teacher" }).set(authHeader(caller.token));
      expect(filtered.status).toBe(200);
      expect(filtered.body.map((user: { id: number }) => user.id)).toEqual([colleague.user.id]);
    }
    expect((await request(app).patch(`/api/users/${colleague.user.id}`)
      .set(authHeader(caller.token)).send({ name: "Not allowed" })).status).toBe(403);
    expect((await request(app).get("/api/users/family-directory").set(authHeader(coordinator.token))).status).toBe(403);
  });

  it("filters users by family province, island and current-family module assignment", async () => {
    const province = await createProvince();
    const island = await createIsland(province, "Isla seleccionada");
    const otherIsland = await createIsland(province, "Otra isla");
    const matchingCenter = await createCenter(province);
    const otherCenter = await createCenter(province);
    await db.update(centersTable).set({ islandId: island }).where(eq(centersTable.id, matchingCenter));
    await db.update(centersTable).set({ islandId: otherIsland }).where(eq(centersTable.id, otherCenter));

    const matchingTeacher = await createUser({ centerId: matchingCenter });
    const otherTeacher = await createUser({ centerId: otherCenter });
    const activeFamily = await getActiveFamily();
    const officialCycle = Object.entries(fpCycleFamilies)
      .find(([, families]) => families.includes(activeFamily))?.[0];
    expect(officialCycle).toBeTruthy();
    const matchingModule = await createModule({
      name: "Módulo para filtro de usuario",
      cycleName: officialCycle!,
    });
    const otherModule = await createModule({
      name: "Otro módulo para filtro de usuario",
      cycleName: officialCycle!,
    });
    const schoolYear = await getActiveAcademicYear() ?? "2026/2027";
    await createTeachingAssignment({
      teacherId: matchingTeacher.user.id,
      centerId: matchingCenter,
      moduleId: matchingModule,
      schoolYear,
    });
    await createTeachingAssignment({
      teacherId: otherTeacher.user.id,
      centerId: otherCenter,
      moduleId: otherModule,
      schoolYear,
    });

    const admin = await createUser({ role: "superadmin" });
    const headers = authHeader(admin.token);
    const options = await request(app).get("/api/users/family-filter-options").set(headers);
    expect(options.status).toBe(200);
    expect(options.body.provinces).toContainEqual(expect.objectContaining({ id: province }));
    expect(options.body.islands).toContainEqual(expect.objectContaining({ id: island, provinceId: province }));
    expect(options.body.modules).toContainEqual(expect.objectContaining({ id: matchingModule }));
    expect(options.body.modules).toContainEqual(expect.objectContaining({ id: otherModule }));

    const query = { status: "active", role: "teacher", provinceId: province, islandId: island, moduleId: matchingModule };
    const managed = await request(app).get("/api/users/management").query(query).set(headers);
    expect(managed.status).toBe(200);
    expect(managed.body.users.map((user: { id: number }) => user.id)).toContain(matchingTeacher.user.id);
    expect(managed.body.users.map((user: { id: number }) => user.id)).not.toContain(otherTeacher.user.id);

    const directory = await request(app).get("/api/users/family-directory")
      .query({ provinceId: province, islandId: island, moduleId: matchingModule })
      .set(authHeader(otherTeacher.token));
    expect(directory.status).toBe(200);
    expect(directory.body.map((user: { id: number }) => user.id)).toEqual([matchingTeacher.user.id]);
  });

  it("filters, counts, validates and clamps pages without duplicate rows", async () => {
    const admin = await createUser({ role: "superadmin" });
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const first = await createUser({ centerId, name: "Ficha filtrable" });
    const second = await createUser({ centerId, name: "Ficha filtrable" });
    const headers = authHeader(admin.token);
    const query = { role: "teacher", provinceId, centerId, search: "Ficha filtrable", pageSize: 1 };
    const page1 = await request(app).get("/api/users/management").query({ ...query, page: 1 }).set(headers);
    const page2 = await request(app).get("/api/users/management").query({ ...query, page: 2 }).set(headers);
    expect(page1.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(page2.body).toMatchObject({ total: 2, page: 2 });
    expect(new Set([page1.body.users[0].id, page2.body.users[0].id])).toEqual(new Set([first.user.id, second.user.id]));
    const clamped = await request(app).get("/api/users/management").query({ ...query, page: 999 }).set(headers);
    expect(clamped.body.page).toBe(2);
    const empty = await request(app).get("/api/users/management").query({ ...query, search: "no-such-test-user" }).set(headers);
    expect(empty.body).toMatchObject({ total: 0, page: 1, users: [] });
    for (const invalid of [{ page: 0 }, { pageSize: 101 }, { status: "deleted" }, { page: "abc" }]) {
      expect((await request(app).get("/api/users/management").query(invalid).set(headers)).status).toBe(400);
    }
  });

  it("protects self access and validates editing without changing lifecycle implicitly", async () => {
    const admin = await createUser({ role: "superadmin" });
    const teacher = await createUser();
    const headers = authHeader(admin.token);
    expect((await request(app).delete(`/api/users/${admin.user.id}`).set(headers)).status).toBe(403);
    expect((await request(app).patch(`/api/users/${admin.user.id}`).set(headers).send({ role: "teacher" })).status).toBe(403);
    expect((await request(app).patch(`/api/users/${teacher.user.id}`).set(headers).send({ name: "   " })).status).toBe(400);
    expect((await request(app).patch(`/api/users/${teacher.user.id}`).set(headers).send({ status: "inactive" })).status).toBe(400);
    expect((await request(app).patch(`/api/users/${teacher.user.id}`).set(headers).send({ status: "inventado" })).status).toBe(400);
    const province = await createProvince();
    const center = await createCenter(province);
    const wrongProvince = await createProvince();
    expect((await request(app).patch(`/api/users/${teacher.user.id}`).set(headers).send({ centerId: center, provinceId: wrongProvince })).status).toBe(400);
    const moved = await request(app).patch(`/api/users/${teacher.user.id}`).set(headers).send({ centerId: center });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ centerId: center, provinceId: province });
    const repeated = await request(app).post(`/api/users/${teacher.user.id}/reactivate`).set(headers);
    expect(repeated.status).toBe(200);
  });
});
