/**
 * Picnic CORS-proxy — Cloudflare Worker
 *
 * De familie-app draait als statische site; browsers mogen de Picnic-API niet
 * rechtstreeks aanroepen (CORS) en kunnen de vereiste User-Agent-header niet
 * zetten. Deze Worker is een dom doorgeefluik dat:
 *   1. verzoeken van jouw eigen app-origins accepteert (CORS),
 *   2. voor de API-paden een gedeeld geheim (x-proxy-key) eist zodat de proxy
 *      niet als open relay door willekeurige scripts/bots gebruikt kan worden,
 *   3. de headers toevoegt die Picnic verwacht,
 *   4. het auth-token (x-picnic-auth) uit het antwoord doorgeeft aan de browser.
 *
 * De Worker bewaart zelf niets. Let op: de beheerder van de Worker kan
 * technisch gezien Cloudflare-logging inschakelen; het verkeer passeert dus
 * versleuteld (TLS) maar niet end-to-end afgeschermd van de Worker-eigenaar.
 *
 * Instellen (gratis):
 *   - Pas ALLOWED_ORIGINS aan naar jouw eigen app-URL('s).
 *   - Stel een geheim in:  npx wrangler secret put PROXY_KEY
 *     en vul dezelfde waarde in de app in (⚙️ → Picnic → Proxy-sleutel).
 *   Zolang PROXY_KEY niet is ingesteld werkt de proxy nog (alleen origin-check),
 *   maar dat is onveilig — stel de sleutel in voor gebruik.
 * Zie de README, sectie "Picnic koppelen".
 */

const PICNIC_BASE = 'https://storefront-prod.nl.picnicinternational.com';

const ALLOWED_ORIGINS = [
  'https://timroewen89.github.io',
  'http://localhost:8000',
];

// Alleen deze API-paden zijn nodig voor de app; al het andere wordt geweigerd.
const ALLOWED_PATHS = [
  '/user/login',
  '/user/2fa/generate',
  '/user/2fa/verify',
  '/user/logout',
  '/pages/search-page-results',
  '/cart/add_product',
  '/cart/remove_product',
];

/** Constante-tijd vergelijking zodat de sleutel niet via timing te raden is. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin);

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'content-type,x-picnic-auth,x-picnic-agent,x-picnic-did,x-proxy-key',
      'Access-Control-Expose-Headers': 'x-picnic-auth',
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Alleen de methoden die de app echt gebruikt.
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('Methode niet toegestaan', { status: 405, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Productafbeeldingen (alleen GET, vast patroon, id-lengte begrensd) — voor
    // de thumbnails. Deze staan vóór de origin-controle: <img>-tags sturen niet
    // altijd een Origin-header mee en de foto's zijn publiek. Er passeert hier
    // geen enkele credential, dus geen proxy-key nodig. De API-paden hieronder
    // blijven wél achter zowel de origin-check als de proxy-key.
    const imageMatch = url.pathname.match(
      /^\/static\/images\/[A-Za-z0-9_-]{1,64}\/(tiny|small|medium|large|extra-large)\.png$/
    );
    if (request.method === 'GET' && imageMatch) {
      const upstream = await fetch(PICNIC_BASE + url.pathname, {
        headers: { 'User-Agent': 'okhttp/4.9.0' },
        cf: { cacheEverything: true, cacheTtl: 86400 },
      });
      const imageHeaders = new Headers(corsHeaders);
      imageHeaders.set('Content-Type', upstream.headers.get('Content-Type') || 'image/png');
      imageHeaders.set('Cache-Control', 'public, max-age=86400');
      return new Response(upstream.body, { status: upstream.status, headers: imageHeaders });
    }

    if (!allowedOrigin) {
      return new Response('Origin niet toegestaan', { status: 403, headers: corsHeaders });
    }

    // Gedeeld geheim: zonder geldige sleutel is de proxy niet bruikbaar, ook
    // niet met een vervalste Origin-header (curl/scripts). Alleen afgedwongen
    // als PROXY_KEY is ingesteld, zodat een verse deploy niet meteen breekt.
    if (env && env.PROXY_KEY) {
      if (!safeEqual(request.headers.get('x-proxy-key') || '', env.PROXY_KEY)) {
        return new Response('Ongeldige proxy-sleutel', { status: 401, headers: corsHeaders });
      }
    }

    const match = url.pathname.match(/^\/api\/\d+(\/.*)$/);
    const apiPath = match ? match[1].split('?')[0] : null;
    if (!apiPath || !ALLOWED_PATHS.some((p) => apiPath === p)) {
      return new Response('Pad niet toegestaan', { status: 404, headers: corsHeaders });
    }

    // Verzoek doorsturen naar Picnic met de headers die hun API verwacht.
    const headers = new Headers({
      'User-Agent': 'okhttp/4.9.0',
      'Content-Type': 'application/json; charset=UTF-8',
      'Accept-Language': 'nl',
    });
    for (const name of ['x-picnic-auth', 'x-picnic-agent', 'x-picnic-did']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    const upstream = await fetch(PICNIC_BASE + url.pathname + url.search, {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : await request.text(),
    });

    const responseHeaders = new Headers(corsHeaders);
    responseHeaders.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    const authToken = upstream.headers.get('x-picnic-auth');
    if (authToken) responseHeaders.set('x-picnic-auth', authToken);

    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  },
};
