import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { inArray } from "drizzle-orm";
import {
  db, eventsTable, eventStaffTable, eventAccreditationsTable,
} from "@workspace/db";
import app from "../src/app";
import { authHeader, cleanup, createProvince, createUser } from "./helpers";

const eventIds: number[] = [];
let globalEventId: number;
let provincialEventId: number;
let teacher: Awaited<ReturnType<typeof createUser>>;
let staff: Awaited<ReturnType<typeof createUser>>;
let admin: Awaited<ReturnType<typeof createUser>>;
let coordinator: Awaited<ReturnType<typeof createUser>>;
let otherCoordinator: Awaited<ReturnType<typeof createUser>>;

beforeAll(async () => {
  const provinceId = await createProvince();
  const otherProvinceId = await createProvince();
  teacher = await createUser({ role: "teacher", provinceId });
  staff = await createUser({ role: "teacher", provinceId });
  admin = await createUser({ role: "superadmin" });
  coordinator = await createUser({ role: "coordinator", provinceId });
  otherCoordinator = await createUser({ role: "coordinator", provinceId: otherProvinceId });
  for (const province of [null, provinceId]) {
    const [event] = await db.insert(eventsTable).values({
      name: `Accreditation regression ${Date.now()}`,
      type: "other", provinceId: province,
    }).returning();
    eventIds.push(event!.id);
    await db.insert(eventAccreditationsTable).values({
      eventId: event!.id, holderName: "Test attendee",
      holderEmail: "attendee@example.test", role: "participant",
      qrToken: `test-pass-${event!.id}-${Date.now()}`,
    });
  }
  [globalEventId, provincialEventId] = eventIds as [number, number];
  await db.insert(eventStaffTable).values({ eventId: globalEventId, userId: staff.user.id });
});

afterAll(async () => {
  if (eventIds.length) {
    await db.delete(eventStaffTable).where(inArray(eventStaffTable.eventId, eventIds));
    await db.delete(eventAccreditationsTable).where(inArray(eventAccreditationsTable.eventId, eventIds));
    await db.delete(eventsTable).where(inArray(eventsTable.id, eventIds));
  }
  await cleanup();
});

const list = (id: number, token: string) =>
  request(app).get(`/api/events/${id}/accreditations`).set(authHeader(token));

describe("event accreditation confidentiality", () => {
  it("requires authentication", async () => {
    expect((await request(app).get(`/api/events/${globalEventId}/accreditations`)).status).toBe(401);
  });
  it("does not disclose attendee emails or QR passes to ordinary event viewers", async () => {
    const response = await list(globalEventId, teacher.token);
    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).not.toContain("attendee@example.test");
    expect(JSON.stringify(response.body)).not.toContain("test-pass-");
  });
  it("allows superadmins and explicitly assigned event staff", async () => {
    for (const token of [admin.token, staff.token]) {
      const response = await list(globalEventId, token);
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
    }
  });
  it("restricts coordinators to their own provincial event unless assigned as staff", async () => {
    expect((await list(provincialEventId, coordinator.token)).status).toBe(200);
    expect((await list(provincialEventId, otherCoordinator.token)).status).toBe(403);
    expect((await list(globalEventId, coordinator.token)).status).toBe(403);
  });
});
