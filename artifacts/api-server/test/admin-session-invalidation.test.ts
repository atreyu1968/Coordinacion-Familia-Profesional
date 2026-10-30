import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import app from "../src/app";
import { authHeader, cleanup, createUser } from "./helpers";

afterAll(async () => {
  await cleanup();
});

describe("admin session invalidation", () => {
  it("restricts the global invalidation action to superadministrators", async () => {
    const teacher = await createUser({ role: "teacher" });
    const denied = await request(app)
      .post("/api/admin/sessions/invalidate")
      .set(authHeader(teacher.token));
    expect(denied.status).toBe(403);
  });

  it("identifies sessions invalidated by a deployment", async () => {
    const teacher = await createUser({ role: "teacher" });
    await db.update(usersTable)
      .set({ sessionNonce: sql`gen_random_uuid()::text` })
      .where(eq(usersTable.id, teacher.user.id));

    const response = await request(app)
      .get("/api/auth/me")
      .set(authHeader(teacher.token));
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      code: "APP_UPDATED",
      message: expect.stringContaining("actualizado"),
    });
  });

  it("identifies sessions revoked by an administrator", async () => {
    const teacher = await createUser({ role: "teacher" });
    await db.update(usersTable)
      .set({ tokenVersion: sql`${usersTable.tokenVersion} + 1` })
      .where(eq(usersTable.id, teacher.user.id));

    const response = await request(app)
      .get("/api/auth/me")
      .set(authHeader(teacher.token));
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      code: "SESSION_REVOKED",
      message: expect.stringContaining("sesión"),
    });
  });
});
