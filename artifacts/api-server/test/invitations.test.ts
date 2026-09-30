import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, invitationsTable, usersTable } from "@workspace/db";
import app from "../src/app";
import { generateInvitationCode } from "../src/lib/auth";
import { authHeader, cleanup, createUser, DEFAULT_PASSWORD } from "./helpers";

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
    termsAccepted: true, privacyAcknowledged: true, legalVersion: "borrador-2026-09-30-2",
  });
  if (response.status === 200) registeredUserIds.push(response.body.user.id);
  return response;
}

describe("shared invitation registration limits", () => {
  it("rejects missing, refused, or outdated legal acknowledgments without using the invitation", async () => {
    const invitation = await seedInvitation(1);
    const base = { token: invitation.code, email: "legal-test@example.test", password: DEFAULT_PASSWORD };
    expect((await request(app).post("/api/auth/register").send(base)).status).toBe(400);
    expect((await request(app).post("/api/auth/register").send({
      ...base, termsAccepted: false, privacyAcknowledged: true, legalVersion: "borrador-2026-09-30-2",
    })).status).toBe(400);
    expect((await request(app).post("/api/auth/register").send({
      ...base, termsAccepted: true, privacyAcknowledged: true, legalVersion: "anterior",
    })).status).toBe(400);
    const [stored] = await db.select().from(invitationsTable).where(eq(invitationsTable.id, invitation.id));
    expect(stored?.usedCount).toBe(0);
    const publicInvitation = await request(app).get(`/api/auth/invitations/${invitation.code}`);
    expect(publicInvitation.body.legalVersion).toBe("borrador-2026-09-30-2");
  });

  it("accepts exactly the configured number, then closes the link", async () => {
    const invitation = await seedInvitation(2);
    const first = await register(invitation.code);
    expect(first.status).toBe(200);
    const [firstUser] = await db.select().from(usersTable).where(eq(usersTable.id, first.body.user.id));
    expect(firstUser?.legalAcceptedAt).toBeInstanceOf(Date);
    expect(firstUser?.legalTermsVersion).toBe("borrador-2026-09-30-2");
    expect(firstUser?.legalPrivacyVersion).toBe("borrador-2026-09-30-2");
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