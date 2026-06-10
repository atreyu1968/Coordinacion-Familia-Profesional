import jwt from "jsonwebtoken";
import { logger } from "./logger";

// JaaS (Jitsi as a Service, by 8x8) credentials. When all three are present we
// can mint a signed JWT so users join 8x8.vc rooms as authenticated moderators
// with NO login screen. When any is missing the caller falls back to the public
// meet.jit.si server (which shows a moderator login wall).
const APP_ID = process.env.JAAS_APP_ID;
const KID = process.env.JAAS_KID;
// The private key is often pasted into a single-line secret with literal "\n"
// sequences; normalize them to real newlines so the PEM parses correctly.
const PRIVATE_KEY = process.env.JAAS_PRIVATE_KEY?.replace(/\\n/g, "\n");

export function isJaasConfigured(): boolean {
  return Boolean(APP_ID && KID && PRIVATE_KEY);
}

export function jaasAppId(): string | undefined {
  return APP_ID;
}

export interface JaasUser {
  id: number | string;
  name: string;
  email?: string | null;
}

/**
 * Sign a short-lived JaaS JWT for a room. Returns null if JaaS is not configured
 * or signing fails, so the caller can degrade to the public Jitsi server.
 */
export function signJaasToken(opts: {
  room: string;
  user: JaasUser;
  moderator: boolean;
}): string | null {
  if (!APP_ID || !KID || !PRIVATE_KEY) return null;

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: "jitsi",
    iss: "chat",
    sub: APP_ID,
    room: opts.room,
    iat: now,
    nbf: now - 5,
    exp: now + 60 * 60 * 3, // 3 hours
    context: {
      user: {
        id: String(opts.user.id),
        name: opts.user.name,
        avatar: "",
        email: opts.user.email ?? "",
        moderator: opts.moderator ? "true" : "false",
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
