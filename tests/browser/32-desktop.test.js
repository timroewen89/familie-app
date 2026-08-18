const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/index.html');
  const days = await page.locator('.day-column').count();
  await page.click('#btn-next');
  const label = await page.locator('#week-label').textContent();
  console.log('desktop:', days, 'dagen | na volgende:', label);
  if (days !== 7 || !/Week 35/.test(label)) throw new Error('desktop weekweergave faalt');
  await page.click('#btn-today');
  await page.screenshot({ path: require('os').tmpdir() + '/familie-app-desktop.png' });
  if (errors.length) { console.log('FOUTEN:', errors); process.exit(1); }
  console.log('DESKTOP OK');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
