const { launch, BASE, PNG_1PX } = require('./_helpers');
const crypto = require('crypto');
const expectedSecret = crypto.createHash('md5').update('geheim123', 'utf8').digest('hex');

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.addInitScript(() => {
    localStorage.setItem('familie-app.shopping', JSON.stringify([{ id: 'i1', name: 'Melk', done: false }]));
    if (!localStorage.getItem('familie-app.picnic')) localStorage.setItem('familie-app.picnic', JSON.stringify({ proxyUrl: 'https://proxy.test.workers.dev' }));
    window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } };
    window.__calls = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts = {}) => {
      const u = String(url);
      if (!u.startsWith('https://proxy.test')) return realFetch(url, opts);
      window.__calls.push({ url: u, method: opts.method, body: opts.body || null, headers: opts.headers || {} });
      if (u.includes('/user/login')) {
        return new Response(JSON.stringify({ second_factor_authentication_required: true, user_id: 'u1' }),
          { status: 200, headers: { 'x-picnic-auth': 'TOKEN-1' } });
      }
      if (u.includes('/user/2fa/generate')) return new Response(null, { status: 204 });
      if (u.includes('/user/2fa/verify')) {
        return new Response(null, { status: 204, headers: { 'x-picnic-auth': 'TOKEN-2FA' } });
      }
      if (u.includes('/pages/search-page-results')) {
        return new Response(JSON.stringify({ body: { children: [
          { type: 'SELLING_UNIT_TILE', sellingUnit: { id: 'prod-1', name: 'Halfvolle melk', display_price: 119, unit_quantity: '1 liter', image_id: 'img-melk' } },
          { child: { sellingUnit: { id: 'prod-2', name: 'Volle melk', display_price: 129, unit_quantity: '1 liter' }, sellingUnitImageConfiguration: { id: 'img-vol', extension: 'png', derivativeType: 'x' } } },
          { child: { sellingUnit: { id: 'prod-1', name: 'Halfvolle melk', display_price: 119, unit_quantity: '1 liter' } } },
        ] } }), { status: 200 });
      }
      if (u.includes('/cart/add_product')) return new Response(JSON.stringify({}), { status: 200 });
      return new Response('{}', { status: 404 });
    };
  });

    await page.route('**/static/images/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
  await page.goto(BASE + '/index.html');
  await page.tap('#tab-shopping');

  // 1. P-knop zichtbaar bij open item
  const pVisible = await page.locator('#shopping-list .picnic-btn').count();
  console.log('P-knoppen:', pVisible);
  if (pVisible !== 1) throw new Error('P-knop ontbreekt');

  // 2. Tik → inlogdialog; inloggen met 2FA-flow
  await page.tap('#shopping-list .picnic-btn');
  await page.fill('#picnic-email', 'tim@test.nl');
  await page.fill('#picnic-password', 'geheim123');
  await page.click('#picnic-login-form button[type=submit]');
  await page.waitForTimeout(300);
  const step2Visible = await page.locator('#picnic-step-2fa').isVisible();
  console.log('2FA-stap zichtbaar:', step2Visible);
  if (!step2Visible) throw new Error('2FA-stap verschijnt niet');

  await page.fill('#picnic-2fa-code', '12345');
  await page.click('#picnic-2fa-form button[type=submit]');
  await page.waitForTimeout(400);

  // 3. Login-request: md5-secret + client_id correct; wachtwoord NIET als plaintext verstuurd
  const calls = await page.evaluate(() => window.__calls);
  const loginCall = calls.find(c => c.url.includes('/user/login'));
  const loginBody = JSON.parse(loginCall.body);
  console.log('login body:', JSON.stringify(loginBody));
  if (loginBody.secret !== expectedSecret) throw new Error('md5-secret fout: ' + loginBody.secret);
  if (loginBody.key !== 'tim@test.nl' || loginBody.client_id !== 30100) throw new Error('login body fout');
  if (loginBody.secret === 'geheim123') throw new Error('wachtwoord als plaintext verstuurd!');
  const twoFaVerify = calls.find(c => c.url.includes('/2fa/verify'));
  if (JSON.parse(twoFaVerify.body).otp !== '12345') throw new Error('2FA body fout');

  // 4. Na login opent de zoekdialog automatisch met gededuplicete resultaten
  const results = await page.locator('.picnic-result').count();
  console.log('zoekresultaten:', results);
  if (results !== 2) throw new Error('resultaten fout (dedup?)');
  const firstText = await page.locator('.picnic-result').first().textContent();
  console.log('eerste resultaat:', firstText);
  if (!firstText.includes('Halfvolle melk') || !firstText.includes('1,19')) throw new Error('resultaatweergave fout');

  // 4b. Thumbnail: img wijst naar de proxy-afbeeldingsroute en laadt
  const img = page.locator('.picnic-result-img').first();
  const src2 = await img.getAttribute('src');
  console.log('thumbnail src:', src2);
  if (src2 !== 'https://proxy.test.workers.dev/static/images/img-melk/small.png') throw new Error('thumbnail-URL fout');
  const loaded = await img.evaluate((el) => el.complete && el.naturalWidth > 0);
  console.log('thumbnail geladen:', loaded);
  if (!loaded) throw new Error('thumbnail laadt niet');
  const cross = await img.getAttribute('crossorigin');
  console.log('crossorigin:', cross);
  if (cross !== 'anonymous') throw new Error('crossorigin ontbreekt');
  const src3 = await page.locator('.picnic-result-img').nth(1).getAttribute('src');
  console.log('fallback thumbnail:', src3);
  if (!src3.includes('img-vol')) throw new Error('imageconfig-fallback faalt');

  // 5. Toevoegen aan mandje: juiste product_id + token-header
  await page.locator('.picnic-add').first().tap();
  await page.waitForTimeout(300);
  const addCall = (await page.evaluate(() => window.__calls)).find(c => c.url.includes('/cart/add_product'));
  console.log('add body:', addCall.body, '| auth:', addCall.headers['x-picnic-auth']);
  if (JSON.parse(addCall.body).product_id !== 'prod-1') throw new Error('verkeerd product toegevoegd');
  if (addCall.headers['x-picnic-auth'] !== 'TOKEN-2FA') throw new Error('2FA-token niet gebruikt');
  const stepCount = await page.locator('.picnic-result').first().locator('.picnic-count').textContent();
  if (stepCount !== '1') throw new Error('teller-feedback ontbreekt');

  // 6. Token persistent na herladen; direct zoekdialog (geen login meer)
  await page.tap('#btn-picnic-search-close');
  await page.reload();
  await page.tap('#shopping-list .picnic-btn');
  await page.waitForTimeout(300);
  const loginOpen = await page.locator('#picnic-login-dialog').evaluate(d => d.open);
  const searchOpen = await page.locator('#picnic-search-dialog').evaluate(d => d.open);
  console.log('na herladen — login:', loginOpen, '| zoeken:', searchOpen);
  if (loginOpen || !searchOpen) throw new Error('token niet onthouden');

  await page.screenshot({ path: require('os').tmpdir() + '/familie-app-picnic.png' });
  if (errors.length) { console.log('FOUTEN:', errors); process.exit(1); }
  console.log('PICNIC-TEST GESLAAGD');
  await browser.close();
})().catch((e) => { console.error('FAAL:', e.message); process.exit(1); });
