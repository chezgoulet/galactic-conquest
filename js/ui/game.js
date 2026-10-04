// The game controller: owns the world, the renderer, input, and the loop.
// M0 wires a playable preview (move around a planet, possess units, switch
// view modes). M1+ adds command, combat, objectives and the full HUD.
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
      this._lastFrame = performance.now();
      this.HUD = null;
      this._bound = false;
    }

    start(opts) {
      opts = opts || {};
      this.world = new E.World({ biome: opts.biome, seed: opts.seed, scale: opts.scale });
      this.renderer = new E.Renderer(this.canvas);
      this.renderer.setPlanet(this.world.planet);
      // focus the player's starting capital so we open in the air
      this.world.controllerMode = 'commander';
      this.buildHud();
      this.bindInput();
      this.running = true;
      this.last = performance.now();
      this._raf = requestAnimationFrame(this.frame);
      E.bus.emit('game:start', this);
    }

    frame = (now) => {
      if (!this.running) return;
      const dtMs = Math.min(50, now - this.last);
      this.last = now;
      const dt = dtMs / 1000;
      this.pollInput();
      this.acc.add(dt);
      this.acc.pump((h) => this.world.tick(h));
      this.renderer.update(dt, this.world.t, this.world);
      if (this.HUD) this.HUD.update(this.world, this.renderer);
      this._raf = requestAnimationFrame(this.frame);
    };

    pollInput() {
      const k = this.keys, w = this.world;
      let ix = 0, iz = 0;
      if (k.has('w') || k.has('arrowup')) ix += 1;
      if (k.has('s') || k.has('arrowdown')) ix -= 1;
      if (k.has('d')) iz += 1;
      if (k.has('a')) iz -= 1;
      const boost = k.has('shift') ? 2 : 1;
      w.playerInput.x = ix * boost;
      w.playerInput.y = iz * boost;
      // commander view: orbit with the arrows
      if (w.controllerMode === 'commander') {
        if (k.has('arrowleft')) this.renderer.camera.cmdYaw += 0.02;
        if (k.has('arrowright')) this.renderer.camera.cmdYaw -= 0.02;
        if (k.has('arrowup')) this.renderer.camera.cmdDist -= 3;
        if (k.has('arrowdown')) this.renderer.camera.cmdDist += 3;
      }
    }

    // mouse-look while pointer-locked (fps / vehicle)
    onMouseMove(e) {
      const cam = this.renderer.camera, w = this.world;
      if (w.controllerMode !== 'commander' && document.pointerLockElement === this.canvas) {
        cam.look(-e.movementX * 0.0022, -e.movementY * 0.0022);
        // in fps, the unit faces the camera's yaw
        const u = w.focusedUnit();
        if (u && w.controllerMode === 'fps') u.yaw = cam.lookYaw;
      }
    }

    lockPointer() { if (document.pointerLockElement !== this.canvas) this.canvas.requestPointerLock(); }

    keydown(e) {
      const k = e.key.toLowerCase();
      this.keys.add(k);
      const w = this.world;
      if (k === 'f' || k === 'e') this.cyclePossession();
      if (k === 'escape' || k === 'q') { if (document.pointerLockElement) document.exitPointerLock(); else w.release(); }
      if (k === 'c') w.controllerMode === 'commander' ? this.cyclePossession() : w.release();
      if (k === 'v' && w.controllerMode === 'fps') { /* fps stays */ }
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    }
    keyup(e) { this.keys.delete(e.key.toLowerCase()); }

    // Cycle through own units to possess; start from the closest.
    cyclePossession() {
      const w = this.world, pu = w.playerUnit;
      const mine = w.units.filter(u => u.alive && (u.team === pu.team));
      if (!mine.length) return;
      // nearest first
      const px = pu.pos.x, pz = pu.pos.z;
      mine.sort((a, b) => E.dist2v(pu.pos, a.pos) - E.dist2v(pu.pos, b.pos));
      const cur = w.focusedId;
      const i = mine.findIndex(u => u.id === cur);
      const next = mine[(i + 1) % mine.length];
      w.focus(next.id);
      if (w.controllerMode === 'fps') this.lockPointer();
    }

    bindInput() {
      if (this._bound) return; this._bound = true;
      window.addEventListener('keydown', (e) => this.keydown(e));
      window.addEventListener('keyup', (e) => this.keyup(e));
      window.addEventListener('mousemove', (e) => this.onMouseMove(e));
      this.canvas.addEventListener('click', () => {
        const w = this.world;
        if (w.controllerMode === 'fps' || w.controllerMode === 'vehicle') this.lockPointer();
      });
    }

    buildHud() {
      const root = document.getElementById('ui');
      if (!root) return;
      root.innerHTML = `
        <div id="gc-top" class="gc-top"></div>
        <div id="gc-help" class="gc-help">
          <b>Galactic Conquest</b> &nbsp; W A S D move · Mouse look · <b>F</b> possess next unit · <b>C</b>/<b>Esc</b> release ·
          <b>←→</b> orbit · <b>↑↓</b> zoom
        </div>`;
      this.HUD = { top: document.getElementById('gc-top'), update: (w, r) => {
        const pu = w.playerUnit;
        const m = w.controllerMode;
        const u = w.focusedUnit();
        this.HUD.top.innerHTML =
          `<span class="gc-chip gc-${w.planet.biome}">${w.planet.biomeDef.name} · ${w.planet.biomeDef.theme}</span>` +
          `<span class="gc-chip">You: <b>${w.playerUnit.faction === 'aegis' ? 'Concord' : 'Pact'}</b></span>` +
          `<span class="gc-chip gc-mode">${m.toUpperCase()}${u ? ' · ' + u.type + ' ' + (u.hp|0) + 'hp' : ''}</span>` +
          `<span class="gc-chip">${w.units.length} units</span>`;
      } };
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this._raf);
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }

  E.Game = Game;
  E.boot = function (opts) {
    const canvas = document.getElementById('view');
    const g = new E.Game(canvas);
    g.start(opts || {});
    return g;
  };
})(window.E = window.E || {});
