import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import {
  db,
  centersTable,
  companyAlertsTable,
  eventsTable,
  resourcesTable,
  surveysTable,
  usersTable,
} from "@workspace/db";
import app from "../src/app";
import {
  authHeader,
  cleanup,
  createCenter,
  createProvince,
  createUser,
} from "./helpers";

const resourceIds: number[] = [];
const eventIds: number[] = [];
const surveyIds: number[] = [];
const alertIds: number[] = [];

afterAll(async () => {
  if (eventIds.length > 0) {
    await db.delete(eventsTable).where(inArray(eventsTable.id, eventIds));
  }
  if (resourceIds.length > 0) {
    await db.delete(resourcesTable).where(inArray(resourcesTable.id, resourceIds));
  }
  if (surveyIds.length > 0) {
    await db.delete(surveysTable).where(inArray(surveysTable.id, surveyIds));
  }
  if (alertIds.length > 0) {
    await db.delete(companyAlertsTable).where(inArray(companyAlertsTable.id, alertIds));
  }
  await cleanup();
});

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

  it("applies inclusive date boundaries and keeps the caller's center scope", async () => {
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const otherCenterId = await createCenter(provinceId);
    const admin = await createUser({ role: "superadmin" });
    const teacher = await createUser({ role: "teacher", centerId });
    const period = { startDate: "2098-09-01", endDate: "2098-09-30" };
    await db
      .update(centersTable)
      .set({ createdAt: new Date("2098-09-01T00:00:00.000Z") })
      .where(inArray(centersTable.id, [centerId, otherCenterId]));
    await db
      .update(usersTable)
      .set({ createdAt: new Date("2098-09-01T00:00:00.000Z") })
      .where(inArray(usersTable.id, [teacher.user.id]));

    const insertResource = async (center: number, createdAt: string) => {
      const [row] = await db
        .insert(resourcesTable)
        .values({
          title: "dashboard period fixture",
          type: "document",
          centerId: center,
          createdAt: new Date(createdAt),
        })
        .returning({ id: resourcesTable.id });
      resourceIds.push(row!.id);
    };
    await insertResource(centerId, "2098-09-01T00:00:00.000Z");
    await insertResource(centerId, "2098-09-30T23:59:59.999Z");
    await insertResource(centerId, "2098-08-31T23:59:59.999Z");
    await insertResource(centerId, "2098-10-01T00:00:00.000Z");
    await insertResource(otherCenterId, "2098-09-15T12:00:00.000Z");

    const insertEvent = async (startAt: string) => {
      const [row] = await db
        .insert(eventsTable)
        .values({
          name: "dashboard period fixture",
          type: "jornada",
          startAt: new Date(startAt),
        })
        .returning({ id: eventsTable.id });
      eventIds.push(row!.id);
    };
    await insertEvent("2098-09-01T00:00:00.000Z");
    await insertEvent("2098-09-30T23:59:59.999Z");
    await insertEvent("2098-10-01T00:00:00.000Z");

    const [survey] = await db
      .insert(surveysTable)
      .values({
        title: "dashboard period fixture",
        type: "survey",
        status: "open",
        createdAt: new Date("2098-09-30T23:59:59.999Z"),
      })
      .returning({ id: surveysTable.id });
    surveyIds.push(survey!.id);
    const [alert] = await db
      .insert(companyAlertsTable)
      .values({
        companyName: "dashboard period fixture",
        createdAt: new Date("2098-09-30T23:59:59.999Z"),
      })
      .returning({ id: companyAlertsTable.id });
    alertIds.push(alert!.id);

    const summary = await request(app)
      .get("/api/dashboard/summary")
      .query(period)
      .set(authHeader(admin.token));
    const statistics = await request(app)
      .get("/api/dashboard/statistics")
      .query(period)
      .set(authHeader(admin.token));

    expect(summary.status).toBe(200);
    expect(summary.body.centers).toBe(2);
    expect(summary.body.teachers).toBe(1);
    expect(summary.body.resources).toBe(3);
    expect(summary.body.activeSurveys).toBe(1);
    expect(summary.body.upcomingEvents).toBe(2);
    expect(summary.body.companyAlerts).toBe(1);
    expect(statistics.status).toBe(200);
    expect(statistics.body.resourcesByMonth).toContainEqual({
      label: "2098-09",
      value: 3,
    });
    expect(statistics.body.eventsByMonth).toContainEqual({
      label: "2098-09",
      value: 2,
    });
    expect(statistics.body.eventsByMonth).not.toContainEqual({
      label: "2098-10",
      value: 1,
    });
    expect(statistics.body.usersByRole).toContainEqual({
      label: "Profesorado",
      value: 1,
    });
    expect(statistics.body.centersByIsland).toContainEqual({
      label: "Sin isla",
      value: 2,
    });
    expect(statistics.body.surveysByStatus).toContainEqual({
      label: "Abierta",
      value: 1,
    });

    const scopedSummary = await request(app)
      .get("/api/dashboard/summary")
      .query(period)
      .set(authHeader(teacher.token));
    expect(scopedSummary.status).toBe(200);
    expect(scopedSummary.body.resources).toBe(2);
  });

  it("rejects incomplete, impossible, and reversed date ranges", async () => {
    const admin = await createUser({ role: "superadmin" });
    const headers = authHeader(admin.token);

    const incomplete = await request(app)
      .get("/api/dashboard/summary")
      .query({ startDate: "2025-09-01" })
      .set(headers);
    const impossible = await request(app)
      .get("/api/dashboard/summary")
      .query({ startDate: "2025-02-30", endDate: "2025-03-01" })
      .set(headers);
    const reversed = await request(app)
      .get("/api/dashboard/statistics")
      .query({ startDate: "2025-09-02", endDate: "2025-09-01" })
      .set(headers);

    expect(incomplete.status).toBe(400);
    expect(impossible.status).toBe(400);
    expect(reversed.status).toBe(400);
  });
});
