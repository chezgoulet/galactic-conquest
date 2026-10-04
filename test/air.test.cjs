'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');
const E = load(load.files(['core', 'data', 'sim']));
const S = E.SIM, DT = 1 / 30;

// An empty arena: no units, we tick controls by hand so nothing else interferes.
function arena(biome, seed) {
  const w = new E.World({ biome: biome || 'tundra', seed: seed || 3 });
  w.units.length = 0; w.umap.clear(); w.projectiles.length = 0; w.events.length = 0;
  return w;
}
function step(w) {
  w.t += DT; w.tickN++;
  for (const u of w.units.slice()) if (u.alive) S.control(w, u, DT);
  S.updateProjectiles(w, DT);
  for (const s of S.systems) s(w, DT);
  w.units = w.units.filter(u => u.alive);
  w.umap.clear(); for (const u of w.units) w.umap.set(u.id, u);
}
function craft(w, type, y, speed, team, x, z, yaw) {
  const u = S.spawnUnit(w, 'fighter', type, team || 'aegis', { x: x || 0, y, z: z || 0 }, { yaw: yaw || 0 });
  S.initAir(u); u.launchT = -99;
  u.vel.x = Math.sin(yaw || 0) * speed; u.vel.z = Math.cos(yaw || 0) * speed; u.spd = speed;
  return u;
}
function pilot(w, u) { w.addPlayer('p', u.team, 'P'); w.players.p.unitId = u.id; u.pid = 'p'; return w.players.p.input; }
const CT = () => ({ dx: 0, dy: 0, dz: 1, thr: 0.65, boost: false, roll: 0, drift: false, brake: false, full: true, vy: NaN, mvx: NaN, mvz: 0, evade: 0 });
function fly(w, u, C, secs) { for (let i = 0; i < secs * 30; i++) { w.t += DT; w.tickN++; S.stepFlight(w, u, DT, C); if (!u.alive) break; } }

test('energy: a climb bleeds speed, a dive gains it', () => {
  const res = {};
  for (const [name, pitch] of [['level', 0], ['climb', 0.5], ['dive', -0.5]]) {
    const w = arena(), u = craft(w, 'interceptor', 500, 115), inp = pilot(w, u);
    for (let i = 0; i < 300; i++) { inp.yaw = 0; inp.pitch = i < 90 ? 0 : pitch; step(w); }
    res[name] = u.spd;
  }
  assert.ok(res.climb < res.level - 5, `climb ${res.climb} vs level ${res.level}`);
  assert.ok(res.dive > res.level + 5, `dive ${res.dive} vs level ${res.level}`);
});

test('stall in atmosphere below minimum speed, never in space; velocity persists in space', () => {
  const w = arena();
  const a = craft(w, 'interceptor', 500, 115);
  const C = CT(); C.dy = 1; C.dx = 0; C.dz = 0; C.thr = 0;
  let stalled = false;
  for (let i = 0; i < 300; i++) { w.t += DT; w.tickN++; S.stepFlight(w, a, DT, C); if (a.stall > 0.5) stalled = true; if (!a.alive) break; }
  assert.ok(stalled, 'stalls when slow and nose-high in air');
  const s = craft(w, 'interceptor', 3200, 20, 'verdant');
  let sp = false; C.thr = 0;
  for (let i = 0; i < 300; i++) { w.t += DT; w.tickN++; S.stepFlight(w, s, DT, C); if (s.stall > 0.05) sp = true; }
  assert.ok(!sp, 'no stall in space');
  const d = craft(w, 'interceptor', 3200, 100, 'verdant', 300, 0), D = CT(); D.drift = true; D.dx = 1; D.dz = 0; D.thr = 0;
  const z0 = d.pos.z; fly(w, d, D, 2);
  assert.ok(Math.abs(d.spd - 100) < 1, `drift keeps speed ${d.spd}`);
  assert.ok(d.pos.z - z0 > 190, 'keeps travelling the old way while the nose swings');
});

