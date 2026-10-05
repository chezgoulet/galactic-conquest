'use strict';
// AI-vs-AI land battle report:  node test/land.battle.cjs [maxSeconds] [seedsPerBiome]
// Plays full matches across biomes/seeds and prints length, winners, kills by class and
// vehicle, cover usage and sanity checks (NaN positions, thrown errors).
const load = require('../tools/load.cjs');
const E = load(load.files(['core', 'data', 'sim']));
const HZ = 30, DT = 1 / HZ;
const MAXS = +process.argv[2] || 900, N = +process.argv[3] || 3;
const BIOMES = (process.argv[4] || 'desert,jungle,tundra,urban').split(',');

const tot = { kills: {}, deaths: {}, vehKilledBy: {}, wins: { aegis: 0, verdant: 0, none: 0 }, secs: [], cover: { broken: 0, hits: 0, inCoverPct: [], fromCoverPct: [] }, nan: 0, errors: 0, vaults: 0, rams: 0, cripples: 0, mines: 0, repairs: 0, supp: 0, minesLaid: 0 };
const add = (a, b) => { for (const k in b) a[k] = (a[k] || 0) + b[k]; };
const rows = [];
for (const biome of BIOMES) for (let s = 0; s < N; s++) {
  const seed = 100 + s * 37 + biome.length;
  let w, err = null;
  try {
    w = new E.World({ biome, seed });
    for (let i = 0; i < HZ * MAXS && !w.winner; i++) {
      w.tick(DT); w.events.length = 0;
      if (i % 30 === 0) for (const u of w.units) if (!(isFinite(u.pos.x) && isFinite(u.pos.y) && isFinite(u.pos.z))) { tot.nan++; throw new Error('NaN position ' + u.kind + ' ' + u.type); }
    }
  } catch (e) { err = e; tot.errors++; console.log('ERROR', biome, seed, e.stack.split('\n').slice(0, 4).join(' | ')); }
  if (!w) continue;
  const L = w.landStats;
  add(tot.kills, L.kills); add(tot.deaths, L.deaths); add(tot.vehKilledBy, L.vehKilledBy);
  tot.wins[w.winner || 'none']++; tot.secs.push(w.t);
  tot.cover.broken += L.coverBroken; tot.cover.hits += L.coverHits;
  tot.cover.inCoverPct.push(L.coverTicks / Math.max(1, L.infTicks)); tot.cover.fromCoverPct.push(L.shotsFromCover / Math.max(1, L.shots));
  tot.vaults += L.vaults; tot.rams += L.rams; tot.cripples += L.cripples; tot.mines += L.mineHits; tot.repairs += L.repairs; tot.supp += L.suppressions; tot.minesLaid += (L.minesLaid || 0);
  rows.push(`${biome.padEnd(7)} seed ${String(seed).padStart(4)} ${err ? 'ERR' : (w.winner || 'none').padEnd(8)} ${w.t.toFixed(0).padStart(4)}s tickets ${w.teams.aegis.tickets}/${w.teams.verdant.tickets} cps ${w.teams.aegis.cps}-${w.teams.verdant.cps} cover ${w.cover.filter(c => c.alive).length}/${w.cover.length} broken ${L.coverBroken}`);
}
console.log(rows.join('\n'));
const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
console.log('matches', tot.secs.length, 'avg length', avg(tot.secs).toFixed(0) + 's', 'min', Math.min(...tot.secs).toFixed(0), 'max', Math.max(...tot.secs).toFixed(0));
console.log('winners', JSON.stringify(tot.wins));
const sorted = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ':' + v).join(' ');
console.log('kills by', sorted(tot.kills));
console.log('deaths of', sorted(tot.deaths));
console.log('vehicles killed by', sorted(tot.vehKilledBy));
console.log('cover: hits', tot.cover.hits, 'broken', tot.cover.broken, 'bots in cover', (avg(tot.cover.inCoverPct) * 100).toFixed(1) + '%', 'shots from cover', (avg(tot.cover.fromCoverPct) * 100).toFixed(1) + '%');
console.log('vaults', tot.vaults, 'rams', tot.rams, 'cripples', tot.cripples, 'mines laid', tot.minesLaid, 'mine hits', tot.mines, 'repair ticks', tot.repairs, 'suppress(lvl2)', tot.supp);
console.log('NaN positions', tot.nan, 'errors', tot.errors);
if (tot.nan > 0 || tot.errors > 0 || (tot.wins.none || 0) > 0) { console.error('FAIL: land battle sanity gate'); process.exitCode = 1; }
