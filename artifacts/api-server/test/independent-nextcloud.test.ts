import { afterEach, describe, expect, it, vi } from "vitest";
import { provisionIndependentSpace, revokeIndependentSpaceMember } from "../src/lib/nextcloud";

afterEach(() => vi.unstubAllGlobals());
const config = { url: "https://cloud.example.test", adminUser: "fixture", adminPassword: "fixture-only" };
const ok = (data: unknown = {}) => new Response(JSON.stringify({ ocs: { meta: { statuscode: 100 }, data } }), { status: 200 });

describe("independent space Nextcloud reconciliation", () => {
  it("uses a separate stable namespace, avoids duplicate group-folder assignments and removes stale users before grants", async () => {
    const current = new Set(["coordina-1", "coordina-2"]);
    const operations: string[] = [];
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === "/apps/groupfolders/folders" && options.method === "GET") {
        return ok({ "7": { id: 7, mount_point: "Espacio específico 7", groups: { "coordina-space-7": 31 } } });
      }
      if (path === "/ocs/v2.php/cloud/groups/coordina-space-7/users") return ok({ users: [...current] });
      if (path === "/ocs/v2.php/cloud/users/coordina-2/groups" && options.method === "DELETE") {
        operations.push("remove-2"); current.delete("coordina-2");
      }
      if (path === "/ocs/v2.php/cloud/users/coordina-1/groups" && options.method === "POST") {
        operations.push("add-1"); current.add("coordina-1");
      }
      return ok();
    });
    vi.stubGlobal("fetch", fetcher);
    const options = { spaceId: 7, members: [{ userId: 1, name: "Docente", email: "fixture@example.test" }] };
    await provisionIndependentSpace(config, options);
    await provisionIndependentSpace(config, options);
    expect(operations).toEqual(["remove-2", "add-1", "add-1"]);
    expect(fetcher.mock.calls.every(([url]) => !url.includes("coordina-mod-"))).toBe(true);
    expect(fetcher.mock.calls.some(([url, request]) =>
      new URL(url).pathname === "/apps/groupfolders/folders/7/groups" && request.method === "POST")).toBe(false);
    expect([...current]).toEqual(["coordina-1"]);
  });

  it("does not grant more access after a stale-member removal fails", async () => {
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === "/apps/groupfolders/folders" && options.method === "GET") {
        return ok({ "7": { id: 7, mount_point: "Espacio específico 7", groups: { "coordina-space-7": 31 } } });
      }
      if (path === "/ocs/v2.php/cloud/groups/coordina-space-7/users") return ok({ users: ["coordina-2"] });
      if (options.method === "DELETE") return new Response("Remote failure", { status: 503 });
      return ok();
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(provisionIndependentSpace(config, {
      spaceId: 7, members: [{ userId: 1, name: "Docente", email: "fixture@example.test" }],
    })).rejects.toThrow();
    expect(fetcher.mock.calls.some(([url]) => url.includes("/cloud/users/coordina-1"))).toBe(false);
  });

  it("fails closed on a malformed remote membership list rather than assuming an empty group", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok({})));
    await expect(revokeIndependentSpaceMember(config, 7, 1)).rejects.toThrow("invalid group membership list");
  });

  it("revokes only the selected space group and treats a missing group as already revoked", async () => {
    const fetcher = vi.fn(async (_url: string, options: RequestInit) =>
      options.method === "GET" ? ok({ users: ["coordina-1"] }) : ok());
    vi.stubGlobal("fetch", fetcher);
    await revokeIndependentSpaceMember(config, 7, 1);
    const removal = fetcher.mock.calls.find(([, options]) => options.method === "DELETE");
    expect(removal?.[1].body?.toString()).toBe("groupid=coordina-space-7");
    fetcher.mockImplementation(async () => new Response("Missing group", { status: 404 }));
    await expect(revokeIndependentSpaceMember(config, 8, 1)).resolves.toBeUndefined();
  });
});
