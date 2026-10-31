import { afterEach, describe, expect, it, vi } from "vitest";
import { disableNextcloudAccount } from "../src/lib/nextcloud";

const config = { url: "https://nextcloud.example.test", adminUser: "fixture", adminPassword: "test-only" };
const reply = (enabled: boolean | number | string) => new Response(JSON.stringify({ ocs: { meta: { statuscode: 100 }, data: { enabled } } }));
afterEach(() => vi.unstubAllGlobals());

describe("External fixture revocation without deleting files", () => {
  it("confirms that an enabled account was disabled", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(reply(true))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ocs: { meta: { statuscode: 100 }, data: {} } })))
      .mockResolvedValueOnce(reply(false));
    vi.stubGlobal("fetch", fetcher);
    await disableNextcloudAccount(config, 123);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1][0]).toBe(`${config.url}/ocs/v2.php/cloud/users/coordina-123/disable`);
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "PUT" });
    expect(fetcher.mock.calls.some(call => call[1].method === "DELETE")).toBe(false);
  });
  it("does not contact a disable endpoint for an already disabled account", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(false));
    vi.stubGlobal("fetch", fetcher);
    await disableNextcloudAccount(config, 123);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([[1, 0], ["1", "0"]])("accepts numeric/string OCS booleans (%s -> %s)", async (enabled, disabled) => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(reply(enabled))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ocs: { meta: { statuscode: 100 }, data: {} } })))
      .mockResolvedValueOnce(reply(disabled));
    vi.stubGlobal("fetch", fetcher);
    await disableNextcloudAccount(config, 123);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("accepts an OCS-confirmed absent user in HTTP 200 or 404, not a proxy 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ ocs: { meta: { statuscode: 998 }, data: [] } }), { status: 200 }),
    ));
    await expect(disableNextcloudAccount(config, 123)).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ ocs: { meta: { statuscode: 998 }, data: [] } }), { status: 404 }),
    ));
    await expect(disableNextcloudAccount(config, 123)).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("Proxy route not found", { status: 404 })));
    await expect(disableNextcloudAccount(config, 123)).rejects.toThrow();
  });
  it("accepts an explicit OCS 404 for the user during the initial account check", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ ocs: { meta: { statuscode: 404 }, data: { message: "User does not exist" } } }), { status: 404 }),
    ));
    await expect(disableNextcloudAccount(config, 123)).resolves.toBeUndefined();
  });
  it("does not treat an OCS 404 during disable verification as an absent account", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(reply(true))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ocs: { meta: { statuscode: 404 }, data: {} } }), { status: 404 })));
    await expect(disableNextcloudAccount(config, 123)).rejects.toThrow("no confirmó");
  });
  it("rejects an unconfirmed revocation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(true)).mockResolvedValueOnce(reply(true)).mockResolvedValueOnce(reply(true)));
    await expect(disableNextcloudAccount(config, 123)).rejects.toThrow("no confirmó");
  });
});
