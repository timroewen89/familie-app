/**
 * Boodschappenlijst — items toevoegen, afvinken en verwijderen.
 * Alles wordt bewaard in localStorage zodat de lijst offline blijft werken.
 */
const Shopping = (() => {
  const STORAGE_KEY = 'familie-app.shopping';
  const FAVORITES_KEY = 'familie-app.favorites';

  /** @type {{id: string, name: string, done: boolean}[]} */
  let items = [];
  /** Favorieten: vaste boodschappen die je snel opnieuw toevoegt. @type {{name: string, picnicId: string|null}[]} */
  let favorites = [];

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
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
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
    };
    items.push(item);
    save();
    render();
    return item.id;
  }

  /** Hernoemt een item, bijv. als het aantal in het Picnic-mandje wijzigt. */
  function renameItem(id, name) {
    const item = items.find((i) => i.id === id);
    const trimmed = name.trim();
    if (item && trimmed) {
      item.name = trimmed;
      save();
      render();
    }
  }

  function toggleItem(id) {
    const item = items.find((i) => i.id === id);
    if (item) {
      item.done = !item.done;
      save();
      render();
    }
  }

  function removeItem(id) {
    const item = items.find((i) => i.id === id);
    items = items.filter((i) => i.id !== id);
    save();
    render();
    // Via Picnic-snelzoeken gekoppelde items ook uit het echte mandje halen —
    // behalve als het item al is afgevinkt (dan is het gewoon gekocht).
    if (item?.picnicId && item.picnicCount > 0 && !item.done) {
      Picnic.removeFromBasket(item.picnicId, item.picnicCount).catch((err) => {
        App.toast(`"${item.name}" is van de lijst, maar kon niet uit je Picnic-mandje `
          + `verwijderd worden (${App.friendlyError(err)}).`);
      });
    }
  }

  /** Koppelt een lijstitem aan een Picnic-product, incl. het aantal en de productnaam. */
  function setPicnicLink(id, productId, count, productName) {
    const item = items.find((i) => i.id === id);
    if (item) {
      item.picnicId = productId;
      item.picnicCount = count;
      if (productName) item.picnicName = productName;
      else if (!productId) delete item.picnicName;
      save();
    }
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
    return favorites.some((f) => favKey(f) === key);
  }

  function toggleFavorite(item) {
    const entry = favEntryOf(item);
    const key = favKey(entry);
    const idx = favorites.findIndex((f) => favKey(f) === key);
    if (idx >= 0) favorites.splice(idx, 1);
    else favorites.push(entry);
    saveFavorites();
    render();
  }

  function removeFavorite(fav) {
    const key = favKey(fav);
    favorites = favorites.filter((f) => favKey(f) !== key);
    saveFavorites();
    render();
  }

  /**
   * Voegt een favoriet toe aan de lijst; als het een Picnic-product is en je
   * bent ingelogd, gaat het er ook meteen (1×) in je Picnic-mandje bij.
   */
  async function addFavoriteToList(fav) {
    const id = addItem(fav.name);
    if (id && fav.picnicId && Picnic.isConfigured() && Picnic.isLoggedIn()) {
      try {
        await Picnic.addToBasket(fav.picnicId, 1);
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
    if (favorites.length === 0) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;

    const label = document.createElement('span');
    label.className = 'favorites-label';
    label.textContent = 'Favorieten';
    bar.appendChild(label);

    for (const fav of favorites) {
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
    items = items.filter((i) => !i.done);
    save();
    render();
  }

  /** De nog niet gekochte items als tekst, bijv. om in Picnic te gebruiken. */
  function openItemsText() {
    return items.filter((i) => !i.done).map((i) => `• ${i.name}`).join('\n');
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

    if (items.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'shopping-empty';
      empty.textContent = 'Nog geen boodschappen. Voeg iets toe!';
      list.appendChild(empty);
      counter.textContent = '';
      return;
    }

    for (const item of items) {
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
      const picnicBtn = Picnic.buttonFor(item);
      if (picnicBtn) li.appendChild(picnicBtn);
      li.append(favBtn, del);
      list.appendChild(li);
    }

    const doneCount = items.filter((i) => i.done).length;
    counter.textContent = `${doneCount} van ${items.length} gedaan`;
  }

  function updateShareButton() {
    document.getElementById('btn-share-list').disabled = items.every((i) => i.done);
  }

  /** Badge op de boodschappen-tab met het aantal nog te kopen items. */
  function updateBadge() {
    const badge = document.getElementById('shopping-badge');
    const open = items.filter((i) => !i.done).length;
    badge.textContent = open;
    badge.hidden = open === 0;
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

  return { init, rerender: render, addItem, renameItem, removeItem, setPicnicLink };
})();
