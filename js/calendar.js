/**
 * Google Calendar integratie.
 *
 * Gebruikt Google Identity Services (OAuth2, alleen-lezen scope) en roept de
 * Calendar API v3 rechtstreeks aan met het OAuth-token (fetch + Bearer).
 * Er is bewust géén API-key: het access token is voldoende, dus er valt
 * niets te lekken of te beperken. De OAuth Client-ID (publiek gegeven,
 * beschermd via Authorized JavaScript Origins) voert de gebruiker eenmalig
 * in via het instellingenpaneel; die wordt alleen lokaal bewaard.
 */
const Cal = (() => {
  const CONFIG_KEY = 'familie-app.google-config';
  const SELECTED_KEY = 'familie-app.selected-calendars';
  // Lezen van agenda's/afspraken + aanmaken van afspraken (beide "sensitive",
  // niet "restricted"); de agenda-lijst zelf valt onder calendar.readonly.
  const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events';
  const API_BASE = 'https://www.googleapis.com/calendar/v3';

  let config = null; // { clientId }
  let tokenClient = null;
  let accessToken = null;
  let tokenExpiresAt = 0;
  let connected = false;
  /** Lopende inlogaanvraag: {resolve, reject} van de requestToken-promise. */
  let pendingAuth = null;

  /** Beschikbare agenda's van het account: {id, name, color, primary, visible}. */
  let calendars = [];
  /** Door de gebruiker gekozen agenda-id's; null = automatisch (zichtbaar in Google Calendar). */
  let selectedIds = null;

  /** Events van de huidige week, gegroepeerd per dagsleutel 'YYYY-MM-DD'. */
  let eventsByDay = {};
  /** Loopt op bij elke refresh(); een trage oude aanvraag herkent zo dat hij verouderd is. */
  let refreshGen = 0;

  // ---- Configuratie -------------------------------------------------------

  function loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      config = raw ? JSON.parse(raw) : null;
      // Migratie: oudere versies bewaarden ook een API-key; die is niet meer nodig.
      if (config && 'apiKey' in config) {
        config = config.clientId ? { clientId: config.clientId } : null;
        if (config) localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
        else localStorage.removeItem(CONFIG_KEY);
      }
    } catch {
      config = null;
    }
  }

  function saveConfig(clientId) {
    config = { clientId: clientId.trim() };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  function hasConfig() {
    return !!(config && config.clientId);
  }

  function loadSelection() {
    try {
      const raw = localStorage.getItem(SELECTED_KEY);
      selectedIds = raw ? JSON.parse(raw) : null;
      if (!Array.isArray(selectedIds)) selectedIds = null;
    } catch {
      selectedIds = null;
    }
  }

  function saveSelection() {
    if (selectedIds) localStorage.setItem(SELECTED_KEY, JSON.stringify(selectedIds));
    else localStorage.removeItem(SELECTED_KEY);
  }

  /** De agenda-id's die in het overzicht meedoen. */
  function activeCalendarIds() {
    if (calendars.length === 0) return ['primary'];
    if (selectedIds) return selectedIds.filter((id) => calendars.some((c) => c.id === id));
    // Automatisch: de agenda's die in Google Calendar zelf zichtbaar staan.
    const visible = calendars.filter((c) => c.visible).map((c) => c.id);
    return visible.length ? visible : calendars.filter((c) => c.primary).map((c) => c.id);
  }

  // ---- Google Identity Services laden --------------------------------------

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Kon ${src} niet laden`));
      document.head.appendChild(script);
    });
  }

  async function ensureTokenClient() {
    if (!window.google || !window.google.accounts) {
      await loadScript('https://accounts.google.com/gsi/client');
    }
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: config.clientId,
        scope: SCOPE,
        callback: (response) => {
          const pending = pendingAuth;
          pendingAuth = null;
          if (!pending) return;
          if (response.error) {
            pending.reject(new Error(describeAuthError(response.error)));
          } else {
            accessToken = response.access_token;
            // Marge van een minuut zodat we nooit met een net-verlopen token werken.
            tokenExpiresAt = Date.now() + (Number(response.expires_in) - 60) * 1000;
            pending.resolve();
          }
        },
        // Zonder error_callback gooit GIS bij een geblokkeerde popup een kaal
        // object zonder .message — dat toonde "undefined" in de statusbalk.
        error_callback: (err) => {
          const pending = pendingAuth;
          pendingAuth = null;
          if (pending) pending.reject(new Error(describeAuthError(err?.type)));
        },
      });
    }
  }

  /** Vertaalt GIS-foutcodes naar een begrijpelijke Nederlandse melding. */
  function describeAuthError(code) {
    switch (code) {
      case 'popup_failed_to_open':
        return 'de browser blokkeerde het inlogvenster — sta pop-ups toe voor deze site en probeer opnieuw';
      case 'popup_closed':
      case 'user_cancel':
        return 'het inlogvenster werd gesloten voordat je inlogde';
      case 'access_denied':
        return 'toegang geweigerd — staat dit Google-account als test user in de Google Cloud Console?';
      case 'invalid_client':
        return 'de Client-ID lijkt ongeldig — controleer hem via ⚙️';
      default:
        return code
          ? `${code} — controleer je Client-ID en of jouw site-adres bij de Authorized JavaScript origins staat (nieuwe origins kunnen even duren voordat ze actief zijn)`
          : 'onbekende fout';
    }
  }

  function requestToken() {
    return new Promise((resolve, reject) => {
      pendingAuth = { resolve, reject };
      // Leeg prompt: Google toont het toestemmingsscherm alleen wanneer dat
      // nodig is en geeft anders stil een nieuw token uit.
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  async function ensureToken() {
    if (accessToken && Date.now() < tokenExpiresAt) return;
    await requestToken();
  }

  // ---- Verbinden en events ophalen ----------------------------------------

  async function connect() {
    if (!hasConfig()) {
      openSettings();
      return;
    }
    try {
      setStatus('Verbinden met Google…');
      await ensureTokenClient();
      await ensureToken();
      connected = true;
      updateConnectButton();
      await loadCalendarList();
      setStatus('');
      await refresh();
    } catch (err) {
      connected = false;
      updateConnectButton();
      setStatus(`Verbinden mislukt: ${App.friendlyError(err)}.`, true);
    }
  }

  async function authorizedFetch(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
    });
    if (response.status === 401) {
      const err = new Error('sessie verlopen');
      err.auth = true;
      throw err;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error?.message || `HTTP ${response.status}`);
    }
    return response.json();
  }

  /** Haalt de lijst met agenda's van het account op (namen + kleuren uit Google Calendar). */
  async function loadCalendarList() {
    const data = await authorizedFetch(`${API_BASE}/users/me/calendarList?minAccessRole=reader&maxResults=100`);
    calendars = (data.items || []).map((item) => ({
      id: item.id,
      name: item.summaryOverride || item.summary || item.id,
      color: item.backgroundColor || '#4285f4',
      primary: !!item.primary,
      visible: item.selected !== false,
      writable: item.accessRole === 'owner' || item.accessRole === 'writer',
    }));
    // Hoofdagenda bovenaan, de rest alfabetisch.
    calendars.sort((a, b) => (b.primary - a.primary) || a.name.localeCompare(b.name, 'nl'));
    document.getElementById('btn-calendars').hidden = calendars.length === 0;
    document.getElementById('btn-add-event').hidden = !calendars.some((c) => c.writable);
  }

  function fetchEvents(calendarId, start, end) {
    const params = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    return authorizedFetch(`${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
  }

  /**
   * Haalt de events van alle gekozen agenda's op voor de zichtbare week
   * en rendert ze in het grid. Wordt ook aangeroepen door app.js bij het
   * wisselen van periode.
   */
  async function refresh() {
    if (!connected) return;
    const gen = ++refreshGen;
    const { start, end } = App.getWeekRange();
    try {
      setStatus('Agenda laden…');
      await ensureToken();

      const ids = activeCalendarIds();
      const results = await Promise.allSettled(ids.map((id) => fetchEvents(id, start, end)));

      // Ondertussen naar een andere week gebladerd? Dan is dit antwoord verouderd.
      if (gen !== refreshGen) return;

      if (results.some((r) => r.status === 'rejected' && r.reason?.auth)) {
        // Token verlopen of ingetrokken: opnieuw verbinden nodig.
        accessToken = null;
        connected = false;
        updateConnectButton();
        setStatus('Je sessie is verlopen. Verbind opnieuw met Google Calendar.', true);
        return;
      }

      eventsByDay = {};
      const colorById = new Map(calendars.map((c) => [c.id, c.color]));
      ids.forEach((id, i) => {
        if (results[i].status === 'fulfilled') {
          addEvents(results[i].value.items || [], colorById.get(id));
        }
      });

      const failed = results.filter((r) => r.status === 'rejected').length;
      if (ids.length === 0) {
        setStatus('Geen agenda’s geselecteerd. Kies er één of meer via de agenda-kiezer rechtsboven.');
      } else if (failed > 0) {
        setStatus(`${failed} van de ${ids.length} agenda's kon niet geladen worden.`, true);
      } else {
        setStatus('');
      }
      App.render();
    } catch (err) {
      setStatus(`Agenda laden mislukt: ${App.friendlyError(err)}`, true);
    }
  }

  function addEvents(items, color) {
    for (const event of items) {
      const isAllDay = !!event.start.date;
      // Hele-dag-events kunnen meerdere dagen beslaan (end.date is exclusief).
      if (isAllDay) {
        const endDate = App.parseDateKey(event.end.date);
        for (let d = App.parseDateKey(event.start.date); d < endDate; d.setDate(d.getDate() + 1)) {
          pushEvent(App.dateKey(d), { id: event.id, title: event.summary || '(zonder titel)', allDay: true, color });
        }
      } else {
        const startDate = new Date(event.start.dateTime);
        pushEvent(App.dateKey(startDate), {
          id: event.id,
          title: event.summary || '(zonder titel)',
          allDay: false,
          color,
          time: startDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }),
        });
      }
    }
  }

  // ---- Nieuwe afspraak --------------------------------------------------------

  function openEventDialog() {
    const select = document.getElementById('event-calendar');
    select.textContent = '';
    for (const cal of calendars.filter((c) => c.writable)) {
      const option = document.createElement('option');
      option.value = cal.id;
      option.textContent = cal.name;
      select.appendChild(option);
    }

    document.getElementById('event-title').value = '';
    document.getElementById('event-date').value = App.dateKey(App.getCurrentDate());
    document.getElementById('event-allday').checked = false;
    document.getElementById('event-start').value = '09:00';
    document.getElementById('event-end').value = '10:00';
    document.getElementById('event-times').hidden = false;
    setEventError('');
    Tags.renderMemberChecklist(document.getElementById('event-tags'));

    document.getElementById('event-dialog').showModal();
    document.getElementById('event-title').focus();
  }

  function setEventError(message) {
    const el = document.getElementById('event-error');
    el.textContent = message;
    el.hidden = !message;
  }

  let creatingEvent = false;

  async function submitEvent(e) {
    e.preventDefault();
    if (creatingEvent) return; // dubbele tik/Enter tijdens het versturen negeren
    const title = document.getElementById('event-title').value.trim();
    const calendarId = document.getElementById('event-calendar').value;
    const dateStr = document.getElementById('event-date').value;
    const allDay = document.getElementById('event-allday').checked;
    if (!title || !calendarId || !dateStr) return;

    const body = { summary: title };
    if (allDay) {
      const next = App.parseDateKey(dateStr);
      next.setDate(next.getDate() + 1);
      body.start = { date: dateStr };
      body.end = { date: App.dateKey(next) }; // end.date is exclusief
    } else {
      const start = new Date(`${dateStr}T${document.getElementById('event-start').value || '09:00'}`);
      const endValue = document.getElementById('event-end').value;
      let end = endValue ? new Date(`${dateStr}T${endValue}`) : null;
      if (!end || end <= start) end = new Date(start.getTime() + 60 * 60 * 1000);
      body.start = { dateTime: start.toISOString() };
      body.end = { dateTime: end.toISOString() };
    }

    const submitBtn = document.querySelector('#event-form button[type=submit]');
    try {
      creatingEvent = true;
      if (submitBtn) submitBtn.disabled = true;
      setEventError('');
      await ensureToken();
      const created = await authorizedFetch(
        `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      const names = Tags.readMemberChecklist(document.getElementById('event-tags'));
      if (created.id && names.length) Tags.setTags(created.id, names);
      document.getElementById('event-dialog').close();
      refresh();
    } catch (err) {
      if (err.auth || /insufficient|PERMISSION_DENIED/i.test(err.message || '')) {
        // Eerdere toestemming dekte alleen lezen: opnieuw verbinden vraagt de
        // nieuwe schrijf-toestemming aan.
        accessToken = null;
        connected = false;
        updateConnectButton();
        document.getElementById('event-dialog').close();
        setStatus('Verbind opnieuw met Google om toestemming voor het toevoegen van afspraken te geven.', true);
      } else {
        setEventError(`Toevoegen mislukt: ${err.message || 'onbekende fout'}`);
      }
    } finally {
      creatingEvent = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  // ---- Agenda-keuze ---------------------------------------------------------

  function openCalendarPicker() {
    const options = document.getElementById('calendars-options');
    options.textContent = '';
    const active = new Set(activeCalendarIds());

    for (const cal of calendars) {
      const label = document.createElement('label');
      label.className = 'tag-option';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = active.has(cal.id);
      checkbox.addEventListener('change', () => {
        const boxes = [...options.querySelectorAll('input[type=checkbox]')];
        selectedIds = calendars.filter((c, i) => boxes[i].checked).map((c) => c.id);
        saveSelection();
        refresh();
      });

      const dot = document.createElement('span');
      dot.className = 'cal-dot';
      dot.style.background = cal.color;

      label.append(checkbox, dot, document.createTextNode(cal.name));
      options.appendChild(label);
    }

    document.getElementById('calendars-dialog').showModal();
  }

  function pushEvent(key, event) {
    (eventsByDay[key] ||= []).push(event);
  }

  function getEventsForDay(key) {
    return eventsByDay[key] || [];
  }

  function isConnected() {
    return connected;
  }

  // ---- UI -----------------------------------------------------------------

  function setStatus(message, isError = false) {
    const el = document.getElementById('calendar-status');
    el.textContent = message;
    el.hidden = !message;
    el.classList.toggle('error', isError);
  }

  function updateConnectButton() {
    const btn = document.getElementById('btn-connect');
    btn.textContent = connected ? 'Verbonden ✓' : 'Verbind met Google';
    btn.disabled = connected;
  }

  function openSettings() {
    const dialog = document.getElementById('settings-dialog');
    document.getElementById('input-client-id').value = config?.clientId || '';
    dialog.showModal();
  }

  function init() {
    loadConfig();
    loadSelection();
    updateConnectButton();

    document.getElementById('btn-connect').addEventListener('click', connect);
    document.getElementById('btn-settings').addEventListener('click', openSettings);
    document.getElementById('btn-calendars').addEventListener('click', openCalendarPicker);
    document.getElementById('btn-calendars-close').addEventListener('click', () => {
      document.getElementById('calendars-dialog').close();
    });
    document.getElementById('btn-add-event').addEventListener('click', openEventDialog);
    document.getElementById('event-form').addEventListener('submit', submitEvent);
    document.getElementById('btn-event-cancel').addEventListener('click', () => {
      document.getElementById('event-dialog').close();
    });
    document.getElementById('event-allday').addEventListener('change', (e) => {
      document.getElementById('event-times').hidden = e.target.checked;
    });

    const dialog = document.getElementById('settings-dialog');
    document.getElementById('settings-form').addEventListener('submit', () => {
      const newClientId = document.getElementById('input-client-id').value.trim();
      const changed = newClientId !== (config?.clientId || '');
      saveConfig(newClientId);
      if (changed) {
        // Nieuwe Client-ID: tokenclient opnieuw initialiseren bij volgende verbinding.
        tokenClient = null;
        accessToken = null;
        connected = false;
        updateConnectButton();
        if (hasConfig()) ensureTokenClient().catch(() => {});
      }
    });
    document.getElementById('btn-settings-cancel').addEventListener('click', () => dialog.close());

    if (hasConfig()) {
      // GIS alvast laden: iOS Safari blokkeert de inlogpopup als die te lang
      // na de tik opent, dus het script moet klaarstaan vóór de klik.
      ensureTokenClient().catch(() => {});
    } else {
      setStatus('Nog niet gekoppeld aan Google Calendar. Open de instellingen (rechtsboven) om je Client-ID in te stellen.');
    }
  }

  return { init, refresh, getEventsForDay, isConnected };
})();