test('lock-on takes time, breaks in cloud, is defeated by countermeasures', () => {
  const w = arena(), a = craft(w, 'interceptor', 400, 100, 'aegis', 0, 0, 0), b = craft(w, 'interceptor', 400, 0, 'verdant', 0, 400, 0);
  b.vel.z = 0;
  let t = 0, got = -1;
  for (let i = 0; i < 120 && got < 0; i++) { t = i * DT; if (S.lockOn(w, a, b, DT)) got = t; }
  assert.ok(got > 0.5, `lock takes time (${got})`);
  assert.ok(a.lockT >= 1 && b.lockedT > w.t - 1 || a.locked, 'locked state');
  // victim is warned
  assert.ok(b.warnT > 0, 'victim warned');
  // cloud
  b.pos.y = 850; for (let i = 0; i < 60; i++) S.lockOn(w, a, b, DT);
  assert.ok(!a.locked, 'no lock through cloud');
  // countermeasures
  const c = craft(w, 'interceptor', 400, 0, 'verdant', 0, 400, 0);
  a.lockId = 0; a.lockT = 0; for (let i = 0; i < 60; i++) S.lockOn(w, a, c, DT);
  assert.ok(a.locked, 'relocked');
  assert.ok(S.airCM(w, c), 'flare');
  S.lockOn(w, a, c, DT);
  assert.ok(!a.locked && c.jamT > w.t, 'countermeasures break the lock');
  assert.ok(!S.airCM(w, c), 'countermeasures are on cooldown');
});

test('bomber AI release solution lands near the target', () => {
  const w = arena('desert', 5);
  const tank = S.spawnUnit(w, 'vehicle', 'tank', 'verdant', { x: 300, z: 100 }); tank.hp = tank.maxHp = 1e6; tank.shield = 0;
  tank.ai.thinkT = 1e9;
  const gy = w.terrain.height(0, 0);
  const b = craft(w, 'bomber', gy + 320, 90, 'aegis', -700, 100, Math.PI / 2);
  b.air.tid = tank.id; b.air.planT = 1e9;
  const miss = [];
  for (let i = 0; i < 30 * 40; i++) {
    step(w);
    for (const e of w.events) if (e.type === 'impact' && e.wk === 'bomb') miss.push(Math.hypot(e.pos.x - tank.pos.x, e.pos.z - tank.pos.z));
    w.events.length = 0;
    if (miss.length) break;
  }
  assert.ok(miss.length, 'a bomb was dropped');
  assert.ok(miss[0] < 25, `bomb landed ${miss[0].toFixed(1)} m from the target`);
});

test('gunship delivers troops, and loses them when shot down', () => {
  const w = arena('desert', 5);
  const home = w.cps.find(c => c.home === 'aegis');
  const g = craft(w, 'gunship', w.terrain.height(home.pos.x, home.pos.z) + 40, 20, 'aegis', home.pos.x, home.pos.z);
  const lz = { x: home.pos.x + 400, z: home.pos.z + 120 };
  assert.strictEqual(S.airDrop(w, 'aegis', lz, 4), g);
  let dropped = 0, inf = 0;
  for (let i = 0; i < 30 * 150 && !dropped; i++) { step(w); for (const e of w.events) if (e.type === 'airDrop') dropped = e.n; w.events.length = 0; }
  inf = w.units.filter(u => u.kind === 'infantry').length;
  assert.strictEqual(dropped, 4); assert.strictEqual(inf, 4);
  assert.ok(w.units.filter(u => u.kind === 'infantry').every(u => Math.hypot(u.pos.x - lz.x, u.pos.z - lz.z) < 30), 'troops land at the LZ');
  // shot down loaded
  const g2 = craft(w, 'gunship', 150, 30, 'aegis', 0, 0); S.airLoad(w, g2, 5);
  const t0 = w.teams.aegis.tickets; w.events.length = 0;
  S.applyDamage(w, g2, 1e6, { team: 'verdant', uid: 0, owner: null, wk: 'laser' });
  assert.ok(w.events.some(e => e.type === 'troopsLost' && e.n === 5), 'troops lost');
  assert.ok(w.teams.aegis.tickets < t0, 'tickets paid for lost troops');
});

test('callAir tasks an aircraft, with a team cooldown', () => {
  const w = arena('desert', 5);
  const b = craft(w, 'bomber', 300, 90, 'aegis', -600, 0, Math.PI / 2);
  w.addPlayer('c', 'aegis', 'Cmd');
  const r = w.verb('c', 'callAir', { x: 200, z: 50 }, 'bomber');
  assert.ok(r && r.uid === b.id, 'accepted');
  assert.ok(w.events.some(e => e.type === 'airAccepted'));
  assert.ok(b.air.cas, 'tasked');
  w.events.length = 0;
  assert.strictEqual(w.verb('c', 'callAir', { x: 0, z: 0 }, 'bomber'), null);
  assert.ok(w.events.some(e => e.type === 'airUnavailable' && e.reason === 'cooldown'));
  const w2 = arena(); w2.addPlayer('c', 'aegis', 'Cmd');
  assert.strictEqual(w2.verb('c', 'callAir', { x: 0, z: 0 }), null);
  assert.ok(w2.events.some(e => e.type === 'airUnavailable' && e.reason === 'none'));
});

