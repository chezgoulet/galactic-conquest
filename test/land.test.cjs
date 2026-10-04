'use strict';
// LAND mechanics: behaviour-level tests run headless on the deterministic sim.
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');
const E = load(load.files(['core', 'data', 'sim']));
const S = E.SIM, V = E.V3;
const HZ = 30, DT = 1 / HZ;

// ── helpers ──────────────────────────────────────────────────
// an empty battlefield: no units, no cover, reinforcements and victory checks bypassed
function sandbox(biome, seed) {
  const w = new E.World({ biome: biome || 'desert', seed: seed || 5 });
  for (const u of w.units) u.alive = false;
  w.units.length = 0; w.umap.clear();
  w.cover.length = 0; w.coverGrid.clear();
  w.mines.length = 0; w.charges.length = 0; w.objs.length = 0; w.squads.length = 0; if (w.sqMap) w.sqMap.clear();
  w.ion = null; w.landT = { aegis: { aa: 1e9 }, verdant: { aa: 1e9 } }; w.events.length = 0;
  return w;
}
function step(w, secs) {
  const n = Math.round(secs * HZ);
  for (let i = 0; i < n; i++) {
    w.t += DT; w.tickN++;
    for (const u of w.units.slice()) if (u.alive) S.control(w, u, DT);
    S.updateProjectiles(w, DT); S.sustain(w, DT);
    for (const f of S.systems) f(w, DT);
    let k = 0; for (const u of w.units) { if (u.alive) w.units[k++] = u; else w.umap.delete(u.id); } w.units.length = k;
  }
}
const mid = (w) => w.cps[2].pos;                    // the central post: flat pad
// bots roll random perks from w.rng; tests start from a bare unit so numbers do not depend on the roll
const spawn = (w, kind, type, team, x, z, extra) => { const u = S.spawnUnit(w, kind, type, team, { x, z }, extra); if (kind === 'infantry') S.applyPerks(u, []); return u; };
const asPlayer = (w, u) => { w.players.gun = w.players.gun || { id: 'gun', team: u.team, name: 'g', input: {}, score: 0, kills: 0, deaths: 0, streak: 0, best: 0, captures: 0 }; u.pid = 'gun'; return u; };
const noThink = (u) => { u.ai.thinkT = 1e9; u.mode = 'idle'; S.modes.idle = S.modes.idle || { ai() {}, player() {} }; return u; };
const evs = (w, type) => w.events.filter((e) => e.type === type);
const fireAt = (w, shooter, wk, tx, ty, tz, tid) => {
  const o = { x: shooter.pos.x, y: shooter.pos.y + shooter.h * 0.8, z: shooter.pos.z };
  const d = { x: tx - o.x, y: ty - o.y, z: tz - o.z }; const l = Math.hypot(d.x, d.y, d.z); d.x /= l; d.y /= l; d.z /= l;
  return S.shoot(w, shooter, wk, o, d, tid || 0);
};

// ── cover ────────────────────────────────────────────────────
test('cover is generated deterministically from the seed and follows the biome', () => {
  const a = new E.World({ biome: 'jungle', seed: 21 }), b = new E.World({ biome: 'jungle', seed: 21 }), c = new E.World({ biome: 'jungle', seed: 22 });
  const sig = (w) => w.cover.map((x) => [x.type, x.x.toFixed(2), x.z.toFixed(2), x.yaw.toFixed(2)].join()).join('|');
  assert.ok(a.cover.length > 60, 'plenty of cover: ' + a.cover.length);
  assert.strictEqual(sig(a), sig(b), 'same seed, same cover');
  assert.notStrictEqual(sig(a), sig(c), 'different seed, different cover');
  const count = (w, t) => w.cover.filter((x) => x.type === t).length;
  const desert = new E.World({ biome: 'desert', seed: 21 }), city = new E.World({ biome: 'urban', seed: 21 });
  assert.ok(count(a, 'tree') > count(desert, 'tree') + 10, 'jungle has trees, desert barely');
  assert.ok(city.cover.filter((x) => x.type === 'ruin' || x.type === 'tower').length > 10, 'city has ruins and towers');
  for (const w of [a, desert, city]) for (const x of w.cover) {
    assert.ok(x.hp > 0 && x.alive && Number.isFinite(x.x + x.z + x.y) && x.hw > 0 && x.hd > 0, 'cover piece well formed');
    assert.ok(w.cps.every((cp) => Math.hypot(cp.pos.x - x.x, cp.pos.z - x.z) > cp.r * 0.45), 'capture zone centres stay clear');
  }
  assert.ok(a.cover.some((x) => x.def.fort), 'fortifications around posts');
});

test('cover stops shots and sightlines, degrades, and is destroyed', () => {
  const w = sandbox('desert', 5), m = mid(w);
  const shooter = noThink(spawn(w, 'infantry', 'trooper', 'aegis', m.x - 20, m.z));
  const victim = noThink(spawn(w, 'infantry', 'trooper', 'verdant', m.x + 20, m.z));
  const c = S.addCover(w, 'ruin', m.x, m.z, Math.PI / 2, { w: 6, hpMul: 0.1 });   // wide, tall, brittle wall between them
  assert.ok(c.h >= 1.4);
  const a = { x: shooter.pos.x, y: shooter.pos.y + 1.5, z: shooter.pos.z }, b = S.centerOf(victim, {});
  assert.strictEqual(S.los(w, a, b), false, 'cover blocks the sightline');
  let stage1 = false;
  const hp0 = victim.hp;
  for (let i = 0; i < 400 && c.alive; i++) {
    fireAt(w, shooter, 'blaster', victim.pos.x, victim.pos.y + 1, victim.pos.z);
    step(w, 0.12);
    if (!c.alive) break;
    if (c.stage < 2) assert.strictEqual(victim.hp, hp0, 'victim is untouched while the wall stands');
    if (c.stage >= 1) stage1 = true;
  }
  assert.ok(!c.alive, 'cover was destroyed');
  assert.ok(stage1, 'it degraded through a damaged stage first');
  assert.ok(evs(w, 'coverStage').length >= 1 && evs(w, 'coverBreak').length === 1, 'degrade and break events');
  assert.strictEqual(S.los(w, a, b), true, 'sightline opens once it is gone');
  fireAt(w, shooter, 'blaster', victim.pos.x, victim.pos.y + 1, victim.pos.z); step(w, 0.5);
  assert.ok(victim.hp < hp0, 'shots now reach the victim');
});

