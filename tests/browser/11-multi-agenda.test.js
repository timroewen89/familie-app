const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // Google-API's stubben vóór het laden van de app-scripts
  await page.addInitScript(() => {
    localStorage.setItem('familie-app.google-config', JSON.stringify({ clientId: 'test.apps.googleusercontent.com' }));
    localStorage.removeItem('familie-app.selected-calendars');

    window.google = { accounts: { oauth2: { initTokenClient: (opts) => ({
      requestAccessToken() { opts.callback({ access_token: 'FAKE', expires_in: 3600 }); },
    }) } } };

    const monday = (() => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return d; })();
    const dinsdag = new Date(monday); dinsdag.setDate(monday.getDate()+1);
    const iso = (d, h) => { const x = new Date(d); x.setHours(h,0,0,0); return x.toISOString(); };
    const dateOnly = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    const realFetch = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      const u = String(url);
      if (u.includes('/users/me/calendarList')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [
          { id: 'primary-id', summary: 'Tim', primary: true, selected: true, backgroundColor: '#4285f4' },
          { id: 'gezin-id', summary: 'Gezin', selected: true, backgroundColor: '#34a853' },
          { id: 'werk-id', summary: 'Werk', selected: false, backgroundColor: '#ea4335' },
        ]}), { status: 200 }));
      }
      if (u.includes('/calendars/primary-id/events')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [
          { id: 'ev1', summary: 'Tandarts', start: { dateTime: iso(dinsdag, 10) }, end: { dateTime: iso(dinsdag, 11) } },
        ]}), { status: 200 }));
      }
      if (u.includes('/calendars/gezin-id/events')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [
          { id: 'ev2', summary: 'Zwemles Mick', start: { dateTime: iso(dinsdag, 16) }, end: { dateTime: iso(dinsdag, 17) } },
          { id: 'ev3', summary: 'Vakantie', start: { date: dateOnly(monday) }, end: { date: dateOnly(dinsdag) } },
        ]}), { status: 200 }));
      }
      if (u.includes('/calendars/werk-id/events')) {
        return Promise.resolve(new Response(JSON.stringify({ items: [
          { id: 'ev4', summary: 'Vergadering', start: { dateTime: iso(dinsdag, 9) }, end: { dateTime: iso(dinsdag, 10) } },
        ]}), { status: 200 }));
      }
      return realFetch(url, opts);
    };
  });

  await page.goto(BASE + '/index.html');

  // 1. Verbinden via gestubde Google-login
  await page.tap('#btn-connect');
  await page.waitForTimeout(300);
  const btnText = await page.locator('#btn-connect').textContent();
  console.log('verbindknop:', btnText);
  if (!btnText.includes('Verbonden')) throw new Error('verbinden faalt');

  // 2. Standaard: alleen zichtbare agenda's (Tim + Gezin), niet Werk
  const titles = await page.locator('.event').allTextContents();
  console.log('events:', JSON.stringify(titles));
  if (!titles.some(t => t.includes('Tandarts')) || !titles.some(t => t.includes('Zwemles'))) throw new Error('events uit meerdere agendas ontbreken');
  if (titles.some(t => t.includes('Vergadering'))) throw new Error('onzichtbare agenda (Werk) ten onrechte geladen');
  if (!titles.some(t => t.includes('hele dag') && t.includes('Vakantie'))) throw new Error('hele-dag-event ontbreekt');

  // 3. Agendakleuren op de events
  const borderColors = await page.locator('.event').evaluateAll(els => els.map(e => e.style.borderLeftColor));
  console.log('kleuren:', JSON.stringify(borderColors));
  if (!borderColors.some(c => c.includes('66, 133, 244')) || !borderColors.some(c => c.includes('52, 168, 83'))) throw new Error('agendakleuren ontbreken');

  // 4. Agenda-kiezer: 3 agenda's, juiste vinkjes
  await page.tap('#btn-calendars');
  const options = await page.locator('#calendars-options .tag-option').allTextContents();
  console.log('kiezer:', JSON.stringify(options));
  if (options.length !== 3) throw new Error('agendalijst fout');
  const checks = await page.locator('#calendars-options input').evaluateAll(els => els.map(e => e.checked));
  if (JSON.stringify(checks) !== JSON.stringify([true, true, false])) throw new Error('standaardselectie fout');

  // 5. Werk aanvinken → Vergadering verschijnt; selectie wordt bewaard
  await page.locator('#calendars-options input').nth(2).check();
  await page.waitForTimeout(300);
  await page.tap('#btn-calendars-close');
  const titles2 = await page.locator('.event').allTextContents();
  if (!titles2.some(t => t.includes('Vergadering'))) throw new Error('agenda bijschakelen faalt');
  const din = titles2.filter(t => /Vergadering|Tandarts|Zwemles/.test(t));
  console.log('volgorde dinsdag:', JSON.stringify(din));
  if (JSON.stringify(din) !== JSON.stringify(['09:00Vergadering','10:00Tandarts','16:00Zwemles Mick'])) throw new Error('tijdsortering fout');
  const stored = await page.evaluate(() => localStorage.getItem('familie-app.selected-calendars'));
  console.log('opgeslagen selectie:', stored);
  if (!stored.includes('werk-id')) throw new Error('selectie niet bewaard');

  // 6. Gezin uitvinken → Zwemles verdwijnt
  await page.tap('#btn-calendars');
  await page.locator('#calendars-options input').nth(1).uncheck();
  await page.waitForTimeout(300);
  await page.tap('#btn-calendars-close');
  const titles3 = await page.locator('.event').allTextContents();
  if (titles3.some(t => t.includes('Zwemles'))) throw new Error('agenda uitschakelen faalt');

  // 7. Tag op een event uit een tweede agenda werkt nog
  await page.locator('.event', { hasText: 'Vergadering' }).tap();
  await page.locator('#tags-options input').first().check();
  await page.keyboard.press('Escape');
  const evTags = await page.evaluate(() => Tags.getTags('ev4'));
  console.log('tags op ev4:', evTags);
  if (JSON.stringify(evTags) !== '["Ouder 1"]') throw new Error('taggen op multi-agenda-event faalt');

  await page.screenshot({ path: require('os').tmpdir() + '/familie-app-multical.png' });
  if (errors.length) { console.log('FOUTEN:', errors); process.exit(1); }
  console.log('MULTI-AGENDA-TEST GESLAAGD');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
