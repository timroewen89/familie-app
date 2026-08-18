/**
 * Inline SVG-iconen (lijnstijl, à la Lucide) voor elementen die via
 * JavaScript worden opgebouwd. Statische iconen staan direct in index.html.
 * Kleur volgt de tekstkleur (currentColor); grootte via de .icon-klasse.
 */
const Icons = (() => {
  const PATHS = {
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
  };

  function html(name) {
    return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" `
      + `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
      + `${PATHS[name] || ''}</svg>`;
  }

  return { html };
})();
