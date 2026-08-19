const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('familie-app.picnic', JSON.stringify({ proxyUrl: 'https://proxy.test', authKey: 'TOK' }));
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    const realFetch = window.fetch.bind(window);
    // Echte lange namen zoals op het screenshot van Tim
    const namen = [
      'Picnic bio jong belegen 48+ plakken plakken',
      'Picnic jong belegen kaas 48+ plakken',
      'Beemster jong belegen kaas 48+ plakken',
      'Beemster jong belegen 48+ plakken voordeelverpakking',
      'Oude Rotterdamsche overjarige extra lang gerijpte kaas 48+ stuk voordeelverpakking XXL',
      'Melkan geraspte jong belegen kaas 48+ voordeelzak',
      'Picnic mozzarella di bufala campana DOP bolletjes 3-pack',
      'Leerdammer original lichtgerijpte kaas plakken familieverpakking',
    ];
    window.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (!u.startsWith('https://proxy.test')) return realFetch(url, opts);
      if (u.includes('/pages/search-page-results')) {
        return new Response(JSON.stringify({ body: { children: namen.map((n, i) => (
          { sellingUnit: { id: 'p' + i, name: n, display_price: 345 + i * 10, unit_quantity: '190 gram', image_id: 'img' + i } }
        )) } }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    };
  });
    await page.route('**/static/images/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));

  await page.goto(BASE + '/index.html');
  await page.tap('#tab-shopping');
  await page.fill('#shopping-input', 'Kaas');
  await page.tap('#btn-picnic-quick');
  await page.waitForTimeout(400);

  const results = await page.locator('.picnic-result').count();
  console.log('resultaten:', results);
  if (results !== 6) throw new Error('resultaten ontbreken (app toont top 6)');

  // Geen horizontale overflow — op geen enkel niveau
  const overflow = await page.evaluate(() => {
    const check = (el) => ({ scroll: el.scrollWidth, client: el.clientWidth, over: el.scrollWidth > el.clientWidth });
    return {
      results: check(document.getElementById('picnic-results')),
      dialog: check(document.getElementById('picnic-search-dialog')),
      rows: [...document.querySelectorAll('.picnic-result')].some((r) => r.scrollWidth > r.clientWidth + 1),
    };
  });
  console.log('resultatenlijst:', JSON.stringify(overflow.results));
  console.log('dialog:', JSON.stringify(overflow.dialog));
  console.log('rij-overflow:', overflow.rows);
  if (overflow.results.over) throw new Error('resultatenlijst scrollt nog horizontaal');
  if (overflow.dialog.over) throw new Error('dialog scrollt nog horizontaal');
  if (overflow.rows) throw new Error('een rij is breder dan zijn container');

  // Verticaal scrollen werkt nog wél (8 items > 55vh)
  const vertical = await page.evaluate(() => {
    const el = document.getElementById('picnic-results');
    return el.scrollHeight > el.clientHeight;
  });
  console.log('verticaal scrollbaar:', vertical);
  if (!vertical) throw new Error('verticaal scrollen verdwenen');

  // Knoppen blijven bruikbaar (niet weggedrukt): elke + Mandje-knop volledig in beeld (x-as)
  const buttonsOk = await page.evaluate(() => {
    const dialogRect = document.getElementById('picnic-search-dialog').getBoundingClientRect();
    return [...document.querySelectorAll('.picnic-add')].every((b) => {
      const r = b.getBoundingClientRect();
      return r.right <= dialogRect.right + 1 && r.width > 60;
    });
  });
  console.log('mandje-knoppen binnen beeld:', buttonsOk);
  if (!buttonsOk) throw new Error('mandje-knop valt buiten de dialog');

  await page.screenshot({ path: require('os').tmpdir() + '/familie-app-no-hscroll.png' });
  if (errors.length) { console.log('FOUTEN:', errors); process.exit(1); }
  console.log('SCROLL-TEST GESLAAGD');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
