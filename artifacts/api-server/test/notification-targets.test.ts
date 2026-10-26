import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, pool, eventsTable, calendarEntriesTable, notificationsTable } from "@workspace/db";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import app from "../src/app";
import { notifyUsers } from "../src/lib/notify";
import { notificationTarget, validNotificationTarget } from "../src/lib/notificationTarget";
import { withPushPath } from "../src/lib/push";
import { createUser, createProvince, authHeader, cleanup } from "./helpers";

vi.mock("../src/lib/push", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/push")>(),
  sendPushToUsers: vi.fn(async () => {}),
}));

const eventIds: number[] = [];
afterAll(async () => {
  if (eventIds.length) {
    await db.delete(calendarEntriesTable).where(inArray(calendarEntriesTable.eventId, eventIds));
    await db.delete(eventsTable).where(inArray(eventsTable.id, eventIds));
  }
  await cleanup();
});

describe("notification destinations", () => {
  it("accepts only known identifiers and discards arbitrary data and URLs", () => {
    expect(notificationTarget("event", { eventId: 12, url: "https://external.invalid" })).toEqual({ kind: "event", id: 12 });
    expect(notificationTarget("certificate", { eventId: 7 })).toEqual({ kind: "certificate_event", id: 7 });
    expect(notificationTarget("year_confirmation", { schoolYear: "2026" })).toBeNull();
    for (const id of [0, -1, 2.5, 2147483648, "../login", "3", NaN]) {
      expect(notificationTarget("event", { eventId: id })).toBeNull();
      expect(validNotificationTarget({ kind: "event", id })).toBeNull();
    }
    expect(validNotificationTarget({ kind: "https://external.invalid", id: 1 })).toBeNull();
    expect(withPushPath({ title: "Test", data: { type: "event", target: { kind: "event", id: 12 }, path: "//external.invalid" } }).data?.path).toBe("/eventos?aviso=12");
  });

  it("preserves legacy rows and is repeatable in an isolated schema", async () => {
    const client = await pool.connect();
    const schema = `notice_migration_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      await client.query("CREATE TABLE notifications (id serial PRIMARY KEY, title text, read_at timestamptz)");
      await client.query("INSERT INTO notifications (title, read_at) VALUES ('legacy', '2026-01-01T00:00:00Z')");
      const before = (await client.query("SELECT * FROM notifications")).rows[0];
      const sql = readFileSync(new URL("../../../deploy/migrations/notification-targets.sql", import.meta.url), "utf8");
      await client.query(sql);
      await client.query(sql);
      expect((await client.query("SELECT * FROM notifications")).rows).toEqual([{ ...before, target: null }]);
    } finally {
      await client.query("RESET search_path");
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      client.release();
    }
  });

  it("round-trips targets, isolates each inbox, and never grants resource access", async () => {
    const provinceId = await createProvince();
    const owner = await createUser({ role: "coordinator", provinceId });
    const recipient = await createUser({ provinceId });
    const outsider = await createUser({ provinceId: await createProvince() });
    const created = await request(app).post("/api/events").set(authHeader(owner.token))
      .send({ name: "Notification destination", type: "jornada", provinceId });
    expect(created.status).toBe(201);
    eventIds.push(created.body.id);
    const target = { kind: "event", id: created.body.id };
    const saved = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, recipient.user.id));
    const notice = saved.find((row) => row.target?.id === target.id);
    expect(notice?.target).toEqual(target);
    const listed = await request(app).get("/api/notifications").set(authHeader(recipient.token));
    expect(listed.body.find((item: { id: number }) => item.id === notice!.id)?.target).toEqual(target);
    const others = await request(app).get("/api/notifications").set(authHeader(outsider.token));
    expect(others.body.some((item: { id: number }) => item.id === notice!.id)).toBe(false);
    await request(app).post(`/api/notifications/${notice!.id}/read`).set(authHeader(outsider.token)).expect(200);
    const unchanged = await db.select().from(notificationsTable).where(eq(notificationsTable.id, notice!.id));
    expect(unchanged[0].readAt).toBeNull();
    await request(app).post(`/api/notifications/${notice!.id}/read`).set(authHeader(recipient.token)).expect(200);
    const marked = await db.select().from(notificationsTable).where(eq(notificationsTable.id, notice!.id));
    expect(marked[0].readAt).not.toBeNull();
    // Even possession of a notice is not a capability to read an out-of-scope event.
    await notifyUsers([outsider.user.id], { title: "Stale permissions", type: "event", data: { eventId: target.id } });
    expect([403, 404]).toContain((await request(app).get(`/api/events/${target.id}`).set(authHeader(outsider.token))).status);
    await request(app).delete(`/api/events/${target.id}`).set(authHeader(owner.token)).expect(204);
    expect((await request(app).get(`/api/events/${target.id}`).set(authHeader(recipient.token))).status).toBe(404);
    await notifyUsers([recipient.user.id], { title: "Legacy", type: "event" });
    const historical = await request(app).get("/api/notifications").set(authHeader(recipient.token));
    expect(historical.body.find((item: { title: string }) => item.title === "Legacy")?.target).toBeNull();
  });
});
