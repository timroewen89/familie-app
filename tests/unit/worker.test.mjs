/**
 * Unit-tests voor de Cloudflare Worker (worker/picnic-proxy.js):
 * routing, CORS, proxy-sleutel, methode-allowlist en de afbeeldingsroute.
 * De worker is een ES-module; we kopiëren hem naar een .mjs in tmp om hem
 * te kunnen importeren vanuit deze CommonJS-package.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerSrc = path.join(here, '..', '..', 'worker', 'picnic-proxy.js');
const tmpCopy = path.join(os.tmpdir(), `picnic-proxy-${process.pid}.mjs`);
fs.copyFileSync(workerSrc, tmpCopy);
const worker = (await import(pathToFileURL(tmpCopy))).default;
fs.unlinkSync(tmpCopy);

let upstream = null;
globalThis.fetch = async (url, opts) => {
  upstream = { url, opts };
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'x-picnic-auth': 'UPSTREAM-TOKEN' },
  });
};

const base = 'https://picnic-proxy.test.workers.dev';
const origin = 'https://timroewen89.github.io';
const KEY = 'geheim-sleutel-123';
const req = (p, opts = {}) => new Request(base + p, opts);

function check(name, cond) {
  if (!cond) {
    console.error('FAAL:', name);
    process.exit(1);
  }
  console.log('OK  ', name);
}

// Preflight
let res = await worker.fetch(req('/api/15/user/login', { method: 'OPTIONS', headers: { Origin: origin } }), {});
check('preflight 204', res.status === 204);
check('preflight staat x-proxy-key toe', res.headers.get('Access-Control-Allow-Headers').includes('x-proxy-key'));

// Origin-checks
res = await worker.fetch(req('/api/15/user/login', { method: 'POST', headers: { Origin: 'https://kwaadaardig.nl' }, body: '{}' }), {});
check('vreemde origin geweigerd (403)', res.status === 403);
res = await worker.fetch(req('/api/15/user/login', { method: 'POST', body: '{}' }), {});
check('API zonder Origin geweigerd (403)', res.status === 403);

// Pad-allowlist
res = await worker.fetch(req('/api/15/user/delete_account', { method: 'POST', headers: { Origin: origin }, body: '{}' }), {});
check('verboden pad geweigerd (404)', res.status === 404);

// Proxy-sleutel
res = await worker.fetch(req('/api/15/user/login', { method: 'POST', headers: { Origin: origin }, body: '{}' }), {});
check('zonder PROXY_KEY werkt origin-only nog', res.status === 200);
res = await worker.fetch(req('/api/15/user/login', { method: 'POST', headers: { Origin: origin, 'x-proxy-key': KEY }, body: '{}' }), { PROXY_KEY: KEY });
check('juiste sleutel geaccepteerd', res.status === 200);
check('nosniff aanwezig', res.headers.get('X-Content-Type-Options') === 'nosniff');
check('token doorgegeven', res.headers.get('x-picnic-auth') === 'UPSTREAM-TOKEN');
check('CORS-origin geëchood', res.headers.get('Access-Control-Allow-Origin') === origin);
res = await worker.fetch(req('/api/15/user/login', { method: 'POST', headers: { Origin: origin }, body: '{}' }), { PROXY_KEY: KEY });
check('gespoofte origin zonder sleutel geweigerd (401)', res.status === 401);
res = await worker.fetch(req('/api/15/user/login', { method: 'POST', headers: { Origin: origin, 'x-proxy-key': 'fout' }, body: '{}' }), { PROXY_KEY: KEY });
check('verkeerde sleutel geweigerd (401)', res.status === 401);

// Methoden
res = await worker.fetch(req('/api/15/cart/add_product', { method: 'DELETE', headers: { Origin: origin, 'x-proxy-key': KEY } }), { PROXY_KEY: KEY });
check('DELETE geweigerd (405)', res.status === 405);

// Doorsturen met juiste headers
res = await worker.fetch(req('/api/15/pages/search-page-results?search_term=melk', {
  method: 'GET', headers: { Origin: origin, 'x-picnic-auth': 'TOK', 'x-proxy-key': KEY },
}), { PROXY_KEY: KEY });
check('zoekpad doorgestuurd', upstream.url.startsWith('https://storefront-prod.nl.picnicinternational.com/api/15/pages/search-page-results'));
check('User-Agent gezet', upstream.opts.headers.get('User-Agent') === 'okhttp/4.9.0');
check('auth-header doorgestuurd', upstream.opts.headers.get('x-picnic-auth') === 'TOK');

// Afbeeldingsroute
res = await worker.fetch(req('/static/images/abc123/small.png', { method: 'GET' }), { PROXY_KEY: KEY });
check('afbeelding zonder Origin/sleutel toegestaan', res.status === 200);
check('afbeelding cache-header', res.headers.get('Cache-Control') === 'public, max-age=86400');
res = await worker.fetch(req('/static/images/abc123/gigantisch.png', { method: 'GET', headers: { Origin: origin } }), {});
check('onbekende maat geweigerd', res.status !== 200);
res = await worker.fetch(req(`/static/images/${'a'.repeat(80)}/small.png`, { method: 'GET', headers: { Origin: origin } }), {});
check('te lange image-id geweigerd', res.status !== 200);

console.log('WORKER-TESTS GESLAAGD');
