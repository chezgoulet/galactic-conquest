'use strict';
// AI-vs-AI fleet battle matrix:  node test/space.battles.cjs [seconds]
// Prints stage durations, subsystem losses, ship outcomes and the winner split.
const load = require('../tools/load.cjs');
const E = load(load.files(['core', 'data', 'sim']));
const S = E.SIM, HZ = 30, DT = 1 / HZ, SECS = +process.argv[2] || 720;
const COMPS = [
  [['dreadnought', 'cruiser'], ['carrier', 'cruiser']],
  [['cruiser', 'cruiser'], ['dreadnought', 'carrier']],
  [['carrier', 'cruiser'], ['carrier', 'cruiser']],
  [['dreadnought', 'carrier', 'cruiser'], ['dreadnought', 'cruiser', 'cruiser']],
  [['cruiser'], ['cruiser', 'frigate']],
  [['dreadnought'], ['carrier', 'cruiser']],
  [['cruiser', 'cruiser', 'cruiser'], ['dreadnought', 'carrier']],
  [['carrier', 'dreadnought'], ['cruiser', 'cruiser']],
];
const BIOMES = ['desert', 'jungle', 'tundra', 'desert', 'jungle', 'tundra', 'desert', 'jungle'];
const agg = { win: { aegis: 0, verdant: 0, none: 0 }, out: { destroyed: 0, retreated: 0, captured: 0, boardedWin: 0, boardings: 0 }, sys: {}, stage: [[], [], []], ttl: [], pd: 0, esc: 0, board: {} };
let bad = 0;
COMPS.forEach(([fa, fv], i) => {
  const w = new E.World({ biome: BIOMES[i], seed: 100 + i * 7, fleet: { aegis: fa, verdant: fv } });
  const ev = {}; let nan = false;
  for (let k = 0; k < SECS * HZ && !w.winner; k++) {
    w.tick(DT);
    for (const e of w.drainEvents()) { ev[e.type] = (ev[e.type] || 0) + 1; if (e.type === 'boardingResult') { const k = 'board_' + e.result; agg.board[k] = (agg.board[k] || 0) + 1; } }
    if (k % 30 === 0) for (const u of w.units) if (!Number.isFinite(u.pos.x + u.pos.y + u.pos.z + u.hp)) { nan = true; bad++; }
  }
  const rep = [].concat(w.fleetReport.aegis, w.fleetReport.verdant);
  const st = { destroyed: 0, retreated: 0, captured: 0 }; for (const r of rep) if (st[r.status] !== undefined) st[r.status]++;
  for (const k in st) agg.out[k] += st[k];
  agg.out.boardings += ev.boardingStart || 0; agg.out.boardedWin += ev.shipCaptured || 0;
  for (const l of w.spaceLog || []) agg.sys[l.sys] = (agg.sys[l.sys] || 0) + 1;
  const first = (w.spaceLog || []).slice(0, 3).map(l => l.sys).join(',');
  agg.win[w.winner || 'none']++;
  agg.pd += (ev.pdIntercept || 0) + (ev.pdKill || 0); agg.esc += ev.escortRequest || 0;
  const times = ['aegis', 'verdant'].map(t => w.space[t].log.map(l => `${l.stage}@${Math.round(l.t)}`).join('>')).join(' | ');
  for (const t of E.TEAMS) { const lg = w.space[t].log; for (let j = 0; j < lg.length - 1; j++) agg.stage[lg[j].stage - 1].push(lg[j + 1].t - lg[j].t); }
  agg.ttl.push(w.t);
  console.log(`#${i} ${fa.join('+')} v ${fv.join('+')}  t=${Math.round(w.t)}s winner=${w.winner || '-'}  destroyed=${st.destroyed} retreated=${st.retreated} captured=${st.captured} boardings=${ev.boardingStart || 0}  firstSys=[${first}]  stages ${times}  nan=${nan}`);
});
const avg = (a) => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
console.log('winner split', JSON.stringify(agg.win));
console.log('ship outcomes', JSON.stringify(agg.out));
console.log('subsystems destroyed (all battles)', JSON.stringify(agg.sys));
console.log('mean stage duration s (I, II, III):', agg.stage.map(avg).join(', '), ' n=', agg.stage.map(a => a.length).join(','));
console.log('match time s: mean', avg(agg.ttl), 'min', Math.round(Math.min(...agg.ttl)), 'max', Math.round(Math.max(...agg.ttl)));
console.log('boarding results', JSON.stringify(agg.board));
console.log('pd events', agg.pd, 'escort requests', agg.esc, 'NaN frames', bad);
if (bad > 0 || (agg.win.none || 0) > 0) { console.error('FAIL: space battle sanity gate'); process.exitCode = 1; }
