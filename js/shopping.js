/**
 * Boodschappenlijst — items toevoegen, afvinken en verwijderen.
 * Alles wordt bewaard in localStorage zodat de lijst offline blijft werken.
 */
const Shopping = (() => {
  const STORAGE_KEY = 'familie-app.shopping';

  /** @type {{id: string, name: string, done: boolean}[]} */
  let items = [];

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      items = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(items)) items = [];
    } catch {
      items = [];
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  function addItem(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    items.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmed,
      done: false,
    });
    save();
    render();
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
    items = items.filter((i) => i.id !== id);
    save();
    render();
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

  function flashShareButton(message) {
    const btn = document.getElementById('btn-share-list');
    const original = btn.textContent;
    btn.textContent = message;
    setTimeout(() => { btn.textContent = original; }, 2000);
  }

  function render() {
    const list = document.getElementById('shopping-list');
    const counter = document.getElementById('shopping-counter');
    list.textContent = '';
    updateShareButton();

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

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-delete';
      del.textContent = '✕';
      del.setAttribute('aria-label', `${item.name} verwijderen`);
      del.addEventListener('click', () => removeItem(item.id));

      li.append(checkbox, name);
      const picnicBtn = Picnic.buttonFor(item);
      if (picnicBtn) li.appendChild(picnicBtn);
      li.appendChild(del);
      list.appendChild(li);
    }

    const doneCount = items.filter((i) => i.done).length;
    counter.textContent = `${doneCount} van ${items.length} gedaan`;
  }

  function updateShareButton() {
    document.getElementById('btn-share-list').disabled = items.every((i) => i.done);
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

  return { init, rerender: render };
})();
