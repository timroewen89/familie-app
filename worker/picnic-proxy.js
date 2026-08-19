/**
 * Familie-app Worker: Picnic CORS-proxy + gedeelde boodschappenlijst (sync).
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
 * Daarnaast synchroniseert /sync/push de boodschappenlijst en favorieten
 * tussen gezinsleden via een D1-database (zie README, "Samenwerken").
 * Merge-strategie: per item last-writer-wins op updated_at, met tombstones
 * voor verwijderingen zodat een verwijderd item niet terugkomt via een
 * verouderde telefoon.
 *
 * De proxy-paden bewaren zelf niets. Let op: de beheerder van de Worker kan
 * technisch gezien Cloudflare-logging inschakelen; het verkeer passeert dus
 * versleuteld (TLS) maar niet end-to-end afgeschermd van de Worker-eigenaar.
 *
 * Instellen (gratis):
 *   - Pas ALLOWED_ORIGINS hieronder aan, of zet de env-var ALLOWED_ORIGINS
 *     (komma-gescheiden) — handig bij verhuizen naar bijv. Cloudflare Pages.
 *   - Stel een geheim in:  npx wrangler secret put PROXY_KEY
 *     en vul dezelfde waarde in de app in (⚙️ → Picnic → Proxy-sleutel).
 *   - Voor de gedeelde lijst: maak een D1-database en koppel hem als
 *     binding "DB" (zie wrangler.toml + README). Zonder DB blijft de rest
 *     gewoon werken; /sync geeft dan 501.
 *   Zolang PROXY_KEY niet is ingesteld werkt de proxy nog (alleen origin-check),
 *   maar dat is onveilig — stel de sleutel in voor gebruik.
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

// Grenzen voor de gedeelde lijst (sanity limits per gezin).
// Aparte plafonds zodat een lange lijst nooit stilletjes de favorieten wegdrukt.
const SYNC_MAX_ITEMS = 400;
const SYNC_MAX_FAVORITES = 100;
const SYNC_MAX_ROWS_PER_FAMILY = 1000;
const SYNC_MAX_NAME_LENGTH = 200;
// Server bewaart verwijderingen ruim langer dan de client (90d) lokaal doet,
// zodat een lang offline telefoon een verwijderd item niet laat herrijzen.
const SYNC_TOMBSTONE_MS = 180 * 24 * 60 * 60 * 1000;
// Timestamps mogen hooguit iets in de toekomst liggen; een telefoon met een
// ver voorlopende klok kan anders entries voor de rest onbewerkbaar maken.
const SYNC_FUTURE_SLACK_MS = 60 * 1000;

/** Constante-tijd vergelijking zodat de sleutel niet via timing te raden is. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

let syncSchemaReady = false;

async function ensureSyncSchema(db) {
  if (syncSchemaReady) return;
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS entries ('
      + 'family TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, '
      + 'data TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, '
      + 'PRIMARY KEY (family, id))'
  ).run();
  syncSchemaReady = true;
}

/** Eén ruw item/favoriet uit de client normaliseren; null = ongeldig, negeren. */
function sanitizeEntry(raw, kind) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  let updatedAt = Number(raw.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  // Klok-clamp: een voorlopende klok mag entries niet 'bevriezen' voor de rest.
  updatedAt = Math.min(updatedAt, Date.now() + SYNC_FUTURE_SLACK_MS);
  const rawName = String(raw.name || '');
  const name = rawName.slice(0, SYNC_MAX_NAME_LENGTH);
  // Als sanitatie de inhoud wijzigt, moet deze versie ook overal winnen —
  // anders blijft de pushende telefoon eeuwig zijn eigen (langere) naam zien.
  if (name !== rawName) updatedAt += 1;
  const data = kind === 'item'
    ? {
        name,
        done: !!raw.done,
        picnicId: typeof raw.picnicId === 'string' ? raw.picnicId.slice(0, 64) : null,
        picnicCount: Math.max(0, Math.min(99, Number(raw.picnicCount) || 0)),
        picnicName: typeof raw.picnicName === 'string' ? raw.picnicName.slice(0, SYNC_MAX_NAME_LENGTH) : null,
      }
    : {
        name,
        picnicId: typeof raw.picnicId === 'string' ? raw.picnicId.slice(0, 64) : null,
      };
  return { id: raw.id.slice(0, 80), kind, data, updatedAt, deleted: !!raw.deleted };
}

/**
 * Gedeelde lijst: client stuurt zijn volledige staat, de Worker merget per
 * entry en geeft de samengevoegde staat terug. Idempotent, dus pollen = pushen.
 *
 * De last-writer-wins-beslissing zit IN de SQL (conditionele upsert), niet in
 * JavaScript: twee overlappende verzoeken kunnen elkaars nieuwere schrijfsels
 * dan niet terugdraaien. Bij exact gelijke updatedAt wint een verwijdering;
 * verder houdt de server zijn eigen rij en neemt de client het serverantwoord
 * over (zie applyMerged), zodat alle apparaten convergeren.
 */
