'use strict';
// SPACE: orbit station-keeping, shield arcs, subsystems and their consequences,
// battle stages, retreat, orbital strikes, boarding actions, player command.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const load = require('../tools/load.cjs');
const E = load(load.files(['core', 'data', 'sim']));
const S = E.SIM, V = E.V3, HZ = 30, DT = 1 / HZ;

const mk = (seed, fleet) => new E.World({ biome: 'desert', seed: seed || 5, fleet: fleet || { aegis: ['dreadnought', 'carrier', 'cruiser'], verdant: ['dreadnought', 'cruiser', 'cruiser'] } });
const run = (w, sec, cb) => { for (let i = 0; i < sec * HZ; i++) { w.tick(DT); if (cb && cb(w, i) === false) break; } };
const ships = (w, t) => S.capsOf(w, t);
const find = (w, t, type) => ships(w, t).find(u => !type || u.type === type);
const src = (team, vel) => ({ wk: 'turbo', team, uid: 0, owner: null, vel: vel || { x: 0, y: 0, z: 0 }, r: 0.5 });
const right = (u) => ({ x: -Math.cos(u.yaw), z: Math.sin(u.yaw) });
function dropShields(u) { for (const a of u.arcs) a.v = 0; }
function isolate(w) { for (const u of w.units) if (u.kind !== 'capital') u.alive = false; } // clean sky for a unit test

test('capital ships hold station in the orbit band and are enormous', () => {
  const w = mk();
  run(w, 90);
  for (const u of w.units.filter(x => x.kind === 'capital')) {
    assert.ok(u.pos.y > E.SIM.ALT.space && Math.abs(u.pos.y - S.ALT.orbit) < 160, `${u.type} at ${u.pos.y}`);
    if (!u.retreat) assert.ok(Math.hypot(u.pos.x, u.pos.z) < w.layout.bound, 'inside the arena');   // a withdrawing ship leaves it on purpose
  }
  assert.ok(E.CAPITALS.dreadnought.len >= 700 && E.CAPITALS.frigate.len < E.CAPITALS.cruiser.len && E.CAPITALS.cruiser.len < E.CAPITALS.carrier.len);
  assert.strictEqual(S.CAP_ALT, S.ALT.orbit);
  const roles = new Set(Object.values(E.CAPITALS).map(c => c.role));
  for (const r of ['screen', 'line', 'carrier', 'flagship']) assert.ok(roles.has(r), r);
  // a fighter at 150 m/s needs ~5 s to cross a dreadnought and ~15 s to reach the other fleet
  assert.ok(E.CAPITALS.dreadnought.len / 150 > 4.5);
  const a = find(w, 'aegis'), v = find(w, 'verdant');
  assert.ok(V.distance(a.pos, v.pos) / 150 > 8, 'fleets are well apart at the start');
  const f = w.units.find(u => u.kind === 'fighter' && u.team === 'aegis');
  assert.ok(f, 'fighters launch with the fleet');
});

test('every capital has the required subsystems with hull-local coordinates', () => {
  const w = mk();
  for (const u of w.units.filter(x => x.kind === 'capital')) {
    for (const n of ['shield', 'engines', 'batteries', 'hangar', 'bridge']) {
      const s = u.sys[n]; assert.ok(s && s.alive && s.hp === s.maxHp && s.r > 0 && 'lx' in s && 'ly' in s && 'lz' in s, `${u.type}.${n}`);
    }
    const p = S.sysPos(u, 'bridge', {}); assert.ok(Number.isFinite(p.x + p.y + p.z));
    assert.ok(V.distance(p, u.pos) < u.def.len, 'inside the hull');
  }
});

test('a hit on a shield arc drains that arc and not the opposite one', () => {
  const w = mk(); isolate(w);
  const u = find(w, 'aegis', 'cruiser'), r = right(u);
  const before = u.arcs.map(a => a.v);
  const at = { x: u.pos.x - r.x * 70, y: u.pos.y, z: u.pos.z - r.z * 70 }; // port side
  S.applyDamage(w, u, 6000, src('verdant', { x: r.x * 500, y: 0, z: r.z * 500 }), at);
  assert.ok(u.arcs[2].v < before[2] - 100, 'port arc drained');
  assert.strictEqual(u.arcs[3].v, before[3], 'starboard arc untouched');
  assert.strictEqual(u.arcs[0].v, before[0]); assert.strictEqual(u.arcs[1].v, before[1]);
  assert.strictEqual(u.hp, u.maxHp, 'hull untouched while the arc holds');
  assert.ok(w.events.some(e => e.type === 'shieldHit' && e.uid === u.id && e.arc === 2));
  // the aggregate the HUD reads follows the arcs
  run(w, 0.1); assert.ok(Math.abs(u.shield - u.arcs.reduce((s, a) => s + a.v, 0)) < 1e-6);
  // an arc that breaks reports it, and regenerates only after a quiet spell
  u.arcs[2].v = 10; S.applyDamage(w, u, 6000, src('verdant', { x: r.x * 500, y: 0, z: r.z * 500 }), at);
  assert.strictEqual(u.arcs[2].v, 0); assert.ok(w.events.some(e => e.type === 'shieldDown' && e.arc === 2));
  run(w, 2); assert.strictEqual(u.arcs[2].v, 0, 'no regen in the first seconds');
  run(w, 14); assert.ok(u.arcs[2].v > 0, 'regenerates after the delay');
});

