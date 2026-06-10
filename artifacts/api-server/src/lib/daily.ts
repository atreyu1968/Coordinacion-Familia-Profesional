import { createHash } from "node:crypto";
import { logger } from "./logger";

// Daily.co (https://daily.co) integration. When DAILY_API_KEY is present we
// create/reuse a private room and mint a short-lived per-user meeting token, so
// the user joins with NO login screen and no per-user (MAU) cap — Daily bills by
// participant-minutes, not by number of users. When the key is absent the caller
// falls back to the public meet.jit.si server (which shows a login wall).
const API_KEY = process.env.DAILY_API_KEY;
const API = "https://api.daily.co/v1";
const TOKEN_TTL_SECONDS = 60 * 60 * 3; // 3 hours

export function isDailyConfigured(): boolean {
  return Boolean(API_KEY);
}

// Daily room names accept only letters, numbers, dash and underscore. We map a
// logical room name deterministically so every participant lands in the same
// Daily room. Long/odd names collapse to a stable hash to stay within limits.
function dailyRoomName(room: string): string {
  const cleaned = room.replace(/[^A-Za-z0-9_-]/g, "-");
  if (cleaned.length === 0 || cleaned.length > 41) {
    return "room-" + createHash("sha1").update(room).digest("hex").slice(0, 32);
  }
  return cleaned;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
}

// Ensure the room exists and return its base URL (e.g. https://x.daily.co/name).
async function ensureRoom(name: string): Promise<string | null> {
  try {
    const existing = await fetch(`${API}/rooms/${name}`, {
      headers: headers(),
    });
    if (existing.ok) {
      const json = (await existing.json()) as { url?: string };
      return json.url ?? null;
    }
    if (existing.status !== 404) {
      logger.error(
        { status: existing.status },
        "Daily: unexpected status fetching room",
      );
      return null;
    }
    // Private room: only holders of a meeting token (issued by us to
    // authenticated users) may join. Prejoin UI off so the call opens directly.
    const created = await fetch(`${API}/rooms`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        name,
        privacy: "private",
        properties: { enable_prejoin_ui: false },
      }),
    });
    if (!created.ok) {
      logger.error(
        { status: created.status },
        "Daily: failed to create room",
      );
      return null;
    }
    const json = (await created.json()) as { url?: string };
    return json.url ?? null;
  } catch (err) {
    logger.error({ err }, "Daily: ensureRoom request failed");
    return null;
  }
}

// Mint a meeting token scoped to the room for this user.
async function createToken(opts: {
  room: string;
  userName: string;
  audioOnly: boolean;
}): Promise<string | null> {
  try {
    const res = await fetch(`${API}/meeting-tokens`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        properties: {
          room_name: opts.room,
          user_name: opts.userName,
          // Internal trusted tool: every participant is an owner so anyone can
          // run the call (avoids "waiting for the host" friction).
          is_owner: true,
          start_video_off: opts.audioOnly,
          exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
        },
      }),
    });
    if (!res.ok) {
      logger.error(
        { status: res.status },
        "Daily: failed to create meeting token",
      );
      return null;
    }
    const json = (await res.json()) as { token?: string };
    return json.token ?? null;
  } catch (err) {
    logger.error({ err }, "Daily: createToken request failed");
    return null;
  }
}

/**
 * Resolve a ready-to-join Daily URL for a room. Returns null if Daily is not
 * configured or any API call fails, so the caller can fall back to public Jitsi.
 */
export async function getDailyAccess(opts: {
  room: string;
  userName: string;
  audioOnly: boolean;
}): Promise<string | null> {
  if (!API_KEY) return null;
  const name = dailyRoomName(opts.room);
  const roomUrl = await ensureRoom(name);
  if (!roomUrl) return null;
  const token = await createToken({
    room: name,
    userName: opts.userName,
    audioOnly: opts.audioOnly,
  });
  if (!token) return null;
  return `${roomUrl}?t=${token}`;
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
