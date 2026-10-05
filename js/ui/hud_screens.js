// Full-screen layers of the battle HUD plus the pieces the menus share:
// settings panel (graphics tier, audio mix, sensitivity, accessibility), the
// controls reference, pause, scoreboard and the three-domain results report.
(function (E) {
  'use strict';
  const P = E.HUD.prototype;
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const QUALITY = ['auto', 'low', 'medium', 'high', 'ultra'];
  const MIX = [['master', 'Master'], ['music', 'Music'], ['sfx', 'Weapons and impacts'], ['ambience', 'Engines and ambience'], ['voice', 'Alerts and voice'], ['ui', 'Interface']];

  // ── shared: settings panel ──
  const SettingsUI = {
    defaults: { quality: 'auto', sens: 1, invertY: false, reduceMotion: false, uiScale: 1, mix: { master: 0.8, music: 0.8, sfx: 0.9, ambience: 0.8, voice: 1, ui: 0.8 } },
    ensure(s) { s.mix = Object.assign({}, SettingsUI.defaults.mix, s.mix || {}, s.volume != null && !(s.mix && s.mix.master != null) ? { master: s.volume } : {}); if (s.uiScale == null) s.uiScale = 1; return s; },
    html(s) {
      SettingsUI.ensure(s);
      return `<div class="st-grid">
        <label>Graphics tier<select class="s-q">${QUALITY.map(q => `<option value="${q}"${(s.quality || 'auto') === q ? ' selected' : ''}>${q[0].toUpperCase() + q.slice(1)}${q === 'ultra' ? ' (heavy)' : ''}</option>`).join('')}</select></label>
        <label>Mouse sensitivity<input type="range" class="s-sens" min="0.3" max="2.5" step="0.05" value="${s.sens || 1}"><output>${(s.sens || 1).toFixed(2)}</output></label>
        <label>Interface size<input type="range" class="s-ui" min="0.8" max="1.5" step="0.05" value="${s.uiScale}"><output>${Math.round(s.uiScale * 100)}%</output></label>
        <label class="chk"><input type="checkbox" class="s-inv"${s.invertY ? ' checked' : ''}> Invert Y</label>
        <label class="chk"><input type="checkbox" class="s-rm"${s.reduceMotion ? ' checked' : ''}> Reduce motion (no pulsing, flashing or sliding)</label>
      </div>
      <div class="st-sub">AUDIO MIX</div>
      <div class="st-grid">${MIX.map(([k, n]) => `<label>${n}<input type="range" data-mix="${k}" min="0" max="1" step="0.05" value="${s.mix[k]}"><output>${Math.round(s.mix[k] * 100)}</output></label>`).join('')}</div>`;
    },
    apply(s) {
      SettingsUI.ensure(s);
      document.documentElement.classList.toggle('rm', !!s.reduceMotion);
      document.documentElement.style.setProperty('--ui-scale', String(s.uiScale));
      if (E.Mixer) E.Mixer.setMix(s.mix);
    },
    bind(root, s, game) {
      const save = () => { SettingsUI.apply(s); E.bus.emit('settings:changed', s); };
      const q = (c) => root.querySelector(c);
      q('.s-q').addEventListener('change', (e) => { s.quality = e.target.value; const g = game || (window.GC && window.GC.game); if (g) g.renderer.scene.setQuality(s.quality); save(); });
      const rng = (sel, key, fmt) => q(sel).addEventListener('input', (e) => { s[key] = +e.target.value; e.target.nextElementSibling.textContent = fmt(s[key]); save(); });
      rng('.s-sens', 'sens', v => v.toFixed(2)); rng('.s-ui', 'uiScale', v => Math.round(v * 100) + '%');
      q('.s-inv').addEventListener('change', (e) => { s.invertY = e.target.checked; save(); });
      q('.s-rm').addEventListener('change', (e) => { s.reduceMotion = e.target.checked; save(); });
      root.querySelectorAll('[data-mix]').forEach(r => r.addEventListener('input', (e) => { s.mix[r.dataset.mix] = +e.target.value; if (r.dataset.mix === 'master') s.volume = s.mix.master; e.target.nextElementSibling.textContent = Math.round(+e.target.value * 100); save(); if (E.SFX && r.dataset.mix !== 'music') E.SFX.play(r.dataset.mix === 'voice' ? 'beep' : r.dataset.mix === 'ui' ? 'select' : 'rifle', null, 0.6); }));
    },
  };
  E.SettingsUI = SettingsUI;

  // ── shared: controls reference ──
  const ControlsUI = {
    html(active) {
      const C = E.CONTROLS; active = active || 'infantry';
      return `<div class="ct-tabs" role="tablist">${C.order.map(k => `<button role="tab" class="ct-tab${k === active ? ' on' : ''}" data-k="${k}" aria-selected="${k === active}">${C[k].name}</button>`).join('')}</div><div class="ct-body">${ControlsUI.body(active)}</div>`;
    },
    body(k) {
      const C = E.CONTROLS, c = C[k], rows = c.rows.length ? c.rows : C.infantry.rows;
      return `<p class="ct-desc">${esc(c.desc)}</p><table class="ct-tbl">${rows.map(([keys, what]) => `<tr><td>${String(keys).split(' ').map(x => `<kbd>${esc(x)}</kbd>`).join('')}</td><td>${esc(what)}</td></tr>`).join('')}</table>`;
    },
    bind(root) { root.querySelectorAll('.ct-tab').forEach(b => b.addEventListener('click', () => { root.querySelectorAll('.ct-tab').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); }); root.querySelector('.ct-body').innerHTML = ControlsUI.body(b.dataset.k); if (E.SFX) E.SFX.play('hover'); })); },
  };
  E.ControlsUI = ControlsUI;

  // ── pause ──
  P.showPause = function () {
    const g = this.game, s = g.settings;
    this.setLayer('pause', `
      <div class="p-card">
        <div class="p-title">PAUSED</div>
        <div class="p-btns"><button class="gc-btn primary p-resume">Resume</button><button class="gc-btn p-ctl">Controls <span class="k">F1</span></button></div>
        <div class="p-set"></div>
        <button class="gc-btn p-quit">${g.role === 'sp' ? 'Abandon Battle' : 'Leave Match'}</button>
      </div>`);
    const L = this.$.layer; L.querySelector('.p-set').innerHTML = SettingsUI.html(s); SettingsUI.bind(L, s, g);
    L.querySelector('.p-resume').addEventListener('click', () => g.togglePause(false));
    L.querySelector('.p-ctl').addEventListener('click', () => this.showControls());
    L.querySelector('.p-quit').addEventListener('click', () => { g.paused = false; if (g.onQuit) g.onQuit(); });
    const r = L.querySelector('.p-resume'); if (r) r.focus();
  };
  P.hidePause = function () { if (this.layerKind === 'pause' || this.layerKind === 'controls') { this.setLayer('', ''); if (this.game.state === 'deploy') this.showDeploy(); } };

  P.showControls = function () {
    const g = this.game, u = g.unit(), back = this.layerKind, k0 = u ? (u.mode === 'boarding' ? 'boarding' : u.kind === 'infantry' && u.type === 'engineer' ? 'engineer' : u.kind) : (g.state === 'commander' ? 'commander' : 'infantry');
    this._ctlBack = back; this._ctlPaused = g.paused;
    this.setLayer('controls', `<div class="p-card ct-card"><div class="p-title">CONTROLS</div>${ControlsUI.html(E.CONTROLS[k0] ? k0 : 'infantry')}<div class="p-btns"><button class="gc-btn primary ct-close">Close <span class="k">ESC</span></button></div></div>`);
    const L = this.$.layer; ControlsUI.bind(L); L.querySelector('.ct-close').addEventListener('click', () => this.closeControls());
    if (g.state === 'play' && !g.paused) { g.paused = true; g.unlock(); this._ctlAuto = true; } else this._ctlAuto = false;
  };
  P.closeControls = function () {
    const g = this.game; if (this.layerKind !== 'controls') return;
    this.setLayer('', '');
    if (this._ctlBack === 'pause') this.showPause(); else if (g.state === 'deploy') this.showDeploy();
    if (this._ctlAuto) { g.paused = false; if (g.state === 'play') g.lock(); this._ctlAuto = false; }
  };

  P.scoreboard = function (on) {
    const g = this.game, w = g.world;
    if (!on) { if (this.layerKind === 'score') this.setLayer('', ''); if (g.state === 'deploy' && !this.layerKind) this.showDeploy(); return; }
    if (this.layerKind && this.layerKind !== 'deploy') return;
    const row = (f) => { const T = w.teams[f]; const ps = Object.values(w.players).filter(p => p.team === f).sort((a, b) => b.score - a.score);
      return `<div class="s-team ${f}"><div class="s-h"><b>${E.faction(f).name.toUpperCase()}</b><span>${T.tickets} reinforcements · ${T.cps} posts · ${T.kills} kills</span></div>
        <table><tr><th>Player</th><th>Score</th><th>K</th><th>D</th><th>Caps</th></tr>${ps.map(p => `<tr class="${p.id === g.pid ? 'me' : ''}"><td>${esc(p.name)}</td><td>${p.score}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.captures}</td></tr>`).join('') || '<tr><td colspan="5" class="dim">AI commander</td></tr>'}</table></div>`; };
    this.setLayer('score', `<div class="s-card"><div class="p-title">${esc(w.planet.biomeDef.name).toUpperCase()} — ${E.fmtTime(w.t)}</div>${row('aegis')}${row('verdant')}</div>`);
  };

  // ── results: the battle across land, air and space ──
  P.showResults = function (r) {
    const g = this.game, w = g.world, team = g.team, en = E.opponent(team), kd = r.deaths ? (r.kills / r.deaths).toFixed(1) : r.kills, L = w.landStats || {};
    const awards = [];
    if (r.kills >= 20) awards.push('WAR HERO'); if (r.best >= 8) awards.push('UNSTOPPABLE'); if (r.captures >= 3) awards.push('VANGUARD'); if (r.deaths === 0 && r.kills > 0) awards.push('UNTOUCHABLE'); if (r.won && r.tickets > r.enemyTickets + 100) awards.push('DECISIVE VICTORY');
    const stat = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
    const fl = (t) => w.units.filter(u => u.alive && u.team === t && u.kind === 'fighter').length;
    const rep = (w.fleetReport && w.fleetReport[team]) || [], erep = (w.fleetReport && w.fleetReport[en]) || [];
    const STAT = { active: 'ON STATION', retreated: 'WITHDREW', retreating: 'WITHDRAWING', destroyed: 'LOST', captured: 'CAPTURED' };
    const ship = (s) => `<div class="rs ${s.status}"><span>${esc(s.name)}${s.flag ? ' ★' : ''}</span><i><b style="width:${Math.round(s.hullFrac * 100)}%"></b></i><em>${Math.round(s.hullFrac * 100)}% · ${STAT[s.status] || s.status}</em></div>`;
    this.setLayer('results', `
      <div class="r-card ${r.won ? 'won' : 'lost'}">
        <div class="r-title">${r.won ? 'VICTORY' : 'DEFEAT'}</div>
        <div class="r-sub">${esc(w.planet.biomeDef.name)} · ${E.fmtTime(r.time)} · ${E.faction(r.winner).name} holds the field</div>
        <div class="r-doms">
          <section class="r-dom"><h4>GROUND</h4><div class="r-stats">${stat(r.score.toLocaleString(), 'Score')}${stat(r.kills, 'Kills')}${stat(r.deaths, 'Deaths')}${stat(kd, 'K/D')}${stat(r.captures, 'Posts taken')}${stat(r.best, 'Best streak')}</div>
            <div class="r-mini">${[['Cover destroyed', L.coverBroken], ['Suppressions', L.suppressions], ['Vaults', L.vaults], ['Rams', L.rams], ['Mine hits', L.mineHits], ['Repairs', L.repairs]].filter(x => x[1]).map(([l, v]) => `<span>${l} <b>${v}</b></span>`).join('') || '<span class="dim">No ground statistics</span>'}</div></section>
          <section class="r-dom"><h4>AIR</h4><div class="r-stats two">${stat(fl(team), 'Our aircraft left')}${stat(fl(en), 'Enemy aircraft left')}</div><div class="r-mini"><span class="dim">Aircraft still flying at the end of the battle</span></div></section>
          <section class="r-dom"><h4>SPACE</h4><div class="r-ships">${rep.map(ship).join('') || '<span class="dim">No capital ships took part</span>'}</div>${erep.length ? `<div class="r-sub2">ENEMY FLEET</div><div class="r-ships">${erep.map(ship).join('')}</div>` : ''}</section>
        </div>
        <div class="r-bars"><span class="${team}">${r.tickets}</span><i>reinforcements remaining</i><span class="${en}">${r.enemyTickets}</span></div>
        <div class="r-awards">${awards.map(a => `<span>${a}</span>`).join('')}</div>
        <div class="r-extra"></div>
        <button class="gc-btn primary r-go">Continue</button>
      </div>`);
    const go = this.$.layer.querySelector('.r-go'); go.addEventListener('click', () => { if (g.onContinue) g.onContinue(r); }); go.focus();
  };
  P.resultsExtra = function (html) { const e = this.$ && this.$.layer.querySelector('.r-extra'); if (e) e.innerHTML = html; };
})(window.E = window.E || {});
