/**
 * Unit-tests voor de gedeelde boodschappenlijst in de Worker (/sync/push):
 * merge (last-writer-wins), tombstones, validatie en de 501 zonder D1-binding.
 * D1 wordt gemockt met een in-memory store die de exacte SQL van de Worker kent.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerSrc = path.join(here, '..', '..', 'worker', 'picnic-proxy.js');
const tmpCopy = path.join(os.tmpdir(), `picnic-proxy-sync-${process.pid}.mjs`);
fs.copyFileSync(workerSrc, tmpCopy);
const worker = (await import(pathToFileURL(tmpCopy))).default;
fs.unlinkSync(tmpCopy);

globalThis.fetch = async () => new Response('{}', { status: 500 }); // upstream nooit nodig

/** Minimale in-memory D1: kent precies de SQL-statements van de Worker. */
function mockD1() {
  const rows = new Map(); // `${family}|${id}` -> row
  const statement = (sql, args) => ({
    async run() {
      if (sql.startsWith('CREATE TABLE')) return {};
      if (sql.startsWith('INSERT INTO entries')) {
        const [family, id, kind, data, updatedAt, deleted] = args;
        rows.set(`${family}|${id}`, { id, kind, data, updated_at: updatedAt, deleted });
        return {};
      }
      if (sql.startsWith('DELETE FROM entries')) {
        const [family, before] = args;
        for (const [key, row] of rows) {
          if (key.startsWith(`${family}|`) && row.deleted === 1 && row.updated_at < before) rows.delete(key);
        }
        return {};
      }
      throw new Error('onbekende SQL (run): ' + sql);
    },
    async all() {
      if (sql.startsWith('SELECT id, kind, data, updated_at, deleted FROM entries')) {
        const [family] = args;
        const results = [...rows.entries()]
          .filter(([key]) => key.startsWith(`${family}|`))
          .map(([, row]) => ({ ...row }));
        return { results };
      }
      throw new Error('onbekende SQL (all): ' + sql);
    },
  });
  return {
    _rows: rows,
    prepare(sql) {
      return { bind: (...args) => statement(sql, args), ...statement(sql, []) };
    },
    async batch(statements) {
      for (const stmt of statements) await stmt.run();
    },
  };
}

const base = 'https://picnic-proxy.test.workers.dev';
const origin = 'https://timroewen89.github.io';

function push(env, body) {
  return worker.fetch(new Request(base + '/sync/push', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), env);
}

const NOW = Date.now();

function check(name, cond) {
  if (!cond) {
    console.error('FAAL:', name);
    process.exit(1);
  }
  console.log('OK  ', name);
}

// 1. Zonder D1-binding: nette 501
let res = await push({}, { family: 'ons-gezin', items: [], favorites: [] });
check('zonder DB → 501', res.status === 501);

const db = mockD1();
const env = { DB: db };

// 2. Ongeldige gezinscode geweigerd
res = await push(env, { family: 'kort', items: [] });
check('te korte gezinscode → 400', res.status === 400);

// 3. Telefoon A pusht twee items
res = await push(env, {
  family: 'ons-gezin',
  items: [
    { id: 'a1', name: 'Melk', done: false, updatedAt: NOW - 5000 },
    { id: 'a2', name: 'Brood', done: false, updatedAt: NOW - 4000 },
  ],
  favorites: [{ id: 'fav-n:kaas', name: 'Kaas', picnicId: null, updatedAt: NOW - 3000 }],
});
let data = await res.json();
check('push A geeft 200', res.status === 200);
check('A ziet eigen items terug', data.items.length === 2 && data.favorites.length === 1);

// 4. Telefoon B (lege staat) pollt en ziet de items van A
res = await push(env, { family: 'ons-gezin', items: [], favorites: [] });
data = await res.json();
check('B ziet items van A', data.items.map((i) => i.name).sort().join(',') === 'Brood,Melk');
check('B ziet favoriet van A', data.favorites[0].name === 'Kaas');

// 5. LWW: B vinkt Melk af (nieuwer) terwijl A een oude versie pusht
res = await push(env, {
  family: 'ons-gezin',
  items: [{ id: 'a1', name: 'Melk', done: true, updatedAt: NOW - 1000 }],
});
res = await push(env, {
  family: 'ons-gezin',
  items: [{ id: 'a1', name: 'Melk', done: false, updatedAt: NOW - 2000 }], // ouder: mag niet winnen
});
data = await res.json();
const melk = data.items.find((i) => i.id === 'a1');
check('nieuwste wint (afgevinkt blijft)', melk.done === true && melk.updatedAt === NOW - 1000);

// 6. Tombstone: B verwijdert Brood; een oude push van A brengt hem niet terug
res = await push(env, {
  family: 'ons-gezin',
  items: [{ id: 'a2', name: 'Brood', done: false, updatedAt: NOW - 500, deleted: true }],
});
res = await push(env, {
  family: 'ons-gezin',
  items: [{ id: 'a2', name: 'Brood', done: false, updatedAt: NOW - 4000 }], // verouderde staat van A
});
data = await res.json();
const brood = data.items.find((i) => i.id === 'a2');
check('verwijdering blijft staan (tombstone)', brood.deleted === true);

// 7. Gezinnen zijn gescheiden
res = await push(env, { family: 'ander-gezin', items: [], favorites: [] });
data = await res.json();
check('ander gezin ziet niets', data.items.length === 0 && data.favorites.length === 0);

// 8. Oude tombstones worden opgeruimd (updated_at ver in het verleden)
await push(env, {
  family: 'ons-gezin',
  items: [{ id: 'oud', name: 'Oud item', updatedAt: 1, deleted: true }],
});
res = await push(env, { family: 'ons-gezin', items: [] });
data = await res.json();
check('oude tombstone opgeruimd', !data.items.some((i) => i.id === 'oud'));

// 9. Sanitatie: veel te lange naam wordt afgekapt, ongeldige entries genegeerd
res = await push(env, {
  family: 'ons-gezin',
  items: [
    { id: 'lang', name: 'x'.repeat(500), updatedAt: NOW - 100 },
    { id: '', name: 'geen id', updatedAt: NOW - 90 },
    { id: 'geen-tijd', name: 'geen updatedAt' },
  ],
});
data = await res.json();
const lang = data.items.find((i) => i.id === 'lang');
check('lange naam afgekapt', lang && lang.name.length === 200);
check('ongeldige entries genegeerd', !data.items.some((i) => i.id === '' || i.id === 'geen-tijd'));

console.log('WORKER-SYNC-TESTS GESLAAGD');
