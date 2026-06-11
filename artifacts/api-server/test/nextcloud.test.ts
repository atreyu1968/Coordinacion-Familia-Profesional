import { describe, it, expect, afterEach, vi } from "vitest";
import {
  resolveNextcloudConfig,
  resolveNextcloudUrl,
  resolveNextcloudOidcClient,
  isNextcloudConfigured,
  nextcloudUid,
  moduleGroupId,
  moduleFolderName,
  decideModuleAccess,
  provisionModuleSpace,
  type ModuleAccessInput,
  type NextcloudConfig,
} from "../src/lib/nextcloud";

const ENV_KEYS = [
  "NEXTCLOUD_URL",
  "NEXTCLOUD_ADMIN_URL",
  "NEXTCLOUD_ADMIN_USER",
  "NEXTCLOUD_ADMIN_PASSWORD",
  "NEXTCLOUD_OIDC_CLIENT_ID",
  "NEXTCLOUD_OIDC_CLIENT_SECRET",
] as const;

const ORIG: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) ORIG[k] = process.env[k];

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (ORIG[k] === undefined) delete process.env[k];
    else process.env[k] = ORIG[k];
  }
});

describe("resolveNextcloudConfig", () => {
  it("returns null when nothing is configured", () => {
    clearEnv();
    expect(resolveNextcloudConfig(null)).toBeNull();
    expect(resolveNextcloudConfig({})).toBeNull();
  });

  it("requires the full triplet from the DB (all-or-nothing)", () => {
    clearEnv();
    expect(
      resolveNextcloudConfig({
        nextcloudUrl: "https://drive.example.org",
        nextcloudAdminUser: "admin",
        // missing password
      }),
    ).toBeNull();
  });

  it("resolves from the DB and strips a trailing slash", () => {
    clearEnv();
    const cfg = resolveNextcloudConfig({
      nextcloudUrl: "https://drive.example.org/",
      nextcloudAdminUser: "admin",
      nextcloudAdminPassword: "secret",
    });
    expect(cfg).toEqual({
      url: "https://drive.example.org",
      adminUser: "admin",
      adminPassword: "secret",
    });
  });

  it("falls back to env when the DB is empty", () => {
    clearEnv();
    process.env.NEXTCLOUD_URL = "https://nc.env.org";
    process.env.NEXTCLOUD_ADMIN_USER = "root";
    process.env.NEXTCLOUD_ADMIN_PASSWORD = "envpass";
    expect(resolveNextcloudConfig({})).toEqual({
      url: "https://nc.env.org",
      adminUser: "root",
      adminPassword: "envpass",
    });
  });

  it("prefers NEXTCLOUD_ADMIN_URL over NEXTCLOUD_URL for the admin connection", () => {
    clearEnv();
    process.env.NEXTCLOUD_ADMIN_URL = "http://127.0.0.1:8081";
    process.env.NEXTCLOUD_URL = "https://nc.env.org/nextcloud";
    process.env.NEXTCLOUD_ADMIN_USER = "root";
    process.env.NEXTCLOUD_ADMIN_PASSWORD = "envpass";
    expect(resolveNextcloudConfig({})).toEqual({
      url: "http://127.0.0.1:8081",
      adminUser: "root",
      adminPassword: "envpass",
    });
    // The public URL is unaffected by the admin URL override.
    expect(resolveNextcloudUrl({})).toBe("https://nc.env.org/nextcloud");
  });

  it("NEXTCLOUD_ADMIN_URL overrides the transport URL even when creds come from the DB", () => {
    clearEnv();
    // Simulates env→DB seeding: the DB holds the PUBLIC url + admin creds.
    process.env.NEXTCLOUD_ADMIN_URL = "http://127.0.0.1:8081";
    const cfg = resolveNextcloudConfig({
      nextcloudUrl: "https://nc.public.org/nextcloud",
      nextcloudAdminUser: "admin",
      nextcloudAdminPassword: "secret",
    });
    expect(cfg).toEqual({
      url: "http://127.0.0.1:8081",
      adminUser: "admin",
      adminPassword: "secret",
    });
  });

  it("does not mix DB and env sources", () => {
    clearEnv();
    process.env.NEXTCLOUD_ADMIN_USER = "root";
    process.env.NEXTCLOUD_ADMIN_PASSWORD = "envpass";
    // DB has only the URL — the triplet is incomplete on both sides.
    expect(
      resolveNextcloudConfig({ nextcloudUrl: "https://db.example.org" }),
    ).toBeNull();
  });
});

