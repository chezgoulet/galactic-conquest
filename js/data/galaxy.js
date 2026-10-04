// The galactic campaign. Ten worlds joined by hyperlanes; each faction starts
// with a home system and two colonies, with four unclaimed worlds between them.
// The war is turn-based at the strategic layer and real-time on the ground:
//   your turn    pick a world adjacent to your territory and assault it
//   enemy turn   the AI expands into a free world or assaults one of yours
//                (defend it in person, or auto-resolve)
// Every world you hold pays credits each turn and grants a planetary perk to
// all your battles. Credits buy permanent fleet upgrades. Take the enemy home
// system to win; lose yours and the war is over. Pure + serializable.
(function (E) {
  'use strict';

  const PERKS = {
    reserves: { name: 'Deep Reserves', desc: '+40 reinforcements in every battle' },
    elite:    { name: 'Veteran Legions', desc: 'Infantry +20% health' },
    armor:    { name: 'Foundries', desc: 'An extra hover tank and tougher armor' },
    airwing:  { name: 'Sky Harbor', desc: '+2 starfighters in your wing' },
    orbital:  { name: 'Orbital Batteries', desc: 'Orbital strikes recharge 40% faster' },
    escort:   { name: 'Shipyards', desc: 'An escort cruiser joins your flagship' },
    hull:     { name: 'Hull Plating', desc: 'Capital ships +25% hull' },
    trade:    { name: 'Refineries', desc: '+60 credits per turn' },
  };
  const BIOME_PERK = { tundra: 'reserves', desert: 'armor', jungle: 'elite', urban: 'escort', volcanic: 'orbital', ocean: 'airwing', cratered: 'hull', gas: 'trade' };
  const UPGRADES = {
    fleet:     { name: 'Flagship Class', levels: ['Cruiser', 'Carrier', 'Dreadnought'], cost: [0, 350, 700], desc: 'A heavier flagship: more guns, more hull, more fighters.' },
    logistics: { name: 'Logistics', levels: ['Standard', 'Extended', 'Deep', 'Total War'], cost: [0, 200, 400, 650], desc: '+12% reinforcements per level.' },
  };
  const NAMES = { tundra: ['Kethara', 'Hael'], desert: ['Sarruun', 'Qadim'], jungle: ['Veyra', 'Ysmae'], urban: ['Necropolis', 'Caldera Prime'], volcanic: ['Pyrrhus', 'Ashen Reach'], ocean: ['Maelstrom', 'Thalassa'], cratered: ['Vesta Minor', 'Korrin'], gas: ['Oblivion', 'Umbra'] };
  // template: positions (0..1) and hyperlanes
  const POS = [[0.07, 0.5], [0.24, 0.24], [0.26, 0.74], [0.41, 0.5], [0.5, 0.14], [0.55, 0.86], [0.63, 0.48], [0.76, 0.25], [0.78, 0.74], [0.93, 0.5]];
  const LINKS = [[0, 1], [0, 2], [1, 3], [2, 3], [1, 4], [2, 5], [3, 4], [3, 5], [3, 6], [4, 7], [5, 8], [6, 7], [6, 8], [4, 6], [7, 9], [8, 9]];

  function newCampaign(opts) {
    opts = opts || {};
    const seed = opts.seed !== undefined ? opts.seed >>> 0 : 1;
    const r = E.RNG(seed);
    const pf = opts.playerFaction || 'aegis', ef = E.opponent(pf);
    const homeBiome = { aegis: 'urban', verdant: 'jungle' };
    const pool = r.shuffle(['tundra', 'desert', 'jungle', 'urban', 'volcanic', 'ocean', 'cratered', 'gas']);
    const used = {};
    const mk = (i, biome, owner, home) => {
      used[biome] = (used[biome] || 0);
      const name = home ? (home === 'aegis' ? 'Aegis Prime' : 'Verdance') : NAMES[biome][used[biome]++ % 2];
      return { id: i, name, biome, x: POS[i][0], y: POS[i][1] + (home ? 0 : r.f(-0.04, 0.04)), owner, home: home || null, value: home ? 120 : 50 + r.i(4) * 10, perk: home ? null : BIOME_PERK[biome], seed: r.i(1e9) };
    };
    const planets = [];
    for (let i = 0; i < 10; i++) {
      if (i === 0) planets.push(mk(0, homeBiome[pf], pf, pf));
      else if (i === 9) planets.push(mk(9, homeBiome[ef], ef, ef));
      else planets.push(mk(i, pool[(i - 1) % pool.length], i <= 2 ? pf : i >= 7 ? ef : null));
    }
    return { v: 2, seed, playerFaction: pf, enemyFaction: ef, difficulty: opts.difficulty || 'normal', planets, links: LINKS,
      credits: { [pf]: 150, [ef]: 150 }, upgrades: { [pf]: { fleet: 0, logistics: 0 }, [ef]: { fleet: 0, logistics: 0 } },
      turn: 1, pending: null, victory: null, battles: 0, wins: 0, log: [] };
  }

  const neighbors = (c, id) => c.links.filter(l => l[0] === id || l[1] === id).map(l => (l[0] === id ? l[1] : l[0]));
  function attackable(c, f) {
    f = f || c.playerFaction; const out = [];
    for (const p of c.planets) if (p.owner !== f && neighbors(c, p.id).some(n => c.planets[n].owner === f)) out.push(p.id);
    return out;
  }
  function perks(c, f) { const o = {}; for (const p of c.planets) if (p.owner === f && p.perk) o[p.perk] = true; return o; }
  function income(c, f) { let s = 0; for (const p of c.planets) if (p.owner === f) s += p.value + (p.perk === 'trade' ? 60 : 0); return s; }
  function owned(c, f) { return c.planets.filter(p => p.owner === f).length; }
  function fleetScale(c, f) { return 1 + (c.upgrades[f].fleet || 0) * 0.4; }
  function bonusFor(c, f) { const b = perks(c, f); b.ticketMul = 1 + (c.upgrades[f].logistics || 0) * 0.12; return b; }

  // Options for the battle over a planet. defending = the enemy is the attacker.
  function matchOptions(c, id, defending) {
    const p = c.planets[id], pf = c.playerFaction, ef = c.enemyFaction;
    const garrison = !p.owner;                        // unclaimed worlds are held by a light enemy garrison
    return {
      biome: p.biome, seed: (p.seed + c.turn * 7919) >>> 0, human: pf, difficulty: c.difficulty,
      fleetScale: fleetScale(c, pf), enemyScale: garrison ? 0.85 : fleetScale(c, ef) + (p.home === ef ? 0.4 : 0),
      bonus: { [pf]: bonusFor(c, pf), [ef]: garrison ? { ticketMul: 0.85 } : bonusFor(c, ef) },
      system: p.name, planet: id, defending: !!defending,
    };
  }

  function checkVictory(c) {
    const ph = c.planets.find(p => p.home === c.playerFaction), eh = c.planets.find(p => p.home === c.enemyFaction);
    if (eh.owner === c.playerFaction) c.victory = c.playerFaction; else if (ph.owner === c.enemyFaction) c.victory = c.enemyFaction;
    return c.victory;
  }
  // Record a battle the player fought. Returns a summary for the UI.
  function applyBattle(c, id, won, score, defending) {
    const p = c.planets[id], pf = c.playerFaction, ef = c.enemyFaction;
    c.battles++; if (won) c.wins++;
    const reward = Math.round((won ? 120 : 40) + (score || 0) / 25);
    c.credits[pf] += reward;
    if (defending) { if (!won) p.owner = ef; c.pending = null; } else if (won) p.owner = pf;
    c.log.unshift({ turn: c.turn, text: defending ? (won ? `Held ${p.name}` : `Lost ${p.name}`) : (won ? `Captured ${p.name}` : `Repelled at ${p.name}`), good: won });
    checkVictory(c);
    return { reward, planet: p.name, won, defending: !!defending, victory: c.victory };
  }
  function autoResolve(c, id) {
    const pf = c.playerFaction, ef = c.enemyFaction, r = E.RNG((c.seed ^ (c.turn * 2654435761) ^ id) >>> 0);
    const odds = E.clamp(0.5 + (fleetScale(c, pf) - fleetScale(c, ef)) * 0.35 + (owned(c, pf) - owned(c, ef)) * 0.03, 0.15, 0.85);
    return applyBattle(c, id, r.next() < odds, 0, true);
  }

  // The enemy's strategic move. Sets c.pending when it assaults one of your worlds.
  function enemyTurn(c) {
    if (c.victory) return { type: 'none' };
    const pf = c.playerFaction, ef = c.enemyFaction, r = E.RNG((c.seed ^ (c.turn * 40503)) >>> 0);
    c.credits[pf] += income(c, pf); c.credits[ef] += income(c, ef);
    // spend
    for (const k of ['fleet', 'logistics']) { const U = UPGRADES[k], lv = c.upgrades[ef][k]; if (lv < U.levels.length - 1 && c.credits[ef] >= U.cost[lv + 1] * (c.difficulty === 'hard' ? 0.8 : c.difficulty === 'easy' ? 1.5 : 1.1)) { c.credits[ef] -= U.cost[lv + 1]; c.upgrades[ef][k]++; } }
    c.turn++;
    const targets = attackable(c, ef), free = targets.filter(id => !c.planets[id].owner), mine = targets.filter(id => c.planets[id].owner === pf);
    const aggro = c.difficulty === 'hard' ? 0.75 : c.difficulty === 'easy' ? 0.35 : 0.55;
    if (mine.length && (r.next() < aggro || !free.length)) {
      // prefer colonies; only strike the home system when it is the last thing in reach
      const soft = mine.filter(id => !c.planets[id].home), id = r.pick(soft.length ? soft : mine);
      c.pending = { planet: id };
      c.log.unshift({ turn: c.turn, text: `${E.faction(ef).short} fleet assaults ${c.planets[id].name}`, good: false });
      return { type: 'attack', planet: id };
    }
    if (free.length) { const id = r.pick(free); c.planets[id].owner = ef; c.log.unshift({ turn: c.turn, text: `${E.faction(ef).short} occupies ${c.planets[id].name}`, good: false }); return { type: 'expand', planet: id }; }
    return { type: 'none' };
  }
  function buy(c, key) {
    const f = c.playerFaction, U = UPGRADES[key], lv = c.upgrades[f][key];
    if (!U || lv >= U.levels.length - 1 || c.credits[f] < U.cost[lv + 1]) return false;
    c.credits[f] -= U.cost[lv + 1]; c.upgrades[f][key]++; return true;
  }
  function quickBattle(opts) {
    opts = opts || {};
    return { biome: opts.biome || 'desert', human: opts.human || 'aegis', seed: opts.seed !== undefined ? opts.seed : 1, fleetScale: opts.fleetScale || 1, enemyScale: opts.enemyScale || 1, difficulty: opts.difficulty || 'normal' };
  }

  // Career ranks from lifetime score.
  const RANKS = [[0, 'Recruit'], [1500, 'Trooper'], [5000, 'Sergeant'], [12000, 'Lieutenant'], [25000, 'Captain'], [45000, 'Major'], [75000, 'Colonel'], [120000, 'Commodore'], [200000, 'Admiral'], [350000, 'Grand Admiral']];
  function rank(xp) { let i = 0; while (i < RANKS.length - 1 && xp >= RANKS[i + 1][0]) i++; const next = RANKS[i + 1]; return { index: i, name: RANKS[i][1], next: next ? next[0] : null, prog: next ? (xp - RANKS[i][0]) / (next[0] - RANKS[i][0]) : 1 }; }

  E.Campaign = { newCampaign, neighbors, attackable, perks, income, owned, fleetScale, bonusFor, matchOptions, applyBattle, autoResolve, enemyTurn, buy, quickBattle, rank, PERKS, UPGRADES, RANKS };
})(window.E = window.E || {});
