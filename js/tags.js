/**
 * Persoonstags op agenda-afspraken.
 *
 * Google Calendar wordt alleen-lezen benaderd, dus de tags worden lokaal
 * bewaard (localStorage), gekoppeld aan het event-id. Elk gezinslid krijgt
 * een vaste kleur uit het Google-palet; via de filterbalk kun je de agenda
 * per persoon filteren.
 *
 * Opslagformaat: event-id -> { names: string[], date: 'YYYY-MM-DD' }. De datum
 * is de afspraakdatum en wordt gebruikt om tags van afspraken ouder dan 90
 * dagen op te ruimen, zodat localStorage niet oneindig aangroeit.
 */
const Tags = (() => {
  const MEMBERS_KEY = 'familie-app.members';
  const TAGS_KEY = 'familie-app.event-tags';
  // Generieke plaatshouders: echte namen worden per gebruiker lokaal bewaard
  // (via ⚙️) en horen niet in de publieke repo thuis.
  const DEFAULT_MEMBERS = ['Ouder 1', 'Ouder 2', 'Kind 1', 'Kind 2'];

  // Google-kleuren met voldoende contrast (tint als achtergrond, donker als tekst).
  const COLORS = [
    { bg: '#e8f0fe', fg: '#1967d2', solid: '#1a73e8' }, // blauw
    { bg: '#fce8e6', fg: '#c5221f', solid: '#ea4335' }, // rood
    { bg: '#fef7e0', fg: '#b06000', solid: '#f9ab00' }, // geel
    { bg: '#e6f4ea', fg: '#137333', solid: '#34a853' }, // groen
  ];

  // Tags van afspraken ouder dan dit aantal dagen worden opgeruimd, zodat
  // localStorage niet oneindig aangroeit met tags van verleden afspraken.
  const PRUNE_DAYS = 90;

  let members = [];
  /** @type {Object<string, {names: string[], date: string}>} event-id -> {namen, afspraakdatum} */
  let tags = {};
  /** Actieve filterselectie (leeg = alles tonen). */
  let filter = new Set();
  let currentEventId = null;
  let currentDateKey = null;

  // ---- Opslag ---------------------------------------------------------------

  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function load() {
    try {
      const rawMembers = localStorage.getItem(MEMBERS_KEY);
      members = rawMembers ? JSON.parse(rawMembers) : [...DEFAULT_MEMBERS];
      if (!Array.isArray(members) || members.length === 0) members = [...DEFAULT_MEMBERS];
    } catch {
      members = [...DEFAULT_MEMBERS];
    }
    try {
      const rawTags = localStorage.getItem(TAGS_KEY);
      tags = rawTags ? JSON.parse(rawTags) : {};
      if (typeof tags !== 'object' || tags === null) tags = {};
    } catch {
      tags = {};
    }
    // Migratie van het oude formaat (event-id -> string[]) naar {names, date}.
    // De datum is nog onbekend, dus vandaag als startpunt (krijgt zijn echte
    // afspraakdatum zodra de afspraak weer gerenderd wordt).
    for (const id of Object.keys(tags)) {
      const value = tags[id];
      if (Array.isArray(value)) {
        tags[id] = { names: value, date: todayKey() };
      } else if (!value || !Array.isArray(value.names)) {
        delete tags[id];
      }
    }
    pruneOldTags();
  }

  /** Verwijdert tags van afspraken die meer dan PRUNE_DAYS geleden waren. */
  function pruneOldTags() {
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - PRUNE_DAYS);
    let changed = false;
    for (const id of Object.keys(tags)) {
      const date = tags[id] && tags[id].date;
      if (!date) continue;
      const [y, m, d] = date.split('-').map(Number);
      if (new Date(y, m - 1, d) < cutoff) {
        delete tags[id];
        changed = true;
      }
    }
    if (changed) save();
  }

  function save() {
    localStorage.setItem(MEMBERS_KEY, JSON.stringify(members));
    localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
  }

  function setMembers(newMembers) {
    members = newMembers.map((m) => m.trim()).filter(Boolean);
    if (members.length === 0) members = [...DEFAULT_MEMBERS];
    // Filter (UI-staat) opschonen tot bestaande leden. Tag-vermeldingen worden
    // NIET verwijderd: een naam die (nog) niet in members staat kan een
    // hernoeming of tijdelijke verwijdering zijn — bij terugzetten van de naam
    // komen de tags weer tevoorschijn. Onbekende namen worden alleen niet
    // getoond (zie chipsFor).
    filter = new Set([...filter].filter((f) => members.includes(f)));
    save();
  }

  function getMembers() {
    return [...members];
  }

  function colorFor(name) {
    const idx = members.indexOf(name);
    return COLORS[(idx >= 0 ? idx : 0) % COLORS.length];
  }

  // ---- Tags per afspraak ------------------------------------------------------

  function getTags(eventId) {
    const entry = tags[eventId];
    return entry && Array.isArray(entry.names) ? entry.names : [];
  }

  /** Schrijft de tags van een afspraak weg, inclusief de afspraakdatum (voor opruimen). */
  function writeTags(eventId, names, dateKey) {
    const valid = names.filter((name) => members.includes(name));
    if (valid.length > 0) {
      const existing = tags[eventId] || {};
      tags[eventId] = { names: valid, date: dateKey || existing.date || todayKey() };
    } else {
      delete tags[eventId];
    }
    save();
  }

  /** Werkt de bewaarde afspraakdatum bij zodra we hem bij het renderen kennen. */
  function recordDate(eventId, dateKey) {
    const entry = tags[eventId];
    if (entry && dateKey && entry.date !== dateKey) {
      entry.date = dateKey;
      save();
    }
  }

  /** Voldoet deze afspraak aan het actieve filter? */
  function passesFilter(eventId) {
    if (filter.size === 0) return true;
    return getTags(eventId).some((name) => filter.has(name));
  }

  function chipsFor(eventId, dateKey) {
    if (dateKey) recordDate(eventId, dateKey);
    // Alleen chips van huidige leden tonen; behouden tags van verwijderde/
    // hernoemde leden blijven bewaard maar worden niet weergegeven.
    const names = getTags(eventId).filter((name) => members.includes(name));
    if (names.length === 0) return null;
    const wrap = document.createElement('div');
    wrap.className = 'event-tags';
    for (const name of names) {
      const color = colorFor(name);
      const chip = document.createElement('span');
      chip.className = 'tag';
      chip.textContent = name;
      chip.style.background = color.bg;
      chip.style.color = color.fg;
      wrap.appendChild(chip);
    }
    return wrap;
  }

  // ---- Tag-dialog -------------------------------------------------------------

  function openDialog(eventId, title, dateKey) {
    currentEventId = eventId;
    currentDateKey = dateKey || null;
    document.getElementById('tags-event-title').textContent = title;

    const options = document.getElementById('tags-options');
    options.textContent = '';
    const selected = new Set(getTags(eventId));

    for (const name of members) {
      const color = colorFor(name);
      const label = document.createElement('label');
      label.className = 'tag-option';
      label.style.setProperty('--tag-bg', color.bg);
      label.style.setProperty('--tag-fg', color.fg);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.has(name);
      checkbox.addEventListener('change', () => {
        const current = new Set(getTags(currentEventId));
        if (checkbox.checked) current.add(name);
        else current.delete(name);
        writeTags(currentEventId, [...current], currentDateKey);
        App.render();
      });

      label.append(checkbox, document.createTextNode(name));
      options.appendChild(label);
    }

    document.getElementById('tags-dialog').showModal();
  }

  /** Tags direct zetten (bijv. bij het aanmaken van een nieuwe afspraak). */
  function setTags(eventId, names, dateKey) {
    writeTags(eventId, names, dateKey);
  }

  /** Checklist met gezinsleden renderen (voor de nieuwe-afspraak-dialog). */
  function renderMemberChecklist(container, preChecked = []) {
    container.textContent = '';
    for (const name of members) {
      const color = colorFor(name);
      const label = document.createElement('label');
      label.className = 'tag-option';
      label.style.setProperty('--tag-bg', color.bg);
      label.style.setProperty('--tag-fg', color.fg);

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.dataset.name = name;
      checkbox.checked = preChecked.includes(name);

      label.append(checkbox, document.createTextNode(name));
      container.appendChild(label);
    }
  }

  function readMemberChecklist(container) {
    return [...container.querySelectorAll('input:checked')].map((input) => input.dataset.name);
  }

  // ---- Filterbalk ---------------------------------------------------------------

  function renderFilterBar() {
    const bar = document.getElementById('filter-bar');
    bar.textContent = '';
    for (const name of members) {
      const color = colorFor(name);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'filter-chip';
      chip.textContent = name;
      const active = filter.has(name);
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (active) {
        // color.fg is de donkere variant; wit daarop haalt WCAG AA (>=4.5:1),
        // in tegenstelling tot color.solid (rood/groen faalden).
        chip.style.background = color.fg;
        chip.style.borderColor = color.fg;
        chip.style.color = '#ffffff';
      } else {
        chip.style.background = color.bg;
        chip.style.borderColor = 'transparent';
        chip.style.color = color.fg;
      }
      chip.addEventListener('click', () => {
        if (filter.has(name)) filter.delete(name);
        else filter.add(name);
        App.render();
      });
      bar.appendChild(chip);
    }
  }

  // ---- Init ------------------------------------------------------------------

  function init() {
    load();

    // Gezinsleden bewerken via het instellingen-formulier (centraal via Settings).
    Settings.register({
      onOpen: () => {
        document.getElementById('input-members').value = members.join(', ');
      },
      onSave: () => {
        setMembers(document.getElementById('input-members').value.split(','));
        document.getElementById('input-members').value = members.join(', ');
        App.render();
      },
    });
  }

  return {
    init, getMembers, getTags, setTags, passesFilter, chipsFor, openDialog,
    renderFilterBar, renderMemberChecklist, readMemberChecklist,
  };
})();