test('damage reaches a subsystem along the shot path only once the arc is down', () => {
  const w = mk(); isolate(w);
  const u = find(w, 'aegis', 'dreadnought'), b = S.sysPos(u, 'bridge', {});
  const dir = { x: Math.sin(u.yaw + 1.2), y: 0.2, z: Math.cos(u.yaw + 1.2) }; V.normalize(dir);
  const at = { x: b.x - dir.x * u.h * 1.2, y: b.y - dir.y * u.h * 1.2, z: b.z - dir.z * u.h * 1.2 };
  const hit = () => S.applyDamage(w, u, 3000, src('verdant', { x: dir.x * 600, y: dir.y * 600, z: dir.z * 600 }), at);
  hit();
  assert.strictEqual(u.sys.bridge.hp, u.sys.bridge.maxHp, 'shields protect the bridge');
  dropShields(u); u.sys.shield.alive = false; // collapse so the arcs stay down
  const hp0 = u.hp; hit();
  assert.ok(u.sys.bridge.hp < u.sys.bridge.maxHp, 'bridge damaged');
  assert.ok(u.hp < hp0, 'hull takes a share too');
  // a shot that misses every subsystem only hurts the hull
  const sb = u.sys.bridge.hp, sh = u.sys.hangar.hp;
  S.applyDamage(w, u, 3000, src('verdant', { x: 0, y: 600, z: 0 }), { x: u.pos.x + 60, y: u.pos.y, z: u.pos.z }); // straight up from beside the keel
  assert.strictEqual(u.sys.bridge.hp, sb); assert.strictEqual(u.sys.hangar.hp, sh);
  let n = 0; for (let i = 0; i < 40; i++) { S.applyDamage(w, u, 20000, src('verdant', { x: dir.x * 600, y: dir.y * 600, z: dir.z * 600 }), at); if (!u.alive) break; n++; if (!u.sys.bridge.alive) break; }
  assert.ok(!u.sys.bridge.alive, 'bridge destroyed'); assert.ok(w.events.some(e => e.type === 'sysDestroyed' && e.sys === 'bridge' && e.uid === u.id));
  assert.ok(w.events.some(e => e.type === 'sysDamaged' && e.sys === 'bridge'), 'threshold events');
  assert.ok(w.spaceLog.some(l => l.sys === 'bridge'), 'destruction log');
});

test('destroyed engines slow and cripple the ship', () => {
  const sp = (kill) => {
    const w = mk(); isolate(w); const u = find(w, 'aegis', 'cruiser'); u.ai.thinkT = 1e9;
    if (kill) S.destroySys(w, u, 'engines', null, 'test');
    let top = 0, rate = 0;
    run(w, 60, () => { S.stepCapital(w, u, DT, 1, 1); top = Math.max(top, u.spd); rate = Math.max(rate, Math.abs(u.yawRate)); });
    return { top, rate, mul: S.engineMul(u) };
  };
  const ok = sp(false), bad = sp(true);
  assert.ok(bad.top < ok.top * 0.5, `speed ${bad.top} vs ${ok.top}`);
  assert.ok(bad.rate < ok.rate * 0.5, 'turning crippled');
});

test('inertia: the ship keeps drifting after the helm is released', () => {
  const w = mk(); isolate(w); const u = find(w, 'aegis', 'cruiser'); u.ai.thinkT = 1e9;
  run(w, 40, () => S.stepCapital(w, u, DT, 0, 1));
  const v0 = Math.hypot(u.vel.x, u.vel.z); assert.ok(v0 > 10);
  S.stepCapital(w, u, DT, 0, 0); S.stepCapital(w, u, DT, 0, 0);
  assert.ok(Math.hypot(u.vel.x, u.vel.z) > v0 * 0.9, 'does not stop on a dime');
  u.yawRate = 0; S.stepCapital(w, u, DT, 1, 0.5);
  assert.ok(Math.abs(u.yawRate) < u.def.turn * 0.2, 'turn builds up by torque, not instantly');
});

