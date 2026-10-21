import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { db, collaborativeSpacesTable as spaces, collaborativeSpaceMembersTable as members, usersTable, centersTable } from "@workspace/db";
import app from "../src/app";
import * as nextcloud from "../src/lib/nextcloud";
import { createUser, createCenter, createProvince, cleanup, authHeader } from "./helpers";

const ids: number[] = [];
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (ids.length) await db.delete(spaces).where(inArray(spaces.id, ids));
  await cleanup();
});
async function createSpace(token: string, data: object = { name: "Equipo independiente" }) {
  const response = await request(app).post("/api/collab/spaces").set(authHeader(token)).send(data);
  if (response.status === 201) ids.push(response.body.id);
  return response;
}
function configured() {
  vi.spyOn(nextcloud, "isNextcloudConfigured").mockReturnValue(true);
  vi.spyOn(nextcloud, "resolveNextcloudConfig").mockReturnValue({
    url: "https://cloud.example.test", adminUser: "fixture-admin", adminPassword: "fixture-password",
  });
  vi.spyOn(nextcloud, "resolveNextcloudUrl").mockReturnValue("https://cloud.example.test");
  return {
    provision: vi.spyOn(nextcloud, "provisionIndependentSpace").mockResolvedValue(),
    revoke: vi.spyOn(nextcloud, "revokeIndependentSpaceMember").mockResolvedValue(),
  };
}

