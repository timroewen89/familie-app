const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('familie-app.picnic', JSON.stringify({ proxyUrl: 'https://x.workers.dev', authKey: 'T' }));
    localStorage.setItem('familie-app.shopping', JSON.stringify([{ id: 'a', name: 'Melk', done: false }]));
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    const rf = window.fetch.bind(window);
    window.fetch = async (u, o = {}) => {
      u = String(u);
      if (!u.includes('x.workers.dev')) return rf(u, o);
      if (u.includes('search-page-results')) return new Response(JSON.stringify({ body: { children: [
        { sellingUnit: { id: 'p', name: 'Melk', display_price: 100, unit_quantity: '1 l', max_count: 99 } } ] } }), { status: 200 });
      if (u.includes('/cart/')) return new Response('{}', { status: 500 }); // dwing fout af voor toast
      return new Response('{}', { status: 200 });
    };
  });
  await page.route('**/static/images/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
  await page.goto(BASE + '/index.html');

  // 1. Aria-pressed op tabs
  const agendaPressed = await page.locator('#tab-agenda').getAttribute('aria-pressed');
  console.log('1. tab-agenda aria-pressed:', agendaPressed);
  if (agendaPressed !== 'true') throw new Error('tab aria-pressed ontbreekt');
  await page.tap('#tab-shopping');
  if (await page.locator('#tab-shopping').getAttribute('aria-pressed') !== 'true') throw new Error('tabwissel aria fout');

  // 2. Touch-groottes >= 44
  const pBtn = await page.locator('#shopping-list .picnic-btn').first().boundingBox();
  console.log('2. P-knop:', Math.round(pBtn.width) + 'x' + Math.round(pBtn.height));
  if (pBtn.height < 44 || pBtn.width < 44) throw new Error('P-knop < 44px');

  // 3. Toast i.p.v. alert bij mislukte mandje-mutatie (geen dialog-block)
  let alertFired = false;
  page.on('dialog', d => { alertFired = true; d.dismiss(); });
  await page.locator('#shopping-list .picnic-btn').first().tap();
  await page.waitForTimeout(300);
  await page.locator('.picnic-result .picnic-add').first().tap(); // 500 → fout
  await page.waitForTimeout(400);
  const toastVisible = await page.locator('#app-toast.show').count();
  const toastText = await page.locator('#app-toast').textContent().catch(() => '');
  console.log('3. toast:', toastVisible, '| alert():', alertFired, '| tekst:', toastText.slice(0,40));
  if (alertFired) throw new Error('nog steeds blokkerende alert()');
  if (toastVisible !== 1) throw new Error('geen toast getoond');
  await page.tap('#btn-picnic-search-close');

  // 4. Filterchips 44px hoog + aria-pressed
  await page.tap('#tab-agenda');
  const chip = page.locator('.filter-chip').first();
  const chipBox = await chip.boundingBox();
  console.log('4. filterchip hoogte:', Math.round(chipBox.height), '| aria-pressed:', await chip.getAttribute('aria-pressed'));
  if (chipBox.height < 44) throw new Error('filterchip < 44px');
  if (await chip.getAttribute('aria-pressed') === null) throw new Error('filterchip mist aria-pressed');

  // 5. calendar-status heeft aria-live
  const live = await page.locator('#calendar-status').getAttribute('aria-live');
  console.log('5. calendar-status aria-live:', live);
  if (live !== 'polite') throw new Error('status mist aria-live');

  if (errors.length) { console.log('FOUTEN:', errors); process.exit(1); }
  console.log('UX-TEST GESLAAGD');
  await browser.close();
})().catch(e => { console.error('FAAL:', e.message); process.exit(1); });