test('destroyed main batteries silence the main guns; hangar blocks launches', () => {
  const shots = (kill) => {
    const w = mk(); isolate(w);
    const a = find(w, 'aegis', 'dreadnought'), v = find(w, 'verdant', 'dreadnought');
    v.pos.x = a.pos.x + 1400; v.pos.z = a.pos.z; v.pos.y = a.pos.y; a.ai.thinkT = 1e9; v.ai.thinkT = 1e9;
    a.tgtId = v.id; if (kill) S.destroySys(w, a, 'batteries', null, 'test');
    let n = 0, side = 0;
    run(w, 12, () => { a.pos.x = v.pos.x - 1400; a.pos.z = v.pos.z; a.yaw = 0; v.yaw = Math.PI; S.capitalGuns(w, a, DT, v, '', false); for (const e of w.drainEvents()) if (e.type === 'fire' && e.uid === a.id) { if (e.wk === 'turbo') n++; else if (e.wk === 'broadside') side++; } });
    return { n, side };
  };
  const ok = shots(false), bad = shots(true);
  assert.ok(ok.n >= 8, `main battery fires (${ok.n})`);
  assert.strictEqual(bad.n, 0, 'silenced');
  assert.ok(bad.side > 0, 'broadsides unaffected');

  const w = mk(); const car = find(w, 'aegis', 'carrier'); car.launchCd = 0;
  assert.strictEqual(S.carrierFor(w, 'aegis', 0) !== null, true);
  S.destroySys(w, car, 'hangar', null, 'test');
  const f0 = w.units.length;
  assert.strictEqual(S.launchWing(w, car), 0, 'no launches from a dead hangar');
  assert.ok(![0, 1, 2, 3, 4, 5, 6, 7, 8].some(i => S.carrierFor(w, 'aegis', i) === car));
  const car2 = find(w, 'aegis', 'cruiser'); for (const f of w.units.filter(u => u.kind === 'fighter' && u.team === 'aegis')) f.alive = false;
  for (const c of ships(w, 'aegis')) S.destroySys(w, c, 'hangar', null, 'test');
  const air0 = w.units.filter(u => u.alive && u.kind === 'fighter' && u.team === 'aegis').length;
  w.teams.aegis.airT = 0; run(w, 1);
  const bays = w.events.filter(e => e.type === 'launch' && e.uid && e.team === 'aegis'); assert.strictEqual(bays.length, 0, 'no ship-launched fighters'); void f0; void car2; void air0;
});

test('bridge loss degrades fire control, and shield generator loss collapses shields', () => {
  const w = mk(); isolate(w); const u = find(w, 'aegis', 'cruiser');
  S.destroySys(w, u, 'shield', null, 'test');
  run(w, 12); assert.strictEqual(u.shield, 0, 'shields collapse'); assert.ok(w.events.some(e => e.type === 'shieldCollapse'));
  run(w, 20); assert.strictEqual(u.shield, 0, 'and never regenerate');
  const b = find(w, 'aegis', 'dreadnought'); S.destroySys(w, b, 'bridge', null, 'test');
  assert.ok(!S.setPower(w, b, 1), 'cannot reroute power without a bridge');
  assert.ok(S.strikeShips(w, 'aegis').indexOf(b) < 0, 'no orbital strikes from a ship without a bridge');
});

test('reactor loss triggers a core breach that destroys the ship', () => {
  const w = mk(); isolate(w); const u = find(w, 'verdant', 'cruiser');
  S.destroySys(w, u, 'reactor', null, 'test');
  assert.ok(u.coreT > 0 && w.events.some(e => e.type === 'coreBreach'));
  run(w, E.SPACE.coreTime + 2);
  assert.ok(!u.alive, 'ship lost'); assert.strictEqual(w.fleetReport.verdant.find(r => r.id === u.id).status, 'destroyed');
});

test('power distribution: presets shift shield regen, gun rate and engines', () => {
  const w = mk(); isolate(w); const u = find(w, 'aegis', 'cruiser'); u.ai.thinkT = 1e9;
  const base = { e: S.engineMul(u), g: S.weaponMul(u) };
  S.setPower(w, u, 3); run(w, 4); assert.ok(S.engineMul(u) > base.e * 1.15, 'engine power');
  S.setPower(w, u, 2); run(w, 4); assert.ok(S.weaponMul(u) > base.g * 1.3, 'weapon power');
  S.setPower(w, u, 1); run(w, 4); assert.ok(u.power[0] > 0.5, 'shield power');
  assert.ok(Math.abs(u.power.reduce((a, b) => a + b, 0) - 1) < 1e-6);
  assert.ok(w.events.some(e => e.type === 'powerShift' && e.mode === 'shields'));
});

