// Front end: main menu (over a live "attract" battle), instant action, the
// galactic campaign map, codex and settings. UI only (browser). The menu owns
// a #menu layer inside #ui; battles are launched through this.onStart.
(function (E) {
  'use strict';
  const LS_KEY = 'gc.campaign.v2', LS_SET = 'gc.settings.v2', LS_PRO = 'gc.profile.v1', LS_HIST = 'gc.camp.hist.v1';
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const store = { get(k, d) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const planetStyle = (b) => { const p = E.biome(b).palette, S = E.SKY[b] || {}; return `background: radial-gradient(circle at 32% 30%, ${css(E.mixC(p.high, [255, 255, 255], 0.25))}, ${css(p.mid)} 45%, ${css(E.mixC(p.low, [0, 0, 0], 0.55))} 100%); box-shadow: inset -6px -8px 14px rgba(0,0,0,.55), 0 0 18px ${S.fog || '#456'}55;`; };

  class Menu {
    constructor(root) {
      this.root = root;
      this.settings = E.SettingsUI.ensure(Object.assign({ faction: 'aegis', quality: 'auto', sens: 1, volume: 0.8, invertY: false, difficulty: 'normal', name: 'Commander', reduceMotion: false, uiScale: 1 }, store.get(LS_SET, {})));
      E.SettingsUI.apply(this.settings);
      this.profile = Object.assign({ xp: 0, battles: 0, wins: 0, kills: 0 }, store.get(LS_PRO, {}));
      const c = store.get(LS_KEY, null); this.campaign = c && c.v === E.Campaign.VERSION ? c : null;
      this.onStart = null; this.el = null; this.sel = -1;
      E.bus.on('settings:changed', () => this.saveSettings());
    }
    saveSettings() { store.set(LS_SET, this.settings); }
    // apply an imported save envelope back onto the live menu + storage
    applyImported(d) {
      const base = { faction: 'aegis', quality: 'auto', sens: 1, volume: 0.8, invertY: false, difficulty: 'normal', name: 'Commander', reduceMotion: false, uiScale: 1 };
      this.settings = E.SettingsUI.ensure(Object.assign(base, d.settings || {}));
      E.SettingsUI.apply(this.settings);
      this.profile = Object.assign({ xp: 0, battles: 0, wins: 0, kills: 0 }, d.profile || {});
      const c = d.campaign; this.campaign = c && c.v === E.Campaign.VERSION ? c : null;
      this.saveSettings(); this.saveProfile(); this.saveCampaign();
      this.showSettings();
    }
    saveCampaign() { if (this.campaign) store.set(LS_KEY, this.campaign); else { try { localStorage.removeItem(LS_KEY); } catch (e) {} } }
    saveProfile() { store.set(LS_PRO, this.profile); }
    hide() { if (this.el) { this.el.remove(); this.el = null; } }
    layer(html, cls) {
      this.hide();
      const el = document.createElement('div'); el.className = 'menu ' + (cls || ''); el.innerHTML = html;
      this.root.appendChild(el); this.el = el;
      el.querySelectorAll('button').forEach(b => b.addEventListener('mouseenter', () => { if (E.SFX && E.Music.on) E.SFX.play('hover'); }));
      el.addEventListener('keydown', (e) => {
        if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
        const nav = e.target.closest && e.target.closest('.m-nav, .m-facs, .m-biomes, .seg');
        if (nav && /^Arrow/.test(e.key)) { const bs = [...nav.querySelectorAll('button')], i = bs.indexOf(document.activeElement), d = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : (e.key === 'ArrowUp' || e.key === 'ArrowLeft') ? -1 : 0; if (d && bs.length) { e.preventDefault(); bs[(i + d + bs.length) % bs.length].focus(); if (E.SFX && E.Music.on) E.SFX.play('hover'); } }
        else if (e.key === 'Escape') { const b = el.querySelector('.m-back'); if (b) { e.preventDefault(); b.click(); } }
      });
      if (!cls || cls.indexOf('g-root') < 0) { const f = el.querySelector('.m-item, .m-fac.on, .gc-btn.primary, button'); if (f) setTimeout(() => f.focus({ preventScroll: true }), 30); }
      return el;
    }
    q(s) { return this.el.querySelector(s); }
    on(s, fn) { const e = this.el.querySelector(s); if (e) e.addEventListener('click', fn); }

    // ── main ───────────────────────────────────────────────────
    show() {
      if (E.Music && E.Music.on) E.Music.setMode('battle');
      const c = this.campaign, rk = E.Campaign.rank(this.profile.xp);
      this.layer(`
        <div class="m-main">
          <div class="m-logo"><span>GALACTIC</span><b>CONQUEST</b><i>land · air · space</i></div>
          <nav class="m-nav">
            <button class="m-item" data-a="campaign"><b>${c && !c.victory ? 'Continue Campaign' : 'Galactic Campaign'}</b><span>${c && !c.victory ? `Turn ${c.turn} · ${E.Campaign.owned(c, c.playerFaction)} of 10 worlds · ${c.fleets.filter(f => f.owner === c.playerFaction).length} fleets` : 'Fleets, supply lines and ten worlds to take'}</span></button>
            <button class="m-item" data-a="instant"><b>Instant Action</b><span>Any world, any side, right now</span></button>
            <button class="m-item" data-a="mp"><b>Multiplayer</b><span>Host or join over LAN / online</span></button>
            <button class="m-item" data-a="codex"><b>Codex</b><span>Factions, units and how to fight</span></button>
            <button class="m-item" data-a="controls"><b>Controls</b><span>Every binding, for every unit</span></button>
            <button class="m-item" data-a="settings"><b>Settings</b><span>Graphics, audio mix, accessibility</span></button>
          </nav>
          <div class="m-career"><div><b>${esc(this.settings.name)}</b> · ${rk.name}</div><div class="bar"><i style="width:${(rk.prog * 100).toFixed(0)}%"></i></div><span>${this.profile.xp.toLocaleString()} XP · ${this.profile.wins}/${this.profile.battles} victories · ${this.profile.kills} kills</span></div>
        </div>
        <div class="m-foot">Everything you see and hear is generated from code.</div>`, 'm-root');
      this.el.querySelectorAll('.m-item').forEach(b => b.addEventListener('click', () => { const a = b.dataset.a; if (a === 'campaign') this.showCampaign(); else if (a === 'instant') this.showInstant(); else if (a === 'mp') this.showMultiplayer(); else if (a === 'codex') this.showCodex(); else if (a === 'controls') this.showControls(); else this.showSettings(); }));
    }

    factionCards(sel) {
      return E.FACTION_LIST.map(f => `<button class="m-fac ${f.id}${f.id === sel ? ' on' : ''}" data-fac="${f.id}" aria-pressed="${f.id === sel}"><b><i class="fg">${f.id === 'aegis' ? '■' : '●'}</i> ${f.name}</b><em>${f.tagline}</em><p>${f.doctrine.summary}</p></button>`).join('');
    }
    diffSeg(sel) { return `<div class="seg m-diff">${['easy', 'normal', 'hard'].map(d => `<button data-d="${d}" class="${d === sel ? 'on' : ''}">${d === 'easy' ? 'Recruit' : d === 'normal' ? 'Veteran' : 'Warlord'}</button>`).join('')}</div>`; }
    bindCommon() {
      const s = this.settings;
      this.el.querySelectorAll('.m-fac').forEach(b => b.addEventListener('click', () => { s.faction = b.dataset.fac; this.saveSettings(); this.el.querySelectorAll('.m-fac').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); if (E.SFX) E.SFX.play('select'); }));
      this.el.querySelectorAll('.m-diff button').forEach(b => b.addEventListener('click', () => { s.difficulty = b.dataset.d; this.saveSettings(); this.el.querySelectorAll('.m-diff button').forEach(x => x.classList.toggle('on', x === b)); }));
      this.on('.m-back', () => this.show());
    }

    // ── instant action ─────────────────────────────────────────
    showInstant() {
      const s = this.settings; this.biome = this.biome || 'desert';
      this.layer(`
        <div class="m-panel wide">
          <div class="m-h"><button class="m-back">‹ Back</button><h1>Instant Action</h1></div>
          <div class="m-sec">Fight for</div><div class="m-facs">${this.factionCards(s.faction)}</div>
          <div class="m-sec">Battlefield</div>
          <div class="m-biomes">${E.BIOME_LIST.map(b => `<button class="m-biome${b.id === this.biome ? ' on' : ''}" data-b="${b.id}"><i style="${planetStyle(b.id)}"></i><b>${b.name}</b><em>${b.theme} · ${b.challenge.name}</em></button>`).join('')}</div>
          <div class="m-row"><div><div class="m-sec">Difficulty</div>${this.diffSeg(s.difficulty)}</div>
            <div><div class="m-sec">Fleets</div><div class="seg m-fleet">${[['1', 'Skirmish'], ['1.4', 'Battle'], ['1.8', 'Armada']].map(([v, n]) => `<button data-v="${v}" class="${(this.fleet || '1') === v ? 'on' : ''}">${n}</button>`).join('')}</div></div>
            <button class="gc-btn primary m-go">Launch Battle</button></div>
        </div>`);
      this.bindCommon();
      this.el.querySelectorAll('.m-biome').forEach(b => b.addEventListener('click', () => { this.biome = b.dataset.b; this.el.querySelectorAll('.m-biome').forEach(x => x.classList.toggle('on', x === b)); }));
      this.el.querySelectorAll('.m-fleet button').forEach(b => b.addEventListener('click', () => { this.fleet = b.dataset.v; this.el.querySelectorAll('.m-fleet button').forEach(x => x.classList.toggle('on', x === b)); }));
      this.on('.m-go', () => this.onStart(E.Campaign.quickBattle({ biome: this.biome, human: s.faction, seed: (Math.random() * 1e9) | 0, fleetScale: +(this.fleet || 1), enemyScale: +(this.fleet || 1), difficulty: s.difficulty }), null));
    }

    // ── campaign ───────────────────────────────────────────────
    showCampaign() {
      if (!this.campaign || this.campaign.victory) return this.showNewCampaign();
      if (E.Music && E.Music.on) E.Music.setMode('map');
      this.galaxy = new E.Galaxy(this); this.galaxy.show();
    }
    warHistory(c) { const all = store.get(LS_HIST, {}); return all[c.seed] || []; }
    saveHistory(c, h) { const all = store.get(LS_HIST, {}); all[c.seed] = h.slice(-60); store.set(LS_HIST, all); }
    showNewCampaign() {
      const s = this.settings, old = this.campaign && this.campaign.victory ? this.campaign : null;
      this.layer(`
        <div class="m-panel">
          <div class="m-h"><button class="m-back">‹ Back</button><h1>New Campaign</h1></div>
          ${old ? `<div class="g-end ${old.victory === old.playerFaction ? 'good' : 'bad'}">${old.victory === old.playerFaction ? 'THE GALAXY IS YOURS' : 'YOUR HOME SYSTEM HAS FALLEN'}<span>${old.wins} victories in ${old.battles} battles over ${old.turn} turns</span></div>` : ''}
          <p class="m-lead">Ten worlds lie between two capitals. Command fleets on the holotable: each carries capital ships, a fighter wing and an army, and that is exactly what you take into battle. Supplied worlds pay credits and fuel and lend their perks. Take the enemy home system to end the war.</p>
          <div class="m-sec">Your faction</div><div class="m-facs">${this.factionCards(s.faction)}</div>
          <div class="m-row"><div><div class="m-sec">Difficulty</div>${this.diffSeg(s.difficulty)}</div><button class="gc-btn primary m-go">Begin the War</button></div>
        </div>`);
      this.bindCommon();
      this.on('.m-go', () => { this.campaign = E.Campaign.newCampaign({ seed: (Math.random() * 1e9) | 0, playerFaction: s.faction, difficulty: s.difficulty }); this.sel = -1; this.saveCampaign(); if (E.SFX) E.SFX.play('confirm'); this.showCampaign(); });
    }
    // called after a campaign battle (played or auto-resolved): back to the map; the turn is the player's to end
    afterBattle(res, summary) {
      const c = this.campaign; if (!c) return this.show();
      this.saveCampaign();
      if (summary) this.lastReport = summary;
      this.showCampaign();
    }

    // ── multiplayer / codex / settings ─────────────────────────
    showMultiplayer() {
      this.layer(`<div class="m-panel"><div class="m-h"><button class="m-back">‹ Back</button><h1>Multiplayer</h1></div><div class="mp-body"></div></div>`);
      this.bindCommon();
      if (E.Lobby) E.Lobby.mount(this.q('.mp-body'), this); else this.q('.mp-body').textContent = 'Multiplayer needs the game to be served by the Galactic Conquest server (npm start).';
    }
    showCodex() {
      const stat = (k, v) => `<span><i>${k}</i>${v}</span>`;
      const unit = (d, kind) => { const W = E.WEAPONS[d.weapon], A = d.alt && E.WEAPONS[d.alt]; return `<div class="c-unit"><b>${d.name}</b><em>${kind}</em><p>${d.desc || ''}</p><div class="c-stats">${stat('Hull', d.hp)}${d.shield ? stat('Shield', d.shield) : ''}${stat('Speed', d.speed)}${W ? stat('Weapon', W.name) : ''}${A ? stat('Ability', A.name) : ''}</div></div>`; };
      this.layer(`
        <div class="m-panel wide scroll">
          <div class="m-h"><button class="m-back">‹ Back</button><h1>Codex</h1></div>
          <div class="m-sec">How a battle is won</div>
          <p class="m-lead">Each side has a pool of <b>reinforcements</b>. Every death spends one; holding more <b>command posts</b> than the enemy drains theirs. Stand inside a post's ring to capture it. Destroying the enemy <b>capital ship</b> costs them 25 at a stroke. Run them out and the world is yours.</p>
          <p class="m-lead">You are never stuck in one body: press <b>F</b> while aiming at any friendly soldier, tank, fighter or the flagship itself to take control of it. Press <b>M</b> for the command view to order your army around the map.</p>
          <div class="m-sec">Factions</div>
          <div class="c-facs">${E.FACTION_LIST.map(f => `<div class="c-fac ${f.id}"><b>${f.name}</b><em>${f.tagline}</em><p>${f.culture.desc}</p><p class="dim">${f.culture.values}</p></div>`).join('')}</div>
          <div class="m-sec">Infantry</div><div class="c-grid">${Object.values(E.INFANTRY).map(d => unit(d, 'Infantry')).join('')}</div>
          <div class="m-sec">Armor</div><div class="c-grid">${Object.values(E.VEHICLES).map(d => unit(d, 'Hover vehicle')).join('')}</div>
          <div class="m-sec">Starfighters</div><div class="c-grid">${Object.values(E.FIGHTERS).map(d => unit(d, 'Starfighter')).join('')}</div>
          <div class="m-sec">Capital ships</div><div class="c-grid">${Object.values(E.CAPITALS).map(d => `<div class="c-unit"><b>${d.name}</b><em>Capital ship · ${d.len} m</em><p>${d.desc}</p><div class="c-stats">${stat('Hull', d.hp)}${stat('Shield', d.shield)}${stat('Batteries', d.main + ' + ' + d.side * 2)}</div></div>`).join('')}</div>
          <div class="m-sec">Worlds</div><div class="c-grid">${E.BIOME_LIST.map(b => `<div class="c-unit"><b>${b.name}</b><em>${b.theme} · ${b.challenge.name}</em><p>${b.desc}</p></div>`).join('')}</div>
        </div>`);
      this.bindCommon();
    }
    showSettings() {
      const s = this.settings;
      this.layer(`
        <div class="m-panel">
          <div class="m-h"><button class="m-back">‹ Back</button><h1>Settings</h1></div>
          <div class="st-grid"><label>Callsign<input type="text" class="s-name" maxlength="16" value="${esc(s.name)}"></label></div>
          <div class="st-set"></div>
          <div class="m-row"><button class="gc-btn s-how">How to play</button><button class="gc-btn s-ctl">View all controls</button><button class="gc-btn s-exp">Export save</button><button class="gc-btn s-imp">Import save</button><button class="gc-btn s-reset">Reset career &amp; campaign</button></div>
        </div>`);
      this.bindCommon();
      this.q('.st-set').innerHTML = E.SettingsUI.html(s); E.SettingsUI.bind(this.q('.st-set'), s, window.GC && window.GC.game);
      this.q('.s-name').addEventListener('input', (e) => { s.name = e.target.value.trim() || 'Commander'; this.saveSettings(); });
      this.on('.s-how', () => { if (E.Onboarding) E.Onboarding.show(); });
      this.on('.s-ctl', () => this.showControls('settings'));
      this.on('.s-exp', () => { if (E.Save) E.Save.download(); });
      this.on('.s-imp', () => { if (E.Save) E.Save.pick((d, err) => { if (err || !d) return alert((err && err.message) || 'Could not read that save.'); this.applyImported(d); }); });
      this.on('.s-reset', () => { if (confirm('Erase your career and campaign?')) { this.profile = { xp: 0, battles: 0, wins: 0, kills: 0 }; this.campaign = null; this.saveProfile(); this.saveCampaign(); this.show(); } });
    }
    showControls(from) {
      this.layer(`<div class="m-panel wide scroll"><div class="m-h"><button class="m-back">‹ Back</button><h1>Controls</h1></div><p class="m-lead">The same table drives the hint bar in battle. Bindings are fixed; they change with what you are controlling. Press <b>F1</b> in a battle for this screen.</p>${E.ControlsUI.html('infantry')}</div>`);
      this.bindCommon(); E.ControlsUI.bind(this.el);
      if (from === 'settings') { const b = this.q('.m-back'), n = b.cloneNode(true); b.replaceWith(n); n.addEventListener('click', () => this.showSettings()); }
    }
  }

  E.Menu = Menu;
  E.LS_KEY = LS_KEY;
})(window.E = window.E || {});
