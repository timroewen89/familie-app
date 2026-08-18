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
  const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
  const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

  let config = null; // { clientId }
  let tokenClient = null;
  let accessToken = null;
  let tokenExpiresAt = 0;
  let connected = false;

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
      setStatus('');
      await refresh();
    } catch (err) {
      connected = false;
      updateConnectButton();
      setStatus(`Verbinden mislukt: ${err.message}. Controleer je Client-ID.`, true);
    }
  }

  /**
   * Haalt de events van de zichtbare week op en rendert ze in het grid.
   * Wordt ook aangeroepen door app.js bij het wisselen van periode.
   */
  async function refresh() {
    if (!connected) return;
    const { start, end } = App.getWeekRange();
    try {
      setStatus('Agenda laden…');
      await ensureToken();
      const params = new URLSearchParams({
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
      });
      const response = await fetch(`${EVENTS_URL}?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (response.status === 401 || response.status === 403) {
        // Token verlopen of ingetrokken: opnieuw verbinden nodig.
        accessToken = null;
        connected = false;
        updateConnectButton();
        setStatus('Je sessie is verlopen. Verbind opnieuw met Google Calendar.', true);
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message || `HTTP ${response.status}`);
      }
      const data = await response.json();
      groupEvents(data.items || []);
      setStatus('');
      App.render();
    } catch (err) {
      setStatus(`Agenda laden mislukt: ${err.message || 'onbekende fout'}`, true);
    }
  }

  function groupEvents(items) {
    eventsByDay = {};
    for (const event of items) {
      const isAllDay = !!event.start.date;
      // Hele-dag-events kunnen meerdere dagen beslaan (end.date is exclusief).
      if (isAllDay) {
        const endDate = App.parseDateKey(event.end.date);
        for (let d = App.parseDateKey(event.start.date); d < endDate; d.setDate(d.getDate() + 1)) {
          pushEvent(App.dateKey(d), { id: event.id, title: event.summary || '(zonder titel)', allDay: true });
        }
      } else {
        const startDate = new Date(event.start.dateTime);
        pushEvent(App.dateKey(startDate), {
          id: event.id,
          title: event.summary || '(zonder titel)',
          allDay: false,
          time: startDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }),
        });
      }
    }
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
    updateConnectButton();

    document.getElementById('btn-connect').addEventListener('click', connect);
    document.getElementById('btn-settings').addEventListener('click', openSettings);

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
