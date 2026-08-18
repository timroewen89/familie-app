const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.addInitScript(() => {
    localStorage.removeItem('familie-app.shopping');
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    window.__shared = null;
    navigator.share = (data) => { window.__shared = data; return Promise.resolve(); };
  });
  await page.goto(BASE + '/index.html');
  await page.tap('#tab-shopping');

  // 1. Lege lijst → deelknop uitgeschakeld
  let disabled = await page.locator('#btn-share-list').isDisabled();
  console.log('leeg → uitgeschakeld:', disabled);
  if (!disabled) throw new Error('deelknop hoort uit te staan bij lege lijst');

  // 2. Items toevoegen, één afvinken → alleen open items in de gedeelde tekst
  for (const naam of ['Melk', 'Brood', 'Kaas']) {
    await page.fill('#shopping-input', naam);
    await page.tap('#shopping-form button[type=submit]');
  }
  await page.locator('#shopping-list li input[type=checkbox]').nth(1).check(); // Brood gekocht
  disabled = await page.locator('#btn-share-list').isDisabled();
  if (disabled) throw new Error('deelknop hoort aan te staan');
  await page.tap('#btn-share-list');
  const shared = await page.evaluate(() => window.__shared);
  console.log('gedeeld:', JSON.stringify(shared));
  if (!shared || shared.text !== '• Melk\n• Kaas') throw new Error('deeltekst fout');

  // 3. Alles afgevinkt → knop weer uit
  await page.locator('#shopping-list li input[type=checkbox]').nth(0).check();
  await page.locator('#shopping-list li input[type=checkbox]').nth(2).check();
  disabled = await page.locator('#btn-share-list').isDisabled();
  console.log('alles gedaan → uitgeschakeld:', disabled);
  if (!disabled) throw new Error('deelknop hoort uit te staan als alles gedaan is');

  if (errors.length) { console.log('FOUTEN:', errors); process.exit(1); }
  console.log('DEELLIJST-TEST GESLAAGD');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
