/* PokéVault service worker – app shell + card image cache, no build step. */
const VERSION = 'pv-v1';
const SHELL = `${VERSION}-shell`;
const IMAGES = `${VERSION}-images`;
const IMAGE_HOSTS = ['assets.tcgdex.net'];
const RUNTIME_HOSTS = ['cdn.jsdelivr.net', 'tessdata.projectnaptha.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(['./', './manifest.json']).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = (await cache.match(request)) || (await cache.match('./'));
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => hit);
  return hit || refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (IMAGE_HOSTS.includes(url.hostname) || RUNTIME_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, IMAGES));
    return;
  }
  // TCGdex API and sync backends are always fetched live.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL));
    return;
  }
  if (url.pathname.includes('/_next/static/')) {
    event.respondWith(cacheFirst(request, SHELL));
    return;
  }
  event.respondWith(staleWhileRevalidate(request, SHELL));
});
