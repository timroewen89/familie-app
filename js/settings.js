/**
 * Settings — centrale bedrading van het instellingen-dialoog.
 *
 * Voorheen hingen Cal, Tags en Picnic elk hun eigen submit/open-listener aan
 * hetzelfde #settings-form. Nu registreert elke module via Settings.register()
 * een onOpen (velden vullen bij openen) en/of onSave (waarden verwerken bij
 * opslaan) callback, en beheert deze module de listeners en het dialoog.
 */
const Settings = (() => {
  const openHandlers = [];
  const saveHandlers = [];

  function register({ onOpen, onSave } = {}) {
    if (onOpen) openHandlers.push(onOpen);
    if (onSave) saveHandlers.push(onSave);
  }

  function open() {
    for (const fn of openHandlers) {
      try { fn(); } catch { /* een module mag het openen niet blokkeren */ }
    }
    document.getElementById('settings-dialog').showModal();
  }

  function init() {
    document.getElementById('btn-settings').addEventListener('click', open);
    document.getElementById('settings-form').addEventListener('submit', () => {
      for (const fn of saveHandlers) {
        try { fn(); } catch { /* fouten in één module mogen de rest niet breken */ }
      }
    });
    document.getElementById('btn-settings-cancel').addEventListener('click', () => {
      document.getElementById('settings-dialog').close();
    });
  }

  return { register, init, open };
})();
