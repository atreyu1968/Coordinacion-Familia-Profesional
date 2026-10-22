import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, eventsTable, calendarEntriesTable, notificationsTable } from "@workspace/db";
import app from "../src/app";
import { createUser, createProvince, authHeader, cleanup } from "./helpers";

const eventIds: number[] = [];
afterAll(async () => {
  if (eventIds.length) {
    await db.delete(calendarEntriesTable).where(inArray(calendarEntriesTable.eventId, eventIds));
    await db.delete(eventsTable).where(inArray(eventsTable.id, eventIds));
  }
  await cleanup();
});
describe("event mobile notifications", () => {
  it("notifies the audience when an event is created, updated and cancelled", async () => {
    const provinceId = await createProvince();
    const admin = await createUser({ role: "superadmin", provinceId });
    const member = await createUser({ provinceId });
    const outsider = await createUser({ provinceId: await createProvince() });
    const created = await request(app).post("/api/events").set(authHeader(admin.token))
      .send({ name: "Evento para avisos", type: "other", provinceId });
    expect(created.status).toBe(201);
    eventIds.push(created.body.id);
    const updated = await request(app).patch(`/api/events/${created.body.id}`).set(authHeader(admin.token))
      .send({ name: "Evento actualizado para avisos" });
    expect(updated.status).toBe(200);
    expect((await request(app).delete(`/api/events/${created.body.id}`).set(authHeader(admin.token))).status).toBe(204);
    const notices = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, member.user.id));
    expect(notices.filter((notice) => notice.type === "event")).toHaveLength(3);
    expect(notices.some((notice) => notice.title.startsWith("Nuevo evento:"))).toBe(true);
    expect(notices.some((notice) => notice.title.startsWith("Evento actualizado:"))).toBe(true);
    expect(notices.some((notice) => notice.title.startsWith("Evento cancelado:"))).toBe(true);
    expect(await db.select().from(notificationsTable).where(eq(notificationsTable.userId, outsider.user.id))).toHaveLength(0);
  });
});
