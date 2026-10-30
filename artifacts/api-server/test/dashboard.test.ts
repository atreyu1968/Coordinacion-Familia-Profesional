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
  it("counts all active user roles even when there are no teacher-role accounts", async () => {
    const provinceId = await createProvince();
    const otherProvince = await createProvince();
    const centerId = await createCenter(provinceId);
    const admin = await createUser({ role: "superadmin" });
    await createUser({ role: "department_head", centerId, provinceId });
    await createUser({ role: "coordinator", provinceId });
    await createUser({ role: "department_head", centerId, provinceId, status: "inactive" });
    await createUser({ role: "coordinator", provinceId: otherProvince });
    const filters = { provinceId, startDate: "2099-09-01", endDate: "2100-08-31" };
    const summary = await request(app).get("/api/dashboard/summary")
      .query(filters).set(authHeader(admin.token));
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ users: 2, teachers: 0 });
    const stats = await request(app).get("/api/dashboard/statistics")
      .query(filters).set(authHeader(admin.token));
    expect(stats.status).toBe(200);
    expect(stats.body.usersByRole.reduce((total: number, row: { value: number }) => total + row.value, 0)).toBe(summary.body.users);
    const directory = await request(app).get("/api/users/management")
      .query({ provinceId, status: "active", pageSize: 100 }).set(authHeader(admin.token));
    expect(directory.status).toBe(200);
    expect(directory.body.users).toHaveLength(summary.body.users);
  });

  it("reflects account status changes and retired centers on the next read, even with a course filter", async () => {
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const admin = await createUser({ role: "superadmin" });
    const teacher = await createUser({ role: "teacher", centerId });
    const unassigned = await createUser({ role: "teacher", provinceId, centerId: null });
    const filters = { provinceId, startDate: "2099-09-01", endDate: "2100-08-31" };
    const summary = () => request(app).get("/api/dashboard/summary").query(filters).set(authHeader(admin.token));
    const initial = await summary();
    expect(initial.status).toBe(200);
    expect(initial.body).toMatchObject({ centers: 1, teachers: 2 });
    await db.update(usersTable).set({ status: "inactive" }).where(inArray(usersTable.id, [teacher.user.id]));
    expect((await summary()).body.teachers).toBe(1);
    await db.update(usersTable).set({ status: "active" }).where(inArray(usersTable.id, [teacher.user.id]));
    expect((await summary()).body.teachers).toBe(2);
    await db.update(centersTable).set({ families: [] }).where(inArray(centersTable.id, [centerId]));
    expect((await summary()).body).toMatchObject({ centers: 0, teachers: 1 });
    const chart = await request(app).get("/api/dashboard/statistics").query(filters).set(authHeader(admin.token));
    expect(chart.body.usersByRole).toContainEqual({ label: "Profesorado", value: 1 });
    const directory = await request(app).get("/api/users/management")
      .query({ provinceId, role: "teacher", status: "active" }).set(authHeader(admin.token));
    expect(directory.status).toBe(200);
    expect(directory.body.total).toBe(1);
    expect(directory.body.users.map((user: { id: number }) => user.id)).toEqual([unassigned.user.id]);
  });

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
    await createUser({ provinceId, role: "teacher", centerId: null });
    await createUser({ centerId, role: "teacher", status: "inactive" });

    const afterSummary = await request(app)
      .get("/api/dashboard/summary")
      .set(headers);
    const afterStatistics = await request(app)
      .get("/api/dashboard/statistics")
      .set(headers);

    expect(afterSummary.status).toBe(200);
    expect(afterStatistics.status).toBe(200);
    expect(afterSummary.body.teachers - beforeSummary.body.teachers).toBe(2);
    expect(afterSummary.headers["cache-control"]).toBe("private, no-store");
    expect(afterStatistics.headers["cache-control"]).toBe("private, no-store");

    const teachersBefore = beforeStatistics.body.usersByRole.find(
      (item: { label: string }) => item.label === "Profesorado",
    )?.value ?? 0;
    const teachersAfter = afterStatistics.body.usersByRole.find(
      (item: { label: string }) => item.label === "Profesorado",
    )?.value ?? 0;
    expect(teachersAfter - teachersBefore).toBe(2);
  });

  it("applies inclusive dates with family-wide teacher population totals and scoped manager totals", async () => {
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const otherCenterId = await createCenter(provinceId);
    const olderCenterId = await createCenter(provinceId);
    const olderTeacher = await createUser({ role: "teacher", centerId: olderCenterId });
    await db.update(centersTable).set({ createdAt: new Date("2000-01-01T00:00:00Z") })
      .where(inArray(centersTable.id, [olderCenterId]));
    await db.update(usersTable).set({ createdAt: new Date("2000-01-01T00:00:00Z") })
      .where(inArray(usersTable.id, [olderTeacher.user.id]));
    const admin = await createUser({ role: "superadmin" });
    const teacher = await createUser({ role: "teacher", centerId });
    const period = { startDate: "2098-09-01", endDate: "2098-09-30", provinceId };
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
    expect(summary.body.centers).toBe(3);
    expect(summary.body.teachers).toBe(2);
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
      value: 2,
    });
    expect(statistics.body.centersByIsland).toContainEqual({
      label: "Sin isla",
      value: 3,
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
    const familySummary = await request(app).get("/api/dashboard/summary")
      .query({ startDate: period.startDate, endDate: period.endDate })
      .set(authHeader(admin.token));
    for (const field of ["centers", "users", "teachers", "resources"]) {
      expect(scopedSummary.body[field]).toBe(familySummary.body[field]);
    }
    const head = await createUser({ role: "department_head", centerId, provinceId });
    const headSummary = await request(app).get("/api/dashboard/summary")
      .query(period).set(authHeader(head.token));
    expect(headSummary.status).toBe(200);
    expect(headSummary.body).toMatchObject({
      centers: familySummary.body.centers,
      users: familySummary.body.users + 1,
      teachers: familySummary.body.teachers,
      resources: familySummary.body.resources,
    });
  });

  it.each(["teacher", "department_head"] as const)("aligns %s cards, charts and directory links across family centers and provinces", async (role) => {
    const province = await createProvince();
    const center = await createCenter(province);
    const teacher = await createUser({ role, centerId: center, provinceId: province });
    const headers = authHeader(teacher.token);
    const period = { startDate: "2097-02-01", endDate: "2097-02-28" };
    const before = await request(app).get("/api/dashboard/summary").query(period).set(headers);
    const otherProvince = await createProvince();
    const otherCenter = await createCenter(otherProvince);
    const outsideCenter = await createCenter(otherProvince);
    await db.update(centersTable).set({ families: ["excluded-dashboard-test-family"] })
      .where(inArray(centersTable.id, [outsideCenter]));
    const colleague = await createUser({ centerId: otherCenter, provinceId: otherProvince });
    const teachingOnly = await createUser({ centerId: null });
    await db.update(usersTable).set({ teachingCenterId: otherCenter })
      .where(inArray(usersTable.id, [teachingOnly.user.id]));
    const outside = await createUser({ centerId: outsideCenter });
    const outsideTeachingOnly = await createUser({ centerId: null });
    await db.update(usersTable).set({ teachingCenterId: outsideCenter })
      .where(inArray(usersTable.id, [outsideTeachingOnly.user.id]));
    const resources = await db.insert(resourcesTable).values(
      [otherCenter, outsideCenter].map((centerId) => ({
        title: "Family dashboard resource",
        type: "document" as const,
        centerId,
        createdAt: new Date("2097-02-15T12:00:00Z"),
      })),
    ).returning({ id: resourcesTable.id });
    resourceIds.push(...resources.map((row) => row.id));
    for (const provinceId of [province, otherProvince]) {
      const [event] = await db.insert(eventsTable).values({
        name: "Dashboard activity access fixture",
        type: "jornada",
        provinceId,
        startAt: new Date("2097-02-15T12:00:00Z"),
      }).returning({ id: eventsTable.id });
      eventIds.push(event!.id);
      const [alert] = await db.insert(companyAlertsTable).values({
        companyName: "Dashboard activity access fixture",
        provinceId,
        createdAt: new Date("2097-02-15T12:00:00Z"),
      }).returning({ id: companyAlertsTable.id });
      alertIds.push(alert!.id);
    }
    for (const restricted of [false, true]) {
      const [survey] = await db.insert(surveysTable).values({
        title: "Dashboard audience fixture",
        type: "survey",
        status: "open",
        ...(restricted ? { audienceType: "users", audienceIds: [outside.user.id] } : {}),
        createdAt: new Date("2097-02-15T12:00:00Z"),
      }).returning({ id: surveysTable.id });
      surveyIds.push(survey!.id);
    }

    const summary = await request(app).get("/api/dashboard/summary").query(period).set(headers);
    const statistics = await request(app).get("/api/dashboard/statistics").query(period).set(headers);
    const centers = await request(app).get("/api/centers").query({ dashboardOnly: true }).set(headers);
    const directory = await request(app).get("/api/users/family-directory").set(headers);
    for (const response of [before, summary, statistics, centers, directory]) expect(response.status).toBe(200);
    expect(summary.body.centers - before.body.centers).toBe(1);
    expect(summary.body.users - before.body.users).toBe(2);
    expect(summary.body.resources - before.body.resources).toBe(1);
    // Family-wide totals must not widen access to activities or private audiences.
    expect(summary.body.upcomingEvents - before.body.upcomingEvents).toBe(1);
    expect(summary.body.companyAlerts - before.body.companyAlerts).toBe(1);
    expect(summary.body.activeSurveys - before.body.activeSurveys).toBe(1);
    expect(centers.body.map((row: { id: number }) => row.id)).toContain(otherCenter);
    expect(centers.body.map((row: { id: number }) => row.id)).not.toContain(outsideCenter);
    const visibleIds = directory.body.map((row: { id: number }) => row.id);
    expect(visibleIds).toContain(colleague.user.id);
    expect(visibleIds).toContain(teachingOnly.user.id);
    expect(visibleIds).not.toContain(outside.user.id);
    expect(visibleIds).not.toContain(outsideTeachingOnly.user.id);
    expect(summary.body.centers).toBe(centers.body.length);
    expect(summary.body.users).toBe(directory.body.length);
    const total = (rows: { value: number }[]) => rows.reduce((sum, row) => sum + row.value, 0);
    expect(total(statistics.body.usersByRole)).toBe(summary.body.users);
    expect(total(statistics.body.centersByIsland)).toBe(summary.body.centers);
    expect(total(statistics.body.resourcesByMonth)).toBe(summary.body.resources);
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
