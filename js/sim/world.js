// The World: owns planet, players, units, and the tick. This is the lean M0
// core that M1 (units/combat/objectives/AI) and M2 (space/capitals) expand into
// the full deterministic sim. Units are plain objects read by the renderer.
(function (E) {
  'use strict';

  class World {
    constructor(opts) {
      this.planet = E.makePlanet(opts.biome || 'tundra', opts.seed !== undefined ? opts.seed : (E.RNG(1).i(1e9)), opts.scale || 1);
      this.terrain = E.makeTerrain(this.planet);
      this.units = [];
      this.players = [];
      this.nextId = 1;
      this.t = 0;
      this.tickN = 0;
      this.controllerMode = 'commander';
      this.focusedId = null;
      this.playerInput = { x: 0, y: 0, yaw: 0, pitch: 0, fire: false };
      this.spawnForce('aegis', { x: -2200, z: 0 });
      this.spawnForce('verdant', { x: 2200, z: 0 });
      this.playerUnit = this.units[0];
      this.focusedId = this.playerUnit.id;
    }

    unit(kind, faction, type, role, pos) {
      const T = kind === 'infantry' ? E.INFANTRY : kind === 'vehicle' ? E.VEHICLES : kind === 'fighter' ? E.FIGHTERS : E.CAPITALS;
      const def = (T[type] || T.rifle) || {};
      const u = {
        id: this.nextId++, kind, faction, type, role: role || (def.role || type),
        pos: { x: pos.x, y: this.groundY(pos.x, pos.z), z: pos.z },
        vel: { x: 0, y: 0, z: 0 },
        yaw: 0, aim: 0,
        hp: def.hp || 100, maxHp: def.hp || 100, shield: 0, maxShield: 0,
        speed: def.speed || 8, turn: def.turn || 3,
        viewH: def.viewH || 1.7, r: def.r || 1,
        alive: true, team: faction, // owned: 0 = AI, else player index
        owner: null, target: null, orders: [],
      };
      this.units.push(u);
      return u;
    }

    groundY(x, z) { return this.terrain.height(x, z); }

    spawnForce(faction, base) {
      const F = E.FORCE_DEFAULT;
      // infantry squad
      for (const [role, n] of Object.entries({ rifle: F.rifle, recon: F.recon, medic: F.medic })) {
        for (let i = 0; i < n; i++) {
          const a = E.RNG(this.nextId * 7).angle(), d = E.RNG(this.nextId * 13).f(10, 60);
          this.unit('infantry', faction, role, role, { x: base.x + Math.cos(a) * d, z: base.z + Math.sin(a) * d });
        }
      }
      // vehicles
      for (const [type, n] of Object.entries(F.vehicle)) {
        for (let i = 0; i < n; i++) this.unit('vehicle', faction, type, F.vehicle[type] ? 'gunship' : 'scout', { x: base.x + E.RNG(this.nextId * 3).f(-40, 40), z: base.z + E.RNG(this.nextId * 5).f(-40, 40) });
      }
      // a few fighters in low orbit (visible in the air)
      for (const [type, n] of Object.entries(F.fighter)) {
        for (let i = 0; i < n; i++) {
          const u = this.unit('fighter', faction, type, type, { x: base.x + E.RNG(this.nextId * 11).f(-300, 300), z: base.z + E.RNG(this.nextId * 17).f(-300, 300) });
          u.pos.y = this.groundY(u.pos.x, u.pos.z) + 200 + E.RNG(this.nextId * 23).f(0, 200);
        }
      }
      // starting capital in the air
      const cap = this.unit('capital', faction, F.capital, 'cruiser', { x: base.x, z: base.z });
      cap.pos.y = this.groundY(cap.pos.x, cap.pos.z) + 500;
      const gr = E.RNG(this.nextId * 31);
      cap.genome = { r: gr.f(0.9, 1.15) };
      cap.aim = faction === 'aegis' ? Math.PI : 0;
      cap.yaw = cap.aim;
    }

    unitList() { return this.units; }
    focusedUnit() { return this.units.find(u => u.id === this.focusedId) || null; }
    byId(id) { return this.units.find(u => u.id === id); }

    // M0 preview tick: the possessed unit follows local input; others hover.
    // M1 replaces this with the full deterministic combat/AI tick.
    tick(dt) {
      this.t += dt; this.tickN++;
      const pu = this.playerUnit;
      if (pu && this.controllerMode !== 'commander' && pu.alive) {
        const speed = pu.speed;
        const fx = Math.sin(pu.yaw) * this.playerInput.x + Math.cos(pu.yaw) * this.playerInput.y;
        const fz = Math.cos(pu.yaw) * this.playerInput.x - Math.sin(pu.yaw) * this.playerInput.y;
        pu.pos.x += fx * speed * dt; pu.pos.z += fz * speed * dt;
        pu.pos.y += (this.groundY(pu.pos.x, pu.pos.z) + (pu.kind === 'fighter' ? 8 : pu.kind === 'capital' ? 40 : 0) - pu.pos.y) * Math.min(1, dt * 4);
        if (this.playerInput.x || this.playerInput.y) pu.yaw = Math.atan2(fx, fz);
      }
      // bob the air units
      for (const u of this.units) {
        if (u.kind === 'fighter' || u.kind === 'capital') u.pos.y += Math.sin(this.t * 0.5 + u.id) * dt * 6;
      }
    }

    focus(id) {
      this.focusedId = id;
      const u = this.byId(id);
      if (u) this.controllerMode = u.kind === 'infantry' ? 'fps' : u.kind === 'vehicle' ? 'vehicle' : u.kind === 'fighter' ? 'vehicle' : 'ship';
      else this.controllerMode = 'commander';
    }
    release() { this.focusedId = null; this.controllerMode = 'commander'; }
  }

  E.World = World;
})(window.E = window.E || {});
