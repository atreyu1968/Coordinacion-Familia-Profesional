import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { db, collaborativeSpacesTable as spaces, collaborativeSpaceMembersTable as members, collaborativeSpaceAuditTable as audit, usersTable, centersTable, notificationsTable } from "@workspace/db";
import app from "../src/app";
import * as nextcloud from "../src/lib/nextcloud";
import * as notify from "../src/lib/notify";
import { withPushPath } from "../src/lib/push";
import * as auditWriter from "../src/lib/collaborativeSpaceAudit";
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
    const inactive = await createUser({ centerId, status: "inactive" });
    const deleted = await createUser({ centerId });
    await db.update(usersTable).set({ deletedAt: new Date() }).where(eq(usersTable.id, deleted.user.id));
    const created = await createSpace(admin.token, {
      name: "  Equipo de innovación  ", description: "Centros colaboradores",
      userIds: [first.user.id, first.user.id], centerIds: [centerId, centerId],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Equipo de innovación", memberCount: 2, canManage: true });
    const detail = await request(app).get(`/api/collab/spaces/${created.body.id}`).set(authHeader(admin.token));
    expect(detail.status).toBe(200);
    expect(detail.body.members.map((m: { id: number }) => m.id).sort()).toEqual([first.user.id, second.user.id].sort());
    const recipients = [first.user.id, second.user.id, inactive.user.id, deleted.user.id, admin.user.id];
    const notices = await db.select().from(notificationsTable).where(inArray(notificationsTable.userId, recipients));
    expect(notices).toHaveLength(2);
    expect(notices.map((n) => n.userId).sort()).toEqual([first.user.id, second.user.id].sort());
    expect(notices[0]).toMatchObject({
      type: "collaborative_space", title: "Te han añadido a un espacio colaborativo", readAt: null,
    });
    expect(notices[0]!.body).toContain("Equipo de innovación");
    expect(withPushPath({ title: "Aviso", data: { type: notices[0]!.type } }).data?.path).toBe("/espacios-colaborativos");
    const later = await createUser({ centerId });
    const unchanged = await request(app).get(`/api/collab/spaces/${created.body.id}`).set(authHeader(admin.token));
    expect(unchanged.body.members.some((m: { id: number }) => m.id === later.user.id)).toBe(false);
    const added = await request(app).post(`/api/collab/spaces/${created.body.id}/members`).set(authHeader(admin.token))
      .send({ userIds: [later.user.id], centerIds: [centerId] });
    expect(added.body.memberCount).toBe(3);
    const repeat = () => request(app).post(`/api/collab/spaces/${created.body.id}/members`).set(authHeader(admin.token))
      .send({ userIds: [later.user.id, first.user.id, later.user.id], centerIds: [centerId, centerId] });
    const retries = await Promise.all([repeat(), repeat()]);
    expect(retries.map((r) => r.status)).toEqual([200, 200]);
    const afterRetries = await db.select().from(notificationsTable)
      .where(inArray(notificationsTable.userId, [...recipients, later.user.id]));
    expect(afterRetries).toHaveLength(3);
    expect(afterRetries.map((n) => n.userId).sort()).toEqual([first.user.id, second.user.id, later.user.id].sort());
  });

  it("notifies only the inserted members when simultaneous additions overlap", async () => {
    const admin = await createUser({ role: "superadmin" }), teacher = await createUser();
    const created = await createSpace(admin.token);
    const add = () => request(app).post(`/api/collab/spaces/${created.body.id}/members`).set(authHeader(admin.token))
      .send({ userIds: [teacher.user.id] });
    expect((await Promise.all([add(), add()])).map((r) => r.status)).toEqual([200, 200]);
    expect(await db.select().from(notificationsTable).where(eq(notificationsTable.userId, teacher.user.id))).toHaveLength(1);
  });

  it("commits creation and additions even if notifications fail, without retrying already applied selections", async () => {
    const admin = await createUser({ role: "superadmin" }), first = await createUser(), second = await createUser();
    const delivery = vi.spyOn(notify, "notifyUsers").mockRejectedValue(new Error("Notification unavailable"));
    const created = await createSpace(admin.token, { name: "Equipo con avisos fallidos", userIds: [first.user.id] });
    expect(created.status).toBe(201);
    expect(created.body.memberCount).toBe(1);
    const add = () => request(app).post(`/api/collab/spaces/${created.body.id}/members`).set(authHeader(admin.token))
      .send({ userIds: [first.user.id, second.user.id] });
    const added = await add();
    expect(added.status).toBe(200);
    expect(added.body.memberCount).toBe(2);
    expect(delivery).toHaveBeenNthCalledWith(1, [first.user.id], expect.objectContaining({ type: "collaborative_space" }));
    expect(delivery).toHaveBeenNthCalledWith(2, [second.user.id], expect.anything());
    delivery.mockResolvedValue(0);
    expect((await add()).status).toBe(200);
    expect(delivery).toHaveBeenCalledTimes(2);
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
    // An old persisted notification is information, not an authorization grant.
    const notices = await request(app).get("/api/notifications").set(authHeader(teacher.token));
    expect(notices.status).toBe(200);
    expect(notices.body).toEqual(expect.arrayContaining([expect.objectContaining({ type: "collaborative_space" })]));
    const visible = await request(app).get("/api/collab/spaces").set(authHeader(teacher.token));
    expect(visible.body.some((s: { id: number }) => s.id === id)).toBe(false);
    expect(remote.provision).toHaveBeenCalledTimes(2);
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

describe("independent space audit history", () => {
  it("keeps identity and selection snapshots across renames and records only actual new members", async () => {
    const admin = await createUser({ role: "superadmin", name: "Responsable original" });
    const province = await createProvince(), centerId = await createCenter(province);
    const first = await createUser({ centerId, name: "Participante original" });
    await createUser({ centerId, status: "inactive" });
    const [center] = await db.select().from(centersTable).where(eq(centersTable.id, centerId));
    const created = await createSpace(admin.token, {
      name: "Nombre inicial", description: "NO_COPIAR_DESCRIPCION",
      userIds: [first.user.id, first.user.id], centerIds: [centerId, centerId],
    });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const later = await createUser({ centerId });
    expect((await request(app).post(`/api/collab/spaces/${id}/members`).set(authHeader(admin.token))
      .send({ userIds: [first.user.id, later.user.id], centerIds: [centerId] })).status).toBe(200);
    expect((await request(app).patch(`/api/collab/spaces/${id}`).set(authHeader(admin.token))
      .send({ name: "Nombre nuevo", description: "OTRA_DESCRIPCION_PRIVADA" })).status).toBe(200);
    // A no-op edit does not create a misleading "changed" event.
    await request(app).patch(`/api/collab/spaces/${id}`).set(authHeader(admin.token))
      .send({ name: "Nombre nuevo", description: "OTRA_DESCRIPCION_PRIVADA" });
    await db.update(usersTable).set({ name: "Responsable renombrado" }).where(eq(usersTable.id, admin.user.id));
    await db.update(usersTable).set({ name: "Participante renombrado", deletedAt: new Date() }).where(eq(usersTable.id, first.user.id));
    await db.update(centersTable).set({ name: "Centro renombrado" }).where(eq(centersTable.id, centerId));
    const history = await request(app).get(`/api/collab/spaces/${id}/history`).set(authHeader(admin.token));
    expect(history.status).toBe(200);
    expect(history.body).toMatchObject({ total: 3, page: 1, pageSize: 20 });
    const [updated, added, original] = history.body.items;
    expect(original).toMatchObject({
      spaceId: id, spaceName: "Nombre inicial", actorId: admin.user.id, actorName: "Responsable original",
      actorRole: "superadmin", action: "created",
      details: {
        selectedUsers: [{ id: first.user.id, name: "Participante original" }],
        selectedCenters: [{ id: centerId, name: center!.name }],
        affectedUsers: [{ id: first.user.id, name: "Participante original" }],
        revocation: "not_applicable",
      },
    });
    expect(added.details.affectedUsers.map((u: { id: number }) => u.id)).toEqual([later.user.id]);
    expect(added.details.selectedUsers).toHaveLength(2);
    expect(updated).toMatchObject({ action: "updated", spaceName: "Nombre nuevo", details: {
      previousName: "Nombre inicial", newName: "Nombre nuevo", changedFields: ["name", "description"],
    } });
    expect(new Date(original.createdAt).getTime()).toBeGreaterThan(0);
    expect(JSON.stringify(history.body)).not.toMatch(/NO_COPIAR_DESCRIPCION|OTRA_DESCRIPCION_PRIVADA|passwordHash|sessionNonce|tokenVersion/);
    // Unauthorized/invalid operations must never produce success events.
    expect((await request(app).post(`/api/collab/spaces/${id}/members`).set(authHeader(admin.token))
      .send({ userIds: [2147483647] })).status).toBe(400);
    expect((await db.select().from(audit).where(eq(audit.spaceId, id)))).toHaveLength(3);
  });

  it("restricts history to superadministrators without granting account permissions or leaking space existence", async () => {
    const admin = await createUser({ role: "superadmin" }), teacher = await createUser();
    const created = await createSpace(admin.token, { name: "Auditoría privada", userIds: [teacher.user.id] });
    const path = `/api/collab/spaces/${created.body.id}/history`;
    expect((await request(app).get(path)).status).toBe(401);
    for (const role of ["teacher", "coordinator", "department_head", "prospector"] as const) {
      const user = role === "teacher" ? teacher : await createUser({ role });
      expect((await request(app).get(path).set(authHeader(user.token))).status).toBe(403);
      expect((await request(app).get("/api/collab/spaces/2147483647/history").set(authHeader(user.token))).status).toBe(403);
    }
    expect((await request(app).get("/api/collab/spaces/not-an-id/history").set(authHeader(admin.token))).status).toBe(400);
    expect((await request(app).get("/api/collab/spaces/2147483647/history").set(authHeader(admin.token))).status).toBe(404);
    const [account] = await db.select().from(usersTable).where(eq(usersTable.id, teacher.user.id));
    expect(account?.role).toBe("teacher");
  });

  it("paginates by space with deterministic ordering on tied dates and rejects invalid page bounds", async () => {
    const admin = await createUser({ role: "superadmin" });
    const first = await createSpace(admin.token), other = await createSpace(admin.token);
    const id = first.body.id, path = `/api/collab/spaces/${id}/history`;
    const original = (await db.select().from(audit).where(eq(audit.spaceId, id)))[0]!;
    await db.insert(audit).values(Array.from({ length: 24 }, (_, i) => ({
      spaceId: id, spaceName: original.spaceName, actorId: original.actorId,
      actorName: original.actorName, actorRole: original.actorRole,
      action: "updated" as const, summary: `Cambio ${i}`, details: original.details, createdAt: original.createdAt,
    })));
    // PostgreSQL now() has microseconds; JS Date only has milliseconds. Set
    // every row explicitly so the test really exercises the ID tie-breaker.
    await db.update(audit).set({ createdAt: new Date("2026-01-01T00:00:00.000Z") }).where(eq(audit.spaceId, id));
    const page1 = await request(app).get(path).query({ page: 1, pageSize: 20 }).set(authHeader(admin.token));
    const page2 = await request(app).get(path).query({ page: 2, pageSize: 20 }).set(authHeader(admin.token));
    expect(page1.status).toBe(200);
    expect(page1.body).toMatchObject({ total: 25, page: 1, pageSize: 20 });
    expect(page1.body.items).toHaveLength(20);
    expect(page2.body.items).toHaveLength(5);
    const combined = [...page1.body.items, ...page2.body.items].map((e: { id: number }) => e.id);
    expect(new Set(combined).size).toBe(25);
    expect(combined).toEqual([...combined].sort((a, b) => b - a));
    expect(page1.body.items.every((e: { spaceId: number }) => e.spaceId === id)).toBe(true);
    expect((await request(app).get(`/api/collab/spaces/${other.body.id}/history`).set(authHeader(admin.token))).body.total).toBe(1);
    expect((await request(app).get(path).query({ page: 3 }).set(authHeader(admin.token))).body.items).toEqual([]);
    for (const query of [
      { page: 0 }, { page: -1 }, { page: 1.5 }, { page: "bad" }, { page: 1000001 },
      { pageSize: 0 }, { pageSize: 101 }, { pageSize: 1.5 }, { pageSize: "bad" }, { page: ["1", "2"] },
    ]) expect((await request(app).get(path).query(query).set(authHeader(admin.token))).status).toBe(400);
  });

  it("commits failed revocations, retains the member and distinguishes configuration failure, retry success and no remote access", async () => {
    const remote = configured();
    const admin = await createUser({ role: "superadmin" }), teacher = await createUser();
    const created = await createSpace(admin.token, { name: "Registro de revocación", userIds: [teacher.user.id] });
    const id = created.body.id, path = `/api/collab/spaces/${id}/members/${teacher.user.id}`;
    // Even partial provisioning forces later revocation.
    remote.provision.mockRejectedValue(new Error("private remote response"));
    expect((await request(app).post(`/api/collab/spaces/${id}/open`).set(authHeader(teacher.token))).status).toBe(502);
    remote.revoke.mockRejectedValue(new Error("fixture-password https://sso.invalid/?ticket=SECRET_TICKET"));
    expect((await request(app).delete(path).set(authHeader(admin.token))).status).toBe(502);
    expect((await db.select().from(members).where(andIds(id, teacher.user.id)))).toHaveLength(1);
    const failed = await request(app).get(`/api/collab/spaces/${id}/history`).set(authHeader(admin.token));
    expect(failed.body.items[0]).toMatchObject({
      action: "member_removal_failed", details: { revocation: "failed", affectedUsers: [{ id: teacher.user.id, name: teacher.user.name }] },
    });
    vi.mocked(nextcloud.isNextcloudConfigured).mockReturnValue(false);
    expect((await request(app).delete(path).set(authHeader(admin.token))).status).toBe(503);
    expect((await db.select().from(members).where(andIds(id, teacher.user.id)))).toHaveLength(1);
    vi.mocked(nextcloud.isNextcloudConfigured).mockReturnValue(true);
    remote.revoke.mockResolvedValue();
    expect((await request(app).delete(path).set(authHeader(admin.token))).status).toBe(204);
    expect((await db.select().from(members).where(andIds(id, teacher.user.id)))).toHaveLength(0);
    const history = await request(app).get(`/api/collab/spaces/${id}/history`).set(authHeader(admin.token));
    expect(history.body.items.map((e: { action: string }) => e.action)).toEqual(["member_removed", "member_removal_failed", "member_removal_failed", "created"]);
    expect(history.body.items.map((e: { details: { revocation: string } }) => e.details.revocation))
      .toEqual(["completed", "configuration_missing", "failed", "not_applicable"]);
    expect(JSON.stringify(history.body)).not.toMatch(/fixture-password|SECRET_TICKET|sso.invalid|private remote response/);
    const local = await createSpace(admin.token, { name: "Sin Nextcloud", userIds: [teacher.user.id] });
    expect((await request(app).delete(`/api/collab/spaces/${local.body.id}/members/${teacher.user.id}`).set(authHeader(admin.token))).status).toBe(204);
    expect((await request(app).get(`/api/collab/spaces/${local.body.id}/history`).set(authHeader(admin.token)))
      .body.items[0].details.revocation).toBe("not_required");
    expect((await db.select().from(usersTable).where(eq(usersTable.id, teacher.user.id)))[0]?.status).toBe("active");
  });

  it("rolls back local mutations if their audit record cannot be saved", async () => {
    const admin = await createUser({ role: "superadmin" }), teacher = await createUser();
    const created = await createSpace(admin.token);
    const id = created.body.id;
    const writer = vi.spyOn(auditWriter, "recordSpaceAudit").mockRejectedValue(new Error("Audit storage unavailable"));
    expect((await request(app).patch(`/api/collab/spaces/${id}`).set(authHeader(admin.token))
      .send({ name: "No debe guardarse" })).status).toBe(500);
    expect((await request(app).post(`/api/collab/spaces/${id}/members`).set(authHeader(admin.token))
      .send({ userIds: [teacher.user.id] })).status).toBe(500);
    expect((await db.select().from(spaces).where(eq(spaces.id, id)))[0]?.name).toBe(created.body.name);
    expect((await db.select().from(members).where(eq(members.spaceId, id)))).toHaveLength(0);
    expect((await db.select().from(audit).where(eq(audit.spaceId, id)))).toHaveLength(1);
    writer.mockRestore();
  });
});
