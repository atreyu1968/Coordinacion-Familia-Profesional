const RESUME_MARKER_KEY = "coordina_adg_external_browser_resume";
const MAX_PENDING_RESUME_MS = 5 * 60 * 1000;
const CLOSE_RESUME_GRACE_MS = 2 * 1000;

let openExternalBrowserCount = 0;
let resumeObservedWhileOpen = false;
let closeResumeGraceUntil = 0;
let generation = 0;

function saveResumeMarker(expiresAt: number | null) {
  if (typeof window === "undefined") return;
  try {
    if (expiresAt === null) {
      window.sessionStorage.removeItem(RESUME_MARKER_KEY);
    } else {
      window.sessionStorage.setItem(RESUME_MARKER_KEY, String(expiresAt));
    }
  } catch {
    // Storage can be unavailable in private browsing; in-memory handling still works.
  }
}

function readResumeMarker(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const value = Number(window.sessionStorage.getItem(RESUME_MARKER_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Marks an intentional browser handoff so returning from that link does not
 * immediately trigger the app's biometric lock. The returned function must be
 * called when the browser closes, with false if opening failed.
 */
export function beginExternalBrowserOpen(): (opened?: boolean) => void {
  if (openExternalBrowserCount === 0) {
    resumeObservedWhileOpen = false;
    closeResumeGraceUntil = 0;
  }
  openExternalBrowserCount += 1;
  const currentGeneration = generation;
  saveResumeMarker(Date.now() + MAX_PENDING_RESUME_MS);
  let finished = false;

  return (opened = true) => {
    if (finished || currentGeneration !== generation) return;
    finished = true;
    openExternalBrowserCount = Math.max(0, openExternalBrowserCount - 1);
    if (openExternalBrowserCount > 0) return;

    if (opened && !resumeObservedWhileOpen) {
      closeResumeGraceUntil = Date.now() + CLOSE_RESUME_GRACE_MS;
      saveResumeMarker(closeResumeGraceUntil);
    } else {
      closeResumeGraceUntil = 0;
      saveResumeMarker(null);
    }
    resumeObservedWhileOpen = false;
  };
}

/**
 * Consumes the one-time exemption on app resume or after a cold PWA restore.
 * A marker is kept while the external browser is still open, so a reload caused
 * by the browser handoff does not send the user to the biometric login screen.
 */
export function consumeExternalBrowserResumeExemption(): boolean {
  if (openExternalBrowserCount > 0) {
    resumeObservedWhileOpen = true;
    return true;
  }

  const expiresAt = Math.max(closeResumeGraceUntil, readResumeMarker() ?? 0);
  closeResumeGraceUntil = 0;
  saveResumeMarker(null);
  return expiresAt > Date.now();
}

/** Explicit sign-out/account changes must cancel any pending exemption. */
export function clearExternalBrowserResumeExemption() {
  generation += 1;
  openExternalBrowserCount = 0;
  resumeObservedWhileOpen = false;
  closeResumeGraceUntil = 0;
  saveResumeMarker(null);
}

/** Keep the exemption active until an opened browser tab is actually closed. */
export function watchExternalBrowserTab(tab: { readonly closed: boolean }) {
  const finish = beginExternalBrowserOpen();
  let finished = false;
  let interval: number | undefined;

  const stop = (opened = true) => {
    if (finished) return;
    finished = true;
    if (interval !== undefined && typeof window !== "undefined") {
      window.clearInterval(interval);
    }
    finish(opened);
  };

  // Unit-test doubles do not expose Window.closed; real browser windows do.
  if (typeof window === "undefined" || typeof tab.closed !== "boolean") {
    stop(true);
    return stop;
  }

  interval = window.setInterval(() => {
    if (tab.closed) stop(true);
  }, 250);
  return stop;
}
