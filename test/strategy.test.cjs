'use strict';
// The strategic layer: fleets as map pieces, supply, blockade, covert ops, the
// enemy's turn, and the hand-off into a real battle.
const { test } = require('node:test');
const assert = require('node:assert');
const load = require('../tools/load.cjs');
const E = load(load.files(['core', 'data', 'sim']));
const C = E.Campaign;
const mk = (seed) => C.newCampaign({ seed: seed || 7, playerFaction: 'aegis' });
const myFleet = (c) => C.fleetsOf(c, 'aegis')[0];

test('each side starts with a fleet at home carrying ships, a wing and an army', () => {
  const c = mk();
  for (const f of ['aegis', 'verdant']) {
    const fl = C.fleetsOf(c, f);
    assert.strictEqual(fl.length, 1);
    assert.ok(fl[0].ships.length >= 1 && fl[0].wing > 0 && fl[0].army > 0);
    assert.strictEqual(c.planets[fl[0].at].home, f);
  }
});

test('fleets redeploy freely inside their territory and strike one jump beyond it', () => {
  const c = mk(), fl = myFleet(c), R = C.reach(c, fl);
  assert.deepStrictEqual([...R.free].sort(), [0, 1, 2]);
  for (const id of R.targets) assert.notStrictEqual(c.planets[id].owner, 'aegis');
  assert.strictEqual(C.moveFleet(c, fl.id, 1).type, 'moved');
  assert.strictEqual(fl.at, 1);
  assert.strictEqual(C.moveFleet(c, fl.id, 9).type, 'none', 'the enemy home is out of reach');
});

test('an assault costs fuel and hands back battle options built from both forces', () => {
  const c = mk(), fl = myFleet(c), id = C.attackable(c)[0], fuel = c.fuel.aegis;
  const res = C.moveFleet(c, fl.id, id);
  assert.strictEqual(res.type, 'battle');
  assert.strictEqual(c.fuel.aegis, fuel - fl.ships.length * C.JUMP_FUEL);
  const o = res.options;
  assert.deepStrictEqual(o.fleet.aegis, fl.ships.map(s => s.type));
  assert.ok(o.odds > 0 && o.odds < 1);
  assert.strictEqual(o.bonus.aegis.wing, fl.wing);
});

test('winning moves the fleet in; losing wears it down and it stays out', () => {
  let c = mk(), fl = myFleet(c), id = C.attackable(c)[0];
  C.moveFleet(c, fl.id, id);
  C.applyBattle(c, id, true, 0, false);
  assert.strictEqual(c.planets[id].owner, 'aegis');
  assert.strictEqual(fl.at, id);
  assert.ok(fl.ships[0].hp < 1, 'even a win costs something');
  assert.ok(fl.moved);

  c = mk(); fl = myFleet(c); id = C.attackable(c)[0];
  const army = fl.army;
  C.moveFleet(c, fl.id, id);
  C.applyBattle(c, id, false, 0, false);
  assert.strictEqual(c.planets[id].owner, null);
  assert.notStrictEqual(fl.at, id);
  assert.strictEqual(fl.army, army - 1);
});

test('the battle report decides which ships survive', () => {
  const c = mk(), fl = myFleet(c);
  fl.ships.push({ type: 'carrier', hp: 1 });
  const id = C.attackable(c)[0];
  C.moveFleet(c, fl.id, id);
  C.applyBattle(c, id, true, 0, false, { aegis: [{ hp: 0.4 }, { lost: true }] });
  assert.strictEqual(fl.ships.length, 1);
  assert.strictEqual(fl.ships[0].hp, 0.4);
});

test('a faction that loses its last fleet musters a reserve at home', () => {
  const c = mk(), fl = myFleet(c), id = C.attackable(c)[0];
  C.moveFleet(c, fl.id, id);
  C.applyBattle(c, id, false, 0, false, { aegis: [{ lost: true }] });
  const left = C.fleetsOf(c, 'aegis');
  assert.strictEqual(left.length, 1);
  assert.strictEqual(left[0].at, 0);
});

test('worlds cut off from the home system pay nothing and lose their perk', () => {
  const c = mk();
  // give aegis a far world with no land bridge to home
  const far = c.planets[6]; far.owner = 'aegis';
  assert.ok(!C.supplied(c, 'aegis').has(6));
  const base = C.income(c, 'aegis');
  c.planets[3].owner = 'aegis';   // now linked through 3
  assert.ok(C.supplied(c, 'aegis').has(6));
  assert.ok(C.income(c, 'aegis') >= base + far.value);
});

