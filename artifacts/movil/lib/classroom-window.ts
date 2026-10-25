import { watchExternalBrowserTab } from "./external-browser-resume";

const HANDOFF_KEY = "coordina_adg_classroom_handoff";

/** Open only an internal classroom, from an already unlocked catalogue. */
export function openClassroomWindow(courseId: number): void {
  if (!Number.isSafeInteger(courseId) || courseId <= 0) {
    throw new Error("El curso no es válido.");
  }
  const configuredBase = (process.env.EXPO_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");
  // Older PWA builds may not have the build-time base path injected.
  const catalogueBase = window.location.pathname.match(/^(.*)\/lms\/?$/)?.[1] ?? "";
  const url = new URL(`${configuredBase || catalogueBase}/lms/${courseId}`, window.location.origin);
  const tab = window.open("about:blank", "_blank");
  if (!tab) throw new Error("El navegador ha bloqueado la ventana. Permite las ventanas emergentes y vuelve a intentarlo.");
  const stopWatching = watchExternalBrowserTab(tab);
  try {
    // Session storage belongs to the destination tab only. Never put a token
    // in a URL or disable biometric protection for unrelated tabs/cold starts.
    tab.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({
      pathname: url.pathname,
      expiresAt: Date.now() + 60_000,
    }));
    tab.opener = null;
    tab.location.replace(url.href);
  } catch {
    tab.close();
    stopWatching(false);
    throw new Error("No se pudo abrir el aula conservando la sesión.");
  }
}

/** One-use exception, restricted to the exact classroom just opened. */
export function consumeClassroomHandoff(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_KEY);
    window.sessionStorage.removeItem(HANDOFF_KEY);
    if (!raw) return false;
    const marker = JSON.parse(raw);
    return typeof marker.pathname === "string" &&
      /\/lms\/[1-9]\d*$/.test(marker.pathname) &&
      marker.pathname === window.location.pathname &&
      typeof marker.expiresAt === "number" &&
      marker.expiresAt > Date.now() &&
      marker.expiresAt <= Date.now() + 60_000;
  } catch {
    return false;
  }
}