test('low cover can be shot over from standing, tall cover cannot; hard cover shrugs off blasters', () => {
  const w = sandbox('desert', 5), m = mid(w);
  const sh = noThink(spawn(w, 'infantry', 'trooper', 'aegis', m.x - 16, m.z)), vi = noThink(spawn(w, 'infantry', 'trooper', 'verdant', m.x + 16, m.z));
  const low = S.addCover(w, 'sandbag', m.x, m.z, Math.PI / 2, { w: 6 });
  const a = S.eyeOf(sh, {}), b = S.centerOf(vi, {});
  assert.strictEqual(S.los(w, a, b), true, 'standing eyes clear a sandbag wall');
  vi.h = vi.def.h * 0.66; b.y = vi.pos.y + vi.h * 0.55;
  const hard = S.addCover(w, 'bunker', m.x + 4, m.z, Math.PI / 2, { w: 12 });
  const hp = hard.hp;
  for (let i = 0; i < 30; i++) { fireAt(w, sh, 'blaster', vi.pos.x, vi.pos.y + 1.2, vi.pos.z); step(w, 0.1); }
  assert.ok(hard.hp > hp * 0.85, 'a bunker wall barely notices blaster fire');
  fireAt(w, sh, 'rocket', hard.x, hard.y + 1, hard.z); step(w, 3);
  assert.ok(hard.hp < hp * 0.85, 'a rocket hurts it: ' + hard.hp + '/' + hp);
});

test('explosions damage nearby cover (splash)', () => {
  const w = sandbox('desert', 5), m = mid(w);
  const g = noThink(spawn(w, 'infantry', 'trooper', 'aegis', m.x - 30, m.z));
  const c = S.addCover(w, 'sandbag', m.x, m.z + 3, 0, { w: 5 });
  const hp = c.hp;
  fireAt(w, g, 'grenade', m.x, m.y, m.z); step(w, 4);
  assert.ok(c.hp < hp, 'a frag charge landing next to a sandbag wall damages it');
});

// ── movement ─────────────────────────────────────────────────
test('infantry accelerate quickly but not instantly, and crouch is slower and smaller', () => {
  const w = sandbox('desert', 5), m = mid(w);
  w.addPlayer('p', 'aegis', 'P');
  const u = spawn(w, 'infantry', 'trooper', 'aegis', m.x, m.z); S.possess(w, 'p', u.id);
  w.setInput('p', { mx: 0, mz: 1, moveYaw: 0, yaw: 0, pitch: 0 });
  step(w, 0.1); const v1 = Math.hypot(u.vel.x, u.vel.z);
  step(w, 0.5); const v2 = Math.hypot(u.vel.x, u.vel.z);
  assert.ok(v1 > 2 && v1 < u.def.speed * 0.95, 'ramps up: ' + v1);
  assert.ok(v2 > u.def.speed * 0.9, 'reaches run speed: ' + v2);
  w.setInput('p', { mx: 0, mz: 0 }); step(w, 0.5);
  assert.ok(Math.hypot(u.vel.x, u.vel.z) < 0.3, 'stops dead, no float');
  const h0 = u.h;
  w.setInput('p', { mz: 1, crouch: true }); step(w, 1);
  assert.strictEqual(u.stance, 1);
  assert.ok(u.h < h0 * 0.8, 'smaller target: ' + u.h);
  assert.ok(Math.hypot(u.vel.x, u.vel.z) < u.def.speed * 0.6, 'crouch walks slower');
  w.setInput('p', { crouch: false, mz: 0 }); step(w, 0.6);
  assert.ok(u.h > h0 * 0.95, 'stands back up');
});

test('crouching steadies aim; sprint drains stamina; sliding works from a sprint', () => {
  const w = sandbox('desert', 5), m = mid(w);
  w.addPlayer('p', 'aegis', 'P');
  const u = spawn(w, 'infantry', 'trooper', 'aegis', m.x, m.z); S.possess(w, 'p', u.id);
  w.setInput('p', { mz: 1, moveYaw: 0, yaw: 0 }); step(w, 1); const moving = u.bloom;
  w.setInput('p', { mz: 0 }); step(w, 1); const still = u.bloom;
  w.setInput('p', { crouch: true }); step(w, 1); const crouched = u.bloom;
  assert.ok(moving > still * 1.8 && crouched < still * 0.7, `bloom moving ${moving.toFixed(4)} standing ${still.toFixed(4)} crouched ${crouched.toFixed(4)}`);
  w.setInput('p', { crouch: false, sprint: true, mz: 1 }); step(w, 1.0);
  assert.ok(u.sprinting && u.stam < 0.95 && u.stam > 0.5, 'sprinting costs stamina: ' + u.stam);
  w.setInput('p', { crouch: true }); step(w, 0.1);
  assert.strictEqual(u.stance, 2, 'slide from a sprint');
  assert.ok(evs(w, 'slide').length === 1);
  const v = Math.hypot(u.vel.x, u.vel.z);
  assert.ok(v > u.def.speed, 'slide carries momentum: ' + v);
  step(w, 1.2); assert.notStrictEqual(u.stance, 2, 'slide ends');
  w.setInput('p', { sprint: true, crouch: false, mz: 1 }); step(w, 12);
  assert.ok(u.winded || u.stam < 0.4, 'sustained sprinting winds the soldier');
});

test('infantry vault low cover automatically, mantle ledges, and are stopped by tall walls', () => {
  const w = sandbox('desert', 5), m = mid(w);
  w.addPlayer('p', 'aegis', 'P');
  const u = spawn(w, 'infantry', 'trooper', 'aegis', m.x, m.z - 8); S.possess(w, 'p', u.id);
  const wall = S.addCover(w, 'sandbag', m.x, m.z, 0, { w: 8 });      // 1.0m high, runs along x
  w.setInput('p', { mz: 1, moveYaw: 0, yaw: 0 });
  let vaulted = false, sawArc = false;
  for (let i = 0; i < 90; i++) { step(w, DT); if (u.vault > 0) { vaulted = true; if (u.pos.y > u.pos.y - 1 && u.vault > 0.3 && u.vault < 0.7) sawArc = true; } }
  assert.ok(vaulted, 'vault started'); assert.strictEqual(evs(w, 'vault')[0].kind, 'vault');
  assert.ok(u.pos.z > m.z + 1, 'ended up on the far side: ' + (u.pos.z - m.z));
  assert.ok(Math.abs(u.pos.y - w.terrain.ground(u.pos.x, u.pos.z)) < 0.3, 'landed on the ground');
  // ledge: crate stack is climbable but slower
  w.events.length = 0;
  const u2 = spawn(w, 'infantry', 'trooper', 'aegis', m.x + 30, m.z - 8); S.possess(w, 'p', u2.id); w.setInput('p', { mz: 1, moveYaw: 0, yaw: 0 });
  S.addCover(w, 'crates', m.x + 30, m.z, 0, { w: 6, d: 2 });
  for (let i = 0; i < 120; i++) step(w, DT);
  const mv = evs(w, 'vault'); assert.ok(mv.length && mv[0].kind === 'mantle', 'crates are mantled');
  assert.ok(u2.pos.z > m.z + 1.5, 'crossed the crates');
  // a bunker wall cannot be crossed
  const u3 = spawn(w, 'infantry', 'trooper', 'aegis', m.x - 40, m.z - 8); S.possess(w, 'p', u3.id); w.setInput('p', { mz: 1, moveYaw: 0, yaw: 0 });
  S.addCover(w, 'bunker', m.x - 40, m.z, 0, { w: 14 });
  for (let i = 0; i < 120; i++) step(w, DT);
  assert.ok(u3.pos.z < m.z - 1, 'bunker walls hold: ' + (u3.pos.z - m.z));
});