test('a blockade stops income and starves the garrison until the world falls', () => {
  const c = mk();
  const target = c.planets[1];            // an aegis colony
  const ef = C.fleetsOf(c, 'verdant')[0];
  c.planets[3].owner = 'verdant'; ef.at = 3; ef.moved = false;
  const before = C.income(c, 'aegis');
  assert.strictEqual(C.moveFleet(c, ef.id, 1, 'blockade').type, 'blockade');
  assert.ok(C.blockaded(c, target));
  assert.ok(C.income(c, 'aegis') < before);
  let turns = 0;
  while (target.owner === 'aegis' && turns++ < 6) { c.pending = null; C.enemyTurn(c); }
  assert.strictEqual(target.owner, 'verdant', 'the starved colony fell');
});

test('building needs supply, a shipyard for ships, and the money', () => {
  const c = mk();
  assert.ok(!C.build(c, 'cruiser', 0).ok, 'cannot afford a cruiser at the start');
  c.credits.aegis = 2000; c.fuel.aegis = 500;
  assert.ok(C.build(c, 'cruiser', 0).ok);
  assert.strictEqual(myFleet(c).ships.length, 2);
  const noYard = c.planets.find(p => p.owner === 'aegis' && p.trait !== 'shipyard');
  if (noYard) assert.ok(!C.build(c, 'cruiser', noYard.id).ok, 'no shipyard there');
  const army = myFleet(c).army;
  assert.ok(C.build(c, 'army', 0).ok);
  assert.strictEqual(myFleet(c).army, army + 1);
  const g = c.planets[1].garrison;
  assert.ok(C.build(c, 'garrison', 1).ok);
  assert.strictEqual(c.planets[1].garrison, g + 1);
  assert.ok(!C.build(c, 'garrison', 9).ok, 'not on an enemy world');
});

test('covert ops: recon reveals, sabotage weakens the next assault', () => {
  const c = mk(); c.credits.aegis = 1000;
  assert.ok(!C.visible(c, 'aegis').has(9));
  assert.ok(C.op(c, 'recon', 9).ok);
  assert.ok(C.visible(c, 'aegis').has(9));
  const fl = myFleet(c), id = C.attackable(c)[0];
  const before = C.forecast(c, fl.id, id).odds;
  assert.ok(C.op(c, 'sabotage', id).ok);
  assert.ok(C.forecast(c, fl.id, id).odds > before, 'sabotage improves the odds');
  assert.ok(!C.op(c, 'incite', 0).ok, 'not against yourself');
});

test('the enemy turn pays both sides, and the AI expands or attacks', () => {
  const c = mk(), cr = c.credits.aegis;
  const seen = new Set();
  for (let i = 0; i < 12 && !c.victory; i++) {
    const r = C.enemyTurn(c);
    seen.add(r.type);
    if (r.type === 'attack') { assert.ok(c.pending && c.planets[c.pending.planet].owner === 'aegis'); C.autoResolve(c, c.pending.planet); }
  }
  assert.ok(c.credits.aegis > cr, 'income arrived');
  assert.ok(seen.has('expand') || seen.has('attack'), 'the AI acted: ' + [...seen]);
  assert.ok(C.owned(c, 'verdant') >= 3 || c.victory, 'the enemy held or grew its territory');
  for (const fl of c.fleets) assert.ok(fl.ships.length > 0 && c.planets[fl.at], 'every fleet is valid');
});

