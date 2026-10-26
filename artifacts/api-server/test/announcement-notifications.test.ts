import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, announcementsTable, notificationsTable, usersTable } from "@workspace/db";
import app from "../src/app";
import { sendPushToUsers } from "../src/lib/push";
import { createUser, createProvince, authHeader, cleanup } from "./helpers";

vi.mock("../src/lib/push", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/push")>(),
  sendPushToUsers: vi.fn(async () => {}),
}));
vi.mock("../src/lib/email", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/email")>(),
  sendEmail: vi.fn(async () => ({ sent: true })),
}));

const announcementIds: number[] = [];
afterEach(() => vi.clearAllMocks());
afterAll(async () => {
  if (announcementIds.length) {
    await db.delete(announcementsTable).where(inArray(announcementsTable.id, announcementIds));
  }
  await cleanup();
});

describe("announcement notifications", () => {
  it("persists notices and dispatches mobile push only to active provincial recipients", async () => {
    const provinceId = await createProvince();
    const author = await createUser({ role: "superadmin", provinceId });
    const recipient = await createUser({ provinceId });
    const outsider = await createUser({ provinceId: await createProvince() });
    const inactive = await createUser({ provinceId });
    const deleted = await createUser({ provinceId });
    await db.update(usersTable).set({ status: "inactive" }).where(eq(usersTable.id, inactive.user.id));
    await db.update(usersTable).set({ deletedAt: new Date() }).where(eq(usersTable.id, deleted.user.id));

    const response = await request(app).post("/api/announcements").set(authHeader(author.token)).send({
      title: "Aviso de coordinación", body: "Consulta el nuevo anuncio.",
      audienceType: "province", audienceIds: [provinceId],
    });
    expect(response.status).toBe(201);
    announcementIds.push(response.body.id);
    expect(response.body.notifiedCount).toBe(1);
    const notices = await db.select().from(notificationsTable).where(eq(notificationsTable.userId, recipient.user.id));
    expect(notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "announcement", title: "Aviso de coordinación", body: "Consulta el nuevo anuncio." }),
    ]));
    for (const excluded of [author, outsider, inactive, deleted]) {
      expect(await db.select().from(notificationsTable).where(eq(notificationsTable.userId, excluded.user.id))).toHaveLength(0);
    }
    expect(sendPushToUsers).toHaveBeenCalledExactlyOnceWith([recipient.user.id], {
      title: "Aviso de coordinación", body: "Consulta el nuevo anuncio.",
      data: {
        type: "announcement", announcementId: response.body.id,
        target: { kind: "announcement", id: response.body.id },
        path: `/?aviso=${response.body.id}`,
      },
    });
  });

  it("notifies selected people without broadcasting to the rest of the network", async () => {
    const author = await createUser({ role: "superadmin" });
    const recipient = await createUser();
    const outsider = await createUser();
    const response = await request(app).post("/api/announcements").set(authHeader(author.token)).send({
      title: "Anuncio dirigido", body: "Solo para las personas seleccionadas.",
      audienceType: "users", audienceIds: [author.user.id, recipient.user.id],
    });
    expect(response.status).toBe(201);
    announcementIds.push(response.body.id);
    expect(response.body.notifiedCount).toBe(1);
    expect(sendPushToUsers).toHaveBeenCalledWith([recipient.user.id], expect.objectContaining({
      data: expect.objectContaining({ type: "announcement", announcementId: response.body.id }),
    }));
    expect(await db.select().from(notificationsTable).where(eq(notificationsTable.userId, outsider.user.id))).toHaveLength(0);
  });
});
