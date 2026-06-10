import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPairSync, createPublicKey } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import {
  buildDiscovery,
  getJwks,
  getSigningMaterial,
  signIdToken,
  verifyPkce,
  createAuthCode,
  consumeAuthCode,
  createAccessToken,
  getAccessTokenUser,
  createTicket,
  consumeTicket,
  createSession,
  getSessionUser,
  _resetSigningCache,
} from "../src/lib/oidc";
import { isAllowedRedirectUri } from "../src/routes/oidc";

// Provide a fixed signing key via env so the OIDC helpers never touch the DB
// and the tests are fully deterministic.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const ORIG_KEY = process.env.OIDC_SIGNING_KEY;

beforeAll(() => {
  process.env.OIDC_SIGNING_KEY = privateKey;
  _resetSigningCache();
});

afterAll(() => {
  if (ORIG_KEY === undefined) delete process.env.OIDC_SIGNING_KEY;
  else process.env.OIDC_SIGNING_KEY = ORIG_KEY;
  _resetSigningCache();
});

describe("buildDiscovery", () => {
  it("exposes the standard endpoints under the issuer", () => {
    const doc = buildDiscovery("https://app.example.org/api/oidc/");
    expect(doc.issuer).toBe("https://app.example.org/api/oidc");
    expect(doc.authorization_endpoint).toBe(
      "https://app.example.org/api/oidc/authorize",
    );
    expect(doc.token_endpoint).toBe("https://app.example.org/api/oidc/token");
    expect(doc.userinfo_endpoint).toBe(
      "https://app.example.org/api/oidc/userinfo",
    );
    expect(doc.jwks_uri).toBe("https://app.example.org/api/oidc/jwks");
    expect(doc.id_token_signing_alg_values_supported).toContain("RS256");
    expect(doc.code_challenge_methods_supported).toContain("S256");
  });
});

describe("JWKS and id_token signing", () => {
  it("publishes an RS256 signing key", async () => {
    const jwks = await getJwks();
    expect(jwks.keys).toHaveLength(1);
    const key = jwks.keys[0] as Record<string, unknown>;
    expect(key.kty).toBe("RSA");
    expect(key.use).toBe("sig");
    expect(key.alg).toBe("RS256");
    expect(typeof key.kid).toBe("string");
  });

  it("signs an id_token that verifies against the published key", async () => {
    const { kid } = await getSigningMaterial();
    const issuer = "https://app.example.org/api/oidc";
    const idToken = await signIdToken({
      issuer,
      clientId: "coordina-nextcloud",
      claims: {
        sub: "coordina-7",
        name: "Ana Profesora",
        email: "ana@example.test",
        preferred_username: "coordina-7",
      },
      nonce: "n-123",
    });

    const header = JSON.parse(
      Buffer.from(idToken.split(".")[0]!, "base64url").toString("utf8"),
    );
    expect(header.alg).toBe("RS256");
    expect(header.kid).toBe(kid);

    const publicPem = createPublicKey(privateKey)
      .export({ type: "spki", format: "pem" })
      .toString();
    const decoded = jwt.verify(idToken, publicPem, {
      algorithms: ["RS256"],
      audience: "coordina-nextcloud",
      issuer,
    }) as JwtPayload;
    expect(decoded.sub).toBe("coordina-7");
    expect(decoded.name).toBe("Ana Profesora");
    expect(decoded.email).toBe("ana@example.test");
    expect(decoded.nonce).toBe("n-123");
  });
});

describe("verifyPkce", () => {
  it("accepts a matching S256 verifier/challenge pair", () => {
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    const verifier = "the-code-verifier-value-1234567890";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce("wrong", challenge)).toBe(false);
  });
});

describe("ephemeral stores", () => {
  it("issues and consumes single-use auth codes", () => {
    const code = createAuthCode({
      userId: 11,
      clientId: "c",
      redirectUri: "https://nc/callback",
      nonce: "n",
    });
    const rec = consumeAuthCode(code);
    expect(rec?.userId).toBe(11);
    // single-use: a second consume returns null
    expect(consumeAuthCode(code)).toBeNull();
  });

  it("maps access tokens to a user", () => {
    const t = createAccessToken(22);
    expect(getAccessTokenUser(t)).toBe(22);
    expect(getAccessTokenUser("bogus")).toBeNull();
  });

  it("issues and consumes single-use SSO tickets carrying the module", () => {
    const t = createTicket(33, 99);
    const rec = consumeTicket(t);
    expect(rec).toEqual(expect.objectContaining({ userId: 33, moduleId: 99 }));
    expect(consumeTicket(t)).toBeNull();
  });

  it("creates browser sessions resolvable by id", () => {
    const s = createSession(44);
    expect(getSessionUser(s)).toBe(44);
    expect(getSessionUser("nope")).toBeNull();
  });
});

describe("isAllowedRedirectUri", () => {
  const nc = "https://drive.example.org";

  it("accepts the user_oidc callback on the same origin", () => {
    expect(
      isAllowedRedirectUri(`${nc}/apps/user_oidc/code`, nc),
    ).toBe(true);
    expect(
      isAllowedRedirectUri(`${nc}/index.php/apps/user_oidc/code`, nc),
    ).toBe(true);
  });

  it("rejects prefix-confusable hosts", () => {
    expect(
      isAllowedRedirectUri(
        "https://drive.example.org.attacker.tld/apps/user_oidc/code",
        nc,
      ),
    ).toBe(false);
  });

  it("rejects a different scheme or port", () => {
    expect(isAllowedRedirectUri("http://drive.example.org/apps/user_oidc/code", nc)).toBe(
      false,
    );
    expect(
      isAllowedRedirectUri("https://drive.example.org:8443/apps/user_oidc/code", nc),
    ).toBe(false);
  });

  it("rejects paths outside the user_oidc callback", () => {
    expect(isAllowedRedirectUri(`${nc}/apps/files`, nc)).toBe(false);
    expect(isAllowedRedirectUri(`${nc}/../evil`, nc)).toBe(false);
  });

  it("rejects malformed URIs", () => {
    expect(isAllowedRedirectUri("not a url", nc)).toBe(false);
    expect(isAllowedRedirectUri("", nc)).toBe(false);
  });

  describe("subpath install (Nextcloud under /nextcloud)", () => {
    const sub = "https://coordinacionag.iesmmg.es/nextcloud";

    it("accepts the user_oidc callback under the base subpath", () => {
      expect(
        isAllowedRedirectUri(`${sub}/apps/user_oidc/code`, sub),
      ).toBe(true);
      expect(
        isAllowedRedirectUri(`${sub}/index.php/apps/user_oidc/code`, sub),
      ).toBe(true);
    });

    it("rejects the callback without the base subpath prefix", () => {
      expect(
        isAllowedRedirectUri(
          "https://coordinacionag.iesmmg.es/apps/user_oidc/code",
          sub,
        ),
      ).toBe(false);
    });

    it("rejects prefix-confusable subpaths", () => {
      expect(
        isAllowedRedirectUri(
          "https://coordinacionag.iesmmg.es/nextcloud-evil/apps/user_oidc/code",
          sub,
        ),
      ).toBe(false);
    });
  });
});
