/*
 * Adhyaapak service worker.
 *
 * What it caches (explicit, versioned): the app shell (index.html), the hashed build files it references,
 * the manifest and the icon. That is all. It never caches API responses: lesson packs and queued work live
 * in IndexedDB, where the app controls them, and student data is never put in a shared cache.
 *
 * Bump SHELL_VERSION when this file's behaviour changes; old caches are deleted on activate.
 */
const SHELL_VERSION = "v1";
const SHELL_CACHE = `adhyaapak-shell-${SHELL_VERSION}`;
const STATIC = ["/", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(STATIC);
      // The built page names its hashed script and style files; cache exactly those.
      const html = await (await fetch("/", { cache: "no-store" })).text();
      const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      await cache.addAll([...new Set(assets)]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("adhyaapak-shell-") && n !== SHELL_CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never touch the API: it is private, changes constantly, and must fail visibly when the server is unreachable.
  if (url.pathname.startsWith("/api/")) return;

  // Page loads: the network first (so updates arrive), falling back to the cached app, which then routes client-side.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          return fresh;
        } catch {
          const cached = await caches.match("/");
          return cached ?? new Response("Offline, and the app has not been saved on this device yet.", { status: 503, headers: { "Content-Type": "text/plain" } });
        }
      })(),
    );
    return;
  }

  // Built files have content hashes in their names, so a cached copy is always correct.
  if (url.pathname.startsWith("/assets/") || STATIC.includes(url.pathname)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const fresh = await fetch(req);
        if (fresh.ok) (await caches.open(SHELL_CACHE)).put(req, fresh.clone());
        return fresh;
      })(),
    );
  }
});
