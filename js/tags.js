/**
 * Persoonstags op agenda-afspraken.
 *
 * Google Calendar wordt alleen-lezen benaderd, dus de tags worden lokaal
 * bewaard (localStorage), gekoppeld aan het event-id. Elk gezinslid krijgt
 * een vaste kleur uit het Google-palet; via de filterbalk kun je de agenda
 * per persoon filteren.
 */
const Tags = (() => {
  const MEMBERS_KEY = 'familie-app.members';
  const TAGS_KEY = 'familie-app.event-tags';
  const DEFAULT_MEMBERS = ['Tim', 'Renate', 'Mick', 'Davi'];

  // Google-kleuren met voldoende contrast (tint als achtergrond, donker als tekst).
  const COLORS = [
    { bg: '#e8f0fe', fg: '#1967d2', solid: '#1a73e8' }, // blauw
    { bg: '#fce8e6', fg: '#c5221f', solid: '#ea4335' }, // rood
    { bg: '#fef7e0', fg: '#b06000', solid: '#f9ab00' }, // geel
    { bg: '#e6f4ea', fg: '#137333', solid: '#34a853' }, // groen
  ];

  let members = [];
  /** @type {Object<string, string[]>} event-id -> namen */
  let tags = {};
  /** Actieve filterselectie (leeg = alles tonen). */
  let filter = new Set();
  let currentEventId = null;

  // ---- Opslag ---------------------------------------------------------------

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
    return tags[eventId] || [];
  }

  /** Voldoet deze afspraak aan het actieve filter? */
  function passesFilter(eventId) {
    if (filter.size === 0) return true;
    return getTags(eventId).some((name) => filter.has(name));
  }

  function chipsFor(eventId) {
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

  function openDialog(eventId, title) {
    currentEventId = eventId;
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
        if (current.size > 0) tags[currentEventId] = [...current];
        else delete tags[currentEventId];
        save();
        App.render();
      });

      label.append(checkbox, document.createTextNode(name));
      options.appendChild(label);
    }

    document.getElementById('tags-dialog').showModal();
  }

  /** Tags direct zetten (bijv. bij het aanmaken van een nieuwe afspraak). */
  function setTags(eventId, names) {
    const valid = names.filter((name) => members.includes(name));
    if (valid.length > 0) tags[eventId] = valid;
    else delete tags[eventId];
    save();
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
      if (active) {
        chip.style.background = color.solid;
        chip.style.borderColor = color.solid;
        chip.style.color = color.fg === '#b06000' ? '#202124' : '#ffffff';
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

    // Gezinsleden bewerken via het instellingen-formulier.
    document.getElementById('input-members').value = members.join(', ');
    document.getElementById('settings-form').addEventListener('submit', () => {
      setMembers(document.getElementById('input-members').value.split(','));
      document.getElementById('input-members').value = members.join(', ');
      App.render();
    });

    document.getElementById('btn-settings').addEventListener('click', () => {
      document.getElementById('input-members').value = members.join(', ');
    });
  }

  return {
    init, getMembers, getTags, setTags, passesFilter, chipsFor, openDialog,
    renderFilterBar, renderMemberChecklist, readMemberChecklist,
  };
})();
