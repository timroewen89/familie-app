const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type()==='error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await page.addInitScript(() => { localStorage.clear(); window.google = { accounts:{ oauth2:{ initTokenClient:()=>({requestAccessToken(){}}) } } }; });
  await page.goto(BASE + '/index.html');
  await page.waitForTimeout(400);
  const chips = await page.locator('.filter-chip').allTextContents();
  console.log('standaard filterchips:', JSON.stringify(chips));
  if (chips.some(c => /Tim|Renate|Mick|Davi/.test(c))) throw new Error('echte namen nog in standaard');
  if (JSON.stringify(chips) !== JSON.stringify(['Ouder 1','Ouder 2','Kind 1','Kind 2'])) throw new Error('generieke standaard klopt niet');
  // manifest maskable aanwezig
  const hasMaskable = await page.evaluate(async () => {
    const m = await fetch('manifest.webmanifest').then(r=>r.json());
    return m.icons.some(i => (i.purpose||'').includes('maskable')) && m.id === '/';
  });
  console.log('manifest maskable + id:', hasMaskable);
  if (!hasMaskable) throw new Error('manifest mist maskable of id');
  if (errs.length) { console.log('FOUTEN:', errs); process.exit(1); }
  console.log('STANDAARD/MANIFEST-TEST GESLAAGD');
  await browser.close();
})().catch(e => { console.error('FAAL:', e.message); process.exit(1); });
