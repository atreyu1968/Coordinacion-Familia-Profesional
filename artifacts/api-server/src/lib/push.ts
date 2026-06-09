import { db, integrationSettingsTable, pushTokensTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { logger } from "./logger";
import { getSettings } from "./settings";

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
 * Web Push (VAPID) configuration. The keypair is self-generated (no third-party
 * account required) and persisted in the integration_settings row in the
 * database — NOT in environment variables or committed files, since the private
 * key is sensitive cryptographic material. It is generated on first use and
 * reused thereafter. If the database is unreachable, web push degrades silently,
 * mirroring the graceful-degradation pattern used elsewhere.
 */
const DEFAULT_VAPID_SUBJECT = "mailto:admin@coordinaadg.es";

let vapidState: { publicKey: string; configured: boolean } | null = null;
let vapidInit: Promise<{ publicKey: string; configured: boolean }> | null = null;

async function loadOrCreateVapid(): Promise<{
  publicKey: string;
  configured: boolean;
}> {
  const settings = await getSettings();
  let publicKey = settings.vapidPublicKey;
  let privateKey = settings.vapidPrivateKey;
  const subject = settings.vapidSubject ?? DEFAULT_VAPID_SUBJECT;

  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    await db
      .update(integrationSettingsTable)
      .set({
        vapidPublicKey: publicKey,
        vapidPrivateKey: privateKey,
        vapidSubject: subject,
      })
      .where(eq(integrationSettingsTable.id, settings.id));
    logger.info("push: generated and stored a new VAPID keypair");
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return { publicKey, configured: true };
}

/**
 * Ensure the VAPID keypair is loaded (or generated) and registered with the
 * web-push library. Cached after the first successful call; failures are not
 * cached so a transient DB error can be retried on the next send.
 */
async function ensureVapid(): Promise<{
  publicKey: string;
  configured: boolean;
}> {
  if (vapidState) return vapidState;
  if (!vapidInit) {
    vapidInit = loadOrCreateVapid()
      .then((state) => {
        vapidState = state;
        return state;
      })
      .catch((err) => {
        logger.warn({ err }, "push: failed to load/generate VAPID keys");
        vapidInit = null;
        return { publicKey: "", configured: false };
      });
  }
  return vapidInit;
}

export async function isWebPushConfigured(): Promise<boolean> {
  return (await ensureVapid()).configured;
}

export async function getVapidPublicKey(): Promise<string | undefined> {
  const state = await ensureVapid();
  return state.configured ? state.publicKey : undefined;
}

/**
 * Send a Web Push notification to each browser subscription, removing
 * subscriptions the push service reports as expired/gone (404/410).
 */
async function sendWebPush(
  subscriptions: { id: number; token: string }[],
  payload: PushPayload,
): Promise<void> {
  if (subscriptions.length === 0) return;
  const { configured } = await ensureVapid();
  if (!configured) return;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body ?? "",
    data: payload.data ?? {},
  });

  await Promise.all(
    subscriptions.map(async ({ id, token }) => {
      let subscription: webpush.PushSubscription;
      try {
        subscription = JSON.parse(token) as webpush.PushSubscription;
      } catch {
        // Malformed subscription row — drop it (best-effort).
        try {
          await db.delete(pushTokensTable).where(eq(pushTokensTable.id, id));
        } catch (delErr) {
          logger.warn({ delErr }, "push: failed to drop malformed web sub");
        }
        return;
      }
      try {
        await webpush.sendNotification(subscription, body);
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription is no longer valid; prune it.
          try {
            await db.delete(pushTokensTable).where(eq(pushTokensTable.id, id));
          } catch (delErr) {
            logger.warn({ delErr }, "push: failed to prune expired web sub");
          }
        } else {
          logger.warn({ statusCode }, "push: web push send failed");
        }
      }
    }),
  );
}

/**
 * Send a push notification to every registered device of the given users.
 *
 * Graceful degradation: this mirrors the Resend/DeepSeek pattern. Expo's push
 * service requires no API keys; Web Push uses a self-generated VAPID keypair and
 * is skipped when that keypair is absent. If a user has no registered devices,
 * or a push service is unreachable, sending is skipped silently and the (already
 * persisted) in-app notification remains the source of truth. Push delivery is
 * best-effort and never blocks the request.
 */
export async function sendPushToUsers(
  userIds: number[],
  payload: PushPayload,
): Promise<void> {
  if (userIds.length === 0) return;

  let rows: { id: number; token: string; platform: string | null }[] = [];
  try {
    rows = await db
      .select({
        id: pushTokensTable.id,
        token: pushTokensTable.token,
        platform: pushTokensTable.platform,
      })
      .from(pushTokensTable)
      .where(inArray(pushTokensTable.userId, userIds));
  } catch (err) {
    logger.warn({ err }, "push: failed to load device tokens");
    return;
  }

  const expoTokens = rows
    .map((t) => t.token)
    .filter((t) => isExpoPushToken(t));

  const webSubscriptions = rows.filter(
    (t) => t.platform === "web" && !isExpoPushToken(t.token),
  );

  // Best-effort web push (browsers / installed PWA). Never blocks or surfaces
  // failures to the caller.
  void sendWebPush(webSubscriptions, payload).catch((err) => {
    logger.warn({ err }, "push: web push batch failed");
  });

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