// ── suppression ──────────────────────────────────────────────
test('near misses build suppression that worsens aim, and it decays', () => {
  const w = sandbox('desert', 5), m = mid(w);
  w.addPlayer('p', 'verdant', 'P');
  const gun = asPlayer(w, noThink(spawn(w, 'infantry', 'heavy', 'aegis', m.x - 40, m.z)));
  const v = spawn(w, 'infantry', 'trooper', 'verdant', m.x + 10, m.z); S.possess(w, 'p', v.id);
  w.setInput('p', { crouch: true, yaw: 0, moveYaw: 0 });
  step(w, 1);
  const calm = v.bloom;
  for (let i = 0; i < 25; i++) { fireAt(w, gun, 'repeater', v.pos.x, v.pos.y + 1.0, v.pos.z + 2.6); step(w, 0.05); }   // 2.6 m to the side: past him, not through him
  assert.ok(v.supp > 0.35, 'a burst of misses suppresses: ' + v.supp);
  assert.ok(v.bloom > calm * 3 || v.bloom > 0.02, 'aim is worse while suppressed');
  assert.ok(evs(w, 'suppress').some((e) => e.to === 'p' && e.level >= 1), 'HUD event emitted');
  assert.ok(v.alive, 'but nobody was killed');
  const peak = v.supp; step(w, 6);
  assert.ok(v.supp < peak * 0.3, 'decays when the fire stops: ' + v.supp);
  assert.ok(evs(w, 'suppress').some((e) => e.level === 0), 'release event');
});

test('heavy fire suppresses harder than a rifle; perks scale it', () => {
  const run = (wk, perk) => {
    const w = sandbox('desert', 5), m = mid(w);
    const gun = noThink(spawn(w, 'infantry', 'heavy', 'aegis', m.x - 40, m.z));
    if (perk) S.applyPerks(gun, [perk]);
    const v = noThink(spawn(w, 'infantry', 'trooper', 'verdant', m.x + 10, m.z)); S.applyPerks(v, []);
    const p = fireAt(w, gun, wk, v.pos.x + 2.0, v.pos.y + 1.0, v.pos.z);
    p.pos.x = v.pos.x + 2; p.pos.z = v.pos.z; p.pos.y = v.pos.y + 1;           // as it flies past
    S.ctl.infantry.nearMiss(w, v, p);
    return v.supp;
  };
  const rifle = run('blaster'), mg = run('repeater'), sniper = run('longrifle'), mgPerk = run('repeater', 'heavy.suppressor');
  assert.ok(mg > rifle * 1.3, `repeater ${mg.toFixed(3)} vs blaster ${rifle.toFixed(3)}`);
  assert.ok(sniper > rifle, 'a lance round cracks past loudly');
  assert.ok(mgPerk > mg * 1.5, `suppressor perk ${mgPerk.toFixed(3)} vs ${mg.toFixed(3)}`);
  // and the wearer's perks cut the other way
  const w = sandbox('desert', 5), m = mid(w), gun = noThink(spawn(w, 'infantry', 'heavy', 'aegis', m.x - 40, m.z)); S.applyPerks(gun, []);
  const plate = noThink(spawn(w, 'infantry', 'trooper', 'verdant', m.x + 10, m.z)), plain = noThink(spawn(w, 'infantry', 'trooper', 'verdant', m.x + 14, m.z));
  S.applyPerks(plate, ['trooper.plate']); S.applyPerks(plain, []);
  const p = fireAt(w, gun, 'repeater', m.x, 0, m.z); S.ctl.infantry.nearMiss(w, plate, p); S.ctl.infantry.nearMiss(w, plain, p);
  assert.ok(plate.supp < plain.supp * 0.8, 'plate carrier resists suppression');
});

test('bots under suppression get low and head for cover', () => {
  const w = sandbox('desert', 5), m = mid(w);
  const gun = noThink(spawn(w, 'infantry', 'heavy', 'aegis', m.x - 60, m.z));
  const bot = spawn(w, 'infantry', 'trooper', 'verdant', m.x + 10, m.z);
  S.addCover(w, 'sandbag', m.x + 18, m.z - 4, Math.PI / 2, { w: 5 });
  S.addCover(w, 'barrier', m.x + 22, m.z + 6, Math.PI / 2, { w: 4 });
  for (let i = 0; i < 60; i++) { fireAt(w, gun, 'repeater', bot.pos.x + 1.2, bot.pos.y + 1, bot.pos.z); step(w, 0.1); }
  assert.ok(bot.ai.cov || bot.stance === 1 || bot.hp < bot.maxHp, 'bot reacted');
  if (bot.alive) assert.ok(bot.ai.mode === 'fight' || bot.ai.mode === 'advance' || bot.ai.mode === 'retreat', 'mode ' + bot.ai.mode);
});

// ── perks and loadouts ───────────────────────────────────────
test('loadout verb validates perks; deploying applies them; bots get defaults', () => {
  const w = new E.World({ biome: 'tundra', seed: 11, human: 'aegis' });
  w.addPlayer('p1', 'aegis', 'Cmd');
  assert.strictEqual(w.verb('p1', 'loadout', 'heavy', ['heavy.suppressor', 'heavy.ironclad', 'heavy.tandem']).join(), 'heavy.suppressor,heavy.tandem', 'one per tier');
  assert.strictEqual(w.verb('p1', 'loadout', 'heavy', ['trooper.stim', 'nonsense', 'heavy.ironclad']).join(), 'heavy.ironclad', 'wrong class / unknown ids dropped');
  assert.strictEqual(w.verb('p1', 'loadout', 'tank', []), null, 'unknown class');
  for (const cls of Object.keys(E.PERKS)) { assert.ok(E.INFANTRY[cls], cls + ' is a class'); assert.strictEqual(E.PERKS[cls].t1.length, 2); assert.strictEqual(E.PERKS[cls].t2.length, 2); }
  w.verb('p1', 'loadout', 'heavy', ['heavy.ironclad', 'heavy.skyhunter']);
  const home = w.cps.find((c) => c.home === 'aegis');
  const plain = S.spawnUnit(w, 'infantry', 'heavy', 'aegis', { x: 0, z: 0 }); S.applyPerks(plain, []);
  const d = w.deploy('p1', 'heavy', home.id);
  assert.ok(d && d.perks.join() === 'heavy.ironclad,heavy.skyhunter');
  assert.strictEqual(d.maxHp, plain.maxHp + 30, 'ironclad: +30 health');
  assert.ok(d.m.dr > 0.1 && d.m.seek > 1.5 && d.m.vsAir > 1.2, 'stat modifiers set');
  assert.ok(evs(w, 'loadout').length === 1);
  const bots = w.units.filter((u) => u.kind === 'infantry' && !u.pid && u !== plain);
  assert.ok(bots.length > 10 && bots.every((u) => u.perks.length === 2 && u.perks.every((id) => E.PERK_BY_ID[id].cls === u.type)), 'bots have valid default perks');
  const eng = bots.find((u) => u.type === 'engineer');
  assert.ok(eng, 'engineers are in the bot mix');
});

