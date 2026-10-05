// The galaxy map: a war-room holotable over E.Campaign.
//   Map      worlds (owner, supply, blockade, garrison, trait, recent capture), hyperlanes (supply flowing or cut,
//            the front line), fleets as selectable pieces with ships / wing / army / damage, fog of war.
//   Moves    select a fleet: reachable worlds light up (free redeploy / one jump beyond); a target opens the
//            forecast (odds + space/air/land comparison); then Assault or Blockade.
//   Spend    Build (ships, legion, squadron, fortify, refit), Ops (recon, sabotage, incite), Upgrades, Log.
//   Turn     End Turn plays back the enemy's moves (income, fleet movement, captures, alerts), then hands you
//            the defence decision if the enemy attacked.
// Keyboard: arrows/Tab move between worlds, Enter selects, F next fleet, 1-5 tabs, E end turn, Esc deselect.
(function (E) {
  'use strict';
  const C = E.Campaign;
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const VW = 1600, VH = 900, MX = 130, MY = 100;
  const OWN = { aegis: '#ff6a3a', verdant: '#3df0b0', free: '#9aa8c0' };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const TRAIT = { shipyard: 'M-7 5 L-9 -1 L-3 -1 L-3 -6 L3 -6 L3 -1 L9 -1 L7 5 Z', refinery: 'M0 -8 C5 -1 7 2 7 4 A7 7 0 0 1 -7 4 C-7 2 -5 -1 0 -8 Z', fortress: 'M-8 7 L-8 -3 L-5 -3 L-5 -6 L-2 -6 L-2 -3 L2 -3 L2 -6 L5 -6 L5 -3 L8 -3 L8 7 Z' };
  const SHIP_ABBR = { frigate: 'FR', cruiser: 'CR', carrier: 'CV', dreadnought: 'DN' };
  const TABS = [['world', 'World'], ['build', 'Build'], ['ops', 'Ops'], ['up', 'Upgrades'], ['log', 'War log']];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const ENDING = /(captured|surrenders|occupies|falls|Lost |breaks away|Held )/i;

  class Galaxy {
    constructor(menu) {
      this.menu = menu; this.c = menu.campaign; this.gs = { fleet: 0, planet: -1, target: -1, tab: 'world', msg: '' };
      this.speed = window.GC_PB_SPEED != null ? window.GC_PB_SPEED : 1; this.busy = false; this.view = null;
    }
    get pf() { return this.c.playerFaction; }
    get ef() { return this.c.enemyFaction; }
    xy(p) { return [MX + p.x * (VW - 2 * MX), MY + p.y * (VH - 2 * MY) * 1.0]; }
    save() { this.menu.saveCampaign(); }
    hist() { const h = this.menu.warHistory(this.c); return h; }

    // ── mount ──
    show() {
      const m = this.menu, c = this.c;
      m.layer(`<div class="g-wrap" tabindex="-1">
        <header class="g-bar"></header>
        <div class="g-stage"><svg class="g-svg" viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="xMidYMid meet" role="application" aria-label="Galaxy map"></svg><div class="g-hint"></div></div>
        <aside class="g-side"></aside>
        <div class="g-fc"></div>
        <div class="g-toast" role="status" aria-live="polite"></div>
        <div class="g-pb"></div>
        <div class="g-modal"></div>
      </div>`, 'g-root');
      this.root = m.el; this.$ = (s) => this.root.querySelector(s);
      this.bindEvents();
      this.recordHistory();
      // pick a sensible start: first unmoved fleet
      const f = C.fleetsOf(c, this.pf).find(x => !x.moved) || C.fleetsOf(c, this.pf)[0];
      if (f) { this.gs.fleet = f.id; this.gs.planet = f.at; }
      this.render();
      if (c.pending) this.showAttack(null);
      else if (m.lastReport) { this.say(m.lastReport); m.lastReport = null; }
      this.root.querySelector('.g-wrap').focus({ preventScroll: true });
    }
    recordHistory() { const h = this.hist(), c = this.c; const last = h[h.length - 1]; const row = { t: c.turn, a: C.owned(c, this.pf), b: C.owned(c, this.ef), cr: c.credits[this.pf] }; if (last && last.t === c.turn) h[h.length - 1] = row; else h.push(row); this.menu.saveHistory(c, h); }
    say(text, cls) { const t = this.$('.g-toast'); if (!t) return; t.textContent = text; t.className = 'g-toast show ' + (cls || ''); clearTimeout(this._tt); this._tt = setTimeout(() => t.classList.remove('show'), 4200); }

    // ── data helpers ──
    sum() { return C.summary(this.c, this.pf); }
    fleetOf(id) { return C.fleet(this.c, id); }
    selFleet() { const f = this.gs.fleet ? this.fleetOf(this.gs.fleet) : null; return f && f.owner === this.pf ? f : null; }
    try(fn) { const t = clone(this.c); return fn(t, C); }   // dry-run any campaign call on a copy: exact reasons without side effects
    recent(p) { const c = this.c; return c.log.some(l => l.turn >= c.turn - 1 && l.text.indexOf(p.name) >= 0 && ENDING.test(l.text)); }
    // the strength of a fleet, text
    shipChip(s) { return `<span class="sc" title="${C.SHIPS[s.type].name} ${Math.round(s.hp * 100)}%"><b>${SHIP_ABBR[s.type]}</b><i style="--h:${Math.round(s.hp * 100)}%"></i></span>`; }

    // ── render ──
    render() { this.renderBar(); this.renderMap(); this.renderSide(); this.renderForecast(); }

    renderBar() {
      const c = this.c, S = this.sum(), fuelNet = S.fuelIncome - S.upkeep, alerts = this.alerts(S);
      const hist = this.hist(), tide = hist.length > 1 ? hist[hist.length - 1].a - hist[hist.length - 2].a : 0;
      this.$('.g-bar').innerHTML = `
        <div class="gb-title"><b>${E.faction(this.pf).name.toUpperCase()}</b><span>GALACTIC WAR · TURN ${c.turn}</span></div>
        <div class="gb-res"><div class="gb-r cr" title="Credits: raise armies, ships, upgrades"><label>CREDITS</label><b>${c.credits[this.pf]}</b><em>+${S.income} / turn</em></div>
          <div class="gb-r fu" title="Fuel: builds and moves ships. Upkeep is paid every turn"><label>FUEL</label><b>${c.fuel[this.pf]}</b><em class="${fuelNet < 0 ? 'bad' : ''}">${fuelNet >= 0 ? '+' : ''}${fuelNet} / turn</em></div>
          <div class="gb-r wd"><label>WORLDS</label><b>${S.worlds}<small>/10</small></b><em class="${tide > 0 ? 'good' : tide < 0 ? 'bad' : ''}">${tide > 0 ? '▲ ' + tide : tide < 0 ? '▼ ' + -tide : 'enemy ' + C.owned(c, this.ef)}</em></div></div>
        <div class="gb-alerts">${alerts.map(a => `<button class="al ${a.cls}" data-pl="${a.planet}" title="${esc(a.text)}"><i></i>${esc(a.text)}</button>`).join('')}</div>
        <div class="gb-btns"><button class="gc-btn g-menu">‹ Menu</button><button class="gc-btn primary g-end" ${this.busy || c.pending ? 'disabled' : ''}>End turn <span class="k">E</span></button></div>`;
    }
    alerts(S) {
      const c = this.c, A = [], sup = new Set(S.supplied);
      if (c.pending) A.push({ cls: 'bad', text: 'Under attack: ' + c.planets[c.pending.planet].name, planet: c.pending.planet });
      for (const p of c.planets) if (p.owner === this.pf) {
        if (C.blockaded(c, p)) A.push({ cls: 'bad', text: 'Blockaded: ' + p.name, planet: p.id });
        else if (!sup.has(p.id)) A.push({ cls: 'warn', text: 'Cut off: ' + p.name, planet: p.id });
      }
      if (S.fuelIncome - S.upkeep < 0 && c.fuel[this.pf] < (S.upkeep - S.fuelIncome) * 4) A.push({ cls: 'warn', text: 'Fuel running low', planet: this.gs.planet });
      const hurt = C.fleetsOf(c, this.pf).filter(f => f.ships.some(s => s.hp < 0.6)); if (hurt.length) A.push({ cls: 'info', text: hurt[0].name + ' needs refit', planet: hurt[0].at });
      const idle = C.fleetsOf(c, this.pf).filter(f => !f.moved).length; if (idle && !A.length) A.push({ cls: 'info', text: idle + ' fleet' + (idle > 1 ? 's' : '') + ' ready', planet: -1 });
      return A.slice(0, 4);
    }

    // The map. `v` = the state to draw (the live campaign, or a playback snapshot).
    renderMap(v) {
      const c = v || this.c, svg = this.$('.g-svg'), pf = this.pf, vis = new Set(C.visible(this.c, pf)), sup = C.supplied(this.c, pf);
      const supE = C.supplied(this.c, this.ef), fl = this.selFleet(), R = fl ? C.reach(this.c, fl) : null;
      const defs = [...new Set(c.planets.map(p => p.biome))].map(b => { const pal = E.biome(b).palette; return `<radialGradient id="pg-${b}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${css(E.mixC(pal.high, [255, 255, 255], 0.3))}"/><stop offset=".5" stop-color="${css(pal.mid)}"/><stop offset="1" stop-color="${css(E.mixC(pal.low, [0, 0, 0], 0.6))}"/></radialGradient>`; }).join('');
      // lanes
      let lanes = '', flow = '';
      for (const [a, b] of c.links) {
        const A = c.planets[a], B = c.planets[b], [x1, y1] = this.xy(A), [x2, y2] = this.xy(B);
        let cls = 'ln';
        const fa = A.owner, fb = B.owner;
        if (fa === pf && fb === pf) cls += sup.has(a) && sup.has(b) ? ' sup' : ' cut';
        else if (fa === this.ef && fb === this.ef) cls += supE.has(a) && supE.has(b) ? ' esup' : ' ecut';
        else if (fa && fb && fa !== fb) cls += ' front';
        else if ((fa === pf && !fb) || (fb === pf && !fa)) cls += ' mine-free';
        if (fl && R) { if ((a === fl.at && R.free.has(b)) || (b === fl.at && R.free.has(a))) cls += ' route'; else if ((a === fl.at && R.targets.has(b)) || (b === fl.at && R.targets.has(a))) cls += ' strike'; }
        // supply lines flow toward the home system: orient the dash so it travels toward lower index (home 0) for the player
        const flip = (cls.indexOf('sup') >= 0 && cls.indexOf('esup') < 0) ? (a > b ? 0 : 1) : (cls.indexOf('esup') >= 0 ? (a > b ? 1 : 0) : 0);
        lanes += `<line class="${cls}" x1="${flip ? x2 : x1}" y1="${flip ? y2 : y1}" x2="${flip ? x1 : x2}" y2="${flip ? y1 : y2}"/>`;
        if (cls.indexOf(' cut') >= 0 || cls.indexOf('ecut') >= 0) flow += `<g class="cutmark" transform="translate(${(x1 + x2) / 2} ${(y1 + y2) / 2})"><circle r="11"/><path d="M-5 -5 L5 5 M5 -5 L-5 5"/></g>`;
      }
      // worlds
      let worlds = '';
      for (const p of c.planets) {
        const [x, y] = this.xy(p), seen = vis.has(p.id), own = p.owner || 'free', home = !!p.home, r = home ? 34 : 25;
        const isSel = this.gs.planet === p.id, isT = R && R.targets.has(p.id), isF = R && R.free.has(p.id), tgt = this.gs.target === p.id;
        const blk = p.owner && C.blockaded(this.c, p), cutoff = p.owner === pf && !sup.has(p.id), siege = this.c.pending && this.c.pending.planet === p.id;
        const garr = seen || p.owner === pf ? p.garrison : -1;
        let cls = `pl ${own === pf ? 'mine' : own === this.ef ? 'theirs' : 'free'}${isSel ? ' sel' : ''}${isT ? ' tgt' : ''}${isF ? ' fre' : ''}${tgt ? ' picked' : ''}${blk ? ' blk' : ''}${cutoff ? ' cut' : ''}${siege ? ' siege' : ''}${!seen ? ' fog' : ''}`;
        const pips = garr < 0 ? '<text class="gq" y="' + (r + 40) + '">?</text>' : Array.from({ length: Math.max(garr, 0) }, (_, i) => `<rect class="gp" x="${(i - (garr - 1) / 2) * 11 - 4}" y="${r + 31}" width="8" height="8"/>`).join('') + (p.sabotage >= this.c.turn && seen ? `<path class="spark" d="M${r + 4} ${-r} l4 8 l-8 0 l4 8" />` : '');
        worlds += `<g class="${cls}" data-p="${p.id}" transform="translate(${x} ${y})" tabindex="0" role="button" aria-label="${esc(p.name)}, ${own === pf ? 'yours' : own === this.ef ? 'enemy' : 'unclaimed'}${cutoff ? ', cut off' : ''}${blk ? ', blockaded' : ''}">
          <circle class="halo" r="${r + 14}"/><circle class="ring" r="${r + 7}"/><circle class="ring2" r="${r + 11}"/>
          <circle class="body" r="${r}" fill="url(#pg-${p.biome})"/>
          ${blk ? `<circle class="blkr" r="${r + 18}"/><text class="blkt" y="${-r - 22}">BLOCKADE ${p.blockade || ''}</text>` : ''}
          ${home ? `<path class="crown" transform="translate(0 ${-r - 14})" d="M-9 4 L-9 -4 L-4 0 L0 -6 L4 0 L9 -4 L9 4 Z"/>` : ''}
          ${isT ? `<g class="reticle"><path d="M${-r - 16} ${-r - 16} h12 M${-r - 16} ${-r - 16} v12 M${r + 16} ${-r - 16} h-12 M${r + 16} ${-r - 16} v12 M${-r - 16} ${r + 16} h12 M${-r - 16} ${r + 16} v-12 M${r + 16} ${r + 16} h-12 M${r + 16} ${r + 16} v-12"/></g>` : ''}
          <text class="nm" y="${r + 20}">${esc(p.name.toUpperCase())}</text>
          ${pips}
          ${p.trait && (seen || p.owner === pf) ? `<g class="trait" transform="translate(${r + 10} ${r - 4}) scale(.9)"><circle r="11"/><path d="${TRAIT[p.trait]}"/></g>` : ''}
          ${this.recent(p) ? `<g class="newb" transform="translate(${-r - 4} ${-r - 2})"><rect x="-17" y="-8" width="34" height="15" rx="3"/><text y="3">NEW</text></g>` : ''}
          ${cutoff ? `<text class="cutt" y="${-r - 22}">CUT OFF</text>` : ''}
          ${seen && p.owner ? `<text class="inc" y="${r + 54}">${p.value + (p.perk === 'trade' ? 60 : 0)} cr</text>` : ''}
          ${!seen ? `<text class="fogq" y="6">?</text>` : ''}
        </g>`;
      }
      // fleets: pieces beside their worlds; the enemy's only where we can see
      const stack = {}; let fleets = '';
      for (const f of c.fleets) {
        const own = f.owner === pf; if (!own && !vis.has(f.at)) continue;
        const p = c.planets[f.at], k = f.at + (own ? 'a' : 'b'), n = stack[k] = (stack[k] || 0) + 1, [x, y] = this.xy(p), r = p.home ? 34 : 25;
        const ox = own ? -r - 44 : r + 44, oy = (own ? 1 : -1) * (r * 0.6) + (n - 1) * 34 * (own ? 1 : -1) - (own ? 0 : 10);
        const avg = f.ships.reduce((s, x) => s + x.hp, 0) / Math.max(1, f.ships.length), sel = this.gs.fleet === f.id;
        fleets += `<g class="fl ${own ? 'mine' : 'theirs'}${sel ? ' sel' : ''}${f.moved ? ' done' : ''}" data-f="${f.id}" style="transform:translate(${x + ox}px,${y + oy}px)" tabindex="0" role="button" aria-label="${esc(f.name)}, ${f.ships.length} ships">
          <rect class="tok" x="-40" y="-14" width="80" height="28" rx="5"/><path class="chev" d="M-31 4 L-23 -8 L-15 4 L-23 0 Z"/>
          <text class="ct" x="-6" y="1">${f.ships.length}<tspan class="sm"> ·${f.wing}✈ ${f.army}▣</tspan></text>
          <rect class="hpb" x="-38" y="9" width="76" height="3"/><rect class="hpv" x="-38" y="9" width="${(76 * avg).toFixed(1)}" height="3" style="--h:${Math.round(avg * 100)}"/>
          ${f.moved ? '<text class="mv" x="31" y="-17">✓</text>' : ''}</g>`;
      }
      // starfield + grid are static in CSS; add a few stars from the seed for variety
      svg.innerHTML = `<defs>${defs}<filter id="gl"><feGaussianBlur stdDeviation="3"/></filter></defs>
        <g class="hexgrid">${this.hexgrid()}</g><g class="lanes">${lanes}</g><g class="marks">${flow}</g><g class="worlds">${worlds}</g><g class="fleets">${fleets}</g>`;
      this.$('.g-hint').innerHTML = fl ? `<b>${esc(fl.name)}</b> selected — <span class="h-free">cyan</span>: move free · <span class="h-tgt">amber</span>: strike target (fuel ${fl.ships.length * C.JUMP_FUEL})` : 'Select a fleet to see where it can go · <kbd>F</kbd> next fleet';
    }
    hexgrid() { let s = ''; const w = 80, h = 69; for (let j = -1; j < 14; j++) for (let i = -1; i < 22; i++) { const x = i * w + (j % 2 ? w / 2 : 0), y = j * h; s += `<path d="M${x} ${y - 24} l20 12 v24 l-20 12 l-20 -12 v-24 Z"/>`; } return s; }

    // ── side panel ──
    renderSide() {
      const gs = this.gs, c = this.c, p = gs.planet >= 0 ? c.planets[gs.planet] : null, side = this.$('.g-side');
      const tabs = TABS.map(([k, n], i) => `<button class="tb${gs.tab === k ? ' on' : ''}" data-tab="${k}" role="tab" aria-selected="${gs.tab === k}">${n}<kbd>${i + 1}</kbd></button>`).join('');
      let body = '';
      if (gs.tab === 'world') body = this.tabWorld(p); else if (gs.tab === 'build') body = this.tabBuild(p); else if (gs.tab === 'ops') body = this.tabOps(p); else if (gs.tab === 'up') body = this.tabUp(); else body = this.tabLog();
      const keep = side.querySelector('.sd-body'); const sc = keep ? keep.scrollTop : 0;
      side.innerHTML = `<div class="sd-tabs" role="tablist">${tabs}</div><div class="sd-body">${body}</div>`;
      side.querySelector('.sd-body').scrollTop = sc;
    }
    worldHead(p) {
      const b = E.biome(p.biome), seen = new Set(C.visible(this.c, this.pf)).has(p.id), own = p.owner || 'free';
      return `<div class="wh ${own === this.pf ? 'mine' : own === this.ef ? 'theirs' : 'free'}"><i class="orb" style="background:${css(E.biome(p.biome).palette.mid)}"></i><div><h2>${esc(p.name)}</h2><span>${own === this.pf ? 'YOURS' : own === this.ef ? 'ENEMY · ' + E.faction(own).short.toUpperCase() : 'UNCLAIMED'} · ${b.theme}${p.home ? ' · HOME SYSTEM' : ''}</span></div></div>${seen ? '' : '<div class="fogn">Beyond your sensors. Run reconnaissance to see its fleets and garrison.</div>'}`;
    }
    tabWorld(p) {
      const c = this.c, pf = this.pf;
      if (!p) return '<p class="sd-empty">Select a world or a fleet.</p>';
      const b = E.biome(p.biome), seen = new Set(C.visible(c, pf)).has(p.id), sup = C.supplied(c, pf).has(p.id), fl = C.fleetsAt(c, p.id).filter(f => f.owner === pf || seen);
      const kv = (k, v, cls) => `<div class="kv"><span>${k}</span><b class="${cls || ''}">${v}</b></div>`;
      const T = p.trait ? C.TRAITS[p.trait] : null, P = p.perk ? C.PERKS[p.perk] : null;
      return `${this.worldHead(p)}
        <div class="kvs">${kv('Income', p.owner ? (p.value + (p.perk === 'trade' ? 60 : 0)) + ' cr / turn' : p.value + ' cr when taken')}${kv('Fuel', p.fuel + ' / turn')}${kv('Hazard', b.challenge.name)}
        ${p.owner === pf ? kv('Supply', sup ? 'Connected to home' : 'CUT OFF: no income or perk', sup ? 'good' : 'bad') : ''}
        ${seen || p.owner === pf ? kv('Garrison', p.garrison + (p.sabotage >= c.turn ? ' (sabotaged −1)' : '') + (p.trait === 'fortress' ? ' · fortress' : '')) : kv('Garrison', 'unknown')}
        ${p.blockade ? kv('Blockade', p.blockade + ' turn' + (p.blockade > 1 ? 's' : '') + ': garrison starving', 'bad') : ''}</div>
        ${T ? `<div class="trait-note"><svg viewBox="-12 -12 24 24"><path d="${TRAIT[p.trait]}"/></svg><div><b>${T.name}</b><span>${T.desc}</span></div></div>` : ''}
        ${P ? `<div class="perk-note ${p.owner === pf && sup ? 'on' : ''}"><b>${P.name}</b><span>${P.desc}${p.owner === pf ? (sup ? ' · ACTIVE' : ' · INACTIVE (cut off)') : ''}</span></div>` : ''}
        <div class="sd-h">FLEETS IN ORBIT</div>
        ${fl.length ? fl.map(f => this.fleetCard(f)).join('') : '<p class="sd-empty">' + (seen || p.owner === pf ? 'None.' : 'Unknown.') + '</p>'}`;
    }
    fleetCard(f) {
      const own = f.owner === this.pf, S = f.ships;
      return `<div class="fc ${own ? 'mine' : 'theirs'}${this.gs.fleet === f.id ? ' sel' : ''}" data-f="${f.id}"><div class="fc-h"><b>${esc(f.name)}</b><span>${own ? 'YOURS' : 'ENEMY'}${f.moved ? ' · MOVED' : ''}</span></div>
        <div class="fc-sh">${S.map(s => this.shipChip(s)).join('')}</div>
        <div class="fc-st"><span>SPACE <b>${S.length}</b></span><span>AIR <b>${f.wing}</b></span><span>LAND <b>${f.army}</b></span></div></div>`;
    }
    tabBuild(p) {
      const c = this.c, pf = this.pf;
      if (!p || p.owner !== pf) return '<p class="sd-empty">Select one of your worlds to build there. Ships need a Shipyard world; legions, squadrons and refits need a fleet in orbit.</p>';
      const here = C.fleetsAt(c, p.id, pf), item = (what, B, kind) => {
        const t = this.try((t, C2) => C2.build(t, what, p.id)), cost = `${B.credits} cr${B.fuel ? ' · ' + B.fuel + ' fuel' : ''}`;
        return `<button class="bi${t.ok ? '' : ' off'}" data-build="${what}" ${t.ok ? '' : 'aria-disabled="true"'}><b>${B.name}</b><em>${cost}</em><span>${t.ok ? (B.desc || '') : t.reason}</span></button>`;
      };
      return `${this.worldHead(p)}
        <div class="sd-h">CAPITAL SHIPS ${p.trait === 'shipyard' ? '' : '<small>no shipyard here</small>'}</div>
        <div class="bl">${Object.entries(C.SHIPS).map(([k, s]) => item(k, { name: s.name, credits: s.credits, fuel: s.fuel, desc: `Power ${s.power} · upkeep ${s.upkeep} fuel/turn` })).join('')}</div>
        <div class="sd-h">FLEET AND WORLD ${here.length ? '<small>' + esc(here[0].name) + ' in orbit</small>' : '<small>no fleet in orbit</small>'}</div>
        <div class="bl">${Object.entries(C.BUILD).map(([k, B]) => item(k, B)).join('')}</div>`;
    }
    tabOps(p) {
      const c = this.c, pf = this.pf;
      if (!p || p.owner === pf) return '<p class="sd-empty">Select an enemy or unclaimed world to run covert operations against it.</p>';
      const item = (k) => { const O = C.OPS[k], t = this.try((t, C2) => C2.op(t, k, p.id)); return `<button class="bi${t.ok ? '' : ' off'}" data-op="${k}" ${t.ok ? '' : 'aria-disabled="true"'}><b>${O.name}</b><em>${C.opCost(c, k)} cr</em><span>${t.ok ? O.desc : t.reason}</span></button>`; };
      const intel = c.intel[pf][p.id];
      return `${this.worldHead(p)}${intel >= c.turn ? `<div class="intel">Recon active until turn ${intel}</div>` : ''}<div class="bl">${['recon', 'sabotage', 'incite'].map(item).join('')}</div>
        <p class="sd-note">Intelligence level ${c.upgrades[pf].intel + 1}: ${25 * c.upgrades[pf].intel}% cheaper. Sabotage cuts the garrison by one for your next assault. Incite may turn an enemy colony.</p>`;
    }
    tabUp() {
      const c = this.c, pf = this.pf;
      return '<div class="bl">' + Object.entries(C.UPGRADES).map(([k, U]) => {
        const lv = c.upgrades[pf][k], max = lv >= U.levels.length - 1, afford = !max && c.credits[pf] >= U.cost[lv + 1];
        return `<button class="bi up${afford ? '' : ' off'}" data-up="${k}" ${afford ? '' : 'aria-disabled="true"'}><b>${U.name}</b><em>${max ? 'MAX' : U.cost[lv + 1] + ' cr'}</em><span>${U.levels.map((l, i) => `<u class="${i <= lv ? 'got' : ''}">${l}</u>`).join(' › ')}</span><span class="d">${U.desc}${!max && !afford ? ' · not enough credits' : ''}</span></button>`;
      }).join('') + '</div>' + `<div class="sd-h">ACTIVE PERKS</div><div class="perks">${Object.keys(C.perks(c, pf)).map(k => `<span title="${C.PERKS[k].desc}">${C.PERKS[k].name}</span>`).join('') || '<span class="dim">None: capture and connect worlds</span>'}</div>`;
    }
    tabLog() {
      const c = this.c, h = this.hist();
      const W = 300, H = 70, mx = 10, pts = (k) => h.map((r, i) => `${(h.length < 2 ? W / 2 : i / (h.length - 1) * W).toFixed(1)},${(H - r[k] / mx * H).toFixed(1)}`).join(' ');
      return `<div class="sd-h">THE TIDE OF WAR</div><svg class="tide" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline class="a" points="${pts('a')}"/><polyline class="b" points="${pts('b')}"/></svg><div class="tide-k"><span class="a">▬ you ${C.owned(c, this.pf)}</span><span class="b">┅ enemy ${C.owned(c, this.ef)}</span><span>${c.wins}/${c.battles} battles won</span></div>
        <div class="sd-h">LOG</div><div class="log">${c.log.slice(0, 30).map(l => `<div class="${l.good ? 'good' : 'bad'}"><i>T${l.turn}</i>${esc(l.text)}</div>`).join('') || '<div class="dim">The war begins.</div>'}</div>`;
    }

    // ── forecast ──
    renderForecast() {
      const el = this.$('.g-fc'), fl = this.selFleet(), t = this.gs.target;
      if (!fl || t < 0 || !C.reach(this.c, fl).targets.has(t)) { el.className = 'g-fc'; el.innerHTML = ''; return; }
      const c = this.c, p = c.planets[t], F = C.forecast(c, fl.id, t), seen = new Set(C.visible(c, this.pf)).has(t);
      const a = F.attacker, d = F.defender, pct = Math.round(F.odds * 100);
      const row = (name, av, dv, fmt) => { const m = Math.max(av, dv, 0.5); return `<div class="cmp"><label>${name}</label><div class="cb a"><i style="width:${Math.min(100, av / m * 100)}%"></i><b>${fmt(av)}</b></div><div class="cb d ${seen ? '' : 'mask'}"><i style="width:${seen ? Math.min(100, dv / m * 100) : 0}%"></i><b>${seen ? fmt(dv) : '?'}</b></div></div>`; };
      const f1 = (v) => v.toFixed(1), f0 = (v) => String(Math.round(v));
      const ass = this.try((tc, C2) => C2.moveFleet(tc, fl.id, t, 'assault')), blk = this.try((tc, C2) => C2.moveFleet(tc, fl.id, t, 'blockade'));
      const cost = fl.at === t ? 0 : fl.ships.length * C.JUMP_FUEL;
      const flags = [F.supplied ? '' : '<span class="bad">Your fleet is out of supply: −20% strength</span>', !p.owner ? '' : F.defenderSupplied ? '' : '<span class="good">Defender is cut off: −20% strength</span>', F.sabotaged ? '<span class="good">Defences sabotaged: garrison −1</span>' : '', cost ? `<span>Jump costs ${cost} fuel (you have ${c.fuel[this.pf]})</span>` : ''].filter(Boolean).join('');
      el.className = 'g-fc show';
      el.innerHTML = `<div class="fc-top"><div><h3>${esc(fl.name)} <i>›</i> ${esc(p.name)}</h3><span>${seen ? 'Defenders: ' + (d.ships.length ? d.ships.map(s => C.SHIPS[s.type].name + (s.picket ? ' (picket)' : '')).join(', ') : 'no ships') + ' · garrison ' + d.garrison : 'No intel on this world: defenders hidden'}</span></div>
        <div class="odds ${pct >= 60 ? 'good' : pct >= 40 ? 'mid' : 'bad'}"><b>${seen ? pct + '%' : '~' + pct + '%'}</b><span>${seen ? 'chance to win' : 'estimate'}</span><div class="om"><i style="width:${pct}%"></i></div></div></div>
        <div class="cmps"><div class="cmp hd"><label></label><div>YOU</div><div>THEM</div></div>${row('SPACE', a.space, d.space, f1)}${row('AIR', a.air, d.air, f0)}${row('LAND', a.land, d.land, f1)}</div>
        <div class="flags">${flags}</div>
        <div class="fc-btns"><button class="gc-btn primary go-assault" ${ass.type === 'none' ? 'aria-disabled="true" class="gc-btn off"' : ''} ${ass.type === 'none' ? 'disabled' : ''}>${p.owner ? 'Assault' : 'Invade'} <span class="k">A</span></button><button class="gc-btn go-blockade" ${blk.type === 'none' ? 'disabled' : ''}>Blockade <span class="k">B</span></button><button class="gc-btn go-cancel">Cancel <span class="k">Esc</span></button></div>
        <div class="fc-why">${ass.type === 'none' ? esc(ass.reason) : ''}${ass.type === 'none' && blk.type === 'none' ? ' · ' : ''}${blk.type === 'none' ? 'Blockade: ' + esc(blk.reason) : ''}</div>`;
    }

    // ── events ──
    bindEvents() {
      const r = this.root;
      r.addEventListener('click', (e) => {
        const t = e.target;
        if (t.closest('.g-end')) return this.endTurn();
        if (t.closest('.g-menu')) return this.menu.show();
        const tb = t.closest('[data-tab]'); if (tb) { this.gs.tab = tb.dataset.tab; this.renderSide(); return this.snd('hover'); }
        const bi = t.closest('.bi'); if (bi) return this.doItem(bi);
        const al = t.closest('.al'); if (al) { const id = +al.dataset.pl; if (id >= 0) { this.clickPlanet(id); } return; }
        if (t.closest('.go-cancel')) { this.gs.target = -1; this.renderForecast(); this.renderMap(); return; }
        if (t.closest('.go-assault')) return this.commit('assault');
        if (t.closest('.go-blockade')) return this.commit('blockade');
        const fc = t.closest('.fc[data-f]'); if (fc) { const f = this.fleetOf(+fc.dataset.f); if (f && f.owner === this.pf) this.selectFleet(f.id); return; }
        const fg = t.closest('g.fl'); if (fg) { const f = this.fleetOf(+fg.dataset.f); if (f && f.owner === this.pf) this.selectFleet(f.id); else if (f) { this.gs.planet = f.at; this.render(); } return; }
        const pg = t.closest('g.pl'); if (pg) return this.clickPlanet(+pg.dataset.p);
        if (t.closest('.g-svg')) { this.gs.target = -1; this.render(); }
      });
      r.addEventListener('mouseover', (e) => { const pg = e.target.closest && e.target.closest('g.pl'); if (pg && pg !== this._hov) { this._hov = pg; this.snd('hover'); } });
      r.addEventListener('keydown', (e) => this.key(e));
    }
    snd(k) { if (E.SFX && E.Music.on) E.SFX.play(k); }
    selectFleet(id) { this.gs.fleet = id; const f = this.fleetOf(id); this.gs.planet = f.at; this.gs.target = -1; this.snd('select'); this.render(); }
    clickPlanet(id) {
      const gs = this.gs, c = this.c, fl = this.selFleet();
      if (fl && id !== fl.at) {
        const R = C.reach(c, fl);
        if (R.free.has(id)) { const res = C.moveFleet(c, fl.id, id, 'assault'); if (res.type === 'moved') { this.snd('move'); this.save(); gs.planet = id; gs.target = -1; this.say(`${fl.name} redeploys to ${c.planets[id].name}`); this.render(); return; } }
        else if (R.targets.has(id)) { gs.target = id; gs.planet = id; this.snd('select'); this.render(); return; }
      }
      const here = C.fleetsOf(c, this.pf).filter(f => f.at === id);
      if (here.length && !(fl && fl.at === id)) gs.fleet = here.find(f => !f.moved) ? here.find(f => !f.moved).id : here[0].id;
      gs.planet = id; gs.target = -1; this.snd('select'); this.render();
    }
    key(e) {
      if (this.busy) { if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') { this.skip = true; } return; }
      if (this.$('.g-modal').classList.contains('on')) return;
      const k = e.key, gs = this.gs;
      if (k >= '1' && k <= '5') { gs.tab = TABS[+k - 1][0]; this.renderSide(); }
      else if (k === 'e' || k === 'E') this.endTurn();
      else if (k === 'f' || k === 'F') { const fs = C.fleetsOf(this.c, this.pf); if (fs.length) { const i = fs.findIndex(f => f.id === gs.fleet); this.selectFleet(fs[(i + 1) % fs.length].id); } }
      else if (k === 'Escape') { if (gs.target >= 0) gs.target = -1; else gs.fleet = 0; this.render(); }
      else if ((k === 'a' || k === 'A') && gs.target >= 0) this.commit('assault');
      else if ((k === 'b' || k === 'B') && gs.target >= 0) this.commit('blockade');
      else if (k === 'Tab' || k.startsWith('Arrow')) {
        e.preventDefault(); const cur = this.c.planets[gs.planet >= 0 ? gs.planet : 0], dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        let best = null, bs = 1e9;
        for (const p of this.c.planets) {
          if (p.id === cur.id) continue; const dx = p.x - cur.x, dy = p.y - cur.y;
          if (k === 'Tab') { const s = ((p.id - cur.id + 10) % 10) * (e.shiftKey ? -1 : 1); const sc = e.shiftKey ? (cur.id - p.id + 10) % 10 : (p.id - cur.id + 10) % 10; if (sc < bs) { bs = sc; best = p; } continue; }
          const d = dirs[k], dot = dx * d[0] + dy * d[1]; if (dot <= 0.02) continue; const s = Math.hypot(dx, dy) + Math.abs(dx * d[1] - dy * d[0]) * 1.5; if (s < bs) { bs = s; best = p; }
        }
        if (best) { gs.planet = best.id; this.renderSide(); this.renderMap(); const g = this.root.querySelector(`g.pl[data-p="${best.id}"]`); if (g) g.focus(); this.snd('hover'); }
      } else if ((k === 'Enter' || k === ' ') && document.activeElement && document.activeElement.closest) {
        const pg = document.activeElement.closest('g.pl'), fg = document.activeElement.closest('g.fl');
        if (pg) { e.preventDefault(); this.clickPlanet(+pg.dataset.p); const g2 = this.root.querySelector(`g.pl[data-p="${pg.dataset.p}"]`); if (g2) g2.focus(); }
        else if (fg) { e.preventDefault(); const f = this.fleetOf(+fg.dataset.f); if (f && f.owner === this.pf) this.selectFleet(f.id); }
      }
    }

    // ── actions ──
    doItem(bi) {
      const c = this.c, gs = this.gs, p = c.planets[gs.planet];
      if (bi.getAttribute('aria-disabled') === 'true') { this.snd('deny'); const why = bi.querySelector('span').textContent; this.say(why, 'bad'); return; }
      if (bi.dataset.build) { const r = C.build(c, bi.dataset.build, p.id); if (r.ok) { this.snd('build'); this.save(); this.say(`${(C.SHIPS[bi.dataset.build] || C.BUILD[bi.dataset.build]).name} ordered at ${p.name}`); if (r.fleet && !gs.fleet) gs.fleet = r.fleet; } else { this.snd('deny'); this.say(r.reason, 'bad'); } }
      else if (bi.dataset.op) { const r = C.op(c, bi.dataset.op, p.id); if (r.ok) { this.snd('ops'); this.save(); this.say(({ revealed: `Agents report from ${p.name}: fleets and garrison revealed for 3 turns`, sabotaged: `Saboteurs strike ${p.name}: its garrison is down one for your next assault`, revolt: `${p.name} rises and breaks away!`, unrest: `Unrest thins the garrison of ${p.name}`, failed: `The uprising on ${p.name} was crushed: credits lost` })[r.result] || 'Operation complete', r.result === 'failed' ? 'bad' : 'good'); } else { this.snd('deny'); this.say(r.reason, 'bad'); } }
      else if (bi.dataset.up) { if (C.buy(c, bi.dataset.up)) { this.snd('confirm'); this.save(); this.say(C.UPGRADES[bi.dataset.up].name + ' upgraded'); } else { this.snd('deny'); this.say('Not enough credits', 'bad'); } }
      this.render();
    }
    commit(mode) {
      const fl = this.selFleet(), gs = this.gs, c = this.c, t = gs.target; if (!fl || t < 0) return;
      const before = { ships: fl.ships.map(s => ({ type: s.type, hp: s.hp })), name: fl.name, wing: fl.wing, army: fl.army };
      const res = C.moveFleet(c, fl.id, t, mode);
      if (res.type === 'none') { this.snd('deny'); this.say(res.reason, 'bad'); return; }
      const p = c.planets[t];
      if (res.type === 'battle') { this.save(); this.snd('confirm'); this.menu.onStart(res.options, { campaign: c, planet: t, defending: false, fleetId: fl.id, before }); return; }
      this.save(); gs.target = -1; gs.planet = t;
      if (res.type === 'captured') { this.snd('confirm'); this.say(`${p.name} surrenders to ${fl.name}`, 'good'); } else if (res.type === 'blockade') { this.snd('move'); this.say(`${fl.name} blockades ${p.name}: no income for its owner, the garrison starves`, 'good'); }
      this.render();
    }

    // ── the enemy's turn, played back ──
    snap() { const c = this.c; return clone({ fleets: c.fleets, planets: c.planets.map(p => ({ id: p.id, owner: p.owner, garrison: p.garrison, blockade: p.blockade })), credits: c.credits, fuel: c.fuel, log: c.log.length, turn: c.turn }); }
    async endTurn() {
      if (this.busy || this.c.pending) return;
      const c = this.c, before = this.snap(); this.busy = true; this.skip = false;
      const idle = C.fleetsOf(c, this.pf).filter(f => !f.moved && f.army > 0).length;
      this.snd('endturn');
      const S0 = this.sum();
      const res = C.endTurn(c);
      this.save(); this.recordHistory();
      await this.playback(before, res, S0);
      this.busy = false; void idle;
      this.gs.target = -1;
      const f = C.fleetsOf(c, this.pf).find(x => !x.moved) || C.fleetsOf(c, this.pf)[0]; this.gs.fleet = f ? f.id : 0; if (f) this.gs.planet = f.at;
      this.render();
      if (c.victory) { this.menu.showCampaign(); return; }
      if (c.pending) this.showAttack(res);
    }
    async playback(before, res, S0) {
      const c = this.c, pb = this.$('.g-pb'), pf = this.pf, ef = this.ef, vis = new Set(C.visible(c, pf));
      const rm = document.documentElement.classList.contains('rm') || window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const D = (ms) => (rm || this.skip ? 0 : ms * this.speed);
      const wait = async (ms) => { const end = Date.now() + D(ms); while (Date.now() < end && !this.skip) await sleep(40); };
      const lines = [], newLog = c.log.slice(0, Math.max(0, c.log.length - before.log));
      const cr = c.credits[pf] - before.credits[pf], fu = c.fuel[pf] - before.fuel[pf];
      // the view starts from "before" and fleets/owners are applied step by step
      const view = clone(c); view.fleets = clone(before.fleets); view.planets.forEach((p, i) => { p.owner = before.planets[i].owner; p.garrison = before.planets[i].garrison; });
      pb.className = 'g-pb on'; pb.innerHTML = `<div class="pb-card"><div class="pb-h">ENEMY TURN</div><div class="pb-l"></div><button class="pb-skip">Skip <kbd>Esc</kbd></button></div>`;
      pb.querySelector('.pb-skip').onclick = () => { this.skip = true; };
      const L = pb.querySelector('.pb-l'); const add = (cls, text, planet) => { lines.push({ cls, text }); L.innerHTML = lines.slice(-7).map(l => `<div class="${l.cls}">${esc(l.text)}</div>`).join(''); if (planet != null && planet >= 0) this.flash(planet); };
      this.renderMap(view);
      await wait(500);
      add('', `Income: +${cr + (S0 ? 0 : 0)} credits, ${fu >= 0 ? '+' : ''}${fu} fuel (upkeep ${S0.upkeep})`);
      await wait(800);
      // enemy fleets moving (only those we can see)
      const moved = [], unseen = [];
      for (const f of c.fleets) if (f.owner === ef) { const b = before.fleets.find(x => x.id === f.id); if (!b) { (vis.has(f.at) ? moved : unseen).push({ f, from: f.at, fresh: true }); } else if (b.at !== f.at) { (vis.has(f.at) || vis.has(b.at) ? moved : unseen).push({ f, from: b.at }); } }
      for (const m of moved) {
        const vf = view.fleets.find(x => x.id === m.f.id); if (vf) vf.at = m.f.at; else view.fleets.push(clone(m.f));
        this.animateFleet(view, m.f.id); await wait(700);
        add('bad', m.fresh ? `${m.f.name} appears at ${c.planets[m.f.at].name}` : `${m.f.name} moves ${c.planets[m.from].name} › ${c.planets[m.f.at].name}`, m.f.at);
        await wait(500);
      }
      if (unseen.length) { add('dim', `${unseen.length} enemy movement${unseen.length > 1 ? 's' : ''} beyond your sensors`); await wait(600); }
      // ownership changes and the log
      for (const p of c.planets) { const b = before.planets[p.id]; if (b.owner !== p.owner) { view.planets[p.id].owner = p.owner; this.renderMap(view); add(p.owner === pf ? 'good' : 'bad', p.owner === pf ? `${p.name} is now yours` : p.owner === ef ? `${p.name} falls to the enemy` : `${p.name} breaks away`, p.id); this.snd(p.owner === pf ? 'capture' : 'lost'); await wait(800); } }
      for (const l of newLog.slice().reverse()) { if (/Captured|falls|surrenders|occupies|breaks/.test(l.text)) continue; add(l.good ? 'good' : 'bad', l.text); await wait(450); }
      if (res.type === 'attack') { add('bad', `ALERT: assault on ${c.planets[res.planet].name} (${Math.round(res.odds * 100)}% enemy odds)`, res.planet); this.snd('enemy'); this.alertDuck(); await wait(1100); }
      else if (res.type === 'none' && !moved.length) { add('dim', 'The enemy holds position.'); await wait(500); }
      add('good', `Turn ${c.turn}: your move.`); await wait(900);
      pb.className = 'g-pb'; pb.innerHTML = '';
      this.view = null;
    }
    alertDuck() { if (E.Music && E.Music.on) E.Music.sting('alert'); if (E.Mixer) E.Mixer.alert(1.5); }
    animateFleet(view, id) { this.renderMap(view); }
    flash(pid) { const g = this.root.querySelector(`g.pl[data-p="${pid}"]`); if (g) { g.classList.remove('flash'); void g.getBoundingClientRect(); g.classList.add('flash'); } }

    // the enemy attacks one of our worlds: defend in person, or let the garrison fight
    showAttack(res) {
      const c = this.c, pend = c.pending; if (!pend) return;
      const p = c.planets[pend.planet], fl = C.fleet(c, pend.fleet), F = fl ? C.forecast(c, fl.id, pend.planet) : null, m = this.$('.g-modal');
      const odds = F ? Math.round((1 - F.odds) * 100) : 50;
      m.className = 'g-modal on';
      m.innerHTML = `<div class="atk" role="alertdialog" aria-label="Under attack"><div class="atk-h">UNDER ATTACK</div><h2>${esc(p.name)}</h2>
        <p>${esc(fl ? fl.name : 'The enemy')} (${fl ? fl.ships.length + ' ships, ' + fl.wing + ' fighters, ' + fl.army + ' legions' : 'unknown'}) is assaulting ${esc(p.name)}. Take command of the defence, or leave it to your garrison.</p>
        ${F ? `<div class="odds ${odds >= 60 ? 'good' : odds >= 40 ? 'mid' : 'bad'}"><b>${odds}%</b><span>your chance if the garrison fights alone</span><div class="om"><i style="width:${odds}%"></i></div></div>` : ''}
        <div class="atk-b"><button class="gc-btn primary a-defend">Defend in person</button><button class="gc-btn a-auto">Auto-resolve</button></div></div>`;
      m.querySelector('.a-defend').onclick = () => { m.className = 'g-modal'; m.innerHTML = ''; this.menu.onStart(C.matchOptions(c, pend.planet, true), { campaign: c, planet: pend.planet, defending: true, fleetId: pend.fleet, before: fl ? { ships: clone(fl.ships), name: fl.name } : null }); };
      m.querySelector('.a-auto').onclick = () => { const r = C.autoResolve(c, pend.planet); this.save(); m.className = 'g-modal'; m.innerHTML = ''; this.menu.lastReport = r.won ? `${r.planet} holds. +${r.reward} credits` : `${r.planet} has fallen to the enemy`; this.show(); };
      m.querySelector('.a-defend').focus();
    }
  }

  E.Galaxy = Galaxy;
})(window.E = window.E || {});
