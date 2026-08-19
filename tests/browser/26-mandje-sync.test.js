const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('familie-app.picnic')) {
      localStorage.setItem('familie-app.picnic', JSON.stringify({ proxyUrl: 'https://proxy.test.workers.dev', authKey: 'TOK' }));
    }
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    window.__mutaties = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (!u.startsWith('https://proxy.test')) return realFetch(url, opts);
      if (u.includes('/pages/search-page-results')) {
        return new Response(JSON.stringify({ body: { children: [
          { sellingUnit: { id: 'kaas1', name: 'Beemster 48+', display_price: 415, unit_quantity: '400 g', max_count: 99 } },
        ] } }), { status: 200 });
      }
      if (u.includes('/cart/add_product') || u.includes('/cart/remove_product')) {
        window.__mutaties.push({ soort: u.includes('add') ? 'add' : 'remove', body: JSON.parse(opts.body) });
        return new Response('{}', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };
  });

  await page.goto(BASE + '/index.html');
  await page.tap('#tab-shopping');

  const zoekEnVoeg2Toe = async () => {
    await page.fill('#shopping-input', 'kaas');
    await page.tap('#btn-picnic-quick');
    await page.waitForTimeout(300);
    const row = page.locator('.picnic-result').first();
    await row.locator('.picnic-add').tap();
    await page.waitForTimeout(200);
    await row.locator('.picnic-step-btn').nth(1).tap();
    await page.waitForTimeout(200);
    await page.tap('#btn-picnic-search-close');
  };

  // 1. x op gekoppeld item → remove_product met count 2, item weg
  await zoekEnVoeg2Toe();
  await page.evaluate(() => { window.__mutaties = []; });
  await page.locator('#shopping-list .btn-delete').first().tap();
  await page.waitForTimeout(300);
  let mutaties = await page.evaluate(() => window.__mutaties);
  let items = await page.locator('#shopping-list .item-name').count();
  console.log('na x:', JSON.stringify(mutaties), '| items:', items);
  if (items !== 0) throw new Error('item niet verwijderd');
  if (mutaties.length !== 1 || mutaties[0].soort !== 'remove' || mutaties[0].body.count !== 2 || mutaties[0].body.product_id !== 'kaas1') {
    throw new Error('mandje-verwijdering fout');
  }

  // 2. Afvinken en dan x → GEEN mandje-verwijdering (gekocht)
  await zoekEnVoeg2Toe();
  await page.evaluate(() => { window.__mutaties = []; });
  await page.locator('#shopping-list input[type=checkbox]').first().check();
  await page.locator('#shopping-list .btn-delete').first().tap();
  await page.waitForTimeout(300);
  mutaties = await page.evaluate(() => window.__mutaties);
  console.log('na afvinken + x:', JSON.stringify(mutaties));
  if (mutaties.length !== 0) throw new Error('gekocht item hoort mandje niet te raken');

  // 3. "Gekochte items wissen" → geen mandje-verwijdering
  await zoekEnVoeg2Toe();
  await page.locator('#shopping-list input[type=checkbox]').first().check();
  await page.evaluate(() => { window.__mutaties = []; });
  await page.tap('#btn-clear-done');
  await page.waitForTimeout(300);
  mutaties = await page.evaluate(() => window.__mutaties);
  console.log('na wissen:', JSON.stringify(mutaties));
  if (mutaties.length !== 0) throw new Error('wissen hoort mandje niet te raken');

  // 4. Teller in dialog terug naar 0 → geen dubbele remove (alleen die van de minknoppen zelf)
  await page.fill('#shopping-input', 'kaas');
  await page.tap('#btn-picnic-quick');
  await page.waitForTimeout(300);
  const row = page.locator('.picnic-result').first();
  await row.locator('.picnic-add').tap();
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__mutaties = []; });
  await row.locator('.picnic-step-btn').first().tap(); // min → 0, item van lijst
  await page.waitForTimeout(300);
  mutaties = await page.evaluate(() => window.__mutaties);
  console.log('teller naar 0:', JSON.stringify(mutaties));
  if (mutaties.length !== 1 || mutaties[0].soort !== 'remove' || mutaties[0].body.count !== 1) {
    throw new Error('dubbele mandje-verwijdering bij teller naar 0');
  }
  await page.tap('#btn-picnic-search-close');

  if (errors.length) { console.log('FOUTEN:', errors); process.exit(1); }
  console.log('MANDJE-SYNC-TEST GESLAAGD');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