test('battle stages advance and change what is vulnerable', () => {
  const w = mk(); isolate(w);
  const sp = w.space; run(w, 1);
  assert.strictEqual(w.space.aegis.stage, 1);
  assert.strictEqual(S.spaceState(w, 'aegis').stage, 1);
  assert.ok(S.spaceState(w, 'aegis').stageName.length > 3);
  // stage I: hits on the line ship's hull are hardened
  const tg = w.umap.get(w.space.aegis.target); assert.ok(tg && tg.team === 'verdant');
  dropShields(tg); tg.sys.shield.alive = false;
  const hp = () => tg.hp; const at = { x: tg.pos.x + 90, y: tg.pos.y + 90, z: tg.pos.z };
  const shot = () => { const h0 = hp(); S.applyDamage(w, tg, 1000, src('aegis', { x: 0, y: -600, z: 0 }), at); return h0 - hp(); };
  const d1 = shot();
  // clear the screen -> stage II
  for (const u of ships(w, 'verdant').filter(x => x.def.role === 'screen')) u.alive = false;
  run(w, 1); assert.strictEqual(w.space.aegis.stage, 2);
  assert.ok(w.events.some(e => e.type === 'stageChange' && e.team === 'aegis' && e.stage === 2));
  assert.ok(w.events.some(e => e.type === 'announce' && e.key === 'spaceStage2'));
  const d2 = shot(); assert.ok(d2 > d1, `hull more vulnerable in stage II (${d1} -> ${d2})`);
  // knock out systems -> stage III
  S.destroySys(w, tg, 'engines', null, 't'); S.destroySys(w, tg, 'batteries', null, 't');
  run(w, 1); assert.strictEqual(w.space.aegis.stage, 3);
  const d3 = shot(); assert.ok(d3 > d2, 'hull gives way in stage III');
  // the objective ship dies -> the next one
  const old = tg.id; tg.alive = false; run(w, 1);
  assert.notStrictEqual(w.space.aegis.target, old); assert.ok(w.space.aegis.stage <= 2);
  // the other side is tracked independently
  assert.strictEqual(w.space.verdant.stage, 1); void sp;
  const net = S.net.world.space.pack(w); const w2 = mk(); S.net.world.space.apply(w2, net); assert.strictEqual(w2.space.aegis.stage, w.space.aegis.stage);
});

test('AI stage behaviour: stage I targets the screen, stage II picks subsystems', () => {
  const w = mk(); run(w, 3);
  const a = find(w, 'aegis', 'dreadnought'); a.ai.thinkT = 0; run(w, 0.1);
  const tg = w.umap.get(a.tgtId); assert.ok(tg && tg.def.role === 'screen', 'screen first');
  for (const u of ships(w, 'verdant').filter(x => x.def.role === 'screen')) u.alive = false;
  run(w, 2); a.ai.thinkT = 0; run(w, 0.1);
  const t2 = w.umap.get(a.tgtId); assert.ok(t2 && t2.def.role !== 'screen');
  assert.ok(a.tgtSys && t2.sys[a.tgtSys], `focuses a subsystem (${a.tgtSys})`);
});

test('a crippled AI ship retreats, leaves the arena alive and is in the fleet report', () => {
  const w = mk(); run(w, 5);
  const u = find(w, 'verdant', 'cruiser'); u.hp = u.maxHp * 0.12; u.ai.thinkT = 0;
  run(w, 1); assert.ok(u.retreat, 'retreating'); assert.ok(w.events.some(e => e.type === 'shipRetreating' && e.uid === u.id));
  const hist = [];
  run(w, 200, () => { if (!u.alive) return false; });
  const rep = w.fleetReport.verdant.find(r => r.id === u.id);
  assert.ok(rep, 'in report');
  assert.ok(['retreated', 'destroyed'].includes(rep.status));
  if (rep.status === 'retreated') { assert.ok(u.retreated && !u.alive); assert.ok(rep.hullFrac > 0 && rep.hullFrac < 0.3); }
  void hist;
  // with nothing hitting it the escape succeeds
  const w2 = mk(); isolate(w2); for (const c of ships(w2, 'aegis')) c.alive = false;
  const v = find(w2, 'verdant', 'cruiser'); v.hp = v.maxHp * 0.1; v.ai.thinkT = 0;
  // enemies must exist for the retreat logic; keep one far away and harmless
  const a = S.spawnUnit(w2, 'capital', 'frigate', 'aegis', { x: -1500, y: 3200, z: 0 }, { yaw: 0 }); for (const g of a.guns) g.t = 1e9;
  run(w2, 160);
  const r2 = w2.fleetReport.verdant.find(r => r.id === v.id);
  assert.strictEqual(r2.status, 'retreated'); assert.ok(w2.events.some(e => e.type === 'shipRetreated' && e.uid === v.id));
  assert.ok(r2.hp > 0 && r2.sys.engines > 0);
});

