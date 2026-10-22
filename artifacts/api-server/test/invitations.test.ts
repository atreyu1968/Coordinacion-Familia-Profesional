import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, invitationsTable, usersTable } from "@workspace/db";
import app from "../src/app";
import { generateInvitationCode } from "../src/lib/auth";
import { authHeader, cleanup, createUser, createCenter, createProvince, DEFAULT_PASSWORD } from "./helpers";

const invitationIds: number[] = [];
const registeredUserIds: number[] = [];
let sequence = 0;

afterAll(async () => {
  if (invitationIds.length) {
    await db.delete(invitationsTable).where(inArray(invitationsTable.id, invitationIds));
  }
  if (registeredUserIds.length) {
    await db.delete(usersTable).where(inArray(usersTable.id, registeredUserIds));
  }
  await cleanup();
});

async function seedInvitation(maxUses?: number | null) {
  const [row] = await db.insert(invitationsTable).values({
    code: generateInvitationCode(),
    role: "teacher",
    maxUses,
    expiresAt: new Date(Date.now() + 3600000),
  }).returning();
  invitationIds.push(row!.id);
  return row!;
}

async function register(code: string) {
  const email = `invite-flow-${Date.now()}-${++sequence}@example.test`;
  const response = await request(app).post("/api/auth/register").send({
    token: code, name: "Invitado/a", email, password: DEFAULT_PASSWORD,
    termsAccepted: true, privacyAcknowledged: true, legalVersion: "2026-10-21",
  });
  if (response.status === 200) registeredUserIds.push(response.body.user.id);
  return response;
}

