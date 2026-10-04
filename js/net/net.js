// Host-authoritative netcode (M3). The host runs the only World; guests send
// commands (input / possess / release / deploy / order) and render interpolated
// snapshots. Determinism is what makes this small:
//
//   • A guest rebuilds the planet, terrain and command posts locally from the
//     host's (biome, seed, scale) — E.makePlanet / E.makeTerrain / the cp layout
//     are pure and identical everywhere — so a snapshot only carries the
//     dynamic state (units, cp ownership, team tickets, event ring).
//   • Snapshots are compact arrays. The first one to a peer is FULL; the rest
//     are DELTAS against the host's previous snapshot (moved / spawned / died).
//     If a guest falls more than two snapshots behind (packet loss / rejoin) the
//     host re-sends a FULL snapshot so it re-syncs without a reconnect.
//   • Commands are the same messages Game.cmd() already builds locally, so the
//     host routes them straight onto the World with the guest's own pid.
//
// Pure parts (pack / applySnapshot / applyDelta / route) run in Node for tests;
// the Relay (WebRTC transport) is wired on in the lobby.
(function (E) {
  'use strict';

  const SNAP_MS = 100;      // 10 Hz snapshots
  const LAG_FULL = 3;       // full snapshot if the guest is >= this many snaps behind
  const EV_RING = 16;       // events replayed per snapshot for guest FX

  // ── snapshot format ──────────────────────────────────────────
  // unit row: [id, kind, type, team, ax, ay, az, yaw, pitch, roll,
  //            vx, vy, vz, hp, maxHp, shield, maxShield, heat, hot, lastFire, onGround, spd, flag]
  // cp row:   [id, owner, cap, contested, na, nv]
  // team:     [tickets, startTickets, cps, kills, deaths, strikesT]
  // player:   [pid, name, kills, deaths, captures, score]
  function urow(u) {
    const p = u.pos, v = u.vel;
    return [u.id, u.kind, u.type, u.team,
      R1(p.x), R1(p.y), R1(p.z), R3(u.yaw), R2(u.pitch), R2(u.roll),
      R1(v ? v.x : 0), R1(v ? v.y : 0), R1(v ? v.z : 0),
      Math.round(u.hp), Math.round(u.maxHp), Math.round(u.shield || 0), Math.round(u.maxShield || 0),
      R2(u.heat || 0), u.hot ? 1 : 0, R2(u.lastFire), u.onGround ? 1 : 0, R2(u.spd || 0), u.flag ? 1 : 0];
  }
  function urowOf(u) { return urow(u); }
  function R1(x) { return Math.round(x * 10) / 10; }
  function R2(x) { return Math.round(x * 100) / 100; }
  function R3(x) { return Math.round(x * 1000) / 1000; }

  function pack(w, ev, prev) {
    const now = {};
    const U = w.units.map((u) => { now[u.id] = urow(u); return now[u.id]; });
    const CP = w.cps.map((c) => [c.id, c.owner || 0, R2(c.cap || 0), c.contested ? 1 : 0, c.n.aegis, c.n.verdant]);
    const TEAM = {};
    for (const f of E.TEAMS) { const T = w.teams[f]; TEAM[f] = [T.tickets, T.startTickets, T.cps, T.kills, T.deaths, R1(T.strikeT)]; }
    const PL = Object.values(w.players).map((p) => [p.id, p.name, p.kills, p.deaths, p.captures, Math.round(p.score), p.unitId || 0, p.team]);
    const PJ = (w.projectiles || []).map((p) => [p.kind, R1(p.pos.x), R1(p.pos.y), R1(p.pos.z), R1(p.vel.x), R1(p.vel.y), R1(p.vel.z), p.team, R1(p.scale || 1)]);
    const STR = (w.strikes || []).map((s) => [R1(s.pos.x), R1(s.pos.y), R1(s.pos.z)]);
    const full = !prev;
    let delta;
    if (!full) {
      const spawn = [], del = [];
      for (const id in now) if (!prev.U || prev.U[id] === undefined) spawn.push(now[id]);
      for (const id in (prev.U || {})) if (now[id] === undefined) del.push(id);
      delta = { s: spawn, u: U.filter((r) => spawn.indexOf(r) === -1 && prev.U && prev.U[r[0]] !== undefined), d: del };
    }
    const s = {
      t: R2(w.t), n: w.tickN, full: full ? 1 : 0,
      u: full ? U : delta.u, s: full ? U : delta.s, d: full ? [] : delta.d,
      cp: CP, team: TEAM, pl: PL,
      ev: (ev || []).slice(-EV_RING),
      win: w.winner, I: R2(w.intensity || 0),
      pj: PJ, str: STR,
    };
    s._U = now; // host-side: the full unit map this snapshot represents
    return s;
  }

  // Rebuild a guest unit from a snapshot row. def/vel/etc. come from the row so
  // the renderer (which reads u.def, u.vel, u.lastFire, …) never sees undefined.
  function unitFrom(r) {
    const def = E.unitDef(r[1], r[2]) || {};
    return {
      id: r[0], kind: r[1], type: r[2], team: r[3], def, armor: def.armor,
      pos: { x: r[4], y: r[5], z: r[6] }, vel: { x: r[10], y: r[11], z: r[12] },
      yaw: r[7], pitch: r[8], roll: r[9], aimYaw: r[7], aimPitch: r[8],
      hp: r[13], maxHp: r[14] || r[13], shield: r[15], maxShield: r[16],
      heat: r[17], hot: !!r[18], lastFire: r[19], onGround: !!r[20], spd: r[21],
      r: def.r || 2, h: def.h || 2, flag: !!r[22], alive: true, pid: null,
    };
  }

  // A guest-side world. Same read interface the Renderer + Game + HUD use as the
  // host World, backed by a locally-built real World for static geometry, with
  // the dynamic state overlaid from snapshots.
  class RemoteWorld {
    constructor(opts) {
      opts = opts || {};
      this.faction = opts.faction || 'verdant';
      this.name = opts.name || 'Commander';
      this._base = new E.World({ biome: opts.biome || 'desert', seed: opts.seed || 1, scale: opts.scale || 1, human: this.faction });
      this.terrain = this._base.terrain;
      this.planet = this._base.planet;
      this.cps = this._base.cps;                 // positions/names are static; ownership/cap are overlaid
      this.units = []; this.umap = new Map();
      this.projectiles = []; this.strikes = [];
      this.teams = { aegis: this._base.teams.aegis, verdant: this._base.teams.verdant };
      this.players = {};
      this.winner = null; this.intensity = 0; this.t = 0; this.tickN = 0;
      this.human = this.faction;                  // the guest plays their assigned faction
      this._ev = []; this._ready = false;
    }
    // static + derived reads
    unitList() { return this.units; }
    byId(id) { return this.umap.get(id) || null; }
    unitOf(pid) { const p = this.players[pid]; return p && p.unitId ? this.umap.get(p.unitId) || null : null; }
    player(pid) { return this.players[pid] || null; }
    team(f) { return this.teams[f]; }
    groundY(x, z) { return this.terrain.ground(x, z); }
    drainEvents() { const e = this._ev; this._ev = []; return e; }
    ready() { return this._ready; }
    isRemote() { return true; }

    // host -> guest
    apply(s) {
      this.t = s.t; this.tickN = s.n; this.winner = s.win; this.intensity = s.I;
      this._ev = this._ev.concat(s.ev || []);
      this._applyCps(s.cp);
      this._applyTeams(s.team);
      this._applyPlayers(s.pl);
      this._applyUnits(s);
      this._applyProjectiles(s);
      if (!this._ready) { this._ready = true; }
    }
    _applyCps(cp) {
      for (const r of cp) { const c = this.cps[r[0]]; if (!c) continue; c.owner = r[1] || null; c.cap = r[2]; c.contested = !!r[3]; c.n = { aegis: r[4], verdant: r[5] }; }
    }
    _applyTeams(team) {
      for (const f of E.TEAMS) { const r = team[f]; if (!r) continue; const T = this.teams[f]; T.tickets = r[0]; T.startTickets = r[1]; T.cps = r[2]; T.kills = r[3]; T.deaths = r[4]; T.strikeT = r[5]; }
    }
    _applyPlayers(pl) {
      for (const r of pl) this.players[r[0]] = { id: r[0], name: r[1], kills: r[2], deaths: r[3], captures: r[4], score: r[5], unitId: r[6] || 0, team: r[7] || this.faction, input: {} };
    }
    _applyUnits(s) {
      const um = new Map();
      const set = (row) => { const u = unitFrom(row); this.units = this.units.filter((x) => x.id !== u.id); this.units.push(u); um.set(u.id, u); };
      if (s.full) { for (const r of s.u) set(r); }
      else {
        for (const u of this.units) um.set(u.id, u);
        for (const id of (s.d || [])) um.delete(id);
        for (const r of (s.s || [])) set(r);
        for (const r of (s.u || [])) set(r);
      }
      this.units = [...um.values()];
      this.umap = um;
    }
    _applyProjectiles(s) {
      this.projectiles = (s.pj || []).map((r) => ({ kind: r[0], pos: { x: r[1], y: r[2], z: r[3] }, vel: { x: r[4], y: r[5], z: r[6] }, team: r[7], scale: r[8] }));
      this.strikes = (s.str || []).map((r) => ({ pos: { x: r[0], y: r[1], z: r[2] } }));
    }
  }

  // Route a guest command (the exact shape Game.cmd sends) onto the host World.
  function route(w, c) {
    if (!c || !c.pid) return;
    const { pid } = c;
    if (c.t === 'input') w.setInput(pid, c.a);
    else if (c.t === 'possess') w.possess(pid, c.a);
    else if (c.t === 'release') w.release(pid);
    else if (c.t === 'deploy') w.deploy(pid, c.a, c.b);
    else if (c.t === 'order') w.order(pid, c.a, c.b, c.c);
  }

  // The per-match session: host runs the sim and broadcasts snapshots; a guest
  // forwards commands to the host and applies snapshots to its RemoteWorld.
  //
  // Events are a single queue on the World, so the host's Game.frame drains them
  // once (for FX / audio / HUD) and hands them to the session; the session folds
  // them into the next snapshot's ring. This avoids the drain race where two
  // consumers would each eat half the events.
  class NetSession {
    constructor() { this.role = null; this.game = null; this.relay = null; this._last = 0; this._prev = null; this._guests = new Map(); this._evBuf = []; this._nextPid = 2; }

    // host(role='host') — attach after the game has a world + relay
    host(game) {
      this.role = 'host'; this.game = game; this.relay = game.relay;
      this.relay.on('msg', (m) => this.onCmd(m));
      this.relay.on('peer', (m) => { if (m.open) this.onPeer(m); });
      this.relay.on('left', (m) => this.onLeft(m));
      this._last = 0;
      // adopt peers that opened during the lobby (online): they already have a
      // live DataChannel but were never registered with a World. Re-emit them so
      // onPeer assigns a faction/pid and (re)sends the meta.
      for (const p of (this.relay.peers ? this.relay.peers.values() : [])) {
        if (p.isGuest && p.dc && p.dc.readyState === 'open' && !this._guests.has(p.id)) this.onPeer({ id: p.id, name: p.name, open: true });
      }
    }

    guest(game) {
      this.role = 'guest'; this.game = game; this.relay = game.relay;
      this.relay.on('msg', (m) => {
        if (m.from !== 0) return;
        let s; try { s = JSON.parse(m.data); } catch { return; }
        if (s.t === 'meta') return; // the lobby boots the game from this
        game.world.apply(s);
      });
    }

    // called once per frame by Game.frame with the freshly drained events
    frame(w, events, now) {
      if (this.role !== 'host' || !w) return;
      this._evBuf = this._evBuf.concat(events).slice(-EV_RING);
      if (now - this._last < SNAP_MS) return;
      this._last = now;
      const s = pack(w, this._evBuf, this._prev);
      const fullStr = JSON.stringify(strip(pack(w, this._evBuf, null)));
      const str = JSON.stringify(strip(s));
      for (const [id, info] of this._guests) {
        const behind = s.full || (s.n - (info.lastN || 0)) >= LAG_FULL;
        this.relay.send(id, behind ? fullStr : str);
        info.lastN = s.n;
      }
      this._evBuf = [];
      this._prev = s._U;
    }

    onPeer(m) {
      const w = this.game.world;
      const f = E.opponent(w.human);   // 2-player slice: guest takes the opposing faction
      const pid = 'p' + (this._nextPid++);
      w.addPlayer(pid, f, m.name || 'Commander');
      this._guests.set(m.id, { pid, faction: f, lastN: 0 });
      this.relay.send(m.id, JSON.stringify({ t: 'meta', biome: w.planet.biome, seed: w.planet.seed, scale: w.planet.scale || 1, faction: f, name: m.name || 'Commander', pid }));
      E.bus.emit('net:peer', { id: m.id, faction: f });
    }
    onLeft(m) {
      const g = this._guests.get(m.id); if (!g) return;
      const w = this.game.world; if (w.removePlayer) w.removePlayer(g.pid);
      this._guests.delete(m.id);
      E.bus.emit('net:left', { id: m.id });
    }
    onCmd(m) {
      const g = this._guests.get(m.from); if (!g) return;
      let c; try { c = JSON.parse(m.data); } catch { return; }
      c.pid = g.pid;
      route(this.game.world, c);
    }

    stop() { this._guests.clear(); this._evBuf = []; this._prev = null; }
  }

  function strip(s) { const { _U, ...rest } = s; return rest; }

  E.Net = { SNAP_MS, LAG_FULL, pack, unitFrom, route, RemoteWorld, NetSession };
})(window.E = window.E || {});
