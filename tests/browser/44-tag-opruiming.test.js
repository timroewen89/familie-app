const { launch, BASE } = require('./_helpers');

/**
 * Migratie van het oude tag-formaat (event-id -> string[]) naar {names, date}
 * en het opruimen van tags van afspraken ouder dan 90 dagen.
 */
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.addInitScript(() => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    localStorage.clear();
    localStorage.setItem('familie-app.event-tags', JSON.stringify({
      'array-oud': ['Ouder 1'],                                 // oud formaat -> migreert (blijft)
      'nieuw-verleden': { names: ['Ouder 2'], date: '2020-01-01' }, // > 90 dagen -> gewist
      'nieuw-recent': { names: ['Kind 1'], date: today },        // recent -> blijft
    }));
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
  });

  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => ({
    arrayOud: Tags.getTags('array-oud'),
    verleden: Tags.getTags('nieuw-verleden'),
    recent: Tags.getTags('nieuw-recent'),
    stored: JSON.parse(localStorage.getItem('familie-app.event-tags')),
  }));

  console.log('migratie array-oud:', JSON.stringify(result.arrayOud));
  console.log('verleden (moet leeg):', JSON.stringify(result.verleden));
  console.log('recent:', JSON.stringify(result.recent));

  if (JSON.stringify(result.arrayOud) !== '["Ouder 1"]') throw new Error('array-formaat niet gemigreerd');
  if (result.verleden.length !== 0) throw new Error('oude tag niet opgeruimd');
  if (JSON.stringify(result.recent) !== '["Kind 1"]') throw new Error('recente tag ten onrechte weg');

  // Opslag: verleden weg, en gemigreerde entry heeft nu {names, date}
  if (result.stored['nieuw-verleden']) throw new Error('oude tag nog in localStorage');
  if (!result.stored['array-oud'] || !Array.isArray(result.stored['array-oud'].names) || !result.stored['array-oud'].date) {
    throw new Error('gemigreerde entry heeft niet het {names, date}-formaat');
  }

  if (errors.length) { console.log('FOUTEN:', errors); process.exit(1); }
  console.log('TAG-OPRUIMING-TEST GESLAAGD');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