test('bots never fly into flat terrain on a long patrol', () => {
  for (const type of ['interceptor', 'bomber', 'gunship', 'strike']) {
    const w = arena('desert', 9), u = craft(w, type, w.terrain.height(0, 0) + 250, 80, 'aegis', -300, 0, 1);
    for (let i = 0; i < 30 * 120; i++) { step(w); if (!u.alive) break; }
    assert.ok(u.alive, `${type} survived a 120 s patrol`);
  }
});

test('air sim is deterministic', () => {
  const run = () => {
    const w = new E.World({ biome: 'jungle', seed: 21 });
    for (let i = 0; i < 30 * 40; i++) w.tick(DT);
    return w.units.filter(u => u.kind === 'fighter').map(u => [u.id, u.type, Math.round(u.pos.x), Math.round(u.pos.y), Math.round(u.pos.z), Math.round(u.hp)].join(',')).join('|');
  };
  assert.strictEqual(run(), run());
});

test('hangar: a destroyed hangar cannot launch', () => {
  const w = new E.World({ biome: 'tundra', seed: 2 });
  const cap = w.units.find(u => u.kind === 'capital' && u.team === 'aegis');
  assert.ok(S.canLaunch(w, cap));
  cap.sys = { hangar: { hp: 0 } };
  assert.ok(!S.canLaunch(w, cap));
  const f = S.launchFighter(w, 'aegis', cap, 0);
  assert.ok(Math.hypot(f.pos.x - cap.pos.x, f.pos.z - cap.pos.z) > 400, 'scrambled from the airfield instead');
});

// ── battles ────────────────────────────────────────────────────
function orbitize(w) {
  for (const c of w.units) if (c.kind === 'capital') { c.alt = S.ALT.orbit; c.pos.y = S.ALT.orbit; }
  for (const f of w.units.filter(u => u.kind === 'fighter')) { f.alive = false; w.umap.delete(f.id); }
  w.units = w.units.filter(u => u.alive);
  for (const tm of E.TEAMS) { const cap = w.units.find(u => u.kind === 'capital' && u.team === tm); for (let i = 0; i < w.teams[tm].airCap; i++) S.launchFighter(w, tm, cap, i); }
}
function battles(orbit, seeds, secs) {
  const agg = { life: {}, n: {}, kills: {}, crash: {}, fire: {}, band: [0, 0, 0, 0], nan: 0 };
  const inc = (o, k, n) => o[k] = (o[k] || 0) + (n === undefined ? 1 : n);
  for (const biome of ['desert', 'jungle', 'tundra']) for (const seed of seeds) {
    const w = new E.World({ biome, seed }); if (orbit) orbitize(w);
    const reg = new Map(), born = new Map();
    const see = (u) => { if (u.kind === 'fighter' && !reg.has(u.id)) { reg.set(u.id, u.type); born.set(u.id, w.t); } };
    w.units.forEach(see);
    for (let i = 0; i < secs * 30; i++) {
      w.tick(DT);
      for (const u of w.units) { see(u); if (u.kind === 'fighter') { if (!isFinite(u.pos.x + u.pos.y + u.pos.z + u.vel.x + u.vel.y + u.vel.z)) agg.nan++; agg.band[u.band]++; } }
      for (const e of w.drainEvents()) if (e.type === 'death') {
        if (e.kind === 'fighter') { const t = reg.get(e.uid); inc(agg.life, t, w.t - born.get(e.uid)); inc(agg.n, t); inc(e.wk === 'crash' ? agg.crash : agg.fire, t); }
        if (e.by && reg.has(e.by)) inc(agg.kills, reg.get(e.by) + '>' + (e.kind === 'fighter' ? 'air' : e.kind === 'capital' ? 'capital' : 'ground'));
      }
    }
    for (const u of w.units) if (u.kind === 'fighter') { inc(agg.life, u.type, w.t - born.get(u.id)); inc(agg.n, u.type); }
  }
  return agg;
}
function report(name, a) {
  const tb = a.band.reduce((x, y) => x + y, 0) || 1;
  console.log(`# ${name}: lifetime ${Object.keys(a.life).map(k => k + ' ' + (a.life[k] / a.n[k]).toFixed(0) + 's').join(', ')}; kills ${JSON.stringify(a.kills)}; crashes ${JSON.stringify(a.crash)}; enemy fire ${JSON.stringify(a.fire)}; bands low/cloud/high/space % ${a.band.map(b => (100 * b / tb).toFixed(1)).join('/')}`);
}
function checkBattle(a) {
  assert.strictEqual(a.nan, 0, 'no NaN positions');
  const crashes = Object.values(a.crash).reduce((x, y) => x + y, 0), fire = Object.values(a.fire).reduce((x, y) => x + y, 0);
  assert.ok(crashes <= Math.max(3, 0.25 * (crashes + fire)), `bot crashes are rare (${crashes} vs ${fire} shot down)`);
}
test('AI-vs-AI battles: 3 biomes x 6 seeds (capitals at their default station)', () => {
  const a = battles(false, [1, 2, 3, 4, 5, 6], 120); report('station', a); checkBattle(a);
  assert.ok((a.kills['bomber>ground'] || 0) + (a.kills['gunship>ground'] || 0) > 0, 'strike craft kill ground targets');
});
test('AI-vs-AI battles with capitals in orbit: descent and climb are real transitions', () => {
  const a = battles(true, [1, 2], 150); report('orbit', a); checkBattle(a);
  assert.ok(a.band[3] > 0 && a.band[0] > 0, 'time in both space and low air');
});

