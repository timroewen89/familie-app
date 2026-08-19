const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('familie-app.picnic')) localStorage.setItem('familie-app.picnic', JSON.stringify({ proxyUrl: 'https://proxy.test.workers.dev', authKey: 'TOK' }));
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (!u.startsWith('https://proxy.test')) return realFetch(url, opts);
      if (u.includes('/pages/search-page-results')) {
        return new Response(JSON.stringify({ body: { children: [
          { sellingUnit: { id: 'kaas1', name: 'Beemster jong belegen 48+', display_price: 415, unit_quantity: '400 g', max_count: 99 } },
        ] } }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };
  });

  await page.goto(BASE + '/index.html');
  await page.tap('#tab-shopping');

  // 1. Snelzoeken vanuit het invoerveld → product 2× in mandje → op het lijstje als "2× ..."
  await page.fill('#shopping-input', 'kaas');
  await page.tap('#btn-picnic-quick');
  await page.waitForTimeout(300);
  const row = page.locator('.picnic-result').first();
  await row.locator('.picnic-add').tap();
  await page.waitForTimeout(200);
  await row.locator('.picnic-step-btn').nth(1).tap();
  await page.waitForTimeout(200);
  await page.tap('#btn-picnic-search-close');

  let listItems = await page.locator('#shopping-list .item-name').allTextContents();
  console.log('lijst na 2x mandje:', JSON.stringify(listItems));
  if (JSON.stringify(listItems) !== JSON.stringify(['2× Beemster jong belegen 48+'])) throw new Error('lijstitem fout');
  const inputValue = await page.inputValue('#shopping-input');
  console.log('invoerveld leeg:', inputValue === '');
  if (inputValue !== '') throw new Error('invoerveld niet leeggemaakt');

  // 2. Zoeken vanaf het bestaande lijstje-item (P-knop) → géén duplicaat, ook niet bij toevoegen
  await page.locator('#shopping-list .picnic-btn').first().tap();
  await page.waitForTimeout(300);
  await page.locator('.picnic-result .picnic-add').first().tap();
  await page.waitForTimeout(200);
  await page.tap('#btn-picnic-search-close');
  listItems = await page.locator('#shopping-list .item-name').allTextContents();
  console.log('lijst na P-knop-zoekactie:', JSON.stringify(listItems));
  if (listItems.length !== 1) throw new Error('duplicaat op lijst na P-knop-zoekactie');

  // 3. Nieuw snelzoeken, terug naar 0 → item verdwijnt weer van de lijst
  await page.fill('#shopping-input', 'kaas');
  await page.tap('#btn-picnic-quick');
  await page.waitForTimeout(300);
  const row2 = page.locator('.picnic-result').first();
  await row2.locator('.picnic-add').tap();
  await page.waitForTimeout(200);
  listItems = await page.locator('#shopping-list .item-name').allTextContents();
  console.log('tijdens: ', JSON.stringify(listItems));
  if (listItems.length !== 2) throw new Error('tweede lijstitem ontbreekt');
  await row2.locator('.picnic-step-btn').first().tap(); // min → 0
  await page.waitForTimeout(200);
  await page.tap('#btn-picnic-search-close');
  listItems = await page.locator('#shopping-list .item-name').allTextContents();
  console.log('na terug naar 0:', JSON.stringify(listItems));
  if (listItems.length !== 1) throw new Error('lijstitem niet verwijderd bij 0');

  // 4. Persistentie: lijstitem blijft na herladen staan
  await page.reload();
  listItems = await page.locator('#shopping-list .item-name').allTextContents();
  if (JSON.stringify(listItems) !== JSON.stringify(['2× Beemster jong belegen 48+'])) throw new Error('persistentie faalt');

  if (errors.length) { console.log('FOUTEN:', errors); process.exit(1); }
  console.log('LIJST-SYNC-TEST GESLAAGD');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
