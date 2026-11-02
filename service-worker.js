/* Fleet Health PWA - versioned app shell + optional CDN dependency cache. */
const VERSION = '2026-11-02-v1';
const PREFIX = 'fleet-health-pwa-';
const SHELL_CACHE = PREFIX + 'shell-' + VERSION;
const LIB_CACHE = PREFIX + 'libraries-' + VERSION;
const APP_SHELL = [
  './index.html',
  './manifest.webmanifest',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];
const CDN_DEPENDENCIES = [
  'https://cdn.tailwindcss.com/',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

async function precacheDependency(url, cache) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    // Cross-origin scripts can produce opaque responses; Cache Storage supports them.
    const response = await fetch(url, { mode: 'no-cors', signal: controller.signal });
    if (response.ok || response.type === 'opaque') await cache.put(url, response);
  } catch (_) {
    // External CDNs are optional; the PWA shell should remain installable without them.
  } finally {
    clearTimeout(timeout);
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(APP_SHELL);
    const libs = await caches.open(LIB_CACHE);
    await Promise.allSettled(CDN_DEPENDENCIES.map(url => precacheDependency(url, libs)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && ![SHELL_CACHE, LIB_CACHE].includes(key))
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Google Sheets, proxy responses and other API data are intentionally never SW-cached.
  // Existing localStorage-based CSV cache in index.html supplies the last sync offline.
  if (CDN_DEPENDENCIES.includes(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(LIB_CACHE);
      const cached = await cache.match(url.href);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') await cache.put(url.href, response.clone());
        return response;
      } catch (_) { return Response.error(); }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const fresh = await fetch(request);
        if (fresh.ok) await cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (_) {
        return (await cache.match(request)) || (await cache.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch (_) { return Response.error(); }
  })());
});
