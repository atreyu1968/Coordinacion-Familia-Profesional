import { afterEach, describe, expect, it, vi } from "vitest";
import { syncNextcloudAdministrator } from "../src/lib/nextcloud";

const config = { url: "https://nextcloud.example.test", adminUser: "technical-admin", adminPassword: "test-only" };
const user = { id: 123, name: "Administrador SOLO de ensayo", email: "fixture@example.test",
  role: "superadmin", status: "active", deletedAt: null };
const response = (data: unknown, code = 100, status = 200) =>
  new Response(JSON.stringify({ ocs: { meta: { statuscode: code }, data } }), { status });
const groups = (...values: string[]) => response({ groups: values });
afterEach(() => vi.unstubAllGlobals());

describe("Nextcloud administrative role for managed identities", () => {
  it("grants and confirms admin on the own account, preserving other groups", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ id: "coordina-123" }))
      .mockResolvedValueOnce(groups("coordina-mod-1"))
      .mockResolvedValueOnce(response({})).mockResolvedValueOnce(groups("coordina-mod-1", "admin"));
    vi.stubGlobal("fetch", fetcher);
    await syncNextcloudAdministrator(config, user);
    expect(fetcher.mock.calls[2][0]).toBe(`${config.url}/ocs/v2.php/cloud/users/coordina-123/groups`);
    expect(fetcher.mock.calls[2][1]).toMatchObject({ method: "POST", body: "groupid=admin" });
    expect(fetcher.mock.calls.every(c => !String(c[0]).includes("/technical-admin/"))).toBe(true);
  });
  it("is idempotent for an existing administrator", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({}, 102)).mockResolvedValueOnce(groups("admin"));
    vi.stubGlobal("fetch", fetcher);
    await syncNextcloudAdministrator(config, user);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(["teacher", "coordinator", "department_head", "prospector"])("never grants admin to %s", async role => {
    const fetcher = vi.fn().mockResolvedValue(groups("coordina-mod-1"));
    vi.stubGlobal("fetch", fetcher);
    await syncNextcloudAdministrator(config, { ...user, role });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1].method).toBe("GET");
  });
  it.each([{ role: "teacher" }, { status: "inactive" }, { deletedAt: new Date() }])("revokes obsolete admin membership", async patch => {
    const fetcher = vi.fn().mockResolvedValueOnce(groups("admin", "coordina-mod-1"))
      .mockResolvedValueOnce(response({})).mockResolvedValueOnce(groups("coordina-mod-1"));
    vi.stubGlobal("fetch", fetcher);
    await syncNextcloudAdministrator(config, { ...user, ...patch });
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "DELETE", body: "groupid=admin" });
    expect(fetcher.mock.calls.every(c => !String(c[0]).endsWith("/coordina-123"))).toBe(true);
  });
  it("rejects an unconfirmed privilege change", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(groups("admin"))
      .mockResolvedValueOnce(response({})).mockResolvedValueOnce(groups("admin")));
    await expect(syncNextcloudAdministrator(config, { ...user, role: "teacher" })).rejects.toThrow("no confirmó");
  });
  it("accepts only confirmed missing users, not proxy errors or invalid membership lists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([], 998)));
    await expect(syncNextcloudAdministrator(config, { ...user, role: "teacher" })).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Proxy not found", { status: 404 })));
    await expect(syncNextcloudAdministrator(config, { ...user, role: "teacher" })).rejects.toThrow();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ groups: "admin" })));
    await expect(syncNextcloudAdministrator(config, { ...user, role: "teacher" })).rejects.toThrow("no confirmó");
  });
  it("does not revoke the technical provisioning credential", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(syncNextcloudAdministrator({ ...config, adminUser: "coordina-123" },
      { ...user, role: "teacher" })).rejects.toThrow("cuenta técnica");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
