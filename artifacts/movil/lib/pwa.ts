/**
 * Progressive Web App support — WEB ONLY.
 *
 * Expo's default web output is a single-page app, so the static `+html.tsx`
 * document is not rendered in this configuration. Instead we inject the PWA
 * manifest + metadata and register the service worker at runtime, once the app
 * has booted in a browser. All functions here are no-ops on native platforms.
 *
 * Web Push uses a self-generated VAPID keypair served by the API. If the API
 * reports no key (web push disabled) or the user denies permission, everything
 * degrades gracefully and the in-app notifications remain the source of truth.
 */
import { Platform } from "react-native";

import { getAuthToken } from "@/contexts/AuthContext";

const THEME_COLOR = "#0050b3";

// Sub-path the web build is served under (e.g. "/app" in production). Empty in
// dev / root deployments. Baked in at build time via EXPO_PUBLIC_BASE_PATH so
// the manifest, service worker and icons resolve to the correct URLs.
const BASE_PATH = (process.env.EXPO_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");

function isWeb(): boolean {
  return Platform.OS === "web" && typeof document !== "undefined";
}

function apiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return `https://${domain}/api`;
}

function ensureMeta(name: string, content: string): void {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function ensureLink(rel: string, href: string): void {
  let el = document.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Inject the PWA manifest + metadata and register the service worker. Safe to
 * call multiple times — every mutation is idempotent.
 */
export function setupPwa(): void {
  if (!isWeb()) return;
  try {
    ensureLink("manifest", `${BASE_PATH}/manifest.json`);
    ensureMeta("theme-color", THEME_COLOR);
    ensureMeta("apple-mobile-web-app-capable", "yes");
    ensureMeta("mobile-web-app-capable", "yes");
    ensureMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
    ensureMeta("apple-mobile-web-app-title", "Coordina ADG");
    ensureLink("apple-touch-icon", `${BASE_PATH}/apple-touch-icon.png`);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${BASE_PATH}/sw.js`).catch((err) => {
        console.warn("SW registration failed", err);
      });
    }
  } catch (err) {
    console.warn("setupPwa failed", err);
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function fetchVapidPublicKey(token: string): Promise<string | null> {
  try {
    const res = await fetch(`${apiBase()}/push/vapid-public-key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { key?: string };
    return json.key ?? null;
  } catch {
    return null;
  }
}

/**
 * Subscribe the current browser to Web Push and register the subscription with
 * the API (stored as a `web` push token). Best-effort: any failure is swallowed.
 */
export async function registerWebPush(): Promise<void> {
  if (!isWeb()) return;
  if (
    !("serviceWorker" in navigator) ||
    typeof window === "undefined" ||
    !("PushManager" in window) ||
    typeof Notification === "undefined"
  ) {
    return;
  }

  const token = await getAuthToken();
  if (!token) return;

  try {
    const vapidKey = await fetchVapidPublicKey(token);
    if (!vapidKey) return; // web push disabled server-side

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;

    const reg = await navigator.serviceWorker.ready;
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });
    }

    await fetch(`${apiBase()}/push-tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        token: JSON.stringify(subscription),
        platform: "web",
      }),
    });
  } catch (err) {
    console.warn("registerWebPush failed", err);
  }
}

/**
 * Show a notification for a foreground event (app open in the browser). Uses the
 * service worker registration when available so clicks are routed consistently.
 */
export async function showLocalNotification(
  title: string,
  body?: string | null,
  data?: Record<string, unknown>,
): Promise<void> {
  if (!isWeb() || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, {
        body: body ?? "",
        icon: `${BASE_PATH}/icon-192.png`,
        badge: `${BASE_PATH}/icon-192.png`,
        data: data ?? {},
      });
      return;
    }
    new Notification(title, { body: body ?? "", icon: `${BASE_PATH}/icon-192.png` });
  } catch {
    // best-effort
  }
}
