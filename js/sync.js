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
  let truncatedWarned = false; // waarschuw één keer per sessie, niet elke poll

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

  /**
   * Eén sync-ronde: volledige staat pushen, samengevoegde staat toepassen.
   * `fromMutation` geeft aan dat de ronde door een lokale wijziging komt:
   * alleen dan zetten we `dirty` (zodat de wijziging gegarandeerd meegaat)
   * en melden we een mislukking aan de gebruiker — een stille poll die
   * faalt hoeft geen toast, de statusregel in instellingen volstaat.
   */
  async function syncNow(fromMutation = false) {
    if (!isEnabled()) return;
    if (syncing) {
      if (fromMutation) dirty = true; // mutatie tijdens lopende ronde: extra ronde nodig
      return;
    }
    syncing = true;
    const family = config.family; // vastleggen: kan tijdens de fetch wisselen
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
          family,
          items: state.items,
          favorites: state.favorites,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `HTTP ${response.status}`);
      }
      const data = await response.json();
      // Niet toepassen als de gezinscode intussen is gewijzigd: anders lekt
      // de lijst van het oude gezin de nieuwe gedeelde lijst in.
      if (config.family !== family) return;
      Shopping.applyMerged(data.items || [], data.favorites || []);
      if (data.truncated && !truncatedWarned) {
        truncatedWarned = true;
        App.toast('De gedeelde lijst zit aan zijn maximum — niet alles wordt gedeeld. Ruim oude items op.');
      }
      lastError = null;
      lastSyncedAt = new Date();
    } catch (err) {
      lastError = App.friendlyError(err);
      if (fromMutation) App.toast(`Delen lukt nu niet: ${lastError}`);
    } finally {
      syncing = false;
      updateStatus();
      if (dirty) {
        dirty = false;
        syncNow(true);
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
        if (!code) {
          config.family = null; // leeg veld = sync bewust uitzetten
        } else if (/^[A-Za-z0-9-]{6,64}$/.test(code)) {
          config.family = code;
        } else {
          // Ongeldige invoer: de bestaande (werkende) code niet weggooien.
          App.toast('Gezinscode niet opgeslagen: gebruik 6–64 tekens (letters, cijfers of streepjes). Huidige instelling behouden.');
        }
        save();
        updateStatus();
        schedule();
      },
    });

    // Na elke lokale mutatie snel pushen (de interval vangt de rest).
    Shopping.onChange(() => syncNow(true));
    // Bij terugkeer naar de app direct verversen.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) syncNow();
    });

    updateStatus();
    schedule();
  }

  return { init, syncNow, isEnabled };
})();
