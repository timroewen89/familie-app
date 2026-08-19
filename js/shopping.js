/**
 * Boodschappenlijst — items toevoegen, afvinken en verwijderen.
 * Alles wordt bewaard in localStorage zodat de lijst offline blijft werken.
 *
 * Sync-bewust: elke mutatie stempelt updatedAt, en verwijderen zet een
 * tombstone (deleted: true) in plaats van het item echt te wissen. Zo kan de
 * Sync-module (gedeelde gezinslijst via de Worker) per item last-writer-wins
 * mergen zonder dat een verwijderd item terugkomt via een verouderde telefoon.
 * Tombstones worden na 90 dagen lokaal opgeruimd (de server bewaart ze 180).
 */
const Shopping = (() => {
  const STORAGE_KEY = 'familie-app.shopping';
  const FAVORITES_KEY = 'familie-app.favorites';
  // Lokaal prune-venster; de server bewaart tombstones nog langer (180d),
  // zodat een lang offline telefoon een verwijdering niet laat herrijzen.
  const TOMBSTONE_MS = 90 * 24 * 60 * 60 * 1000;

  /**
   * Monotone tijdstempel: altijd nieuwer dan de vorige versie van de entry,
   * óók als de klok van dit toestel achterloopt op die van een gezinslid.
   * Zo wint een bewuste lokale bewerking altijd van de versie die de
   * gebruiker zojuist voor zich zag.
   */
  function nextStamp(previous) {
    return Math.max(Date.now(), (previous || 0) + 1);
  }

  /** @type {{id: string, name: string, done: boolean, updatedAt: number, deleted?: boolean}[]} */
  let items = [];
  /** Favorieten: vaste boodschappen die je snel opnieuw toevoegt. @type {{id: string, name: string, picnicId: string|null, updatedAt: number, deleted?: boolean}[]} */
  let favorites = [];
  /** Callback voor de Sync-module: aangeroepen na elke lokale mutatie. */
  let changeListener = null;

  /** Items/favorieten zonder tombstones — alles wat de UI toont. */
  function activeItems() {
    return items.filter((i) => !i.deleted);
  }

  function activeFavorites() {
    return favorites.filter((f) => !f.deleted);
  }

  function notifyChange() {
    if (changeListener) changeListener();
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      items = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(items)) items = [];
    } catch {
      items = [];
    }
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      favorites = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(favorites)) favorites = [];
    } catch {
      favorites = [];
    }
    // Migratie: bestaande data zonder updatedAt/id stempelen, oude tombstones weg.
    const now = Date.now();
    const cutoff = now - TOMBSTONE_MS;
    items = items.filter((i) => !(i.deleted && (i.updatedAt || 0) < cutoff));
    for (const item of items) {
      if (!item.updatedAt) item.updatedAt = now;
    }
    favorites = favorites.filter((f) => !(f.deleted && (f.updatedAt || 0) < cutoff));
    for (const fav of favorites) {
      if (!fav.id) fav.id = 'fav-' + favKey(fav);
      if (!fav.updatedAt) fav.updatedAt = now;
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  /**
   * Boodschappen-provider (bijv. Picnic) waar mandje-acties naartoe gaan.
   * Standaard een no-op zodat de lijst zonder provider gewoon werkt en de
   * init-volgorde van modules niet uitmaakt. Picnic registreert zich via
   * setGroceryProvider().
   */
  let grocery = {
    isReady: () => false,
    buttonFor: () => null,
    addToBasket: () => Promise.reject(new Error('geen boodschappenkoppeling actief')),
    removeFromBasket: () => Promise.reject(new Error('geen boodschappenkoppeling actief')),
  };

  function setGroceryProvider(provider) {
    grocery = { ...grocery, ...provider };
    render();
  }

  function saveFavorites() {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  }

  /** Voegt een item toe en geeft het id terug (o.a. voor de Picnic-koppeling). */
  function addItem(name) {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmed,
      done: false,
      updatedAt: Date.now(),
    };
    items.push(item);
    save();
    render();
    notifyChange();
    return item.id;
  }

  /**
   * Hernoemt een item, bijv. als het aantal in het Picnic-mandje wijzigt.
   * Geeft false terug als het item er niet (meer) is — bijv. zojuist door een
   * gezinslid verwijderd — zodat de aanroeper een nieuw item kan maken.
   */
  function renameItem(id, name) {
    const item = items.find((i) => i.id === id && !i.deleted);
    const trimmed = name.trim();
    if (!item || !trimmed) return false;
    item.name = trimmed;
    item.updatedAt = nextStamp(item.updatedAt);
    save();
    render();
    notifyChange();
    return true;
  }

  function toggleItem(id) {
    const item = items.find((i) => i.id === id);
    if (item) {
      item.done = !item.done;
      item.updatedAt = nextStamp(item.updatedAt);
      save();
      render();
      notifyChange();
    }
  }

  function removeItem(id) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    // Tombstone i.p.v. echt wissen, zodat de verwijdering ook op de telefoon
    // van je gezinslid aankomt (en niet terugkomt via diens oude staat).
    item.deleted = true;
    item.updatedAt = nextStamp(item.updatedAt);
    save();
    render();
    notifyChange();
    // Via Picnic-snelzoeken gekoppelde items ook uit het echte mandje halen —
    // behalve als het item al is afgevinkt (dan is het gewoon gekocht).
    if (item.picnicId && item.picnicCount > 0 && !item.done) {
      grocery.removeFromBasket(item.picnicId, item.picnicCount).catch((err) => {
        App.toast(`"${item.name}" is van de lijst, maar kon niet uit je Picnic-mandje `
          + `verwijderd worden (${App.friendlyError(err)}).`);
      });
    }
  }

  /**
   * Koppelt een lijstitem aan een Picnic-product, incl. het aantal en de
   * productnaam. Geeft false terug als het item er niet (meer) is.
   */
  function setPicnicLink(id, productId, count, productName) {
    const item = items.find((i) => i.id === id && !i.deleted);
    if (!item) return false;
    item.picnicId = productId;
    item.picnicCount = count;
    if (productName) item.picnicName = productName;
    else if (!productId) delete item.picnicName;
    item.updatedAt = nextStamp(item.updatedAt);
    save();
    notifyChange();
    return true;
  }

  // ---- Favorieten -----------------------------------------------------------

  /** Naam zonder eventueel "N× "-voorvoegsel (dat hoort bij het mandje-aantal). */
  function baseName(name) {
    return name.replace(/^\d+×\s*/, '');
  }

  /** Sleutel om favorieten/items te vergelijken: op Picnic-product als dat er is, anders op naam. */
  function favKey(entry) {
    return entry.picnicId ? `p:${entry.picnicId}` : `n:${entry.name.trim().toLowerCase()}`;
  }

  /** De favoriet-vorm van een lijstitem (schone productnaam + eventueel Picnic-id). */
  function favEntryOf(item) {
    return { name: item.picnicName || baseName(item.name), picnicId: item.picnicId || null };
  }

  function isFavorite(item) {
    const key = favKey(favEntryOf(item));
    return activeFavorites().some((f) => favKey(f) === key);
  }

  function toggleFavorite(item) {
    const entry = favEntryOf(item);
    const key = favKey(entry);
    const existing = favorites.find((f) => favKey(f) === key);
    if (existing) {
      // Bestond al (mogelijk als tombstone): aan/uit wisselen.
      existing.deleted = !existing.deleted;
      existing.updatedAt = nextStamp(existing.updatedAt);
      if (!existing.deleted) {
        existing.name = entry.name;
        existing.picnicId = entry.picnicId;
      }
    } else {
      favorites.push({ id: 'fav-' + key, ...entry, updatedAt: Date.now() });
    }
    saveFavorites();
    render();
    notifyChange();
  }

  function removeFavorite(fav) {
    const key = favKey(fav);
    const existing = favorites.find((f) => favKey(f) === key);
    if (existing) {
      existing.deleted = true;
      existing.updatedAt = nextStamp(existing.updatedAt);
      saveFavorites();
      render();
      notifyChange();
    }
  }

  /**
   * Voegt een favoriet toe aan de lijst; als het een Picnic-product is en je
   * bent ingelogd, gaat het er ook meteen (1×) in je Picnic-mandje bij.
   */
  async function addFavoriteToList(fav) {
    const id = addItem(fav.name);
    if (id && fav.picnicId && grocery.isReady()) {
      try {
        await grocery.addToBasket(fav.picnicId, 1);
        setPicnicLink(id, fav.picnicId, 1, fav.name);
        App.toast(`"${fav.name}" op de lijst en in je Picnic-mandje.`);
      } catch (err) {
        App.toast(`"${fav.name}" op de lijst, maar niet in je mandje (${App.friendlyError(err)}).`);
      }
    }
  }

  function renderFavorites() {
    const bar = document.getElementById('favorites-bar');
    bar.textContent = '';
    const visible = activeFavorites();
    if (visible.length === 0) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;

    const label = document.createElement('span');
    label.className = 'favorites-label';
    label.textContent = 'Favorieten';
    bar.appendChild(label);

    for (const fav of visible) {
      const chip = document.createElement('div');
      chip.className = 'favorite-chip';

      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'favorite-add';
      add.innerHTML = Icons.html('plus');
      const text = document.createElement('span');
      text.textContent = fav.name; // textContent voorkomt HTML-injectie via productnaam
      add.appendChild(text);
      add.setAttribute('aria-label', `${fav.name} toevoegen aan de lijst`);
      add.addEventListener('click', () => addFavoriteToList(fav));

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'favorite-remove';
      rm.innerHTML = Icons.html('x');
      rm.setAttribute('aria-label', `${fav.name} uit favorieten verwijderen`);
      rm.addEventListener('click', () => removeFavorite(fav));

      chip.append(add, rm);
      bar.appendChild(chip);
    }
  }

  function clearDone() {
    for (const item of items) {
      if (item.done && !item.deleted) {
        item.deleted = true;
        item.updatedAt = nextStamp(item.updatedAt);
      }
    }
    save();
    render();
    notifyChange();
  }

  /** De nog niet gekochte items als tekst, bijv. om in Picnic te gebruiken. */
  function openItemsText() {
    return activeItems().filter((i) => !i.done).map((i) => `• ${i.name}`).join('\n');
  }

  /**
   * Deelt de open boodschappen via het deelmenu van het toestel (op iOS/Android
   * kies je daar bijv. Picnic of een berichtje naar elkaar); zonder deelmenu
   * wordt de lijst naar het klembord gekopieerd.
   */
  async function shareList() {
    const text = openItemsText();
    if (!text) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Boodschappenlijst', text });
        return;
      } catch {
        return; // delen geannuleerd door de gebruiker
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      flashShareButton('Gekopieerd ✓');
    } catch {
      flashShareButton('Kopiëren mislukt');
    }
  }

  let shareFlashTimer = null;
  let shareOriginalHtml = null;

  function flashShareButton(message) {
    const btn = document.getElementById('btn-share-list');
    // Bij een snelle tweede klik het echte origineel bewaren (niet de flash),
    // en de lopende timer resetten zodat de knop niet blijft hangen.
    if (shareFlashTimer === null) shareOriginalHtml = btn.innerHTML;
    else clearTimeout(shareFlashTimer);
    btn.textContent = message;
    shareFlashTimer = setTimeout(() => {
      btn.innerHTML = shareOriginalHtml;
      shareFlashTimer = null;
    }, 2000);
  }

  function render() {
    const list = document.getElementById('shopping-list');
    const counter = document.getElementById('shopping-counter');
    list.textContent = '';
    updateShareButton();
    updateBadge();
    renderFavorites();

    const visible = activeItems();
    if (visible.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'shopping-empty';
      empty.textContent = 'Nog geen boodschappen. Voeg iets toe!';
      list.appendChild(empty);
      counter.textContent = '';
      return;
    }

    for (const item of visible) {
      const li = document.createElement('li');
      if (item.done) li.classList.add('done');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.done;
      checkbox.setAttribute('aria-label', `${item.name} afvinken`);
      checkbox.addEventListener('change', () => toggleItem(item.id));

      const name = document.createElement('span');
      name.className = 'item-name';
      name.textContent = item.name;

      const favBtn = document.createElement('button');
      favBtn.type = 'button';
      favBtn.className = 'btn-fav';
      const favActive = isFavorite(item);
      favBtn.classList.toggle('active', favActive);
      favBtn.innerHTML = Icons.html('star');
      favBtn.setAttribute('aria-pressed', favActive ? 'true' : 'false');
      favBtn.setAttribute('aria-label', `${item.name} als favoriet`);
      favBtn.title = favActive ? 'Uit favorieten' : 'Bewaar als favoriet';
      favBtn.addEventListener('click', () => toggleFavorite(item));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-delete';
      del.innerHTML = Icons.html('x');
      del.setAttribute('aria-label', `${item.name} verwijderen`);
      del.addEventListener('click', () => removeItem(item.id));

      li.append(checkbox, name);
      const picnicBtn = grocery.buttonFor(item);
      if (picnicBtn) li.appendChild(picnicBtn);
      li.append(favBtn, del);
      list.appendChild(li);
    }

    const doneCount = visible.filter((i) => i.done).length;
    counter.textContent = `${doneCount} van ${visible.length} gedaan`;
  }

  function updateShareButton() {
    document.getElementById('btn-share-list').disabled = activeItems().every((i) => i.done);
  }

  /** Badge op de boodschappen-tab met het aantal nog te kopen items. */
  function updateBadge() {
    const badge = document.getElementById('shopping-badge');
    const open = activeItems().filter((i) => !i.done).length;
    badge.textContent = open;
    badge.hidden = open === 0;
  }

  // ---- Sync-API (gedeelde gezinslijst via de Sync-module) ---------------------

  /** Volledige lokale staat, inclusief tombstones — precies wat de sync pusht. */
  function getSyncState() {
    return { items: [...items], favorites: [...favorites] };
  }

  /**
   * Samengevoegde staat van de server toepassen. Per entry wint de nieuwste
   * updatedAt; bij exact gelijkspel wint eerst een verwijdering en anders de
   * serverversie (de server is canoniek bij ties, zodat alle apparaten
   * convergeren — de spiegel van de tie-regel in de Worker). Lokale
   * wijzigingen die tijdens het sync-verzoek zijn gedaan hebben door de
   * monotone stempel altijd een strikt nieuwere updatedAt en blijven dus
   * behouden. Roept bewust GEEN notifyChange aan (geen sync-lus).
   */
  function applyMerged(serverItems, serverFavorites) {
    const remoteWins = (remote, local) => {
      const remoteAt = remote.updatedAt || 0;
      const localAt = local.updatedAt || 0;
      if (remoteAt !== localAt) return remoteAt > localAt;
      if (!!remote.deleted !== !!local.deleted) return !!remote.deleted;
      return true; // tie: serverantwoord is canoniek
    };
    const mergeLWW = (localArr, serverArr) => {
      const map = new Map(localArr.map((e) => [e.id, e]));
      for (const remote of serverArr || []) {
        if (!remote || !remote.id) continue;
        const local = map.get(remote.id);
        if (!local || remoteWins(remote, local)) {
          map.set(remote.id, remote);
        }
      }
      return [...map.values()];
    };
    const mergedItems = mergeLWW(items, serverItems);
    const mergedFavorites = mergeLWW(favorites, serverFavorites);
    // Alleen opslaan/herrenderen bij een echte wijziging: de sync pollt elke
    // paar seconden en het scherm mag niet verspringen als er niets is.
    const changed = JSON.stringify(mergedItems) !== JSON.stringify(items)
      || JSON.stringify(mergedFavorites) !== JSON.stringify(favorites);
    items = mergedItems;
    favorites = mergedFavorites;
    if (changed) {
      save();
      saveFavorites();
      render();
    }
  }

  /** Registreert de callback die na elke lokale mutatie wordt aangeroepen. */
  function onChange(listener) {
    changeListener = listener;
  }

  function init() {
    load();
    render();

    document.getElementById('shopping-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('shopping-input');
      addItem(input.value);
      input.value = '';
      input.focus();
    });

    document.getElementById('btn-clear-done').addEventListener('click', clearDone);
    document.getElementById('btn-share-list').addEventListener('click', shareList);
  }

  return {
    init, rerender: render, addItem, renameItem, removeItem, setPicnicLink,
    setGroceryProvider, getSyncState, applyMerged, onChange,
  };
})();
