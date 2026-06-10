import jwt from "jsonwebtoken";
import { logger } from "./logger";

// JaaS (Jitsi as a Service, by 8x8) integration. Coordinators/admins join as
// authenticated moderators (signed JWT → no login screen); everyone else joins
// the same 8x8.vc room as a guest (no token, no login, and NOT counted as a
// billable active user, so usage stays within the free tier). When the signing
// credentials are absent the caller falls back to the public meet.jit.si server.
const DOMAIN = "8x8.vc";
const TOKEN_TTL_SECONDS = 60 * 60 * 3; // 3 hours

// Credentials may come from the database (set in the superadmin control panel)
// or from environment variables. The control panel takes precedence; env vars
// act as a fallback so existing self-hosted setups keep working.
export interface JaasSettings {
  jaasAppId?: string | null;
  jaasKid?: string | null;
  jaasPrivateKey?: string | null;
}

export interface JaasCreds {
  appId: string;
  kid: string;
  privateKey: string;
}

// Build a credentials object only when the whole triplet is present. Returns
// null otherwise. The private key is normalized into a valid PEM.
function pickCreds(
  appIdRaw?: string | null,
  kidRaw?: string | null,
  keyRaw?: string | null,
): JaasCreds | null {
  const appId = (appIdRaw || "").trim();
  const kid = (kidRaw || "").trim();
  const rawKey = keyRaw || "";
  if (!appId || !kid || !rawKey.trim()) return null;
  return { appId, kid, privateKey: normalizePem(rawKey) };
}

/**
 * Resolve the active JaaS credentials. The stored settings (control panel) take
 * precedence, but only as a complete triplet — the two sources are never mixed,
 * since a JWT signed with a key id from one tenant and a private key from
 * another would fail. Falls back to the environment triplet. Returns null when
 * neither source is fully configured.
 */
export function resolveJaasCreds(s?: JaasSettings | null): JaasCreds | null {
  const fromDb = pickCreds(s?.jaasAppId, s?.jaasKid, s?.jaasPrivateKey);
  if (fromDb) return fromDb;
  return pickCreds(
    process.env.JAAS_APP_ID,
    process.env.JAAS_KID,
    process.env.JAAS_PRIVATE_KEY,
  );
}

/**
 * Rebuild a valid PEM from a private key that may have been mangled when stored
 * as a secret. Handles three shapes: already well-formed (real newlines),
 * escaped "\n" sequences, and single-line keys whose newlines were collapsed
 * into spaces (which breaks Node's PEM decoder). The base64 body is extracted
 * and re-wrapped at 64 columns.
 */
function normalizePem(raw: string): string {
  const unescaped = raw.replace(/\\n/g, "\n").trim();
  if (unescaped.includes("\n")) return unescaped;
  const match = unescaped.match(/-----BEGIN ([A-Z ]+?)-----(.*)-----END \1-----/);
  if (!match) return unescaped;
  const label = match[1].trim();
  const body = match[2].replace(/\s+/g, "");
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
}

export function isJaasConfigured(s?: JaasSettings | null): boolean {
  return resolveJaasCreds(s) !== null;
}

interface JaasUser {
  id: number | string;
  name: string;
  email?: string | null;
}

// Sign a short-lived moderator JWT for a room. Returns null on failure.
function signToken(creds: JaasCreds, room: string, user: JaasUser): string | null {
  const id = creds.appId;
  const keyId = creds.kid;
  const key = creds.privateKey;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: "jitsi",
    iss: "chat",
    sub: id,
    room,
    iat: now,
    nbf: now - 5,
    exp: now + TOKEN_TTL_SECONDS,
    context: {
      user: {
        id: String(user.id),
        name: user.name,
        email: user.email ?? "",
        avatar: "",
        moderator: "true",
      },
      // Paid features stay off so the free tier can't be charged accidentally.
      features: {
        livestreaming: "false",
        recording: "false",
        transcription: "false",
        "outbound-call": "false",
      },
    },
  };
  // The JWT header `kid` must be `${appId}/${keyId}`. JaaS shows the key in the
  // console already in that full form, so accept either: a bare key id (prepend
  // the app id) or the full `appId/keyId` value (use as-is) — avoids doubling
  // the prefix if the operator pasted the whole kid.
  const headerKid = keyId.includes("/") ? keyId : `${id}/${keyId}`;
  try {
    return jwt.sign(payload, key, {
      algorithm: "RS256",
      header: { alg: "RS256", kid: headerKid, typ: "JWT" },
    });
  } catch (err) {
    logger.error({ err }, "Failed to sign JaaS token");
    return null;
  }
}

function configHash(audioOnly: boolean): string {
  const cfg = [
    "config.disableDeepLinking=true",
    "config.prejoinPageEnabled=false",
  ];
  if (audioOnly) cfg.push("config.startAudioOnly=true");
  return cfg.join("&");
}

/**
 * Build a ready-to-join 8x8.vc URL. Moderators get a signed JWT (no login);
 * everyone else gets a guest URL (no token). Returns null if a required
 * moderator token can't be signed, so the caller can fall back to public Jitsi.
 */
export function buildJaasUrl(opts: {
  creds: JaasCreds;
  room: string;
  user: JaasUser;
  moderator: boolean;
  audioOnly: boolean;
}): string | null {
  const base = `https://${DOMAIN}/${opts.creds.appId}/${opts.room}`;
  const hash = `#${configHash(opts.audioOnly)}`;
  if (opts.moderator) {
    const token = signToken(opts.creds, opts.room, opts.user);
    if (!token) return null;
    return `${base}?jwt=${token}${hash}`;
  }
  return `${base}${hash}`;
}

/**
 * Public meet.jit.si fallback URL with in-app friendly config (skip deep-link
 * bounce and the prejoin page; optionally start audio-only).
 */
export function publicJitsiUrl(room: string, audioOnly: boolean): string {
  const cfg = [
    "config.disableDeepLinking=true",
    "config.prejoinPageEnabled=false",
    "config.disableThirdPartyRequests=true",
  ];
  if (audioOnly) cfg.push("config.startAudioOnly=true");
  return `https://meet.jit.si/${room}#${cfg.join("&")}`;
}
