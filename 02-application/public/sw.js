/* FlowBoard service worker (PRD §6.1 / §6.6)
 * Handles the `push` and `notificationclick` events.
 * Keep this hand-written (rather than next-pwa) so the push handler is
 * explicit and survives Next.js build changes.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* Incoming push → show a notification. */
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "FlowBoard";
  const options = {
    body: data.body || "",
    tag: data.tag || "flowboard",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: data.data || {},
    // renotify true so same-tag notifications still surface on some platforms
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* Tap on a notification → open the app straight to the task, or focus an
 * already-open tab (PRD F-6.6). */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/boards";
  const target = new URL(url, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