test('orbital strikes: need a live battery, blocked under a ground shield', () => {
  const w = mk(); isolate(w);
  const pos = { x: 100, y: 0, z: 100 };
  S.shielded = (ww, team, p) => true;
  assert.strictEqual(S.strike(w, 'aegis', pos, null), false);
  const ev = w.drainEvents(); assert.ok(ev.some(e => e.type === 'strikeBlocked' && e.team === 'aegis'));
  assert.strictEqual(w.strikes.length, 0);
  S.shielded = (ww, team, p) => false;
  assert.strictEqual(S.strike(w, 'aegis', pos, null), true); assert.strictEqual(w.strikes.length, 1);
  // a shield that comes up before the salvo lands still stops it
  S.shielded = () => true; run(w, 5);
  assert.ok(w.drainEvents().some(e => e.type === 'strikeBlocked')); assert.strictEqual(w.strikes.length, 0);
  S.shielded = undefined;
  // projectiles originate in orbit and take real travel time
  assert.ok(S.strike(w, 'aegis', pos, null));
  let first = null; run(w, 8, (ww, i) => { const p = ww.projectiles.find(x => x.wk === 'orbital'); if (p && !first) { first = { y: p.pos.y, t: ww.t }; return false; } });
  assert.ok(first && first.y > E.SIM.ALT.space, `fired from orbit (${first && first.y})`);
  // no live battery, no strike
  for (const c of ships(w, 'aegis')) S.destroySys(w, c, 'batteries', null, 't');
  w.strikes.length = 0; assert.strictEqual(S.strike(w, 'aegis', pos, null), false);
  assert.ok(w.drainEvents().some(e => e.type === 'strikeDenied'));
  w.teams.aegis.strikeT = 0; run(w, 1); assert.ok(w.teams.aegis.strikeT >= 4, 'AI will not call strikes without batteries');
});

test('point defence kills fighters and intercepts torpedoes; escort requests are raised', () => {
  const w = mk(); isolate(w);
  const a = find(w, 'aegis', 'carrier'); a.ai.thinkT = 1e9;
  for (const u of ships(w, 'aegis')) u.launchCd = 1e9;   // no friendly wing scrambles to cover her
  // enemy bombers run at the carrier
  const bs = []; for (let i = 0; i < 4; i++) { const b = S.spawnUnit(w, 'fighter', 'bomber', 'verdant', { x: a.pos.x + 500, y: a.pos.y + 20 * i, z: a.pos.z + 80 * i }, { yaw: -Math.PI / 2 }); b.ai.thinkT = 1e9; bs.push(b); }
  run(w, 0.6);
  assert.ok(a.needsEscort && a.threat >= 1, 'needs escort flag'); assert.ok(S.needsEscort(w, 'aegis').includes(a));
  assert.ok(w.events.some(e => e.type === 'escortRequest' && e.uid === a.id));
  let kills = 0; run(w, 8, () => { for (const b of bs) if (!b.alive && !b.k) { b.k = 1; kills++; } for (const b of bs) if (b.alive) { b.pos.x = a.pos.x + 300; b.pos.z = a.pos.z + 100; b.pos.y = a.pos.y; } });
  assert.ok(kills >= 1, `flak killed ${kills} loitering bombers`); assert.ok(w.events.some(e => e.type === 'pdKill'));
  // torpedo interception
  let hit = 0;
  for (let k = 0; k < 20 && !hit; k++) {
    const ww = mk(); isolate(ww); const t = find(ww, 'aegis', 'cruiser');
    for (let i = 0; i < 6; i++) ww.projectiles.push({ id: ww.nextProj++, wk: 'torpedo', kind: 'missile', pos: { x: t.pos.x + 300, y: t.pos.y, z: t.pos.z + i * 5 }, vel: { x: 0, y: 0, z: 0 }, team: 'verdant', uid: 0, owner: null, dmg: 1, life: 99, splash: 0, grav: 0, seek: 0, tid: 0, r: 1, scale: 1 });
    run(ww, 8); if (ww.events.some(e => e.type === 'pdIntercept')) hit = 1;
  }
  assert.ok(hit, 'torpedoes intercepted');
});

function boardingSetup() {
  const w = mk(8); isolate(w);
  const a = find(w, 'aegis', 'dreadnought'), v = find(w, 'verdant', 'cruiser');
  for (const c of w.units.filter(x => x.kind === 'capital')) c.ai.thinkT = 1e9; // scripted: nobody manoeuvres
  v.pos.x = a.pos.x + 900; v.pos.z = a.pos.z; v.pos.y = a.pos.y;
  v.spd = 20; v.throttle = 1;
  return { w, a, v };
}
const hold = (w, v) => { S.stepCapital(w, v, DT, 0, 0.8); };

