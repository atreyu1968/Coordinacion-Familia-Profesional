import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { db, centersTable } from "@workspace/db";
import app from "../src/app";
import {
  authHeader,
  cleanup,
  createCenter,
  createProvince,
  createUser,
} from "./helpers";

afterAll(cleanup);

describe("dashboard record list scopes", () => {
  it("keeps the centers directory within the caller's role scope", async () => {
    const provinceId = await createProvince();
    const otherProvinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const otherCenterId = await createCenter(otherProvinceId);
    const coordinator = await createUser({
      role: "coordinator",
      provinceId,
    });
    const head = await createUser({
      role: "department_head",
      provinceId,
      centerId,
    });
    const admin = await createUser({ role: "superadmin" });

    const coordinatorList = await request(app)
      .get("/api/centers")
      .query({ dashboardOnly: true, provinceId: otherProvinceId })
      .set(authHeader(coordinator.token));
    const headList = await request(app)
      .get("/api/centers")
      .query({ dashboardOnly: true })
      .set(authHeader(head.token));
    const adminList = await request(app)
      .get("/api/centers")
      .query({ dashboardOnly: true, provinceId: otherProvinceId })
      .set(authHeader(admin.token));

    expect(coordinatorList.status).toBe(200);
    expect(coordinatorList.body.map((center: { id: number }) => center.id)).toContain(centerId);
    expect(coordinatorList.body.map((center: { id: number }) => center.id)).not.toContain(otherCenterId);
    expect(headList.status).toBe(200);
    expect(headList.body.map((center: { id: number }) => center.id)).toEqual([centerId]);
    expect(adminList.status).toBe(200);
    expect(adminList.body.map((center: { id: number }) => center.id)).toEqual([otherCenterId]);
  });

  it("lists only active teachers in the same family and province counted by the panel", async () => {
    const provinceId = await createProvince();
    const otherProvinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const nonFamilyCenterId = await createCenter(provinceId);
    const otherCenterId = await createCenter(otherProvinceId);
    await db
      .update(centersTable)
      .set({ families: ["otra familia"] })
      .where(eq(centersTable.id, nonFamilyCenterId));

    const coordinator = await createUser({
      role: "coordinator",
      provinceId,
    });
    const active = await createUser({ role: "teacher", centerId });
    await createUser({ role: "teacher", centerId, status: "inactive" });
    await createUser({ role: "teacher", centerId: nonFamilyCenterId });
    await createUser({ role: "teacher", centerId: otherCenterId });

    const response = await request(app)
      .get("/api/users/management")
      .query({ role: "teacher", status: "active", provinceId, pageSize: 100 })
      .set(authHeader(coordinator.token));

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(1);
    expect(response.body.users.map((user: { id: number }) => user.id)).toEqual([
      active.user.id,
    ]);
  });

  it("keeps dashboard drilldowns empty for accounts without a read scope", async () => {
    const unscoped = await createUser({ role: "prospector" });
    const headers = authHeader(unscoped.token);

    const centers = await request(app)
      .get("/api/centers")
      .query({ dashboardOnly: true })
      .set(headers);
    const events = await request(app).get("/api/events").set(headers);
    const alerts = await request(app).get("/api/company-alerts").set(headers);
    const surveys = await request(app).get("/api/surveys").set(headers);

    expect(centers.status).toBe(200);
    expect(centers.body).toEqual([]);
    expect(events.status).toBe(200);
    expect(events.body).toEqual([]);
    expect(alerts.status).toBe(200);
    expect(alerts.body).toEqual([]);
    expect(surveys.status).toBe(200);
    expect(surveys.body).toEqual([]);
    const summary = await request(app).get("/api/dashboard/summary").set(headers);
    expect(summary.status).toBe(200);
    expect(Object.values(summary.body).every((value) => value === 0)).toBe(true);
  });
});
