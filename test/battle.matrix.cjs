'use strict';
// Whole-battle balance report: AI vs AI across biomes and seeds with all three
// domains running together. Not part of `npm test`.
//   node test/battle.matrix.cjs [maxSeconds] [seedsPerBiome] [biome,biome,...]
const load = require('../tools/load.cjs');
const E = load(load.files(['core', 'data', 'sim'])), S = E.SIM;
const MAX = +process.argv[2] || 1500, N = +process.argv[3] || 2, BIOMES = (process.argv[4] || 'desert,jungle,tundra').split(',');
const HZ = 30, DT = 1 / HZ, tot = { wins: {}, len: [], ev: {}, kills: {}, bad: 0, ms: 0 };
const bump = (o, k, n) => { o[k] = (o[k] || 0) + (n === undefined ? 1 : n); };
const WATCH = /^(offensive|neutral|capture|shipDestroyed|shipRetreated|shipCaptured|stageChange|sysDestroyed|boardingStart|boardingResult|airDrop|troopsLost|airAccepted|ion|strikeWarn|strikeBlocked|structureDown|coverBreak|crash|objDone|mineBlast|chargeBlast|pdKill)$/;
for (const biome of BIOMES) for (let s = 1; s <= N; s++) {
  const w = new E.World({ biome, seed: s * 17 + biome.length, human: 'aegis' }), ev = {}, t0 = Date.now();
  let i = 0;
  for (; i < MAX * HZ && !w.winner; i++) {
    w.tick(DT);
    for (const e of w.drainEvents()) {
      if (WATCH.test(e.type)) { bump(ev, e.type + (e.type === 'boardingResult' ? ':' + e.result : '')); bump(tot.ev, e.type + (e.type === 'boardingResult' ? ':' + e.result : '')); }
      if (e.type === 'death') { const k = w.umap.get(e.by); bump(tot.kills, (k ? k.kind === 'infantry' || k.kind === 'capital' ? k.kind : k.type : e.wk === 'crash' ? 'crash' : 'other') + '>' + e.kind); }
    }
    if (i % 300 === 0) for (const u of w.units) if (!Number.isFinite(u.pos.x + u.pos.y + u.pos.z + u.hp)) tot.bad++;
  }
  tot.ms += Date.now() - t0;
  const T = w.teams; bump(tot.wins, w.winner || 'none'); tot.len.push(Math.round(w.t));
  console.log(`${biome}/${s}: ${w.winner || 'NO RESULT'} at ${Math.round(w.t)}s  tickets ${T.aegis.tickets}/${T.verdant.tickets}  posts ${T.aegis.cps}/${T.verdant.cps}  ${Object.entries(ev).map(([k, v]) => k + ' ' + v).join(', ')}`);
}
const byVictim = {};
for (const k in tot.kills) { const [a, v] = k.split('>'); (byVictim[v] = byVictim[v] || {})[a] = tot.kills[k]; }
console.log('\nwinners', JSON.stringify(tot.wins), ' length', tot.len.join(','), ' bad values', tot.bad, ' sim speed', Math.round(tot.len.reduce((a, b) => a + b, 0) / (tot.ms / 1000)) + 'x realtime');
console.log('events', JSON.stringify(tot.ev));
for (const v in byVictim) console.log('killed ' + v + ' by:', JSON.stringify(byVictim[v]));
