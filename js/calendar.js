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
  const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
  const API_BASE = 'https://www.googleapis.com/calendar/v3';

  let config = null; // { clientId }
  let tokenClient = null;
  let accessToken = null;
  let tokenExpiresAt = 0;
  let connected = false;

  /** Beschikbare agenda's van het account: {id, name, color, primary, visible}. */
  let calendars = [];
  /** Door de gebruiker gekozen agenda-id's; null = automatisch (zichtbaar in Google Calendar). */
  let selectedIds = null;

  /** Events van de huidige week, gegroepeerd per dagsleutel 'YYYY-MM-DD'. */
  let eventsByDay = {};

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
        callback: () => {}, // wordt per aanvraag gezet
      });
    }
  }

  function requestToken() {
    return new Promise((resolve, reject) => {
      tokenClient.callback = (response) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          accessToken = response.access_token;
          // Marge van een minuut zodat we nooit met een net-verlopen token werken.
          tokenExpiresAt = Date.now() + (Number(response.expires_in) - 60) * 1000;
          resolve();
        }
      };
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
      setStatus(`Verbinden mislukt: ${err.message}. Controleer je Client-ID.`, true);
    }
  }

  async function authorizedFetch(url) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
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
    }));
    // Hoofdagenda bovenaan, de rest alfabetisch.
    calendars.sort((a, b) => (b.primary - a.primary) || a.name.localeCompare(b.name, 'nl'));
    document.getElementById('btn-calendars').hidden = calendars.length === 0;
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
    const { start, end } = App.getWeekRange();
    try {
      setStatus('Agenda laden…');
      await ensureToken();

      const ids = activeCalendarIds();
      const results = await Promise.allSettled(ids.map((id) => fetchEvents(id, start, end)));

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
        setStatus('Geen agenda’s geselecteerd. Kies er één of meer via 📆.');
      } else if (failed > 0) {
        setStatus(`${failed} van de ${ids.length} agenda's kon niet geladen worden.`, true);
      } else {
        setStatus('');
      }
      App.render();
    } catch (err) {
      setStatus(`Agenda laden mislukt: ${err.message || 'onbekende fout'}`, true);
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
      }
    });
    document.getElementById('btn-settings-cancel').addEventListener('click', () => dialog.close());

    if (!hasConfig()) {
      setStatus('Nog niet gekoppeld aan Google Calendar. Klik op ⚙️ om je Client-ID in te stellen.');
    }
  }

  return { init, refresh, getEventsForDay, isConnected };
})();
