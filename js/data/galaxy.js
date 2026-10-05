// The galactic campaign. Ten worlds joined by hyperlanes; each faction starts
// with a home system and two colonies, with four unclaimed worlds between them.
// The war is turn-based at the strategic layer and real-time on the ground.
//
// What you command
//   FLEETS are pieces on the map. A fleet is its capital ships (space), its
//   fighter wing (air) and the army it carries (land) — the same three forces
//   you then fight with in the battle. Damage and losses carry over.
//   Fleets redeploy freely inside your connected territory and may strike one
//   jump beyond it each turn: ASSAULT a world (a full battle) or, where no
//   enemy fleet holds the orbit, BLOCKADE it (no income for its owner, and the
//   garrison starves a level per turn until the world falls).
// What you spend
//   CREDITS (worlds pay them) raise armies, garrisons and upgrades.
//   FUEL (gas giants and volcanic worlds refine it) builds and moves ships.
//   Only SUPPLIED worlds — connected to your home system through your own
//   territory and not blockaded — pay out or grant their planetary perk.
// What you can do instead of fighting
//   COVERT OPS: recon a world, sabotage its defences before an assault, or
//   incite a revolt in an enemy colony.
//
// Take the enemy home system to win; lose yours and the war is over.
// Pure + serializable: the whole campaign is one plain object.
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
  // what a world is good for beyond its perk
  const TRAITS = {
    shipyard: { name: 'Shipyard', desc: 'Capital ships can be laid down here.' },
    refinery: { name: 'Refinery', desc: 'Produces fuel for the fleet.' },
    fortress: { name: 'Fortress World', desc: 'Its garrison digs in one level deeper.' },
  };
  const BIOME_TRAIT = { urban: 'shipyard', cratered: 'shipyard', gas: 'refinery', volcanic: 'refinery', tundra: 'fortress', jungle: 'fortress' };
  const BIOME_FUEL = { gas: 60, volcanic: 35, ocean: 20 };
  const UPGRADES = {
    fleet:     { name: 'Flagship Class', levels: ['Cruiser', 'Carrier', 'Dreadnought'], cost: [0, 350, 700], desc: 'A heavier flagship: more guns, more hull, more fighters.' },
    logistics: { name: 'Logistics', levels: ['Standard', 'Extended', 'Deep', 'Total War'], cost: [0, 200, 400, 650], desc: '+12% reinforcements per level.' },
    airwing:   { name: 'Flight Decks', levels: ['Standard', 'Expanded', 'Carrier Doctrine'], cost: [0, 180, 360], desc: '+1 starfighter in every wing per level.' },
    intel:     { name: 'Intelligence', levels: ['Listening Posts', 'Spy Network', 'Shadow Bureau'], cost: [0, 160, 320], desc: 'Covert operations cost 25% less per level.' },
  };
  // power = weight in the strategic odds; upkeep = fuel per turn
  const SHIPS = {
    frigate:     { name: 'Frigate',     credits: 110, fuel: 20,  power: 0.45, upkeep: 2 },
    cruiser:     { name: 'Cruiser',     credits: 220, fuel: 40,  power: 1,   upkeep: 5 },
    carrier:     { name: 'Carrier',     credits: 320, fuel: 60,  power: 1.4, upkeep: 8 },
    dreadnought: { name: 'Dreadnought', credits: 520, fuel: 110, power: 2.2, upkeep: 12 },
  };
  const BUILD = {
    army:     { name: 'Raise a legion',     credits: 120, fuel: 0,  desc: 'More troops and reinforcements for the fleet\'s landings.' },
    wing:     { name: 'Commission a squadron', credits: 90, fuel: 20, desc: 'One more starfighter in the fleet\'s wing.' },
    garrison: { name: 'Fortify',            credits: 100, fuel: 0,  desc: 'A deeper garrison, an orbital picket and ground defences.' },
    repair:   { name: 'Refit',              credits: 60,  fuel: 10, desc: 'Restore every ship in the fleet to full strength.' },
  };
  const OPS = {
    recon:    { name: 'Reconnaissance', credits: 60,  desc: 'Reveal the fleets and garrison at a world for three turns.' },
    sabotage: { name: 'Sabotage',       credits: 140, desc: 'Cripple a world\'s defences for your next assault this turn or next.' },
    incite:   { name: 'Incite Revolt',  credits: 200, desc: 'Stir an uprising in an enemy colony: its garrison may desert, and an undefended colony breaks away.' },
  };
  const VERSION = 3;                    // saved campaigns from older versions are discarded
  const LIMITS = { fleets: 3, ships: 4, army: 5, wing: 8, garrison: 3 };
  const JUMP_FUEL = 10;                 // per ship, to strike beyond your territory
  const NAMES = { tundra: ['Kethara', 'Hael'], desert: ['Sarruun', 'Qadim'], jungle: ['Veyra', 'Ysmae'], urban: ['Necropolis', 'Caldera Prime'], volcanic: ['Pyrrhus', 'Ashen Reach'], ocean: ['Maelstrom', 'Thalassa'], cratered: ['Vesta Minor', 'Korrin'], gas: ['Oblivion', 'Umbra'] };
  const FLEET_NAMES = { aegis: ['First Fleet', 'Home Fleet', 'Vanguard', 'Bulwark Squadron'], verdant: ['Thorn Fleet', 'The Long Hunt', 'Canopy Wing', 'Rootfire'] };
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
      const trait = home ? 'shipyard' : BIOME_TRAIT[biome] || null;
      return { id: i, name, biome, x: POS[i][0], y: POS[i][1] + (home ? 0 : r.f(-0.04, 0.04)), owner, home: home || null, value: home ? 120 : 50 + r.i(4) * 10, perk: home ? null : BIOME_PERK[biome], seed: r.i(1e9),
        trait, fuel: home ? 40 : BIOME_FUEL[biome] || 10, garrison: home ? 3 : 1 + (trait === 'fortress' ? 1 : 0), blockade: 0, sabotage: 0 };
    };
    const planets = [];
    for (let i = 0; i < 10; i++) {
      if (i === 0) planets.push(mk(0, homeBiome[pf], pf, pf));
      else if (i === 9) planets.push(mk(9, homeBiome[ef], ef, ef));
      else planets.push(mk(i, pool[(i - 1) % pool.length], i <= 2 ? pf : i >= 7 ? ef : null));
    }
    const up = () => ({ fleet: 0, logistics: 0, airwing: 0, intel: 0 });
    const c = { v: VERSION, seed, playerFaction: pf, enemyFaction: ef, difficulty: opts.difficulty || 'normal', planets, links: LINKS,
      credits: { [pf]: 150, [ef]: 150 }, fuel: { [pf]: 100, [ef]: 100 }, upgrades: { [pf]: up(), [ef]: up() },
      fleets: [], nextFleet: 1, intel: { [pf]: {}, [ef]: {} },
      turn: 1, pending: null, engaged: null, victory: null, battles: 0, wins: 0, log: [] };
    addFleet(c, pf, 0, ['cruiser'], 3, 2); addFleet(c, ef, 9, ['cruiser'], 3, 2);
    return c;
  }

  // ── the map ──────────────────────────────────────────────────
  const neighbors = (c, id) => c.links.filter(l => l[0] === id || l[1] === id).map(l => (l[0] === id ? l[1] : l[0]));
  const home = (c, f) => c.planets.find(p => p.home === f);
  function owned(c, f) { return c.planets.filter(p => p.owner === f).length; }
  // worlds connected to `from` through f's own territory
  function territory(c, f, from, open) {
    const seen = new Set();
    if (c.planets[from].owner !== f) return seen;
    const q = [from]; seen.add(from);
    while (q.length) for (const n of neighbors(c, q.pop())) if (!seen.has(n) && c.planets[n].owner === f && (!open || open(c.planets[n]))) { seen.add(n); q.push(n); }
    return seen;
  }
  function blockaded(c, p) { return !!p.owner && c.fleets.some(fl => fl.at === p.id && fl.owner !== p.owner); }
  // supplied = reachable from the home system without crossing a blockaded world
  function supplied(c, f) {
    const h = home(c, f);
    if (!h || h.owner !== f || blockaded(c, h)) return new Set();
    return territory(c, f, h.id, (p) => !blockaded(c, p));
  }
  function perks(c, f) { const o = {}, s = supplied(c, f); for (const p of c.planets) if (p.owner === f && p.perk && s.has(p.id)) o[p.perk] = true; return o; }
  function income(c, f) { let s = 0; const sup = supplied(c, f); for (const p of c.planets) if (p.owner === f && sup.has(p.id)) s += p.value + (p.perk === 'trade' ? 60 : 0); return s; }
  function fuelIncome(c, f) { let s = 0; const sup = supplied(c, f); for (const p of c.planets) if (p.owner === f && sup.has(p.id)) s += p.fuel; return s; }
  function upkeep(c, f) { let s = 0; for (const fl of c.fleets) if (fl.owner === f) for (const sh of fl.ships) s += SHIPS[sh.type].upkeep; return s; }
  function fleetScale(c, f) { return 1 + (c.upgrades[f].fleet || 0) * 0.4; }
  function bonusFor(c, f) { const b = perks(c, f); b.ticketMul = 1 + (c.upgrades[f].logistics || 0) * 0.12; return b; }
  // what f can see: its own worlds, their neighbours, and anything under recon
  function visible(c, f) {
    const s = new Set();
    for (const p of c.planets) if (p.owner === f) { s.add(p.id); for (const n of neighbors(c, p.id)) s.add(n); }
    for (const fl of c.fleets) if (fl.owner === f) s.add(fl.at);
    for (const id in c.intel[f]) if (c.intel[f][id] >= c.turn) s.add(+id);
    return s;
  }

  // ── fleets ───────────────────────────────────────────────────
  function addFleet(c, f, at, ships, wing, army) {
    const n = c.fleets.filter(x => x.owner === f).length, names = FLEET_NAMES[f] || FLEET_NAMES.aegis;
    const fl = { id: c.nextFleet++, owner: f, name: names[n % names.length], at, ships: ships.map(type => ({ type, hp: 1 })), wing, army, moved: false };
    c.fleets.push(fl);
    return fl;
  }
  const fleet = (c, id) => c.fleets.find(fl => fl.id === id) || null;
  const fleetsOf = (c, f) => c.fleets.filter(fl => fl.owner === f);
  const fleetsAt = (c, id, f) => c.fleets.filter(fl => fl.at === id && (!f || fl.owner === f));
  // Where a fleet may go: `free` (its own connected territory) and `targets`
  // (worlds one jump beyond it). A fleet in a foreign orbit can only fall back
  // or press the attack.
  function reach(c, fl) {
    const at = c.planets[fl.at], free = new Set(), targets = new Set();
    if (at.owner === fl.owner) {
      for (const id of territory(c, fl.owner, fl.at)) { free.add(id); for (const n of neighbors(c, id)) if (c.planets[n].owner !== fl.owner) targets.add(n); }
    } else {
      targets.add(fl.at);
      for (const n of neighbors(c, fl.at)) if (c.planets[n].owner === fl.owner) free.add(n);
    }
    return { free, targets };
  }
  function attackable(c, f) {
    f = f || c.playerFaction; const out = new Set();
    for (const fl of fleetsOf(c, f)) if (!fl.moved) for (const id of reach(c, fl).targets) out.add(id);
    return [...out].sort((a, b) => a - b);
  }
  function spacePower(fl) { let s = 0; for (const sh of fl.ships) s += SHIPS[sh.type].power * (0.4 + 0.6 * sh.hp); return s; }
  // the fleet f would send against world id: the strongest one in reach
  function pickFleet(c, f, id) {
    let best = null, bs = -1;
    for (const fl of fleetsOf(c, f)) {
      if (fl.moved || !reach(c, fl).targets.has(id)) continue;
      const s = spacePower(fl) + fl.army * 0.8 + fl.wing * 0.15;
      if (s > bs) { bs = s; best = fl; }
    }
    return best;
  }
  function removeFleet(c, fl) { c.fleets.splice(c.fleets.indexOf(fl), 1); }
  // a beaten fleet falls back to the nearest friendly world, or is lost with all hands
  function retreat(c, fl, from) {
    const outs = neighbors(c, from).filter(n => c.planets[n].owner === fl.owner);
    if (!outs.length) { removeFleet(c, fl); return false; }
    const sup = supplied(c, fl.owner);
    fl.at = outs.find(n => sup.has(n)) !== undefined ? outs.find(n => sup.has(n)) : outs[0];
    return true;
  }
  // a faction that still holds its home system always has something to fight with
  function ensureFleet(c, f) {
    const h = home(c, f);
    if (h && h.owner === f && !fleetsOf(c, f).length) { addFleet(c, f, h.id, ['cruiser'], 2, 1); c.log.unshift({ turn: c.turn, text: `${E.faction(f).short} musters a reserve fleet at ${h.name}`, good: f === c.playerFaction }); }
  }

  // ── battles ──────────────────────────────────────────────────
  const sabotaged = (c, p) => p.sabotage >= c.turn;
  const garrisonOf = (c, p) => Math.max(0, p.garrison - (sabotaged(c, p) ? 1 : 0));
  // Both sides of an assault on world `id` by fleet `fl`, as the three forces.
  function forces(c, fl, id) {
    const p = c.planets[id], def = fleetsAt(c, id, p.owner || '-').filter(x => x !== fl), g = garrisonOf(c, p);
    const dShips = []; for (const d of def) for (const sh of d.ships) dShips.push(sh);
    if (!dShips.length && g > 0) dShips.push({ type: 'cruiser', hp: 1, picket: true });   // the garrison's orbital picket
    const dSpace = dShips.reduce((s, sh) => s + SHIPS[sh.type].power * (0.4 + 0.6 * sh.hp), 0);
    return {
      attacker: { space: spacePower(fl), air: fl.wing + (c.upgrades[fl.owner].airwing || 0), land: fl.army, ships: fl.ships },
      defender: { space: dSpace, air: def.reduce((s, d) => s + d.wing, 0) + (g > 0 ? 2 : 0) + (p.owner ? c.upgrades[p.owner].airwing || 0 : 0), land: g * 1.2 + def.reduce((s, d) => s + d.army, 0) + (p.home ? 1.5 : 0), ships: dShips, fleets: def, garrison: g },
    };
  }
  // The strategic odds of an assault (what auto-resolve rolls against, and what
  // the map shows before you commit).
  function forecast(c, fleetId, id) {
    const fl = fleet(c, fleetId); if (!fl) return null;
    const F = forces(c, fl, id), a = F.attacker, d = F.defender, p = c.planets[id];
    const sup = supplied(c, fl.owner).has(c.planets[fl.at].owner === fl.owner ? fl.at : -1);
    const dsup = !p.owner || supplied(c, p.owner).has(id);
    const A = (a.space * 1.0 + a.air * 0.18 + a.land * 0.8) * (sup ? 1 : 0.8), D = (d.space * 1.0 + d.air * 0.18 + d.land * 0.8) * (dsup ? 1 : 0.8) + 0.3;
    return { odds: E.clamp(A / (A + D), 0.08, 0.92), attacker: a, defender: d, supplied: sup, defenderSupplied: dsup, sabotaged: sabotaged(c, p) };
  }

  // Options for the battle over a world. defending = the enemy is the attacker
  // (c.pending). Records the engagement so applyBattle knows which fleet fought.
  function matchOptions(c, id, defending, fleetId) {
    const p = c.planets[id], pf = c.playerFaction, ef = c.enemyFaction, af = defending ? ef : pf, df = defending ? pf : ef;
    const fl = (fleetId && fleet(c, fleetId)) || (defending && c.pending && fleet(c, c.pending.fleet)) || pickFleet(c, af, id);
    const o = { biome: p.biome, seed: (p.seed + c.turn * 7919) >>> 0, human: pf, difficulty: c.difficulty, system: p.name, planet: id, defending: !!defending };
    const bonus = { [pf]: bonusFor(c, pf), [ef]: p.owner ? bonusFor(c, ef) : { ticketMul: 0.85 } };
    if (!fl) {   // no fleet on record (a raid by forces unknown): fight it at upgrade strength
      c.engaged = { planet: id, fleet: 0, defending: !!defending };
      return Object.assign(o, { fleetScale: fleetScale(c, pf), enemyScale: !p.owner ? 0.85 : fleetScale(c, ef) + (p.home === ef ? 0.4 : 0), bonus });
    }
    const F = forecast(c, fl.id, id), a = F.attacker, d = F.defender;
    const scale = (land, f) => E.clamp(0.7 + land * 0.2 + (c.upgrades[f].fleet || 0) * 0.15, 0.7, 2.4);
    const aS = scale(a.land, af), dS = scale(d.land, df);
    if (!F.supplied) bonus[af].ticketMul *= 0.8;
    if (!F.defenderSupplied) bonus[df].ticketMul *= 0.8;
    bonus[af].wing = a.air; bonus[df].wing = d.air;
    bonus[df].fort = d.garrison; if (F.sabotaged) bonus[df].sabotaged = true;
    c.engaged = { planet: id, fleet: fl.id, defending: !!defending };
    return Object.assign(o, {
      fleetScale: defending ? dS : aS, enemyScale: defending ? aS : dS, bonus, attacker: af, fleetId: fl.id, odds: F.odds,
      fleet: { [af]: a.ships.map(s => s.type), [df]: d.ships.map(s => s.type) },
      fleetHp: { [af]: a.ships.map(s => s.hp), [df]: d.ships.map(s => s.hp) },
    });
  }

  function checkVictory(c) {
    const ph = home(c, c.playerFaction), eh = home(c, c.enemyFaction);
    if (eh.owner === c.playerFaction) c.victory = c.playerFaction; else if (ph.owner === c.enemyFaction) c.victory = c.enemyFaction;
    return c.victory;
  }
  // wear a fleet down after a battle; report = [{ hp (0..1), lost }] per ship, in order, when the battle was fought
  function attrit(fl, won, report) {
    fl.ships = fl.ships.filter((sh, i) => {
      const r = report && report[i];
      sh.hp = r ? (r.lost ? 0 : E.clamp01(r.hp)) : sh.hp - (won ? 0.12 : 0.35);
      return sh.hp > 0.05;
    });
    if (!won) { fl.army = Math.max(0, fl.army - 1); fl.wing = Math.max(1, fl.wing - 1); }
  }
  // Record a battle. `won` is from the player's side. report (optional) carries
  // the surviving ships from the battle itself: { [faction]: [{ hp, lost }] }.
  function applyBattle(c, id, won, score, defending, report) {
    const p = c.planets[id], pf = c.playerFaction, ef = c.enemyFaction, af = defending ? ef : pf, df = E.opponent(af), aWon = defending ? !won : !!won;
    const eng = c.engaged && c.engaged.planet === id ? c.engaged : null;
    const fl = (eng && fleet(c, eng.fleet)) || (defending && c.pending && fleet(c, c.pending.fleet)) || pickFleet(c, af, id);
    const defs = fleetsAt(c, id, p.owner || '-').filter(x => x !== fl);
    c.battles++; if (won) c.wins++;
    const reward = Math.round((won ? 120 : 40) + (score || 0) / 25);
    c.credits[pf] += reward;
    if (fl) { attrit(fl, aWon, report && report[af]); fl.moved = true; }
    let k = 0;
    for (const d of defs) { const n = d.ships.length; attrit(d, !aWon, report && report[df] ? report[df].slice(k, k + n) : null); k += n; }
    if (aWon) {
      p.owner = af; p.garrison = 1; p.blockade = 0; p.sabotage = 0;
      for (const d of defs) if (d.ships.length) retreat(c, d, id);
      if (fl && fl.ships.length) fl.at = id;
    } else if (fl && fl.ships.length && fl.at === id) retreat(c, fl, id);   // a broken blockade
    for (const x of c.fleets.slice()) if (!x.ships.length) removeFleet(c, x);
    if (defending) c.pending = null;
    c.engaged = null;
    c.log.unshift({ turn: c.turn, text: defending ? (won ? `Held ${p.name}` : `Lost ${p.name}`) : (won ? `Captured ${p.name}` : `Repelled at ${p.name}`), good: !!won });
    checkVictory(c);
    ensureFleet(c, pf); ensureFleet(c, ef);
    return { reward, planet: p.name, won: !!won, defending: !!defending, victory: c.victory };
  }
  // What a finished battle (a World) did to each side's ships, in fleet order,
  // in the shape applyBattle takes. Ships that withdrew survive with their damage.
  function battleReport(w) {
    const out = {};
    for (const f in (w.fleetReport || {})) out[f] = w.fleetReport[f].map(s => ({ hp: s.hullFrac, lost: s.status === 'destroyed' || s.status === 'captured' }));
    return out;
  }
  // Settle a battle without fighting it, at the strategic odds.
  function autoResolve(c, id, defending) {
    defending = defending === undefined ? true : defending;
    const pf = c.playerFaction, ef = c.enemyFaction, r = E.RNG((c.seed ^ (c.turn * 2654435761) ^ id) >>> 0);
    const fl = (defending && c.pending && fleet(c, c.pending.fleet)) || pickFleet(c, defending ? ef : pf, id);
    let odds;   // of the player winning
    if (fl) { const o = forecast(c, fl.id, id).odds; odds = defending ? 1 - o : o; c.engaged = { planet: id, fleet: fl.id, defending }; }
    else odds = E.clamp(0.5 + (fleetScale(c, pf) - fleetScale(c, ef)) * 0.35 + (owned(c, pf) - owned(c, ef)) * 0.03, 0.15, 0.85);
    return applyBattle(c, id, r.next() < odds, 0, defending);
  }

  // ── orders ───────────────────────────────────────────────────
  // Move a fleet. mode: 'assault' (default) or 'blockade' for a world beyond
  // your territory. Returns { type: 'moved' | 'blockade' | 'captured' | 'battle', options } or { type: 'none', reason }.
  function moveFleet(c, fleetId, to, mode) {
    const fl = fleet(c, fleetId), no = (reason) => ({ type: 'none', reason });
    if (!fl || !c.planets[to]) return no('No such fleet or world');
    const R = reach(c, fl), p = c.planets[to];
    if (R.free.has(to)) { fl.at = to; return { type: 'moved' }; }
    if (!R.targets.has(to)) return no('Out of reach: fleets strike one jump beyond your territory');
    if (fl.moved) return no('That fleet has already fought this turn');
    if (fl.at !== to) {
      const cost = fl.ships.length * JUMP_FUEL;
      if (c.fuel[fl.owner] < cost) return no('Not enough fuel');
      c.fuel[fl.owner] -= cost;
    }
    const F = forces(c, fl, to);
    if (mode === 'blockade') {
      if (F.defender.fleets.length) return no('An enemy fleet holds the orbit: it must be beaten first');
      if (!p.owner) return no('Unclaimed worlds cannot be blockaded');
      fl.at = to; fl.moved = true;
      c.log.unshift({ turn: c.turn, text: `${fl.name} blockades ${p.name}`, good: fl.owner === c.playerFaction });
      return { type: 'blockade' };
    }
    if (!F.defender.fleets.length && F.defender.garrison === 0 && !p.home) {   // nobody left to fight
      p.owner = fl.owner; p.garrison = 1; p.blockade = 0; fl.at = to; fl.moved = true;
      c.log.unshift({ turn: c.turn, text: `${p.name} surrenders to ${fl.name}`, good: fl.owner === c.playerFaction });
      checkVictory(c);
      return { type: 'captured' };
    }
    if (fl.army <= 0) return no('That fleet carries no army: it can only blockade');
    return { type: 'battle', options: matchOptions(c, to, fl.owner !== c.playerFaction, fl.id) };
  }

  function pay(c, f, cost) {
    if (c.credits[f] < (cost.credits || 0) || c.fuel[f] < (cost.fuel || 0)) return false;
    c.credits[f] -= cost.credits || 0; c.fuel[f] -= cost.fuel || 0; return true;
  }
  // Build at a supplied world: a ship type (needs a shipyard), 'army' / 'wing' /
  // 'repair' (need a fleet in orbit) or 'garrison'. Returns { ok, reason }.
  function build(c, what, planetId, f) {
    f = f || c.playerFaction;
    const p = c.planets[planetId], no = (reason) => ({ ok: false, reason });
    if (!p || p.owner !== f) return no('Not your world');
    if (!supplied(c, f).has(planetId)) return no('That world is cut off from supply');
    const here = fleetsAt(c, planetId, f);
    if (SHIPS[what]) {
      if (p.trait !== 'shipyard') return no('No shipyard here');
      let fl = here.find(x => x.ships.length < LIMITS.ships);
      if (!fl && fleetsOf(c, f).length >= LIMITS.fleets) return no('Every fleet here is at full strength');
      if (!pay(c, f, SHIPS[what])) return no('Not enough credits or fuel');
      if (fl) fl.ships.push({ type: what, hp: 1 }); else fl = addFleet(c, f, planetId, [what], 2, 1);
      return { ok: true, fleet: fl.id };
    }
    const B = BUILD[what]; if (!B) return no('Unknown order');
    if (what === 'garrison') {
      if (p.garrison >= LIMITS.garrison + (p.trait === 'fortress' ? 1 : 0)) return no('Fully fortified');
      if (!pay(c, f, B)) return no('Not enough credits');
      p.garrison++; return { ok: true };
    }
    const fl = what === 'repair' ? here.find(x => x.ships.some(s => s.hp < 1)) : here.find(x => x[what] < LIMITS[what]);
    if (!fl) return no(here.length ? 'Nothing to do here' : 'No fleet in orbit');
    if (!pay(c, f, B)) return no('Not enough credits or fuel');
    if (what === 'repair') for (const s of fl.ships) s.hp = 1; else fl[what]++;
    return { ok: true, fleet: fl.id };
  }
  function buy(c, key, f) {
    f = f || c.playerFaction;
    const U = UPGRADES[key]; if (!U) return false;
    const lv = c.upgrades[f][key] || 0;
    if (lv >= U.levels.length - 1 || c.credits[f] < U.cost[lv + 1]) return false;
    c.credits[f] -= U.cost[lv + 1]; c.upgrades[f][key] = lv + 1; return true;
  }
  const opCost = (c, kind, f) => Math.round(OPS[kind].credits * (1 - 0.25 * (c.upgrades[f || c.playerFaction].intel || 0)));
  // A covert operation against a world f can see. Returns { ok, reason, result }.
  function op(c, kind, planetId, f) {
    f = f || c.playerFaction;
    const O = OPS[kind], p = c.planets[planetId], no = (reason) => ({ ok: false, reason });
    if (!O || !p) return no('Unknown operation');
    if (p.owner === f) return no('That is your own world');
    const near = neighbors(c, planetId).some(n => c.planets[n].owner === f) || fleetsAt(c, planetId, f).length > 0;
    if (kind !== 'recon' && !near) return no('Agents can only reach worlds bordering your territory');
    if (kind === 'incite' && (!p.owner || p.home)) return no('Only an enemy colony can be turned');
    const cost = opCost(c, kind, f);
    if (c.credits[f] < cost) return no('Not enough credits');
    c.credits[f] -= cost;
    const good = f === c.playerFaction;
    if (kind === 'recon') { c.intel[f][planetId] = c.turn + 3; return { ok: true, result: 'revealed' }; }
    if (kind === 'sabotage') { p.sabotage = c.turn + 1; c.intel[f][planetId] = Math.max(c.intel[f][planetId] || 0, c.turn + 1); c.log.unshift({ turn: c.turn, text: `Saboteurs strike ${p.name}`, good }); return { ok: true, result: 'sabotaged' }; }
    const r = E.RNG((c.seed ^ (c.turn * 97003) ^ (planetId * 7919) ^ 0x51ab) >>> 0);
    if (r.next() < 0.55 + 0.12 * (c.upgrades[f].intel || 0)) {
      p.garrison = Math.max(0, p.garrison - 1);
      if (p.garrison === 0 && !fleetsAt(c, planetId, p.owner).length) { c.log.unshift({ turn: c.turn, text: `${p.name} rises and breaks away`, good }); p.owner = null; p.garrison = 1; return { ok: true, result: 'revolt' }; }
      c.log.unshift({ turn: c.turn, text: `Unrest thins the garrison of ${p.name}`, good });
      return { ok: true, result: 'unrest' };
    }
    return { ok: true, result: 'failed' };
  }

  // ── the turn ─────────────────────────────────────────────────
  function economy(c) {
    for (const f of [c.playerFaction, c.enemyFaction]) {
      c.credits[f] += income(c, f);
      c.fuel[f] = Math.max(0, c.fuel[f] + fuelIncome(c, f) - upkeep(c, f));
    }
    // blockades starve the garrison; a world with none left falls to troops in orbit
    for (const p of c.planets) {
      const b = p.owner ? c.fleets.find(fl => fl.at === p.id && fl.owner !== p.owner) : null;
      if (!b) { p.blockade = 0; continue; }
      p.blockade++; p.garrison = Math.max(0, p.garrison - 1);
      if (p.garrison === 0 && b.army > 0 && !p.home && !fleetsAt(c, p.id, p.owner).length) {
        c.log.unshift({ turn: c.turn, text: `${p.name} falls to the blockade`, good: b.owner === c.playerFaction });
        p.owner = b.owner; p.garrison = 1; p.blockade = 0;
      }
    }
    for (const fl of c.fleets) fl.moved = false;
  }
  function enemySpend(c, r) {
    const ef = c.enemyFaction, pf = c.playerFaction, k = c.difficulty === 'hard' ? 0.8 : c.difficulty === 'easy' ? 1.5 : 1.1;
    // covert ops on the player's frontier before committing fleets: incite a soft
    // colony, sabotage the likeliest target, and recon what it cannot see
    const frontier = c.planets.filter(p => p.owner === pf && (neighbors(c, p.id).some(n => c.planets[n].owner === ef) || fleetsAt(c, p.id, ef).length));
    if (frontier.length) {
      const soft = frontier.find(p => !p.home && p.garrison <= 1 && c.credits[ef] >= opCost(c, 'incite', ef));
      if (soft && r.next() < 0.5) op(c, 'incite', soft.id, ef);
      else { const t = frontier.find(p => !p.home) || frontier[0]; if (c.credits[ef] >= opCost(c, 'sabotage', ef) && r.next() < 0.6) op(c, 'sabotage', t.id, ef); }
      const blind = frontier.filter(p => !(c.intel[ef][p.id] > c.turn));
      if (blind.length && c.credits[ef] >= opCost(c, 'recon', ef) && r.next() < 0.5) op(c, 'recon', blind[0].id, ef);
    }
    for (const key of ['fleet', 'logistics', 'airwing']) { const U = UPGRADES[key], lv = c.upgrades[ef][key]; if (lv < U.levels.length - 1 && c.credits[ef] >= U.cost[lv + 1] * k) { c.credits[ef] -= U.cost[lv + 1]; c.upgrades[ef][key]++; } }
    const sup = supplied(c, ef);
    // dig in where the player can reach, then grow the fleet
    for (const p of c.planets) if (p.owner === ef && sup.has(p.id) && p.garrison < 2 && neighbors(c, p.id).some(n => c.planets[n].owner === pf) && c.credits[ef] >= BUILD.garrison.credits * k) build(c, 'garrison', p.id, ef);
    for (const fl of fleetsOf(c, ef)) {
      if (!sup.has(fl.at)) continue;
      if (fl.ships.some(s => s.hp < 0.6) && c.credits[ef] >= BUILD.repair.credits * k) build(c, 'repair', fl.at, ef);
      if (fl.army < 3 && c.credits[ef] >= BUILD.army.credits * k) build(c, 'army', fl.at, ef);
    }
    const yard = c.planets.find(p => p.owner === ef && p.trait === 'shipyard' && sup.has(p.id));
    if (yard) {
      for (const fl of fleetsOf(c, ef)) if (reach(c, fl).free.has(yard.id) && fl.ships.length < LIMITS.ships && r.next() < 0.5) { fl.at = yard.id; break; }
      const type = c.credits[ef] >= SHIPS.dreadnought.credits * k * 1.3 ? 'dreadnought' : c.credits[ef] >= SHIPS.carrier.credits * k * 1.3 ? 'carrier' : 'cruiser';
      if (c.credits[ef] >= SHIPS[type].credits * k && c.fuel[ef] >= SHIPS[type].fuel) build(c, type, yard.id, ef);
    }
  }
  // The enemy's strategic move: income for both sides, then the AI spends,
  // redeploys and strikes. Sets c.pending when it assaults one of your worlds.
  function enemyTurn(c) {
    if (c.victory) return { type: 'none' };
    const pf = c.playerFaction, ef = c.enemyFaction, r = E.RNG((c.seed ^ (c.turn * 40503)) >>> 0);
    economy(c);
    enemySpend(c, r);
    c.turn++;
    ensureFleet(c, ef);
    const need = c.difficulty === 'hard' ? 0.36 : c.difficulty === 'easy' ? 0.56 : 0.46;
    const aggro = c.difficulty === 'hard' ? 0.75 : c.difficulty === 'easy' ? 0.35 : 0.55;
    let out = { type: 'none' };
    for (const fl of fleetsOf(c, ef).sort((a, b) => spacePower(b) - spacePower(a))) {
      if (c.pending) break;
      // a blockading fleet stays on station
      if (c.planets[fl.at].owner === pf) { fl.moved = true; continue; }
      const T = [...reach(c, fl).targets].filter(id => c.fuel[ef] >= fl.ships.length * JUMP_FUEL);
      const free = T.filter(id => !c.planets[id].owner), mine = T.filter(id => c.planets[id].owner === pf);
      if (mine.length && fl.army > 0 && (r.next() < aggro || !free.length)) {
        // prefer colonies; only strike the home system when it is the last thing in reach
        const soft = mine.filter(id => !c.planets[id].home), pool = soft.length ? soft : mine;
        const id = pool.map(x => [x, forecast(c, fl.id, x).odds]).sort((a, b) => b[1] - a[1])[0];
        if (id[1] >= need || !free.length) {
          const res = moveFleet(c, fl.id, id[0], 'assault');
          if (res.type === 'battle') {
            c.pending = { planet: id[0], fleet: fl.id };
            c.log.unshift({ turn: c.turn, text: `${E.faction(ef).short} fleet assaults ${c.planets[id[0]].name}`, good: false });
            out = { type: 'attack', planet: id[0], fleet: fl.id, odds: 1 - id[1] };
            break;
          }
          if (res.type === 'captured') { out = { type: 'expand', planet: id[0] }; continue; }
        }
      }
      if (free.length && fl.army > 0) {
        // unclaimed worlds have garrisons too: the landing is fought at the strategic odds
        const best = free.map(x => [x, forecast(c, fl.id, x).odds]).sort((a, b) => b[1] - a[1])[0], id = best[0], p = c.planets[id];
        if (best[1] >= need) {
          c.fuel[ef] -= fl.ships.length * JUMP_FUEL;
          const won = r.next() < best[1];
          attrit(fl, won, null); fl.moved = true;
          if (won) { p.owner = ef; p.garrison = 1; if (fl.ships.length) fl.at = id; }
          c.log.unshift({ turn: c.turn, text: won ? `${E.faction(ef).short} occupies ${p.name}` : `${E.faction(ef).short} landing thrown back at ${p.name}`, good: !won });
          if (!fl.ships.length) { removeFleet(c, fl); ensureFleet(c, ef); }
          if (won && out.type === 'none') out = { type: 'expand', planet: id };
          continue;
        }
      }
      // nothing worth striking: a troopless fleet blockades, the rest hold the frontier
      const block = mine.filter(id => !c.planets[id].home && !fleetsAt(c, id, pf).length);
      if (block.length && fl.army === 0 && moveFleet(c, fl.id, r.pick(block), 'blockade').type === 'blockade') { if (out.type === 'none') out = { type: 'blockade', planet: fl.at }; continue; }
      const front = [...reach(c, fl).free].filter(id => neighbors(c, id).some(n => c.planets[n].owner === pf));
      if (front.length) fl.at = r.pick(front);
    }
    checkVictory(c);
    return out;
  }

  // Everything the map screen shows for one faction, in one read.
  function summary(c, f) {
    f = f || c.playerFaction;
    return { credits: c.credits[f], fuel: c.fuel[f], income: income(c, f), fuelIncome: fuelIncome(c, f), upkeep: upkeep(c, f),
      worlds: owned(c, f), supplied: [...supplied(c, f)], visible: [...visible(c, f)], perks: Object.keys(perks(c, f)), fleets: fleetsOf(c, f).length };
  }
  function quickBattle(opts) {
    opts = opts || {};
    return { biome: opts.biome || 'desert', human: opts.human || 'aegis', seed: opts.seed !== undefined ? opts.seed : 1, fleetScale: opts.fleetScale || 1, enemyScale: opts.enemyScale || 1, difficulty: opts.difficulty || 'normal' };
  }

  // Career ranks from lifetime score.
  const RANKS = [[0, 'Recruit'], [1500, 'Trooper'], [5000, 'Sergeant'], [12000, 'Lieutenant'], [25000, 'Captain'], [45000, 'Major'], [75000, 'Colonel'], [120000, 'Commodore'], [200000, 'Admiral'], [350000, 'Grand Admiral']];
  function rank(xp) { let i = 0; while (i < RANKS.length - 1 && xp >= RANKS[i + 1][0]) i++; const next = RANKS[i + 1]; return { index: i, name: RANKS[i][1], next: next ? next[0] : null, prog: next ? (xp - RANKS[i][0]) / (next[0] - RANKS[i][0]) : 1 }; }

  E.Campaign = { newCampaign, neighbors, attackable, perks, income, fuelIncome, upkeep, owned, supplied, visible, blockaded, fleetScale, bonusFor,
    fleet, fleetsOf, fleetsAt, reach, forces, forecast, moveFleet, build, buy, op, opCost,
    matchOptions, applyBattle, battleReport, autoResolve, enemyTurn, endTurn: enemyTurn, summary, quickBattle, rank,
    VERSION, PERKS, TRAITS, UPGRADES, SHIPS, BUILD, OPS, LIMITS, JUMP_FUEL, RANKS };
})(window.E = window.E || {});
