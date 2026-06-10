import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  createPrivateKey,
} from "node:crypto";
import jwt from "jsonwebtoken";
import { db, integrationSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSettings } from "./settings";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Minimal OpenID Connect provider.
//
// This app is the source of truth for identities; Nextcloud's `user_oidc` app
// is a client that logs users in here so they never see a second login screen.
// We implement just enough of OIDC (authorization code flow, optional PKCE) for
// user_oidc: discovery, JWKS, /authorize, /token and /userinfo.
//
// Ephemeral artifacts (login tickets, browser sessions, auth codes, access
// tokens) live in memory with short TTLs. The deployment runs a single API
// process (systemd), so an in-memory store is sufficient and avoids extra
// tables; everything here is short-lived and re-issued on demand.
// ---------------------------------------------------------------------------

const ID_TOKEN_TTL_SECONDS = 60 * 5;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;
const TICKET_TTL_MS = 2 * 60 * 1000;
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface OidcClaims {
  sub: string;
  name: string;
  email?: string | null;
  preferred_username: string;
}

interface SigningMaterial {
  privateKey: string;
  publicKeyPem: string;
  kid: string;
}

let cachedMaterial: SigningMaterial | null = null;

function deriveKid(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 16);
}

/**
 * Resolve the RSA key used to sign id_tokens. Priority: OIDC_SIGNING_KEY env,
 * then the value stored in integration_settings, otherwise a fresh keypair is
 * generated and persisted so it stays stable across restarts.
 */
export async function getSigningMaterial(): Promise<SigningMaterial> {
  if (cachedMaterial) return cachedMaterial;

  const fromEnv = (process.env["OIDC_SIGNING_KEY"] || "").trim();
  if (fromEnv) {
    const publicKeyPem = createPublicKey(fromEnv)
      .export({ type: "spki", format: "pem" })
      .toString();
    cachedMaterial = {
      privateKey: fromEnv,
      publicKeyPem,
      kid: deriveKid(publicKeyPem),
    };
    return cachedMaterial;
  }

  const settings = await getSettings();
  let privateKey = (settings.oidcSigningKey || "").trim();
  if (!privateKey) {
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    privateKey = pair.privateKey;
    await db
      .update(integrationSettingsTable)
      .set({ oidcSigningKey: privateKey })
      .where(eq(integrationSettingsTable.id, settings.id));
    logger.info("Generated OIDC signing key");
  }
  const publicKeyPem = createPublicKey(privateKey)
    .export({ type: "spki", format: "pem" })
    .toString();
  cachedMaterial = { privateKey, publicKeyPem, kid: deriveKid(publicKeyPem) };
  return cachedMaterial;
}

/** For tests: drop the cached signing key so a new settings row is read. */
export function _resetSigningCache(): void {
  cachedMaterial = null;
}

/** Public JWKS document derived from the signing key. */
export async function getJwks(): Promise<{ keys: unknown[] }> {
  const { publicKeyPem, kid } = await getSigningMaterial();
  const jwk = createPublicKey(publicKeyPem).export({ format: "jwk" }) as Record<
    string,
    unknown
  >;
  return {
    keys: [{ ...jwk, use: "sig", alg: "RS256", kid }],
  };
}

/** OIDC discovery document for the given issuer base (e.g. https://app/api/oidc). */
export function buildDiscovery(issuer: string): Record<string, unknown> {
  const base = issuer.replace(/\/+$/, "");
  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    userinfo_endpoint: `${base}/userinfo`,
    jwks_uri: `${base}/jwks`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email"],
    token_endpoint_auth_methods_supported: [
      "client_secret_basic",
      "client_secret_post",
    ],
    code_challenge_methods_supported: ["S256"],
    claims_supported: ["sub", "name", "email", "preferred_username"],
  };
}

export async function signIdToken(opts: {
  issuer: string;
  clientId: string;
  claims: OidcClaims;
  nonce?: string;
}): Promise<string> {
  const { privateKey, kid } = await getSigningMaterial();
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: opts.issuer.replace(/\/+$/, ""),
    sub: opts.claims.sub,
    aud: opts.clientId,
    iat: now,
    exp: now + ID_TOKEN_TTL_SECONDS,
    name: opts.claims.name,
    preferred_username: opts.claims.preferred_username,
  };
  if (opts.claims.email) payload["email"] = opts.claims.email;
  if (opts.nonce) payload["nonce"] = opts.nonce;
  // Ensure the key is a valid PEM private key object.
  const key = createPrivateKey(privateKey);
  return jwt.sign(payload, key, {
    algorithm: "RS256",
    keyid: kid,
  });
}

// ---------------------------------------------------------------------------
// Ephemeral stores
// ---------------------------------------------------------------------------

interface Expiring {
  expiresAt: number;
}

function sweep<T extends Expiring>(store: Map<string, T>): void {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
}

function token(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

interface AuthCodeRecord extends Expiring {
  userId: number;
  clientId: string;
  redirectUri: string;
  nonce?: string;
  codeChallenge?: string;
}
const authCodes = new Map<string, AuthCodeRecord>();

export function createAuthCode(rec: Omit<AuthCodeRecord, "expiresAt">): string {
  sweep(authCodes);
  const code = token();
  authCodes.set(code, { ...rec, expiresAt: Date.now() + CODE_TTL_MS });
  return code;
}

export function consumeAuthCode(code: string): AuthCodeRecord | null {
  sweep(authCodes);
  const rec = authCodes.get(code);
  if (!rec) return null;
  authCodes.delete(code);
  return rec;
}

interface AccessRecord extends Expiring {
  userId: number;
}
const accessTokens = new Map<string, AccessRecord>();

export function createAccessToken(userId: number): string {
  sweep(accessTokens);
  const t = token();
  accessTokens.set(t, { userId, expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS });
  return t;
}

export function getAccessTokenUser(t: string): number | null {
  sweep(accessTokens);
  return accessTokens.get(t)?.userId ?? null;
}

interface TicketRecord extends Expiring {
  userId: number;
  moduleId: number;
}
const tickets = new Map<string, TicketRecord>();

export function createTicket(userId: number, moduleId: number): string {
  sweep(tickets);
  const t = token();
  tickets.set(t, { userId, moduleId, expiresAt: Date.now() + TICKET_TTL_MS });
  return t;
}

export function consumeTicket(t: string): TicketRecord | null {
  sweep(tickets);
  const rec = tickets.get(t);
  if (!rec) return null;
  tickets.delete(t);
  return rec;
}

const sessions = new Map<string, AccessRecord>();

export function createSession(userId: number): string {
  sweep(sessions);
  const t = token();
  sessions.set(t, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return t;
}

export function getSessionUser(t: string): number | null {
  sweep(sessions);
  return sessions.get(t)?.userId ?? null;
}

/** Verify a PKCE S256 code_verifier against a stored code_challenge. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  const hashed = createHash("sha256").update(verifier).digest("base64url");
  return hashed === challenge;
}
