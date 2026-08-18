/**
 * Picnic CORS-proxy — Cloudflare Worker
 *
 * De familie-app draait als statische site; browsers mogen de Picnic-API niet
 * rechtstreeks aanroepen (CORS) en kunnen de vereiste User-Agent-header niet
 * zetten. Deze Worker is een dom doorgeefluik dat:
 *   1. alleen verzoeken van jouw eigen app-origins accepteert,
 *   2. de headers toevoegt die Picnic verwacht,
 *   3. het auth-token (x-picnic-auth) uit het antwoord doorgeeft aan de browser.
 *
 * De Worker slaat NIETS op en logt NIETS. Inloggegevens en tokens blijven in
 * de browser van de gebruiker; ze passeren deze proxy alleen versleuteld (TLS).
 *
 * Deployen (gratis): zie de README, sectie "Picnic koppelen".
 * Pas ALLOWED_ORIGINS aan naar jouw eigen URL's.
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
];

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin);

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'content-type,x-picnic-auth,x-picnic-agent,x-picnic-did',
      'Access-Control-Expose-Headers': 'x-picnic-auth',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Productafbeeldingen (alleen GET, vast patroon) — voor de thumbnails in
    // de zoekresultaten. Deze staan vóór de origin-controle: <img>-tags sturen
    // niet altijd een Origin-header mee, en de foto's zijn publiek materiaal.
    // De API-paden hieronder blijven wél strikt origin-gebonden.
    const imageMatch = url.pathname.match(
      /^\/static\/images\/[A-Za-z0-9_-]+\/(tiny|small|medium|large|extra-large)\.png$/
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
