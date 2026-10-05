// The battle HUD. DOM + 2D canvas only, built from code.
//   hud.js         shell, common widgets (tickets, posts, objectives, kill feed, minimap, crosshair,
//                  unit card, key hints), infantry and vehicle panels, world markers, announcer, deploy screen
//   hud_air.js     flight HUD (tapes, lock, warnings, ordnance, bomb pipper)
//   hud_space.js   bridge HUD (shield arcs, subsystems, target, power) and boarding HUD
//   hud_cmd.js     commander view (selection, orders, call-ins, three-domain overview)
//   hud_screens.js pause / settings, controls reference, scoreboard, results
// Rules: numbers sit in fixed-width cells (no layout shift), team is never colour alone
// (friendly = solid glyph, enemy = hollow glyph, plus text labels), motion respects
// prefers-reduced-motion (CSS), and everything scales with the root font size.
(function (E) {
  'use strict';
  const COL = { aegis: '#ff6a3a', verdant: '#3df0b0', neutral: '#b9c6dd' };
  const TNAME = { aegis: 'CONCORD', verdant: 'PACT' };
  const CLASSES = ['trooper', 'heavy', 'sniper', 'medic', 'engineer'];
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const BAND = { low: 'LOW', cloud: 'CLOUD', high: 'HIGH', space: 'SPACE' };

  class HUD {
    constructor(root, game) { this.root = root; this.game = game; this.cls = 0; this.feed = []; this.pops = []; this.ann = []; this.dmgDirs = []; this.loadouts = {}; this.armed = null; }

    // set text / width only when changed (keeps the DOM quiet and layouts still)
    tx(el, v) { v = String(v); if (el && el._v !== v) { el._v = v; el.textContent = v; } }
    wd(el, f) { const v = (E.clamp01(f) * 100).toFixed(1) + '%'; if (el && el._w !== v) { el._w = v; el.style.width = v; } }
    cl(el, name, on) { if (!el) return; on = !!on; const c = el._c || (el._c = {}); if (c[name] !== on) { c[name] = on; el.classList.toggle(name, on); } }
    show(el, on) { const v = on ? '' : 'none'; if (el && el._d !== v) { el._d = v; el.style.display = v; } }

    begin(game) {
      const w = game.world;
      this.clear();
      const el = document.createElement('div'); el.className = 'hud'; el.id = 'hud';
      el.innerHTML = `
        <canvas class="h-cv"></canvas>
        <div class="h-vig"></div>
        <div class="h-top">
          <div class="h-team aegis"><span class="h-tname">CONCORD</span><div class="h-tbar"><i></i></div><b class="h-tk"></b></div>
          <div class="h-cps">${w.cps.map(c => `<div class="h-cp" data-cp="${c.id}"><span>${c.name[0]}</span><i></i></div>`).join('')}</div>
          <div class="h-team verdant"><b class="h-tk"></b><div class="h-tbar"><i></i></div><span class="h-tname">PACT</span></div>
        </div>
        <div class="h-stage"><div class="st-n"></div><div class="st-name"></div><div class="st-sup"><i></i></div><div class="st-fl"></div></div>
        <div class="h-obj"></div>
        <div class="h-announce" role="status" aria-live="polite"></div>
        <div class="h-feed"></div>
        <div class="h-pops"></div>
        <div class="h-cross"><i class="d"></i><i class="l"></i><i class="r"></i><i class="t"></i><i class="b"></i><div class="hitm"></div><div class="h-work"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/><circle class="v" cx="20" cy="20" r="17"/></svg><span></span></div></div>
        <div class="h-scope"></div>
        <div class="h-capture"><span></span><div class="bar"><i></i></div></div>
        <div class="h-prompt"></div>
        <div class="h-unit">
          <div class="h-uname"></div>
          <div class="h-bar sh"><i></i></div>
          <div class="h-bar hp"><i></i><span></span></div>
          <div class="h-bar st"><i></i></div>
          <div class="h-weap"><span class="wn"></span><div class="h-heat"><i></i></div></div>
          <div class="h-abil"><span class="key">G</span><span class="an"></span><div class="cd"><i></i></div></div>
          <div class="h-abil a2"><span class="key">R</span><span class="an"></span><div class="cd"><i></i></div></div>
          <div class="h-chips"></div>
          <div class="h-tools"><span>GUN</span><span>TORCH</span><span>CHARGE</span><em class="mines"></em></div>
          <div class="h-pips"><div class="pp ord"><label></label><div></div></div><div class="pp cm"><label>FLARES</label><div></div></div><div class="pp carry"><label>TROOPS</label><div></div></div></div>
        </div>
        <div class="h-veh">
          <svg viewBox="-24 -34 48 68" class="veh-svg"><g class="hull"><path class="z z-front" d="M-14 -22 L14 -22 L10 -30 L-10 -30 Z"/><path class="z z-rear" d="M-14 22 L14 22 L12 30 L-12 30 Z"/><path class="z z-left" d="M-14 -22 L-14 22 L-20 16 L-20 -16 Z"/><path class="z z-right" d="M14 -22 L14 22 L20 16 L20 -16 Z"/><rect class="z z-body" x="-14" y="-22" width="28" height="44"/></g><g class="tur"><circle class="z z-top" r="8"/><rect class="barrel" x="-1.4" y="-24" width="2.8" height="18"/></g></svg>
          <div class="veh-r"><div class="veh-spd"><b>0</b><i>KM/H</i></div><div class="veh-state"></div><div class="veh-zone"></div></div>
        </div>
        <div class="h-fl"><div class="fl-band"></div><div class="fl-warn"></div></div>
        <div class="h-br">
          <section class="br-own"><div class="br-h"><b></b><span></span></div><div class="br-arcs"></div><ul class="br-sys"></ul></section>
          <section class="br-tgt"><div class="br-h"><b>NO TARGET</b><span></span></div><div class="br-hp"><i class="sh"></i><i class="hl"></i></div><ul class="br-sys"></ul><div class="br-note"></div></section>
          <section class="br-ctl"><div class="br-pow"></div><div class="br-btns"></div></section>
          <div class="br-core"></div>
        </div>
        <div class="h-board"><div class="bd-h"></div><div class="bd-nodes"></div><div class="bd-f"></div></div>
        <div class="h-cmd">
          <section class="cm-sel"><div class="cm-h">SELECTION</div><div class="cm-body"></div><div class="cm-orders"></div></section>
          <section class="cm-ov"><div class="cm-h">THE BATTLE</div><div class="cm-dom ground"></div><div class="cm-dom air"></div><div class="cm-dom space"></div></section>
          <section class="cm-calls"></section>
        </div>
        <div class="h-squad"></div>
        <div class="h-mapwrap"><canvas class="h-map" width="220" height="160"></canvas><div class="mp-key"></div></div>
        <div class="h-keys"></div>
        <div class="h-toast"></div>
        <div class="h-dead"></div>
        <div class="h-selbox"></div>
        <div class="h-layer"></div>`;
      this.root.appendChild(el);
      this.el = el;
      const q = (s) => el.querySelector(s);
      this.cv = q('.h-cv'); this.ctx = this.cv.getContext('2d'); this.map = q('.h-map'); this.mctx = this.map.getContext('2d');
      this.$ = { vig: q('.h-vig'), tA: q('.h-team.aegis'), tV: q('.h-team.verdant'), cps: [...el.querySelectorAll('.h-cp')], ann: q('.h-announce'), feed: q('.h-feed'), pops: q('.h-pops'), cross: q('.h-cross'), hitm: q('.hitm'),
        work: q('.h-work'), scope: q('.h-scope'), cap: q('.h-capture'), prompt: q('.h-prompt'), unit: q('.h-unit'), uname: q('.h-uname'), hp: q('.h-bar.hp'), sh: q('.h-bar.sh'), st: q('.h-bar.st'), weap: q('.h-weap'), heat: q('.h-heat'),
        abil: q('.h-abil'), abil2: q('.h-abil.a2'), chips: q('.h-chips'), tools: q('.h-tools'), pips: q('.h-pips'), mapwrap: q('.h-mapwrap'), mpkey: q('.mp-key'), keys: q('.h-keys'), toast: q('.h-toast'), dead: q('.h-dead'), sel: q('.h-selbox'), layer: q('.h-layer'),
        veh: q('.h-veh'), fl: q('.h-fl'), br: q('.h-br'), board: q('.h-board'), cmd: q('.h-cmd'), stage: q('.h-stage'), obj: q('.h-obj'), squad: q('.h-squad') };
      this.feed = []; this.pops = []; this.ann = []; this.dmgDirs = []; this.annT = 0; this.hitT = 0; this.total = 0; this.layerKind = ''; this.armed = null; this.zoneT = 0; this.zone = ''; this.suppT = 0; this.keyKind = '';
      this.mapImg = this.terrainImage(w, 220, 160);
      this._resize = () => { this.cv.width = window.innerWidth; this.cv.height = window.innerHeight; this.rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16; };
      window.addEventListener('resize', this._resize); this._resize();
      el.classList.toggle('attract', game.state === 'attract');
      this.spaceBegin(); this.cmdBegin();
      if (game.state === 'deploy') this.showDeploy();
    }
    clear() { if (this.el) { this.el.remove(); this.el = null; window.removeEventListener('resize', this._resize); } }

    // top-down terrain image for the minimap / deploy map
    terrainImage(w, W, H) {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'), id = x.createImageData(W, H), d = id.data, T = w.terrain, pal = w.planet.biomeDef.palette, wl = T.waterLevel, wc = (w.planet.biomeDef.water || {}).color || [30, 60, 90];
      const AX = E.ARENA.x * 1.25, AZ = E.ARENA.z * 1.25;
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const wx = (i / (W - 1) * 2 - 1) * AX, wz = (j / (H - 1) * 2 - 1) * AZ, h = T.height(wx, wz), hx = T.height(wx + 14, wz - 14);
        const t = E.clamp01(E.invLerp(-22, 80, h));
        let c3 = t < 0.4 ? E.mixC(pal.low, pal.mid, t / 0.4) : E.mixC(pal.mid, pal.high, (t - 0.4) / 0.6);
        if (h < wl) c3 = E.mixC(wc, [10, 20, 30], E.clamp01((wl - h) / 12));
        const sh = E.clamp(0.62 + (h - hx) * 0.045, 0.3, 1.05), k = (j * W + i) * 4;
        d[k] = c3[0] * sh * 0.5; d[k + 1] = c3[1] * sh * 0.52; d[k + 2] = c3[2] * sh * 0.58; d[k + 3] = 255;
      }
      x.putImageData(id, 0, 0);
      return c;
    }
    mapXY(p, W, H, o) { o.x = (p.x / (E.ARENA.x * 1.25) * 0.5 + 0.5) * W; o.y = (p.z / (E.ARENA.z * 1.25) * 0.5 + 0.5) * H; return o; }
    // glyph: friendly = solid, enemy = hollow outline (so team never rests on colour alone)
    glyph(ctx, shape, x, y, s, col, friendly) {
      ctx.beginPath();
      if (shape === 'tri') { ctx.moveTo(x, y - s * 1.2); ctx.lineTo(x + s, y + s); ctx.lineTo(x - s, y + s); ctx.closePath(); }
      else if (shape === 'dia') { ctx.moveTo(x, y - s * 1.2); ctx.lineTo(x + s * 1.2, y); ctx.lineTo(x, y + s * 1.2); ctx.lineTo(x - s * 1.2, y); ctx.closePath(); }
      else if (shape === 'circ') ctx.arc(x, y, s, 0, E.TAU);
      else ctx.rect(x - s, y - s, s * 2, s * 2);
      if (friendly) { ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke(); }
      else { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill(); ctx.lineWidth = Math.max(1.5, s * 0.5); ctx.strokeStyle = col; ctx.stroke(); }
    }
    drawMap(ctx, W, H, w, big) {
      const g = this.game, o = { x: 0, y: 0 }, me = g.unit(), team = g.team, k = big ? 1.9 : 1, fly = me && (me.kind === 'fighter' || me.kind === 'capital');
      ctx.drawImage(this.mapImg, 0, 0, W, H);
      const scale = W / ((E.ARENA.x * 1.25) * 2);   // px per metre
      // structures, AA threat rings, shield domes
      for (const u of w.units) {
        if (!u.alive || u.kind !== 'turret') continue;
        this.mapXY(u.pos, W, H, o); const fr = u.team === team;
        if (u.def.aa && (fly || g.state === 'commander') && !fr) { const W2 = E.WEAPONS[u.def.weapon]; ctx.beginPath(); ctx.arc(o.x, o.y, (W2.range || 700) * scale, 0, E.TAU); ctx.fillStyle = 'rgba(255,60,40,.12)'; ctx.fill(); ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,90,60,.8)'; ctx.stroke(); ctx.setLineDash([]); }
        if (u.def.structure && u.def.shieldR) { ctx.beginPath(); ctx.arc(o.x, o.y, u.def.shieldR * scale, 0, E.TAU); ctx.lineWidth = 1; ctx.strokeStyle = fr ? 'rgba(120,200,255,.7)' : 'rgba(255,150,120,.6)'; ctx.stroke(); }
        const shape = u.def.aa ? 'tri' : u.def.structure ? 'dia' : 'sq';
        this.glyph(ctx, shape, o.x, o.y, (big ? 3.4 : 2.4), COL[u.team], fr);
      }
      // mines we know about
      for (const m of w.mines || []) if (m.team === team || m.seen) { this.mapXY(m, W, H, o); ctx.fillStyle = m.team === team ? '#ffd04a' : '#ff3a2a'; ctx.fillRect(o.x - 1.5 * k, o.y - 1.5 * k, 3 * k, 3 * k); }
      // objectives
      for (const ob of w.objs || []) if (!ob.done && ob.pos) { this.mapXY(ob.pos, W, H, o); ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(Math.PI / 4); ctx.lineWidth = 2; ctx.strokeStyle = '#ffd04a'; const s = big ? 9 : 6; ctx.strokeRect(-s, -s, s * 2, s * 2); ctx.restore(); ctx.beginPath(); ctx.arc(o.x, o.y, (ob.r || 20) * scale, 0, E.TAU); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,208,74,.7)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
      for (const u of w.units) {
        if (!u.alive || u.kind === 'turret') continue;
        this.mapXY(u.pos, W, H, o); const fr = u.team === team, col = COL[u.team];
        if (u.kind === 'capital') { ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(-u.yaw + Math.PI / 2); const L = 9 * (big ? 2 : 1); ctx.beginPath(); ctx.moveTo(L, 0); ctx.lineTo(-L, -3.2); ctx.lineTo(-L, 3.2); ctx.closePath(); if (fr) { ctx.fillStyle = col; ctx.fill(); } else { ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke(); } if (u.pid === g.pid) { ctx.strokeStyle = '#fff'; ctx.stroke(); } ctx.restore(); }
        else if (u.kind === 'fighter') this.glyph(ctx, 'tri', o.x, o.y, 2.6 * k, col, fr);
        else if (u.kind === 'vehicle') this.glyph(ctx, 'sq', o.x, o.y, 2.6 * k, col, fr);
        else this.glyph(ctx, 'circ', o.x, o.y, 1.5 * k, col, fr);
      }
      for (const c of w.cps) {
        this.mapXY(c.pos, W, H, o);
        const r = big ? 13 : 7.5;
        ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, E.TAU); ctx.fillStyle = 'rgba(8,12,20,.85)'; ctx.fill();
        ctx.lineWidth = big ? 3 : 2; ctx.strokeStyle = COL[c.owner || 'neutral']; ctx.setLineDash(c.owner === team || !c.owner ? [] : [3, 2]); ctx.stroke(); ctx.setLineDash([]);
        if (Math.abs(c.cap) < 0.999 && Math.abs(c.cap) > 0.01) { ctx.beginPath(); ctx.arc(o.x, o.y, r + 2.5, -Math.PI / 2, -Math.PI / 2 + E.TAU * Math.abs(c.cap)); ctx.strokeStyle = COL[c.cap > 0 ? 'aegis' : 'verdant']; ctx.stroke(); }
        ctx.fillStyle = '#fff'; ctx.font = `700 ${big ? 13 : 9}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(c.name[0], o.x, o.y + 0.5);
      }
      if (me) {
        this.mapXY(me.pos, W, H, o); ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(-g.renderer.camera.yaw + Math.PI);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4.5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      } else if (g.state === 'commander') { const c = g.renderer.camera.cmd; this.mapXY(c, W, H, o); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(o.x - 12, o.y - 8, 24, 16); }
      for (const s of w.strikes || []) { this.mapXY(s.pos, W, H, o); ctx.strokeStyle = '#ff3020'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(o.x, o.y, 5 + (performance.now() / 80 % 4), 0, E.TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(o.x, o.y, E.WEAPONS.orbital.splash * 2.2 * scale + 3, 0, E.TAU); ctx.setLineDash([2, 2]); ctx.stroke(); ctx.setLineDash([]); }
    }

    // ── per-frame ────────────────────────────────────────────
    update(dt, w, P, u) {
      const $ = this.$, g = this.game, st = g.state; if (!this.el) return;
      const play = st === 'play' && u;
      const kind = play ? (u.mode === 'boarding' ? 'boarding' : u.kind) : '';
      this.frameN = (this.frameN || 0) + 1;
      this.kind = kind;
      // tickets + posts
      if (this.frameN % 6 === 0) {
        for (const [el, f] of [[$.tA, 'aegis'], [$.tV, 'verdant']]) {
          const T = w.teams[f]; this.tx(el.querySelector('.h-tk'), T.tickets); this.wd(el.querySelector('i'), T.tickets / T.startTickets);
          this.cl(el, 'low', T.tickets <= 25); this.cl(el, 'mine', f === g.team);
        }
        w.cps.forEach((c, i) => { const e = $.cps[i]; e.dataset.o = c.owner || 'neutral'; this.cl(e, 'contested', c.contested); this.cl(e, 'ours', c.owner === g.team); e.querySelector('i').style.cssText = `width:${Math.abs(c.cap) * 100}%;background:${COL[c.cap >= 0 ? 'aegis' : 'verdant']}`; });
        this.drawMap(this.mctx, 220, 160, w, false);
        this.objectives(w);
        this.stageBanner(w, kind);
      }
      this.show($.unit, play && kind !== 'capital'); this.show($.cross, play);
      this.show($.mapwrap, !(st === 'deploy' || st === 'ended' || st === 'commander'));
      this.show($.stage, w.space && (kind === 'capital' || kind === 'fighter' || st === 'commander'));
      this.show($.veh, kind === 'vehicle'); this.show($.fl, kind === 'fighter'); this.show($.br, kind === 'capital'); this.show($.board, kind === 'boarding'); this.show($.cmd, st === 'commander');
      this.el.dataset.kind = kind || st;
      this.keyHints(u, st, kind);
      if (play) {
        const d = u.def, W = E.WEAPONS[d.weapon], A = d.alt ? E.WEAPONS[d.alt] : (u.kind === 'capital' ? E.WEAPONS.orbital : null);
        if (this._uid !== u.id) { this._uid = u.id; $.uname.innerHTML = `<b>${esc(d.name).toUpperCase()}</b> <span>${TNAME[u.team]}</span>`; this.tx($.weap.querySelector('.wn'), u.kind === 'capital' ? 'Main Batteries' : W.name); this.tx($.abil.querySelector('.an'), A ? A.name : ''); this.show($.abil, !!A);
          this.tx($.abil.querySelector('.key'), u.kind === 'infantry' || u.kind === 'vehicle' ? 'G' : 'G'); this.show($.sh, !!u.maxShield);
          this.show($.abil2, u.type === 'engineer'); this.tx($.abil2.querySelector('.an'), 'Barricade'); this.show($.tools, u.type === 'engineer'); this.show($.st, u.kind === 'infantry');
          this.show($.pips, u.kind === 'fighter'); $.pips.querySelector('.ord label').textContent = A ? A.name.toUpperCase() : 'ORDNANCE'; this.show($.pips.querySelector('.carry'), !!d.carry); this.show($.pips.querySelector('.cm'), !!d.cm); this.show($.weap, u.kind !== 'capital');
          this.perkChips(u); }
        this.wd($.hp.querySelector('i'), u.hp / u.maxHp); this.tx($.hp.querySelector('span'), Math.ceil(u.hp));
        this.cl($.hp, 'crit', u.hp < u.maxHp * 0.3);
        if (u.maxShield) this.wd($.sh.querySelector('i'), u.shield / u.maxShield);
        if (u.kind === 'infantry') { this.wd($.st.querySelector('i'), u.stam == null ? 1 : u.stam); this.cl($.st, 'low', u.winded || (u.stam != null && u.stam < 0.2)); }
        const hi = $.heat.querySelector('i'); this.wd(hi, u.heat || 0); this.cl($.heat, 'hot', !!u.hot); $.heat.style.visibility = W && W.heat ? '' : 'hidden';
        if (A) { const cdT = u.kind === 'capital' ? w.teams[u.team].strikeT : u.altT, cd = E.clamp01(cdT / (A.cd || 1 / (A.rate || 1))); this.wd($.abil.querySelector('i'), 1 - cd); this.cl($.abil, 'ready', cd <= 0); }
        if (u.type === 'engineer') {
          this.tools(u);
        }
        // crosshair bloom (radians -> px) and hit marker
        const H = this.cv.height || 720, bl = (u.bloom || 0) * (H / 2) / 0.65, spread = 5 + bl + (u.heat || 0) * 6 - g.renderer.camera.zoom * 3;
        $.cross.style.setProperty('--g', Math.max(3, spread).toFixed(1) + 'px');
        this.cl($.cross, 'enemy', !!(g.aimInfo && g.aimInfo.target)); this.cl($.cross, 'air', u.kind === 'fighter' || u.kind === 'capital');
        this.hitT -= dt; $.hitm.style.opacity = Math.max(0, this.hitT * 4);
        const scope = u.type === 'sniper' && g.renderer.camera.zoom > 0.85; this.show($.scope, scope); this.cl($.cross, 'scoped', scope);
        // work ring (repair, charge, build)
        const wk = u.work || 0; this.cl($.work, 'on', wk > 0.01); if (wk > 0.01) { $.work.querySelector('.v').style.strokeDashoffset = String(106.8 * (1 - wk)); this.tx($.work.querySelector('span'), u.tool === 2 ? 'ARMING' : 'REPAIR'); }
        // suppression vignette + stance
        const sup = u.kind === 'infantry' ? (u.supp || 0) : 0; $.vig.style.setProperty('--supp', sup.toFixed(2));
        // capture bar
        let cp = null; for (const c of w.cps) if (E.distXZ2(u.pos, c.pos) < c.r * c.r && (u.kind === 'infantry' || u.kind === 'vehicle')) cp = c;
        if (cp && (cp.owner !== u.team || Math.abs(cp.cap) < 0.999)) {
          this.show($.cap, true); const mine = u.team === 'aegis' ? cp.cap : -cp.cap;
          this.tx($.cap.querySelector('span'), cp.contested ? 'CONTESTED — ' + cp.name.toUpperCase() : (mine < 0 ? 'NEUTRALIZING ' : 'CAPTURING ') + cp.name.toUpperCase());
          const i = $.cap.querySelector('i'); i.style.width = Math.abs(cp.cap) * 100 + '%'; i.style.background = COL[cp.cap >= 0 ? 'aegis' : 'verdant'];
        } else this.show($.cap, false);
        this.prompts(u, w, g, kind);
        if (kind === 'vehicle') this.vehUpdate(u, dt);
        if (kind === 'fighter') this.airUpdate(u, w, dt);
        if (kind === 'capital') this.bridgeUpdate(u, w, dt);
        if (kind === 'boarding') this.boardUpdate(u, w, dt);
        this.squadChip(w, g);
      } else {
        this.cl($.vig, 'core', false); this.show($.cap, false); this.show($.scope, false); this.show($.prompt, false); this.show($.squad, false); this._uid = 0; $.vig.style.setProperty('--supp', '0');
        if (st === 'commander') this.cmdUpdate(dt, w);
      }
      $.dead.style.display = st === 'dead' ? '' : 'none';
      if (st === 'deploy' && this.layerKind === 'deploy' && this.frameN % 6 === 0) this.refreshDeploy(w, P);
      // announcements
      this.annT -= dt;
      if (this.annT <= 0) { if (this.ann.length) { const a = this.ann.shift(); $.ann.innerHTML = `<div class="${a.cls}">${a.text}</div>`; $.ann.classList.remove('show'); void $.ann.offsetWidth; $.ann.classList.add('show'); this.annT = 3.2; } else if (this.annT < -0.4) $.ann.classList.remove('show'); }
      const now = performance.now();
      if (this.feed.length && now - this.feed[0].t > 6500) { this.feed.shift().el.remove(); }
      if (this.pops.length && now - this.pops[0].t > 2200) { this.pops.shift().el.remove(); }
      this.overlay(dt, w, u, play, kind);
    }

    perkChips(u) {
      const names = (u.perks || []).map(id => { const p = E.SIM.perkById && E.SIM.perkById(id); return p ? p.name : id; });
      this.$.chips.innerHTML = names.map(n => `<span>${esc(n)}</span>`).join('');
    }
    tools(u) {
      const spans = this.$.tools.querySelectorAll('span'); spans.forEach((s, i) => this.cl(s, 'on', i === (u.tool || 0)));
      this.tx(this.$.tools.querySelector('.mines'), 'MINES ' + (u.mines != null ? u.mines : 0));
      this.cl(this.$.abil2, 'ready', !(u.buildT > 0));
      if (u.buildT > 0) this.wd(this.$.abil2.querySelector('i'), 1 - u.buildT / 4); else this.wd(this.$.abil2.querySelector('i'), 1);
    }
    // vault / mantle progress, work prompts, call-in hints
    prompts(u, w, g, kind) {
      let msg = '';
      if (kind === 'infantry') {
        if (u.vault > 0) msg = (u.vaultKind === 'mantle' ? 'MANTLING ' : 'VAULTING ') + Math.round(u.vault * 100) + '%';
        else if (u.type === 'engineer' && u.tool === 1) msg = u.work > 0.01 ? 'REPAIRING' : 'TORCH: aim at a damaged friendly vehicle or barricade and hold fire';
        else if (u.type === 'engineer' && u.tool === 2) msg = u.work > 0.01 ? 'PLANTING CHARGE' : 'CHARGE: aim at an enemy vehicle or structure and hold fire';
        else if (u.stance === 2) msg = 'SLIDING';
        else if (u.winded) msg = 'OUT OF BREATH';
        if ((u.supp || 0) > 0.55) msg = 'SUPPRESSED — GET INTO COVER';
      } else if (kind === 'vehicle') {
        if (u.crip === 2) msg = 'ON FIRE — ABANDON OR REPAIR'; else if (u.crip === 1) msg = 'MOBILITY KILLED';
      }
      this.tx(this.$.prompt, msg); this.show(this.$.prompt, !!msg); this.cl(this.$.prompt, 'warn', (u.supp || 0) > 0.55 || u.crip > 0);
    }
    squadChip(w, g) {
      const n = g.squad.filter(id => { const s = w.byId(id); return s && s.alive; }).length;
      this.show(this.$.squad, n > 0); if (n) this.tx(this.$.squad, `SQUAD ${n} · ${g.squadMode || 'FOLLOWING'}`);
    }
    // the objective tracker: command-post lines plus every live map objective
    objectives(w) {
      const rows = [];
      for (const o of w.objs || []) {
        if (o.done) continue;
        const label = o.label || (o.type === 'destroy' ? 'Destroy the target' : o.type === 'defend' ? 'Defend the target' : o.type === 'uplink' ? 'Hold the uplink' : o.type);
        const mine = !o.team || o.team === this.game.team;
        rows.push(`<div class="ob${o.contested ? ' contested' : ''}"><span>${esc(label)}${o.type === 'uplink' && o.contested ? ' — CONTESTED' : ''}</span><i><b style="width:${Math.round(E.clamp01(o.frac) * 100)}%"></b></i><em>${mine ? '' : 'ENEMY · '}${o.type === 'defend' ? 'HOLD' : o.type === 'destroy' ? 'DESTROY' : 'HOLD'}</em></div>`);
      }
      const html = rows.join(''); if (this.$.obj._v !== html) { this.$.obj._v = html; this.$.obj.innerHTML = html ? '<div class="ob-h">OBJECTIVES</div>' + html : ''; }
    }
    stageBanner(w, kind) {
      const $ = this.$; if (!w.space || !E.SIM.spaceState) return;
      const g = this.game, S = E.SIM.spaceState(w, g.team); if (!S) return;
      this.tx($.stage.querySelector('.st-n'), 'ORBIT ' + S.stage + '/3'); this.tx($.stage.querySelector('.st-name'), S.stageName.toUpperCase());
      this.wd($.stage.querySelector('.st-sup i'), 0.5 + 0.5 * (S.superiority || 0));
      const f = (a, name) => `<span>${name} ${a.ships} <i style="--f:${Math.round(a.hull * 100)}%"></i> ${Math.round(a.hull * 100)}%</span>`;
      const html = f(S.own, 'OURS') + f(S.enemy, 'THEIRS') + (S.escort && S.escort.length ? '<span class="warnt">ESCORT NEEDED</span>' : '') + (S.boarding ? '<span class="warnt">BOARDING</span>' : '');
      if ($.stage.querySelector('.st-fl')._v !== html) { $.stage.querySelector('.st-fl')._v = html; $.stage.querySelector('.st-fl').innerHTML = html; }
    }
    keyHints(u, st, kind) {
      const key = (st === 'commander' ? 'commander' : kind) + (u ? u.type : ''); if (key === this.keyKind) return; this.keyKind = key;
      const C = E.CONTROLS.forUnit(u, st === 'commander' ? 'commander' : st);
      this.$.keys.innerHTML = C ? C.hint.map(([k, l]) => `<span>${k ? `<kbd>${esc(k)}</kbd>` : ''}${esc(l)}</span>`).join('') : '';
    }

    // vehicle: hull diagram with turret angle, armor zone flash, speed, crippled state
    vehUpdate(u, dt) {
      const el = this.$.veh, tur = el.querySelector('.tur'), rel = E.SIM.angDiff(u.aimYaw !== undefined ? u.aimYaw : u.yaw, u.yaw);
      tur.setAttribute('transform', `rotate(${(-rel * 180 / Math.PI).toFixed(1)})`);
      this.cl(el, 'limited', !!u.aimLimited); this.cl(el, 'crip', u.crip === 1); this.cl(el, 'burn', u.crip === 2);
      this.tx(el.querySelector('.veh-spd b'), Math.round(Math.abs(u.spd != null ? u.spd : Math.hypot(u.vel.x, u.vel.z)) * 3.6));
      this.tx(el.querySelector('.veh-state'), u.aimLimited ? 'TURRET LIMIT' : u.crip === 2 ? 'BURNING' : u.crip === 1 ? 'CRIPPLED' : 'OPERATIONAL');
      this.zoneT -= dt; const z = this.zoneT > 0 ? this.zone : '';
      el.querySelectorAll('.z').forEach(p => this.cl(p, 'hit', z && p.classList.contains('z-' + z)));
      this.tx(el.querySelector('.veh-zone'), this.zoneT > 0 ? this.zoneTxt : '');
    }

    // ── world-anchored markers ───────────────────────────────
    overlay(dt, w, u, play, kind) {
      const ctx = this.ctx, g = this.game, cam = g.renderer.camera, W = this.cv.width, H = this.cv.height, o = { x: 0, y: 0, vis: false }, R = this.rem || 16;
      ctx.clearRect(0, 0, W, H);
      if (g.state === 'deploy' || g.state === 'ended' || (g.paused && this.layerKind)) return;
      const cp3 = cam.cam.position, team = g.team;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const c of w.cps) {
        cam.project({ x: c.pos.x, y: c.pos.y + 16, z: c.pos.z }, o);
        const d = Math.hypot(c.pos.x - cp3.x, c.pos.z - cp3.z);
        let x = o.x, y = o.y; const off = !o.vis || x < 40 || x > W - 40 || y < 70 || y > H - 60;
        if (off) { if (!play) continue; const a = Math.atan2(c.pos.x - cp3.x, c.pos.z - cp3.z) - cam.yaw; x = W / 2 - Math.sin(a) * (W / 2 - 60); y = H / 2 - Math.cos(a) * (H / 2 - 90); x = E.clamp(x, 44, W - 44); y = E.clamp(y, 80, H - 70); }
        const col = COL[c.owner || 'neutral'], s = R * 0.72;
        ctx.globalAlpha = off ? 0.65 : 0.95; ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = 'rgba(6,10,18,.78)'; ctx.fillRect(-s, -s, s * 2, s * 2); ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.setLineDash(c.owner && c.owner !== team ? [4, 3] : []); ctx.strokeRect(-s, -s, s * 2, s * 2); ctx.setLineDash([]);
        if (Math.abs(c.cap) < 0.999) { ctx.fillStyle = COL[c.cap >= 0 ? 'aegis' : 'verdant']; ctx.globalAlpha *= 0.55; const k = Math.abs(c.cap); ctx.fillRect(-s, s - 2 * s * k, s * 2, 2 * s * k); }
        ctx.restore(); ctx.globalAlpha = off ? 0.65 : 1;
        ctx.fillStyle = '#fff'; ctx.font = `700 ${R * 0.85}px system-ui`; ctx.fillText(c.name[0], x, y + 1);
        ctx.font = `600 ${R * 0.62}px system-ui`; ctx.fillStyle = '#e8eefc'; ctx.fillText(Math.round(d) + 'm', x, y + R * 1.5);
      }
      ctx.globalAlpha = 1;
      // objective markers
      for (const ob of w.objs || []) {
        if (ob.done || !ob.pos) continue;
        cam.project({ x: ob.pos.x, y: (w.terrain.height(ob.pos.x, ob.pos.z) || 0) + 12, z: ob.pos.z }, o); if (!o.vis) continue;
        ctx.save(); ctx.translate(o.x, o.y); ctx.fillStyle = '#ffd04a'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, R * 0.8); ctx.lineTo(R * 0.7, -R * 0.4); ctx.lineTo(-R * 0.7, -R * 0.4); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
        ctx.font = `700 ${R * 0.62}px system-ui`; ctx.fillStyle = '#ffd04a'; ctx.fillText((ob.label || ob.type).toUpperCase(), o.x, o.y - R * 1.1);
      }
      // mines we can see
      if (play) for (const m of w.mines || []) { if (!(m.team === team || m.seen)) continue; cam.project(m, o); if (!o.vis) continue; const d = Math.hypot(m.x - cp3.x, m.z - cp3.z); if (d > 70) continue; ctx.strokeStyle = m.team === team ? '#ffd04a' : '#ff3a2a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(o.x, o.y, R * 0.55, 0, E.TAU); ctx.stroke(); ctx.beginPath(); ctx.moveTo(o.x - R * 0.35, o.y); ctx.lineTo(o.x + R * 0.35, o.y); ctx.moveTo(o.x, o.y - R * 0.35); ctx.lineTo(o.x, o.y + R * 0.35); ctx.stroke(); if (m.team !== team) { ctx.fillStyle = '#ff3a2a'; ctx.font = `700 ${R * 0.55}px system-ui`; ctx.fillText('MINE', o.x, o.y - R * 0.95); } }
      // capital ship plates (hollow frame = enemy)
      for (const s of w.units) {
        if (s.kind !== 'capital' || !s.alive) continue;
        cam.project({ x: s.pos.x, y: s.pos.y + s.h * 1.6, z: s.pos.z }, o); if (!o.vis || (u && u.id === s.id)) continue;
        const fr = s.team === team, col = COL[s.team], bw = R * 6, tgt = u && u.tgtId === s.id;
        ctx.fillStyle = 'rgba(6,10,18,.7)'; ctx.fillRect(o.x - bw / 2 - 2, o.y - 5, bw + 4, 11);
        ctx.fillStyle = '#4aa8ff'; ctx.fillRect(o.x - bw / 2, o.y - 3, bw * E.clamp01(s.shield / (s.maxShield || 1)), 2.5);
        ctx.fillStyle = col; ctx.fillRect(o.x - bw / 2, o.y, bw * E.clamp01(s.hp / s.maxHp), 3.5);
        if (tgt) { ctx.strokeStyle = '#ffd04a'; ctx.lineWidth = 2; ctx.strokeRect(o.x - bw / 2 - 5, o.y - 22, bw + 10, 36); }
        ctx.font = `700 ${R * 0.68}px system-ui`; ctx.fillStyle = fr ? '#fff' : col; ctx.fillText((fr ? '▪ ALLIED ' : '▫ ENEMY ') + s.def.name.toUpperCase() + (s.retreat ? ' · RETREATING' : '') + (s.captured ? ' · CAPTURED' : ''), o.x, o.y - R * 0.95);
      }
      if (play) {
        const t = g.aimInfo && g.aimInfo.target;
        if (t && t.alive && t.kind !== 'capital') {
          cam.project({ x: t.pos.x, y: t.pos.y + t.h + (t.kind === 'infantry' ? 0.5 : 1.5), z: t.pos.z }, o);
          if (o.vis) { const bw = R * 3; ctx.fillStyle = 'rgba(6,10,18,.75)'; ctx.fillRect(o.x - bw / 2 - 1, o.y - 3, bw + 2, 7); ctx.fillStyle = COL[t.team]; ctx.fillRect(o.x - bw / 2, o.y - 2, bw * E.clamp01(t.hp / t.maxHp), 5); if (t.team !== team) { ctx.strokeStyle = COL[t.team]; ctx.lineWidth = 1; ctx.strokeRect(o.x - bw / 2 - 1, o.y - 3, bw + 2, 7); } }
        }
        ctx.font = `600 ${R * 0.6}px system-ui`;
        if (kind === 'infantry' || kind === 'vehicle') for (const a of w.units) {
          if (!a.alive || a.team !== team || a === u || a.kind === 'capital' || a.kind === 'turret') continue;
          const d2 = E.V3.distance2(a.pos, u.pos); if (d2 > (a.kind === 'infantry' ? 90 * 90 : 500 * 500)) continue;
          cam.project({ x: a.pos.x, y: a.pos.y + a.h + (a.kind === 'infantry' ? 0.45 : 2), z: a.pos.z }, o); if (!o.vis) continue;
          ctx.fillStyle = a.pid ? '#fff' : (g.squad.includes(a.id) ? '#ffe680' : 'rgba(120,190,255,.85)');
          ctx.beginPath(); ctx.moveTo(o.x, o.y + 4); ctx.lineTo(o.x - 4, o.y - 3); ctx.lineTo(o.x + 4, o.y - 3); ctx.fill();
          if (a.pid && w.players[a.pid]) ctx.fillText(w.players[a.pid].name, o.x, o.y - 10);
        }
        if (kind === 'fighter') this.airOverlay(ctx, u, w, cam, o, W, H, R);
        else if (kind === 'capital') this.bridgeOverlay(ctx, u, w, cam, o, W, H, R);
        else if (u.def.alt === 'missile' || u.def.alt === 'rocket' || u.def.alt === 'aamissile') {
          const lk = E.SIM.aimTarget(w, u, E.SIM.eyeOf(u), E.SIM.dirOf(cam.yaw, cam.pitch), 0.12, 500, (e) => e.kind !== 'infantry');
          if (lk) { cam.project(lk.pos, o); if (o.vis) { const s = R; ctx.strokeStyle = u.altT <= 0 ? '#ff4030' : '#ffb040'; ctx.lineWidth = 2; ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(Math.PI / 4); ctx.strokeRect(-s / 2, -s / 2, s, s); ctx.restore(); ctx.font = `700 ${R * 0.62}px system-ui`; ctx.fillStyle = ctx.strokeStyle; ctx.fillText(u.altT <= 0 ? 'LOCK' : 'RELOADING', o.x, o.y + R * 1.4); } }
        }
        // damage direction arcs (and armor-zone coloured when in a vehicle)
        for (let i = this.dmgDirs.length - 1; i >= 0; i--) {
          const dd = this.dmgDirs[i]; dd.t -= dt; if (dd.t <= 0) { this.dmgDirs.splice(i, 1); continue; }
          const a = Math.atan2(dd.x - u.pos.x, dd.z - u.pos.z) - cam.yaw;
          ctx.strokeStyle = `rgba(255,60,40,${Math.min(1, dd.t * 1.4)})`; ctx.lineWidth = R * 0.5; ctx.beginPath(); ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.2, -Math.PI / 2 - a - 0.26, -Math.PI / 2 - a + 0.26); ctx.stroke();
        }
      }
    }

    // ── events: announcer, feed, score ──────────────────────
    events(events, w) {
      const g = this.game, me = g.pid, mine = g.team, u = g.unit();
      const ours = (t) => t === mine, nm = (id) => { const s = w.byId(id); return s ? E.unitName(s.kind, s.type) : 'ship'; };
      for (const e of events) {
        const t = e.type;
        if (t === 'death') {
          if (e.kind === 'turret' && !e.byPid) continue;
          if (e.kind === 'infantry' && !e.byPid && !e.pid && this.feed.length > 3) continue;
          const el = document.createElement('div'); el.className = 'h-kill' + (e.byPid === me ? ' me' : '') + (e.pid === me ? ' dead' : '');
          const W = E.WEAPONS[e.wk];
          el.innerHTML = `<b class="${e.kteam || ''}">${esc(e.killer)}</b><span>${W ? esc(W.name) : (e.wk === 'crash' ? 'crash' : '')}</span><b class="${e.team}">${esc(e.victim)}</b>`;
          this.$.feed.appendChild(el); this.feed.push({ el, t: performance.now() }); if (this.feed.length > 5) this.feed.shift().el.remove();
          if (e.pid === me) this.$.dead.innerHTML = `<div class="k1">YOU WERE KILLED</div><div class="k2">${esc(e.killer)}${W ? ' · ' + esc(W.name) : ''}</div>`;
        } else if (t === 'hit') {
          if (e.by === me) { this.hitT = 0.3; this.$.hitm.className = 'hitm' + (e.kill ? ' kill' : e.head ? ' head' : e.sh ? ' sh' : ''); }
          if (e.to === me) { g.hurt = Math.min(1, (g.hurt || 0) + 0.25 + e.dmg / 120); g.renderer.camera.shake(Math.min(0.4, e.dmg / 150)); if (e.from) this.dmgDirs.push({ x: e.from.x, z: e.from.z, t: 1.2 }); }
        } else if (t === 'score' && e.to === me) {
          this.total += e.pts; const el = document.createElement('div'); el.className = 'h-pop'; el.innerHTML = `<b>+${e.pts}</b> ${esc(e.why)}`;
          this.$.pops.appendChild(el); this.pops.push({ el, t: performance.now() }); if (this.pops.length > 5) this.pops.shift().el.remove();
        } else if (t === 'capture') { const c = w.cps[e.cp]; this.announce((e.team === mine ? 'WE CAPTURED ' : 'ENEMY CAPTURED ') + c.name.toUpperCase(), e.team === mine ? 'good' : 'bad'); }
        else if (t === 'neutral') { const c = w.cps[e.cp]; this.announce((e.prev === mine ? 'WE LOST ' : 'ENEMY LOST ') + c.name.toUpperCase(), e.prev === mine ? 'bad' : 'good'); }
        else if (t === 'announce') {
          const k = e.key, o = ours(e.team);
          if (k === 'capitalDown') this.announce(o ? 'OUR FLAGSHIP IS LOST' : 'ENEMY FLAGSHIP DESTROYED', o ? 'bad' : 'good');
          else if (k === 'ticketsHalf') this.announce(o ? 'OUR REINFORCEMENTS AT HALF' : 'ENEMY REINFORCEMENTS AT HALF', o ? 'bad' : 'good');
          else if (k === 'ticketsLow') this.announce(o ? 'WE ARE RUNNING OUT OF TROOPS' : 'THE ENEMY IS BREAKING — FINISH THEM', o ? 'bad' : 'good');
          else if (k === 'boardingAlarm') this.announce(o ? 'BOARDERS ON THE DECKS — REPEL THEM' : 'BOARDING ACTION UNDERWAY', o ? 'bad' : 'good');
          else if (k === 'bridgeLost') this.announce(o ? 'BRIDGE LOST — SHIP UNCONTROLLED' : 'ENEMY BRIDGE DESTROYED', o ? 'bad' : 'good');
          else if (k === 'shipCaptured') this.announce(o ? 'A SHIP WAS CAPTURED BY THE ENEMY' : 'WE HAVE CAPTURED AN ENEMY SHIP', o ? 'bad' : 'good');
          else if (k === 'shipRetreated') this.announce(o ? 'ONE OF OUR SHIPS HAS WITHDRAWN' : 'AN ENEMY SHIP HAS WITHDRAWN', o ? 'bad' : 'good');
          else if (k === 'fleetVictory') this.announce(o ? 'ORBITAL SUPREMACY — THE FLEET HOLDS THE HIGH GROUND' : 'THE ENEMY FLEET HOLDS ORBIT', o ? 'good' : 'bad');
        } else if (t === 'stageChange') this.announce(`${ours(e.team) ? 'OUR' : 'ENEMY'} FLEET: ${String(e.name || '').toUpperCase()}`, ours(e.team) ? 'good' : 'bad');
        else if (t === 'shipDestroyed') this.announce((ours(e.team) ? 'WE LOST THE ' : 'ENEMY LOST THE ') + nm(e.uid).toUpperCase(), ours(e.team) ? 'bad' : 'good');
        else if (t === 'shipRetreating' && ours(e.team)) this.toast(nm(e.uid).toUpperCase() + ' IS RETREATING');
        else if (t === 'shipStranded' && ours(e.team)) this.toast('A SHIP IS STRANDED');
        else if (t === 'shieldDown' && ours(e.team) && u && u.id === e.uid) this.toast(['FORE', 'AFT', 'PORT', 'STARBOARD'][e.arc] + ' SHIELD DOWN');
        else if (t === 'shieldCollapse' && ours(e.team)) this.announce('SHIELDS COLLAPSED', 'bad');
        else if (t === 'sysDestroyed') { if (ours(e.team)) this.announce(String(e.label || e.sys).toUpperCase() + ' DESTROYED', 'bad'); else if (u && u.tgtId === e.uid) this.toast('TARGET ' + String(e.label || e.sys).toUpperCase() + ' DESTROYED'); }
        else if (t === 'hullBreach' && ours(e.team)) this.announce('HULL BREACH', 'bad');
        else if (t === 'coreBreach' && ours(e.team)) this.announce('REACTOR CORE BREACH — ' + e.t + 's', 'bad');
        else if (t === 'brace' && u && u.id === e.uid) this.toast('BRACING FOR IMPACT');
        else if (t === 'boardingLaunched') this.announce(ours(e.team) ? 'BOARDING PODS AWAY — ETA ' + Math.round(e.eta || 0) + 's' : 'ENEMY BOARDING PODS INBOUND', ours(e.team) ? 'good' : 'bad');
        else if (t === 'boardingResult') this.announce(({ shipLost: 'SHIP LOST WITH ALL HANDS', podsLost: 'BOARDING PODS DESTROYED', captured: 'SHIP CAPTURED', repelled: 'BOARDERS REPELLED', sabotaged: 'SABOTAGE COMPLETE' })[e.result] || ('BOARDING: ' + String(e.result).toUpperCase()), 'good');
        else if (t === 'boardNode') this.toast(String(e.node).toUpperCase() + ' SABOTAGED');
        else if (t === 'boardDenied') this.toast(e.reason === 'shieldsUp' ? 'BOARDING DENIED — TARGET SHIELDS ARE UP' : 'BOARDING DENIED — NO HANGAR');
        else if (t === 'strikeWarn') { if (e.team !== mine && u && E.distXZ2(u.pos, e.pos) < 90 * 90) this.announce('INCOMING ORBITAL STRIKE — MOVE!', 'bad'); else if (e.team === mine) this.toast('ORBITAL STRIKE INBOUND'); }
        else if (t === 'strikeBlocked' && e.team === mine) this.announce('STRIKE BLOCKED BY GROUND SHIELD', 'bad');
        else if (t === 'strikeDenied' && e.team === mine) this.toast('STRIKE DENIED — NO BATTERY IN POSITION');
        else if (t === 'ion') this.toast((e.team === mine ? 'OUR' : 'ENEMY') + ' ION CANNON FIRED — SHIELDS STRIPPED');
        else if (t === 'ionFlip') this.announce(e.team === mine ? 'ION CANNON UNDER OUR CONTROL' : 'ION CANNON LOST TO THE ENEMY', e.team === mine ? 'good' : 'bad');
        else if (t === 'structureDown') { const nmS = (E.TURRETS[e.utype] || {}).name || 'STRUCTURE'; if (e.utype === 'shieldgen') this.announce(ours(e.team) ? 'OUR SHIELD GENERATOR IS DOWN' : 'ENEMY SHIELD GENERATOR DESTROYED', ours(e.team) ? 'bad' : 'good'); else this.toast((ours(e.team) ? 'LOST: ' : 'DESTROYED: ') + nmS.toUpperCase()); }
        else if (t === 'objAdd') this.announce('NEW OBJECTIVE', 'good');
        else if (t === 'objDone') this.announce(e.success ? 'OBJECTIVE COMPLETE' : 'OBJECTIVE FAILED', e.success ? 'good' : 'bad');
        else if (t === 'troopsLost') this.announce(ours(e.team) ? 'LANDER LOST — TROOPS LOST' : 'ENEMY LANDER DESTROYED', ours(e.team) ? 'bad' : 'good');
        else if (t === 'airAccepted') { if (e.to === me || ours(e.team)) this.toast(`${String(e.role).toUpperCase()} ${e.task === 'drop' ? 'DROP' : 'STRIKE'} ACCEPTED — ETA ${e.eta || '?'}s`); }
        else if (t === 'airInbound' && ours(e.team)) this.toast('AIR SUPPORT INBOUND');
        else if (t === 'airWeaponsAway' && ours(e.team)) this.toast('WEAPONS AWAY');
        else if (t === 'airUnavailable' && (e.to === me || ours(e.team))) this.toast(e.reason === 'cooldown' ? `AIR SUPPORT RELOADING — ${e.wait}s` : 'NO AIRCRAFT AVAILABLE');
        else if (t === 'airDrop' && ours(e.team)) this.toast(`LANDER DEPLOYED ${e.n} TROOPS`);
        else if (t === 'airLoad' && e.to === me) this.toast(`${e.n} TROOPS ABOARD — HOVER LOW AND PRESS X TO DROP`);
        else if (t === 'order' && e.to === me) this.toast(`ORDER: ${String(e.order).toUpperCase()} · ${e.n} UNITS`);
        else if (t === 'suppress' && e.to === me) this.suppT = 0.6;
        else if (t === 'armor' && e.to === me) { this.zone = e.zone; this.zoneT = 1.6; this.zoneTxt = `${String(e.zone).toUpperCase()} HIT · ×${(e.mul || 1).toFixed(2)}`; }
        else if (t === 'ram' && u && e.uid === u.id) this.toast('RAM · CLOSING ' + Math.round(e.closing || 0) + ' m/s');
        else if (t === 'band' && e.to === me) this.toast('ENTERING ' + (BAND[e.band] || e.band).toUpperCase() + ' ALTITUDE');
        else if (t === 'mineSpotted' && e.team !== mine) this.toast('ENEMY MINE SPOTTED');
        else if (t === 'mineBlast') this.toast('MINE DETONATED');
        else if (t === 'tool' && e.to === me) this.toast(['WEAPON', 'REPAIR TORCH', 'DEMOLITION CHARGE'][e.tool] + ' EQUIPPED');
        else if (t === 'overheat' && e.to === me) this.toast('WEAPON OVERHEATED');
        else if (t === 'powerShift' && e.to === me) this.toast('POWER: ' + String(e.mode).toUpperCase());
        else if (t === 'noLock' && e.to === me) this.toast('NO LOCK');
        else if (t === 'crash' && u && e.uid === u.id) this.announce('CRASHED', 'bad');
        else if (t === 'launchOrder' && ours(e.team)) this.toast('FIGHTER WING LAUNCHED');
        else if (t === 'gameOver') this.announce(e.winner === mine ? 'VICTORY' : 'DEFEAT', e.winner === mine ? 'good big' : 'bad big');
      }
    }
    announce(text, cls) { if (this.ann.length < 4) this.ann.push({ text: esc(text), cls: cls || '' }); }
    toast(t) { const el = this.$ && this.$.toast; if (!el) return; el.textContent = t; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
    box(x0, y0, x1, y1) { const s = this.$.sel; if (x0 === undefined) { s.style.display = 'none'; return; } s.style.cssText = `display:block;left:${Math.min(x0, x1)}px;top:${Math.min(y0, y1)}px;width:${Math.abs(x1 - x0)}px;height:${Math.abs(y1 - y0)}px`; }
    setLayer(kind, html) { this.layerKind = kind; this.$.layer.innerHTML = html; this.$.layer.className = 'h-layer ' + (kind ? 'on ' + kind : ''); }

    // ── deploy screen: class cards, perks per tier, spawn point ──
    perkSel(cls) {
      const s = this.game.settings; s.loadouts = s.loadouts || {};
      let sel = s.loadouts[cls]; if (!sel) sel = s.loadouts[cls] = [E.PERKS[cls].t1[0].id, E.PERKS[cls].t2[0].id];
      return sel;
    }
    showDeploy() {
      const g = this.game, w = g.world, cls = CLASSES[this.cls];
      const cards = CLASSES.map((c, i) => { const d = E.INFANTRY[c], W = E.WEAPONS[d.weapon], A = E.WEAPONS[d.alt]; return `<button class="d-class${i === this.cls ? ' on' : ''}" data-i="${i}" aria-pressed="${i === this.cls}"><span class="k">${i + 1}</span><b>${d.name}</b><em>${W.name} · ${A.name}</em><p>${d.desc}</p><div class="d-st"><span>HP ${d.hp}</span><span>SPD ${d.speed}</span></div></button>`; }).join('');
      this.setLayer('deploy', `
        <div class="d-wrap">
          <div class="d-col">
            <div class="d-h">DEPLOY AS</div>${cards}
          </div>
          <div class="d-mid">
            <div class="d-h">SELECT A COMMAND POST <span class="d-sub">${esc(w.planet.biomeDef.name)} · ${esc(w.planet.biomeDef.challenge.name)}</span></div>
            <div class="d-map"><canvas width="660" height="480"></canvas>${w.cps.map(c => `<button class="d-cp" data-cp="${c.id}" aria-label="${esc(c.name)}">${c.name[0]}</button>`).join('')}</div>
            <div class="d-perks"></div>
            <div class="d-row"><button class="gc-btn primary d-go">DEPLOY <span class="k">ENTER</span></button><span class="d-wait"></span></div>
          </div>
          <div class="d-col">
            <div class="d-h">TAKE COMMAND</div>
            <button class="d-veh" data-k="fighter"><b>Starfighter</b><em></em></button>
            <button class="d-veh" data-k="vehicle"><b>Armor</b><em></em></button>
            <button class="d-veh" data-k="capital"><b>Flagship Bridge</b><em></em></button>
            <button class="d-veh" data-k="cmd"><b>Command View</b><em>Direct the battle from above · M</em></button>
            <button class="d-veh" data-k="help"><b>Controls</b><em>Every binding, per unit · F1</em></button>
            <div class="d-tip">Every death costs your side a reinforcement. Hold more posts than the enemy to bleed theirs. Enemy fire near you suppresses your aim: use cover.</div>
          </div>
        </div>`);
      const L = this.$.layer;
      L.querySelectorAll('.d-class').forEach(b => b.addEventListener('click', () => this.pickClass(+b.dataset.i)));
      L.querySelectorAll('.d-cp').forEach(b => b.addEventListener('click', () => { const c = w.cps[+b.dataset.cp]; if (c.owner === g.team) { g.deployCp = c.id; Object.assign(g.renderer.camera.orbit, { x: c.pos.x, y: c.pos.y + 8, z: c.pos.z }); if (E.SFX) E.SFX.play('select'); } }));
      L.querySelector('.d-go').addEventListener('click', () => this.doDeploy());
      L.querySelectorAll('.d-veh').forEach(b => b.addEventListener('click', () => { const k = b.dataset.k; if (k === 'cmd') g.toCommander(); else if (k === 'help') this.showControls(); else if (!g.quickControl(k)) { this.toast('None available'); if (E.SFX) E.SFX.play('deny'); } }));
      this.perkPanel(cls);
      this.refreshDeploy(w, g.player());
    }
    perkPanel(cls) {
      const L = this.$.layer, box = L.querySelector('.d-perks'); if (!box) return;
      const sel = this.perkSel(cls), P = E.PERKS[cls];
      const tier = (name, list, idx) => `<div class="pk-t"><div class="pk-h">${name}</div>${list.map(p => `<button class="pk${sel[idx] === p.id ? ' on' : ''}" data-t="${idx}" data-id="${p.id}" aria-pressed="${sel[idx] === p.id}"><b>${esc(p.name)}</b><span>${esc(p.desc)}</span></button>`).join('')}</div>`;
      box.innerHTML = `<div class="d-h">${E.INFANTRY[cls].name.toUpperCase()} PERKS <span class="d-sub">one per tier</span></div><div class="pk-row">${tier('TIER 1', P.t1, 0)}${tier('TIER 2', P.t2, 1)}</div>`;
      box.querySelectorAll('.pk').forEach(b => b.addEventListener('click', () => { sel[+b.dataset.t] = b.dataset.id; this.game.settings.loadouts[cls] = sel; E.bus.emit('settings:changed', this.game.settings); this.perkPanel(cls); if (E.SFX) E.SFX.play('select'); }));
    }
    refreshDeploy(w, P) {
      const g = this.game, L = this.$.layer, cvs = L.querySelector('.d-map canvas'); if (!cvs) return;
      this.drawMap(cvs.getContext('2d'), 660, 480, w, true);
      const owned = w.cps.filter(c => c.owner === g.team);
      if (!owned.some(c => c.id === g.deployCp)) {
        let best = null, bd = 1e9; for (const c of owned) for (const o of w.cps) if (o.owner !== g.team) { const d = E.distXZ(c.pos, o.pos); if (d < bd) { bd = d; best = c; } }
        g.deployCp = best ? best.id : (owned[0] ? owned[0].id : -1);
      }
      const o = { x: 0, y: 0 };
      L.querySelectorAll('.d-cp').forEach(b => { const c = w.cps[+b.dataset.cp]; this.mapXY(c.pos, 100, 100, o); b.style.left = o.x + '%'; b.style.top = o.y + '%'; b.dataset.o = c.owner || 'neutral'; b.classList.toggle('mine', c.owner === g.team); b.classList.toggle('on', c.id === g.deployCp); });
      const wait = P ? Math.max(0, E.SIM.RESPAWN - (w.t - P.deadT)) : 0, T = w.teams[g.team];
      this.tx(L.querySelector('.d-wait'), !owned.length ? 'No command posts — take control of a unit to fight on' : T.tickets <= 0 ? 'No reinforcements left' : wait > 0 ? 'Reinforcing in ' + wait.toFixed(1) + 's' : (w.cps[g.deployCp] ? 'Deploying at ' + w.cps[g.deployCp].name : ''));
      L.querySelector('.d-go').disabled = wait > 0 || !owned.length || T.tickets <= 0;
      const n = (k) => w.units.filter(u => u.alive && u.team === g.team && u.kind === k && !u.pid).length;
      L.querySelectorAll('.d-veh').forEach(b => { const k = b.dataset.k; if (k === 'cmd' || k === 'help') return; const c = n(k); b.disabled = !c; this.tx(b.querySelector('em'), c ? c + ' available' : 'none available'); });
    }
    pickClass(i) { this.cls = i; if (this.layerKind === 'deploy') { this.$.layer.querySelectorAll('.d-class').forEach((b, j) => { b.classList.toggle('on', j === i); b.setAttribute('aria-pressed', j === i); }); this.perkPanel(CLASSES[i]); } if (E.SFX) E.SFX.play('select'); }
    doDeploy() {
      const g = this.game, cls = CLASSES[this.cls]; if (g.deployCp < 0) return;
      g.cmd('verb', 'loadout', cls, this.perkSel(cls).slice());
      g.cmd('deploy', cls, g.deployCp);
    }
    hideDeploy() { if (this.layerKind === 'deploy') this.setLayer('', ''); }
  }

  E.HUD = HUD;
  E.HUD_COL = COL; E.HUD_TNAME = TNAME;
})(window.E = window.E || {});
