// The battle HUD: reinforcement bars + command-post strip, unit card (health,
// shields, weapon heat, ability cooldown), crosshair + hit markers, minimap,
// kill feed, score popups, announcements, world markers (canvas overlay), and
// the deploy / pause / scoreboard / results screens. DOM + 2D canvas only.
(function (E) {
  'use strict';
  const COL = { aegis: '#ff5a2b', verdant: '#3df0b0', neutral: '#b9c6dd' };
  const TNAME = { aegis: 'CONCORD', verdant: 'PACT' };
  const CLASSES = ['trooper', 'heavy', 'sniper', 'medic'];
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  class HUD {
    constructor(root, game) { this.root = root; this.game = game; this.cls = 0; this.feed = []; this.pops = []; this.ann = []; this.dmgDirs = []; }

    begin(game) {
      const w = game.world;
      this.clear();
      const el = document.createElement('div'); el.className = 'hud'; el.id = 'hud';
      el.innerHTML = `
        <canvas class="h-cv"></canvas>
        <div class="h-top">
          <div class="h-team aegis"><span class="h-tname">CONCORD</span><div class="h-tbar"><i></i></div><b class="h-tk"></b></div>
          <div class="h-cps">${w.cps.map(c => `<div class="h-cp" data-cp="${c.id}"><span>${c.name[0]}</span><i></i></div>`).join('')}</div>
          <div class="h-team verdant"><b class="h-tk"></b><div class="h-tbar"><i></i></div><span class="h-tname">PACT</span></div>
        </div>
        <div class="h-announce"></div>
        <div class="h-feed"></div>
        <div class="h-pops"></div>
        <div class="h-cross"><i class="d"></i><i class="l"></i><i class="r"></i><i class="t"></i><i class="b"></i><div class="hitm"></div><div class="h-lock"></div></div>
        <div class="h-scope"></div>
        <div class="h-capture"><span></span><div class="bar"><i></i></div></div>
        <div class="h-unit">
          <div class="h-uname"></div>
          <div class="h-bar sh"><i></i></div>
          <div class="h-bar hp"><i></i><span></span></div>
          <div class="h-weap"><span class="wn"></span><div class="h-heat"><i></i></div></div>
          <div class="h-abil"><span class="key">G</span><span class="an"></span><div class="cd"><i></i></div></div>
        </div>
        <div class="h-mapwrap"><canvas class="h-map" width="220" height="160"></canvas></div>
        <div class="h-hint"></div>
        <div class="h-toast"></div>
        <div class="h-dead"></div>
        <div class="h-selbox"></div>
        <div class="h-layer"></div>`;
      this.root.appendChild(el);
      this.el = el;
      const q = (s) => el.querySelector(s);
      this.cv = q('.h-cv'); this.ctx = this.cv.getContext('2d'); this.map = q('.h-map'); this.mctx = this.map.getContext('2d');
      this.$ = { tA: q('.h-team.aegis'), tV: q('.h-team.verdant'), cps: [...el.querySelectorAll('.h-cp')], ann: q('.h-announce'), feed: q('.h-feed'), pops: q('.h-pops'), cross: q('.h-cross'), hitm: q('.hitm'), lock: q('.h-lock'),
        scope: q('.h-scope'), cap: q('.h-capture'), unit: q('.h-unit'), uname: q('.h-uname'), hp: q('.h-bar.hp'), sh: q('.h-bar.sh'), weap: q('.h-weap'), heat: q('.h-heat'), abil: q('.h-abil'), mapwrap: q('.h-mapwrap'),
        hint: q('.h-hint'), toast: q('.h-toast'), dead: q('.h-dead'), sel: q('.h-selbox'), layer: q('.h-layer') };
      this.feed = []; this.pops = []; this.ann = []; this.dmgDirs = []; this.annT = 0; this.hitT = 0; this.total = 0; this.layerKind = '';
      this.mapImg = this.terrainImage(w, 220, 160);
      this._resize = () => { this.cv.width = window.innerWidth; this.cv.height = window.innerHeight; };
      window.addEventListener('resize', this._resize); this._resize();
      el.classList.toggle('attract', game.state === 'attract');
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
        d[k] = c3[0] * sh * 0.6; d[k + 1] = c3[1] * sh * 0.62; d[k + 2] = c3[2] * sh * 0.68; d[k + 3] = 255;
      }
      x.putImageData(id, 0, 0);
      return c;
    }
    mapXY(p, W, H, o) { o.x = (p.x / (E.ARENA.x * 1.25) * 0.5 + 0.5) * W; o.y = (p.z / (E.ARENA.z * 1.25) * 0.5 + 0.5) * H; return o; }
    drawMap(ctx, W, H, w, big) {
      const g = this.game, o = { x: 0, y: 0 }, me = g.unit();
      ctx.drawImage(this.mapImg, 0, 0, W, H);
      for (const u of w.units) {
        if (!u.alive || u.kind === 'turret') continue;
        this.mapXY(u.pos, W, H, o);
        ctx.fillStyle = COL[u.team];
        if (u.kind === 'capital') { ctx.globalAlpha = 0.85; ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(-u.yaw + Math.PI / 2); ctx.fillRect(-9 * (big ? 2 : 1), -2.5, 18 * (big ? 2 : 1), 5); ctx.restore(); ctx.globalAlpha = 1; }
        else if (u.kind === 'fighter') { ctx.beginPath(); ctx.moveTo(o.x, o.y - 3); ctx.lineTo(o.x + 3, o.y + 3); ctx.lineTo(o.x - 3, o.y + 3); ctx.fill(); }
        else { const s = u.kind === 'vehicle' ? 2.6 : 1.5; ctx.fillRect(o.x - s, o.y - s, s * 2, s * 2); }
      }
      for (const c of w.cps) {
        this.mapXY(c.pos, W, H, o);
        const r = big ? 13 : 7.5;
        ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, E.TAU); ctx.fillStyle = 'rgba(8,12,20,.8)'; ctx.fill();
        ctx.lineWidth = big ? 3 : 2; ctx.strokeStyle = COL[c.owner || 'neutral']; ctx.stroke();
        if (Math.abs(c.cap) < 0.999 && Math.abs(c.cap) > 0.01) { ctx.beginPath(); ctx.arc(o.x, o.y, r + 2.5, -Math.PI / 2, -Math.PI / 2 + E.TAU * Math.abs(c.cap)); ctx.strokeStyle = COL[c.cap > 0 ? 'aegis' : 'verdant']; ctx.stroke(); }
        ctx.fillStyle = '#fff'; ctx.font = `700 ${big ? 13 : 9}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(c.name[0], o.x, o.y + 0.5);
      }
      if (me) {
        this.mapXY(me.pos, W, H, o); ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(-g.renderer.camera.yaw + Math.PI);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4.5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill(); ctx.restore();
      } else if (g.state === 'commander') { const c = g.renderer.camera.cmd; this.mapXY(c, W, H, o); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(o.x - 12, o.y - 8, 24, 16); }
      for (const s of w.strikes || []) { this.mapXY(s.pos, W, H, o); ctx.strokeStyle = '#ff3020'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(o.x, o.y, 5 + (performance.now() / 80 % 4), 0, E.TAU); ctx.stroke(); }
    }

    // ── per-frame ────────────────────────────────────────────
    update(dt, w, P, u) {
      const $ = this.$, g = this.game, st = g.state; if (!this.el) return;
      const play = st === 'play' && u;
      this.frameN = (this.frameN || 0) + 1;
      // tickets + posts
      if (this.frameN % 6 === 0) {
        for (const [el, f] of [[$.tA, 'aegis'], [$.tV, 'verdant']]) {
          const T = w.teams[f]; el.querySelector('.h-tk').textContent = T.tickets; el.querySelector('i').style.width = E.clamp01(T.tickets / T.startTickets) * 100 + '%';
          el.classList.toggle('low', T.tickets <= 25); el.classList.toggle('mine', f === g.team);
        }
        w.cps.forEach((c, i) => { const e = $.cps[i]; e.dataset.o = c.owner || 'neutral'; e.classList.toggle('contested', c.contested); e.querySelector('i').style.cssText = `width:${Math.abs(c.cap) * 100}%;background:${COL[c.cap >= 0 ? 'aegis' : 'verdant']}`; });
        this.drawMap(this.mctx, 220, 160, w, false);
      }
      // unit card
      $.unit.style.display = play ? '' : 'none'; $.cross.style.display = play ? '' : 'none';
      $.mapwrap.style.display = (st === 'deploy' || st === 'ended') ? 'none' : '';
      if (play) {
        const d = u.def, W = E.WEAPONS[d.weapon], A = d.alt ? E.WEAPONS[d.alt] : (u.kind === 'capital' ? E.WEAPONS.orbital : null);
        if (this._uid !== u.id) { this._uid = u.id; $.uname.innerHTML = `<b>${esc(d.name).toUpperCase()}</b> <span>${TNAME[u.team]}</span>`; $.weap.querySelector('.wn').textContent = u.kind === 'capital' ? 'Main Batteries — hold fire to focus' : W.name; $.abil.style.display = A ? '' : 'none'; if (A) $.abil.querySelector('.an').textContent = A.name; $.sh.style.display = u.maxShield ? '' : 'none'; }
        $.hp.querySelector('i').style.width = E.clamp01(u.hp / u.maxHp) * 100 + '%'; $.hp.querySelector('span').textContent = Math.ceil(u.hp);
        $.hp.classList.toggle('crit', u.hp < u.maxHp * 0.3);
        if (u.maxShield) $.sh.querySelector('i').style.width = E.clamp01(u.shield / u.maxShield) * 100 + '%';
        const hi = $.heat.querySelector('i'); hi.style.width = E.clamp01(u.heat || 0) * 100 + '%'; $.heat.classList.toggle('hot', !!u.hot); $.heat.style.visibility = W && W.heat ? '' : 'hidden';
        if (A) { const cd = u.kind === 'capital' ? E.clamp01(w.teams[u.team].strikeT / A.cd) : E.clamp01(u.altT / (A.cd || 1 / A.rate)); $.abil.querySelector('i').style.width = (1 - cd) * 100 + '%'; $.abil.classList.toggle('ready', cd <= 0); }
        // crosshair bloom + hit marker
        const spread = 6 + (u.heat || 0) * 14 + Math.min(10, Math.hypot(u.vel.x, u.vel.z) * 0.5) * (u.kind === 'infantry' ? 1 : 0) - g.renderer.camera.zoom * 4;
        $.cross.style.setProperty('--g', spread.toFixed(1) + 'px');
        $.cross.classList.toggle('enemy', !!(g.aimInfo && g.aimInfo.target));
        this.hitT -= dt; $.hitm.style.opacity = Math.max(0, this.hitT * 4);
        const scope = u.type === 'sniper' && g.renderer.camera.zoom > 0.85; $.scope.style.display = scope ? '' : 'none'; $.cross.classList.toggle('scoped', scope);
        // capture bar
        let cp = null; for (const c of w.cps) if (E.distXZ2(u.pos, c.pos) < c.r * c.r && (u.kind === 'infantry' || u.kind === 'vehicle')) cp = c;
        if (cp && (cp.owner !== u.team || Math.abs(cp.cap) < 0.999)) {
          $.cap.style.display = ''; const mine = u.team === 'aegis' ? cp.cap : -cp.cap;
          $.cap.querySelector('span').textContent = cp.contested ? 'CONTESTED — ' + cp.name.toUpperCase() : (mine < 0 ? 'NEUTRALIZING ' : 'CAPTURING ') + cp.name.toUpperCase();
          const i = $.cap.querySelector('i'); i.style.width = Math.abs(cp.cap) * 100 + '%'; i.style.background = COL[cp.cap >= 0 ? 'aegis' : 'verdant'];
        } else $.cap.style.display = 'none';
        if (this.frameN % 20 === 0) $.hint.innerHTML = u.kind === 'fighter' ? '<b>Mouse</b> steer · <b>W/Shift</b> boost · <b>S</b> brake · <b>G</b> ' + (A ? A.name : '') + ' · <b>C</b> command · <b>F</b> switch unit'
          : u.kind === 'capital' ? '<b>WASD</b> helm · <b>LMB</b> focus batteries · <b>G</b> orbital strike · <b>F</b> switch unit · <b>C</b> command'
          : '<b>F</b> take control of a friendly · <b>Z/X/V</b> squad follow / move / dismiss · <b>C</b> command view';
      } else { $.cap.style.display = 'none'; $.scope.style.display = 'none'; $.hint.innerHTML = st === 'commander' ? '<b>LMB</b> select · <b>drag</b> box · <b>RMB</b> move · <b>H</b> hold · <b>1/2/3</b> infantry / armor / air · <b>F</b> take control · <b>Enter</b> deploy' : ''; this._uid = 0; }
      $.dead.style.display = st === 'dead' ? '' : 'none';
      // deploy countdown
      if (st === 'deploy' && this.layerKind === 'deploy' && this.frameN % 6 === 0) this.refreshDeploy(w, P);
      // announcements
      this.annT -= dt;
      if (this.annT <= 0) { if (this.ann.length) { const a = this.ann.shift(); $.ann.innerHTML = `<div class="${a.cls}">${a.text}</div>`; $.ann.classList.remove('show'); void $.ann.offsetWidth; $.ann.classList.add('show'); this.annT = 3.2; } else if (this.annT < -0.4) $.ann.classList.remove('show'); }
      // feed + pops expiry
      const now = performance.now();
      if (this.feed.length && now - this.feed[0].t > 6500) { this.feed.shift().el.remove(); }
      if (this.pops.length && now - this.pops[0].t > 2200) { this.pops.shift().el.remove(); }
      this.overlay(dt, w, u, play);
    }

    // world-anchored markers
    overlay(dt, w, u, play) {
      const ctx = this.ctx, g = this.game, cam = g.renderer.camera, W = this.cv.width, H = this.cv.height, o = { x: 0, y: 0, vis: false };
      ctx.clearRect(0, 0, W, H);
      if (g.state === 'deploy' || g.state === 'ended' || g.paused) return;
      const cp3 = cam.cam.position;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const c of w.cps) {
        cam.project({ x: c.pos.x, y: c.pos.y + 16, z: c.pos.z }, o);
        const d = Math.hypot(c.pos.x - cp3.x, c.pos.z - cp3.z);
        let x = o.x, y = o.y; const off = !o.vis || x < 40 || x > W - 40 || y < 70 || y > H - 60;
        if (off) { if (!play) continue; const a = Math.atan2(c.pos.x - cp3.x, c.pos.z - cp3.z) - cam.yaw; x = W / 2 - Math.sin(a) * (W / 2 - 60); y = H / 2 - Math.cos(a) * (H / 2 - 90); x = E.clamp(x, 44, W - 44); y = E.clamp(y, 80, H - 70); }
        const col = COL[c.owner || 'neutral'];
        ctx.globalAlpha = off ? 0.6 : 0.95; ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = 'rgba(6,10,18,.72)'; ctx.fillRect(-11, -11, 22, 22); ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.strokeRect(-11, -11, 22, 22);
        if (Math.abs(c.cap) < 0.999) { ctx.fillStyle = COL[c.cap >= 0 ? 'aegis' : 'verdant']; ctx.globalAlpha *= 0.55; const k = Math.abs(c.cap); ctx.fillRect(-11, 11 - 22 * k, 22, 22 * k); }
        ctx.restore(); ctx.globalAlpha = off ? 0.6 : 1;
        ctx.fillStyle = '#fff'; ctx.font = '700 13px system-ui'; ctx.fillText(c.name[0], x, y + 1);
        ctx.font = '600 10px system-ui'; ctx.fillStyle = col; ctx.fillText(Math.round(d) + 'm', x, y + 25);
      }
      ctx.globalAlpha = 1;
      // capital ship plates
      for (const s of w.units) {
        if (s.kind !== 'capital' || !s.alive) continue;
        cam.project({ x: s.pos.x, y: s.pos.y + s.h * 1.6, z: s.pos.z }, o); if (!o.vis || (u && u.id === s.id)) continue;
        const col = COL[s.team], bw = 90;
        ctx.fillStyle = 'rgba(6,10,18,.6)'; ctx.fillRect(o.x - bw / 2 - 2, o.y - 5, bw + 4, 10);
        ctx.fillStyle = '#4aa8ff'; ctx.fillRect(o.x - bw / 2, o.y - 3, bw * E.clamp01(s.shield / (s.maxShield || 1)), 2);
        ctx.fillStyle = col; ctx.fillRect(o.x - bw / 2, o.y, bw * E.clamp01(s.hp / s.maxHp), 3);
        ctx.font = '700 10px system-ui'; ctx.fillStyle = col; ctx.fillText((s.team === g.team ? 'ALLIED ' : 'ENEMY ') + s.def.name.toUpperCase(), o.x, o.y - 13);
      }
      if (play) {
        // target info under the crosshair
        const t = g.aimInfo && g.aimInfo.target;
        if (t && t.alive && t.kind !== 'capital') {
          cam.project({ x: t.pos.x, y: t.pos.y + t.h + (t.kind === 'infantry' ? 0.5 : 1.5), z: t.pos.z }, o);
          if (o.vis) { const bw = 46; ctx.fillStyle = 'rgba(6,10,18,.7)'; ctx.fillRect(o.x - bw / 2 - 1, o.y - 3, bw + 2, 6); ctx.fillStyle = COL[t.team]; ctx.fillRect(o.x - bw / 2, o.y - 2, bw * E.clamp01(t.hp / t.maxHp), 4); }
        }
        // friendly tags for nearby allies
        ctx.font = '600 9px system-ui';
        for (const a of w.units) {
          if (!a.alive || a.team !== g.team || a === u || a.kind === 'capital' || a.kind === 'turret') continue;
          const d2 = E.V3.distance2(a.pos, u.pos); if (d2 > (a.kind === 'infantry' ? 90 * 90 : 500 * 500)) continue;
          cam.project({ x: a.pos.x, y: a.pos.y + a.h + (a.kind === 'infantry' ? 0.45 : 2), z: a.pos.z }, o); if (!o.vis) continue;
          ctx.fillStyle = a.pid ? '#fff' : (g.squad.includes(a.id) ? '#ffe680' : 'rgba(120,190,255,.8)');
          ctx.beginPath(); ctx.moveTo(o.x, o.y + 4); ctx.lineTo(o.x - 4, o.y - 3); ctx.lineTo(o.x + 4, o.y - 3); ctx.fill();
          if (a.pid && w.players[a.pid]) ctx.fillText(w.players[a.pid].name, o.x, o.y - 10);
        }
        // missile lock diamond
        const lk = (u.def.alt === 'missile' || u.def.alt === 'rocket') ? E.SIM.aimTarget(w, u, u.kind === 'fighter' ? u.pos : E.SIM.eyeOf(u), E.SIM.dirOf(u.kind === 'fighter' ? u.yaw : cam.yaw, u.kind === 'fighter' ? u.pitch : cam.pitch), u.kind === 'fighter' ? 0.3 : 0.12, u.kind === 'fighter' ? 900 : 500, (e) => e.kind !== 'infantry') : null;
        if (lk) { cam.project(lk.pos, o); if (o.vis) { const s = 16 + Math.sin(performance.now() / 90) * 2; ctx.strokeStyle = u.altT <= 0 ? '#ff4030' : '#ffb040'; ctx.lineWidth = 2; ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(Math.PI / 4); ctx.strokeRect(-s / 2, -s / 2, s, s); ctx.restore(); ctx.font = '700 10px system-ui'; ctx.fillStyle = ctx.strokeStyle; ctx.fillText(u.altT <= 0 ? 'LOCK' : '', o.x, o.y + 22); } }
        // fighter: where the nose is actually pointing
        if (u.kind === 'fighter') { const d = E.SIM.dirOf(u.yaw, u.pitch); cam.project({ x: u.pos.x + d.x * 300, y: u.pos.y + d.y * 300, z: u.pos.z + d.z * 300 }, o); if (o.vis) { ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(o.x, o.y, 9, 0, E.TAU); ctx.stroke(); } }
        // damage direction arcs
        for (let i = this.dmgDirs.length - 1; i >= 0; i--) {
          const dd = this.dmgDirs[i]; dd.t -= dt; if (dd.t <= 0) { this.dmgDirs.splice(i, 1); continue; }
          const a = Math.atan2(dd.x - u.pos.x, dd.z - u.pos.z) - cam.yaw;
          ctx.strokeStyle = `rgba(255,50,30,${Math.min(1, dd.t * 1.4)})`; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(W / 2, H / 2, 110, -Math.PI / 2 - a - 0.24, -Math.PI / 2 - a + 0.24); ctx.stroke();
        }
      }
    }

    // ── events ───────────────────────────────────────────────
    events(events, w) {
      const g = this.game, me = g.pid, mine = g.team;
      for (const e of events) {
        if (e.type === 'death') {
          if (e.kind === 'turret' && !e.byPid) continue;
          if (e.kind === 'infantry' && !e.byPid && !e.pid && this.feed.length > 3) continue;
          const el = document.createElement('div'); el.className = 'h-kill' + (e.byPid === me ? ' me' : '') + (e.pid === me ? ' dead' : '');
          const W = E.WEAPONS[e.wk];
          el.innerHTML = `<b class="${e.kteam || ''}">${esc(e.killer)}</b><span>${W ? esc(W.name) : (e.wk === 'crash' ? 'crash' : '')}</span><b class="${e.team}">${esc(e.victim)}</b>`;
          this.$.feed.appendChild(el); this.feed.push({ el, t: performance.now() }); if (this.feed.length > 5) this.feed.shift().el.remove();
          if (e.pid === me) this.$.dead.innerHTML = `<div class="k1">YOU WERE KILLED</div><div class="k2">${esc(e.killer)}${W ? ' · ' + esc(W.name) : ''}</div>`;
        } else if (e.type === 'hit') {
          if (e.by === me) { this.hitT = 0.3; this.$.hitm.className = 'hitm' + (e.kill ? ' kill' : e.head ? ' head' : e.sh ? ' sh' : ''); }
          if (e.to === me) { g.hurt = Math.min(1, (g.hurt || 0) + 0.25 + e.dmg / 120); g.renderer.camera.shake(Math.min(0.4, e.dmg / 150)); if (e.from) this.dmgDirs.push({ x: e.from.x, z: e.from.z, t: 1.2 }); }
        } else if (e.type === 'score' && e.to === me) {
          this.total += e.pts; const el = document.createElement('div'); el.className = 'h-pop'; el.innerHTML = `<b>+${e.pts}</b> ${esc(e.why)}`;
          this.$.pops.appendChild(el); this.pops.push({ el, t: performance.now() }); if (this.pops.length > 5) this.pops.shift().el.remove();
        } else if (e.type === 'capture') { const c = w.cps[e.cp]; this.announce((e.team === mine ? 'WE CAPTURED ' : 'ENEMY CAPTURED ') + c.name.toUpperCase(), e.team); }
        else if (e.type === 'neutral') { const c = w.cps[e.cp]; this.announce((e.prev === mine ? 'WE LOST ' : 'ENEMY LOST ') + c.name.toUpperCase(), e.prev === mine ? 'bad' : 'good'); }
        else if (e.type === 'announce') {
          const ours = e.team === mine;
          if (e.key === 'capitalDown') this.announce(ours ? 'OUR FLAGSHIP IS LOST' : 'ENEMY CAPITAL SHIP DESTROYED', ours ? 'bad' : 'good');
          else if (e.key === 'ticketsHalf') this.announce(ours ? 'OUR REINFORCEMENTS AT HALF' : 'ENEMY REINFORCEMENTS AT HALF', ours ? 'bad' : 'good');
          else if (e.key === 'ticketsLow') this.announce(ours ? 'WE ARE RUNNING OUT OF TROOPS' : 'THE ENEMY IS BREAKING — FINISH THEM', ours ? 'bad' : 'good');
        } else if (e.type === 'strikeWarn') { const u = g.unit(); if (e.team !== mine && u && E.distXZ2(u.pos, e.pos) < 60 * 60) this.announce('INCOMING ORBITAL STRIKE — MOVE!', 'bad'); else if (e.team === mine) this.toast('Orbital strike inbound'); }
        else if (e.type === 'overheat' && e.to === me) this.toast('WEAPON OVERHEATED');
        else if (e.type === 'gameOver') this.announce(e.winner === mine ? 'VICTORY' : 'DEFEAT', e.winner === mine ? 'good big' : 'bad big');
      }
    }
    announce(text, cls) { if (this.ann.length < 4) this.ann.push({ text: esc(text), cls: cls || '' }); }
    toast(t) { const el = this.$ && this.$.toast; if (!el) return; el.textContent = t; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); }
    box(x0, y0, x1, y1) { const s = this.$.sel; if (x0 === undefined) { s.style.display = 'none'; return; } s.style.cssText = `display:block;left:${Math.min(x0, x1)}px;top:${Math.min(y0, y1)}px;width:${Math.abs(x1 - x0)}px;height:${Math.abs(y1 - y0)}px`; }
    setLayer(kind, html) { this.layerKind = kind; this.$.layer.innerHTML = html; this.$.layer.className = 'h-layer ' + (kind ? 'on ' + kind : ''); }

    // ── deploy screen ────────────────────────────────────────
    showDeploy() {
      const g = this.game, w = g.world;
      const cards = CLASSES.map((c, i) => { const d = E.INFANTRY[c], W = E.WEAPONS[d.weapon], A = E.WEAPONS[d.alt]; return `<button class="d-class${i === this.cls ? ' on' : ''}" data-i="${i}"><span class="k">${i + 1}</span><b>${d.name}</b><em>${W.name} · ${A.name}</em><p>${d.desc}</p></button>`; }).join('');
      this.setLayer('deploy', `
        <div class="d-wrap">
          <div class="d-col">
            <div class="d-h">DEPLOY AS</div>${cards}
          </div>
          <div class="d-mid">
            <div class="d-h">SELECT A COMMAND POST <span class="d-sub">${esc(w.planet.biomeDef.name)} · ${esc(w.planet.biomeDef.challenge.name)}</span></div>
            <div class="d-map"><canvas width="660" height="480"></canvas>${w.cps.map(c => `<button class="d-cp" data-cp="${c.id}">${c.name[0]}</button>`).join('')}</div>
            <div class="d-row"><button class="gc-btn primary d-go">DEPLOY <span class="k">ENTER</span></button><span class="d-wait"></span></div>
          </div>
          <div class="d-col">
            <div class="d-h">TAKE COMMAND</div>
            <button class="d-veh" data-k="fighter"><b>Starfighter</b><em></em></button>
            <button class="d-veh" data-k="vehicle"><b>Armor</b><em></em></button>
            <button class="d-veh" data-k="capital"><b>Flagship Bridge</b><em></em></button>
            <button class="d-veh" data-k="cmd"><b>Command View</b><em>Direct the battle from above · C</em></button>
            <div class="d-tip">Every death costs your side a reinforcement. Hold more posts than the enemy to bleed theirs.</div>
          </div>
        </div>`);
      const L = this.$.layer;
      L.querySelectorAll('.d-class').forEach(b => b.addEventListener('click', () => this.pickClass(+b.dataset.i)));
      L.querySelectorAll('.d-cp').forEach(b => b.addEventListener('click', () => { const c = w.cps[+b.dataset.cp]; if (c.owner === g.team) { g.deployCp = c.id; Object.assign(g.renderer.camera.orbit, { x: c.pos.x, y: c.pos.y + 8, z: c.pos.z }); if (E.SFX) E.SFX.play('ui'); } }));
      L.querySelector('.d-go').addEventListener('click', () => this.doDeploy());
      L.querySelectorAll('.d-veh').forEach(b => b.addEventListener('click', () => { const k = b.dataset.k; if (k === 'cmd') g.toCommander(); else if (!g.quickControl(k)) this.toast('None available'); }));
      this.refreshDeploy(w, g.player());
    }
    refreshDeploy(w, P) {
      const g = this.game, L = this.$.layer, cvs = L.querySelector('.d-map canvas'); if (!cvs) return;
      this.drawMap(cvs.getContext('2d'), 660, 480, w, true);
      const owned = w.cps.filter(c => c.owner === g.team);
      if (!owned.some(c => c.id === g.deployCp)) { // default: the owned post nearest the front
        let best = null, bd = 1e9; for (const c of owned) for (const o of w.cps) if (o.owner !== g.team) { const d = E.distXZ(c.pos, o.pos); if (d < bd) { bd = d; best = c; } }
        g.deployCp = best ? best.id : (owned[0] ? owned[0].id : -1);
      }
      const o = { x: 0, y: 0 };
      L.querySelectorAll('.d-cp').forEach(b => { const c = w.cps[+b.dataset.cp]; this.mapXY(c.pos, 100, 100, o); b.style.left = o.x + '%'; b.style.top = o.y + '%'; b.dataset.o = c.owner || 'neutral'; b.classList.toggle('mine', c.owner === g.team); b.classList.toggle('on', c.id === g.deployCp); });
      const wait = P ? Math.max(0, E.SIM.RESPAWN - (w.t - P.deadT)) : 0, T = w.teams[g.team];
      L.querySelector('.d-wait').textContent = !owned.length ? 'No command posts — take control of a unit to fight on' : T.tickets <= 0 ? 'No reinforcements left' : wait > 0 ? 'Reinforcing in ' + wait.toFixed(1) + 's' : '';
      L.querySelector('.d-go').disabled = wait > 0 || !owned.length || T.tickets <= 0;
      const n = (k) => w.units.filter(u => u.alive && u.team === g.team && u.kind === k && !u.pid).length;
      L.querySelectorAll('.d-veh').forEach(b => { const k = b.dataset.k; if (k === 'cmd') return; const c = n(k); b.disabled = !c; b.querySelector('em').textContent = c ? c + ' available' : 'none available'; });
    }
    pickClass(i) { this.cls = i; if (this.layerKind === 'deploy') this.$.layer.querySelectorAll('.d-class').forEach((b, j) => b.classList.toggle('on', j === i)); if (E.SFX) E.SFX.play('ui'); }
    doDeploy() { const g = this.game; if (g.deployCp >= 0) g.cmd('deploy', CLASSES[this.cls], g.deployCp); }
    hideDeploy() { if (this.layerKind === 'deploy') this.setLayer('', ''); }

    // ── pause / settings ─────────────────────────────────────
    showPause() {
      const g = this.game, s = g.settings;
      this.setLayer('pause', `
        <div class="p-card">
          <div class="p-title">PAUSED</div>
          <button class="gc-btn primary p-resume">Resume</button>
          <div class="p-set">
            <label>Graphics<select class="p-q">${['auto', 'high', 'medium', 'low'].map(q => `<option value="${q}"${(s.quality || 'auto') === q ? ' selected' : ''}>${q[0].toUpperCase() + q.slice(1)}</option>`).join('')}</select></label>
            <label>Mouse sensitivity<input type="range" class="p-sens" min="0.3" max="2.5" step="0.05" value="${s.sens || 1}"></label>
            <label>Volume<input type="range" class="p-vol" min="0" max="1" step="0.05" value="${s.volume == null ? 0.8 : s.volume}"></label>
            <label class="chk"><input type="checkbox" class="p-inv"${s.invertY ? ' checked' : ''}> Invert Y</label>
          </div>
          <div class="p-keys"><b>WASD</b> move · <b>Mouse</b> aim · <b>LMB</b> fire · <b>RMB</b> zoom · <b>G</b> ability · <b>Shift</b> sprint / boost · <b>Space</b> jump<br><b>F</b> take control of the friendly you aim at · <b>Z / X / V</b> squad follow / move / dismiss<br><b>C</b> command view · <b>Tab</b> scoreboard · <b>Esc</b> pause</div>
          <button class="gc-btn p-quit">${g.role === 'sp' ? 'Abandon Battle' : 'Leave Match'}</button>
        </div>`);
      const L = this.$.layer, save = () => E.bus.emit('settings:changed', s);
      L.querySelector('.p-resume').addEventListener('click', () => g.togglePause(false));
      L.querySelector('.p-q').addEventListener('change', (e) => { s.quality = e.target.value; g.renderer.scene.setQuality(s.quality); save(); });
      L.querySelector('.p-sens').addEventListener('input', (e) => { s.sens = +e.target.value; save(); });
      L.querySelector('.p-vol').addEventListener('input', (e) => { s.volume = +e.target.value; if (E.Music) E.Music.setVolume(s.volume); save(); });
      L.querySelector('.p-inv').addEventListener('change', (e) => { s.invertY = e.target.checked; save(); });
      L.querySelector('.p-quit').addEventListener('click', () => { g.paused = false; if (g.onQuit) g.onQuit(); });
    }
    hidePause() { if (this.layerKind === 'pause') { this.setLayer('', ''); if (this.game.state === 'deploy') this.showDeploy(); } }

    scoreboard(on) {
      const g = this.game, w = g.world;
      if (!on) { if (this.layerKind === 'score') this.setLayer('', ''); if (g.state === 'deploy' && !this.layerKind) this.showDeploy(); return; }
      if (this.layerKind && this.layerKind !== 'deploy') return;
      const row = (f) => { const T = w.teams[f]; const ps = Object.values(w.players).filter(p => p.team === f).sort((a, b) => b.score - a.score);
        return `<div class="s-team ${f}"><div class="s-h"><b>${E.faction(f).name.toUpperCase()}</b><span>${T.tickets} reinforcements · ${T.cps} posts · ${T.kills} kills</span></div>
          <table><tr><th>Player</th><th>Score</th><th>K</th><th>D</th><th>Caps</th></tr>${ps.map(p => `<tr class="${p.id === g.pid ? 'me' : ''}"><td>${esc(p.name)}</td><td>${p.score}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.captures}</td></tr>`).join('') || '<tr><td colspan="5" class="dim">AI commander</td></tr>'}</table></div>`; };
      this.setLayer('score', `<div class="s-card"><div class="p-title">${esc(w.planet.biomeDef.name).toUpperCase()} — ${E.fmtTime(w.t)}</div>${row('aegis')}${row('verdant')}</div>`);
    }

    // ── results ──────────────────────────────────────────────
    showResults(r) {
      const g = this.game, kd = r.deaths ? (r.kills / r.deaths).toFixed(1) : r.kills;
      const awards = [];
      if (r.kills >= 20) awards.push('WAR HERO'); if (r.best >= 8) awards.push('UNSTOPPABLE'); if (r.captures >= 3) awards.push('VANGUARD'); if (r.deaths === 0 && r.kills > 0) awards.push('UNTOUCHABLE'); if (r.won && r.tickets > r.enemyTickets + 100) awards.push('DECISIVE VICTORY');
      this.setLayer('results', `
        <div class="r-card ${r.won ? 'won' : 'lost'}">
          <div class="r-title">${r.won ? 'VICTORY' : 'DEFEAT'}</div>
          <div class="r-sub">${esc(g.world.planet.biomeDef.name)} · ${E.fmtTime(r.time)} · ${E.faction(r.winner).name} holds the field</div>
          <div class="r-stats">
            <div><b>${r.score.toLocaleString()}</b><span>Score</span></div><div><b>${r.kills}</b><span>Kills</span></div><div><b>${r.deaths}</b><span>Deaths</span></div>
            <div><b>${kd}</b><span>K/D</span></div><div><b>${r.captures}</b><span>Posts taken</span></div><div><b>${r.best}</b><span>Best streak</span></div>
          </div>
          <div class="r-bars"><span class="${g.team}">${r.tickets}</span><i>reinforcements remaining</i><span class="${E.opponent(g.team)}">${r.enemyTickets}</span></div>
          <div class="r-awards">${awards.map(a => `<span>${a}</span>`).join('')}</div>
          <div class="r-extra"></div>
          <button class="gc-btn primary r-go">Continue</button>
        </div>`);
      this.$.layer.querySelector('.r-go').addEventListener('click', () => { if (g.onContinue) g.onContinue(r); });
    }
    resultsExtra(html) { const e = this.$ && this.$.layer.querySelector('.r-extra'); if (e) e.innerHTML = html; }
  }

  E.HUD = HUD;
})(window.E = window.E || {});
