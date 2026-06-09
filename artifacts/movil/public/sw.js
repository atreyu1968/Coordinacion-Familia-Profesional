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
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: payload.data || {},
    tag: (payload.data && payload.data.tag) || undefined,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetPath = typeof data.path === "string" ? data.path : "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client && targetPath !== "/") {
              client.navigate(targetPath).catch(() => {});
            }
            return undefined;
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetPath);
        }
        return undefined;
      }),
  );
});
