import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, usersTable, accountAuditTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { authHeader, cleanup, createModule, createUser } from "./helpers";
import { createTicket } from "../src/lib/oidc";
import { changeAccount } from "../src/lib/accountAudit";
import { syncNextcloudAdministratorForSso } from "../src/lib/nextcloudAdministrator";
import app from "../src/app";

const stubs = vi.hoisted(() => ({ settings: vi.fn(), sync: vi.fn() }));
vi.mock("../src/lib/settings", async importOriginal => ({
  ...await importOriginal<typeof import("../src/lib/settings")>(), getSettings: stubs.settings,
}));
vi.mock("../src/lib/nextcloud", async importOriginal => ({
  ...await importOriginal<typeof import("../src/lib/nextcloud")>(), syncNextcloudAdministrator: stubs.sync,
}));
beforeEach(() => {
  stubs.settings.mockReset().mockResolvedValue({
    nextcloudUrl: "https://nextcloud.example.test",
    nextcloudAdminUser: "technical-admin", nextcloudAdminPassword: "test-only",
  });
  stubs.sync.mockReset().mockResolvedValue(undefined);
});
afterAll(cleanup);

describe("Nextcloud administration follows the authoritative app account", () => {
  it("confirms the fresh server-side role before starting Nextcloud SSO", async () => {
    const admin = await createUser({ role: "superadmin" });
    const moduleId = await createModule();
    const response = await request(app).get("/api/oidc/start")
      .query({ ticket: createTicket(admin.user.id, moduleId) });
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain("https://nextcloud.example.test/");
    expect(response.headers["set-cookie"]).toBeDefined();
    expect(stubs.sync.mock.calls[0][1]).toMatchObject({ id: admin.user.id, role: "superadmin", status: "active" });
  });
  it("does not issue an SSO session if remote permissions could not be confirmed", async () => {
    const admin = await createUser({ role: "superadmin" });
    const moduleId = await createModule();
    stubs.sync.mockRejectedValueOnce(new Error("Remote unavailable"));
    const response = await request(app).get("/api/oidc/start")
      .query({ ticket: createTicket(admin.user.id, moduleId) });
    expect(response.status).toBe(503);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers.location).toBeUndefined();
    expect(response.text).not.toContain("Remote unavailable");
  });
  it("rejects stale SSO role snapshots rather than re-granting administration", async () => {
    const admin = await createUser({ role: "superadmin" });
    const [demoted] = await db.update(usersTable).set({ role: "teacher" })
      .where(eq(usersTable.id, admin.user.id)).returning();
    await expect(syncNextcloudAdministratorForSso(admin.user)).rejects.toThrow("cuenta ha cambiado");
    expect(stubs.sync).not.toHaveBeenCalled();
    await syncNextcloudAdministratorForSso(demoted!);
    expect(stubs.sync.mock.calls[0][1].role).toBe("teacher");
  });
  it("revokes on demotion without granting privileges during a promotion or an unrelated edit", async () => {
    const actor = await createUser({ role: "superadmin" });
    const target = await createUser({ role: "superadmin" });
    const demoted = await changeAccount(actor.user, target.user, "update", { role: "teacher" });
    expect(stubs.sync).toHaveBeenCalledTimes(1);
    expect(stubs.sync.mock.calls[0][1]).toMatchObject({ id: target.user.id, role: "teacher" });
    stubs.sync.mockClear();
    const promoted = await changeAccount(actor.user, demoted!, "update", { role: "superadmin" });
    await changeAccount(actor.user, promoted!, "update", { name: "Nuevo nombre de ensayo" });
    expect(stubs.sync).not.toHaveBeenCalled();
  });
  it("rolls back account deactivation and audit when Nextcloud revocation fails", async () => {
    const actor = await createUser({ role: "superadmin" });
    const target = await createUser({ role: "superadmin" });
    stubs.sync.mockRejectedValueOnce(new Error("Remote unavailable"));
    const response = await request(app).delete(`/api/users/${target.user.id}`).set(authHeader(actor.token));
    expect(response.status).toBe(502);
    expect(response.body.message).toContain("No se ha aplicado el cambio");
    const [unchanged] = await db.select().from(usersTable).where(eq(usersTable.id, target.user.id));
    expect(unchanged).toMatchObject({ role: "superadmin", status: "active", deletedAt: null });
    expect(await db.select().from(accountAuditTable).where(eq(accountAuditTable.targetId, target.user.id))).toHaveLength(0);
  });
});