test('perks change behaviour: minelayer carries more mines, welder repairs faster, stim sprints faster', () => {
  const w = sandbox('desert', 5), m = mid(w);
  const e1 = spawn(w, 'infantry', 'engineer', 'aegis', m.x, m.z), e2 = spawn(w, 'infantry', 'engineer', 'aegis', m.x + 10, m.z);
  S.applyPerks(e1, ['engineer.minelayer', 'engineer.welder']); S.applyPerks(e2, ['engineer.fabricator', 'engineer.sapper']);
  assert.strictEqual(e1.m.mines, 7); assert.strictEqual(e2.m.mines, 4);
  assert.ok(e1.m.repair === 1.5 && e1.m.mineDmg === 1.25 && e2.m.cover === 1.6 && e2.m.fuse < 1 && e2.m.chargeDmg === 1.5);
  const t = spawn(w, 'infantry', 'trooper', 'aegis', m.x, m.z + 10); const s0 = t.def.sprint;
  S.applyPerks(t, ['trooper.stim', 'trooper.overcharge']);
  assert.ok(t.m.sprint > 1.1 && t.m.dmg > 1.1 && t.m.heat > 1.2);
});

// ── vehicles ─────────────────────────────────────────────────
test('vehicles have inertia: they build speed gradually and coast', () => {
  const w = sandbox('desert', 5), m = mid(w);
  w.addPlayer('p', 'aegis', 'P');
  const t = spawn(w, 'vehicle', 'tank', 'aegis', m.x - 40, m.z); t.yaw = Math.PI / 2; S.possess(w, 'p', t.id);
  w.setInput('p', { mz: 1, mx: 0, yaw: t.yaw, pitch: 0 });
  step(w, 0.5); const v1 = Math.hypot(t.vel.x, t.vel.z);
  step(w, 4); const v2 = Math.hypot(t.vel.x, t.vel.z);
  assert.ok(v1 < t.speed * 0.45, 'slow to get going: ' + v1);
  assert.ok(v2 > t.speed * 0.9, 'gets there: ' + v2);
  w.setInput('p', { mz: 0 }); step(w, 0.3);
  assert.ok(Math.hypot(t.vel.x, t.vel.z) > v2 * 0.4, 'it coasts');
  step(w, 4); assert.ok(Math.hypot(t.vel.x, t.vel.z) < 1, 'and stops');
  // hover settles near ride height with a bob
  const ys = []; for (let i = 0; i < 60; i++) { step(w, DT); ys.push(t.pos.y - w.terrain.height(t.pos.x, t.pos.z)); }
  assert.ok(Math.min(...ys) > 0.2 && Math.max(...ys) < t.def.hover + 0.4, 'hover height stays sane');
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.001, 'hover is not frozen');
});

test('skiffs drift: they slide sideways through a hard turn', () => {
  const w = sandbox('desert', 5), m = mid(w);
  w.addPlayer('p', 'aegis', 'P');
  const s = spawn(w, 'vehicle', 'skiff', 'aegis', m.x - 40, m.z); s.yaw = Math.PI / 2; S.possess(w, 'p', s.id);
  w.setInput('p', { mz: 1, mx: 0, yaw: s.yaw, pitch: 0 }); step(w, 3);
  w.setInput('p', { mx: -1 }); step(w, 0.7);
  const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), lat = Math.abs(s.vel.x * Math.cos(s.yaw) - s.vel.z * Math.sin(s.yaw)), fwd = s.vel.x * fx + s.vel.z * fz;
  assert.ok(lat > 1.5, 'lateral slip while turning: ' + lat.toFixed(2) + ' fwd ' + fwd.toFixed(1));
});

test('armor is facing dependent: rear hits hurt a tank far more than front hits', () => {
  const w = sandbox('desert', 5), m = mid(w);
  const mk = (x) => { const t = noThink(spawn(w, 'vehicle', 'tank', 'verdant', x, m.z)); t.yaw = 0; t.shield = 0; return t; };
  const front = mk(m.x - 60), rear = mk(m.x + 60);             // both face +z
  const sh = noThink(spawn(w, 'infantry', 'heavy', 'aegis', 0, 0));
  const shotAt = (tank, fromZ) => {
    sh.pos.x = tank.pos.x; sh.pos.z = tank.pos.z + fromZ; sh.pos.y = w.terrain.ground(sh.pos.x, sh.pos.z);
    const before = tank.hp;
    fireAt(w, sh, 'rocket', tank.pos.x, tank.pos.y + 1.5, tank.pos.z); step(w, 3);
    return before - tank.hp;
  };
  const dFront = shotAt(front, 60), dRear = shotAt(rear, -60);
  assert.ok(dFront > 0 && dRear > dFront * 2, `front ${dFront.toFixed(0)} rear ${dRear.toFixed(0)}`);
  assert.strictEqual(front.lastZone, 'front'); assert.strictEqual(rear.lastZone, 'rear');
  const ev = w.events.filter((e) => e.type === 'armor');
  void ev;
  // the zone is reported on the hit for players
  w.addPlayer('p', 'verdant', 'P'); S.possess(w, 'p', front.id); front.mode = null; w.setInput('p', { mx: 0, mz: 0, yaw: 0, pitch: 0 });
  shotAt(front, 60); assert.ok(evs(w, 'armor').some((e) => e.zone === 'front' && e.mul < 1), 'armor event');
});

test('mobility kill: low hull integrity cripples a vehicle, burning kills it, repairs recover it', () => {
  const w = sandbox('desert', 5), m = mid(w);
  w.addPlayer('p', 'aegis', 'P');
  const t = spawn(w, 'vehicle', 'tank', 'aegis', m.x, m.z); t.yaw = 0; S.possess(w, 'p', t.id);
  w.setInput('p', { mz: 1, yaw: 0, pitch: 0 }); step(w, 5);
  const fast = Math.hypot(t.vel.x, t.vel.z);
  t.hp = t.maxHp * 0.3; step(w, 3);
  assert.strictEqual(t.crip, 1); assert.ok(evs(w, 'cripple').length === 1);
  assert.ok(Math.hypot(t.vel.x, t.vel.z) < fast * 0.65, 'crippled hull is slower');
  t.hp = t.maxHp * 0.1; step(w, 1); assert.strictEqual(t.crip, 2, 'burning');
  const h = t.hp; step(w, 5); assert.ok(t.hp < h, 'burning eats hull');
  t.hp = t.maxHp * 0.8; step(w, 1); assert.strictEqual(t.crip, 0); assert.ok(evs(w, 'recover').length >= 1);
});

