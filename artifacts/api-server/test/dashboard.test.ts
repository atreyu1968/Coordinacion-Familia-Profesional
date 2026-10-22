import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import {
  authHeader,
  cleanup,
  createCenter,
  createProvince,
  createUser,
} from "./helpers";

afterAll(cleanup);

describe("dashboard data", () => {
  it("counts active users in the active-family footprint and excludes inactive accounts", async () => {
    const admin = await createUser({ role: "superadmin" });
    const headers = authHeader(admin.token);

    const beforeSummary = await request(app)
      .get("/api/dashboard/summary")
      .set(headers);
    const beforeStatistics = await request(app)
      .get("/api/dashboard/statistics")
      .set(headers);

    expect(beforeSummary.status).toBe(200);
    expect(beforeStatistics.status).toBe(200);

    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    await createUser({ centerId, role: "teacher" });
    await createUser({ centerId, role: "teacher", status: "inactive" });

    const afterSummary = await request(app)
      .get("/api/dashboard/summary")
      .set(headers);
    const afterStatistics = await request(app)
      .get("/api/dashboard/statistics")
      .set(headers);

    expect(afterSummary.status).toBe(200);
    expect(afterStatistics.status).toBe(200);
    expect(afterSummary.body.teachers - beforeSummary.body.teachers).toBe(1);

    const teachersBefore = beforeStatistics.body.usersByRole.find(
      (item: { label: string }) => item.label === "Profesorado",
    )?.value ?? 0;
    const teachersAfter = afterStatistics.body.usersByRole.find(
      (item: { label: string }) => item.label === "Profesorado",
    )?.value ?? 0;
    expect(teachersAfter - teachersBefore).toBe(1);
  });
});
