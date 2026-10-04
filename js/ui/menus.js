// Front end: main menu (over a live "attract" battle), instant action, the
// galactic campaign map, codex and settings. UI only (browser). The menu owns
// a #menu layer inside #ui; battles are launched through this.onStart.
(function (E) {
  'use strict';
  const LS_KEY = 'gc.campaign.v2', LS_SET = 'gc.settings.v2', LS_PRO = 'gc.profile.v1';
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const store = { get(k, d) { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
  const planetStyle = (b) => { const p = E.biome(b).palette, S = E.SKY[b] || {}; return `background: radial-gradient(circle at 32% 30%, ${css(E.mixC(p.high, [255, 255, 255], 0.25))}, ${css(p.mid)} 45%, ${css(E.mixC(p.low, [0, 0, 0], 0.55))} 100%); box-shadow: inset -6px -8px 14px rgba(0,0,0,.55), 0 0 18px ${S.fog || '#456'}55;`; };

  class Menu {
    constructor(root) {
      this.root = root;
      this.settings = Object.assign({ faction: 'aegis', quality: 'auto', sens: 1, volume: 0.8, invertY: false, difficulty: 'normal', name: 'Commander' }, store.get(LS_SET, {}));
      this.profile = Object.assign({ xp: 0, battles: 0, wins: 0, kills: 0 }, store.get(LS_PRO, {}));
      const c = store.get(LS_KEY, null); this.campaign = c && c.v === 2 ? c : null;
      this.onStart = null; this.el = null; this.sel = -1;
      E.bus.on('settings:changed', () => this.saveSettings());
    }
    saveSettings() { store.set(LS_SET, this.settings); }
    saveCampaign() { if (this.campaign) store.set(LS_KEY, this.campaign); else { try { localStorage.removeItem(LS_KEY); } catch (e) {} } }
    saveProfile() { store.set(LS_PRO, this.profile); }
    hide() { if (this.el) { this.el.remove(); this.el = null; } }
    layer(html, cls) {
      this.hide();
      const el = document.createElement('div'); el.className = 'menu ' + (cls || ''); el.innerHTML = html;
      this.root.appendChild(el); this.el = el;
      el.querySelectorAll('button').forEach(b => b.addEventListener('mouseenter', () => { if (E.SFX && E.Music.on) E.SFX.play('ui', null, 0.15); }));
      return el;
    }
    q(s) { return this.el.querySelector(s); }
    on(s, fn) { const e = this.el.querySelector(s); if (e) e.addEventListener('click', fn); }

    // ── main ───────────────────────────────────────────────────
    show() {
      const c = this.campaign, rk = E.Campaign.rank(this.profile.xp);
      this.layer(`
        <div class="m-main">
          <div class="m-logo"><span>GALACTIC</span><b>CONQUEST</b><i>land · air · space</i></div>
          <nav class="m-nav">
            <button class="m-item" data-a="campaign"><b>${c && !c.victory ? 'Continue Campaign' : 'Galactic Campaign'}</b><span>${c && !c.victory ? `Turn ${c.turn} · ${E.Campaign.owned(c, c.playerFaction)} of 10 worlds` : 'Conquer ten worlds, one battle at a time'}</span></button>
            <button class="m-item" data-a="instant"><b>Instant Action</b><span>Any world, any side, right now</span></button>
            <button class="m-item" data-a="mp"><b>Multiplayer</b><span>Host or join over LAN / online</span></button>
            <button class="m-item" data-a="codex"><b>Codex</b><span>Factions, units and how to fight</span></button>
            <button class="m-item" data-a="settings"><b>Settings</b><span>Graphics, controls, audio</span></button>
          </nav>
          <div class="m-career"><div><b>${esc(this.settings.name)}</b> · ${rk.name}</div><div class="bar"><i style="width:${(rk.prog * 100).toFixed(0)}%"></i></div><span>${this.profile.xp.toLocaleString()} XP · ${this.profile.wins}/${this.profile.battles} victories · ${this.profile.kills} kills</span></div>
        </div>
        <div class="m-foot">Everything you see and hear is generated from code.</div>`, 'm-root');
      this.el.querySelectorAll('.m-item').forEach(b => b.addEventListener('click', () => { const a = b.dataset.a; if (a === 'campaign') this.showCampaign(); else if (a === 'instant') this.showInstant(); else if (a === 'mp') this.showMultiplayer(); else if (a === 'codex') this.showCodex(); else this.showSettings(); }));
    }

    factionCards(sel) {
      return E.FACTION_LIST.map(f => `<button class="m-fac ${f.id}${f.id === sel ? ' on' : ''}" data-fac="${f.id}"><b>${f.name}</b><em>${f.tagline}</em><p>${f.doctrine.summary}</p></button>`).join('');
    }
    diffSeg(sel) { return `<div class="seg m-diff">${['easy', 'normal', 'hard'].map(d => `<button data-d="${d}" class="${d === sel ? 'on' : ''}">${d === 'easy' ? 'Recruit' : d === 'normal' ? 'Veteran' : 'Warlord'}</button>`).join('')}</div>`; }
    bindCommon() {
      const s = this.settings;
      this.el.querySelectorAll('.m-fac').forEach(b => b.addEventListener('click', () => { s.faction = b.dataset.fac; this.saveSettings(); this.el.querySelectorAll('.m-fac').forEach(x => x.classList.toggle('on', x === b)); }));
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
      const c = this.campaign, C = E.Campaign, pf = c.playerFaction, ef = c.enemyFaction;
      const targets = C.attackable(c, pf);
      if (!targets.includes(this.sel)) this.sel = targets[0] !== undefined ? targets[0] : 0;
      const links = c.links.map(([a, b]) => { const A = c.planets[a], B = c.planets[b]; const hot = (A.owner === pf) !== (B.owner === pf); return `<line x1="${A.x * 100}" y1="${A.y * 100}" x2="${B.x * 100}" y2="${B.y * 100}" class="${hot ? 'hot' : ''}"/>`; }).join('');
      const nodes = c.planets.map(p => `<button class="g-planet ${p.owner || 'free'}${targets.includes(p.id) ? ' target' : ''}${p.id === this.sel ? ' on' : ''}${c.pending && c.pending.planet === p.id ? ' siege' : ''}" data-p="${p.id}" style="left:${p.x * 100}%;top:${p.y * 100}%">
          <i style="${planetStyle(p.biome)}width:${p.home ? 54 : 38}px;height:${p.home ? 54 : 38}px"></i><b>${esc(p.name)}</b><em>${p.home ? 'Home system' : E.biome(p.biome).theme}</em></button>`).join('');
      const up = Object.entries(C.UPGRADES).map(([k, U]) => { const lv = c.upgrades[pf][k], max = lv >= U.levels.length - 1; return `<button class="g-up" data-u="${k}" ${max || c.credits[pf] < U.cost[lv + 1] ? 'disabled' : ''}><b>${U.name}: ${U.levels[lv]}</b><em>${max ? 'Maximum' : `→ ${U.levels[lv + 1]} · ${U.cost[lv + 1]} cr`}</em></button>`; }).join('');
      const pk = Object.keys(C.perks(c, pf)).map(k => `<span title="${C.PERKS[k].desc}">${C.PERKS[k].name}</span>`).join('') || '<span class="dim">No planetary perks yet</span>';
      this.layer(`
        <div class="g-wrap">
          <div class="g-map"><svg viewBox="0 0 100 100" preserveAspectRatio="none">${links}</svg>${nodes}</div>
          <aside class="g-side">
            <div class="m-h"><button class="m-back">‹ Menu</button><h1>Galactic Campaign</h1></div>
            <div class="g-stat"><div><b>${c.turn}</b><span>Turn</span></div><div><b>${c.credits[pf]}</b><span>Credits (+${C.income(c, pf)})</span></div><div><b class="${pf}">${C.owned(c, pf)}</b><span>Yours</span></div><div><b class="${ef}">${C.owned(c, ef)}</b><span>Theirs</span></div></div>
            <div class="g-info"></div>
            <div class="m-sec">Fleet</div><div class="g-ups">${up}</div>
            <div class="m-sec">Planetary perks</div><div class="g-perks">${pk}</div>
            <div class="m-sec">War log</div><div class="g-log">${c.log.slice(0, 5).map(l => `<div class="${l.good ? 'good' : 'bad'}">T${l.turn} · ${esc(l.text)}</div>`).join('') || '<div class="dim">The war begins.</div>'}</div>
            <button class="gc-btn g-new">Abandon campaign</button>
          </aside>
          ${c.pending ? `<div class="g-modal"><div class="p-card"><div class="p-title bad">UNDER ATTACK</div><p>${E.faction(ef).name} is assaulting <b>${esc(c.planets[c.pending.planet].name)}</b>. Take command of the defence, or leave it to the garrison.</p>
            <button class="gc-btn primary g-defend">Defend in person</button><button class="gc-btn g-auto">Auto-resolve</button></div></div>` : ''}
        </div>`, 'g-root');
      this.bindCommon();
      const info = () => {
        const p = c.planets[this.sel], b = E.biome(p.biome), can = targets.includes(p.id);
        this.q('.g-info').innerHTML = `<div class="g-pname ${p.owner || 'free'}">${esc(p.name)}<span>${p.owner ? E.faction(p.owner).short : 'Unclaimed'}</span></div>
          <div class="g-pdesc">${b.desc}</div>
          <div class="g-kv"><span>Hazard</span><b>${b.challenge.name}</b></div><div class="g-kv"><span>Income</span><b>${p.value + (p.perk === 'trade' ? 60 : 0)} cr / turn</b></div>
          ${p.perk ? `<div class="g-kv"><span>Perk</span><b>${C.PERKS[p.perk].name}</b></div><div class="g-pdesc dim">${C.PERKS[p.perk].desc}</div>` : '<div class="g-kv"><span>Capital</span><b>Take it to win the war</b></div>'}
          <button class="gc-btn primary g-attack" ${can && !c.pending ? '' : 'disabled'}>${can ? 'Assault ' + esc(p.name) : p.owner === pf ? 'Held by you' : 'Out of reach'}</button>`;
        this.on('.g-attack', () => this.onStart(C.matchOptions(c, p.id, false), { campaign: c, planet: p.id, defending: false }));
      };
      this.el.querySelectorAll('.g-planet').forEach(b => b.addEventListener('click', () => { this.sel = +b.dataset.p; this.el.querySelectorAll('.g-planet').forEach(x => x.classList.toggle('on', x === b)); info(); }));
      this.el.querySelectorAll('.g-up').forEach(b => b.addEventListener('click', () => { if (C.buy(c, b.dataset.u)) { this.saveCampaign(); this.showCampaign(); } }));
      this.on('.g-new', () => { if (confirm('Abandon this campaign?')) { this.campaign = null; this.saveCampaign(); this.showNewCampaign(); } });
      this.on('.g-defend', () => this.onStart(C.matchOptions(c, c.pending.planet, true), { campaign: c, planet: c.pending.planet, defending: true }));
      this.on('.g-auto', () => { const r = C.autoResolve(c, c.pending.planet); this.saveCampaign(); this.afterBattle(r); });
      info();
    }
    showNewCampaign() {
      const s = this.settings, old = this.campaign && this.campaign.victory ? this.campaign : null;
      this.layer(`
        <div class="m-panel">
          <div class="m-h"><button class="m-back">‹ Back</button><h1>New Campaign</h1></div>
          ${old ? `<div class="g-end ${old.victory === old.playerFaction ? 'good' : 'bad'}">${old.victory === old.playerFaction ? 'THE GALAXY IS YOURS' : 'YOUR HOME SYSTEM HAS FALLEN'}<span>${old.wins} victories in ${old.battles} battles over ${old.turn} turns</span></div>` : ''}
          <p class="m-lead">Ten worlds lie between two capitals. Take the enemy home system to end the war. Each world you hold pays credits and lends a perk to every battle.</p>
          <div class="m-sec">Your faction</div><div class="m-facs">${this.factionCards(s.faction)}</div>
          <div class="m-row"><div><div class="m-sec">Difficulty</div>${this.diffSeg(s.difficulty)}</div><button class="gc-btn primary m-go">Begin the War</button></div>
        </div>`);
      this.bindCommon();
      this.on('.m-go', () => { this.campaign = E.Campaign.newCampaign({ seed: (Math.random() * 1e9) | 0, playerFaction: s.faction, difficulty: s.difficulty }); this.sel = -1; this.saveCampaign(); this.showCampaign(); });
    }
    // called after a campaign battle (played or auto-resolved): run the enemy's turn
    afterBattle(res) {
      const c = this.campaign; if (!c) return this.show();
      if (!c.victory && !res.defending) E.Campaign.enemyTurn(c);
      this.saveCampaign();
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
          <div class="p-set">
            <label>Callsign<input type="text" class="s-name" maxlength="16" value="${esc(s.name)}"></label>
            <label>Graphics<select class="s-q">${['auto', 'high', 'medium', 'low'].map(q => `<option value="${q}"${s.quality === q ? ' selected' : ''}>${q[0].toUpperCase() + q.slice(1)}</option>`).join('')}</select></label>
            <label>Mouse sensitivity<input type="range" class="s-sens" min="0.3" max="2.5" step="0.05" value="${s.sens}"></label>
            <label>Volume<input type="range" class="s-vol" min="0" max="1" step="0.05" value="${s.volume}"></label>
            <label class="chk"><input type="checkbox" class="s-inv"${s.invertY ? ' checked' : ''}> Invert Y</label>
          </div>
          <div class="p-keys"><b>WASD</b> move · <b>Mouse</b> aim · <b>LMB</b> fire · <b>RMB</b> zoom · <b>G</b> ability · <b>Shift</b> sprint / boost · <b>Space</b> jump<br><b>F</b> take control of the friendly you aim at · <b>Z / X / V</b> squad follow / move / dismiss<br><b>M</b> command view · <b>Tab</b> scoreboard · <b>Esc</b> pause</div>
          <button class="gc-btn s-reset">Reset career &amp; campaign</button>
        </div>`);
      this.bindCommon();
      const g = window.GC && window.GC.game;
      this.q('.s-name').addEventListener('input', (e) => { s.name = e.target.value.trim() || 'Commander'; this.saveSettings(); });
      this.q('.s-q').addEventListener('change', (e) => { s.quality = e.target.value; this.saveSettings(); if (g) g.renderer.scene.setQuality(s.quality); });
      this.q('.s-sens').addEventListener('input', (e) => { s.sens = +e.target.value; this.saveSettings(); });
      this.q('.s-vol').addEventListener('input', (e) => { s.volume = +e.target.value; this.saveSettings(); if (E.Music) E.Music.setVolume(s.volume); });
      this.q('.s-inv').addEventListener('change', (e) => { s.invertY = e.target.checked; this.saveSettings(); });
      this.on('.s-reset', () => { if (confirm('Erase your career and campaign?')) { this.profile = { xp: 0, battles: 0, wins: 0, kills: 0 }; this.campaign = null; this.saveProfile(); this.saveCampaign(); this.show(); } });
    }
  }

  E.Menu = Menu;
  E.LS_KEY = LS_KEY;
})(window.E = window.E || {});