test('boarding: shields must be down; the party arrives, rides the ship, fights and sabotages', () => {
  const { w, a, v } = boardingSetup();
  assert.strictEqual(S.board(w, 'aegis', a, v), false, 'shields up: denied');
  dropShields(v); v.sys.shield.alive = false; v.arcs.forEach(x => x.v = 0);
  assert.strictEqual(S.board(w, 'aegis', a, v), true);
  assert.ok(w.events.some(e => e.type === 'boardingLaunched'));
  let started = false; run(w, 40, () => { hold(w, v); if (w.boardings[0].status === 'active') { started = true; return false; } });
  assert.ok(started, 'party arrived'); assert.ok(w.events.some(e => e.type === 'boardingAlarm'));
  const op = w.boardings[0];
  const marines = op.units.filter(u => u.board.side === 'att'), defs = op.units.filter(u => u.board.side === 'def');
  assert.ok(marines.length >= 1 && defs.length >= 1);
  assert.ok(marines.every(u => u.mode === 'boarding' && u.kind === 'infantry' && u.team === 'aegis'));
  // they ride the moving ship: world position follows, local position is stable
  const m = marines[0], p0 = V.clone(m.pos), l0 = { x: m.board.x, z: m.board.z }; const vp0 = V.clone(v.pos);
  run(w, 3, () => { hold(w, v); m.board.vx = m.board.vz = 0; });
  const moved = V.distance(v.pos, vp0); assert.ok(moved > 20, 'ship moved');
  assert.ok(V.distance(m.pos, p0) > moved * 0.7, 'marine moved with the ship');
  assert.ok(V.distance(m.pos, v.pos) < 150, 'marine inside the hull');
  void l0;
  // they fight: deaths happen on the ship
  const alive0 = op.units.filter(u => u.alive).length;
  run(w, 40, () => hold(w, v));
  assert.ok(w.events.some(e => e.type === 'boardFire'), 'shots exchanged');
  assert.ok(op.units.filter(u => u.alive).length < alive0 || op.status !== 'active', 'casualties');
});

test('boarding: holding a node sabotages its subsystem; the bridge captures the ship', () => {
  const { w, a, v } = boardingSetup();
  v.sys.shield.alive = false; dropShields(v);
  assert.ok(S.board(w, 'aegis', a, v));
  run(w, 40, () => { hold(w, v); if (w.boardings[0].status === 'active') return false; });
  const op = w.boardings[0]; assert.strictEqual(op.status, 'active');
  // remove the defenders and put the party on the reactor node
  for (const u of op.units) if (u.board.side === 'def') u.alive = false;
  const marines = op.units.filter(u => u.board.side === 'att');
  const N = S.BOARD_NODES;
  const putOn = (n, ms) => ms.forEach((u, i) => { const b = u.board; b.deck = N[n].deck; b.x = N[n].x + (i % 2); b.z = N[n].z; b.y = S.BOARD_DECKS[b.deck].y; b.vx = b.vz = 0; });
  const park = (n, ms) => { for (const u of ms) { u.board.x = N[n].x; u.board.z = N[n].z; u.board.deck = N[n].deck; u.board.y = S.BOARD_DECKS[u.board.deck].y; u.board.air = false; u.board.vx = u.board.vz = 0; } };
  putOn('reactor', marines);
  assert.ok(v.sys.reactor.alive);
  run(w, 30, () => { hold(w, v); park('reactor', marines); if (!v.sys.reactor.alive) return false; });
  assert.ok(!v.sys.reactor.alive, 'reactor sabotaged'); assert.ok(w.events.some(e => e.type === 'boardNode' && e.node === 'reactor'));
  assert.ok(v.coreT > 0, 'core breach follows');
  v.coreT = 0; // keep the ship for the bridge
  putOn('bridge', marines);
  run(w, 40, () => { hold(w, v); park('bridge', marines); if (v.team === 'aegis') return false; });
  assert.strictEqual(v.team, 'aegis', 'ship captured'); assert.ok(v.captured);
  assert.ok(w.events.some(e => e.type === 'shipCaptured' && e.uid === v.id));
  assert.ok(w.events.some(e => e.type === 'boardingResult' && e.result === 'captured'));
  assert.ok(ships(w, 'aegis').includes(v) && !ships(w, 'verdant').includes(v));
  assert.ok(op.units.every(u => !u.alive), 'party and crew stand down');
  assert.strictEqual(w.fleetReport.verdant.find(r => r.id === v.id).status, 'captured');
});

