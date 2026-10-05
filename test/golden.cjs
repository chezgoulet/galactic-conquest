'use strict';
// Determinism fingerprint of the sim: runs scripted battles (bots plus a player
// cycling through every unit kind) and hashes the full world state. The hashes
// are stored in test/golden.fixtures.json and asserted here, so an accidental
// change in sim behaviour fails CI.
//
//   node test/golden.cjs                 check against the fixtures
//   GOLDEN_UPDATE=1 node test/golden.cjs  regenerate the fixtures (deliberate changes)
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const load = require('../tools/load.cjs');
const E = load(load.files(['core', 'data', 'sim']));

const HZ = 30, DT = 1 / HZ, KINDS = ['infantry', 'vehicle', 'fighter', 'capital', 'turret'];
const FIXTURES = path.join(__dirname, 'golden.fixtures.json');
const SCENARIOS = [['desert', 7], ['jungle', 99], ['tundra', 3]];

function run(biome, seed, secs) {
  const w = new E.World({ biome, seed, human: 'aegis' });
  w.addPlayer('p1', 'aegis', 'Golden');
  let events = 0;
  for (let i = 0; i < HZ * secs; i++) {
    if (i % (HZ * 8) === 0) {
      const kind = KINDS[(i / (HZ * 8)) % KINDS.length];
      const u = w.units.find(x => x.alive && x.team === 'aegis' && x.kind === kind);
      if (u) w.possess('p1', u.id); else { const home = w.cps.find(c => c.home === 'aegis'); w.release('p1'); w.deploy('p1', 'heavy', home.id); }
    }
    const u = w.unitOf('p1');
    if (u) w.setInput('p1', { mx: 0.3, mz: 1, moveYaw: u.yaw, yaw: u.yaw + 0.15, pitch: u.kind === 'capital' ? -0.6 : 0.04, fire: true, abil: i % 9 === 0, sprint: i % 60 < 20, jump: i % 45 === 0 });
    if (i === HZ * 5) w.order('p1', w.units.filter(x => x.team === 'aegis' && x.kind === 'infantry').slice(0, 4).map(x => x.id), 'attack', { x: 0, z: 0 });
    w.tick(DT);
    events += w.drainEvents().length;
  }
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify([
    w.units.map(u => [u.id, u.kind, u.type, u.team, u.pos.x, u.pos.y, u.pos.z, u.yaw, u.hp, u.shield, u.heat]),
    w.projectiles.map(p => [p.id, p.pos.x, p.pos.y, p.pos.z]),
    w.cps.map(c => [c.owner, c.cap]), Object.values(w.teams).map(T => [T.tickets, T.kills, T.deaths, T.captures]),
    Object.values(w.players).map(p => [p.score, p.kills, p.deaths]), w.winner, events, w.rng.next(),
  ]));
  return h.digest('hex').slice(0, 16);
}

const got = {};
for (const [b, s] of SCENARIOS) got[`${b}/${s}`] = run(b, s, 80);

if (process.env.GOLDEN_UPDATE) {
  fs.writeFileSync(FIXTURES, JSON.stringify(got, null, 2) + '\n');
  console.log('golden fixtures written:', JSON.stringify(got));
  process.exit(0);
}
let want = {};
try { want = JSON.parse(fs.readFileSync(FIXTURES, 'utf8')); } catch { want = {}; }
let bad = 0;
for (const k of Object.keys(got)) {
  const ok = want[k] === got[k];
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${k} ${got[k]}${ok ? '' : ' (expected ' + (want[k] || '<none>') + ')'}`);
}
if (bad) {
  console.error(`\n${bad} fingerprint(s) changed. If this is intentional, run GOLDEN_UPDATE=1 node test/golden.cjs and commit the fixtures.`);
  process.exit(1);
}