describe("resolveNextcloudUrl", () => {
  it("returns the public URL even without admin credentials", () => {
    clearEnv();
    expect(
      resolveNextcloudUrl({ nextcloudUrl: "https://drive.example.org/" }),
    ).toBe("https://drive.example.org");
  });

  it("returns null when no URL is set anywhere", () => {
    clearEnv();
    expect(resolveNextcloudUrl({})).toBeNull();
  });
});

describe("resolveNextcloudOidcClient", () => {
  it("requires both id and secret", () => {
    clearEnv();
    expect(
      resolveNextcloudOidcClient({ nextcloudOidcClientId: "abc" }),
    ).toBeNull();
  });

  it("resolves from the DB", () => {
    clearEnv();
    expect(
      resolveNextcloudOidcClient({
        nextcloudOidcClientId: "abc",
        nextcloudOidcClientSecret: "xyz",
      }),
    ).toEqual({ clientId: "abc", clientSecret: "xyz" });
  });
});

describe("isNextcloudConfigured", () => {
  it("is true only when admin config AND oidc client are present", () => {
    clearEnv();
    const full = {
      nextcloudUrl: "https://drive.example.org",
      nextcloudAdminUser: "admin",
      nextcloudAdminPassword: "secret",
      nextcloudOidcClientId: "abc",
      nextcloudOidcClientSecret: "xyz",
    };
    expect(isNextcloudConfigured(full)).toBe(true);
    expect(
      isNextcloudConfigured({ ...full, nextcloudOidcClientSecret: "" }),
    ).toBe(false);
    expect(isNextcloudConfigured({})).toBe(false);
  });
});

describe("naming helpers", () => {
  it("produces stable ids matching the OIDC sub claim", () => {
    expect(nextcloudUid(42)).toBe("coordina-42");
    expect(moduleGroupId(7)).toBe("coordina-mod-7");
  });

  it("builds a mount name with the code prefix and sanitises slashes", () => {
    expect(moduleFolderName({ moduleId: 1, name: "Programación", code: "0485" })).toBe(
      "0485 Programación",
    );
    expect(
      moduleFolderName({ moduleId: 2, name: "Sistemas/Redes", code: null }),
    ).toBe("Sistemas-Redes");
    expect(moduleFolderName({ moduleId: 3, name: "   ", code: null })).toBe(
      "Módulo 3",
    );
  });
});

describe("decideModuleAccess", () => {
  const base: ModuleAccessInput = {
    role: "teacher",
    userCenterId: null,
    userProvinceId: null,
    moduleCenterId: null,
    moduleProvinceId: null,
    isAssigned: false,
  };

  it("superadmin can always access", () => {
    expect(decideModuleAccess({ ...base, role: "superadmin" })).toBe(true);
  });

  it("teacher only accesses assigned modules", () => {
    expect(decideModuleAccess({ ...base, role: "teacher", isAssigned: false })).toBe(
      false,
    );
    expect(decideModuleAccess({ ...base, role: "teacher", isAssigned: true })).toBe(
      true,
    );
  });

  it("coordinator accesses global, same-province, or assigned modules", () => {
    // global (no center)
    expect(
      decideModuleAccess({ ...base, role: "coordinator", moduleCenterId: null }),
    ).toBe(true);
    // same province
    expect(
      decideModuleAccess({
        ...base,
        role: "coordinator",
        moduleCenterId: 5,
        userProvinceId: 9,
        moduleProvinceId: 9,
      }),
    ).toBe(true);
    // different province, not assigned
    expect(
      decideModuleAccess({
        ...base,
        role: "coordinator",
        moduleCenterId: 5,
        userProvinceId: 9,
        moduleProvinceId: 3,
      }),
    ).toBe(false);
    // different province but assigned
    expect(
      decideModuleAccess({
        ...base,
        role: "coordinator",
        moduleCenterId: 5,
        userProvinceId: 9,
        moduleProvinceId: 3,
        isAssigned: true,
      }),
    ).toBe(true);
  });

  it("department_head accesses same-center or assigned modules", () => {
    expect(
      decideModuleAccess({
        ...base,
        role: "department_head",
        userCenterId: 4,
        moduleCenterId: 4,
      }),
    ).toBe(true);
    expect(
      decideModuleAccess({
        ...base,
        role: "department_head",
        userCenterId: 4,
        moduleCenterId: 8,
      }),
    ).toBe(false);
    expect(
      decideModuleAccess({
        ...base,
        role: "department_head",
        userCenterId: 4,
        moduleCenterId: 8,
        isAssigned: true,
      }),
    ).toBe(true);
  });

  it("unknown roles have no access", () => {
    expect(decideModuleAccess({ ...base, role: "guest", isAssigned: true })).toBe(
      false,
    );
  });
});