test('a boarding party that is wiped out is repelled', () => {
  const { w, a, v } = boardingSetup();
  v.sys.shield.alive = false; dropShields(v);
  S.board(w, 'aegis', a, v);
  run(w, 40, () => { hold(w, v); if (w.boardings[0].status === 'active') return false; });
  const op = w.boardings[0]; for (const u of op.units) if (u.board.side === 'att') u.alive = false;
  run(w, 2, () => hold(w, v));
  assert.strictEqual(op.status, 'lost'); assert.ok(w.events.some(e => e.type === 'boardingResult' && e.result === 'repelled'));
  assert.strictEqual(v.team, 'verdant');
  assert.strictEqual(S.board(w, 'aegis', a, v), false, 'cooldown before another attempt');
});

test('a boarding marine can be possessed and moved by player input; decks connect', () => {
  const { w, a, v } = boardingSetup();
  v.sys.shield.alive = false; dropShields(v); S.board(w, 'aegis', a, v);
  run(w, 40, () => { hold(w, v); if (w.boardings[0].status === 'active') return false; });
  const op = w.boardings[0]; for (const u of op.units) if (u.board.side === 'def') u.alive = false;
  const m = op.units.find(u => u.board.side === 'att' && u.alive);
  w.addPlayer('p1', 'aegis', 'Marine'); assert.ok(w.possess('p1', m.id));
  assert.strictEqual(w.unitOf('p1'), m);
  const yawLocal = v.yaw; // walk "forward in the ship" = world yaw of the ship
  const start = { x: m.board.x, z: m.board.z };
  run(w, 3, () => { hold(w, v); w.setInput('p1', { mx: 0, mz: 1, moveYaw: v.yaw, yaw: v.yaw, pitch: 0, sprint: false }); });
  assert.ok(m.board.z - start.z > 8, `walked forward on deck (${m.board.z - start.z})`);
  assert.ok(!m.board.air);
  // thrust jump: leaves the deck and drifts
  const y0 = m.board.y; let peak = y0;
  run(w, 1.2, () => { hold(w, v); w.setInput('p1', { mx: 0, mz: 1, moveYaw: v.yaw, yaw: v.yaw, jump: true }); peak = Math.max(peak, m.board.y); });
  assert.ok(peak > y0 + 2, `thrust jump (${peak - y0})`);
  w.setInput('p1', { jump: false });
  run(w, 6, () => hold(w, v)); assert.ok(!m.board.air, 'lands again in low gravity');
  // walk the whole way to the bridge deck through the corridor
  let reached = false;
  run(w, 60, () => {
    hold(w, v);
    const N = S.BOARD_NODES.bridge, dx = N.x - m.board.x, dz = N.z - m.board.z;
    // local direction -> world, as the player's camera yaw would give
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    const wx = fx * dz - fz * dx, wz = fz * dz + fx * dx, l = Math.hypot(wx, wz) || 1;
    // waypoint: go through the corridor
    let tx = dx, tz = dz; const B = S.BOARD_DECKS;
    if (m.board.deck === 0) { tx = 0 - m.board.x; tz = -20 - m.board.z; } else if (m.board.deck === 1) { tx = (m.board.z < 29 ? 0 - m.board.x : dx); tz = (m.board.z < 29 ? 40 : dz); }
    const tl = Math.hypot(tx, tz) || 1, qx = fx * tz / tl - fz * tx / tl, qz = fz * tz / tl + fx * tx / tl; void wx; void wz; void l; void B;
    w.setInput('p1', { mx: 0, mz: 1, moveYaw: Math.atan2(qx, qz), yaw: Math.atan2(qx, qz), jump: false });
    if (m.board.deck === 4) { reached = true; return false; }
  });
  assert.ok(reached, 'reached the bridge deck by walking dock -> corridor -> bridge');
});

