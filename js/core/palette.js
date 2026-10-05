// Team colours, in one place so a colour-blind palette can swap them at runtime.
// `E.Palette.col` is a stable object the HUD, campaign map and CSS variables read
// from; `apply(name)` mutates it in place and pushes the team colours onto the
// document, so redraws pick the new palette up without any other wiring. The 3D
// faction art keeps its own palette; identity is also carried by shape, glyph
// and flag, never by colour alone.
(function (E) {
  'use strict';
  const PALETTES = {
    default:    { aegis: '#ff6a3a', verdant: '#3df0b0', neutral: '#b9c6dd', free: '#9aa8c0', objective: '#ffd04a' },
    // Okabe-Ito warm/cool pair: vermillion vs blue stays distinct under red-green
    // colour blindness and on low-contrast panels.
    colorblind: { aegis: '#d55e00', verdant: '#2f9be0', neutral: '#c8d4e8', free: '#9aa8c0', objective: '#ffd04a' },
  };
  const col = Object.assign({}, PALETTES.default);
  function apply(name) {
    const p = PALETTES[name] || PALETTES.default;
    Object.assign(col, p);
    if (typeof document !== 'undefined' && document.documentElement) {
      const r = document.documentElement.style;
      r.setProperty('--aegis', col.aegis);
      r.setProperty('--verdant', col.verdant);
      document.documentElement.classList.toggle('cb', name === 'colorblind');
    }
  }
  E.Palette = { col, apply, names: Object.keys(PALETTES), palettes: PALETTES };
})(window.E = window.E || {});
