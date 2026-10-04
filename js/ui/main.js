// The entry point (runs last in the bundle). M0 boots a preview planet directly;
// M5 replaces this with the main menu (new match, multi-select, etc.).
// Boot is deferred to the next frame and wrapped so a failure is reported to
// window.__GC_ERROR__ (and the console) instead of hanging the page.
(function (E) {
  'use strict';
  let game = null;
  function start(opts) {
    try {
      game = E.boot(opts || {});
      window.GC.game = game;
      E.game = game;
      return game;
    } catch (err) {
      console.error('GC boot failed:', err);
      window.__GC_ERROR__ = (err && err.stack) || String(err);
      const el = document.getElementById('ui');
      if (el) { const d = document.createElement('div'); d.className = 'gc-boot-error'; d.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;color:#ff8a8a;font:14px/1.5 monospace;padding:40px;text-align:center;z-index:99'; d.textContent = 'Boot failed:\n' + (err && err.message || err); el.appendChild(d); }
      return null;
    }
  }
  window.GC = window.GC || {};
  window.GC.start = start;
  window.GC.E = E;
  // Defer to the next frame so the canvas is laid out and a menu can unlock audio.
  const auto = () => start(window.GC_AUTOSTART || { biome: 'tundra', seed: 7 });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(auto));
  else requestAnimationFrame(auto);
})(window.E = window.E || {});
