import { describe, it, expect, afterAll, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import request from "supertest";
import app from "../src/app";
import {
  createUser,
  createModule,
  createCenter,
  createProvince,
  createMeeting,
  addMembership,
  cleanup,
  authHeader,
} from "./helpers";

// Self-contained RSA key so JaaS signing is exercised without the real secret.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const ORIG = {
  appId: process.env.JAAS_APP_ID,
  kid: process.env.JAAS_KID,
  key: process.env.JAAS_PRIVATE_KEY,
};

function setJaas(): void {
  process.env.JAAS_APP_ID = "vpaas-magic-cookie-test";
  process.env.JAAS_KID = "test-kid";
  process.env.JAAS_PRIVATE_KEY = privateKey;
}

function clearJaas(): void {
  delete process.env.JAAS_APP_ID;
  delete process.env.JAAS_KID;
  delete process.env.JAAS_PRIVATE_KEY;
}

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  restore("JAAS_APP_ID", ORIG.appId);
  restore("JAAS_KID", ORIG.kid);
  restore("JAAS_PRIVATE_KEY", ORIG.key);
});

afterAll(async () => {
  await cleanup();
});

describe("POST /meetings/token", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/meetings/token")
      .send({ room: "sala-1" });
    expect(res.status).toBe(401);
  });

  it("rejects an empty room", async () => {
    const u = await createUser({ role: "teacher" });
    const res = await request(app)
      .post("/api/meetings/token")
      .set(authHeader(u.token))
      .send({ room: "   " });
    expect(res.status).toBe(400);
  });

  it("gives coordinators a JaaS moderator URL (signed jwt)", async () => {
    setJaas();
    const u = await createUser({ role: "coordinator" });
    const res = await request(app)
      .post("/api/meetings/token")
      .set(authHeader(u.token))
      .send({ room: "sala-coordinacion" });

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("jaas");
    expect(res.body.url).toContain(
      "https://8x8.vc/vpaas-magic-cookie-test/sala-coordinacion",
    );
    expect(res.body.url).toContain("?jwt=");
  });

  it("gives non-moderators a JaaS guest URL (no jwt)", async () => {
    setJaas();
    const u = await createUser({ role: "teacher" });
    const res = await request(app)
      .post("/api/meetings/token")
      .set(authHeader(u.token))
      .send({ room: "sala-invitado" });

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("jaas");
    expect(res.body.url).toContain(
      "https://8x8.vc/vpaas-magic-cookie-test/sala-invitado",
    );
    expect(res.body.url).not.toContain("jwt=");
  });

  it("falls back to a public meet.jit.si URL when JaaS is not configured", async () => {
    clearJaas();
    const u = await createUser({ role: "teacher" });
    const res = await request(app)
      .post("/api/meetings/token")
      .set(authHeader(u.token))
      .send({ room: "sala-publica" });

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("public");
    expect(res.body.url).toContain("https://meet.jit.si/sala-publica");
    expect(res.body.url).toContain("config.prejoinPageEnabled=false");
  });

  it("adds audio-only config when requested", async () => {
    clearJaas();
    const u = await createUser({ role: "teacher" });
    const res = await request(app)
      .post("/api/meetings/token")
      .set(authHeader(u.token))
      .send({ room: "sala-audio", audioOnly: true });

    expect(res.status).toBe(200);
    expect(res.body.url).toContain("config.startAudioOnly=true");
  });

  // Regression: a registered meeting's room name must enforce module access so a
  // leaked/guessed room can't be joined by a non-member (IDOR).
  it("denies a token for a module meeting to a non-member teacher", async () => {
    clearJaas();
    const host = await createUser({ role: "teacher" });
    const moduleId = await createModule({ centerId: null });
    const room = `coordinaadg-idor-${Date.now()}`;
    await createMeeting({ roomName: room, hostId: host.user.id, moduleId });

    const outsider = await createUser({ role: "teacher" });
    const res = await request(app)
      .post("/api/meetings/token")
      .set(authHeader(outsider.token))
      .send({ room });
    expect(res.status).toBe(403);
  });

  it("grants a token for a module meeting to an enrolled member", async () => {
    clearJaas();
    const host = await createUser({ role: "teacher" });
    const moduleId = await createModule({ centerId: null });
    const room = `coordinaadg-member-${Date.now()}`;
    await createMeeting({ roomName: room, hostId: host.user.id, moduleId });

    const member = await createUser({ role: "teacher" });
    await addMembership(moduleId, member.user.id, "member");
    const res = await request(app)
      .post("/api/meetings/token")
      .set(authHeader(member.token))
      .send({ room });
    expect(res.status).toBe(200);
  });

  it("keeps ad-hoc rooms (no meeting row) open to any authenticated caller", async () => {
    clearJaas();
    const u = await createUser({ role: "teacher" });
    const res = await request(app)
      .post("/api/meetings/token")
      .set(authHeader(u.token))
      .send({ room: `adhoc-${Date.now()}` });
    expect(res.status).toBe(200);
  });
});

