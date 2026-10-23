import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import request from "supertest";
import { db, teachingAssignmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { createUser, createModule, createProvince, createCenter, createTeachingAssignment, cleanup, authHeader } from "./helpers";
import { createTicket } from "../src/lib/oidc";
import * as settings from "../src/lib/settings";

// These route tests exercise the auth + "not configured" guards without a live
// Nextcloud. The full access-decision matrix is covered by nextcloud.test.ts.
const NC_ENV = [
  "NEXTCLOUD_URL",
  "NEXTCLOUD_ADMIN_USER",
  "NEXTCLOUD_ADMIN_PASSWORD",
  "NEXTCLOUD_OIDC_CLIENT_ID",
  "NEXTCLOUD_OIDC_CLIENT_SECRET",
] as const;
const ORIG: Record<string, string | undefined> = {};
for (const k of NC_ENV) ORIG[k] = process.env[k];

function clearNcEnv(): void {
  for (const k of NC_ENV) delete process.env[k];
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of NC_ENV) {
    if (ORIG[k] === undefined) delete process.env[k];
    else process.env[k] = ORIG[k];
  }
});

afterAll(async () => {
  await cleanup();
});

describe("GET /api/collab/status", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/collab/status");
    expect(res.status).toBe(401);
  });

  it("reports not configured when no Nextcloud settings exist", async () => {
    clearNcEnv();
    const { token } = await createUser({ role: "teacher" });
    const res = await request(app)
      .get("/api/collab/status")
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });
});

describe("POST /api/collab/modules/:moduleId/space", () => {
  it("requires authentication", async () => {
    const res = await request(app).post("/api/collab/modules/1/space");
    expect(res.status).toBe(401);
  });

  it("returns 503 when the collaborative space is not configured", async () => {
    clearNcEnv();
    const { token } = await createUser({ role: "superadmin" });
    const moduleId = await createModule({ name: "Mod test", code: "0001" });
    const res = await request(app)
      .post(`/api/collab/modules/${moduleId}/space`)
      .set(authHeader(token));
    expect(res.status).toBe(503);
  });

  it("rejects an invalid module id", async () => {
    clearNcEnv();
    const { token } = await createUser({ role: "superadmin" });
    const res = await request(app)
      .post("/api/collab/modules/not-a-number/space")
      .set(authHeader(token));
    expect(res.status).toBe(400);
  });

  it("rejects a single-use SSO link if module access was revoked before it is opened", async () => {
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const teacher = await createUser({ role: "teacher", centerId, incompleteProfile: true });
    const moduleId = await createModule({ centerId });
    const assignmentId = await createTeachingAssignment({
      teacherId: teacher.user.id,
      centerId,
      moduleId,
      schoolYear: "2099-2100",
    });
    const currentSettings = await settings.getSettings();
    vi.spyOn(settings, "getSettings").mockResolvedValue({
      ...currentSettings,
      nextcloudUrl: "https://cloud.example.test",
    });

    const ticket = createTicket(teacher.user.id, moduleId);
    await db.update(teachingAssignmentsTable)
      .set({ deletedAt: new Date() })
      .where(eq(teachingAssignmentsTable.id, assignmentId));

    const response = await request(app)
      .get("/api/oidc/start")
      .query({ ticket });

    expect(response.status).toBe(403);
    expect(response.headers.location).toBeUndefined();
    expect(response.headers["set-cookie"]).toBeUndefined();
  });
});
