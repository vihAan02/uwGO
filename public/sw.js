// Minimal service worker: makes the app installable. No route/API caching (routing data must stay fresh).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
