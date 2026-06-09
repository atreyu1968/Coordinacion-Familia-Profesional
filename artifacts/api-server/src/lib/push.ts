import { db, pushTokensTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "./logger";

const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";

interface PushPayload {
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
}

function isExpoPushToken(token: string): boolean {
  return (
    token.startsWith("ExponentPushToken[") ||
    token.startsWith("ExpoPushToken[")
  );
}

/**
 * Send a push notification to every registered device of the given users.
 *
 * Graceful degradation: this mirrors the Resend/DeepSeek pattern. There are no
 * API keys to configure — Expo's push service requires none. If a user has no
 * registered device tokens, or the Expo service is unreachable, sending is
 * skipped silently and the (already persisted) in-app notification is the
 * source of truth. Push delivery is best-effort and never blocks the request.
 */
export async function sendPushToUsers(
  userIds: number[],
  payload: PushPayload,
): Promise<void> {
  if (userIds.length === 0) return;

  let tokens: { token: string }[] = [];
  try {
    tokens = await db
      .select({ token: pushTokensTable.token })
      .from(pushTokensTable)
      .where(inArray(pushTokensTable.userId, userIds));
  } catch (err) {
    logger.warn({ err }, "push: failed to load device tokens");
    return;
  }

  const expoTokens = tokens
    .map((t) => t.token)
    .filter((t) => isExpoPushToken(t));

  if (expoTokens.length === 0) return;

  const messages = expoTokens.map((to) => ({
    to,
    sound: "default" as const,
    title: payload.title,
    body: payload.body ?? "",
    data: payload.data ?? {},
  }));

  try {
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status },
        "push: Expo service returned non-OK status",
      );
    }
  } catch (err) {
    // Best-effort: never surface push failures to the caller.
    logger.warn({ err }, "push: Expo send failed");
  }
}
