/* Offline shell. App files are cached; live data always goes to the network
   and falls back to the last successful response. */
const VERSION = 'dash-v3';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/core/store.js',
  './js/core/net.js',
  './js/core/ui.js',
  './js/core/registry.js',
  './js/sources/weather.js',
  './js/sources/clock.js',
  './js/sources/calendar.js',
  './js/sources/news.js',
  './js/sources/hackernews.js',
  './js/sources/reddit.js',
  './js/sources/github.js',
  './js/sources/crypto.js',
  './js/sources/stocks.js',
  './js/sources/airquality.js',
  './js/sources/tasks.js',
  './js/sources/notes.js',
  './js/sources/links.js',
  './js/sources/json.js',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => cache.addAll(SHELL).catch(err => console.warn('precache partial', err)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    /* App shell: serve from cache first, refresh in the background. */
    event.respondWith(
      caches.match(request).then(cached => {
        const network = fetch(request).then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then(cache => cache.put(request, copy));
          }
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  /* Live data: network first, last-known-good as a fallback when offline. */
  event.respondWith(
    fetch(request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(VERSION + '-data').then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request).then(hit => hit || Response.error()))
  );
});
