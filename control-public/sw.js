// Zenbox Service Worker
//
// - App shell: NETWORK-FIRST with cache fallback. Updates ship immediately;
//   offline still works after the first successful load.
// - /linux/ assets (kernel, rootfs, BIOS, wasm): STALE-WHILE-REVALIDATE.
//   These are large, rarely-changing files — cached at runtime so the Real
//   Linux sandbox boots fully offline after the first boot.
// - On activate, purge any caches from older versions.

const CACHE_PREFIX = "zenbox-";
const LINUX_CACHE = `${CACHE_PREFIX}linux-v2`;
const SHELL_CACHE = `${CACHE_PREFIX}shell-v2`;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

// The app asks the new worker to take over immediately when it applies an
// update (see src/lib/updater.ts) so the restart lands on the new shell.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(CACHE_PREFIX) && k !== LINUX_CACHE && k !== SHELL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      ),
  );
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Big, stable Linux assets → cache-first with background refresh.
  if (url.pathname.startsWith("/linux/")) {
    event.respondWith(
      caches.open(LINUX_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }

  // Everything else → network-first, fall back to cache when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && (url.pathname === "/" || url.pathname.startsWith("/assets/"))) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req)) || caches.match("/")),
  );
});
