/**
 * Service worker: cachet de app-schil zodat de app op mobiel snel start
 * en offline blijft werken (de boodschappenlijst werkt dan gewoon door;
 * alleen de Google Calendar-data vereist internet).
 */
const CACHE_NAME = 'familie-app-v26';
const APP_SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/calendar.js',
  'js/shopping.js',
  'js/tags.js',
  'js/picnic.js',
  'js/icons.js',
  'js/settings.js',
  'js/sync.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
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
  const req = event.request;
  const url = new URL(req.url);
  // Alleen eigen bestanden cachen; Google API's en login altijd via het netwerk.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const fromNetwork = fetch(req).then((response) => {
      if (response.ok) cache.put(req, response.clone());
      return response;
    });

    // Stale-while-revalidate: uit cache serveren, op de achtergrond verversen.
    if (cached) {
      event.waitUntil(fromNetwork.catch(() => {}));
      return cached;
    }

    try {
      return await fromNetwork;
    } catch {
      // Offline én niet gecachet: bij een paginanavigatie de app-schil teruggeven,
      // zodat de app opent i.p.v. een browserfout.
      if (req.mode === 'navigate') {
        return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
      }
      return Response.error();
    }
  })());
});
