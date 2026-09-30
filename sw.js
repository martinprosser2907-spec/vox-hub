// ---------------------------------------------------------------------------
// Service worker. Makes the hub installable and keeps it usable offline.
//
// NETWORK FIRST, deliberately. A cache-first worker serves a stale build after
// every deploy, which on a project like this means somebody reads last week's
// figures and believes them. Falling back to cache only when the network is
// actually gone is the right trade for an intranet.
//
// Adapted from the Calla employee portal.
// ---------------------------------------------------------------------------
const VERSION = "vox-hub-v1";

self.addEventListener("install",  () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheable(req) {
  if (req.method !== "GET") return false;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return false;   // never Firebase or Google
  if (url.pathname.startsWith("/__/")) return false;  // Firebase reserved
  return true;
}

self.addEventListener("fetch", (e) => {
  if (!cacheable(e.request)) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(hit =>
          hit || caches.match("/index.html") ||
          new Response("You appear to be offline.", {
            status: 503, headers: { "Content-Type": "text/plain" }
          })))
  );
});
