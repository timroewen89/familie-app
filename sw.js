/**
 * Service worker: cachet de app-schil zodat de app op mobiel snel start
 * en offline blijft werken (de boodschappenlijst werkt dan gewoon door;
 * alleen de Google Calendar-data vereist internet).
 */
const CACHE_NAME = 'familie-app-v2';
const APP_SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/calendar.js',
  'js/shopping.js',
  'js/tags.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Alleen eigen bestanden cachen; Google API's en login altijd via het netwerk.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Stale-while-revalidate: direct uit cache, op de achtergrond verversen.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