test('whole campaigns played by auto-resolve end, for either side', () => {
  const wins = { aegis: 0, verdant: 0, none: 0 }, turns = [];
  for (let seed = 1; seed <= 12; seed++) {
    const c = C.newCampaign({ seed, playerFaction: 'aegis' });
    for (let t = 0; t < 80 && !c.victory; t++) {
      // a plain, competent player: refit, grow the fleet, strike at good odds
      const fl = myFleet(c);
      if (fl) {
        const sup = [...C.reach(c, fl).free].filter(id => C.supplied(c, 'aegis').has(id));
        const yard = sup.find(id => c.planets[id].trait === 'shipyard');
        if (fl.ships.some(s => s.hp < 0.7) && sup.length) { C.moveFleet(c, fl.id, sup[0]); C.build(c, 'repair', fl.at); }
        if (yard !== undefined && c.credits.aegis > 500) { C.moveFleet(c, fl.id, yard); C.build(c, 'carrier', yard); }
        if (sup.includes(fl.at)) while (fl.army < 4 && C.build(c, 'army', fl.at).ok);
        const T = C.attackable(c).map(id => [id, C.forecast(c, fl.id, id).odds]).sort((a, b) => b[1] - a[1])[0];
        if (T && T[1] > 0.5 && fl.army > 0) { const r = C.moveFleet(c, fl.id, T[0]); if (r.type === 'battle') C.autoResolve(c, T[0], false); }
      }
      const r = C.enemyTurn(c);
      if (r.type === 'attack') C.autoResolve(c, c.pending.planet);
    }
    wins[c.victory || 'none']++; turns.push(c.turn);
  }
  console.log('campaign results', JSON.stringify(wins), 'turns', turns.join(','));
  assert.ok(wins.aegis + wins.verdant >= 6, 'most campaigns reach a verdict: ' + JSON.stringify(wins));
  assert.ok(wins.aegis > 0 && wins.verdant > 0, 'either side can win: ' + JSON.stringify(wins));
});

test('a campaign assault becomes a playable battle with the fleets that were sent', () => {
  const c = mk(), fl = myFleet(c);
  fl.ships.push({ type: 'carrier', hp: 0.5 });
  const res = C.moveFleet(c, fl.id, C.attackable(c)[0]);
  const w = new E.World(res.options);
  const caps = (f) => w.units.filter(u => u.kind === 'capital' && u.team === f);
  assert.deepStrictEqual([...caps('aegis')].map(u => u.type).slice(0, 2), ['cruiser', 'carrier'], 'the fleet\'s own ships come first; the sim may add a frigate screen');
  assert.ok(caps('aegis')[1].hp < caps('aegis')[1].maxHp * 0.6, 'the damaged carrier arrives damaged');
  for (let i = 0; i < 30 * 15; i++) w.tick(1 / 30);
  assert.ok(w.units.every(u => Number.isFinite(u.pos.x + u.pos.y + u.pos.z)));
});

test('a world with no garrison and no fleet has no ships in orbit, and the battle still runs', () => {
  const c = mk(), fl = myFleet(c), id = C.attackable(c)[0];
  c.planets[id].garrison = 0; c.planets[id].home = 'x';   // force a battle rather than a walk-in
  const res = C.moveFleet(c, fl.id, id);
  c.planets[id].home = null;
  assert.strictEqual(res.type, 'battle');
  assert.strictEqual(res.options.fleet.verdant.length, 0);
  const w = new E.World(res.options);
  assert.strictEqual(w.units.filter(u => u.kind === 'capital' && u.team === 'verdant').length, 0);
  for (let i = 0; i < 30 * 20; i++) w.tick(1 / 30);
  assert.ok(w.units.some(u => u.team === 'verdant' && u.kind === 'infantry'), 'the defenders still fight on the ground');
});

test('the battle hands its fleet report back to the campaign in fleet order', () => {
  const c = mk(), fl = myFleet(c);
  fl.ships.push({ type: 'carrier', hp: 1 });
  const id = C.attackable(c)[0], res = C.moveFleet(c, fl.id, id);
  const w = new E.World(res.options);
  for (let i = 0; i < 30 * 30; i++) w.tick(1 / 30);
  const cu = w.units.find(u => u.kind === 'capital' && u.team === 'aegis' && u.type === 'carrier');
  E.SIM.kill(w, cu, { team: 'verdant', uid: 0, owner: null, wk: 'turbo' });
  for (let i = 0; i < 30; i++) w.tick(1 / 30);
  const rep = C.battleReport(w);
  assert.deepStrictEqual([...w.fleetReport.aegis].slice(0, 2).map(s => s.type), ['cruiser', 'carrier']);
  assert.strictEqual(rep.aegis[1].lost, true);
  C.applyBattle(c, id, true, 0, false, rep);
  assert.deepStrictEqual([...fl.ships].map(s => s.type), ['cruiser'], 'the carrier lost in battle is gone from the fleet');
});