describe("independent collaborative spaces", () => {
  it("creates an independent space atomically and expands current center users without duplicates or inactive users", async () => {
    const admin = await createUser({ role: "superadmin" });
    const provinceId = await createProvince(), centerId = await createCenter(provinceId);
    const first = await createUser({ centerId }), second = await createUser({ centerId });
    await createUser({ centerId, status: "inactive" });
    const created = await createSpace(admin.token, {
      name: "  Equipo de innovación  ", description: "Centros colaboradores",
      userIds: [first.user.id, first.user.id], centerIds: [centerId, centerId],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Equipo de innovación", memberCount: 2, canManage: true });
    const detail = await request(app).get(`/api/collab/spaces/${created.body.id}`).set(authHeader(admin.token));
    expect(detail.status).toBe(200);
    expect(detail.body.members.map((m: { id: number }) => m.id).sort()).toEqual([first.user.id, second.user.id].sort());
    const later = await createUser({ centerId });
    const unchanged = await request(app).get(`/api/collab/spaces/${created.body.id}`).set(authHeader(admin.token));
    expect(unchanged.body.members.some((m: { id: number }) => m.id === later.user.id)).toBe(false);
    const added = await request(app).post(`/api/collab/spaces/${created.body.id}/members`).set(authHeader(admin.token))
      .send({ userIds: [later.user.id], centerIds: [centerId] });
    expect(added.body.memberCount).toBe(3);
  });

  it("reserves management and candidate personal data for superadmin and hides spaces from outsiders", async () => {
    const admin = await createUser({ role: "superadmin" }), teacher = await createUser(), outsider = await createUser();
    const coordinator = await createUser({ role: "coordinator" });
    const created = await createSpace(admin.token, { name: "Equipo restringido", userIds: [teacher.user.id] });
    const id = created.body.id;
    expect((await request(app).get("/api/collab/spaces")).status).toBe(401);
    const own = await request(app).get("/api/collab/spaces").set(authHeader(teacher.token));
    expect(own.body.find((s: { id: number }) => s.id === id)?.canManage).toBe(false);
    const other = await request(app).get("/api/collab/spaces").set(authHeader(outsider.token));
    expect(other.body.some((s: { id: number }) => s.id === id)).toBe(false);
    for (const user of [teacher, coordinator, outsider]) {
      const headers = authHeader(user.token);
      expect((await request(app).get("/api/collab/candidates").set(headers)).status).toBe(403);
      expect((await request(app).get(`/api/collab/spaces/${id}`).set(headers)).status).toBe(403);
      expect((await createSpace(user.token)).status).toBe(403);
      expect((await request(app).patch(`/api/collab/spaces/${id}`).set(headers).send({ name: "Otro nombre" })).status).toBe(403);
      expect((await request(app).post(`/api/collab/spaces/${id}/members`).set(headers).send({ userIds: [outsider.user.id] })).status).toBe(403);
      expect((await request(app).delete(`/api/collab/spaces/${id}/members/${teacher.user.id}`).set(headers)).status).toBe(403);
    }
    expect((await request(app).post(`/api/collab/spaces/${id}/open`).set(authHeader(outsider.token))).status).toBe(403);
  });

  it("validates selections, offers only active candidates and leaves no partial creation on invalid input", async () => {
    const admin = await createUser({ role: "superadmin" });
    const inactive = await createUser({ status: "inactive" });
    const provinceId = await createProvince(), unavailableCenter = await createCenter(provinceId);
    await db.update(centersTable).set({ families: ["Otra familia"] }).where(eq(centersTable.id, unavailableCenter));
    const candidates = await request(app).get("/api/collab/candidates").set(authHeader(admin.token));
    expect(candidates.status).toBe(200);
    expect(candidates.body.users.some((u: { id: number }) => u.id === inactive.user.id)).toBe(false);
    expect(candidates.body.centers.some((c: { id: number }) => c.id === unavailableCenter)).toBe(false);
    expect(JSON.stringify(candidates.body)).not.toContain("passwordHash");
    for (const data of [
      { name: " " }, { name: "Equipo", userIds: [inactive.user.id] },
      { name: "Equipo", centerIds: [unavailableCenter] }, { name: "Equipo", userIds: [2147483647] },
    ]) expect((await createSpace(admin.token, data)).status).toBe(400);
    expect((await request(app).get("/api/collab/spaces/not-an-id").set(authHeader(admin.token))).status).toBe(400);
    expect((await request(app).get("/api/collab/spaces/2147483647").set(authHeader(admin.token))).status).toBe(404);
  });

  it("renames without moving folders and removes an unprovisioned membership without deleting the user or space", async () => {
    vi.spyOn(nextcloud, "isNextcloudConfigured").mockReturnValue(false);
    const admin = await createUser({ role: "superadmin" }), teacher = await createUser();
    const created = await createSpace(admin.token, { name: "Nombre original", userIds: [teacher.user.id] });
    const id = created.body.id, folder = nextcloud.independentSpaceFolderName(id);
    const edited = await request(app).patch(`/api/collab/spaces/${id}`).set(authHeader(admin.token))
      .send({ name: "Nombre actualizado", description: "Descripción actualizada" });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ name: "Nombre actualizado", memberCount: 1 });
    expect(nextcloud.independentSpaceFolderName(id)).toBe(folder);
    expect(nextcloud.independentSpaceGroupId(id)).not.toBe(nextcloud.moduleGroupId(id));
    expect((await request(app).post(`/api/collab/spaces/${id}/open`).set(authHeader(teacher.token))).status).toBe(503);
    expect((await request(app).delete(`/api/collab/spaces/${id}/members/${teacher.user.id}`).set(authHeader(admin.token))).status).toBe(204);
    expect((await db.select().from(usersTable).where(eq(usersTable.id, teacher.user.id)))[0]?.status).toBe("active");
    expect((await db.select().from(spaces).where(eq(spaces.id, id)))).toHaveLength(1);
  });

  it("opens only for authorized members, issues fresh one-use SSO tickets and rejects a ticket after removal", async () => {
    const remote = configured();
    const admin = await createUser({ role: "superadmin" }), teacher = await createUser();
    const created = await createSpace(admin.token, { name: "Espacio SSO", userIds: [teacher.user.id] });
    const id = created.body.id;
    const opened = await request(app).post(`/api/collab/spaces/${id}/open`).set(authHeader(teacher.token));
    expect(opened.status).toBe(200);
    expect(remote.provision).toHaveBeenCalledWith(expect.anything(), {
      spaceId: id, members: expect.arrayContaining([expect.objectContaining({ userId: teacher.user.id }), expect.objectContaining({ userId: admin.user.id })]),
    });
    const path = new URL(opened.body.url).pathname + new URL(opened.body.url).search;
    const sso = await request(app).get(path);
    expect(sso.status).toBe(302);
    const destination = new URL(sso.headers.location).searchParams.get("redirect_url");
    expect(destination).toContain(encodeURIComponent(nextcloud.independentSpaceFolderName(id)));
    expect((await request(app).get(path)).status).toBe(400);
    const another = await request(app).post(`/api/collab/spaces/${id}/open`).set(authHeader(teacher.token));
    expect(another.body.url).not.toBe(opened.body.url);
    expect((await request(app).delete(`/api/collab/spaces/${id}/members/${teacher.user.id}`).set(authHeader(admin.token))).status).toBe(204);
    expect(remote.revoke).toHaveBeenCalledWith(expect.anything(), id, teacher.user.id);
    const stalePath = new URL(another.body.url).pathname + new URL(another.body.url).search;
    expect((await request(app).get(stalePath)).status).toBe(403);
    expect((await request(app).post(`/api/collab/spaces/${id}/open`).set(authHeader(teacher.token))).status).toBe(403);
  });

  it("fails closed when remote revocation fails or configuration disappears after partial provisioning", async () => {
    const remote = configured();
    const admin = await createUser({ role: "superadmin" }), teacher = await createUser();
    const created = await createSpace(admin.token, { name: "Revocación segura", userIds: [teacher.user.id] });
    const id = created.body.id;
    remote.provision.mockRejectedValue(new Error("Temporary remote outage"));
    expect((await request(app).post(`/api/collab/spaces/${id}/open`).set(authHeader(teacher.token))).status).toBe(502);
    expect((await db.select().from(spaces).where(eq(spaces.id, id)))[0]?.provisioningStartedAt).toBeInstanceOf(Date);
    remote.revoke.mockRejectedValue(new Error("Cannot reach Nextcloud"));
    expect((await request(app).delete(`/api/collab/spaces/${id}/members/${teacher.user.id}`).set(authHeader(admin.token))).status).toBe(502);
    expect((await db.select().from(members).where(andIds(id, teacher.user.id)))).toHaveLength(1);
    vi.mocked(nextcloud.isNextcloudConfigured).mockReturnValue(false);
    expect((await request(app).delete(`/api/collab/spaces/${id}/members/${teacher.user.id}`).set(authHeader(admin.token))).status).toBe(503);
    expect((await db.select().from(members).where(andIds(id, teacher.user.id)))).toHaveLength(1);
  });
});

const andIds = (spaceId: number, userId: number) => and(eq(members.spaceId, spaceId), eq(members.userId, userId));
