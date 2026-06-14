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
const DEFAULT_APP_NAME = "Coordina ADG";

// In-memory cache of the resolved branding icon URL so foreground web
// notifications use the custom favicon when one is configured.
let notificationIconUrl: string | null = null;

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
    // Static fallback first so the PWA shell is valid even if the branding
    // fetch is slow or fails; applyBranding() refines it afterwards.
    ensureLink("manifest", `${BASE_PATH}/manifest.json`);
    // viewport-fit=cover lets the app paint edge-to-edge into the device safe
    // areas (notch / rounded corners / home indicator). Without it an installed
    // PWA letterboxes the content and fills those margins with the white page
    // background, leaving white strips around the blue header and tab bar.
    ensureMeta(
      "viewport",
      "width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover",
    );
    ensureMeta("theme-color", THEME_COLOR);
    ensureMeta("apple-mobile-web-app-capable", "yes");
    ensureMeta("mobile-web-app-capable", "yes");
    ensureMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
    ensureMeta("apple-mobile-web-app-title", DEFAULT_APP_NAME);
    ensureLink("apple-touch-icon", `${BASE_PATH}/apple-touch-icon.png`);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${BASE_PATH}/sw.js`).catch((err) => {
        console.warn("SW registration failed", err);
      });
    }
  } catch (err) {
    console.warn("setupPwa failed", err);
  }

  // Apply DB-configured branding (name + favicon) over the static defaults.
  void applyBranding();
}

interface PublicBranding {
  appName: string | null;
  hasLogo: boolean;
  hasFavicon: boolean;
  version: string;
}

/**
 * Fetch the public branding and apply the custom app name + icon to the
 * document title, Apple web-app metas and the installable web manifest. The
 * manifest is built on the client and injected as a Blob URL so its
 * `start_url`/`scope` resolve to this document's own origin regardless of where
 * the API lives. Best-effort: on any failure the static defaults remain.
 *
 * Note: browsers cache the installed name/icon at install time, so already
 * installed home-screen apps only pick up new branding after a reinstall.
 */
async function applyBranding(): Promise<void> {
  if (!isWeb()) return;
  try {
    const res = await fetch(`${apiBase()}/settings/branding`);
    if (!res.ok) return;
    const b = (await res.json()) as PublicBranding;

    const name = b.appName || DEFAULT_APP_NAME;
    document.title = name;
    ensureMeta("apple-mobile-web-app-title", name);

    const v = encodeURIComponent(b.version || "");
    const iconUrl = b.hasFavicon
      ? `${apiBase()}/settings/branding/favicon?v=${v}`
      : null;
    if (iconUrl) {
      ensureLink("apple-touch-icon", iconUrl);
      notificationIconUrl = iconUrl;
    }

    const origin = window.location.origin;
    const icons = iconUrl
      ? [192, 512].map((size) => ({
          src: iconUrl,
          sizes: `${size}x${size}`,
          type: "image/png",
          purpose: "any maskable",
        }))
      : [192, 512].map((size) => ({
          src: `${origin}${BASE_PATH}/icon-${size}.png`,
          sizes: `${size}x${size}`,
          type: "image/png",
          purpose: "any maskable",
        }));

    const manifest = {
      name,
      short_name: name,
      description:
        "Plataforma de coordinación de la familia profesional ADG en Canarias.",
      start_url: `${origin}${BASE_PATH}/`,
      scope: `${origin}${BASE_PATH}/`,
      display: "standalone",
      orientation: "portrait",
      background_color: "#fbfaf9",
      theme_color: THEME_COLOR,
      lang: "es",
      icons,
    };
    const blob = new Blob([JSON.stringify(manifest)], {
      type: "application/manifest+json",
    });
    ensureLink("manifest", URL.createObjectURL(blob));
  } catch (err) {
    console.warn("applyBranding failed", err);
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
  const icon = notificationIconUrl ?? `${BASE_PATH}/icon-192.png`;
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, {
        body: body ?? "",
        icon,
        badge: icon,
        data: data ?? {},
      });
      return;
    }
    new Notification(title, { body: body ?? "", icon });
  } catch {
    // best-effort
  }
}
