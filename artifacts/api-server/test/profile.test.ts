import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { createUser, cleanup, authHeader, DEFAULT_PASSWORD } from "./helpers";

afterAll(async () => {
  await cleanup();
});

describe("PATCH /api/auth/me", () => {
  it("requires authentication", async () => {
    const res = await request(app).patch("/api/auth/me").send({ name: "X" });
    expect(res.status).toBe(401);
  });

  it("updates name and email", async () => {
    const { token } = await createUser({ role: "teacher" });
    const newEmail = `updated-${Date.now()}@example.test`;
    const res = await request(app)
      .patch("/api/auth/me")
      .set(authHeader(token))
      .send({ name: "Nombre Nuevo", email: newEmail });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Nombre Nuevo");
    expect(res.body.email).toBe(newEmail);
    expect(res.body.passwordHash).toBeUndefined();
  });

  it("allows keeping the same email (self not treated as duplicate)", async () => {
    const { token, email } = await createUser({ role: "teacher" });
    const res = await request(app)
      .patch("/api/auth/me")
      .set(authHeader(token))
      .send({ name: "Mismo Correo", email: email.toUpperCase() });
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email.toLowerCase());
  });

  it("rejects a duplicate email", async () => {
    const a = await createUser({ role: "teacher" });
    const b = await createUser({ role: "teacher" });
    const res = await request(app)
      .patch("/api/auth/me")
      .set(authHeader(b.token))
      .send({ email: a.email });
    expect(res.status).toBe(400);
  });

  it("changes the password when current password is correct", async () => {
    const { token, email } = await createUser({ role: "teacher" });
    const newPassword = "BrandNewPass!9";
    const res = await request(app)
      .patch("/api/auth/me")
      .set(authHeader(token))
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword });
    expect(res.status).toBe(200);

    const ok = await request(app)
      .post("/api/auth/login")
      .send({ email, password: newPassword });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
  });

  it("rejects a wrong current password", async () => {
    const { token } = await createUser({ role: "teacher" });
    const res = await request(app)
      .patch("/api/auth/me")
      .set(authHeader(token))
      .send({ currentPassword: "wrong-password", newPassword: "BrandNewPass!9" });
    expect(res.status).toBe(400);
  });

  it("requires the current password to set a new one", async () => {
    const { token } = await createUser({ role: "teacher" });
    const res = await request(app)
      .patch("/api/auth/me")
      .set(authHeader(token))
      .send({ newPassword: "BrandNewPass!9" });
    expect(res.status).toBe(400);
  });
});
