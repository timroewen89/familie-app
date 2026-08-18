const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    if (!localStorage.getItem('familie-app.shopping')) localStorage.setItem('familie-app.shopping', JSON.stringify([
      { id: 'a', name: 'Melk', done: false },
      { id: 'b', name: 'Brood', done: false },
      { id: 'c', name: 'Kaas', done: true },
    ]));
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
  });
  await page.goto(BASE + '/index.html');

  // 1. Standaard: agenda zichtbaar, boodschappen verborgen; agenda-tab actief
  const agendaVisible = await page.locator('#agenda-panel').isVisible();
  const shoppingVisible = await page.locator('#shopping-panel').isVisible();
  console.log('start — agenda:', agendaVisible, '| boodschappen:', shoppingVisible);
  if (!agendaVisible || shoppingVisible) throw new Error('starttab fout');
  if (!(await page.locator('#tab-agenda').evaluate(el => el.classList.contains('active')))) throw new Error('agenda-tab niet actief');

  // 2. Badge toont aantal open items (2)
  const badge = await page.locator('#shopping-badge').textContent();
  console.log('badge:', badge);
  if (badge !== '2') throw new Error('badge fout');

  // 3. Wisselen naar boodschappen
  await page.tap('#tab-shopping');
  if (!(await page.locator('#shopping-panel').isVisible()) || (await page.locator('#agenda-panel').isVisible())) throw new Error('tabwissel faalt');

  // 4. Item afvinken → badge omlaag
  await page.locator('#shopping-list li input[type=checkbox]').first().check();
  const badge2 = await page.locator('#shopping-badge').textContent();
  console.log('badge na afvinken:', badge2);
  if (badge2 !== '1') throw new Error('badge update faalt');

  // 5. Tabkeuze onthouden na herladen
  await page.reload();
  if (!(await page.locator('#shopping-panel').isVisible())) throw new Error('tab niet onthouden');

  // 6. Mobiel: tabbalk onderaan het scherm
  const barBox = await page.locator('.tab-bar').boundingBox();
  console.log('tabbalk onderkant:', Math.round(barBox.y + barBox.height), 'viewport:', 844);
  if (barBox.y < 700) throw new Error('tabbalk staat niet onderaan op mobiel');

  await page.screenshot({ path: require('os').tmpdir() + '/familie-app-tabs-shopping.png' });
  await page.tap('#tab-agenda');
  await page.screenshot({ path: require('os').tmpdir() + '/familie-app-tabs-agenda.png' });

  if (errors.length) { console.log('FOUTEN:', errors); process.exit(1); }
  console.log('TABS-TEST GESLAAGD');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
