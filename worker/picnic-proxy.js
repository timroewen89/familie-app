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
const SYNC_MAX_ENTRIES = 500;
const SYNC_MAX_NAME_LENGTH = 200;
const SYNC_TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000; // verwijderingen 30 dagen bewaren

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
  const updatedAt = Number(raw.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  const name = String(raw.name || '').slice(0, SYNC_MAX_NAME_LENGTH);
  const data = kind === 'item'
    ? {
        name,
        done: !!raw.done,
        picnicId: typeof raw.picnicId === 'string' ? raw.picnicId.slice(0, 64) : null,
        picnicCount: Number.isFinite(Number(raw.picnicCount)) ? Number(raw.picnicCount) : 0,
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
 * entry (last-writer-wins op updatedAt, tombstones voor verwijderingen) en
 * geeft de samengevoegde staat terug. Idempotent, dus pollen = pushen.
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

  const incoming = [
    ...(Array.isArray(body.items) ? body.items : []).map((raw) => sanitizeEntry(raw, 'item')),
    ...(Array.isArray(body.favorites) ? body.favorites : []).map((raw) => sanitizeEntry(raw, 'fav')),
  ].filter(Boolean).slice(0, SYNC_MAX_ENTRIES);

  await ensureSyncSchema(env.DB);

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

  // Last-writer-wins per entry: nieuwere updatedAt wint, ongeacht de richting.
  const changed = [];
  for (const entry of incoming) {
    const current = merged.get(entry.id);
    if (!current || entry.updatedAt > current.updatedAt) {
      merged.set(entry.id, entry);
      changed.push(entry);
    }
  }

  const statements = changed.map((entry) => env.DB
    .prepare('INSERT INTO entries (family, id, kind, data, updated_at, deleted) VALUES (?, ?, ?, ?, ?, ?) '
      + 'ON CONFLICT(family, id) DO UPDATE SET kind = excluded.kind, data = excluded.data, '
      + 'updated_at = excluded.updated_at, deleted = excluded.deleted')
    .bind(family, entry.id, entry.kind, JSON.stringify(entry.data), entry.updatedAt, entry.deleted ? 1 : 0));
  // Oude tombstones opruimen zodat de tabel niet blijft groeien.
  statements.push(env.DB
    .prepare('DELETE FROM entries WHERE family = ? AND deleted = 1 AND updated_at < ?')
    .bind(family, Date.now() - SYNC_TOMBSTONE_MS));
  if (env.DB.batch) await env.DB.batch(statements);
  else for (const stmt of statements) await stmt.run();

  const items = [];
  const favorites = [];
  let version = 0;
  for (const entry of merged.values()) {
    version = Math.max(version, entry.updatedAt);
    const out = { id: entry.id, ...entry.data, updatedAt: entry.updatedAt, deleted: entry.deleted };
    if (entry.kind === 'item') items.push(out);
    else favorites.push(out);
  }
  return new Response(JSON.stringify({ version, items, favorites }), { status: 200, headers: jsonHeaders });
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
