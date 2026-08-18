/**
 * App-opstart, dag/week-weergave en navigatie.
 * Beheert de zichtbare periode en rendert het grid; de events komen uit de
 * Cal-module (Google Calendar), de persoonstags uit de Tags-module.
 */
const App = (() => {
  const VIEW_KEY = 'familie-app.view';
  const DAY_NAMES = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

  /** 'week' of 'day' */
  let viewMode = localStorage.getItem(VIEW_KEY) === 'day' ? 'day' : 'week';
  /** De dag die centraal staat: in dagweergave de getoonde dag, in weekweergave een dag binnen de week. */
  let currentDate = stripTime(new Date());
  /** Maandag van de laatst opgehaalde week, om onnodig herladen te voorkomen. */
  let lastFetchedWeek = null;

  // ---- Datumhulpjes ---------------------------------------------------------

  function stripTime(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function mondayOf(date) {
    const d = stripTime(date);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // getDay(): 0 = zondag
    return d;
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  /** Sleutel 'YYYY-MM-DD' in lokale tijd. */
  function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** Parseert 'YYYY-MM-DD' als lokale datum (new Date('YYYY-MM-DD') zou UTC zijn). */
  function parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function isoWeekNumber(date) {
    // Donderdag van dezelfde ISO-week bepaalt het weeknummer en jaar.
    const thursday = addDays(mondayOf(date), 3);
    const firstThursday = addDays(mondayOf(new Date(thursday.getFullYear(), 0, 4)), 3);
    return 1 + Math.round((thursday - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  }

  /** Begin (maandag 00:00) en einde (volgende maandag 00:00) van de zichtbare week. */
  function getWeekRange() {
    const monday = mondayOf(currentDate);
    return { start: monday, end: addDays(monday, 7) };
  }

  // ---- Renderen -------------------------------------------------------------

  function formatLabel() {
    if (viewMode === 'day') {
      return currentDate.toLocaleDateString('nl-NL', {
        weekday: 'long', day: 'numeric', month: 'short', year: 'numeric',
      });
    }
    const monday = mondayOf(currentDate);
    const sunday = addDays(monday, 6);
    const from = monday.getMonth() === sunday.getMonth()
      ? String(monday.getDate())
      : monday.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
    const to = sunday.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
    return `Week ${isoWeekNumber(monday)} · ${from} – ${to}`;
  }

  function buildEventElement(event) {
    const el = document.createElement('div');
    el.className = 'event';
    if (event.allDay) el.classList.add('all-day');
    // Kleur van de agenda waar de afspraak uit komt (uit Google Calendar).
    if (event.color) el.style.borderLeftColor = event.color;
    const time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = event.allDay ? 'hele dag' : event.time;
    el.appendChild(time);
    el.appendChild(document.createTextNode(event.title));

    const chips = Tags.chipsFor(event.id);
    if (chips) el.appendChild(chips);

    if (event.id) {
      el.setAttribute('role', 'button');
      el.tabIndex = 0; // focusbaar voor toetsenbord/VoiceOver
      el.setAttribute('aria-label', `${event.title}, tik om personen te taggen`);
      el.title = 'Tik om personen te taggen';
      const open = () => Tags.openDialog(event.id, event.title);
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    }
    return el;
  }

  function buildDayColumn(date, dayView) {
    const key = dateKey(date);
    const column = document.createElement('div');
    column.className = 'day-column';
    if (dayView) column.classList.add('day-view');
    if (key === dateKey(new Date())) column.classList.add('today');

    const header = document.createElement('div');
    header.className = 'day-header';
    const name = document.createElement('span');
    name.textContent = DAY_NAMES[(date.getDay() + 6) % 7];
    const dayDate = document.createElement('span');
    dayDate.className = 'day-date';
    dayDate.textContent = date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
    header.append(name, dayDate);
    column.appendChild(header);

    const events = Cal.getEventsForDay(key).filter((e) => Tags.passesFilter(e.id));
    // Hele-dag-events bovenaan, daarna op tijd (relevant bij meerdere agenda's).
    events.sort((a, b) =>
      ((b.allDay ? 1 : 0) - (a.allDay ? 1 : 0)) || (a.time || '').localeCompare(b.time || ''));

    if (events.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'day-empty';
      empty.textContent = Cal.isConnected() ? 'Geen afspraken' : '—';
      column.appendChild(empty);
    } else {
      for (const event of events) column.appendChild(buildEventElement(event));
    }
    return column;
  }

  function render() {
    document.getElementById('week-label').textContent = formatLabel();
    const dayBtn = document.getElementById('btn-view-day');
    const weekBtn = document.getElementById('btn-view-week');
    dayBtn.classList.toggle('active', viewMode === 'day');
    weekBtn.classList.toggle('active', viewMode === 'week');
    dayBtn.setAttribute('aria-pressed', viewMode === 'day' ? 'true' : 'false');
    weekBtn.setAttribute('aria-pressed', viewMode === 'week' ? 'true' : 'false');
    Tags.renderFilterBar();

    const grid = document.getElementById('week-grid');
    grid.textContent = '';
    grid.classList.toggle('day-mode', viewMode === 'day');

    if (viewMode === 'day') {
      grid.appendChild(buildDayColumn(currentDate, true));
    } else {
      const monday = mondayOf(currentDate);
      for (let i = 0; i < 7; i++) {
        grid.appendChild(buildDayColumn(addDays(monday, i), false));
      }
    }
  }

  // ---- Navigatie ------------------------------------------------------------

  function refreshIfWeekChanged() {
    const weekKey = dateKey(mondayOf(currentDate));
    if (weekKey !== lastFetchedWeek) {
      lastFetchedWeek = weekKey;
      Cal.refresh();
    }
  }

  function goTo(date) {
    currentDate = stripTime(date);
    render();
    refreshIfWeekChanged();
  }

  function step(direction) {
    goTo(addDays(currentDate, direction * (viewMode === 'day' ? 1 : 7)));
  }

  function setView(mode) {
    viewMode = mode;
    localStorage.setItem(VIEW_KEY, mode);
    render();
  }

  /** Veeggebaren: naar links = volgende dag/week, naar rechts = vorige. */
  function initSwipe() {
    const grid = document.getElementById('week-grid');
    let startX = null;
    let startY = null;
    grid.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });
    grid.addEventListener('touchend', (e) => {
      if (startX === null) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      startX = startY = null;
      // Alleen duidelijk horizontale vegen; verticaal scrollen blijft gewoon werken.
      if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
        step(dx < 0 ? 1 : -1);
      }
    }, { passive: true });
  }

  // ---- Tabs (Agenda / Boodschappen) --------------------------------------

  const TAB_KEY = 'familie-app.tab';

  function setTab(tab) {
    localStorage.setItem(TAB_KEY, tab);
    document.getElementById('agenda-panel').hidden = tab !== 'agenda';
    document.getElementById('shopping-panel').hidden = tab !== 'shopping';
    for (const [id, key] of [['tab-agenda', 'agenda'], ['tab-shopping', 'shopping']]) {
      const btn = document.getElementById(id);
      btn.classList.toggle('active', tab === key);
      btn.setAttribute('aria-pressed', tab === key ? 'true' : 'false');
    }
  }

  function initTabs() {
    document.getElementById('tab-agenda').addEventListener('click', () => setTab('agenda'));
    document.getElementById('tab-shopping').addEventListener('click', () => setTab('shopping'));
    setTab(localStorage.getItem(TAB_KEY) === 'shopping' ? 'shopping' : 'agenda');
  }

  function init() {
    initTabs();
    document.getElementById('btn-prev').addEventListener('click', () => step(-1));
    document.getElementById('btn-next').addEventListener('click', () => step(1));
    document.getElementById('btn-today').addEventListener('click', () => goTo(new Date()));
    document.getElementById('btn-view-day').addEventListener('click', () => setView('day'));
    document.getElementById('btn-view-week').addEventListener('click', () => setView('week'));
    initSwipe();

    lastFetchedWeek = dateKey(mondayOf(currentDate));
    render();
  }

  function getCurrentDate() {
    return new Date(currentDate);
  }

  /** Zet ruwe fetch-fouten om in een begrijpelijke Nederlandse melding. */
  function friendlyError(err) {
    const msg = (err && err.message) || '';
    if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
      return 'je bent offline of de verbinding werd onderbroken';
    }
    return msg || 'onbekende fout';
  }

  // ---- Toast: niet-blokkerende melding (i.p.v. alert(), fijner in een PWA) ----

  let toastTimer = null;

  function toast(message) {
    let el = document.getElementById('app-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'app-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
  }

  return { init, render, getWeekRange, getCurrentDate, dateKey, parseDateKey, toast, friendlyError };
})();

document.addEventListener('DOMContentLoaded', () => {
  Picnic.init();
  Shopping.init();
  Tags.init();
  Cal.init();
  App.init();
});

// PWA: service worker maakt de app installeerbaar en offline bruikbaar.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline-cache is optioneel; de app werkt ook zonder.
    });
  });
}
