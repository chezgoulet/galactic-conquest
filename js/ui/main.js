// The entry point (runs last in the bundle). Shows the main menu / galactic
// campaign map; when a battle starts it launches the Game and, when the match
// ends, returns to the menu and records the result into the campaign.
(function (E) {
  'use strict';
  let game = null;
  let menu = null;
  const uiRoot = () => document.getElementById('ui');

  function start(opts, campaign) {
    try {
      if (menu) menu.hide();
      game = E.boot(opts || {});
      window.GC.game = game;
      // record fleet scale for the force
      if (game.world && opts && opts.fleetScale) game.world.fleetScale = opts.fleetScale;
      game.onEnd = (won) => {
        if (campaign) {
          const res = E.Campaign.applyResult(campaign, won);
          try { localStorage.setItem(E.LS_KEY, JSON.stringify(campaign)); } catch {}
          E.bus.emit('campaign:updated', res);
        }
        // return to the menu
        setTimeout(() => { if (menu) menu.show(); }, 2500);
        if (menu) menu.campaign = campaign || menu.campaign;
        E.bus.emit('game:end', won);
      };
      E.bus.emit('game:start', game);
      return game;
    } catch (err) {
      console.error('GC boot failed:', err);
      window.__GC_ERROR__ = (err && err.stack) || String(err);
      if (menu) { menu.campaign = campaign || menu.campaign; menu.show(); }
      return null;
    }
  }

  function boot() {
    menu = new E.Menu(uiRoot());
    menu.onStart = (opts, campaign) => start(opts, campaign);
    // A GC_AUTOSTART (biome/seed/human) skips the menu — used by tests and as
    // a quick-play hook. Otherwise show the main menu / campaign map.
    if (window.GC_AUTOSTART) {
      start(Object.assign({ biome: 'desert', seed: 7 }, window.GC_AUTOSTART), null);
    } else {
      menu.show();
    }
  }

  window.GC = window.GC || {};
  window.GC.start = boot;
  window.GC.E = E;
  window.GC.getGame = () => game;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(boot));
  else requestAnimationFrame(boot);
})(window.E = window.E || {});