describe("shared invitation registration limits", () => {
  it.each([false, true])("explains disabled accounts without reactivating them (soft deleted: %s)", async (softDeleted) => {
    const existing = await createUser({ role: "teacher" });
    const [disabled] = await db.update(usersTable).set({
      status: "inactive", deletedAt: softDeleted ? new Date() : null,
    }).where(eq(usersTable.id, existing.user.id)).returning();
    const invitation = await seedInvitation(2);
    const response = await request(app).post("/api/auth/register").send({
      token: invitation.code, email: existing.email, password: `${DEFAULT_PASSWORD}-different`,
      termsAccepted: true, privacyAcknowledged: true, legalVersion: "2026-10-21",
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("La cuenta asociada a este correo está desactivada. Contacta con coordinación para revisar su reactivación.");
    const [storedUser] = await db.select().from(usersTable).where(eq(usersTable.id, existing.user.id));
    expect(storedUser).toMatchObject({
      status: "inactive", deletedAt: disabled.deletedAt,
      passwordHash: disabled.passwordHash, tokenVersion: disabled.tokenVersion,
      sessionNonce: disabled.sessionNonce,
    });
    const [storedInvitation] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, invitation.id));
    expect(storedInvitation).toMatchObject({ usedCount: 0, status: "pending" });
  });

  it("explains an existing account without consuming the invitation or replacing its password", async () => {
    const existing = await createUser({ role: "teacher" });
    const invitation = await seedInvitation(2);
    const response = await request(app).post("/api/auth/register").send({
      token: invitation.code, email: existing.email.toUpperCase(), password: `${DEFAULT_PASSWORD}-different`,
      termsAccepted: true, privacyAcknowledged: true, legalVersion: "2026-10-21",
    });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("Ya existe una cuenta con este correo");
    const [storedInvitation] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, invitation.id));
    expect(storedInvitation).toMatchObject({ usedCount: 0, status: "pending" });
    const [storedUser] = await db.select().from(usersTable).where(eq(usersTable.id, existing.user.id));
    expect(storedUser.passwordHash).toBe(existing.user.passwordHash);
  });

  it("creates a general code without province and derives province when targeting a center", async () => {
    const admin = await createUser({ role: "superadmin" });
    const province = await createProvince();
    const center = await createCenter(province);
    const general = await request(app).post("/api/invitations").set(authHeader(admin.token))
      .send({ role: "teacher", maxUses: 2 });
    expect(general.status).toBe(201);
    invitationIds.push(general.body.invitation.id);
    expect(general.body.invitation).toMatchObject({ provinceId: null, centerId: null });
    const targeted = await request(app).post("/api/invitations").set(authHeader(admin.token))
      .send({ role: "teacher", centerId: center });
    expect(targeted.status).toBe(201);
    invitationIds.push(targeted.body.invitation.id);
    expect(targeted.body.invitation).toMatchObject({ provinceId: province, centerId: center });
    const invalid = await request(app).post("/api/invitations").set(authHeader(admin.token))
      .send({ role: "teacher", centerId: 2147483647 });
    expect(invalid.status).toBe(400);
  });

  it("keeps coordinator and department-head scopes without requesting province", async () => {
    const province = await createProvince();
    const center = await createCenter(province);
    const otherProvince = await createProvince();
    const otherCenter = await createCenter(otherProvince);
    const coordinator = await createUser({ role: "coordinator", provinceId: province });
    const created = await request(app).post("/api/invitations").set(authHeader(coordinator.token))
      .send({ role: "department_head", centerId: center });
    expect(created.status).toBe(201);
    invitationIds.push(created.body.invitation.id);
    expect(created.body.invitation.provinceId).toBe(province);
    expect((await request(app).post("/api/invitations").set(authHeader(coordinator.token))
      .send({ role: "department_head", centerId: otherCenter })).status).toBe(403);
    const head = await createUser({ role: "department_head", provinceId: province, centerId: center });
    const teacher = await request(app).post("/api/invitations").set(authHeader(head.token))
      .send({ role: "teacher", centerId: otherCenter, provinceId: otherProvince });
    expect(teacher.status).toBe(201);
    invitationIds.push(teacher.body.invitation.id);
    expect(teacher.body.invitation).toMatchObject({ provinceId: province, centerId: center });
    const unassigned = await createUser({
      role: "coordinator", provinceId: null, centerId: null, incompleteProfile: true,
    });
    expect((await request(app).post("/api/invitations").set(authHeader(unassigned.token))
      .send({ role: "department_head" })).status).toBe(403);
  });

  it("lists revoked history and expired codes, renews expiry, and prevents unauthorized management", async () => {
    const admin = await createUser({ role: "superadmin" });
    const expired = await seedInvitation(2);
    await db.update(invitationsTable).set({ expiresAt: new Date(Date.now() - 60_000), invitedBy: admin.user.id })
      .where(eq(invitationsTable.id, expired.id));
    const before = await request(app).get("/api/invitations?status=expired").set(authHeader(admin.token));
    expect(before.status).toBe(200);
    expect(before.body.find((i: { id: number }) => i.id === expired.id)?.status).toBe("expired");
    const teacher = await createUser({ role: "teacher" });
    expect((await request(app).get("/api/invitations").set(authHeader(teacher.token))).status).toBe(403);
    expect((await request(app).post(`/api/invitations/${expired.id}/resend`).set(authHeader(teacher.token))).status).toBe(403);
    expect((await request(app).post(`/api/invitations/${expired.id}/resend`).set(authHeader(admin.token))).status).toBe(200);
    const pending = await request(app).get("/api/invitations?status=pending").set(authHeader(admin.token));
    expect(pending.body.some((i: { id: number }) => i.id === expired.id)).toBe(true);
    expect((await request(app).delete(`/api/invitations/${expired.id}`).set(authHeader(admin.token))).status).toBe(204);
    const history = await request(app).get("/api/invitations?status=revoked").set(authHeader(admin.token));
    expect(history.body.find((i: { id: number }) => i.id === expired.id)?.status).toBe("revoked");
    expect((await request(app).post(`/api/invitations/${expired.id}/resend`).set(authHeader(admin.token))).status).toBe(404);
    expect((await request(app).get(`/api/auth/invitations/${expired.code}`)).status).toBe(404);
  });

  it("rejects missing, refused, or outdated legal acknowledgments without using the invitation", async () => {
    const invitation = await seedInvitation(1);
    const base = { token: invitation.code, email: "legal-test@example.test", password: DEFAULT_PASSWORD };
    expect((await request(app).post("/api/auth/register").send(base)).status).toBe(400);
    expect((await request(app).post("/api/auth/register").send({
      ...base, termsAccepted: false, privacyAcknowledged: true, legalVersion: "2026-10-21",
    })).status).toBe(400);
    expect((await request(app).post("/api/auth/register").send({
      ...base, termsAccepted: true, privacyAcknowledged: true, legalVersion: "borrador-2026-09-30-4",
    })).status).toBe(400);
    const [stored] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, invitation.id));
    expect(stored?.usedCount).toBe(0);
    const publicInvitation = await request(app).get(`/api/auth/invitations/${invitation.code}`);
    expect(publicInvitation.body.legalVersion).toBe("2026-10-21");
  });

  it("accepts exactly the configured number, then closes the link", async () => {
    const invitation = await seedInvitation(2);
    const first = await register(invitation.code);
    expect(first.status).toBe(200);
    const [firstUser] = await db.select().from(usersTable).where(eq(usersTable.id, first.body.user.id));
    expect(firstUser?.legalAcceptedAt).toBeInstanceOf(Date);
    expect(firstUser?.legalTermsVersion).toBe("2026-10-21");
    expect(firstUser?.legalPrivacyVersion).toBe("2026-10-21");
    const available = await request(app).get(`/api/auth/invitations/${invitation.code}`);
    expect(available.status).toBe(200);
    expect(available.body.remainingUses).toBe(1);

    expect((await register(invitation.code)).status).toBe(200);
    expect((await register(invitation.code)).status).toBe(400);
    expect((await request(app).get(`/api/auth/invitations/${invitation.code}`)).status).toBe(404);
    const [stored] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, invitation.id));
    expect(stored).toMatchObject({ usedCount: 2, maxUses: 2, status: "used", email: null });
  });

  it("allows an unlimited mass-mail link until it is revoked", async () => {
    const inviter = await createUser({ role: "superadmin" });
    const created = await request(app).post("/api/invitations")
      .set(authHeader(inviter.token))
      .send({ role: "teacher", maxUses: null });
    expect(created.status).toBe(201);
    expect(created.body.invitation.maxUses).toBeNull();
    const { code, id } = created.body.invitation;
    invitationIds.push(id);

    expect((await register(code)).status).toBe(200);
    expect((await register(code)).status).toBe(200);
    const available = await request(app).get(`/api/auth/invitations/${code}`);
    expect(available.status).toBe(200);
    expect(available.body.remainingUses).toBeNull();
    const [stored] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, id));
    expect(stored).toMatchObject({ usedCount: 2, status: "pending" });

    expect((await request(app).delete(`/api/invitations/${id}`).set(authHeader(inviter.token))).status).toBe(204);
    expect((await register(code)).status).toBe(400);
  });

  it("preserves single-use behavior when the limit is omitted", async () => {
    const invitation = await seedInvitation();
    expect((await register(invitation.code)).status).toBe(200);
    expect((await register(invitation.code)).status).toBe(400);
  });

  it("does not allow two concurrent registrations to claim the final place", async () => {
    const invitation = await seedInvitation(1);
    const [a, b] = await Promise.all([register(invitation.code), register(invitation.code)]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const [stored] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, invitation.id));
    expect(stored.usedCount).toBe(1);
  });
});