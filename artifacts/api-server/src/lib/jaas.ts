import jwt from "jsonwebtoken";
import { logger } from "./logger";

// JaaS (Jitsi as a Service, by 8x8) integration. Coordinators/admins join as
// authenticated moderators (signed JWT → no login screen); everyone else joins
// the same 8x8.vc room as a guest (no token, no login, and NOT counted as a
// billable active user, so usage stays within the free tier). When the signing
// credentials are absent the caller falls back to the public meet.jit.si server.
const DOMAIN = "8x8.vc";
const TOKEN_TTL_SECONDS = 60 * 60 * 3; // 3 hours

// Read env at call time (not module load) so configuration changes and tests
// take effect without a process restart.
function appId(): string | undefined {
  return process.env.JAAS_APP_ID;
}
function kid(): string | undefined {
  return process.env.JAAS_KID;
}
function privateKey(): string | undefined {
  const raw = process.env.JAAS_PRIVATE_KEY;
  if (!raw) return undefined;
  return normalizePem(raw);
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

export function isJaasConfigured(): boolean {
  return Boolean(appId() && kid() && privateKey());
}

interface JaasUser {
  id: number | string;
  name: string;
  email?: string | null;
}

// Sign a short-lived moderator JWT for a room. Returns null on failure.
function signToken(room: string, user: JaasUser): string | null {
  const id = appId();
  const keyId = kid();
  const key = privateKey();
  if (!id || !keyId || !key) return null;
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
  try {
    return jwt.sign(payload, key, {
      algorithm: "RS256",
      header: { alg: "RS256", kid: `${id}/${keyId}`, typ: "JWT" },
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
  room: string;
  user: JaasUser;
  moderator: boolean;
  audioOnly: boolean;
}): string | null {
  const id = appId();
  if (!id) return null;
  const base = `https://${DOMAIN}/${id}/${opts.room}`;
  const hash = `#${configHash(opts.audioOnly)}`;
  if (opts.moderator) {
    const token = signToken(opts.room, opts.user);
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
