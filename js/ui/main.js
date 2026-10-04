// The entry point (runs last in the bundle). Creates the one Game (renderer +
// HUD) and the Menu, shows the main menu over a live AI battle, launches
// battles, and folds results back into the career profile and the campaign.
(function (E) {
  'use strict';
  let game = null, menu = null;
  const ui = () => document.getElementById('ui');

  function loading(text, fn) {
    let el = document.getElementById('gc-loading');
    if (!el) { el = document.createElement('div'); el.id = 'gc-loading'; document.body.appendChild(el); }
    el.innerHTML = `<div><div class="l-title">${text}</div><div class="bar"><i></i></div></div>`;
    el.style.display = 'grid'; el.classList.remove('out');
    // two frames so the splash paints before the (synchronous) world build
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try { fn(); } catch (err) { console.error('GC start failed:', err); window.__GC_ERROR__ = (err && err.stack) || String(err); }
      el.classList.add('out'); setTimeout(() => { el.style.display = 'none'; }, 500);
    }));
  }

  function attract() {
    const biomes = ['desert', 'jungle', 'urban', 'tundra', 'volcanic', 'gas'];
    const b = window.GC_ATTRACT_BIOME || biomes[(Math.random() * biomes.length) | 0];
    loading('GALACTIC CONQUEST', () => { game.start({ role: 'attract', biome: b, seed: (Math.random() * 1e9) | 0, fleetScale: 1.4, enemyScale: 1.4 }); menu.show(); window.__GC_MENU__ = true; });
  }

  function battle(opts, ctx) {
    menu.hide();
    const b = E.biome(opts.biome);
    loading(`${(opts.system || b.name).toUpperCase()}<span>${b.theme} · ${b.challenge.name}</span>`, () => {
      game.stop();
      game.start(Object.assign({ role: 'sp' }, opts));
      window.__GC_BATTLE__ = true;
      game.onEnd = (r) => {
        const P = menu.profile; P.xp += r.score + (r.won ? 500 : 100); P.battles++; if (r.won) P.wins++; P.kills += r.kills; menu.saveProfile();
        let extra = `<div class="r-xp">+${(r.score + (r.won ? 500 : 100)).toLocaleString()} XP · ${E.Campaign.rank(P.xp).name}</div>`;
        if (ctx && ctx.campaign) {
          const res = E.Campaign.applyBattle(ctx.campaign, ctx.planet, r.won, r.score, ctx.defending);
          ctx.res = res; menu.saveCampaign();
          extra += `<div class="r-camp">${res.defending ? (res.won ? `${res.planet} holds.` : `${res.planet} has fallen.`) : (res.won ? `${res.planet} is yours.` : `The assault on ${res.planet} failed.`)} +${res.reward} credits</div>`;
        }
        game.hud.resultsExtra(extra);
      };
      game.onContinue = () => { const res = ctx && ctx.res; back(() => { if (ctx && ctx.campaign) menu.afterBattle(res || { defending: ctx.defending }); else menu.show(); }); };
      game.onQuit = () => {
        if (ctx && ctx.campaign && ctx.defending) { E.Campaign.applyBattle(ctx.campaign, ctx.planet, false, 0, true); menu.saveCampaign(); }
        back(() => { if (ctx && ctx.campaign) menu.showCampaign(); else menu.show(); });
      };
    });
  }
  // return to the menu with a fresh attract battle behind it
  function back(then) {
    game.stop();
    loading('GALACTIC CONQUEST', () => { game.start({ role: 'attract', biome: ['desert', 'jungle', 'urban', 'tundra'][(Math.random() * 4) | 0], seed: (Math.random() * 1e9) | 0, fleetScale: 1.4, enemyScale: 1.4 }); then(); });
  }

  async function boot() {
    try {
      menu = new E.Menu(ui());
      // the WebGPU renderer initialises asynchronously (and falls back to WebGL2 on its own)
      await E.Scene.preinit(document.getElementById('view'), menu.settings);
      game = new E.Game(document.getElementById('view'), menu.settings);
      menu.onStart = battle;
      window.GC.game = game; window.GC.menu = menu; window.GC.battle = battle; window.GC.back = back;
      if (window.GC_AUTOSTART) battle(Object.assign({ biome: 'desert', seed: 7 }, window.GC_AUTOSTART), null);
      else attract();
    } catch (err) {
      console.error('GC boot failed:', err);
      window.__GC_ERROR__ = (err && err.stack) || String(err);
      const el = document.getElementById('gc-loading') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'gc-loading' }));
      el.style.display = 'grid'; el.innerHTML = '<div><div class="l-title">Could not start<span>This game needs WebGPU or WebGL 2. ' + String(err && err.message || err).replace(/</g, '&lt;') + '</span></div></div>';
    }
  }

  window.GC = window.GC || {};
  window.GC.E = E;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(boot));
  else requestAnimationFrame(boot);
})(window.E = window.E || {});
