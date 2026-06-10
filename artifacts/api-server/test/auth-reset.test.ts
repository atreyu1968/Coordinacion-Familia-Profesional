import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, passwordResetTokensTable } from "@workspace/db";
import app from "../src/app";
import { hashPassword } from "../src/lib/auth";
import { createUser, cleanup, DEFAULT_PASSWORD } from "./helpers";

afterAll(async () => {
  await cleanup();
});

// Seeds a reset token directly (bypassing the emailed code, which is hashed and
// never returned by the API) so we can exercise the reset-password flow.
async function seedToken(
  userId: number,
  code: string,
  opts: { expiresInMs?: number; attempts?: number } = {},
): Promise<number> {
  const codeHash = await hashPassword(code);
  const [row] = await db
    .insert(passwordResetTokensTable)
    .values({
      userId,
      codeHash,
      attempts: opts.attempts ?? 0,
      expiresAt: new Date(Date.now() + (opts.expiresInMs ?? 15 * 60 * 1000)),
    })
    .returning();
  return row!.id;
}

async function latestToken(userId: number) {
  const [row] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.userId, userId))
    .orderBy(desc(passwordResetTokensTable.createdAt))
    .limit(1);
  return row;
}

describe("POST /api/auth/forgot-password", () => {
  it("returns 200 for an unknown email (no user enumeration)", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "does-not-exist@example.test" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("creates a reset token for an existing active user", async () => {
    const { email, user } = await createUser({ role: "teacher" });
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const token = await latestToken(user.id);
    expect(token).toBeTruthy();
    expect(token!.usedAt).toBeNull();
  });

  it("invalidates previous unused codes when requesting a new one", async () => {
    const { email, user } = await createUser({ role: "teacher" });
    await seedToken(user.id, "111111");

    await request(app).post("/api/auth/forgot-password").send({ email });

    const unused = await db
      .select()
      .from(passwordResetTokensTable)
      .where(
        and(
          eq(passwordResetTokensTable.userId, user.id),
          isNull(passwordResetTokensTable.usedAt),
        ),
      );
    // Only the freshly generated token should remain unused.
    expect(unused).toHaveLength(1);
  });
});

describe("POST /api/auth/reset-password", () => {
  it("changes the password with a valid code and lets the user log in", async () => {
    const { email, user } = await createUser({ role: "teacher" });
    await seedToken(user.id, "123456");
    const newPassword = "BrandNewPass1";

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code: "123456", newPassword });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    // Token is now single-use.
    const token = await latestToken(user.id);
    expect(token!.usedAt).not.toBeNull();

    // New password works.
    const okLogin = await request(app)
      .post("/api/auth/login")
      .send({ email, password: newPassword });
    expect(okLogin.status).toBe(200);

    // Old password no longer works.
    const badLogin = await request(app)
      .post("/api/auth/login")
      .send({ email, password: DEFAULT_PASSWORD });
    expect(badLogin.status).toBe(401);
  });

  it("rejects a wrong code with 400 and increments attempts", async () => {
    const { email, user } = await createUser({ role: "teacher" });
    await seedToken(user.id, "654321");

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code: "000000", newPassword: "Whatever123" });
    expect(res.status).toBe(400);

    const token = await latestToken(user.id);
    expect(token!.attempts).toBe(1);
    expect(token!.usedAt).toBeNull();
  });

  it("rejects an expired code", async () => {
    const { email, user } = await createUser({ role: "teacher" });
    await seedToken(user.id, "222222", { expiresInMs: -1000 });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code: "222222", newPassword: "Whatever123" });
    expect(res.status).toBe(400);
  });

  it("rejects a code that has exhausted its attempts", async () => {
    const { email, user } = await createUser({ role: "teacher" });
    await seedToken(user.id, "333333", { attempts: 5 });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code: "333333", newPassword: "Whatever123" });
    expect(res.status).toBe(400);
  });

  it("does not allow reusing a code after a successful reset", async () => {
    const { email, user } = await createUser({ role: "teacher" });
    await seedToken(user.id, "444444");

    const first = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code: "444444", newPassword: "FirstPass123" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code: "444444", newPassword: "SecondPass123" });
    expect(second.status).toBe(400);
  });

  it("validates the request body (short password)", async () => {
    const { email } = await createUser({ role: "teacher" });
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code: "123456", newPassword: "short" });
    expect(res.status).toBe(400);
  });
});
