import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { notificationRoute } from "./notification-route";

import { registerPushToken } from "@workspace/api-client-react";

export type PushRegistrationResult =
  | "registered"
  | "permission-required"
  | "permission-blocked"
  | "unsupported"
  | "failed";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Register this physical device with the API. Login may register silently when
 * permission was already granted; the first permission prompt is initiated by
 * the user's action in the Avisos screen.
 */
export async function registerForPushNotifications(
  requestPermission = false,
): Promise<PushRegistrationResult> {
  try {
    if (Platform.OS === "web" || !Device.isDevice) return "unsupported";

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Avisos",
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: "default",
      });
    }

    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) {
      if (!requestPermission) {
        return permission.canAskAgain
          ? "permission-required"
          : "permission-blocked";
      }
      if (!permission.canAskAgain) return "permission-blocked";
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted) {
      return permission.canAskAgain
        ? "permission-required"
        : "permission-blocked";
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = tokenResponse.data;
    if (!token) return "failed";

    await registerPushToken({
      token,
      platform: Platform.OS === "ios" ? "ios" : "android",
    });
    return "registered";
  } catch {
    return "failed";
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
      const target = notificationRoute(
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
