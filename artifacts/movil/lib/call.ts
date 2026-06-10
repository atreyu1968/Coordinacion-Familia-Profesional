import { useRouter } from "expo-router";
import { getMeetingToken } from "@workspace/api-client-react";

type AppRouter = ReturnType<typeof useRouter>;

/**
 * Ask the server for a ready-to-join meeting URL for a room. The server returns
 * a Daily room URL (no login, no per-user cap) when configured, or a public
 * meet.jit.si fallback URL otherwise.
 */
export async function fetchMeetingUrl(
  room: string,
  audioOnly = false,
): Promise<string> {
  const access = await getMeetingToken({ room, audioOnly });
  return access.url;
}

/** Extract the room name from a call link posted in chat, if present. */
export function roomFromUrl(url: string): string | null {
  const m = url.match(/(?:meet\.jit\.si|daily\.co)\/([^\s#?/]+)/);
  return m ? m[1] : null;
}

/**
 * Start or join a call. We push the in-app call screen, which resolves the join
 * URL from the server and then embeds it in a WebView (native) or opens it in
 * the browser (web, where the WebView can't be granted camera/microphone).
 */
export function startCall(
  router: AppRouter,
  opts: { room: string; title?: string; audioOnly?: boolean },
): void {
  const audioOnly = opts.audioOnly ?? false;
  router.push({
    pathname: "/llamada",
    params: {
      room: opts.room,
      title: opts.title ?? (audioOnly ? "Llamada de audio" : "Videollamada"),
      audio: audioOnly ? "1" : "0",
    },
  });
}