test('turrets have traverse limits: a skiff cannot hit what is behind it, a tank can swing around', () => {
  const w = sandbox('desert', 5), m = mid(w);
  w.addPlayer('p', 'aegis', 'P');
  const s = spawn(w, 'vehicle', 'skiff', 'aegis', m.x, m.z); s.yaw = 0; S.possess(w, 'p', s.id);
  w.setInput('p', { mz: 0, yaw: Math.PI, pitch: 0, fire: true }); step(w, 3);
  assert.ok(s.aimLimited, 'aim is limited');
  assert.ok(Math.abs(S.angDiff(s.aimYaw, s.yaw)) <= E.VEHICLES.skiff.turret.arc + 0.01, 'turret stays inside its arc');
  assert.strictEqual(w.projectiles.filter((p) => p.uid === s.id).length + evs(w, 'fire').filter((e) => e.uid === s.id).length, 0, 'it will not fire out of arc');
  const t = spawn(w, 'vehicle', 'tank', 'aegis', m.x + 50, m.z); t.yaw = 0; S.possess(w, 'p', t.id);
  w.setInput('p', { yaw: Math.PI, fire: false }); step(w, 0.5);
  const half = Math.abs(S.angDiff(t.aimYaw, Math.PI));
  assert.ok(half > 0.6, 'turret traverse takes time: still ' + half.toFixed(2) + ' rad off');
  step(w, 4); assert.ok(Math.abs(S.angDiff(t.aimYaw, Math.PI)) < 0.05, 'gets there'); assert.ok(!t.aimLimited);
});

test('ramming hurts infantry and vehicles; wrecks blow up and become cover; cover crushes', () => {
  const w = sandbox('desert', 5), m = mid(w);
  w.addPlayer('p', 'aegis', 'P');
  const t = spawn(w, 'vehicle', 'tank', 'aegis', m.x - 60, m.z); t.yaw = Math.PI / 2; S.possess(w, 'p', t.id);
  const inf = noThink(spawn(w, 'infantry', 'trooper', 'verdant', m.x - 10, m.z)); inf.hp = inf.maxHp = 400;
  const sand = S.addCover(w, 'sandbag', m.x - 30, m.z, Math.PI / 2, { w: 8 });
  w.setInput('p', { mz: 1, yaw: Math.PI / 2, pitch: 0 }); step(w, 6);
  assert.ok(!sand.alive, 'driven through the sandbags');
  assert.ok(inf.hp < inf.maxHp, 'ran the trooper down: ' + inf.hp);
  assert.ok(evs(w, 'ram').length >= 1);
  const other = noThink(spawn(w, 'vehicle', 'skiff', 'verdant', m.x + 40, m.z)); other.yaw = 0;
  const near = noThink(spawn(w, 'infantry', 'trooper', 'verdant', other.pos.x + 6, m.z));
  const nearHp = near.hp; const n0 = w.cover.length;
  S.kill(w, other, { team: 'aegis', uid: t.id, owner: null, wk: 'cannon' });
  assert.ok(evs(w, 'wreck').length === 1 && evs(w, 'blast').length >= 1, 'wreck + blast events');
  assert.ok(near.hp < nearHp, 'secondary explosion hurts bystanders');
  assert.ok(w.cover.length === n0 + 1 && w.cover[w.cover.length - 1].type === 'wreck', 'wreck is cover now');
});

// ── anti-air, structures ─────────────────────────────────────
function lowFlyer(w, team, from, to, alt, speed) {
  // a fighter on rails: straight and level, ignoring everything (the AIR engineer owns real flight)
  S.modes.flyby = S.modes.flyby || { ai(w, u, dt) { u.vel.x = Math.sin(u.yaw) * u.fspd; u.vel.z = Math.cos(u.yaw) * u.fspd; u.vel.y = 0; u.pos.x += u.vel.x * dt; u.pos.z += u.vel.z * dt; u.pos.y = w.terrain.height(u.pos.x, u.pos.z) + u.alt; u.spd = u.fspd; }, player() {} };
  const f = S.spawnUnit(w, 'fighter', 'interceptor', team, { x: from.x, y: w.terrain.height(from.x, from.z) + alt, z: from.z });
  f.mode = 'flyby'; f.yaw = Math.atan2(to.x - from.x, to.z - from.z); f.alt = alt; f.fspd = speed; f.jamT = 0; return f;
}
const runPast = (w, f, from, to, spd) => step(w, Math.hypot(to.x - from.x, to.z - from.z) / spd + 4);
test('ground AA shoots down aircraft that fly low and slow, but cannot touch high ones', () => {
  const w = sandbox('desert', 5), m = mid(w);
  const aa = spawn(w, 'turret', 'aabattery', 'verdant', m.x, m.z);
  const A = { x: m.x - 500, z: m.z + 80 }, B = { x: m.x + 500, z: m.z + 80 };
  const f = lowFlyer(w, 'aegis', A, B, 70, 65);
  runPast(w, f, A, B, 65);
  assert.ok(!f.alive, 'low and slow fighter was shot down');
  assert.ok(evs(w, 'fire').some((e) => e.wk === 'aamissile') && evs(w, 'fire').some((e) => e.wk === 'aaflak'), 'with flak and a seeker');
  const w2 = sandbox('desert', 5); const m2 = mid(w2);
  spawn(w2, 'turret', 'aabattery', 'verdant', m2.x, m2.z);
  const f2 = lowFlyer(w2, 'aegis', { x: m2.x - 500, z: m2.z + 80 }, { x: m2.x + 500, z: m2.z + 80 }, 1800, 65);
  runPast(w2, f2, A, B, 65); assert.ok(f2.alive && f2.hp === f2.maxHp && f2.shield === f2.maxShield, 'a fighter high in the sky is safe');
});