test('scripted player: orbit take-off, descent, strafing pass, climb back to space', () => {
  const w = new E.World({ biome: 'desert', seed: 4 }); orbitize(w);
  for (const u of w.units) if (u.kind !== 'capital' && u.team === 'verdant' && u.kind === 'fighter') u.alive = false;
  const cap = w.units.find(u => u.kind === 'capital' && u.team === 'aegis');
  const f = S.launchFighter(w, 'aegis', cap, 0);
  const inp = pilot(w, f);
  // a target on the ground, in front of the descent
  const tank = S.spawnUnit(w, 'vehicle', 'skiff', 'verdant', { x: 100, z: 0 }); tank.ai.thinkT = 1e9;
  let phase = 'descend', minY = 1e9, fired = false, maxY = 0, strafed = false, t0 = 0;
  const log = [];
  for (let i = 0; i < 30 * 160 && f.alive; i++) {
    const g = w.terrain.height(f.pos.x, f.pos.z), agl = f.pos.y - g;
    const dx = tank.pos.x - f.pos.x, dz = tank.pos.z - f.pos.z, dy = tank.pos.y + 1 - f.pos.y, hd = Math.hypot(dx, dz);
    inp.mz = 0; inp.fire = false; inp.sprint = false;
    if (phase === 'descend') {
      inp.yaw = Math.atan2(dx, dz); inp.pitch = agl > 700 ? -0.6 : Math.max(-0.5, Math.min(0.1, Math.atan2(dy + 120, hd)));
      inp.sprint = agl > 1500;
      if (agl < 700 && hd < 1500) { phase = 'strafe'; log.push('descended ' + w.t.toFixed(0)); }
    } else if (phase === 'strafe') {
      inp.yaw = Math.atan2(dx, dz); inp.pitch = Math.atan2(dy, hd);
      inp.fire = hd < 600; if (inp.fire) fired = true;
      if (!tank.alive) strafed = true;
      if (hd < 140 || (strafed && hd < 400) || w.t - t0 > 90) { phase = 'climb'; log.push('strafed ' + w.t.toFixed(0)); }
      if (agl < 40) inp.pitch = 0.5;
    } else {
      inp.yaw = Math.atan2(-f.pos.x, -f.pos.z) * 0 + f.yaw; inp.pitch = 0.9; inp.sprint = true; inp.mz = 1;
      if (agl < 700) inp.pitch = 0.6;
      maxY = Math.max(maxY, f.pos.y);
      if (f.pos.y > S.ALT.space + 50) break;
    }
    if (phase === 'descend') t0 = w.t;
    w.tick(DT); w.drainEvents();
    minY = Math.min(minY, f.pos.y);
  }
  console.log('# player script:', log.join(', '), 'minY', minY.toFixed(0), 'maxY', maxY.toFixed(0), 'alive', f.alive, 'fired', fired, 'tankDead', !tank.alive);
  assert.ok(f.alive, 'survived the sortie');
  assert.ok(minY < S.ALT.cloudLo, 'descended through the cloud deck');
  assert.ok(fired, 'strafing pass flown');
  assert.ok(maxY > S.ALT.space, 'climbed back to space');
});
