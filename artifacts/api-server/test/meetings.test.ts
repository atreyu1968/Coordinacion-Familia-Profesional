import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { createUser, cleanup, authHeader } from "./helpers";

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

  it("falls back to a public meet.jit.si URL when Daily is not configured", async () => {
    const u = await createUser({ role: "teacher" });
    const res = await request(app)
      .post("/api/meetings/token")
      .set(authHeader(u.token))
      .send({ room: "sala-coordinacion" });

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("public");
    expect(res.body.url).toContain("https://meet.jit.si/sala-coordinacion");
    expect(res.body.url).toContain("config.prejoinPageEnabled=false");
  });

  it("adds audio-only config when requested", async () => {
    const u = await createUser({ role: "teacher" });
    const res = await request(app)
      .post("/api/meetings/token")
      .set(authHeader(u.token))
      .send({ room: "sala-audio", audioOnly: true });

    expect(res.status).toBe(200);
    expect(res.body.url).toContain("config.startAudioOnly=true");
  });
});
