import { describe, it, expect, afterAll, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import request from "supertest";
import app from "../src/app";
import { createUser, cleanup, authHeader } from "./helpers";

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
});
