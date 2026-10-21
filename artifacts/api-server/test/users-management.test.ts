import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import app from "../src/app";
import { authHeader, cleanup, createCenter, createProvince, createUser } from "./helpers";

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
    const coordinator = await createUser({ role: "coordinator", provinceId: province });
    const peer = await createUser({ role: "coordinator", provinceId: province });
    const head = await createUser({ role: "department_head", provinceId: province, centerId: center });
    const teacher = await createUser({ centerId: center });
    const otherTeacher = await createUser({ centerId: otherCenter });
    const outsider = await createUser({ centerId: foreignCenter });
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
    expect(headList.body.users.some((u: { id: number }) => u.id === otherTeacher.user.id)).toBe(false);
    expect((await request(app).delete(`/api/users/${otherTeacher.user.id}`).set(headHeaders)).status).toBe(403);
    expect((await request(app).get("/api/users/management").set(authHeader(teacher.token))).status).toBe(403);
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
