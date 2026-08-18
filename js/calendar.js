/**
 * Google Calendar integratie.
 *
 * Gebruikt Google Identity Services (OAuth2, alleen-lezen scope) en de
 * Calendar API v3 om de events van de zichtbare week op te halen.
 *
 * De OAuth Client-ID en API-key worden NIET in de code opgenomen: de
 * gebruiker voert ze eenmalig in via het instellingenpaneel en ze worden
 * alleen lokaal in de browser (localStorage) bewaard.
 */
const Cal = (() => {
  const CONFIG_KEY = 'familie-app.google-config';
  const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
  const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';

  let config = null; // { clientId, apiKey }
  let tokenClient = null;
  let gapiReady = false;
  let connected = false;

  /** Events van de huidige week, gegroepeerd per dagsleutel 'YYYY-MM-DD'. */
  let eventsByDay = {};

  // ---- Configuratie -------------------------------------------------------

  function loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      config = raw ? JSON.parse(raw) : null;
    } catch {
      config = null;
    }
  }

  function saveConfig(clientId, apiKey) {
    config = { clientId: clientId.trim(), apiKey: apiKey.trim() };
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  function hasConfig() {
    return !!(config && config.clientId && config.apiKey);
  }

  // ---- Google-bibliotheken laden ------------------------------------------

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

  async function ensureLibraries() {
    if (!window.gapi) {
      await loadScript('https://apis.google.com/js/api.js');
    }
    if (!window.google || !window.google.accounts) {
      await loadScript('https://accounts.google.com/gsi/client');
    }
    if (!gapiReady) {
      await new Promise((resolve, reject) => {
        gapi.load('client', { callback: resolve, onerror: reject });
      });
      await gapi.client.init({
        apiKey: config.apiKey,
        discoveryDocs: [DISCOVERY_DOC],
      });
      gapiReady = true;
    }
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: config.clientId,
        scope: SCOPE,
        callback: () => {}, // wordt per aanvraag gezet
      });
    }
  }

  // ---- Verbinden en events ophalen ----------------------------------------

  function requestToken() {
    return new Promise((resolve, reject) => {
      tokenClient.callback = (response) => {
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      };
      // Alleen bij de eerste keer om toestemming vragen.
      tokenClient.requestAccessToken({ prompt: gapi.client.getToken() ? '' : 'consent' });
    });
  }

  async function connect() {
    if (!hasConfig()) {
      openSettings();
      return;
    }
    try {
      setStatus('Verbinden met Google…');
      await ensureLibraries();
      await requestToken();
      connected = true;
      updateConnectButton();
      setStatus('');
      await refresh();
    } catch (err) {
      connected = false;
      updateConnectButton();
      setStatus(`Verbinden mislukt: ${err.message}. Controleer je instellingen.`, true);
    }
  }

  /**
   * Haalt de events van de opgegeven week op en rendert ze in het weekgrid.
   * Wordt ook aangeroepen door app.js bij het wisselen van week.
   */
  async function refresh() {
    if (!connected) return;
    const { start, end } = App.getWeekRange();
    try {
      setStatus('Agenda laden…');
      const response = await gapi.client.calendar.events.list({
        calendarId: 'primary',
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 250,
      });
      groupEvents(response.result.items || []);
      setStatus('');
      App.render();
    } catch (err) {
      const message = err.result?.error?.message || err.message || 'onbekende fout';
      if (err.status === 401 || err.status === 403) {
        // Token verlopen of ingetrokken: opnieuw verbinden nodig.
        connected = false;
        updateConnectButton();
        setStatus('Je sessie is verlopen. Verbind opnieuw met Google Calendar.', true);
      } else {
        setStatus(`Agenda laden mislukt: ${message}`, true);
      }
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
    document.getElementById('input-api-key').value = config?.apiKey || '';
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
      const newApiKey = document.getElementById('input-api-key').value.trim();
      const changed = newClientId !== (config?.clientId || '') || newApiKey !== (config?.apiKey || '');
      saveConfig(newClientId, newApiKey);
      if (changed) {
        // Nieuwe Google-gegevens: bibliotheken opnieuw initialiseren bij volgende verbinding.
        gapiReady = false;
        tokenClient = null;
        connected = false;
        updateConnectButton();
      }
    });
    document.getElementById('btn-settings-cancel').addEventListener('click', () => dialog.close());

    if (!hasConfig()) {
      setStatus('Nog niet gekoppeld aan Google Calendar. Klik op ⚙️ om je Client-ID en API-key in te stellen.');
    }
  }

  return { init, refresh, getEventsForDay, isConnected };
})();
