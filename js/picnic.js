/**
 * Picnic-koppeling voor de boodschappenlijst.
 *
 * Gebruikt de (onofficiële) Picnic-API via een eigen CORS-proxy (zie
 * worker/picnic-proxy.js en de README). Inloggen gebeurt met je eigen
 * Picnic-account (incl. SMS-2FA); het auth-token wordt alleen lokaal in de
 * browser bewaard, het wachtwoord wordt nooit opgeslagen.
 *
 * Let op: dit is een community-API zonder garanties — als Picnic zijn app
 * wijzigt kan deze koppeling tijdelijk breken. De deel-knop blijft dan werken.
 */
const Picnic = (() => {
  const CONFIG_KEY = 'familie-app.picnic';
  const API_PATH = '/api/15';
  const PICNIC_HEADERS = {
    'x-picnic-agent': '30100;1.236.1-15553;',
    'x-picnic-did': '3C417201548B2E3B',
  };

  let config = null; // { proxyUrl, authKey }
  /** Boodschappenitem waarvoor een Picnic-zoekactie loopt. */
  let currentItemName = null;
  /**
   * Alleen bij zoeken vanuit het invoerveld: mandje-toevoegingen ook op het
   * lijstje zetten. Bij zoeken vanaf een bestaand lijstje-item (P-knop) niet,
   * want dan staat het item er al.
   */
  let linkToList = false;

  // ---- MD5 (RFC 1321) -------------------------------------------------------
  // Picnic's login verwacht md5(wachtwoord) als secret. Browsers hebben geen
  // ingebouwde MD5, dus een eigen implementatie; constanten volgens de RFC
  // (K[i] = floor(2^32 * |sin(i+1)|) — berekend in plaats van hardcoded).

  function md5(input) {
    const bytes = new TextEncoder().encode(input);
    const K = new Int32Array(64);
    for (let i = 0; i < 64; i++) K[i] = Math.floor(2 ** 32 * Math.abs(Math.sin(i + 1))) | 0;
    const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

    const words = new Int32Array((((bytes.length + 8) >> 6) + 1) * 16);
    for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
    words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
    words[words.length - 2] = bytes.length << 3;

    let a0 = 0x67452301 | 0;
    let b0 = 0xefcdab89 | 0;
    let c0 = 0x98badcfe | 0;
    let d0 = 0x10325476 | 0;

    for (let block = 0; block < words.length; block += 16) {
      let a = a0, b = b0, c = c0, d = d0;
      for (let i = 0; i < 64; i++) {
        let f, g;
        if (i < 16) { f = (b & c) | (~b & d); g = i; }
        else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
        else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
        else { f = c ^ (b | ~d); g = (7 * i) % 16; }
        const rot = S[((i >> 4) << 2) | (i & 3)];
        const sum = (a + f + K[i] + words[block + g]) | 0;
        const rotated = (sum << rot) | (sum >>> (32 - rot));
        [a, d, c, b] = [d, c, b, (b + rotated) | 0];
      }
      a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
    }

    const hex = (n) => [0, 8, 16, 24]
      .map((s) => ((n >>> s) & 0xff).toString(16).padStart(2, '0')).join('');
    return hex(a0) + hex(b0) + hex(c0) + hex(d0);
  }

  // ---- Configuratie -----------------------------------------------------------

  function load() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      config = raw ? JSON.parse(raw) : {};
      if (typeof config !== 'object' || config === null) config = {};
    } catch {
      config = {};
    }
  }

  function save() {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  function isConfigured() {
    return !!(config && config.proxyUrl);
  }

  function isLoggedIn() {
    return !!(config && config.authKey);
  }

  // ---- API via de proxy --------------------------------------------------------

  function proxyBase() {
    return config.proxyUrl.replace(/\/+$/, '');
  }

  async function request(method, path, body, withPicnicHeaders = false, includeAuth = true) {
    const headers = { 'Content-Type': 'application/json; charset=UTF-8' };
    if (includeAuth && config.authKey) headers['x-picnic-auth'] = config.authKey;
    if (config.proxyKey) headers['x-proxy-key'] = config.proxyKey;
    if (withPicnicHeaders) Object.assign(headers, PICNIC_HEADERS);

    const response = await fetch(proxyBase() + API_PATH + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    // Inloggen/2FA horen NIET als 'sessie verlopen' behandeld te worden: daar
    // betekent een 401/403 juist onjuiste gegevens of een verkeerde code.
    const isAuthFlow = path.startsWith('/user/login') || path.startsWith('/user/2fa');
    if (!isAuthFlow && (response.status === 401 || response.status === 403)) {
      config.authKey = null;
      save();
      const err = new Error('je Picnic-sessie is verlopen — log opnieuw in');
      err.auth = true;
      throw err;
    }
    if (!response.ok) {
      let message = null;
      try { message = (await response.json())?.error?.message; } catch { /* geen JSON */ }
      throw new Error(message || `HTTP ${response.status}`);
    }
    return response;
  }

  /** @returns {Promise<boolean>} true als er nog een 2FA-stap nodig is. */
  async function login(email, password) {
    const response = await request(
      'POST', '/user/login',
      { key: email, secret: md5(password), client_id: 30100 },
      false, false
    );
    const authKey = response.headers.get('x-picnic-auth');
    if (!authKey) throw new Error('geen token ontvangen — controleer je gegevens');
    config.authKey = authKey;
    save();
    const data = await response.json().catch(() => ({}));
    return !!data.second_factor_authentication_required;
  }

  async function start2FA() {
    await request('POST', '/user/2fa/generate', { channel: 'SMS' }, true);
  }

  async function verify2FA(code) {
    const response = await request('POST', '/user/2fa/verify', { otp: code }, true);
    const authKey = response.headers.get('x-picnic-auth');
    if (authKey) {
      config.authKey = authKey;
      save();
    }
  }

  function logout() {
    config.authKey = null;
    save();
  }

  /** Zoekt producten; resultaat is een lijst sellingUnits {id, name, display_price, unit_quantity}. */
  async function search(query) {
    const response = await request(
      'GET', `/pages/search-page-results?search_term=${encodeURIComponent(query)}`,
      null, true
    );
    const page = await response.json();
    // De resultaten zitten als 'sellingUnit'-knopen verspreid in een dynamische
    // paginastructuur; recursief verzamelen is robuuster dan een vast pad.
    // De productfoto zit soms niet in sellingUnit.image_id maar in het
    // sellingUnitImageConfiguration-veld van dezelfde tegel.
    const units = [];
    (function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.sellingUnit && node.sellingUnit.id) {
        const unit = { ...node.sellingUnit };
        if (!unit.image_id) {
          unit.image_id = node.sellingUnitImageConfiguration?.id
            || (Array.isArray(unit.image_ids) ? unit.image_ids[0] : null);
        }
        units.push(unit);
      }
      for (const value of Object.values(node)) walk(value);
    })(page);
    const seen = new Set();
    return units.filter((u) => !seen.has(u.id) && seen.add(u.id));
  }

  async function addToCart(productId, count = 1) {
    await request('POST', '/cart/add_product', { product_id: productId, count }, true);
  }

  async function removeFromCart(productId, count = 1) {
    await request('POST', '/cart/remove_product', { product_id: productId, count }, true);
  }

  /** Voor de boodschappenlijst: gekoppeld product uit het echte mandje halen. */
  async function removeFromBasket(productId, count) {
    if (!isConfigured() || !isLoggedIn()) throw new Error('niet ingelogd bij Picnic');
    await removeFromCart(productId, count);
  }

  /** Voor favorieten: een product rechtstreeks in het echte mandje leggen. */
  async function addToBasket(productId, count = 1) {
    if (!isConfigured() || !isLoggedIn()) throw new Error('niet ingelogd bij Picnic');
    await addToCart(productId, count);
  }

  // ---- UI: knop per boodschappenitem -------------------------------------------

  /** Picnic-zoekknop voor een open boodschappenitem (of null als niet ingesteld). */
  function buttonFor(item) {
    if (!isConfigured() || item.done) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picnic-btn';
    btn.textContent = 'P';
    btn.title = `"${item.name}" zoeken in Picnic`;
    btn.setAttribute('aria-label', `${item.name} zoeken in Picnic`);
    btn.addEventListener('click', () => startSearch(item.name, false));
    return btn;
  }

  function startSearch(itemName, addToList = false) {
    currentItemName = itemName;
    linkToList = addToList;
    if (!isLoggedIn()) {
      openLoginDialog();
    } else {
      openSearchDialog();
    }
  }

  /** Zoekt direct op de tekst in het invoerveld; mandje-toevoegingen komen dan ook op het lijstje. */
  function quickSearch() {
    const input = document.getElementById('shopping-input');
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    startSearch(text, true);
  }

  function updateQuickButton() {
    document.getElementById('btn-picnic-quick').hidden = !isConfigured();
  }

  // ---- UI: inlog-dialog ----------------------------------------------------------

  function openLoginDialog() {
    setLoginError('');
    document.getElementById('picnic-step-login').hidden = false;
    document.getElementById('picnic-step-2fa').hidden = true;
    document.getElementById('picnic-password').value = '';
    document.getElementById('picnic-2fa-code').value = '';
    document.getElementById('picnic-login-dialog').showModal();
  }

  function setLoginError(message) {
    const el = document.getElementById('picnic-login-error');
    el.textContent = message;
    el.hidden = !message;
  }

  async function submitLogin(e) {
    e.preventDefault();
    const email = document.getElementById('picnic-email').value.trim();
    const password = document.getElementById('picnic-password').value;
    if (!email || !password) return;
    try {
      setLoginError('');
      const needs2FA = await login(email, password);
      document.getElementById('picnic-password').value = '';
      if (needs2FA) {
        await start2FA();
        document.getElementById('picnic-step-login').hidden = true;
        document.getElementById('picnic-step-2fa').hidden = false;
        document.getElementById('picnic-2fa-code').focus();
      } else {
        finishLogin();
      }
    } catch (err) {
      setLoginError(`Inloggen mislukt: ${App.friendlyError(err)}`);
    }
  }

  async function submit2FA(e) {
    e.preventDefault();
    const code = document.getElementById('picnic-2fa-code').value.trim();
    if (!code) return;
    try {
      setLoginError('');
      await verify2FA(code);
      finishLogin();
    } catch (err) {
      setLoginError(`Code onjuist: ${err.message || 'probeer opnieuw'}`);
    }
  }

  function finishLogin() {
    document.getElementById('picnic-login-dialog').close();
    updateSettingsStatus();
    if (currentItemName) openSearchDialog();
  }

  // ---- UI: zoek-dialog -------------------------------------------------------------

  async function openSearchDialog() {
    const dialog = document.getElementById('picnic-search-dialog');
    const results = document.getElementById('picnic-results');
    document.getElementById('picnic-search-title').textContent = `Picnic: ${currentItemName}`;
    results.textContent = '';
    const loading = document.createElement('p');
    loading.className = 'hint';
    loading.textContent = 'Zoeken…';
    results.appendChild(loading);
    dialog.showModal();

    try {
      const units = (await search(currentItemName)).slice(0, 6);
      results.textContent = '';
      if (units.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = 'Niets gevonden. Pas eventueel de naam van het item aan.';
        results.appendChild(empty);
        return;
      }
      for (const unit of units) {
        results.appendChild(buildResultRow(unit));
      }
      // Focus naar het eerste resultaat zodat toetsenbord/VoiceOver bij de
      // resultaten begint in plaats van bij de 'Klaar'-knop.
      const firstAction = results.querySelector('.picnic-add, .picnic-step-btn');
      if (firstAction) firstAction.focus();
    } catch (err) {
      results.textContent = '';
      const error = document.createElement('p');
      error.className = 'status error';
      error.textContent = err.auth
        ? 'Je Picnic-sessie is verlopen. Sluit dit venster en probeer opnieuw om in te loggen.'
        : `Zoeken mislukt: ${App.friendlyError(err)}`;
      results.appendChild(error);
    }
  }

  function buildResultRow(unit) {
    const row = document.createElement('div');
    row.className = 'picnic-result';

    if (unit.image_id) {
      const img = document.createElement('img');
      img.className = 'picnic-result-img';
      img.loading = 'lazy';
      img.alt = '';
      // CORS-modus zodat de browser het antwoord van de proxy accepteert. De
      // afbeeldingsroute in de Worker is bewust publiek (geen origin- of
      // sleutelcontrole): productfoto's zijn geen credentials.
      img.crossOrigin = 'anonymous';
      img.src = `${proxyBase()}/static/images/${encodeURIComponent(unit.image_id)}/small.png`;
      // Als de afbeelding niet laadt (bijv. gewijzigde Picnic-API), gewoon weglaten.
      img.addEventListener('error', () => img.remove());
      row.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'picnic-result-info';
    const name = document.createElement('div');
    name.textContent = unit.name;
    const meta = document.createElement('div');
    meta.className = 'picnic-result-meta';
    const price = typeof unit.display_price === 'number'
      ? `€ ${(unit.display_price / 100).toFixed(2).replace('.', ',')}` : '';
    meta.textContent = [unit.unit_quantity, price].filter(Boolean).join(' · ');
    info.append(name, meta);

    row.append(info, buildStepper(unit));
    return row;
  }

  /**
   * Mandje-bediening per product: eerst een "Mandje"-knop; na het toevoegen
   * een teller met − en + (zoals in de Picnic-app zelf). De teller toont wat
   * je in dít zoekvenster hebt toegevoegd; − haalt ook echt uit je mandje.
   */
  function buildStepper(unit) {
    const actions = document.createElement('div');
    actions.className = 'picnic-actions';
    let inBasket = 0;
    let busy = false; // blokkeert ook toetsenbord-activatie tijdens een lopende call
    const maxCount = Number(unit.max_count) > 0 ? Number(unit.max_count) : 99;
    // Gekoppeld lijstje-item (alleen bij zoeken vanuit het invoerveld).
    const addToList = linkToList;
    let listItemId = null;

    function syncListItem() {
      if (!addToList) return;
      const label = inBasket > 1 ? `${inBasket}× ${unit.name}` : unit.name;
      if (inBasket === 0 && listItemId) {
        // Teller staat weer op 0: het mandje is al bijgewerkt via de minknop,
        // dus alleen de koppeling loskoppelen vóór het lijstitem weggaat.
        Shopping.setPicnicLink(listItemId, null, 0);
        Shopping.removeItem(listItemId);
        listItemId = null;
      } else if (inBasket > 0 && !listItemId) {
        listItemId = Shopping.addItem(label);
        Shopping.setPicnicLink(listItemId, unit.id, inBasket, unit.name);
        // Het getypte zoekwoord is verwerkt: veld leegmaken.
        document.getElementById('shopping-input').value = '';
      } else if (listItemId) {
        Shopping.renameItem(listItemId, label);
        Shopping.setPicnicLink(listItemId, unit.id, inBasket, unit.name);
      }
    }

    async function mutate(delta) {
      if (busy) return;
      // Grenzen bewaken: nooit onder 0 of boven het maximum.
      if (delta < 0 && inBasket <= 0) return;
      if (delta > 0 && inBasket >= maxCount) return;
      busy = true;
      actions.classList.add('busy');
      try {
        if (delta > 0) await addToCart(unit.id, 1);
        else await removeFromCart(unit.id, 1);
        inBasket += delta;
        syncListItem();
      } catch (err) {
        App.toast(`Mandje bijwerken mislukt: ${App.friendlyError(err)}`);
      } finally {
        busy = false;
        actions.classList.remove('busy');
        render();
      }
    }

    function stepButton(kind, label, delta, disabled) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn picnic-step-btn';
      btn.innerHTML = Icons.html(kind);
      btn.setAttribute('aria-label', `${label} ${unit.name}`);
      btn.disabled = disabled;
      btn.addEventListener('click', () => mutate(delta));
      return btn;
    }

    function render() {
      actions.textContent = '';
      if (inBasket === 0) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'btn btn-primary picnic-add';
        add.innerHTML = `${Icons.html('plus')}Mandje`;
        add.addEventListener('click', () => mutate(1));
        actions.appendChild(add);
      } else {
        const count = document.createElement('span');
        count.className = 'picnic-count';
        count.textContent = inBasket;
        actions.append(
          stepButton('minus', 'Eén minder', -1, false),
          count,
          stepButton('plus', 'Eén extra', 1, inBasket >= maxCount)
        );
      }
    }

    render();
    return actions;
  }

  // ---- UI: instellingen ---------------------------------------------------------------

  function updateSettingsStatus() {
    const status = document.getElementById('picnic-status');
    const logoutBtn = document.getElementById('btn-picnic-logout');
    if (!isConfigured()) {
      status.textContent = 'Nog niet ingesteld.';
      logoutBtn.hidden = true;
    } else if (isLoggedIn()) {
      status.textContent = 'Ingelogd bij Picnic ✓';
      logoutBtn.hidden = false;
    } else {
      status.textContent = 'Proxy ingesteld; inloggen gebeurt bij de eerste zoekactie.';
      logoutBtn.hidden = true;
    }
  }

  function init() {
    load();

    document.getElementById('input-picnic-url').value = config.proxyUrl || '';
    document.getElementById('input-picnic-key').value = config.proxyKey || '';
    document.getElementById('settings-form').addEventListener('submit', () => {
      const newUrl = document.getElementById('input-picnic-url').value.trim();
      const newKey = document.getElementById('input-picnic-key').value.trim();
      if (newUrl !== (config.proxyUrl || '')) {
        config.proxyUrl = newUrl || null;
        if (!newUrl) config.authKey = null;
      }
      config.proxyKey = newKey || null;
      save();
      updateSettingsStatus();
      updateQuickButton();
      Shopping.rerender();
    });
    document.getElementById('btn-settings').addEventListener('click', () => {
      document.getElementById('input-picnic-url').value = config.proxyUrl || '';
      document.getElementById('input-picnic-key').value = config.proxyKey || '';
      updateSettingsStatus();
    });
    document.getElementById('btn-picnic-logout').addEventListener('click', () => {
      logout();
      updateSettingsStatus();
    });

    document.getElementById('picnic-login-form').addEventListener('submit', submitLogin);
    document.getElementById('picnic-2fa-form').addEventListener('submit', submit2FA);
    document.getElementById('btn-picnic-login-cancel').addEventListener('click', () => {
      document.getElementById('picnic-login-dialog').close();
    });
    document.getElementById('btn-picnic-search-close').addEventListener('click', () => {
      document.getElementById('picnic-search-dialog').close();
    });
    document.getElementById('btn-picnic-quick').addEventListener('click', quickSearch);

    updateSettingsStatus();
    updateQuickButton();
  }

  return { init, buttonFor, isConfigured, isLoggedIn, removeFromBasket, addToBasket, md5 };
})();
