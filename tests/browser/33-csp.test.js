const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const csp = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  await page.addInitScript(() => { window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } }; });
  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(800);
  // tab wissel + boodschap toevoegen (eigen bestanden, inline styles)
  await page.click('#tab-shopping');
  await page.fill('#shopping-input', 'Test');
  await page.click('#shopping-form button[type=submit]');
  await page.waitForTimeout(300);
  console.log('CSP-violations op eigen code:', csp.length);
  csp.forEach(v => console.log('  ', v.slice(0, 140)));
  if (csp.length) process.exit(1);
  console.log('CSP-CHECK GESLAAGD (geen violations op eigen bestanden/inline styles)');
  await browser.close();
})();
