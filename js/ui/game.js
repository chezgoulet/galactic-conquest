// The game controller: owns the world (or a network replica of it), the
// renderer, input, audio routing and the frame loop, and runs the player's
// state machine:  deploy -> play -> dead -> deploy ...  with a commander view
// (tactical map + orders) available at any time, and 'attract' for the menu.
//
// Controls (play):  WASD move · mouse look · LMB fire · RMB zoom · G/Q ability
//   Shift sprint/boost · Space jump · F take control of the friendly you aim at
//   Z squad follow · X squad attack-move to crosshair · V squad free
//   C commander view · Tab scoreboard · Esc pause
// Commander:  WASD pan · Q/E rotate · wheel zoom · LMB select / drag box
//   RMB order move · H hold · F take control · 1/2/3 groups · Enter deploy
(function (E) {
  'use strict';
  const LOCAL = 'p1';

  class Game {
    constructor(canvas, settings) {
      this.canvas = canvas; this.settings = settings || {};
      this.keys = new Set(); this.mouse = { l: false, r: false, x: 0, y: 0 };
      this.running = false; this.acc = new E.Accumulator(30);
      this.renderer = new E.Renderer(canvas, { quality: this.settings.quality || 'auto' });
      this.hud = new E.HUD(document.getElementById('ui'), this);
      if (E.SettingsUI) E.SettingsUI.apply(this.settings);
      this.bind();
    }

    start(opts) {
      opts = opts || {};
      this.opts = opts; this.role = opts.role || 'sp'; this.net = opts.net || null;
      this.relay = opts.relay || null;
      this.pid = opts.pid || (opts.role === 'guest' ? (opts.replica && opts.replica._pid) || LOCAL : LOCAL);
      if (this.role === 'guest') this.world = opts.replica;
      else {
        this.world = new E.World(opts);
        if (this.role !== 'attract') this.world.addPlayer(this.pid, opts.human || 'aegis', this.settings.name || 'Commander');
      }
      this.team = this.role === 'guest' ? opts.human : this.world.human;
      this.renderer.scene.setQuality(this.settings.quality || 'auto');
      this.renderer.setWorld(this.world);
      this.state = this.role === 'attract' ? 'attract' : 'deploy';
      this.clock = 0; this.paused = false; this.deadAt = 0; this.endAt = 0; this.ended = false; this.selected = [];
      this.sel = null; this.deployCp = -1; this.squad = [];
      const home = this.world.cps.find(c => c.home === this.team) || this.world.cps[0];
      const o = this.renderer.camera.orbit;
      if (this.role === 'attract') Object.assign(o, { x: 0, y: 20, z: 0, r: 620, h: 170, speed: 0.035, a: 1 });
      else { Object.assign(o, { x: home.pos.x * 0.55, y: home.pos.y + 10, z: home.pos.z, r: 330, h: 150, speed: 0.04, a: this.team === 'aegis' ? Math.PI : 0 }); Object.assign(this.renderer.camera.cmd, { x: home.pos.x, z: home.pos.z, yaw: this.team === 'aegis' ? Math.PI / 2 : -Math.PI / 2, dist: 300 }); }
      this.renderer.camera.snap();
      this.hud.begin(this);
      this.acc.reset();
      if (this.role === 'attract') for (let i = 0; i < 900; i++) this.world.tick(1 / 30);  // menu backdrop opens mid-battle
      this.world.drainEvents();
      this.running = true; this.last = performance.now();
      cancelAnimationFrame(this._raf); this._raf = requestAnimationFrame(this.frame);
      if (E.Music && E.Music.on) { E.Music.setTheme(this.team); E.Music.setMode('battle'); }
      this.squadMode = 'FOLLOWING';
      E.bus.emit('game:start', this);
      return this;
    }
    stop() { this.running = false; cancelAnimationFrame(this._raf); this.unlock(); this.hud.clear(); }

    // ── commands (local world, or over the wire for guests) ──
    cmd(type, a, b, c) {
      const w = this.world;
      if (this.role === 'guest') { this.net.send({ t: type, a, b, c }); return; }
      if (type === 'input') w.setInput(this.pid, a);
      else if (type === 'possess') w.possess(this.pid, a);
      else if (type === 'release') w.release(this.pid);
      else if (type === 'deploy') w.deploy(this.pid, a, b);
      else if (type === 'order') w.order(this.pid, a, b, c);
      else if (type === 'verb') w.verb(this.pid, a, b, c);
    }
    unit() { return this.world.unitOf(this.pid); }
    player() { return this.world.player(this.pid); }

    // ── frame ────────────────────────────────────────────────
    frame = (now) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(this.frame);
      const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000)); this.last = now;
      const w = this.world, sim = !(this.paused && this.role === 'sp');
      this.clock += dt;
      this.input(dt);
      if (this.role === 'guest') { /* the remote world advances from host snapshots */ }
      else if (sim) { this.acc.add(dt); this.acc.pump((h) => w.tick(h)); }
      const events = w.drainEvents();
      if (this.net && this.role === 'host') this.net.frame(w, events, now);
      if (events.length) { this.renderer.applyEvents(events, w); this.audio(events); if (this.state !== 'attract') this.hud.events(events, w); }
      if (E.AudioDir) E.AudioDir.frame(dt, this);
      this.flow(dt);
      const view = this.view();
      this.renderer.fx.syncProjectiles(w.projectiles, dt);
      if (this.state === 'commander') this.renderer.syncSelection(this.selected, w, this.team); else this.renderer.syncSelection(this.squad, w, this.team);
      const P = this.player(), u = this.unit();
      const g = this.renderer.scene.grade.uniforms;
      g.damage.value += ((u && u.kind === 'infantry' ? E.clamp01(1 - u.hp / u.maxHp - 0.35) * 1.3 : 0) + (this.hurt || 0) - g.damage.value) * Math.min(1, dt * 8);
      this.hurt = Math.max(0, (this.hurt || 0) - dt * 2.5);
      g.zoom.value = this.renderer.camera.zoom * (u && u.type === 'sniper' ? 1 : 0.3);
      g.fade.value = Math.max(0, (this.fade || 0)); this.fade = Math.max(0, (this.fade || 0) - dt * 1.6);
      this.renderer.update(dt, this.clock, w, view);
      if (this.state !== 'attract') this.hud.update(dt, w, P, u);
    };

    // state transitions that depend on the world
    flow(dt) {
      const w = this.world, u = this.unit();
      if (this.state === 'attract') return;
      if (w.winner) {
        if (!this.endAt) { this.endAt = this.clock; this.unlock(); if (E.Music && E.Music.on) { if (w.winner === this.team) E.Music.victory(w.winner); else E.Music.defeat(this.team); } if (this.state === 'play') this.cmd('release'); this.state = 'ended'; const c = w.cps[2]; Object.assign(this.renderer.camera.orbit, { x: c.pos.x, y: c.pos.y + 20, z: c.pos.z, r: 420, h: 160, speed: 0.06 }); }
        if (!this.ended && this.clock - this.endAt > 3.5) { this.ended = true; const r = this.result(); this.hud.showResults(r); if (this.onEnd) this.onEnd(r); }
        return;
      }
      if (this.state === 'play' && !u) {
        this.state = 'dead'; this.deadAt = this.clock; this.hurt = 1.2;
        const d = this.lastPos || { x: 0, y: 0, z: 0 }; Object.assign(this.renderer.camera.orbit, { x: d.x, y: d.y + 1.5, z: d.z, r: 13, h: 5, speed: 0.3, a: this.renderer.camera.yaw + Math.PI });
        this.renderer.camera.zoom = 0;
      } else if (this.state === 'dead' && this.clock - this.deadAt > 3.2) { this.toDeploy(); }
      else if ((this.state === 'deploy' || this.state === 'commander' || this.state === 'dead') && u) { this.state = 'play'; this.hud.hideDeploy(); this.fade = 0.6; this.renderer.camera.yaw = u.aimYaw; this.renderer.camera.pitch = u.kind === 'fighter' ? u.pitch : (u.kind === 'capital' ? -0.25 : 0); this.renderer.camera.snap(); this.lock(); }
      if (u) this.lastPos = { x: u.pos.x, y: u.pos.y, z: u.pos.z };
    }
    toDeploy() {
      this.state = 'deploy'; this.unlock();
      const c = this.world.cps.find(c => c.owner === this.team) || this.world.cps[2];
      Object.assign(this.renderer.camera.orbit, { x: c.pos.x, y: c.pos.y + 8, z: c.pos.z, r: 200, h: 110, speed: 0.05 });
      this.hud.showDeploy();
    }
    toCommander() {
      const u = this.unit(), c = this.renderer.camera.cmd;
      if (u) { c.x = u.pos.x; c.z = u.pos.z; c.yaw = this.renderer.camera.yaw; this.cmd('release'); }
      this.state = 'commander'; this.unlock(); this.hud.hideDeploy(); this.hud.toast('COMMAND VIEW — select units, right-click to order, F to take control');
    }
    view() {
      const u = this.unit(), s = this.state;
      if (s === 'play' && u) return { mode: 'unit', unit: u, zoomFov: u.def.zoom ? 66 / u.def.zoom : 44 };
      if (s === 'commander') return { mode: 'commander' };
      return { mode: 'orbit', fov: s === 'dead' ? 60 : 50 };
    }
    result() {
      const w = this.world, p = this.player() || {}, T = w.teams[this.team], O = w.teams[E.opponent(this.team)];
      return { won: w.winner === this.team, winner: w.winner, time: w.t, score: p.score || 0, kills: p.kills || 0, deaths: p.deaths || 0, captures: p.captures || 0, best: p.best || 0,
        tickets: T.tickets, enemyTickets: O.tickets, teamKills: T.kills, enemyKills: O.kills, team: this.team };
    }

    // ── input ────────────────────────────────────────────────
    input(dt) {
      const k = this.keys, cam = this.renderer.camera, w = this.world, u = this.unit();
      if (this.paused || this.state === 'attract') return;
      if (this.state === 'play' && u) {
        const zoomable = true;
        cam.zoom += ((this.mouse.r && zoomable ? 1 : 0) - cam.zoom) * Math.min(1, dt * 12);
        let yaw = cam.yaw, pitch = cam.pitch;
        const a = cam.aim(w, u, u.kind === 'capital' ? 3000 : 700); this.aimInfo = a;
        if (u.kind === 'infantry' || u.kind === 'vehicle' || u.kind === 'turret') { yaw = a.yaw; pitch = a.pitch; }
        const inp = { mx: (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0), mz: (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0), moveYaw: cam.yaw, yaw, pitch,
          fire: this.mouse.l && (this.locked() || this.freeFire), abil: k.has('g') || this.mouse.m, sprint: k.has('shift'), jump: k.has(' '),
          roll: (k.has('e') ? 1 : 0) - (k.has('q') ? 1 : 0), crouch: k.has('c'), abil2: k.has('r'), cycle: k.has('t') };
        this.cmd('input', inp);
      } else if (this.state === 'commander') {
        const c = cam.cmd, sp = c.dist * 1.1 * dt, fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        const mz = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0), mx = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0);
        c.x = E.clamp(c.x + (fx * mz - fz * mx) * sp, -1400, 1400); c.z = E.clamp(c.z + (fz * mz + fx * mx) * sp, -1100, 1100);
        if (k.has('q')) c.yaw += dt * 1.4; if (k.has('e')) c.yaw -= dt * 1.4;
      }
    }
    locked() { return document.pointerLockElement === this.canvas; }
    lock() { if (!this.locked() && this.canvas.requestPointerLock) { try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} } }
    unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

    takeControl() {
      const w = this.world, cam = this.renderer.camera, u = this.unit();
      let best = null, bs = 1e9;
      if (this.state === 'commander') { for (const id of this.selected) { const s = w.byId(id); if (s && s.alive && !s.pid) { best = s; break; } } }
      else if (u) {
        const o = cam.cam.position, d = E.SIM.dirOf(cam.yaw, cam.pitch);
        for (const e of w.units) {
          if (!e.alive || e.team !== this.team || e === u || e.pid) continue;
          const dx = e.pos.x - o.x, dy = e.pos.y - o.y, dz = e.pos.z - o.z, l = Math.hypot(dx, dy, dz);
          const ang = Math.acos(E.clamp((dx * d.x + dy * d.y + dz * d.z) / (l || 1), -1, 1));
          const lim = e.kind === 'capital' ? 0.3 : 0.12, maxD = e.kind === 'capital' ? 3000 : e.kind === 'fighter' ? 900 : 300;
          if (ang < lim && l < maxD) { const s = ang * 400 + l * (e.kind === 'infantry' ? 1 : 0.2); if (s < bs) { bs = s; best = e; } }
        }
      }
      if (best) { this.cmd('possess', best.id); this.fade = 0.8; this.hud.toast('NOW CONTROLLING · ' + E.unitName(best.kind, best.type).toUpperCase()); if (E.SFX) E.SFX.play('ui'); }
      else this.hud.toast('Aim at a friendly unit to take control');
    }
    quickControl(kind) {
      const w = this.world, ref = this.lastPos || { x: 0, y: 0, z: 0 };
      let best = null, bd = 1e12;
      for (const e of w.units) if (e.alive && e.team === this.team && !e.pid && e.kind === kind) { const d = E.distXZ2(e.pos, ref) * (e.flag ? 0.1 : 1); if (d < bd) { bd = d; best = e; } }
      if (best) { this.cmd('possess', best.id); this.fade = 0.8; return true; }
      return false;
    }
    squadOrder(type) {
      const w = this.world, u = this.unit(); if (!u) return;
      this.squadMode = type === 'follow' ? 'FOLLOWING' : type === 'attack' ? 'MOVING' : 'FREE';
      if (type === 'follow') {
        const near = w.units.filter(e => e.alive && e.team === this.team && !e.pid && e.kind === 'infantry' && E.distXZ2(e.pos, u.pos) < 70 * 70).sort((a, b) => E.distXZ2(a.pos, u.pos) - E.distXZ2(b.pos, u.pos)).slice(0, 6);
        this.squad = near.map(e => e.id); this.cmd('order', this.squad, 'follow');
        this.hud.toast(near.length ? 'SQUAD: FOLLOW ME (' + near.length + ')' : 'No troops nearby');
      } else if (type === 'attack') {
        if (!this.squad.length) { this.squadOrder('follow'); }
        this.cmd('order', this.squad, 'move', this.renderer.camera.aimPoint); this.hud.toast('SQUAD: MOVE TO TARGET');
      } else { this.cmd('order', this.squad, 'free'); this.squad = []; this.hud.toast('SQUAD: DISMISSED'); }
      if (E.SFX) E.SFX.play('ui');
    }

    keydown(e) {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(k)) e.preventDefault();
      if (!this.running || this.state === 'attract') return;
      if (this.keys.has(k)) return;
      this.keys.add(k);
      if (k === 'f1' || (k === '/' && this.state !== 'play')) { e.preventDefault(); if (this.hud.layerKind === 'controls') this.hud.closeControls(); else this.hud.showControls(); return; }
      if (k === 'escape') { if (this.hud.layerKind === 'controls') { this.hud.closeControls(); return; } if (this.hud.armed) { this.hud.armed = null; this.hud.toast('CANCELLED'); return; } this.togglePause(); return; }
      if (this.paused || this.state === 'ended') return;
      if (k === 'tab') this.hud.scoreboard(true);
      if (this.state === 'play') {
        if (k === 'f') this.takeControl();
        else if (k === 'm') this.toCommander();
        else if (k === 'z') this.squadOrder('follow');
        else if (k === 'x') this.squadOrder('attack');
        else if (k === 'v') this.squadOrder('free');
        else if (k === 'y') this.callAir('any');
        else if (k === 'u') this.callAir('gunship');
        else if (k === 'p') { const c = this.renderer.camera; c.toggleFpv(); this.hud.toast(c.fpv ? 'FIRST PERSON VIEW' : 'THIRD PERSON VIEW'); }
        else this.unitKey(k);
      } else if (this.state === 'commander') {
        const w = this.world, mine = (kind) => w.units.filter(u => u.alive && u.team === this.team && u.kind === kind && !u.pid).map(u => u.id);
        if (k === 'f') this.takeControl();
        else if (k === 'c' || k === 'enter') this.toDeploy();
        else if (k === '1') this.selected = mine('infantry'); else if (k === '2') this.selected = mine('vehicle'); else if (k === '3') this.selected = mine('fighter');
        else if (k === 'h' && this.selected.length) { this.cmd('order', this.selected, 'hold'); this.hud.toast('ORDER: HOLD POSITION'); }
        else if (k === 'v' && this.selected.length) { this.cmd('order', this.selected, 'free'); this.hud.toast('ORDER: FREE FIRE'); }
      } else if (this.state === 'deploy') {
        if (k === 'c') this.toCommander();
        else if (k >= '1' && k <= '4') this.hud.pickClass(+k - 1);
        else if (k === 'enter' || k === ' ') this.hud.doDeploy();
      }
    }
    // call-in and ship verbs bound to keys while playing
    callAir(role) {
      const u = this.unit(), a = this.renderer.camera.aimPoint; if (!u || !a) return;
      this.cmd('verb', 'callAir', { x: a.x, z: a.z }, role); if (E.SFX) E.SFX.play('call');
    }
    unitKey(k) {
      const u = this.unit(); if (!u) return;
      if (u.kind === 'fighter' && k === 'x') this.cmd('verb', 'drop');
      else if (u.kind === 'capital') {
        if (k === 'b') this.cmd('verb', 'board');
        else if (k >= '1' && k <= '4') this.cmd('verb', 'power', +k - 1);
        else if (k === 'n') { const t = this.clock; if (this._nT && t - this._nT < 1.5) { this.cmd('verb', 'retreat'); this._nT = 0; } else { this._nT = t; this.hud.toast(u.retreat ? 'PRESS N AGAIN TO CANCEL THE RETREAT' : 'PRESS N AGAIN TO ORDER THE RETREAT'); } }
      }
    }
    keyup(e) { const k = e.key.toLowerCase(); this.keys.delete(k); if (k === 'tab') this.hud.scoreboard(false); }
    togglePause(force) {
      if (this.state === 'attract' || this.state === 'ended') return;
      this.paused = force !== undefined ? force : !this.paused;
      if (this.paused) { this.unlock(); this.hud.showPause(); } else { this.hud.hidePause(); if (this.state === 'play') this.lock(); }
    }

    bind() {
      const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); };
      on(window, 'keydown', (e) => this.keydown(e));
      on(window, 'keyup', (e) => this.keyup(e));
      on(window, 'blur', () => { this.keys.clear(); this.mouse.l = this.mouse.r = false; });
      on(window, 'mousemove', (e) => {
        this.mouse.x = e.clientX; this.mouse.y = e.clientY;
        if (!this.running || this.paused) return;
        if (this.state === 'play' && this.locked()) this.renderer.camera.look(e.movementX, e.movementY * (this.settings.invertY ? -1 : 1), 0.0021 * (this.settings.sens || 1));
        else if (this.state === 'commander' && this.sel) this.hud.box(this.sel.x, this.sel.y, e.clientX, e.clientY);
      });
      on(this.canvas, 'mousedown', (e) => {
        if (!this.running || this.paused) return;
        if (this.state === 'play') {
          if (!this.locked()) { this.lock(); if (!this.freeFire) return; }
          if (e.button === 0) this.mouse.l = true; else if (e.button === 2) this.mouse.r = true; else if (e.button === 1) { this.mouse.m = true; e.preventDefault(); }
        } else if (this.state === 'commander') {
          if (e.button === 0 && this.hud.armed) { this.fireArmed(e); return; }
          if (e.button === 0) this.sel = { x: e.clientX, y: e.clientY };
          else if (e.button === 2) {
            const p = this.renderer.camera.pick(e.clientX, e.clientY, this.world);
            if (p && this.selected.length) { this.cmd('order', this.selected, 'move', p); this.renderer.fx.ring(p, 14, E.Props.TEAM_COL[this.team], 0.7, true); this.hud.toast('ORDER: MOVE (' + this.selected.length + ')'); if (E.SFX) E.SFX.play('ui'); }
          }
        }
      });
      on(window, 'mouseup', (e) => {
        if (e.button === 0) this.mouse.l = false; else if (e.button === 2) this.mouse.r = false; else this.mouse.m = false;
        if (this.state === 'commander' && this.sel && e.button === 0) {
          const s = this.sel, w = this.world, cam = this.renderer.camera, o = { x: 0, y: 0, vis: false }; this.sel = null; this.hud.box();
          const x0 = Math.min(s.x, e.clientX), x1 = Math.max(s.x, e.clientX), y0 = Math.min(s.y, e.clientY), y1 = Math.max(s.y, e.clientY);
          const mine = w.units.filter(u => u.alive && u.team === this.team && u.kind !== 'turret' && u.kind !== 'capital');
          if (x1 - x0 < 6 && y1 - y0 < 6) { let best = null, bd = 40 * 40; for (const u of mine) { cam.project(u.pos, o); const d = (o.x - s.x) * (o.x - s.x) + (o.y - s.y) * (o.y - s.y); if (o.vis && d < bd) { bd = d; best = u; } } this.selected = best ? [best.id] : []; }
          else this.selected = mine.filter(u => { cam.project(u.pos, o); return o.vis && o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1; }).map(u => u.id);
          if (this.selected.length && E.SFX) E.SFX.play('ui');
        }
      });
      on(this.canvas, 'wheel', (e) => { if (this.state === 'commander') { const c = this.renderer.camera.cmd; c.dist = E.clamp(c.dist * (e.deltaY > 0 ? 1.12 : 0.89), 60, 1100); } e.preventDefault(); }, { passive: false });
      on(window, 'contextmenu', (e) => e.preventDefault());
      on(document, 'pointerlockchange', () => { if (!this.locked() && this.running && this.state === 'play' && !this.paused && !this.world.winner && !this.noAutoPause) this.togglePause(true); });
      const unlockAudio = () => { if (E.Music && !E.Music.on && this.settings.audio !== false) { E.Music.start(this.team || 'aegis'); if (E.SettingsUI) E.SettingsUI.apply(this.settings); } else if (E.Music) E.Music.resume(); };
      on(window, 'pointerdown', unlockAudio); on(window, 'keydown', unlockAudio);
    }

    // ── audio routing (distance-attenuated, rate-limited) ────
    fireArmed(e) {
      const A = this.hud.armed, p = this.renderer.camera.pick(e.clientX, e.clientY, this.world); if (!p) return;
      if (A.kind === 'cas') this.cmd('verb', 'callAir', { x: p.x, z: p.z }, A.role); else this.cmd('verb', 'strike', p.x, p.z);
      this.renderer.fx.ring(p, A.kind === 'strike' ? 26 : 14, A.kind === 'strike' ? [1, 0.2, 0.1] : [1, 0.8, 0.3], 0.9, true);
      this.hud.armed = null; if (E.SFX) E.SFX.play('call');
    }
    audio(events) {
      if (E.AudioDir) { E.AudioDir.events(this, events); return; }
      if (!E.Music || !E.Music.on) return;
      const cam = this.renderer.scene.camera.position, S = E.SFX; let n = 0;
      const u = this.unit(), uid = u ? u.id : -1;
      for (const e of events) {
        if (n > 7) break;
        if (e.type === 'fire') {
          const d = E.V3.distance(cam, e.pos), mine = e.uid === uid, W = E.WEAPONS[e.wk];
          const v = mine ? 0.55 : E.clamp01(1 - d / (W.kind === 'turbo' ? 2600 : 420)) * 0.4;
          if (v > 0.03 && (mine || this.audioGate(e.wk))) { S.play(W.sfx || 'rifle', null, v); n++; }
        } else if (e.type === 'impact' && e.splash > 0) { const v = E.clamp01(1 - E.V3.distance(cam, e.pos) / (300 + e.splash * 40)); if (v > 0.03) { S.play('explosion', null, v * 0.9); n++; } }
        else if (e.type === 'death' && e.kind !== 'infantry') { const v = e.kind === 'capital' ? 1 : E.clamp01(1 - E.V3.distance(cam, e.pos) / 900); if (v > 0.03) { S.play('explosion', null, v); n++; } }
        else if (e.type === 'capture') { S.play('capture', null, 0.7); n++; }
        else if (e.type === 'hit' && e.by === this.pid) { S.play(e.kill ? 'kill' : 'hitmark', null, e.kill ? 0.6 : 0.3); n++; }
        else if (e.type === 'hit' && e.to === this.pid) { S.play(e.sh ? 'shield' : 'hurt', null, 0.5); n++; }
        else if (e.type === 'strikeWarn') { S.play('alarm', null, 0.5); n++; }
      }
    }
    audioGate(wk) { const t = this.clock, g = this._ag || (this._ag = {}); if (t - (g[wk] || 0) < 0.07) return false; g[wk] = t; return true; }
  }

  E.Game = Game;
  E.LOCAL_PID = LOCAL;
})(window.E = window.E || {});
