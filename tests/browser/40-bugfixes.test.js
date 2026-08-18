const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();

  // === A. Tags behouden bij hernoemen gezinslid ===
  let page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('familie-app.event-tags', JSON.stringify({ 'ev1': ['Mick'] }));
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
  });
  await page.goto(BASE + '/index.html');
  // hernoem Mick -> Mickey via instellingen
  await page.click('#btn-settings');
  await page.fill('#input-members', 'Tim, Renate, Mickey, Davi');
  await page.click('#settings-form button[value=save]');
  let tags = await page.evaluate(() => JSON.parse(localStorage.getItem('familie-app.event-tags')));
  console.log('A. tags na hernoemen:', JSON.stringify(tags));
  const ev1Names = tags.ev1 && (tags.ev1.names || tags.ev1);
  if (!ev1Names || !ev1Names.includes('Mick')) throw new Error('A: tags van Mick weggegooid bij hernoemen');
  // zet naam terug -> tag weer bruikbaar (chip zou weer tonen); check dat Tags.getTags nog Mick geeft
  await page.click('#btn-settings');
  await page.fill('#input-members', 'Tim, Renate, Mick, Davi');
  await page.click('#settings-form button[value=save]');
  const restored = await page.evaluate(() => Tags.getTags('ev1'));
  if (JSON.stringify(restored) !== '["Mick"]') throw new Error('A: tag niet hersteld na terugzetten naam');
  console.log('A. hernoemen behoudt tags: OK');
  await page.close();

  // === B. Deel-knop dubbelklik blijft niet hangen ===
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('familie-app.shopping', JSON.stringify([{ id: 'a', name: 'Melk', done: false }]));
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    // navigator.share weg zodat de clipboard-tak (met flash) loopt
    delete navigator.share;
    navigator.clipboard = { writeText: () => Promise.resolve() };
  });
  await page.goto(BASE + '/index.html');
  await page.tap('#tab-shopping');
  const shareBtn = page.locator('#btn-share-list');
  const originalHtml = await shareBtn.innerHTML();
  await shareBtn.click();
  await page.waitForTimeout(400);
  await shareBtn.click(); // tweede klik binnen 2s
  await page.waitForTimeout(2200);
  const afterHtml = await shareBtn.innerHTML();
  const stuck = /Gekopieerd/.test(afterHtml);
  console.log('B. knop hersteld:', !stuck);
  if (stuck) throw new Error('B: deel-knop blijft op Gekopieerd hangen');
  if (!afterHtml.includes('Deel lijst')) throw new Error('B: origineel niet hersteld');
  await page.close();

  // === C. Stepper-grenzen: geen negatief, geen dubbel bij snelle taps ===
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('familie-app.picnic', JSON.stringify({ proxyUrl: 'https://x.workers.dev', authKey: 'T' }));
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    window.__m = [];
    const rf = window.fetch.bind(window);
    window.fetch = async (u, o = {}) => {
      u = String(u);
      if (!u.includes('x.workers.dev')) return rf(u, o);
      if (u.includes('search-page-results')) return new Response(JSON.stringify({ body: { children: [
        { sellingUnit: { id: 'p', name: 'Melk', display_price: 100, unit_quantity: '1 l', max_count: 99 } } ] } }), { status: 200 });
      if (u.includes('/cart/')) { window.__m.push(u.includes('add') ? 'add' : 'remove'); await new Promise(r => setTimeout(r, 50)); return new Response('{}', { status: 200 }); }
      return new Response('{}', { status: 200 });
    };
  });
  await page.route('**/static/images/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
  await page.goto(BASE + '/index.html');
  await page.tap('#tab-shopping');
  await page.fill('#shopping-input', 'melk');
  await page.tap('#btn-picnic-quick');
  await page.waitForTimeout(300);
  const row = page.locator('.picnic-result').first();
  await row.locator('.picnic-add').click();
  await page.waitForTimeout(150);
  // snelle dubbele min-klik (tweede tijdens busy) -> mag maar 1 remove opleveren, teller 0
  const minBtn = row.locator('.picnic-step-btn').first();
  await minBtn.click();
  await minBtn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => window.__m);
  const cnt = await row.locator('.picnic-count').count();
  console.log('C. mutaties:', JSON.stringify(m), '| teller nog zichtbaar:', cnt);
  const removes = m.filter(x => x === 'remove').length;
  if (removes !== 1) throw new Error('C: dubbele remove door snelle taps (' + removes + ')');
  await page.close();

  console.log('BUGFIX-TEST GESLAAGD');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
