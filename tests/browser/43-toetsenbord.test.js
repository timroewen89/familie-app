const { launch, BASE, PNG_1PX } = require('./_helpers');
(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('familie-app.google-config', JSON.stringify({ clientId: 'x.apps.googleusercontent.com' }));
    localStorage.removeItem('familie-app.selected-calendars');
    window.google = { accounts: { oauth2: { initTokenClient: (o) => ({ requestAccessToken() { o.callback({ access_token: 'T', expires_in: 3600 }); } }) } } };
    const monday = (() => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-((d.getDay()+6)%7)); return d; })();
    const iso = (h) => { const x = new Date(monday); x.setDate(monday.getDate()+1); x.setHours(h,0,0,0); return x.toISOString(); };
    window.fetch = async (u, o={}) => {
      u = String(u);
      if (u.includes('calendarList')) return new Response(JSON.stringify({ items: [
        { id: 'p', summary: 'Tim', primary: true, selected: true, backgroundColor: '#4285f4', accessRole: 'owner' } ] }), { status: 200 });
      if (u.includes('/events')) return new Response(JSON.stringify({ items: [
        { id: 'ev1', summary: 'Tandarts', start: { dateTime: iso(10) }, end: { dateTime: iso(11) } } ] }), { status: 200 });
      return new Response('{}', { status: 200 });
    };
  });
  await page.goto(BASE + '/index.html');
  await page.click('#btn-connect');
  await page.waitForTimeout(400);
  const ev = page.locator('.event', { hasText: 'Tandarts' }).first();
  // focusbaar?
  const tabindex = await ev.getAttribute('tabindex');
  const role = await ev.getAttribute('role');
  const label = await ev.getAttribute('aria-label');
  console.log('event tabindex:', tabindex, '| role:', role, '| label:', (label||'').slice(0,30));
  if (tabindex !== '0' || role !== 'button') throw new Error('event niet toetsenbord-toegankelijk');
  // Enter opent de tag-dialog
  await ev.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const dialogOpen = await page.locator('#tags-dialog').evaluate(d => d.open);
  console.log('Enter opent tag-dialog:', dialogOpen);
  if (!dialogOpen) throw new Error('Enter opent tag-dialog niet');
  console.log('TOETSENBORD-TEST GESLAAGD');
  await browser.close();
})().catch(e => { console.error('FAAL:', e.message); process.exit(1); });