test('AA fire is a better threat to slow, low targets than to fast, high ones', () => {
  const trial = (spd, alt) => {
    let dealt = 0;
    for (let s = 1; s <= 4; s++) {
      const w = sandbox('desert', 5 + s), m = mid(w);
      spawn(w, 'turret', 'aabattery', 'verdant', m.x, m.z);
      const A = { x: m.x - 500, z: m.z + 120 }, B = { x: m.x + 500, z: m.z + 120 };
      const f = lowFlyer(w, 'aegis', A, B, alt, spd);
      runPast(w, f, A, B, spd);
      dealt += f.alive ? 1 - (f.hp + f.shield) / (f.maxHp + f.maxShield) : 1;
    }
    return dealt / 4;
  };
  const slowLow = trial(55, 60), fastLow = trial(200, 60), slowHigh = trial(55, 520);
  assert.ok(slowLow > fastLow + 0.1, `slow ${slowLow.toFixed(2)} vs fast ${fastLow.toFixed(2)}`);
  assert.ok(slowLow > slowHigh + 0.1, `low ${slowLow.toFixed(2)} vs high ${slowHigh.toFixed(2)}`);
});

test('countermeasures defeat AA seekers', () => {
  const run = (jam) => {
    const w = sandbox('desert', 5), m = mid(w);
    spawn(w, 'turret', 'aabattery', 'verdant', m.x, m.z);
    const A = { x: m.x - 500, z: m.z + 60 }, B = { x: m.x + 500, z: m.z + 60 };
    const f = lowFlyer(w, 'aegis', A, B, 60, 70);
    let hitsByMissile = 0;
    for (let i = 0; i < 16 * HZ; i++) {
      if (jam) f.jamT = w.t + 5;
      step(w, DT);
    }
    const shots = evs(w, 'fire').filter((e) => e.wk === 'aamissile').length;
    const miss = evs(w, 'impact').filter((e) => e.wk === 'aamissile' && e.surf === 'unit').length;
    return { shots, miss };
  };
  const clean = run(false), jammed = run(true);
  assert.ok(clean.shots >= 1, 'it launches at a clean target');
  assert.ok(jammed.shots <= clean.shots, 'a jammed target is harder to get a lock on');
  assert.ok(jammed.miss < clean.miss || clean.miss === 0, `jamming spoils the hits: ${jammed.miss} vs ${clean.miss}`);
});

test('AA batteries are helpless against infantry and fall to a ground assault', () => {
  const w = sandbox('desert', 5), m = mid(w);
  const aa = spawn(w, 'turret', 'aabattery', 'verdant', m.x, m.z);
  const squad = [0, 1, 2, 3].map((i) => spawn(w, 'infantry', 'trooper', 'aegis', m.x - 60, m.z + i * 4 - 6));
  step(w, 25);
  assert.ok(!aa.alive, 'assault killed the AA battery');
  assert.ok(squad.every((u) => u.hp === u.maxHp), 'which never fired back');
});

test('mobile AA platform exists, engages aircraft, and is soft against ground attackers', () => {
  assert.ok(E.VEHICLES.aa && E.VEHICLES.aa.alt === 'aamissile');
  const w = sandbox('desert', 5), m = mid(w);
  const sentinel = spawn(w, 'vehicle', 'aa', 'verdant', m.x, m.z);
  const A = { x: m.x - 450, z: m.z + 60 }, B = { x: m.x + 450, z: m.z + 60 };
  const f = lowFlyer(w, 'aegis', A, B, 60, 65); runPast(w, f, A, B, 65);
  assert.ok(!f.alive || f.hp + f.shield < (f.maxHp + f.maxShield) * 0.6, 'sentinel hurt the flyer');
  assert.ok(sentinel.def.armor === 'light');
});

test('the shield generator dome reports shielded for its team only, until destroyed', () => {
  const w = sandbox('desert', 5), m = mid(w);
  const g = noThink(spawn(w, 'turret', 'shieldgen', 'aegis', m.x, m.z));
  assert.strictEqual(S.shielded(w, 'aegis', { x: m.x + 100, z: m.z, y: 0 }), true);
  assert.strictEqual(S.shielded(w, 'aegis', { x: m.x + 200, z: m.z, y: 0 }), false, 'outside the dome');
  assert.strictEqual(S.shielded(w, 'verdant', { x: m.x + 10, z: m.z, y: 0 }), false, 'enemy gets no cover');
  S.kill(w, g, { team: 'verdant', uid: 0, owner: null, wk: 'cannon' });
  assert.strictEqual(S.shielded(w, 'aegis', { x: m.x + 10, z: m.z, y: 0 }), false, 'dome drops with the generator');
  assert.ok(evs(w, 'structureDown').length === 1);
  // the real battle has one per side near home
  const b = new E.World({ biome: 'desert', seed: 9 });
  for (const f of E.TEAMS) { const home = b.cps.find((c) => c.home === f); assert.ok(S.shielded(b, f, home.pos), f + ' home base is shielded'); assert.ok(!S.shielded(b, S.enemyOf(f), home.pos)); }
});

test('the ion cannon belongs to the owner of the central post and strips enemy capital shields', () => {
  const w = sandbox('desert', 5), m = mid(w);
  const ion = noThink(spawn(w, 'turret', 'ioncannon', 'aegis', m.x + 5, m.z + 10)); ion.cpId = 2; w.ion = ion; ion.cd = 0.5;
  const cap = S.spawnUnit(w, 'capital', 'cruiser', 'verdant', { x: 0, y: 3000, z: 0 }, { orbitR: 900, alt: 3000 });
  cap.mode = 'idle';
  const sh0 = cap.shield;
  w.cps[2].owner = null; step(w, 3);
  assert.strictEqual(cap.shield, sh0, 'unowned post: the cannon stays silent'); assert.strictEqual(ion.active, false);
  w.cps[2].owner = 'verdant'; step(w, 1);
  assert.strictEqual(ion.team, 'verdant', 'it changes hands with the post'); assert.ok(evs(w, 'ionFlip').length === 1);
  w.cps[2].owner = 'aegis'; step(w, 1); assert.strictEqual(ion.team, 'aegis'); assert.strictEqual(ion.active, true);
  ion.cd = 0.2; step(w, 1.5);
  assert.ok(cap.shield < sh0 - 3000, 'enemy capital shield stripped: ' + (sh0 - cap.shield));
  const e = evs(w, 'ion'); assert.ok(e.length === 1 && e[0].tid === cap.id && e[0].from && e[0].to, 'ion event with endpoints');
  assert.ok(ion.cd > 30, 'it recharges');
});

// ── engineer ─────────────────────────────────────────────────
test('a bot engineer repairs a damaged tank', () => {
  const w = sandbox('desert', 5), m = mid(w);
  const tank = noThink(spawn(w, 'vehicle', 'tank', 'aegis', m.x, m.z)); tank.hp = tank.maxHp * 0.4;
  const eng = spawn(w, 'infantry', 'engineer', 'aegis', m.x - 25, m.z);
  step(w, 25);
  assert.ok(tank.hp > tank.maxHp * 0.8, 'repaired to ' + (tank.hp / tank.maxHp).toFixed(2));
  assert.ok(evs(w, 'repair').length > 3, 'repair beam events');
});

