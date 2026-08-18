/**
 * Unit-test voor de fetch-logica van de service worker (sw.js):
 * cache-first, netwerk+cachen bij een miss, offline-fallback naar de
 * app-schil bij navigaties, en Response.error voor overige misses.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', '..', 'sw.js'), 'utf8');

class Resp {
  constructor(body, init = {}) {
    this.body = body;
    this.status = init.status || 200;
    this.ok = this.status < 400;
  }
  clone() { return this; }
  static error() {
    const r = new Resp(null, { status: 0 });
    r.ok = false;
    r.__error = true;
    return r;
  }
}
globalThis.Response = Resp;

const ORIGIN = 'https://app.test';
const cacheStore = new Map();
const norm = (k) => new URL(typeof k === 'string' ? k : k.url, ORIGIN + '/').href;
const cache = {
  async match(req) { return cacheStore.get(norm(req)); },
  async put(req, res) { cacheStore.set(norm(req), res); },
  async addAll() {},
};
globalThis.caches = { async open() { return cache; }, async keys() { return []; }, async delete() {} };
const listeners = {};
globalThis.self = {
  addEventListener: (type, fn) => { listeners[type] = fn; },
  location: { origin: ORIGIN },
  skipWaiting() {},
  clients: { claim() {} },
};

eval(src.replace(/self\.location\.origin/g, `'${ORIGIN}'`));

function runFetch(request, netImpl) {
  globalThis.fetch = netImpl;
  let responded;
  listeners.fetch({ request, respondWith: (p) => { responded = p; }, waitUntil: () => {} });
  return responded;
}
const req = (url, mode = 'cors') => ({ url, method: 'GET', mode });

function check(name, cond) {
  if (!cond) {
    console.error('FAAL:', name);
    process.exit(1);
  }
  console.log('OK  ', name);
}

// 1. Gecacht bestand komt uit de cache, ook als het netwerk stuk is
cacheStore.set(`${ORIGIN}/css/style.css`, new Resp('CACHED-CSS'));
let r = await runFetch(req(`${ORIGIN}/css/style.css`), () => Promise.reject(new Error('offline')));
check('gecacht bestand offline geserveerd', r.body === 'CACHED-CSS');

// 2. Niet-gecacht + online: netwerk en daarna gecachet
r = await runFetch(req(`${ORIGIN}/nieuw.js`), () => Promise.resolve(new Resp('NET-JS')));
check('netwerkantwoord doorgegeven', r.body === 'NET-JS');
check('antwoord opgeslagen in cache', cacheStore.has(`${ORIGIN}/nieuw.js`));

// 3. Navigatie offline zonder cache-hit: app-schil als fallback
cacheStore.set(`${ORIGIN}/index.html`, new Resp('SHELL'));
r = await runFetch(req(`${ORIGIN}/onbekende-route`, 'navigate'), () => Promise.reject(new Error('offline')));
check('navigatie valt terug op app-schil', r.body === 'SHELL');

// 4. Overige offline misses: nette Response.error, geen undefined
r = await runFetch(req(`${ORIGIN}/plaatje.png`), () => Promise.reject(new Error('offline')));
check('asset offline geeft Response.error', r && r.__error === true);

console.log('SW-TESTS GESLAAGD');
