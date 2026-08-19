const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('familie-app.shopping')) {
      localStorage.setItem('familie-app.shopping', JSON.stringify([{ id: 'a', name: 'Brood', done: false }]));
      localStorage.setItem('familie-app.picnic', JSON.stringify({ proxyUrl: 'https://x.workers.dev', authKey: 'T' }));
    }
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    window.__m = [];
    const rf = window.fetch.bind(window);
    window.fetch = async (u, o = {}) => {
      u = String(u);
      if (!u.includes('x.workers.dev')) return rf(u, o);
      if (u.includes('search-page-results')) return new Response(JSON.stringify({ body: { children: [
        { sellingUnit: { id: 'kaas1', name: 'Beemster 48+', display_price: 415, unit_quantity: '400 g', max_count: 99 } } ] } }), { status: 200 });
      if (u.includes('/cart/')) { window.__m.push((u.includes('add') ? 'add ' : 'remove ') + JSON.parse(o.body).product_id); return new Response('{}', { status: 200 }); }
      return new Response('{}', { status: 200 });
    };
  });
  await page.route('**/static/images/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
  await page.goto(BASE + '/index.html');
  await page.tap('#tab-shopping');

  // 1. Ster op een gewoon item (Brood) → verschijnt in favorietenbalk
  await page.locator('#shopping-list li', { hasText: 'Brood' }).locator('.btn-fav').tap();
  await page.waitForTimeout(150);
  let favBarVisible = await page.locator('#favorites-bar').isVisible();
  let favNames = await page.locator('.favorite-add span').allTextContents();
  console.log('1. favorieten:', JSON.stringify(favNames), '| balk zichtbaar:', favBarVisible);
  if (!favBarVisible || !favNames.includes('Brood')) throw new Error('gewoon item niet in favorieten');
  const starPressed = await page.locator('#shopping-list li', { hasText: 'Brood' }).locator('.btn-fav').getAttribute('aria-pressed');
  if (starPressed !== 'true') throw new Error('ster niet actief na markeren');

  // 2. Picnic-item toevoegen via snelzoeken → favoriet met schone productnaam (geen "2×")
  await page.fill('#shopping-input', 'kaas');
  await page.tap('#btn-picnic-quick');
  await page.waitForTimeout(300);
  const row = page.locator('.picnic-result').first();
  await row.locator('.picnic-add').tap();
  await page.waitForTimeout(150);
  await row.locator('.picnic-step-btn').nth(1).tap(); // → 2× in mandje
  await page.waitForTimeout(150);
  await page.tap('#btn-picnic-search-close');
  await page.locator('#shopping-list li', { hasText: 'Beemster' }).locator('.btn-fav').tap();
  await page.waitForTimeout(150);
  favNames = await page.locator('.favorite-add span').allTextContents();
  console.log('2. favorieten na Picnic:', JSON.stringify(favNames));
  if (!favNames.includes('Beemster 48+')) throw new Error('Picnic-favoriet mist schone naam');

  // 2b. Veel favorieten mogen de pagina niet breder maken dan het scherm:
  // de chips horen binnen de favorietenbalk te scrollen (regressie: .panel
  // groeide als grid-item mee met de nowrap-chips).
  await page.evaluate(() => {
    const favs = JSON.parse(localStorage.getItem('familie-app.favorites') || '[]');
    for (let i = 0; i < 8; i++) favs.push({ id: 'fav-n:breed' + i, name: 'Favoriet product nummer ' + i, picnicId: null, updatedAt: Date.now() });
    localStorage.setItem('familie-app.favorites', JSON.stringify(favs));
  });
  await page.reload();
  await page.waitForSelector('#favorites-bar .favorite-add');
  const widths = await page.evaluate(() => ({
    inner: window.innerWidth,
    doc: document.documentElement.scrollWidth,
    barScroll: document.getElementById('favorites-bar').scrollWidth,
    barClient: document.getElementById('favorites-bar').clientWidth,
  }));
  console.log('2b. breedtes:', JSON.stringify(widths));
  if (widths.doc > widths.inner) throw new Error('pagina breder dan het scherm door favorieten');
  if (widths.barScroll <= widths.barClient) throw new Error('favorietenbalk scrollt niet (chips passen onverwacht)');
  await page.evaluate(() => {
    const favs = JSON.parse(localStorage.getItem('familie-app.favorites')).filter((f) => !f.id.includes('breed'));
    localStorage.setItem('familie-app.favorites', JSON.stringify(favs));
  });

  // 3. Persistentie na herladen
  await page.reload();
  await page.waitForSelector('#favorites-bar .favorite-add');
  favNames = await page.locator('.favorite-add span').allTextContents();
  console.log('3. na herladen:', JSON.stringify(favNames));
  if (favNames.length !== 2) throw new Error('favorieten niet bewaard');

  // 4. Andere "week": lijst leeggemaakt, favoriet Beemster opnieuw toevoegen → op lijst + in mandje
  await page.evaluate(() => { localStorage.setItem('familie-app.shopping', '[]'); });
  await page.reload();
  await page.waitForSelector('#favorites-bar .favorite-add');
  await page.evaluate(() => { window.__m = []; });
  await page.locator('.favorite-add', { hasText: 'Beemster 48+' }).tap();
  await page.waitForTimeout(300);
  const onList = await page.locator('#shopping-list li', { hasText: 'Beemster 48+' }).count();
  const m = await page.evaluate(() => window.__m);
  console.log('4. op lijst:', onList, '| mandje-mutaties:', JSON.stringify(m));
  if (onList !== 1) throw new Error('favoriet niet op lijst');
  if (!m.includes('add kaas1')) throw new Error('favoriet niet in mandje gelegd');

  // 4b. Gekoppeld: × op dit item haalt het ook uit het mandje
  await page.evaluate(() => { window.__m = []; });
  await page.locator('#shopping-list li', { hasText: 'Beemster 48+' }).locator('.btn-delete').tap();
  await page.waitForTimeout(300);
  const m2 = await page.evaluate(() => window.__m);
  console.log('4b. na verwijderen:', JSON.stringify(m2));
  if (!m2.some(x => x.startsWith('remove kaas1'))) throw new Error('favoriet-item niet uit mandje bij verwijderen');

  // 5. Gewoon favoriet (Brood) toevoegen zonder mandje-mutatie
  await page.evaluate(() => { window.__m = []; });
  await page.locator('.favorite-add', { hasText: 'Brood' }).tap();
  await page.waitForTimeout(200);
  const m3 = await page.evaluate(() => window.__m);
  const broodOnList = await page.locator('#shopping-list li', { hasText: 'Brood' }).count();
  console.log('5. Brood op lijst:', broodOnList, '| mandje:', JSON.stringify(m3));
  if (broodOnList !== 1 || m3.length !== 0) throw new Error('gewoon favoriet mag mandje niet raken');

  // 6. Favoriet verwijderen via ×
  await page.locator('.favorite-chip', { hasText: 'Brood' }).locator('.favorite-remove').tap();
  await page.waitForTimeout(150);
  favNames = await page.locator('.favorite-add span').allTextContents();
  console.log('6. na favoriet verwijderen:', JSON.stringify(favNames));
  if (favNames.includes('Brood')) throw new Error('favoriet niet verwijderd');

  await page.screenshot({ path: require('os').tmpdir() + '/familie-app-favorites.png' });
  if (errors.length) { console.log('FOUTEN:', errors); process.exit(1); }
  console.log('FAVORIETEN-TEST GESLAAGD');
  await browser.close();
})().catch(e => { console.error('FAAL:', e.message); process.exit(1); });
