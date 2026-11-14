/* Lunchrad service worker. Built by scripts/build-sw.mjs, which replaces
 * the two placeholders below. Hand-written on purpose: small, and every
 * rule is visible here.
 *
 * - Hashed files (JS, CSS, fonts, icons) are cached at install and served
 *   from the cache: they never change under the same name.
 * - Pages (navigations) always go to the network first, so the app shell
 *   and its CSP nonce stay fresh. Only when the network fails is the cached
 *   shell used, so the app opens offline and can say so.
 * - /api and /admin are never cached and never answered from a cache.
 * - Nothing from another origin is touched.
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `lunchrad-${VERSION}`;
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE);
      // The shell is fetched fresh (with its own nonce and CSP) for offline use.
      const shell = await fetch(SHELL, { cache: 'no-store', credentials: 'omit' });
      if (shell.ok) await cache.put(SHELL, shell);
    })(),
  );
  // No skipWaiting here: the app asks the person first (see "update").
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('lunchrad-') && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'update') self.skipWaiting();
});

function neverCache(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname === '/admin' ||
    url.pathname.startsWith('/admin/') ||
    url.pathname === '/sw.js'
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || neverCache(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cached = await caches.match(SHELL, { cacheName: CACHE });
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(
      (async () => (await caches.match(url.pathname, { cacheName: CACHE })) ?? fetch(request))(),
    );
  }
});
