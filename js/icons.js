/**
 * Inline SVG-iconen (lijnstijl, à la Lucide) voor elementen die via
 * JavaScript worden opgebouwd. Statische iconen staan direct in index.html.
 * Kleur volgt de tekstkleur (currentColor); grootte via de .icon-klasse.
 */
const Icons = (() => {
  const PATHS = {
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    star: '<path d="M11.5 2.3a.55.55 0 0 1 1 0l2.3 4.7 5.2.75a.55.55 0 0 1 .3.94l-3.75 3.65.9 5.15a.55.55 0 0 1-.8.58L12 15.6l-4.65 2.45a.55.55 0 0 1-.8-.58l.9-5.15L3.7 8.7a.55.55 0 0 1 .3-.94l5.2-.76z"/>',
  };

  function html(name) {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" `
      + `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
      + `${PATHS[name] || ''}</svg>`;
  }

  return { html };
})();
