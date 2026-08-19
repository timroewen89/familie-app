const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();

  // Scenario 1: popup geblokkeerd (zoals iOS Safari) → duidelijke melding i.p.v. "undefined"
  let page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.addInitScript(() => {
    localStorage.setItem('familie-app.google-config', JSON.stringify({ clientId: 'test.apps.googleusercontent.com' }));
    window.google = { accounts: { oauth2: { initTokenClient: (opts) => ({
      requestAccessToken() { opts.error_callback({ type: 'popup_failed_to_open' }); },
    }) } } };
  });
  await page.goto(BASE + '/index.html');
  await page.tap('#btn-connect');
  await page.waitForTimeout(200);
  let status = await page.locator('#calendar-status').textContent();
  console.log('popup geblokkeerd →', status);
  if (status.includes('undefined') || !status.includes('pop-ups')) throw new Error('popupmelding fout');
  await page.close();

  // Scenario 2: geen test user → begrijpelijke uitleg
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.addInitScript(() => {
    localStorage.setItem('familie-app.google-config', JSON.stringify({ clientId: 'test.apps.googleusercontent.com' }));
    window.google = { accounts: { oauth2: { initTokenClient: (opts) => ({
      requestAccessToken() { opts.callback({ error: 'access_denied' }); },
    }) } } };
  });
  await page.goto(BASE + '/index.html');
  await page.tap('#btn-connect');
  await page.waitForTimeout(200);
  status = await page.locator('#calendar-status').textContent();
  console.log('access_denied →', status);
  if (!status.includes('test user')) throw new Error('access_denied-melding fout');
  await page.close();

  // Scenario 3: GIS wordt bij het opstarten al geladen (voor de tik), niet pas erna
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => {
    localStorage.setItem('familie-app.google-config', JSON.stringify({ clientId: 'test.apps.googleusercontent.com' }));
    window.__initCalls = 0;
    window.google = { accounts: { oauth2: { initTokenClient: (opts) => { window.__initCalls++; return { requestAccessToken() {} }; } } } };
  });
  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(300);
  const initCalls = await page.evaluate(() => window.__initCalls);
  console.log('tokenclient geïnitialiseerd bij opstart:', initCalls === 1);
  if (initCalls !== 1) throw new Error('GIS wordt niet voorgeladen');

  console.log('FOUTAFHANDELINGSTEST GESLAAGD');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
