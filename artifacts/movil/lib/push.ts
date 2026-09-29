import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { useRouter, type Href } from "expo-router";

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
      return "/(tabs)/notifications";
    case "company_alert":
      return "/alerts";
    case "survey": {
      const surveyId = payload.surveyId;
      if (surveyId == null) return "/surveys";
      return { pathname: "/survey/[id]", params: { id: String(surveyId) } };
    }
    case "document_form": {
      const formId = payload.documentFormId;
      if (formId == null) return "/forms";
      return { pathname: "/form/[id]", params: { id: String(formId) } };
    }
    case "meeting":
      return "/videoconferencias";
    case "year_confirmation":
      return "/confirmar-curso";
    case "forum_thread":
    case "forum_reply": {
      const threadId = payload.threadId;
      if (threadId == null) return "/foros";
      return {
        pathname: "/foros/tema/[id]",
        params: { id: String(threadId) },
      };
    }
    case "event":
    case "calendar":
      return "/(tabs)";
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
