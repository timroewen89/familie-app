const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();

  // Scenario 1: geen Picnic geconfigureerd → snelknop verborgen
  let page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.addInitScript(() => {
    localStorage.clear();
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
  });
  await page.goto(BASE + '/index.html');
  await page.tap('#tab-shopping');
  let visible = await page.locator('#btn-picnic-quick').isVisible();
  console.log('zonder config zichtbaar:', visible);
  if (visible) throw new Error('snelknop hoort verborgen te zijn zonder config');
  await page.close();

  // Scenario 2: geconfigureerd + ingelogd → typen en direct zoeken zonder toe te voegen
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('familie-app.picnic', JSON.stringify({ proxyUrl: 'https://proxy.test.workers.dev', authKey: 'TOK' }));
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (!u.startsWith('https://proxy.test')) return realFetch(url, opts);
      if (u.includes('/pages/search-page-results')) {
        return new Response(JSON.stringify({ body: { children: [
          { sellingUnit: { id: 'k1', name: 'Jong belegen kaas', display_price: 549, unit_quantity: '450 g' } },
        ] } }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };
  });
  await page.goto(BASE + '/index.html');
  await page.tap('#tab-shopping');
  visible = await page.locator('#btn-picnic-quick').isVisible();
  console.log('met config zichtbaar:', visible);
  if (!visible) throw new Error('snelknop ontbreekt');

  await page.fill('#shopping-input', 'Kaas');
  await page.tap('#btn-picnic-quick');
  await page.waitForTimeout(300);
  const title = await page.locator('#picnic-search-title').textContent();
  const results = await page.locator('.picnic-result').count();
  console.log('dialog:', title, '| resultaten:', results);
  if (title !== 'Picnic: Kaas' || results !== 1) throw new Error('snelzoeken faalt');

  // Niet toegevoegd aan de lijst
  const items = await page.locator('#shopping-list li:not(.shopping-empty)').count();
  console.log('lijstitems:', items);
  if (items !== 0) throw new Error('item ten onrechte aan lijst toegevoegd');

  // Lege invoer → geen dialog, focus op veld
  await page.tap('#btn-picnic-search-close');
  await page.fill('#shopping-input', '');
  await page.tap('#btn-picnic-quick');
  const dialogOpen = await page.locator('#picnic-search-dialog').evaluate(d => d.open);
  if (dialogOpen) throw new Error('dialog hoort niet te openen bij lege invoer');

  if (errors.length) { console.log('FOUTEN:', errors); process.exit(1); }
  console.log('SNELZOEK-TEST GESLAAGD');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
