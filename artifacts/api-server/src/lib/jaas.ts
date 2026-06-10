import jwt from "jsonwebtoken";
import { logger } from "./logger";

// JaaS (Jitsi as a Service, by 8x8) integration. Coordinators/admins join as
// authenticated moderators (signed JWT → no login screen); everyone else joins
// the same 8x8.vc room as a guest (no token, no login, and NOT counted as a
// billable active user, so usage stays within the free tier). When the signing
// credentials are absent the caller falls back to the public meet.jit.si server.
const APP_ID = process.env.JAAS_APP_ID;
const KID = process.env.JAAS_KID;
// The private key is often pasted into a single-line secret with literal "\n"
// sequences; normalize them to real newlines so the PEM parses correctly.
const PRIVATE_KEY = process.env.JAAS_PRIVATE_KEY?.replace(/\\n/g, "\n");
const DOMAIN = "8x8.vc";
const TOKEN_TTL_SECONDS = 60 * 60 * 3; // 3 hours

export function isJaasConfigured(): boolean {
  return Boolean(APP_ID && KID && PRIVATE_KEY);
}

interface JaasUser {
  id: number | string;
  name: string;
  email?: string | null;
}

// Sign a short-lived moderator JWT for a room. Returns null on failure.
function signToken(room: string, user: JaasUser): string | null {
  if (!APP_ID || !KID || !PRIVATE_KEY) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: "jitsi",
    iss: "chat",
    sub: APP_ID,
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
    return jwt.sign(payload, PRIVATE_KEY, {
      algorithm: "RS256",
      header: { alg: "RS256", kid: `${APP_ID}/${KID}`, typ: "JWT" },
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
  if (!APP_ID) return null;
  const base = `https://${DOMAIN}/${APP_ID}/${opts.room}`;
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
