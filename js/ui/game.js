// The game controller: owns the world, the renderer, input, and the loop.
// M1 adds the battle controls:
//   Left-click      select nearest own unit at cursor (ground)
//   Left-drag       box-select own units
//   Right-click     command the selection (attack-move to that point)
//   F               possess the nearest own unit (board it)
//   Esc / C         release possession / back to commander view
//   WASD            move (possessed) or orbit (commander)
//   Mouse           look (fps / vehicle / ship)
//   Left-click while possessing on foot   fire
(function (E) {
  'use strict';

  class Game {
    constructor(canvas) {
      this.canvas = canvas;
      this.world = null;
      this.renderer = null;
      this.keys = new Set();
      this.running = false;
      this.acc = new E.Accumulator(30);
      this.last = 0;
      this.HUD = null;
      this._bound = false;
      this._sel = null;
    }

    start(opts) {
      opts = opts || {};
      this.world = new E.World({ biome: opts.biome, seed: opts.seed, scale: opts.scale, human: opts.human || 'aegis' });
      this.renderer = new E.Renderer(this.canvas);
      this.renderer.setPlanet(this.world.planet);
      this.buildHud();
      this.bindInput();
      this.startMusic();
      this.running = true;
      this.last = performance.now();
      this._raf = requestAnimationFrame(this.frame);
      E.bus.emit('game:start', this);
      return this;
    }

    frame = (now) => {
      if (!this.running) return;
      const dtMs = Math.min(50, now - this.last);
      this.last = now;
      const dt = dtMs / 1000;
      this.pollInput();
      this.acc.add(dt);
      this.acc.pump((h) => this.world.tick(h));
      // drain sim events into FX + audio
      const events = this.world.drainEvents();
      if (events.length) { this.renderer.fx.applyEvents(events); if (E.Music && E.Music.on) E.Music.onEvents(events); }
      if (E.Music) E.Music.setIntensity(this.world.intensity);
      if (this.world.winner && !this._won) { this._won = true; if (E.Music && E.Music.on) E.Music.victory(this.world.winner); }
      this.renderer.fx.syncProjectiles(this.world.projectiles);
      this.renderer.update(dt, this.world.t, this.world);
      if (this.HUD) this.HUD.update(this.world, this.renderer);
      this._raf = requestAnimationFrame(this.frame);
    };

    // world point from a screen pixel (ray to ground plane)
    pick(x, y) {
      const cam = this.renderer.camera.cam;
      const nd = { x: (x / window.innerWidth) * 2 - 1, y: -(y / window.innerHeight) * 2 + 1 };
      const ray = new E.THREE.Raycaster();
      ray.setFromCamera(nd, cam);
      // intersect ground plane y=0 (approx; terrain height refined by caller)
      const origin = ray.ray.origin, dir = ray.ray.direction;
      if (Math.abs(dir.y) < 1e-5) return null;
      const t = -origin.y / dir.y;
      if (t < 0) return null;
      const px = origin.x + dir.x * t, pz = origin.z + dir.z * t;
      return { x: px, y: this.world.groundY(px, pz), z: pz };
    }

    pollInput() {
      const k = this.keys, w = this.world;
      let ix = 0, iy = 0;
      if (k.has('w')) ix += 1;
      if (k.has('s')) ix -= 1;
      if (k.has('d')) iy += 1;
      if (k.has('a')) iy -= 1;
      const boost = k.has('shift') ? 1.8 : 1;
      w.setInput({ x: ix * boost, y: iy * boost });
      if (w.mode() === 'commander') {
        if (k.has('arrowleft')) this.renderer.camera.cmdYaw += 0.02;
        if (k.has('arrowright')) this.renderer.camera.cmdYaw -= 0.02;
        if (k.has('arrowup')) this.renderer.camera.cmdDist = Math.max(40, this.renderer.camera.cmdDist - 4);
        if (k.has('arrowdown')) this.renderer.camera.cmdDist = Math.min(1200, this.renderer.camera.cmdDist + 4);
        // commander auto-orbits slowly
        if (!k.has('arrowleft') && !k.has('arrowright')) this.renderer.camera.cmdYaw += 0.0015;
      }
    }

    onMouseMove(e) {
      const cam = this.renderer.camera, w = this.world;
      if (w.mode() !== 'commander' && document.pointerLockElement === this.canvas) {
        cam.look(-e.movementX * 0.0022, -e.movementY * 0.0022);
        w.setLook(cam.lookYaw);
        this._mx = e.clientX; this._my = e.clientY;
      }
    }

    lockPointer() { if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock(); }
    unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

    keydown(e) {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      const w = this.world;
      if (k === 'f') this.possessNext();
      if (k === 'escape') { if (document.pointerLockElement) this.unlock(); else { w.release(); w.select([]); } }
      if (k === 'c') { w.mode() === 'commander' ? this.possessNext() : (w.release(), w.select([])); }
      if (k === 'v' && w.mode() === 'commander') this.focusSelected();
      if (k === 'r') this.toggleSelectMode();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    }
    keyup(e) { this.keys.delete(e.key.toLowerCase()); }

    focusSelected() {
      const sel = this.world.selected;
      if (sel.length) this.world.focus(sel[0].id);
    }

    possessNext() {
      const w = this.world;
      const mine = w.units.filter(u => u.alive && u.team === w.human);
      if (!mine.length) return;
      const ref = w.playerUnit ? w.playerUnit.pos : { x: 0, z: 0 };
      mine.sort((a, b) => E.distXZ2(ref, a.pos) - E.distXZ2(ref, b.pos));
      const cur = w.possessedId;
      const i = mine.findIndex(u => u.id === cur);
      const next = mine[(i + 1) % mine.length];
      w.focus(next.id);
      if (w.mode() === 'fps' || w.mode() === 'fighter') this.lockPointer();
    }

    onMouseDown(e) {
      const w = this.world;
      if (e.button === 0) {
        if (w.mode() !== 'commander') { // firing
          w.setInput({ fire: true });
          this._fireHeld = true;
          return;
        }
        const p = this.pick(e.clientX, e.clientY);
        if (p) {
          // box select if shift, else nearest
          if (this._sel === null) { this._sel = { x0: e.clientX, y0: e.clientY, shift: e.shiftKey }; this._selActive = true; }
          else {
            if (e.shiftKey) this.boxSelect(e);
            else { const u = E.SIM.selectNearest(w, p, 40); w.select(u ? [u] : []); }
            this._sel = null;
          }
        }
      } else if (e.button === 2) {
        // right-click: command selection (attack-move) or focus single
        const p = this.pick(e.clientX, e.clientY);
        if (p) {
          if (w.selected.length) w.order(w.selected, 'attack', { pos: p });
          else { const u = E.SIM.selectNearest(w, p, 40); if (u) { w.select([u]); w.order([u], 'attack', { pos: p }); } }
        }
      }
    }
    onMouseUp(e) {
      if (this._fireHeld) { this.world.setInput({ fire: false }); this._fireHeld = false; }
      if (this._selActive && e.button === 0) { this._selActive = false; this._sel = null; }
    }
    boxSelect(e) {
      const a = this.pick(this._sel ? this._sel.x0 : e.clientX, this._sel ? this._sel.y0 : e.clientY);
      const b = this.pick(e.clientX, e.clientY);
      if (a && b) this.world.select(E.SIM.selectBox(this.world, a, b));
    }

    bindInput() {
      if (this._bound) return; this._bound = true;
      window.addEventListener('keydown', (e) => this.keydown(e));
      window.addEventListener('keyup', (e) => this.keyup(e));
      window.addEventListener('mousemove', (e) => this.onMouseMove(e));
      window.addEventListener('mousedown', (e) => this.onMouseDown(e));
      window.addEventListener('mouseup', (e) => this.onMouseUp(e));
      window.addEventListener('contextmenu', (e) => e.preventDefault());
      this.canvas.addEventListener('click', () => { if (this.world.mode() === 'commander') this.lockPointer && this.unlock(); });
    }

    // Audio needs a user gesture to start. Unlock on the first click/keypress.
    startMusic() {
      const unlock = () => {
        if (E.Music && !E.Music.on) { E.Music.start(this.world.human); E.Music.setIntensity(this.world.intensity); }
        else if (E.Music && E.Music.resume) E.Music.resume();
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('keydown', unlock);
      };
      window.addEventListener('pointerdown', unlock);
      window.addEventListener('keydown', unlock);
    }

    buildHud() {
      const root = document.getElementById('ui');
      if (!root) return;
      root.innerHTML = `
        <div id="gc-top" class="gc-top"></div>
        <div class="gc-crosshair" id="gc-cross" style="display:none"></div>
        <div id="gc-bridge" class="gc-bridge" style="display:none"></div>
        <div id="gc-help" class="gc-help">
          <b>Galactic Conquest</b> · Left-click select · Left-drag box · Right-click attack-move · <b>F</b> board · <b>V</b> drive selected · <b>C/Esc</b> release · <b>↑↓←→</b> orbit · WASD move
        </div>`;
      this.HUD = {
        top: document.getElementById('gc-top'),
        cross: document.getElementById('gc-cross'),
        bridge: document.getElementById('gc-bridge'),
        update: (w, r) => {
          const m = w.mode();
          const u = w.focusedUnit();
          this.HUD.cross.style.display = (m === 'fps' || m === 'fighter') ? 'block' : 'none';
          const isShip = (m === 'ship' || m === 'fighter') && u;
          this.HUD.bridge.style.display = isShip ? 'block' : 'none';
          // throttle DOM rebuild to ~12 Hz
          this._hudT = (this._hudT || 0) + 1;
          if (this._hudT % 5 !== 0 && isShip === this._wasShip) return;
          this._wasShip = isShip;
          if (isShip) this.bridgeHud(w, u, r);
          const objs = w.objectives;
          const aegisCap = objs.filter(o => o.owner === 'aegis').length;
          const verdantCap = objs.filter(o => o.owner === 'verdant').length;
          this.HUD.top.innerHTML =
            `<span class="gc-chip gc-${w.planet.biome}">${w.planet.biomeDef.name} · ${w.planet.biomeDef.theme}</span>` +
            `<span class="gc-chip">You: <b>${w.human === 'aegis' ? 'Concord' : 'Pact'}</b></span>` +
            `<span class="gc-chip gc-mode">${m.toUpperCase()}${u ? ' · ' + u.type + ' ' + (u.hp | 0) + '/' + u.maxHp : ''}</span>` +
            `<span class="gc-chip">Obj <b class="aegis">${aegisCap}</b> : <b class="verdant">${verdantCap}</b></span>` +
            `<span class="gc-chip">${w.selected.length ? w.selected.length + ' selected' : (w.units.length) + ' units'}</span>` +
            (w.winner ? `<span class="gc-chip" style="border-color:var(--ok)">VICTORY: ${w.winner.toUpperCase()}</span>` : '');
        },
        bridgeHud: (w, u, r) => {
          const f = E.faction(u.faction);
          const C = E.CAPITALS[u.type] || {};
          const hpF = E.clamp01(u.hp / u.maxHp);
          const shF = u.maxShield ? E.clamp01(u.shield / u.maxShield) : 0;
          const t = r.currentTarget;
          const tr = t ? Math.round(r.currentTargetDist) : '—';
          const tName = t ? E.unitName(t.kind, t.type) : '—';
          const tFaction = t ? (t.team === 'aegis' ? 'Concord' : 'Pact') : '—';
          const bays = Math.round(u.bays != null ? u.bays : (C.bays || 0));
          this.HUD.bridge.innerHTML = `
            <div class="bridge-fac ${u.team}">${f.short} · ${C.name || u.type}</div>
            <div class="bridge-bars">
              <div class="bar hp"><i style="width:${(hpF * 100).toFixed(1)}%"></i><span>${(u.hp | 0).toLocaleString()} / ${u.maxHp.toLocaleString()}</span></div>
              <div class="bar sh"><i style="width:${(shF * 100).toFixed(1)}%"></i><span>${(u.shield | 0).toLocaleString()}</span></div>
            </div>
            <div class="bridge-target">
              <div class="lbl">TARGET</div>
              <div class="tv">${tName} <b>${tFaction}</b> · ${tr}m</div>
            </div>
            <div class="bridge-sub">
              <div class="lbl">BAYS</div><div class="tv">${bays} ${u.kind === 'fighter' ? '' : 'fighters'}</div>
              <div class="lbl">SPEED</div><div class="tv">${u.speed} m/s</div>
            </div>`;
        }
      };
    }

    stop() { this.running = false; cancelAnimationFrame(this._raf); this.unlock(); }
  }

  E.Game = Game;
  E.boot = function (opts) {
    const canvas = document.getElementById('view');
    return new E.Game(canvas).start(opts || {});
  };
})(window.E = window.E || {});