describe("GET /meetings visibility", () => {
  afterAll(async () => {
    await cleanup();
  });

  it("shows a teacher only meetings of modules they belong to", async () => {
    const host = await createUser({ role: "teacher" });
    const mine = await createModule({ centerId: null });
    const theirs = await createModule({ centerId: null });
    await createMeeting({
      roomName: `vis-mine-${Date.now()}`,
      hostId: host.user.id,
      moduleId: mine,
    });
    await createMeeting({
      roomName: `vis-theirs-${Date.now()}`,
      hostId: host.user.id,
      moduleId: theirs,
    });

    const viewer = await createUser({ role: "teacher" });
    await addMembership(mine, viewer.user.id, "member");
    const res = await request(app)
      .get("/api/meetings")
      .set(authHeader(viewer.token));
    expect(res.status).toBe(200);
    const moduleIds = (res.body as { moduleId: number | null }[]).map(
      (m) => m.moduleId,
    );
    expect(moduleIds).toContain(mine);
    expect(moduleIds).not.toContain(theirs);
  });

  it("hides legacy null-module meetings from regular teachers", async () => {
    const host = await createUser({ role: "coordinator" });
    await createMeeting({
      roomName: `vis-legacy-${Date.now()}`,
      hostId: host.user.id,
      moduleId: null,
    });
    const viewer = await createUser({ role: "teacher" });
    const res = await request(app)
      .get("/api/meetings")
      .set(authHeader(viewer.token));
    expect(res.status).toBe(200);
    const hasLegacy = (res.body as { moduleId: number | null }[]).some(
      (m) => m.moduleId === null,
    );
    expect(hasLegacy).toBe(false);
  });
});

describe("module roster permissions", () => {
  afterAll(async () => {
    await cleanup();
  });

  it("lets a module coordinator add a plain member", async () => {
    const province = await createProvince();
    const center = await createCenter(province);
    const moduleId = await createModule({ centerId: center });
    const coord = await createUser({ role: "teacher" });
    await addMembership(moduleId, coord.user.id, "coordinator");
    const newTeacher = await createUser({ role: "teacher" });

    const res = await request(app)
      .post(`/api/modules/${moduleId}/members`)
      .set(authHeader(coord.token))
      .send({ userId: newTeacher.user.id });
    expect(res.status).toBe(201);
  });

  it("forbids a module coordinator from designating another coordinator", async () => {
    const province = await createProvince();
    const center = await createCenter(province);
    const moduleId = await createModule({ centerId: center });
    const coord = await createUser({ role: "teacher" });
    await addMembership(moduleId, coord.user.id, "coordinator");
    const target = await createUser({ role: "teacher" });

    const res = await request(app)
      .post(`/api/modules/${moduleId}/members`)
      .set(authHeader(coord.token))
      .send({ userId: target.user.id, role: "coordinator" });
    expect(res.status).toBe(403);
  });
});
