import { Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";

const JITSI_BASE = "https://meet.jit.si";

type AppRouter = ReturnType<typeof useRouter>;

/**
 * Build a Jitsi room URL with in-app friendly config:
 * - disableDeepLinking: stop meet.jit.si from trying to bounce to the native
 *   Jitsi app, so the call stays inside our WebView.
 * - prejoinPageEnabled=false: join straight away (no extra "ready to join" step).
 * - startAudioOnly: opt into an audio-only call (camera stays off).
 */
export function jitsiUrl(roomName: string, audioOnly = false): string {
  const cfg = [
    "config.disableDeepLinking=true",
    "config.prejoinPageEnabled=false",
    // Cut analytics/promo calls so hang-up doesn't bounce to meet.jit.si ads.
    "config.disableThirdPartyRequests=true",
  ];
  if (audioOnly) cfg.push("config.startAudioOnly=true");
  return `${JITSI_BASE}/${roomName}#${cfg.join("&")}`;
}

/** Extract the Jitsi room name from a full meet.jit.si URL, if present. */
export function roomFromUrl(url: string): string | null {
  const m = url.match(/meet\.jit\.si\/([^\s#?/]+)/);
  return m ? m[1] : null;
}

/**
 * Start or join a call. On native we embed Jitsi in an in-app WebView screen so
 * the user never leaves the app. On web (where the WebView can't be granted
 * camera/microphone access) we open the room in a new browser tab instead.
 */
export function startCall(
  router: AppRouter,
  opts: { room: string; title?: string; audioOnly?: boolean },
): void {
  const audioOnly = opts.audioOnly ?? false;
  if (Platform.OS === "web") {
    void WebBrowser.openBrowserAsync(jitsiUrl(opts.room, audioOnly));
    return;
  }
  router.push({
    pathname: "/llamada",
    params: {
      room: opts.room,
      title: opts.title ?? (audioOnly ? "Llamada de audio" : "Videollamada"),
      audio: audioOnly ? "1" : "0",
    },
  });
}
