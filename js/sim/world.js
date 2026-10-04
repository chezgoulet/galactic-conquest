// The World: owns the match state and serializes it. Pure and deterministic —
// it draws only from this.rng and never touches THREE or the DOM. Rendering,
// audio and networking read its state and submit commands (focus, command,
// input) which it applies. M1: surface battle with infantry, vehicles, fighters,
// objectives, combat and bots; M2 adds capitals + orbital space.
(function (E) {
  'use strict';

  class World {
    constructor(opts) {
      opts = opts || {};
      this.human = opts.human || 'aegis';
      this.planet = E.makePlanet(opts.biome || 'tundra', opts.seed !== undefined ? opts.seed : E.RNG(1).i(1e9), opts.scale || 1);
      this.terrain = E.makeTerrain(this.planet);
      this.rng = E.RNG((this.planet.seed * 7919 + 17) | 0);
      this.units = [];
      this.projectiles = [];
      this.objectives = [];
      this.nextId = 1;
      this.t = 0; this.tickN = 0;
      this.possessedId = null;
      this.winner = null;
      this.intensity = 0;
      this.stats = { kills: { aegis: 0, verdant: 0 }, captures: { aegis: 0, verdant: 0 } };
      this.events = [];
      this.playerInput = { x: 0, y: 0, fire: false };
      this.playerLookYaw = 0;
      this.selected = [];
      this.buildObjectives();
      this.spawnForce("aegis", { x: -1500, z: 0 });;
      this.spawnForce("verdant", { x: 1500, z: 0 });;
      this.playerUnit = this.units.find(u => u.team === this.human) || this.units[0];
    }

    groundY(x, z) { return this.terrain.height(x, z); }

    unit(kind, faction, type, role, pos) {
      const T = kind === 'infantry' ? E.INFANTRY : kind === 'vehicle' ? E.VEHICLES : kind === 'fighter' ? E.FIGHTERS : E.CAPITALS;
      const def = (T[type] || T.rifle) || {};
      const u = {
        id: this.nextId++, kind, faction, type, role: role || (def.role || type),
        pos: { x: pos.x, y: this.groundY(pos.x, pos.z), z: pos.z },
        yaw: 0, aim: 0,
        hp: def.hp || 100, maxHp: def.hp || 100,
        shield: 0, maxShield: (kind === 'capital' ? 12000 : kind === 'vehicle' ? 200 : 0) * (this.planet.biomeDef.challenge && this.planet.biomeDef.challenge.thinAir ? 0.6 : 1),
        speed: def.speed || 8, turn: def.turn || 3,
        viewH: def.viewH || 1.7, r: def.r || 1,
        alive: true, team: faction, kills: 0,
        fireT: 0, regenT: 99, _engaged: false, order: null,
      };
      this.units.push(u);
      return u;
    }

    spawnForce(faction, base) {
      const F = E.FORCE_DEFAULT;
      const rr = (n) => { const a = this.rng.angle(), d = this.rng.f(10, 70); return { x: base.x + Math.cos(a) * d, z: base.z + Math.sin(a) * d }; };
      for (const [role, n] of Object.entries({ rifle: F.rifle, recon: F.recon, medic: F.medic }))
        for (let i = 0; i < n; i++) this.unit('infantry', faction, role, role, rr());
      for (const [type, n] of Object.entries(F.vehicle))
        for (let i = 0; i < n; i++) this.unit('vehicle', faction, type, 'gunship', rr());
      for (const [type, n] of Object.entries(F.fighter))
        for (let i = 0; i < n; i++) { const u = this.unit('fighter', faction, type, type, rr()); u.pos.y = this.groundY(u.pos.x, u.pos.z) + 130; }
      // A bot "capital" in the air for each side (the player's can be boarded).
      const cap = this.unit('capital', faction, F.capital, 'cruiser', { x: base.x, z: base.z });
      cap.pos.y = this.groundY(cap.pos.x, cap.pos.z) + 340;
      cap.genome = { r: this.rng.f(0.9, 1.15) };
      cap.yaw = cap.aim = faction === 'aegis' ? Math.PI : 0;
      // medic healers are assigned to the nearest own units
      this.medics = this.units.filter(u => u.role === 'medic');
      return cap;
    }

    buildObjectives() {
      const R = this.rng;
      const O = E.STRUCTURES;
      const mk = (role, x, z, y) => {
        const def = O[role];
        const o = { id: this.nextId++, role, team: role === 'hq' ? (x < 0 ? 'aegis' : 'verdant') : null,
          pos: { x, y: this.groundY(x, z), z }, radius: def.r * 1.4, hp: def.hp, maxHp: def.hp,
          hold: def.hold || 15, owner: def.role === 'hq' ? (x < 0 ? 'aegis' : 'verdant') : null,
          progress: def.role === 'hq' ? 1 : 0, alive: true };
        this.objectives.push(o);
        return o;
      };
      // two HQs (one per side), destroyable -> the main win condition
      mk('hq', -2350, 0, 0);
      mk('hq', 2350, 0, 0);
      // neutral power + depot per side to hold
      mk('power', -1400, R.f(-600, 600), 0);
      mk('power', 1400, R.f(-600, 600), 0);
      mk('depot', -800, R.f(-800, 800), 0);
      mk('depot', 800, R.f(-800, 800), 0);
      // a central power core both fight over
      mk('power', R.f(-200, 200), R.f(-400, 400), 0);
      // space objectives (stations/gateway) appear in M2; reserve the air here
      if (this.planet.biome !== 'gas') {
        const st = mk('station', R.f(-400, 400), R.f(-900, 900), 0);
        st.pos.y = this.groundY(st.pos.x, st.pos.z) + 500; // an orbital station
      }
    }

    unitList() { return this.units; }
    byId(id) { return this.units.find(u => u.id === id); }
    focusedUnit() { return this.possessedId != null ? this.byId(this.possessedId) : null; }
    playerUnit() { return this.playerUnit; }

    // ── commands (submitted by local or remote players) ─────────
    focus(id) {
      const u = this.byId(id);
      if (u && u.alive) this.possessedId = id;
      else this.possessedId = null;
    }
    release() { this.possessedId = null; }
    setInput(inp) { this.playerInput = Object.assign(this.playerInput, inp); }
    setLook(yaw) { this.playerLookYaw = yaw; }
    select(units) { this.selected = units; }
    // 'move'/'attack' pos; 'follow' unit; 'hold'; 'select' handled by Game
    order(sel, type, arg) { E.SIM.command(this, sel || this.selected || E.SIM.myUnits(this, null), type, arg); }

    // which view mode the player is in
    mode() {
      const u = this.focusedUnit();
      if (!u) return 'commander';
      if (u.kind === 'infantry') return 'fps';
      if (u.kind === 'vehicle') return 'vehicle';
      if (u.kind === 'fighter') return 'fighter';
      if (u.kind === 'capital') return 'ship';
      return 'commander';
    }

    // one simulation step (fixed timestep). Pure: reads opts, writes this state.
    tick(dt) { E.SIM.update(this, dt); }
    drainEvents() { const e = this.events; this.events = []; return e; }
  }

  E.World = World;
})(window.E = window.E || {});