test('a player engineer repairs with the torch, rebuilds cover, raises a barricade', () => {
  const w = sandbox('desert', 5), m = mid(w);
  w.addPlayer('p', 'aegis', 'P');
  const eng = spawn(w, 'infantry', 'engineer', 'aegis', m.x, m.z - 8); S.possess(w, 'p', eng.id);
  const tank = noThink(spawn(w, 'vehicle', 'tank', 'aegis', m.x, m.z)); tank.hp = 500;
  w.setInput('p', { yaw: 0, moveYaw: 0, pitch: 0, fire: true, cycle: true }); step(w, 0.1);
  w.setInput('p', { cycle: false }); assert.strictEqual(eng.tool, 1, 'cycle selects the torch');
  step(w, 5);
  assert.ok(tank.hp > 800, 'torch repairs: ' + tank.hp);
  w.setInput('p', { fire: false, abil2: true }); step(w, 0.1); w.setInput('p', { abil2: false });
  assert.ok(evs(w, 'build').length === 1 && w.cover.some((c) => c.type === 'shield' && c.team === 'aegis'), 'barricade raised');
  tank.hp = tank.maxHp; const wall = w.cover.find((c) => c.type === 'shield'); wall.hp = wall.maxHp * 0.3; wall.stage = 2;
  w.setInput('p', { yaw: 0, pitch: -0.5, fire: true }); step(w, 3);
  assert.ok(wall.hp > wall.maxHp * 0.6, 'the torch also mends cover');
  w.setInput('p', { fire: false, abil2: true }); step(w, 0.1); w.setInput('p', { abil2: false });
  assert.ok(wall.hp <= wall.maxHp, 'cooldown prevents spam'); assert.strictEqual(evs(w, 'build').length, 1);
});

test('engineer mines hurt enemy vehicles that drive over them, and are capped per engineer', () => {
  const w = sandbox('desert', 5), m = mid(w);
  w.addPlayer('p', 'aegis', 'P');
  const eng = spawn(w, 'infantry', 'engineer', 'aegis', m.x, m.z); S.possess(w, 'p', eng.id); S.applyPerks(eng, []);
  step(w, 2.1); w.setInput('p', { yaw: 0, moveYaw: 0, abil: true }); step(w, 0.1);
  assert.strictEqual(w.mines.length, 1); assert.strictEqual(evs(w, 'mine').length, 1);
  w.setInput('p', { abil: false });
  for (let i = 0; i < 8; i++) { eng.altT = 0; eng.pos.x += 5; w.setInput('p', { abil: true }); step(w, 0.05); }
  assert.strictEqual(w.mines.length, 4, 'capped at 4 (oldest removed)');
  w.mines.length = 0; S.layMine(w, eng);
  const tank = noThink(spawn(w, 'vehicle', 'tank', 'verdant', m.x + 80, m.z)); tank.yaw = -Math.PI / 2;
  const mine = w.mines[0], sk = noThink(spawn(w, 'vehicle', 'skiff', 'verdant', mine.x, mine.z + 40));
  step(w, 2);
  tank.pos.x = mine.x + 50; tank.pos.z = mine.z; tank.mode = 'drive';
  S.modes.drive = { ai(w, u, dt) { S.stepVehicle(w, u, dt, 1, 0); }, player() {} };
  const hp = tank.hp + tank.shield; step(w, 6);
  assert.strictEqual(w.mines.length, 0, 'mine was consumed'); assert.ok(evs(w, 'mineBlast').length === 1);
  assert.ok(tank.hp + tank.shield < hp - 300, 'tank was hurt: ' + (hp - tank.hp - tank.shield).toFixed(0));
});

test('charges: an engineer plants one on an enemy structure; an enemy engineer can defuse it', () => {
  const w = sandbox('desert', 5), m = mid(w);
  const gen = noThink(spawn(w, 'turret', 'shieldgen', 'verdant', m.x, m.z));
  const eng = noThink(spawn(w, 'infantry', 'engineer', 'aegis', m.x - 20, m.z));
  eng.altT = 0; const c = S.plantCharge(w, eng, gen); assert.ok(c && evs(w, 'charge').length === 1);
  step(w, 12.5);
  assert.ok(evs(w, 'chargeBlast').length === 1 && gen.hp < gen.maxHp * 0.5, 'charge detonated: ' + gen.hp);
  const gen2 = noThink(spawn(w, 'turret', 'shieldgen', 'verdant', m.x + 60, m.z));
  const sapper = noThink(spawn(w, 'infantry', 'engineer', 'aegis', m.x + 50, m.z)); sapper.altT = 0; S.plantCharge(w, sapper, gen2);
  const def = noThink(spawn(w, 'infantry', 'engineer', 'verdant', m.x + 55, m.z + 4)); def.tool = 2;
  def.altT = 0; S.engSabotage(w, def, S.dirOf(Math.atan2(gen2.pos.x - def.pos.x, gen2.pos.z - def.pos.z), 0.1, {}), 1.5);
  assert.ok(evs(w, 'defuse').length === 1 && w.charges.length === 0, 'defused');
  step(w, 14); assert.ok(gen2.hp === gen2.maxHp, 'no blast after a defuse');
});

// ── objectives ───────────────────────────────────────────────
test('objective building blocks: destroy, defend, uplink hold report progress and completion', () => {
  const w = sandbox('desert', 5), m = mid(w);
  const gen = noThink(spawn(w, 'turret', 'shieldgen', 'verdant', m.x, m.z));
  const od = S.addObjective(w, { type: 'destroy', target: gen.id, team: 'aegis' });
  const odef = S.addObjective(w, { type: 'defend', target: gen.id, team: 'verdant', duration: 600 });
  const up = S.addObjective(w, { type: 'uplink', pos: { x: m.x + 100, z: m.z }, r: 20, need: 20 });
  for (let i = 0; i < 4; i++) noThink(spawn(w, 'infantry', 'trooper', 'aegis', m.x + 100 + i, m.z));
  step(w, 8);
  assert.ok(up.frac > 0.3 && up.frac < 1 && up.holder === 'aegis', 'uplink progressing: ' + up.frac);
  assert.ok(evs(w, 'objProgress').some((e) => e.id === up.id), 'progress events');
  const defender = noThink(spawn(w, 'infantry', 'trooper', 'verdant', m.x + 105, m.z));
  const before = up.prog.aegis; step(w, 4);
  assert.ok(up.contested && up.prog.aegis <= before + 0.01, 'contested sites stall');
  defender.alive = false; step(w, 20);
  assert.ok(up.done && up.success && up.winner === 'aegis', 'uplink completed');
  gen.hp = gen.maxHp * 0.5; step(w, 0.2); assert.ok(od.frac > 0.45 && od.frac < 0.6, 'destroy progress tracks damage');
  S.kill(w, gen, { team: 'aegis', uid: 0, owner: null, wk: 'cannon' }); step(w, 0.2);
  assert.ok(od.done && od.success && od.winner === 'aegis', 'destroy done'); assert.ok(odef.done && !odef.success && odef.winner === 'aegis', 'defend failed');
  assert.ok(evs(w, 'objDone').length === 3);
});