describe("OCS provisioning (statuscode handling)", () => {
  const config: NextcloudConfig = {
    url: "https://drive.example.org",
    adminUser: "admin",
    adminPassword: "secret",
  };

  function ocsResponse(statuscode: number, data: unknown = []): Response {
    const body = JSON.stringify({ ocs: { meta: { statuscode }, data } });
    return {
      ok: true,
      status: 200,
      text: async () => body,
    } as unknown as Response;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("treats HTTP 200 with a failure statuscode as an error (group creation)", async () => {
    // Nextcloud returns HTTP 200 even on logical errors; 997 = unauthorised.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ocsResponse(997));
    await expect(
      provisionModuleSpace(config, { moduleId: 1, mount: "M1", members: [] }),
    ).rejects.toThrow(/statuscode 997/);
  });

  it("is idempotent when resources already exist (statuscode 102)", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method || "GET").toUpperCase();
        // Group creation -> already exists.
        if (method === "POST" && url.endsWith("/ocs/v2.php/cloud/groups")) {
          return Promise.resolve(ocsResponse(102));
        }
        // Group folder listing -> one folder already mounted at "M1".
        if (method === "GET" && url.includes("/apps/groupfolders/folders")) {
          return Promise.resolve(
            ocsResponse(100, { "1": { id: 5, mount_point: "M1" } }),
          );
        }
        // User creation -> already exists.
        if (method === "POST" && url.endsWith("/ocs/v2.php/cloud/users")) {
          return Promise.resolve(ocsResponse(102));
        }
        // Everything else (grant group, permissions, add to group) -> ok.
        return Promise.resolve(ocsResponse(100));
      });

    await expect(
      provisionModuleSpace(config, {
        moduleId: 1,
        mount: "M1",
        members: [{ userId: 7, name: "Ada", email: "ada@example.org" }],
      }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("revokes access for members no longer in the desired set (reconciliation)", async () => {
    const removed: Array<{ uid: string; groupId: string }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method || "GET").toUpperCase();
        // Existing group folder mounted at "M1".
        if (method === "GET" && url.includes("/apps/groupfolders/folders")) {
          return Promise.resolve(
            ocsResponse(100, { "1": { id: 5, mount_point: "M1" } }),
          );
        }
        // Current group members: the desired user (7) plus a stale user (99).
        if (method === "GET" && /\/cloud\/groups\/[^/]+\/users/.test(url)) {
          return Promise.resolve(
            ocsResponse(100, { users: ["coordina-7", "coordina-99"] }),
          );
        }
        // Capture the removal of the stale member.
        if (method === "DELETE" && /\/cloud\/users\/[^/]+\/groups/.test(url)) {
          const m = url.match(/\/cloud\/users\/([^/]+)\/groups/);
          const params = new URLSearchParams(String(init?.body || ""));
          removed.push({
            uid: decodeURIComponent(m?.[1] || ""),
            groupId: params.get("groupid") || "",
          });
          return Promise.resolve(ocsResponse(100));
        }
        return Promise.resolve(ocsResponse(100));
      },
    );

    await provisionModuleSpace(config, {
      moduleId: 1,
      mount: "M1",
      members: [{ userId: 7, name: "Ada" }],
    });

    // The stale user (99) is removed; the desired user (7) is kept.
    expect(removed).toEqual([{ uid: "coordina-99", groupId: "coordina-mod-1" }]);
  });
});
