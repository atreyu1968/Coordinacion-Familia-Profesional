import { describe, it, expect, afterEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { resolveJaasCreds } from "../src/lib/jaas";

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

function setEnv(): void {
  process.env.JAAS_APP_ID = "env-app";
  process.env.JAAS_KID = "env-kid";
  process.env.JAAS_PRIVATE_KEY = privateKey;
}

function clearEnv(): void {
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

describe("resolveJaasCreds", () => {
  it("returns null when neither source is configured", () => {
    clearEnv();
    expect(resolveJaasCreds(null)).toBeNull();
    expect(resolveJaasCreds({})).toBeNull();
  });

  it("uses the env triplet when no DB settings are present", () => {
    setEnv();
    const creds = resolveJaasCreds(null);
    expect(creds?.appId).toBe("env-app");
    expect(creds?.kid).toBe("env-kid");
    expect(creds?.privateKey).toContain("BEGIN PRIVATE KEY");
  });

  it("prefers the complete DB triplet over env", () => {
    setEnv();
    const creds = resolveJaasCreds({
      jaasAppId: "db-app",
      jaasKid: "db-kid",
      jaasPrivateKey: privateKey,
    });
    expect(creds?.appId).toBe("db-app");
    expect(creds?.kid).toBe("db-kid");
  });

  it("never mixes sources: partial DB falls back to the full env triplet", () => {
    setEnv();
    const creds = resolveJaasCreds({
      jaasAppId: "db-app",
      jaasKid: null,
      jaasPrivateKey: null,
    });
    expect(creds?.appId).toBe("env-app");
    expect(creds?.kid).toBe("env-kid");
  });

  it("returns null when DB is partial and env is absent", () => {
    clearEnv();
    expect(
      resolveJaasCreds({ jaasAppId: "db-app", jaasKid: "db-kid", jaasPrivateKey: null }),
    ).toBeNull();
  });

  it("normalizes a space-collapsed private key into a valid PEM", () => {
    clearEnv();
    const collapsed = privateKey.replace(/\n/g, " ");
    const creds = resolveJaasCreds({
      jaasAppId: "db-app",
      jaasKid: "db-kid",
      jaasPrivateKey: collapsed,
    });
    expect(creds?.privateKey).toContain("-----BEGIN PRIVATE KEY-----\n");
    expect(creds?.privateKey).toContain("\n-----END PRIVATE KEY-----");
  });
});
