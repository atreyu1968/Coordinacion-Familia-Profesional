import { afterEach, describe, expect, it, vi } from "vitest";
import { disableTestTeacherNextcloudAccount } from "../src/lib/nextcloud";

const config = { url: "https://nextcloud.example.test", adminUser: "fixture", adminPassword: "test-only" };
const reply = (enabled: boolean) => new Response(JSON.stringify({ ocs: { meta: { statuscode: 100 }, data: { enabled } } }));
afterEach(() => vi.unstubAllGlobals());

describe("External fixture revocation without deleting files", () => {
  it("confirms that an enabled account was disabled", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(reply(true))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ocs: { meta: { statuscode: 100 }, data: {} } })))
      .mockResolvedValueOnce(reply(false));
    vi.stubGlobal("fetch", fetcher);
    await disableTestTeacherNextcloudAccount(config, 123);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1][0]).toBe(`${config.url}/ocs/v2.php/cloud/users/coordina-123/disable`);
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "PUT" });
    expect(fetcher.mock.calls.some(call => call[1].method === "DELETE")).toBe(false);
  });
  it("does not contact a disable endpoint for an already disabled account", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(false));
    vi.stubGlobal("fetch", fetcher);
    await disableTestTeacherNextcloudAccount(config, 123);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("accepts an OCS-confirmed absent user in HTTP 200 or 404, not a proxy 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ ocs: { meta: { statuscode: 998 }, data: [] } }), { status: 200 }),
    ));
    await expect(disableTestTeacherNextcloudAccount(config, 123)).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ ocs: { meta: { statuscode: 998 }, data: [] } }), { status: 404 }),
    ));
    await expect(disableTestTeacherNextcloudAccount(config, 123)).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("Proxy route not found", { status: 404 })));
    await expect(disableTestTeacherNextcloudAccount(config, 123)).rejects.toThrow();
  });
  it("rejects an unconfirmed revocation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(true)).mockResolvedValueOnce(reply(true)).mockResolvedValueOnce(reply(true)));
    await expect(disableTestTeacherNextcloudAccount(config, 123)).rejects.toThrow("no confirmó");
  });
});
