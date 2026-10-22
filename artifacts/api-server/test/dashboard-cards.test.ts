import { afterAll, expect, it } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import { db, resourcesTable, eventsTable, surveysTable, companyAlertsTable } from "@workspace/db";
import app from "../src/app";
import { authHeader, cleanup, createCenter, createProvince, createUser } from "./helpers";

const ids = { resources: [] as number[], events: [] as number[], surveys: [] as number[], alerts: [] as number[] };
afterAll(async () => {
  if (ids.resources.length) await db.delete(resourcesTable).where(inArray(resourcesTable.id, ids.resources));
  if (ids.events.length) await db.delete(eventsTable).where(inArray(eventsTable.id, ids.events));
  if (ids.surveys.length) await db.delete(surveysTable).where(inArray(surveysTable.id, ids.surveys));
  if (ids.alerts.length) await db.delete(companyAlertsTable).where(inArray(companyAlertsTable.id, ids.alerts));
  await cleanup();
});

it("matches every card to its accessible records for administrators, coordinators and department heads", async () => {
  const provinceId = await createProvince();
  const otherProvince = await createProvince();
  const centerId = await createCenter(provinceId);
  const otherCenter = await createCenter(otherProvince);
  const admin = await createUser({ role: "superadmin" });
  const coordinator = await createUser({ role: "coordinator", provinceId });
  const head = await createUser({ role: "department_head", provinceId, centerId });
  await createUser({ role: "teacher", centerId });
  await createUser({ role: "teacher", centerId, status: "inactive" });
  await createUser({ role: "teacher", centerId: otherCenter });
  const date = new Date("2097-09-15T12:00:00Z");
  const outside = new Date("2097-08-31T23:59:59.999Z");
  const period = { startDate: "2097-09-01", endDate: "2097-09-30", provinceId };
  const inPeriod = (value: string | null | undefined) => {
    if (!value) return false;
    const day = new Date(value).toISOString().slice(0, 10);
    return day >= period.startDate && day <= period.endDate;
  };
  for (const data of [
    { centerId }, { centerId }, { centerId: otherCenter }, { centerId: null },
    { centerId, deletedAt: date }, { centerId, createdAt: outside },
  ]) {
    const [row] = await db.insert(resourcesTable).values({
      title: "card fixture", type: "document", createdAt: date, ...data,
    }).returning({ id: resourcesTable.id });
    ids.resources.push(row!.id);
  }
  for (const data of [
    { provinceId }, { provinceId }, { provinceId: null }, { provinceId: otherProvince },
    { provinceId, deletedAt: date }, { provinceId, startAt: outside }, { provinceId, startAt: null },
  ]) {
    const [row] = await db.insert(eventsTable).values({
      name: "card fixture", type: "jornada", createdAt: date, startAt: date, ...data,
    }).returning({ id: eventsTable.id });
    ids.events.push(row!.id);
  }
  for (const data of [
    { provinceId }, { provinceId }, { provinceId: null }, { provinceId: otherProvince },
    { provinceId, deletedAt: date }, { provinceId, createdAt: outside },
  ]) {
    const [row] = await db.insert(companyAlertsTable).values({
      companyName: "card fixture", createdAt: date, ...data,
    }).returning({ id: companyAlertsTable.id });
    ids.alerts.push(row!.id);
  }
  for (const data of [
    {}, { audienceType: "users", audienceIds: [head.user.id] },
    { audienceType: "users", audienceIds: [coordinator.user.id] },
    { status: "closed" }, { status: "draft", createdById: head.user.id },
    { deletedAt: date }, { createdAt: outside },
  ]) {
    const [row] = await db.insert(surveysTable).values({
      title: "card fixture", type: "survey", status: "open", createdAt: date, ...data,
    }).returning({ id: surveysTable.id });
    ids.surveys.push(row!.id);
  }
  for (const actor of [admin, coordinator, head]) {
    const headers = authHeader(actor.token);
    const summary = await request(app).get("/api/dashboard/summary").query(period).set(headers);
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({
      centers: 1, users: 3, resources: 2,
      activeSurveys: actor === admin ? 3 : 2, upcomingEvents: 4, companyAlerts: 3,
    });
    const centers = await request(app).get("/api/centers")
      .query({ dashboardOnly: true, provinceId }).set(headers);
    expect(centers.status).toBe(200);
    expect(centers.body).toHaveLength(summary.body.centers);
    const users = await request(app).get("/api/users/management")
      .query({ status: "active", provinceId, pageSize: 100 }).set(headers);
    expect(users.status).toBe(200);
    expect(users.body.total).toBe(summary.body.users);
    const resources = await request(app).get("/api/resources").query({ centerId }).set(headers);
    expect(resources.status).toBe(200);
    expect(resources.body.filter((row: { createdAt: string }) => inPeriod(row.createdAt))).toHaveLength(summary.body.resources);
    const surveys = await request(app).get("/api/surveys")
      .query({ status: "open", provinceId }).set(headers);
    expect(surveys.status).toBe(200);
    expect(surveys.body.filter((row: { createdAt: string }) => inPeriod(row.createdAt))).toHaveLength(summary.body.activeSurveys);
    const events = await request(app).get("/api/events").query({ provinceId }).set(headers);
    expect(events.status).toBe(200);
    expect(events.body.filter((row: { startAt: string | null; createdAt: string }) => inPeriod(row.startAt ?? row.createdAt))).toHaveLength(summary.body.upcomingEvents);
    const alerts = await request(app).get("/api/company-alerts").set(headers);
    expect(alerts.status).toBe(200);
    expect(alerts.body.filter((row: { provinceId: number | null; createdAt: string }) =>
      (row.provinceId == null || row.provinceId === provinceId) && inPeriod(row.createdAt))).toHaveLength(summary.body.companyAlerts);
    const stats = await request(app).get("/api/dashboard/statistics").query(period).set(headers);
    expect(stats.status).toBe(200);
    expect(stats.body.eventsByMonth).toContainEqual({ label: "2097-09", value: summary.body.upcomingEvents });
    expect(stats.body.surveysByStatus.find((row: { label: string }) => row.label === "Abierta")?.value).toBe(summary.body.activeSurveys);
    if (actor === coordinator) expect(stats.body.surveysByStatus.some((row: { label: string }) => row.label === "Borrador")).toBe(false);
    const upcoming = await request(app).get("/api/dashboard/summary").query({ provinceId }).set(headers);
    expect(upcoming.status).toBe(200);
    expect(upcoming.body.upcomingEvents).toBe(events.body.filter((row: { startAt: string | null }) =>
      row.startAt != null && new Date(row.startAt).getTime() >= Date.now()).length);
  }
});
