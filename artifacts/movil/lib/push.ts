import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useRouter, type Href } from "expo-router";

import { registerPushToken } from "@workspace/api-client-react";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

/**
 * Best-effort push registration. Follows the graceful-degradation pattern of
 * the rest of the platform: any failure (web, simulator, denied permission,
 * missing projectId) is swallowed so the app keeps working without push.
 */
export async function registerForPushNotifications(): Promise<void> {
  try {
    if (Platform.OS === "web") return;
    if (!Device.isDevice) return;

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "General",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResponse.data;
    if (!token) return;

    await registerPushToken({
      token,
      platform: Platform.OS === "ios" ? "ios" : "android",
    });
  } catch {
    // Graceful: push is optional. In-app notifications still work.
  }
}

/**
 * Map a push notification's `data` payload to the in-app route it should open.
 * The backend tags every push with a `type` (and, for chats, a `groupId`) so a
 * tapped notification can deep-link straight to the relevant screen.
 */
function deepLinkFromData(data: unknown): Href | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;
  switch (payload.type) {
    case "message": {
      const groupId = payload.groupId;
      if (groupId == null) return "/(tabs)/chat";
      return { pathname: "/chat/[id]", params: { id: String(groupId) } };
    }
    case "announcement":
      return "/(tabs)";
    case "company_alert":
      return "/alerts";
    default:
      return "/(tabs)/notifications";
  }
}

/**
 * Deep-link the user to the relevant screen when they tap a push notification,
 * covering both warm taps (app already running) and cold starts (the
 * notification launched the app). Only navigates while authenticated so taps
 * never bypass the login gate. No-op on web, where the native notification
 * APIs are unavailable.
 */
export function useNotificationDeepLinks(enabled: boolean): void {
  const router = useRouter();
  const handledIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || Platform.OS === "web") return;

    const handle = (response: Notifications.NotificationResponse) => {
      const identifier = response.notification.request.identifier;
      if (handledIdRef.current === identifier) return;
      const target = deepLinkFromData(
        response.notification.request.content.data,
      );
      if (!target) return;
      handledIdRef.current = identifier;
      router.push(target);
    };

    const subscription =
      Notifications.addNotificationResponseReceivedListener(handle);

    // Cold start: the notification (if any) that launched the app.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handle(response);
    });

    return () => subscription.remove();
  }, [enabled, router]);
}
