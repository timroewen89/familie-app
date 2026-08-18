const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // GIS stubben zodat het voorladen geen netwerkfout geeft in de sandbox
  await page.addInitScript(() => {
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
  });
  // Oude config (met API-key) vooraf zetten om de migratie te testen
  await page.goto(BASE + '/index.html');
  await page.evaluate(() => {
    localStorage.setItem('familie-app.google-config', JSON.stringify({ clientId: 'test.apps.googleusercontent.com', apiKey: 'OUDE-KEY' }));
  });
  await page.reload();

  // 1. Migratie: API-key is uit localStorage verdwenen, Client-ID behouden
  const migrated = await page.evaluate(() => localStorage.getItem('familie-app.google-config'));
  console.log('config na migratie:', migrated);
  if (migrated.includes('apiKey') || migrated.includes('OUDE-KEY')) throw new Error('API-key niet gemigreerd');
  if (!migrated.includes('test.apps.googleusercontent.com')) throw new Error('Client-ID verloren bij migratie');

  // 2. Instellingen-dialog: geen API-key-veld meer, Client-ID vooringevuld
  await page.tap('#btn-settings');
  const apiKeyField = await page.locator('#input-api-key').count();
  const clientIdValue = await page.inputValue('#input-client-id');
  console.log('api-key-veld aanwezig:', apiKeyField, '| client-id:', clientIdValue);
  if (apiKeyField !== 0) throw new Error('API-key-veld bestaat nog');
  if (clientIdValue !== 'test.apps.googleusercontent.com') throw new Error('Client-ID niet vooringevuld');
  await page.click('#btn-settings-cancel');

  // 3. Kernfuncties blijven werken
  const days = await page.locator('.day-column').count();
  if (days !== 7) throw new Error('weekweergave faalt');
  await page.tap('#btn-view-day');
  if ((await page.locator('.day-column').count()) !== 1) throw new Error('dagweergave faalt');
  await page.tap('#btn-view-week');
  const chips = await page.locator('.filter-chip').count();
  if (chips !== 4) throw new Error('filterchips fout');
  await page.tap('#tab-shopping');
  await page.fill('#shopping-input', 'Yoghurt');
  await page.tap('#shopping-form button[type=submit]');
  if ((await page.locator('#shopping-list li:not(.shopping-empty)').count()) < 1) throw new Error('boodschappenlijst faalt');

  if (errors.length) { console.log('FOUTEN:', errors); process.exit(1); }
  console.log('MIGRATIE- EN REGRESSIETEST GESLAAGD');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