async function handleSyncPush(request, env, corsHeaders) {
  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };
  if (!env || !env.DB) {
    return new Response(JSON.stringify({ error: 'sync niet geconfigureerd (D1-binding DB ontbreekt)' }),
      { status: 501, headers: jsonHeaders });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'ongeldige JSON' }), { status: 400, headers: jsonHeaders });
  }
  const family = typeof body.family === 'string' ? body.family.trim() : '';
  if (!/^[A-Za-z0-9-]{6,64}$/.test(family)) {
    return new Response(JSON.stringify({ error: 'ongeldige gezinscode (minimaal 6 tekens, letters/cijfers/streepjes)' }),
      { status: 400, headers: jsonHeaders });
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  const rawFavorites = Array.isArray(body.favorites) ? body.favorites : [];
  const incoming = [
    ...rawItems.slice(0, SYNC_MAX_ITEMS).map((raw) => sanitizeEntry(raw, 'item')),
    ...rawFavorites.slice(0, SYNC_MAX_FAVORITES).map((raw) => sanitizeEntry(raw, 'fav')),
  ].filter(Boolean);
  // Nooit stilletjes knippen: de client kan de gebruiker dan waarschuwen.
  const truncated = rawItems.length > SYNC_MAX_ITEMS || rawFavorites.length > SYNC_MAX_FAVORITES;

  await ensureSyncSchema(env.DB);

  // Grove rem op onbegrensde groei per gezin.
  const count = await env.DB
    .prepare('SELECT COUNT(*) AS c FROM entries WHERE family = ?')
    .bind(family)
    .all();
  const existingRows = Number(count?.results?.[0]?.c) || 0;
  if (existingRows > SYNC_MAX_ROWS_PER_FAMILY) {
    return new Response(JSON.stringify({ error: 'gedeelde lijst is vol — ruim oude items op' }),
      { status: 413, headers: jsonHeaders });
  }

  // Conditionele upsert: de winnaar wordt in SQL bepaald, atomair per rij,
  // dus een tragere/oudere push kan een nieuwere rij nooit overschrijven.
  const statements = incoming.map((entry) => env.DB
    .prepare('INSERT INTO entries (family, id, kind, data, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?) '
      + 'ON CONFLICT(family, id) DO UPDATE SET kind = excluded.kind, data = excluded.data, '
      + 'updated_at = excluded.updated_at, deleted = excluded.deleted '
      + 'WHERE excluded.updated_at > entries.updated_at '
      + 'OR (excluded.updated_at = entries.updated_at AND excluded.deleted > entries.deleted)')
    .bind(family, entry.id, entry.kind, JSON.stringify(entry.data), entry.updatedAt, entry.deleted ? 1 : 0));
  // Oude tombstones opruimen zodat de tabel niet blijft groeien.
  statements.push(env.DB
    .prepare('DELETE FROM entries WHERE family = ? AND deleted = 1 AND updated_at < ?')
    .bind(family, Date.now() - SYNC_TOMBSTONE_MS));
  if (env.DB.batch) await env.DB.batch(statements);
  else for (const stmt of statements) await stmt.run();

  // Antwoord uit een VERSE select, zodat het exact de gecommitte staat is —
  // ook als een gelijktijdig verzoek van de partner net iets won.
  const existing = await env.DB
    .prepare('SELECT id, kind, data, updated_at, deleted FROM entries WHERE family = ?')
    .bind(family)
    .all();
  const merged = new Map();
  for (const row of (existing.results || [])) {
    merged.set(row.id, {
      id: row.id, kind: row.kind, data: JSON.parse(row.data),
      updatedAt: row.updated_at, deleted: !!row.deleted,
    });
  }

  const items = [];
  const favorites = [];
  let version = 0;
  for (const entry of merged.values()) {
    version = Math.max(version, entry.updatedAt);
    const out = { id: entry.id, ...entry.data, updatedAt: entry.updatedAt, deleted: entry.deleted };
    if (entry.kind === 'item') items.push(out);
    else favorites.push(out);
  }
  return new Response(JSON.stringify({ version, items, favorites, truncated }), { status: 200, headers: jsonHeaders });
}

export default {
  async fetch(request, env) {
    // Origins zijn overschrijfbaar via de env-var ALLOWED_ORIGINS (komma-
    // gescheiden), zodat een verhuizing naar bijv. Cloudflare Pages geen
    // code-wijziging vergt.
    const allowedOrigins = env && typeof env.ALLOWED_ORIGINS === 'string' && env.ALLOWED_ORIGINS.trim()
      ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
      : ALLOWED_ORIGINS;
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = allowedOrigins.includes(origin);

    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin ? origin : allowedOrigins[0],
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

    // Gedeelde boodschappenlijst (achter dezelfde origin- en sleutelcontrole).
    if (url.pathname === '/sync/push' && request.method === 'POST') {
      return handleSyncPush(request, env, corsHeaders);
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
