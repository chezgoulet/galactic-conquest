// The World: owns the match state. Pure and deterministic — it draws only from
// this.rng and never touches THREE or the DOM. Rendering, audio and networking
// read its state and submit player commands (input, possess, deploy, order).
//
// A match is a conquest battle: two factions fight over five command posts on
// the ground while their capital ships duel overhead. Every death costs the
// side a reinforcement ticket, holding the majority of posts bleeds the enemy,
// and the side that runs out of tickets (or loses every post and soldier) loses.
(function (E) {
  'use strict';
  const TEAMS = ['aegis', 'verdant'];
  const DIFF = {
    easy:   { aiErr: 0.075, enemyDmg: 0.55, enemyTickets: 0.85 },
    normal: { aiErr: 0.06, enemyDmg: 0.8,  enemyTickets: 1 },
    hard:   { aiErr: 0.045, enemyDmg: 1.0,  enemyTickets: 1.2 },
  };

  class World {
    constructor(opts) {
      opts = opts || {};
      this.human = opts.human || 'aegis';
      this.planet = E.makePlanet(opts.biome || 'desert', opts.seed !== undefined ? opts.seed : 1, opts.scale || 1);
      this.terrain = E.makeTerrain(this.planet);
      this.layout = this.terrain.layout;
      this.rng = E.RNG((this.planet.seed * 7919 + 17) | 0);
      this.units = []; this.umap = new Map();
      this.projectiles = []; this.strikes = [];
      this.nextId = 1; this.nextProj = 1;
      this.t = 0; this.tickN = 0;
      this.winner = null; this.intensity = 0;
      this.events = [];
      this.players = {};
      this.diff = opts.difficulty || 'normal';
      const D = DIFF[this.diff] || DIFF.normal;
      this.cfg = { aiErr: D.aiErr, enemyDmg: D.enemyDmg };
      // per-side scale + campaign bonuses
      const sc = (f) => (opts.scale2 && opts.scale2[f]) || (f === this.human ? (opts.fleetScale || 1) : (opts.enemyScale || 1));
      const bon = (f) => (opts.bonus && opts.bonus[f]) || {};
      this.teams = {};
      for (const f of TEAMS) {
        const b = bon(f), s = sc(f);
        const enemyT = (f !== this.human && !opts.pvp) ? D.enemyTickets : 1;
        this.teams[f] = {
          id: f, scale: s, bonus: b,
          tickets: Math.round(E.FORCE.tickets * (0.75 + s * 0.25) * enemyT * (b.ticketMul || 1) + (b.reserves ? 40 : 0)), startTickets: 0,
          infCap: Math.round(E.FORCE.infantry * (0.8 + s * 0.2)),
          waveT: 4, vehT: { skiff: 20, tank: 35 }, airT: 10, bleedT: 0, strikeT: b.orbital ? 25 : 60,
          kills: 0, deaths: 0, captures: 0, cps: 0,
          fleet: opts.fleet && opts.fleet[f] ? opts.fleet[f].slice() : [s > 1.7 ? 'dreadnought' : s > 1.3 ? 'carrier' : E.FORCE.capital].concat(b.escort ? ['cruiser'] : []),
        };
        this.teams[f].startTickets = this.teams[f].tickets;
      }
      this.cps = this.layout.cps.map((c, i) => ({
        id: i, name: c.name, pos: { x: c.x, y: c.y, z: c.z }, r: c.r, home: c.home || null,
        owner: c.home || null, cap: c.home ? (c.home === 'aegis' ? 1 : -1) : 0, // cap: +1 aegis .. -1 verdant
        n: { aegis: 0, verdant: 0 }, contested: false,
      }));
      E.SIM.setup(this);
    }

    // ── queries ────────────────────────────────────────────────
    groundY(x, z) { return this.terrain.ground(x, z); }
    byId(id) { return this.umap.get(id) || null; }
    unitList() { return this.units; }
    player(pid) { return this.players[pid] || null; }
    unitOf(pid) { const p = this.players[pid]; return p && p.unitId ? this.byId(p.unitId) : null; }
    team(f) { return this.teams[f]; }

    // ── player commands ────────────────────────────────────────
    addPlayer(pid, team, name) {
      const p = { id: pid, team, name: name || 'Commander', unitId: 0, deadT: -99, selected: [],
        input: { mx: 0, mz: 0, moveYaw: 0, yaw: 0, pitch: 0, fire: false, abil: false, sprint: false, jump: false },
        score: 0, kills: 0, deaths: 0, captures: 0, streak: 0, best: 0 };
      this.players[pid] = p;
      return p;
    }
    removePlayer(pid) { this.release(pid); delete this.players[pid]; }
    setInput(pid, inp) { const p = this.players[pid]; if (p) Object.assign(p.input, inp); }
    possess(pid, uid) { return E.SIM.possess(this, pid, uid); }
    release(pid) { E.SIM.release(this, pid); }
    deploy(pid, type, cpId) { return E.SIM.deploy(this, pid, type, cpId); }
    order(pid, ids, type, pos) { E.SIM.order(this, pid, ids, type, pos); }

    tick(dt) { E.SIM.update(this, dt); }
    drainEvents() { const e = this.events; this.events = []; return e; }
  }

  E.World = World;
  E.TEAMS = TEAMS;
  E.DIFFICULTY = DIFF;
})(window.E = window.E || {});
