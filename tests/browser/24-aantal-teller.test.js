const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('familie-app.picnic', JSON.stringify({ proxyUrl: 'https://proxy.test.workers.dev', authKey: 'TOK' }));
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    window.__mutaties = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (!u.startsWith('https://proxy.test')) return realFetch(url, opts);
      if (u.includes('/pages/search-page-results')) {
        return new Response(JSON.stringify({ body: { children: [
          { sellingUnit: { id: 'melk', name: 'Halfvolle melk', display_price: 119, unit_quantity: '1 l', max_count: 99 } },
          { sellingUnit: { id: 'schaars', name: 'Limited kaas', display_price: 599, unit_quantity: '200 g', max_count: 2 } },
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
  await page.fill('#shopping-input', 'Melk');
  await page.tap('#btn-picnic-quick');
  await page.waitForTimeout(300);

  const row = page.locator('.picnic-result').first();

  // 1. Mandje → teller verschijnt op 1
  await row.locator('.picnic-add').tap();
  await page.waitForTimeout(200);
  let count = await row.locator('.picnic-count').textContent();
  console.log('na Mandje:', count);
  if (count !== '1') throw new Error('teller start niet op 1');

  // 2. Twee keer + → teller 3, drie add-aanroepen met juiste product_id
  await row.locator('.picnic-step-btn').nth(1).tap();
  await page.waitForTimeout(150);
  await row.locator('.picnic-step-btn').nth(1).tap();
  await page.waitForTimeout(150);
  count = await row.locator('.picnic-count').textContent();
  let mutaties = await page.evaluate(() => window.__mutaties);
  console.log('na 2x plus:', count, '| aanroepen:', JSON.stringify(mutaties.map(m => m.soort)));
  if (count !== '3') throw new Error('plus telt niet op');
  if (mutaties.filter(m => m.soort === 'add' && m.body.product_id === 'melk').length !== 3) throw new Error('add-aanroepen kloppen niet');

  // 3. Eén keer − → teller 2, remove-aanroep
  await row.locator('.picnic-step-btn').first().tap();
  await page.waitForTimeout(150);
  count = await row.locator('.picnic-count').textContent();
  mutaties = await page.evaluate(() => window.__mutaties);
  console.log('na min:', count, '| laatste:', mutaties[mutaties.length - 1].soort);
  if (count !== '2' || mutaties[mutaties.length - 1].soort !== 'remove') throw new Error('min werkt niet');

  // 4. Terug naar 0 → Mandje-knop komt terug
  await row.locator('.picnic-step-btn').first().tap();
  await page.waitForTimeout(150);
  await row.locator('.picnic-step-btn').first().tap();
  await page.waitForTimeout(150);
  const addBack = await row.locator('.picnic-add').count();
  console.log('Mandje-knop terug op 0:', addBack === 1);
  if (addBack !== 1) throw new Error('terug naar Mandje-knop faalt');

  // 5. max_count: bij 2 is de plus uitgeschakeld
  const row2 = page.locator('.picnic-result').nth(1);
  await row2.locator('.picnic-add').tap();
  await page.waitForTimeout(150);
  await row2.locator('.picnic-step-btn').nth(1).tap();
  await page.waitForTimeout(150);
  const plusDisabled = await row2.locator('.picnic-step-btn').nth(1).isDisabled();
  const count2 = await row2.locator('.picnic-count').textContent();
  console.log('limited op', count2, '| plus uitgeschakeld:', plusDisabled);
  if (count2 !== '2' || !plusDisabled) throw new Error('max_count-limiet faalt');

  await page.screenshot({ path: require('os').tmpdir() + '/familie-app-stepper.png' });
  if (errors.length) { console.log('FOUTEN:', errors); process.exit(1); }
  console.log('AANTAL-TEST GESLAAGD');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
