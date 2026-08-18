const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();

  // === D. refresh()-race: oude week overschrijft nieuwe niet ===
  let page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('familie-app.google-config', JSON.stringify({ clientId: 'x.apps.googleusercontent.com' }));
    localStorage.removeItem('familie-app.selected-calendars');
    window.google = { accounts: { oauth2: { initTokenClient: (o) => ({ requestAccessToken() { o.callback({ access_token: 'T', expires_in: 3600 }); } }) } } };
    // Elke events-call vertraagt op basis van de week (timeMin): oudere week = trager antwoord.
    const rf = window.fetch.bind(window);
    window.fetch = async (u, o = {}) => {
      u = String(u);
      if (u.includes('calendarList')) return new Response(JSON.stringify({ items: [
        { id: 'p', summary: 'Tim', primary: true, selected: true, backgroundColor: '#4285f4', accessRole: 'owner' } ] }), { status: 200 });
      if (u.includes('/events')) {
        const m = u.match(/timeMin=([^&]+)/);
        const wk = decodeURIComponent(m[1]).slice(0, 10);
        // eerste (huidige) week traag (200ms), tweede week snel (10ms) -> race
        const slow = window.__firstWeek === undefined;
        if (window.__firstWeek === undefined) window.__firstWeek = wk;
        const delay = wk === window.__firstWeek ? 250 : 10;
        await new Promise(r => setTimeout(r, delay));
        return new Response(JSON.stringify({ items: [
          { id: 'e-' + wk, summary: 'Afspraak ' + wk, start: { dateTime: wk + 'T10:00:00Z' }, end: { dateTime: wk + 'T11:00:00Z' } } ] }), { status: 200 });
      }
      return rf(u, o);
    };
  });
  await page.goto(BASE + '/index.html');
  await page.click('#btn-connect');
  // meteen doorbladeren terwijl de eerste (trage) week nog laadt
  await page.waitForTimeout(20);
  await page.click('#btn-next');
  await page.waitForTimeout(600); // wacht tot beide antwoorden binnen zijn
  const label = await page.locator('#week-label').textContent();
  const events = await page.locator('.event').allTextContents();
  console.log('D. week:', label.slice(0, 12), '| events:', JSON.stringify(events));
  // De getoonde events moeten bij de ZICHTBARE (tweede) week horen, niet de trage eerste
  const visibleWeekOk = events.every(e => label.includes('35') || true) && events.length >= 1;
  // sterkere check: geen event van de eerste week zichtbaar
  const firstWeekLeaked = await page.evaluate(() => window.__firstWeek);
  if (events.some(e => e.includes(firstWeekLeaked))) throw new Error('D: trage eerste week overschreef de nieuwe (race niet gefixt)');
  console.log('D. geen verouderde week getoond: OK');
  if (errors.length) { console.log('pageerrors:', errors); throw new Error('D: paginafout'); }
  await page.close();

  // === E. Dubbel-submit maakt geen dubbele afspraak ===
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('familie-app.google-config', JSON.stringify({ clientId: 'x.apps.googleusercontent.com' }));
    window.google = { accounts: { oauth2: { initTokenClient: (o) => ({ requestAccessToken() { o.callback({ access_token: 'T', expires_in: 3600 }); } }) } } };
    window.__posts = 0;
    const rf = window.fetch.bind(window);
    window.fetch = async (u, o = {}) => {
      u = String(u);
      if (u.includes('calendarList')) return new Response(JSON.stringify({ items: [
        { id: 'p', summary: 'Tim', primary: true, selected: true, backgroundColor: '#4285f4', accessRole: 'owner' } ] }), { status: 200 });
      if (u.includes('/events') && o.method === 'POST') { window.__posts++; await new Promise(r => setTimeout(r, 120)); return new Response(JSON.stringify({ id: 'new' }), { status: 200 }); }
      if (u.includes('/events')) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      return rf(u, o);
    };
  });
  await page.goto(BASE + '/index.html');
  await page.click('#btn-connect');
  await page.waitForTimeout(200);
  await page.click('#btn-add-event');
  await page.fill('#event-title', 'Zwemles');
  const submit = page.locator('#event-form button[type=submit]');
  await submit.click();
  await submit.click({ force: true }).catch(() => {}); // tweede tik tijdens POST
  await page.waitForTimeout(400);
  const posts = await page.evaluate(() => window.__posts);
  console.log('E. POST-aanroepen:', posts);
  if (posts !== 1) throw new Error('E: dubbele afspraak (' + posts + ' POSTs)');
  await page.close();

  // === F. Fout wachtwoord toont geen 'sessie verlopen' ===
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('familie-app.picnic', JSON.stringify({ proxyUrl: 'https://x.workers.dev' }));
    localStorage.setItem('familie-app.shopping', JSON.stringify([{ id: 'a', name: 'Kaas', done: false }]));
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    window.fetch = async (u, o = {}) => {
      u = String(u);
      if (u.includes('/user/login')) return new Response(JSON.stringify({ error: { message: 'Ongeldige gebruikersnaam of wachtwoord' } }), { status: 401 });
      return new Response('{}', { status: 200 });
    };
  });
  await page.goto(BASE + '/index.html');
  await page.tap('#tab-shopping');
  await page.locator('#shopping-list .picnic-btn').first().tap();
  await page.waitForTimeout(200);
  await page.fill('#picnic-email', 'tim@test.nl');
  await page.fill('#picnic-password', 'fout');
  await page.click('#picnic-login-form button[type=submit]');
  await page.waitForTimeout(300);
  const err = await page.locator('#picnic-login-error').textContent();
  console.log('F. foutmelding:', err);
  if (/verlopen/i.test(err)) throw new Error('F: toont nog "sessie verlopen" bij fout wachtwoord');
  if (!/Ongeldige|mislukt/i.test(err)) throw new Error('F: geen zinnige foutmelding');
  await page.close();

  console.log('RACE/SUBMIT/LOGIN-TEST GESLAAGD');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
