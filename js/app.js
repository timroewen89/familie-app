/**
 * App-opstart en weeknavigatie.
 * Beheert de zichtbare week en rendert het weekgrid; de events zelf
 * komen uit de Cal-module (Google Calendar).
 */
const App = (() => {
  const DAY_NAMES = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];

  /** Maandag (00:00 lokale tijd) van de zichtbare week. */
  let currentMonday = mondayOf(new Date());

  // ---- Datumhulpjes ---------------------------------------------------------

  function mondayOf(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = d.getDay(); // 0 = zondag
    d.setDate(d.getDate() - ((day + 6) % 7));
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
    return { start: new Date(currentMonday), end: addDays(currentMonday, 7) };
  }

  // ---- Renderen ---------------------------------------------------------------

  function renderWeekLabel() {
    const sunday = addDays(currentMonday, 6);
    const opts = { day: 'numeric', month: 'short' };
    const from = currentMonday.toLocaleDateString('nl-NL', opts);
    const to = sunday.toLocaleDateString('nl-NL', { ...opts, year: 'numeric' });
    document.getElementById('week-label').textContent =
      `Week ${isoWeekNumber(currentMonday)} · ${from} – ${to}`;
  }

  function renderWeek() {
    renderWeekLabel();

    const grid = document.getElementById('week-grid');
    grid.textContent = '';
    const todayKey = dateKey(new Date());

    for (let i = 0; i < 7; i++) {
      const date = addDays(currentMonday, i);
      const key = dateKey(date);

      const column = document.createElement('div');
      column.className = 'day-column';
      if (key === todayKey) column.classList.add('today');

      const header = document.createElement('div');
      header.className = 'day-header';
      const name = document.createElement('span');
      name.textContent = DAY_NAMES[i];
      const dayDate = document.createElement('span');
      dayDate.className = 'day-date';
      dayDate.textContent = date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
      header.append(name, dayDate);
      column.appendChild(header);

      const events = Cal.getEventsForDay(key);
      // Hele-dag-events bovenaan.
      events.sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0));

      if (events.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'day-empty';
        empty.textContent = Cal.isConnected() ? 'Geen afspraken' : '—';
        column.appendChild(empty);
      } else {
        for (const event of events) {
          const el = document.createElement('div');
          el.className = 'event';
          if (event.allDay) el.classList.add('all-day');
          if (event.time) {
            const time = document.createElement('span');
            time.className = 'event-time';
            time.textContent = event.time;
            el.appendChild(time);
          }
          el.appendChild(document.createTextNode(event.title));
          column.appendChild(el);
        }
      }

      grid.appendChild(column);
    }
  }

  // ---- Navigatie ----------------------------------------------------------

  function goToWeek(monday) {
    currentMonday = monday;
    renderWeek();
    Cal.refresh();
  }

  function init() {
    document.getElementById('btn-prev-week')
      .addEventListener('click', () => goToWeek(addDays(currentMonday, -7)));
    document.getElementById('btn-next-week')
      .addEventListener('click', () => goToWeek(addDays(currentMonday, 7)));
    document.getElementById('btn-today')
      .addEventListener('click', () => goToWeek(mondayOf(new Date())));

    renderWeek();
  }

  return { init, renderWeek, getWeekRange, dateKey, parseDateKey };
})();

document.addEventListener('DOMContentLoaded', () => {
  Shopping.init();
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