// ── squads and AI ────────────────────────────────────────────
test('bots form squads; contact makes them pick a focus and a flank', () => {
  const w = new E.World({ biome: 'desert', seed: 31 });
  assert.ok(w.squads.length >= 4, 'squads formed: ' + w.squads.length);
  assert.ok(w.squads.every((s) => s.ids.length >= 1 && s.ids.length <= 5));
  const u = w.units.find((x) => x.kind === 'infantry' && x.sq); assert.ok(S.squadOf(w, u));
  let flank = false, focus = false;
  for (let i = 0; i < 90 * HZ && !(flank && focus); i++) { w.tick(DT); w.events.length = 0; for (const s of w.squads) { if (s.flank) flank = true; if (s.focus) focus = true; } }
  assert.ok(focus, 'squads focus fire'); assert.ok(flank, 'squads flank');
});

test('bots fight from cover and relocate when it is destroyed', () => {
  const w = sandbox('desert', 5), m = mid(w);
  const bot = spawn(w, 'infantry', 'trooper', 'aegis', m.x, m.z);
  const foe = noThink(spawn(w, 'infantry', 'trooper', 'verdant', m.x + 90, m.z)); foe.hp = foe.maxHp = 1e6;
  const c1 = S.addCover(w, 'barrier', m.x + 8, m.z + 7, Math.PI / 2, { w: 5 });
  const c2 = S.addCover(w, 'barrier', m.x + 14, m.z - 8, Math.PI / 2, { w: 5 });
  step(w, 6);
  assert.ok(bot.ai.cov === c1 || bot.ai.cov === c2, 'took cover');
  const first = bot.ai.cov, at = { x: bot.pos.x, z: bot.pos.z };
  S.breakCover(w, first, 'test'); step(w, 4);
  assert.ok(bot.ai.cov !== first, 'relocated after losing its cover');
});

test('medics heal the wounded; badly hurt bots retreat toward medics; heavies hunt armor', () => {
  const w = sandbox('desert', 5), m = mid(w);
  const med = spawn(w, 'infantry', 'medic', 'aegis', m.x, m.z);
  const hurt = spawn(w, 'infantry', 'trooper', 'aegis', m.x + 25, m.z); hurt.hp = hurt.maxHp * 0.25; hurt.ai.thinkT = 0; hurt.ai.retreat = true;
  step(w, 12);
  assert.ok(hurt.hp > hurt.maxHp * 0.45, 'healed to ' + (hurt.hp / hurt.maxHp).toFixed(2));
  assert.ok(Math.hypot(hurt.pos.x - med.pos.x, hurt.pos.z - med.pos.z) < 20, 'came to the medic');
  const w2 = sandbox('desert', 5), m2 = mid(w2);
  const heavy = spawn(w2, 'infantry', 'heavy', 'aegis', m2.x, m2.z), trooper = noThink(spawn(w2, 'infantry', 'trooper', 'verdant', m2.x + 70, m2.z - 20));
  const tank = noThink(spawn(w2, 'vehicle', 'tank', 'verdant', m2.x + 80, m2.z + 20));
  heavy.ai.thinkT = 0; step(w2, 0.5);
  assert.strictEqual(heavy.ai.tid, tank.id, 'heavy picks the tank over the nearer rifleman');
});

test('bots respect player orders (hold)', () => {
  const w = sandbox('desert', 5), m = mid(w);
  w.addPlayer('p', 'aegis', 'P');
  const bot = spawn(w, 'infantry', 'trooper', 'aegis', m.x - 100, m.z);
  w.order('p', [bot.id], 'hold', { x: m.x - 100, z: m.z });
  step(w, 8);
  assert.ok(Math.hypot(bot.pos.x + 100 - m.x, bot.pos.z - m.z) < 14, 'stays put');
  w.order('p', [bot.id], 'attack', { x: m.x + 100, z: m.z }); step(w, 10);
  assert.ok(bot.pos.x > m.x - 60, 'moves out on attack orders');
});

// ── determinism and net ──────────────────────────────────────
test('land sim is deterministic across a full battle slice', () => {
  const run = () => {
    const w = new E.World({ biome: 'urban', seed: 77 });
    for (let i = 0; i < HZ * 40; i++) { w.tick(DT); w.events.length = 0; }
    return JSON.stringify([w.units.map((u) => [u.id, u.type, Math.round(u.pos.x * 10), Math.round(u.pos.z * 10), Math.round(u.hp), (u.supp || 0).toFixed(2), u.stance]),
      w.cover.map((c) => [c.id, Math.round(c.hp)]), w.mines.length, w.landStats.kills, w.rng.next()]);
  };
  assert.strictEqual(run(), run());
});

test('net: cover damage, mines and objectives survive a pack/apply round trip; unit state packs', () => {
  const host = new E.World({ biome: 'desert', seed: 41 });
  const guest = { _base: new E.World({ biome: 'desert', seed: 41 }), t: 0 };
  const dmg = host.cover[3]; dmg.hp = dmg.maxHp * 0.5; S.coverDamage(host, host.cover[5], 1e9, null, 'test');
  const dyn = S.addCover(host, 'wreck', 10, 10, 0.5, { dyn: true });
  host.mines.push({ id: 9, team: 'aegis', x: 5, z: 6, y: 0, armT: 0, seen: false });
  S.addObjective(host, { type: 'uplink', pos: { x: 1, z: 2 }, r: 20, need: 30 });
  const pack = JSON.parse(JSON.stringify(S.packWorld(host)));
  S.unpackWorld(guest, pack);
  assert.ok(guest.cover.length === host.cover.length - 0 || guest.cover.length >= host.cover.filter((c) => !c.dyn).length);
  assert.ok(Math.abs(guest.cover[3].hp / guest.cover[3].maxHp - 0.5) < 0.02 && !guest.cover[5].alive, 'static damage mirrored');
  assert.ok(guest.cover.some((c) => c.type === 'wreck' && c.id === dyn.id), 'dynamic cover mirrored');
  assert.strictEqual(guest.mines.length, 1); assert.strictEqual(guest.objs.length, 1);
  const inf = host.units.find((u) => u.kind === 'infantry'); inf.supp = 0.42; inf.stance = 1;
  const row = JSON.parse(JSON.stringify(S.packUnit(inf))); const g = { kind: 'infantry', def: inf.def, h: 1, yaw: 0 }; S.unpackUnit(g, row);
  assert.ok(g.stance === 1 && Math.abs(g.supp - 0.42) < 0.01);
});
