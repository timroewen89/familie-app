const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.addInitScript(() => {
    localStorage.setItem('familie-app.google-config', JSON.stringify({ clientId: 'test.apps.googleusercontent.com' }));
    localStorage.removeItem('familie-app.selected-calendars');
    localStorage.removeItem('familie-app.event-tags');
    window.__posted = [];
    window.google = { accounts: { oauth2: { initTokenClient: (opts) => ({
      requestAccessToken() { opts.callback({ access_token: 'FAKE', expires_in: 3600 }); },
    }) } } };
    const realFetch = window.fetch.bind(window);
    window.fetch = (url, opts = {}) => {
      const u = String(url);
      if (u.includes('/users/me/calendarList')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [
          { id: 'primary-id', summary: 'Tim', primary: true, selected: true, backgroundColor: '#4285f4', accessRole: 'owner' },
          { id: 'gezin-id', summary: 'Gezin', selected: true, backgroundColor: '#34a853', accessRole: 'writer' },
          { id: 'feestdagen', summary: 'Feestdagen', selected: true, backgroundColor: '#fbbc04', accessRole: 'reader' },
        ]}), { status: 200 }));
      }
      if (u.includes('/events') && opts.method === 'POST') {
        window.__posted.push({ url: u, body: JSON.parse(opts.body) });
        return Promise.resolve(new Response(JSON.stringify({ id: 'created-1' }), { status: 200 }));
      }
      if (u.includes('/events')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }
      return realFetch(url, opts);
    };
  });

  await page.goto(BASE + '/index.html');

  // 1. Verbinden → ＋ Afspraak-knop verschijnt
  await page.tap('#btn-connect');
  await page.waitForTimeout(300);
  const addVisible = await page.locator('#btn-add-event').isVisible();
  console.log('afspraakknop zichtbaar:', addVisible);
  if (!addVisible) throw new Error('afspraakknop verschijnt niet');

  // 2. Dialog: alleen beschrijfbare agenda's in de keuzelijst
  await page.tap('#btn-add-event');
  const calOptions = await page.locator('#event-calendar option').allTextContents();
  console.log('doelagendas:', JSON.stringify(calOptions));
  if (JSON.stringify(calOptions) !== JSON.stringify(['Tim', 'Gezin'])) throw new Error('alleen-lezen agenda ten onrechte in lijst');

  // 3. Afspraak met tijd + personen aanmaken
  await page.fill('#event-title', 'Zwemles');
  await page.selectOption('#event-calendar', 'gezin-id');
  await page.fill('#event-start', '16:00');
  await page.fill('#event-end', '17:00');
  await page.locator('#event-tags input').nth(2).check(); // Kind 1 (index 2)
  await page.click('#event-form button[type=submit]');
  await page.waitForTimeout(300);
  let posted = await page.evaluate(() => window.__posted);
  console.log('POST:', JSON.stringify(posted[0]?.body), '→', posted[0]?.url.includes('gezin-id') ? 'gezin-id' : 'FOUT');
  if (posted.length !== 1 || posted[0].body.summary !== 'Zwemles' || !posted[0].body.start.dateTime) throw new Error('event-POST fout');
  if (!posted[0].url.includes('gezin-id')) throw new Error('verkeerde doelagenda');
  const newTags = await page.evaluate(() => Tags.getTags('created-1'));
  console.log('tags op nieuwe afspraak:', newTags);
  if (JSON.stringify(newTags) !== '["Kind 1"]') throw new Error('tags niet gezet bij aanmaken');
  const dialogOpen = await page.locator('#event-dialog').evaluate((d) => d.open);
  if (dialogOpen) throw new Error('dialog sluit niet na toevoegen');

  // 4. Hele-dag-afspraak: tijdvelden verdwijnen, POST met date i.p.v. dateTime
  await page.tap('#btn-add-event');
  await page.fill('#event-title', 'Vakantie');
  await page.locator('#event-allday').check();
  const timesHidden = await page.locator('#event-times').isHidden();
  if (!timesHidden) throw new Error('tijdvelden blijven zichtbaar bij hele dag');
  await page.fill('#event-date', '2026-08-21');
  await page.click('#event-form button[type=submit]');
  await page.waitForTimeout(300);
  posted = await page.evaluate(() => window.__posted);
  console.log('hele dag POST:', JSON.stringify(posted[1]?.body));
  const b = posted[1].body;
  if (b.start.date !== '2026-08-21' || b.end.date !== '2026-08-22') throw new Error('hele-dag-datums fout');

  if (errors.length) { console.log('FOUTEN:', errors); process.exit(1); }
  console.log('AFSPRAAK-TOEVOEGEN-TEST GESLAAGD');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