test('player command of a capital: target cycling, focus fire, power, brace, launch, strike', () => {
  const w = mk(); const a = find(w, 'aegis', 'dreadnought');
  w.addPlayer('p1', 'aegis', 'Admiral'); assert.ok(w.possess('p1', a.id));
  const tick = (inp, n) => { w.setInput('p1', inp); run(w, n || 0.05); };
  tick({ cycle: true, yaw: a.yaw }); tick({ cycle: false });
  assert.ok(a.tgtId && w.umap.get(a.tgtId).team === 'verdant' && a.tgtSys === '', 'first press selects a ship');
  const first = a.tgtId;
  tick({ cycle: true }); tick({ cycle: false });
  assert.strictEqual(a.tgtId, first); assert.strictEqual(a.tgtSys, 'shield', 'next press selects its subsystems');
  tick({ cycle: true }); tick({ cycle: false }); assert.strictEqual(a.tgtSys, 'batteries');
  assert.ok(w.events.some(e => e.type === 'targetSelected' && e.to === 'p1'));
  // power presets on abil2
  tick({ abil2: true }); tick({ abil2: false }); assert.strictEqual(a.powerMode, 1);
  tick({ abil2: true }); tick({ abil2: false }); assert.strictEqual(a.powerMode, 2);
  tick({ roll: 1 }, 2); tick({ roll: 0 }); assert.ok(a.powerGoal[0] > 0.2 && Math.abs(a.powerGoal.reduce((x, y) => x + y, 0) - 1) < 1e-6);
  // helm: throttle telegraph and torque turning
  tick({ mz: 1, mx: 0 }, 5); assert.ok(a.throttle > 0.6);
  const yaw0 = a.yaw; tick({ mx: -1, mz: 0 }, 6); assert.ok(a.yaw !== yaw0 && Math.abs(a.yawRate) > 0);
  // brace
  tick({ crouch: true }); tick({ crouch: false }); assert.ok(a.braceT > 0 && a.braceCd > 0); assert.ok(w.events.some(e => e.type === 'brace'));
  const u0 = a.hp; dropShields(a); const at = { x: a.pos.x + 90, y: a.pos.y, z: a.pos.z };
  S.applyDamage(w, a, 1000, src('verdant', { x: -600, y: 0, z: 0 }), at); const braced = u0 - a.hp;
  a.braceT = 0; const u1 = a.hp; S.applyDamage(w, a, 1000, src('verdant', { x: -600, y: 0, z: 0 }), at);
  assert.ok(braced < (u1 - a.hp) * 0.8, 'brace reduces damage');
  // launch order on jump
  const air0 = w.units.filter(u => u.kind === 'fighter' && u.team === 'aegis').length; a.launchCd = 0;
  for (const f of w.units.filter(u => u.kind === 'fighter' && u.team === 'aegis').slice(0, 3)) f.alive = false;
  tick({ jump: true }); tick({ jump: false });
  assert.ok(w.events.some(e => e.type === 'launchOrder' && e.uid === a.id) || air0 === 0, 'launch order');
  // orbital strike at the aim point
  w.teams.aegis.strikeT = 0; const n0 = w.strikes.length;
  tick({ abil: true, yaw: 0, pitch: -1.2 }); tick({ abil: false });
  assert.ok(w.strikes.length > n0, 'strike ordered'); assert.ok(w.teams.aegis.strikeT > 10);
  // verbs
  assert.strictEqual(w.verb('p1', 'power', 'engines'), true);
  assert.ok(w.verb('p1', 'target', first, 'engines'));
  assert.strictEqual(a.tgtSys, 'engines');
});

test('net: capital state round-trips through the snapshot registration', () => {
  const w = mk(); const a = find(w, 'aegis', 'cruiser');
  a.arcs[2].v *= 0.5; S.destroySys(w, a, 'hangar', null, 't'); a.tgtId = 7; a.tgtSys = 'engines'; a.retreat = true;
  const row = S.packUnit(a); assert.ok(Array.isArray(row) && row.length < 30);
  const g = { kind: 'capital', def: a.def, maxShield: a.maxShield, maxHp: a.maxHp, h: a.h, hp: a.hp };
  S.unpackUnit(g, JSON.parse(JSON.stringify(row)));
  assert.ok(Math.abs(g.arcs[2].v / g.arcs[2].max - 0.5) < 0.02); assert.ok(!g.sys.hangar.alive && g.sys.bridge.alive);
  assert.strictEqual(g.tgtId, 7); assert.strictEqual(g.tgtSys, 'engines'); assert.ok(g.retreat);
});

test('sim is deterministic with fleets in action (same seed -> same hash)', () => {
  const hash = (seed) => {
    const w = mk(seed); run(w, 120);
    return crypto.createHash('sha1').update(JSON.stringify([w.units.map(u => [u.id, u.alive, Math.round(u.pos.x * 10), Math.round(u.pos.z * 10), Math.round(u.hp), u.sys ? ORD.map(n => Math.round(u.sys[n].hp)) : 0, u.arcs ? u.arcs.map(a => Math.round(a.v)) : 0]), w.space, w.rng.next()])).digest('hex');
  };
  const ORD = E.SPACE.order;
  assert.strictEqual(hash(21), hash(21)); assert.notStrictEqual(hash(21), hash(22));
});

test('AI-vs-AI fleet fights stay finite and resolve without errors', () => {
  const comps = [
    [['dreadnought', 'cruiser'], ['carrier', 'cruiser']],
    [['cruiser'], ['cruiser']],
    [['carrier', 'cruiser', 'cruiser'], ['dreadnought', 'frigate']],
  ];
  comps.forEach(([fa, fv], i) => {
    const w = new E.World({ biome: 'tundra', seed: 40 + i, fleet: { aegis: fa, verdant: fv } });
    run(w, 240);
    for (const u of w.units) assert.ok(Number.isFinite(u.pos.x + u.pos.y + u.pos.z + u.hp), `finite ${u.kind}`);
    assert.ok(w.space.aegis && w.fleetReport.aegis.length >= fa.length);
  });
});
