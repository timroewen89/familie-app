const { launch, BASE } = require('./_helpers');

/**
 * Gedeelde boodschappenlijst (client-kant): pusht na een mutatie, past de
 * samengevoegde staat van de server toe (item van Renate verschijnt),
 * verwijderen pusht een tombstone, en zonder gezinscode is er geen verkeer.
 */
(async () => {
  const browser = await launch();

  // === Scenario 1: sync actief ===
  let page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('familie-app.picnic', JSON.stringify({ proxyUrl: 'https://x.workers.dev', proxyKey: 'sleutel' }));
    localStorage.setItem('familie-app.sync', JSON.stringify({ family: 'ons-gezin-2026' }));
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    window.__pushes = [];
    // Gestubde server: merget zoals de echte Worker (LWW) en voegt bij de
    // tweede push een item van "Renate" toe.
    window.__serverState = new Map();
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (!u.includes('/sync/push')) return realFetch(url, opts);
      const body = JSON.parse(opts.body);
      window.__pushes.push({ headers: opts.headers, body });
      for (const entry of [...(body.items || [])]) {
        const current = window.__serverState.get(entry.id);
        if (!current || entry.updatedAt > current.updatedAt) window.__serverState.set(entry.id, entry);
      }
      if (window.__pushes.length === 2 && !window.__serverState.has('renate-1')) {
        window.__serverState.set('renate-1', { id: 'renate-1', name: 'Hagelslag', done: false, updatedAt: Date.now() });
      }
      return new Response(JSON.stringify({
        version: Date.now(),
        items: [...window.__serverState.values()],
        favorites: [],
      }), { status: 200 });
    };
  });
  await page.goto(BASE + '/index.html');
  await page.tap('#tab-shopping');

  // 1. Mutatie → push met item, gezinscode en proxy-sleutel
  await page.fill('#shopping-input', 'Melk');
  await page.tap('#shopping-form button[type=submit]');
  await page.waitForTimeout(400);
  let pushes = await page.evaluate(() => window.__pushes);
  const withItem = pushes.find((p) => (p.body.items || []).some((i) => i.name === 'Melk'));
  console.log('1. pushes:', pushes.length, '| Melk gepusht:', !!withItem);
  if (!withItem) throw new Error('mutatie niet gepusht');
  if (withItem.body.family !== 'ons-gezin-2026') throw new Error('gezinscode ontbreekt in push');
  if (withItem.headers['x-proxy-key'] !== 'sleutel') throw new Error('proxy-sleutel ontbreekt in push');
  const pushed = withItem.body.items.find((i) => i.name === 'Melk');
  if (!pushed.updatedAt) throw new Error('updatedAt ontbreekt op gepusht item');

  // 2. Item van Renate verschijnt na een volgende sync-ronde
  await page.evaluate(() => Sync.syncNow());
  await page.waitForTimeout(400);
  await page.evaluate(() => Sync.syncNow()); // ronde waarin de stub Hagelslag toevoegt is al geweest; nog één om toe te passen
  await page.waitForTimeout(400);
  const names = await page.locator('#shopping-list .item-name').allTextContents();
  console.log('2. lijst:', JSON.stringify(names));
  if (!names.includes('Hagelslag')) throw new Error('item van Renate verschijnt niet');
  if (!names.includes('Melk')) throw new Error('eigen item verdwenen');

  // 3. Verwijderen → tombstone gepusht, item uit de UI
  await page.evaluate(() => { window.__pushes = []; });
  await page.locator('#shopping-list li', { hasText: 'Hagelslag' }).locator('.btn-delete').tap();
  await page.waitForTimeout(400);
  pushes = await page.evaluate(() => window.__pushes);
  const tomb = pushes.flatMap((p) => p.body.items || []).find((i) => i.id === 'renate-1');
  console.log('3. tombstone gepusht:', tomb && tomb.deleted === true);
  if (!tomb || tomb.deleted !== true) throw new Error('tombstone niet gepusht');
  const namesAfter = await page.locator('#shopping-list .item-name').allTextContents();
  if (namesAfter.includes('Hagelslag')) throw new Error('verwijderd item nog zichtbaar');

  // 4. Sync-status in instellingen (knop zit in het agenda-paneel)
  await page.tap('#tab-agenda');
  await page.tap('#btn-settings');
  const status = await page.locator('#sync-status').textContent();
  console.log('4. status:', status.slice(0, 60));
  if (!/actief|gesynchroniseerd/i.test(status)) throw new Error('sync-status niet zichtbaar');

  // 5. Ongeldige gezinscode opslaan → bestaande code blijft behouden
  await page.fill('#input-family-code', 'a b!');
  await page.click('#settings-form button[value=save]');
  await page.waitForTimeout(200);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('familie-app.sync')).family);
  console.log('5. code na ongeldige invoer:', kept);
  if (kept !== 'ons-gezin-2026') throw new Error('ongeldige invoer overschreef de werkende gezinscode');
  await page.close();

  // === Scenario 2: zonder gezinscode geen sync-verkeer ===
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('familie-app.picnic', JSON.stringify({ proxyUrl: 'https://x.workers.dev' }));
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    window.__syncCalls = 0;
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
      if (String(url).includes('/sync/')) { window.__syncCalls++; return new Response('{}', { status: 200 }); }
      return realFetch(url, opts);
    };
  });
  await page.goto(BASE + '/index.html');
  await page.tap('#tab-shopping');
  await page.fill('#shopping-input', 'Brood');
  await page.tap('#shopping-form button[type=submit]');
  await page.waitForTimeout(600);
  const calls = await page.evaluate(() => window.__syncCalls);
  console.log('6. sync-calls zonder gezinscode:', calls);
  if (calls !== 0) throw new Error('sync-verkeer zonder gezinscode');
  await page.close();

  if (errors.length) { console.log('FOUTEN:', errors); process.exit(1); }
  console.log('GEDEELDE-LIJST-TEST GESLAAGD');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
