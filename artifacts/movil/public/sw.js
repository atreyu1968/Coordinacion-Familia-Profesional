/* Coordina ADG service worker — PWA installability + Web Push.
 * Intentionally minimal: no offline caching strategy, just enough to be an
 * installable PWA and to receive push notifications. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// A no-op fetch handler is required for the browser to consider the app
// installable on some platforms.
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_e) {
    payload = { title: "Coordina ADG", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Coordina ADG";
  // Icons are resolved relative to this worker's URL, so they work whether the
  // app is served from the root or from a sub-path (e.g. /app/sw.js).
  const options = {
    body: payload.body || "",
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: payload.data || {},
    tag: (payload.data && payload.data.tag) || undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const rawPath = typeof data.path === "string" ? data.path : "/";
  // Resolve the in-app route against this worker's scope so deep links land on
  // the right URL whether the app lives at the root or under a sub-path (/app/).
  const targetUrl = new URL(rawPath.replace(/^\//, ""), self.registration.scope)
    .href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client && rawPath !== "/") {
              client.navigate(targetUrl).catch(() => {});
            }
            return undefined;
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      }),
  );
});
