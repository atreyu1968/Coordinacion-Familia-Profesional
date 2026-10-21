import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { accountAuditTable, db, usersTable } from "@workspace/db";
import app from "../src/app";
import { changeAccount } from "../src/lib/accountAudit";
import { authHeader, cleanup, createCenter, createProvince, createUser } from "./helpers";

afterAll(cleanup);

describe("administrative account audit", () => {
  it("records only changed administrative fields with actor, target and date; ignores secrets and no-ops", async () => {
    const admin = await createUser({ role: "superadmin" });
    const target = await createUser();
    const headers = authHeader(admin.token);
    const path = `/api/users/${target.user.id}`;
    expect((await request(app).get(`${path}/audit`).set(headers)).body.events).toEqual([]);
    const start = Date.now();
    const response = await request(app).patch(path).set(headers).send({
      name: "  Nombre administrativo  ", role: "department_head",
      password: "DO-NOT-RECORD", token: "DO-NOT-RECORD", passwordHash: "DO-NOT-RECORD",
    });
    expect(response.status).toBe(200);
    const history = await request(app).get(`${path}/audit`).set(headers);
    expect(history.status).toBe(200);
    expect(history.body.events).toHaveLength(1);
    expect(history.body.events[0]).toMatchObject({
      actorId: admin.user.id, actorName: admin.user.name, targetId: target.user.id, action: "update",
      changes: [
        { field: "name", before: target.user.name, after: "Nombre administrativo" },
        { field: "role", before: "teacher", after: "department_head" },
      ],
    });
    expect(new Date(history.body.events[0].occurredAt).getTime()).toBeGreaterThanOrEqual(start);
    expect(Object.keys(history.body.events[0]).sort()).toEqual(
      ["id", "actorId", "actorName", "targetId", "occurredAt", "action", "changes"].sort(),
    );
    const [stored] = await db.select().from(accountAuditTable).where(eq(accountAuditTable.targetId, target.user.id));
    expect(JSON.stringify(stored)).not.toContain("DO-NOT-RECORD");
    expect(JSON.stringify(stored)).not.toContain(target.user.passwordHash);
    expect((await request(app).patch(path).set(headers).send({ name: "Nombre administrativo" })).status).toBe(200);
    expect((await request(app).patch(path).set(headers).send({ name: "   " })).status).toBe(400);
    expect((await request(app).get(`${path}/audit`).set(headers)).body.events).toHaveLength(1);
  });

  it("records deactivation and reactivation once and preserves previous events", async () => {
    const admin = await createUser({ role: "superadmin" });
    const target = await createUser();
    const headers = authHeader(admin.token);
    const path = `/api/users/${target.user.id}`;
    await request(app).patch(path).set(headers).send({ name: "Con historial" }).expect(200);
    const first = (await request(app).get(`${path}/audit`).set(headers)).body.events[0];
    await request(app).delete(path).set(headers).expect(204);
    await request(app).delete(path).set(headers).expect(404);
    const deactivated = await request(app).get(`${path}/audit`).set(headers);
    expect(deactivated.body.events[0]).toMatchObject({
      action: "deactivate", changes: [{ field: "status", before: "active", after: "inactive" }],
    });
    await request(app).post(`${path}/reactivate`).set(headers).expect(200);
    await request(app).post(`${path}/reactivate`).set(headers).expect(200);
    const result = await request(app).get(`${path}/audit`).set(headers);
    expect(result.body.events).toHaveLength(3);
    expect(result.body.events[0]).toMatchObject({
      action: "reactivate", changes: [{ field: "status", before: "inactive", after: "active" }],
    });
    expect(result.body.events[2]).toEqual(first);
  });

  it("denies teachers, peers, unscoped managers and foreign provinces/centers, including inactive accounts", async () => {
    const province = await createProvince();
    const center = await createCenter(province);
    const otherCenter = await createCenter(province);
    const admin = await createUser({ role: "superadmin" });
    const coordinator = await createUser({ role: "coordinator", provinceId: province });
    const head = await createUser({ role: "department_head", provinceId: province, centerId: center });
    const target = await createUser({ centerId: center });
    const path = `/api/users/${target.user.id}`;
    await request(app).patch(path).set(authHeader(coordinator.token)).send({ name: "Cambio autorizado" }).expect(200);
    for (const viewer of [coordinator, head, admin]) {
      const visible = await request(app).get(`${path}/audit`).set(authHeader(viewer.token));
      expect(visible.status).toBe(200);
      expect(visible.body.events).toHaveLength(1);
    }
    const outsiders = [
      await createUser({ role: "coordinator", provinceId: await createProvince() }),
      await createUser({ role: "department_head", centerId: otherCenter, provinceId: province }),
      await createUser({ role: "coordinator" }),
      await createUser({ role: "department_head" }),
    ];
    for (const viewer of outsiders) {
      await request(app).get(`${path}/audit`).set(authHeader(viewer.token)).expect(404);
    }
    await request(app).get(`${path}/audit`).set(authHeader(target.token)).expect(403);
    await request(app).get(`${path}/audit`).expect(401);
    await request(app).get(`/api/users/${coordinator.user.id}/audit`).set(authHeader(head.token)).expect(404);
    await request(app).delete(path).set(authHeader(coordinator.token)).expect(204);
    expect((await request(app).get(`${path}/audit`).set(authHeader(head.token))).body.events).toHaveLength(2);
    await request(app).get(`${path}/audit`).set(authHeader(outsiders[0].token)).expect(404);
  });

  it("does not expose earlier scopes or transfer details to the receiving manager", async () => {
    const admin = await createUser({ role: "superadmin" });
    const p1 = await createProvince();
    const p2 = await createProvince();
    const c1 = await createCenter(p1);
    const c2 = await createCenter(p2);
    const oldManager = await createUser({ role: "coordinator", provinceId: p1 });
    const newManager = await createUser({ role: "coordinator", provinceId: p2 });
    const target = await createUser({ centerId: c1 });
    const path = `/api/users/${target.user.id}`;
    const headers = authHeader(admin.token);
    await request(app).patch(path).set(headers).send({ name: "Antes del traslado" }).expect(200);
    await request(app).patch(path).set(headers).send({ centerId: c2 }).expect(200);
    await request(app).get(`${path}/audit`).set(authHeader(oldManager.token)).expect(404);
    expect((await request(app).get(`${path}/audit`).set(authHeader(newManager.token))).body.events).toEqual([]);
    await request(app).patch(path).set(authHeader(newManager.token)).send({ name: "Después del traslado" }).expect(200);
    const visible = await request(app).get(`${path}/audit`).set(authHeader(newManager.token));
    expect(visible.body.events).toHaveLength(1);
    const global = await request(app).get(`${path}/audit`).set(headers);
    expect(global.body.events).toHaveLength(3);
    expect(global.body.events[1].changes).toEqual([
      { field: "centerId", before: String(c1), after: String(c2) },
      { field: "provinceId", before: String(p1), after: String(p2) },
    ]);
    // Moving within a province still must not expose the former center to a head.
    const c3 = await createCenter(p2);
    const head = await createUser({ role: "department_head", centerId: c3, provinceId: p2 });
    await request(app).patch(path).set(headers).send({ centerId: c3 }).expect(200);
    expect((await request(app).get(`${path}/audit`).set(authHeader(head.token))).body.events).toEqual([]);
  });

  it("rolls back both change and event on failure and rejects a stale update", async () => {
    const admin = await createUser({ role: "superadmin" });
    const target = await createUser();
    await expect(changeAccount(admin.user, target.user, "update", { name: "No guardar" }, async () => {
      throw new Error("Failure after audit insertion");
    })).rejects.toThrow("Failure after audit insertion");
    const [unchanged] = await db.select().from(usersTable).where(eq(usersTable.id, target.user.id));
    expect(unchanged.name).toBe(target.user.name);
    expect(await db.select().from(accountAuditTable).where(eq(accountAuditTable.targetId, target.user.id))).toEqual([]);
    expect(await changeAccount(admin.user, target.user, "update", { name: "Primero" })).not.toBeNull();
    expect(await changeAccount(admin.user, target.user, "update", { name: "Desfasado" })).toBeNull();
    const events = await db.select().from(accountAuditTable).where(eq(accountAuditTable.targetId, target.user.id));
    expect(events).toHaveLength(1);
    expect(events[0].changes[0].after).toBe("Primero");
  });

  it("paginates in stable reverse order and validates input", async () => {
    const admin = await createUser({ role: "superadmin" });
    const target = await createUser();
    const headers = authHeader(admin.token);
    const path = `/api/users/${target.user.id}`;
    for (let i = 0; i < 26; i++) {
      await request(app).patch(path).set(headers).send({ name: `Cambio ${i}` }).expect(200);
    }
    const first = await request(app).get(`${path}/audit`).set(headers);
    const second = await request(app).get(`${path}/audit?page=2`).set(headers);
    expect(first.body.events).toHaveLength(25);
    expect(first.body.hasMore).toBe(true);
    expect(second.body.events).toHaveLength(1);
    expect(second.body.hasMore).toBe(false);
    expect(new Set([...first.body.events, ...second.body.events].map((e: { id: number }) => e.id)).size).toBe(26);
    for (const invalid of ["0", "-1", "abc", "1.5", "1000001"]) {
      await request(app).get(`${path}/audit?page=${invalid}`).set(headers).expect(400);
    }
  });

  it("hides former higher-role events from a lower-ranking manager after demotion", async () => {
    const province = await createProvince();
    const center = await createCenter(province);
    const admin = await createUser({ role: "superadmin" });
    const head = await createUser({ role: "department_head", centerId: center, provinceId: province });
    const target = await createUser({ role: "prospector", centerId: center, provinceId: province });
    const path = `/api/users/${target.user.id}`;
    const headers = authHeader(admin.token);
    await request(app).patch(path).set(headers).send({ name: "Antes del cambio de rol" }).expect(200);
    await request(app).patch(path).set(headers).send({ role: "teacher" }).expect(200);
    const history = await request(app).get(`${path}/audit`).set(authHeader(head.token));
    expect(history.status).toBe(200);
    expect(history.body.events).toEqual([]);
    expect((await request(app).get(`${path}/audit`).set(headers)).body.events).toHaveLength(2);
    await request(app).patch(path).set(authHeader(head.token)).send({ name: "Cambio de jefatura" }).expect(200);
    expect((await request(app).get(`${path}/audit`).set(authHeader(head.token))).body.events).toHaveLength(1);
  });
});
