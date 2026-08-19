/**
 * Sync — gedeelde boodschappenlijst (en favorieten) tussen gezinsleden.
 *
 * Werkt via de eigen Cloudflare Worker (/sync/push, D1-database): de app stuurt
 * periodiek zijn volledige lokale staat, de Worker merget per item
 * (last-writer-wins op updatedAt, tombstones voor verwijderingen) en stuurt de
 * samengevoegde staat terug. Pollen = pushen, dus één endpoint volstaat en de
 * sync is idempotent en offline-bestendig: zonder netwerk werkt de lijst
 * gewoon lokaal door en haalt de eerstvolgende geslaagde sync alles weer bij.
 *
 * Vereist een gedeelde gezinscode (⚙️ → Samenwerken) en dezelfde Worker-URL
 * + proxy-sleutel als de Picnic-koppeling (die leest deze module bewust uit
 * dezelfde localStorage-config in plaats van via de Picnic-module, zodat er
 * geen module-afhankelijkheid ontstaat en sync ook zonder Picnic-login werkt).
 */
const Sync = (() => {
  const CONFIG_KEY = 'familie-app.sync';
  const BACKEND_CONFIG_KEY = 'familie-app.picnic'; // proxyUrl + proxyKey staan hier
  const POLL_MS = 5000;

  let config = {}; // { family }
  let timer = null;
  let syncing = false;
  let dirty = false;
  let lastError = null;
  let lastSyncedAt = null;

  function load() {
    try {
      config = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
      if (typeof config !== 'object' || config === null) config = {};
    } catch {
      config = {};
    }
  }

  function save() {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  function backend() {
    try {
      const raw = JSON.parse(localStorage.getItem(BACKEND_CONFIG_KEY) || '{}');
      return {
        url: typeof raw.proxyUrl === 'string' ? raw.proxyUrl.replace(/\/+$/, '') : '',
        key: typeof raw.proxyKey === 'string' ? raw.proxyKey : null,
      };
    } catch {
      return { url: '', key: null };
    }
  }

  function isEnabled() {
    return !!(config.family && backend().url);
  }

  /** Eén sync-ronde: volledige staat pushen, samengevoegde staat toepassen. */
  async function syncNow() {
    if (!isEnabled()) return;
    if (syncing) {
      dirty = true; // er kwam een mutatie binnen tijdens een lopende ronde
      return;
    }
    syncing = true;
    try {
      const { url, key } = backend();
      const state = Shopping.getSyncState();
      const response = await fetch(`${url}/sync/push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { 'x-proxy-key': key } : {}),
        },
        body: JSON.stringify({
          family: config.family,
          items: state.items,
          favorites: state.favorites,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      Shopping.applyMerged(data.items || [], data.favorites || []);
      lastError = null;
      lastSyncedAt = new Date();
    } catch (err) {
      lastError = App.friendlyError(err);
    } finally {
      syncing = false;
      updateStatus();
      if (dirty) {
        dirty = false;
        syncNow();
      }
    }
  }

  function schedule() {
    if (timer) clearInterval(timer);
    timer = null;
    if (!isEnabled()) return;
    timer = setInterval(() => {
      // Niet pollen op de achtergrond: scheelt accu en verkeer.
      if (!document.hidden) syncNow();
    }, POLL_MS);
    syncNow();
  }

  function updateStatus() {
    const el = document.getElementById('sync-status');
    if (!el) return;
    if (!config.family) {
      el.textContent = 'Nog niet ingesteld. Kies samen één gezinscode en vul die op beide telefoons in.';
    } else if (!backend().url) {
      el.textContent = 'Gezinscode ingesteld, maar er is nog geen Worker-URL (zie het Picnic-gedeelte hierboven).';
    } else if (lastError) {
      el.textContent = `Synchroniseren lukt niet: ${lastError}`;
    } else if (lastSyncedAt) {
      el.textContent = `Gedeelde lijst actief · laatst gesynchroniseerd om ${lastSyncedAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`;
    } else {
      el.textContent = 'Gedeelde lijst actief.';
    }
  }

  function init() {
    load();

    Settings.register({
      onOpen: () => {
        document.getElementById('input-family-code').value = config.family || '';
        updateStatus();
      },
      onSave: () => {
        const code = document.getElementById('input-family-code').value.trim();
        config.family = /^[A-Za-z0-9-]{6,64}$/.test(code) ? code : null;
        if (code && !config.family) {
          App.toast('Gezinscode niet opgeslagen: gebruik minimaal 6 tekens (letters, cijfers of streepjes).');
        }
        save();
        updateStatus();
        schedule();
      },
    });

    // Na elke lokale mutatie snel pushen (de interval vangt de rest).
    Shopping.onChange(() => syncNow());
    // Bij terugkeer naar de app direct verversen.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncNow();
    });

    updateStatus();
    schedule();
  }

  return { init, syncNow, isEnabled };
})();
