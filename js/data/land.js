// LAND roster: infantry classes, ground vehicles, emplacements and their
// weapons. Distances are meters, speeds m/s, rates shots/s. See units.js for
// armor classes and the shared lookup helpers.
//
// Extra weapon fields used by the land sim: supp (suppression multiplier of
// the shots passing a victim, default 1), cv (cover damage multiplier).
(function (E) {
  'use strict';

  Object.assign(E.WEAPONS = E.WEAPONS || {}, {
    // ── infantry ──
    blaster:  { name: 'DL-7 Blaster',     kind: 'bolt', dmg: 20, rate: 5.5, speed: 300, range: 240, spread: 0.012, heat: 0.085, vs: { light: 0.5, heavy: 0.12, cap: 0.01 }, sfx: 'rifle' },
    repeater: { name: 'Rotary Repeater',  kind: 'bolt', dmg: 12, rate: 10,  speed: 280, range: 210, spread: 0.03,  heat: 0.04, supp: 2.0, vs: { light: 0.6, heavy: 0.15, cap: 0.01 }, sfx: 'rifle' },
    longrifle:{ name: 'Lance Rifle',      kind: 'bolt', dmg: 95, rate: 0.9, speed: 620, range: 650, spread: 0.0015, heat: 0.42, scale: 1.7, supp: 2.2, vs: { light: 0.6, heavy: 0.15, cap: 0.01 }, sfx: 'lance' },
    carbine:  { name: 'Field Carbine',    kind: 'bolt', dmg: 15, rate: 7,   speed: 280, range: 170, spread: 0.022, heat: 0.06, vs: { light: 0.5, heavy: 0.12, cap: 0.01 }, sfx: 'rifle' },
    engcarbine:{ name: 'Fabricator SMG',  kind: 'bolt', dmg: 14, rate: 7.5, speed: 280, range: 180, spread: 0.024, heat: 0.06, vs: { light: 0.5, heavy: 0.12, cap: 0.01 }, sfx: 'rifle' },
    rocket:   { name: 'HX Launcher',      kind: 'rocket', dmg: 260, rate: 0.45, speed: 95, range: 420, spread: 0.004, splash: 8, heat: 0, seek: 1.4, cd: 5.5, vs: { inf: 0.55, light: 1.3, heavy: 1.6, cap: 0.5 }, sfx: 'missile' },
    grenade:  { name: 'Frag Charge',      kind: 'grenade', dmg: 150, speed: 27, grav: 19, fuse: 2.0, splash: 9, cd: 6, cv: 1.6, vs: { heavy: 0.6, cap: 0.05 }, sfx: 'launch' },
    medburst: { name: 'Mender Pulse',     kind: 'heal', heal: 60, radius: 14, cd: 9, sfx: 'shield' },
    // engineer tools and non-projectile damage sources, handled by the land sim
    mine:     { name: 'Tread Mine',       kind: 'mine', dmg: 560, splash: 7, cd: 7, vs: { inf: 0.4, light: 1.25, heavy: 1.0, cap: 0.05 }, sfx: 'launch' },
    charge:   { name: 'Demolition Charge', kind: 'mine', dmg: 1100, splash: 10, cd: 3, vs: { inf: 0.6, light: 1.2, heavy: 1.0, cap: 0.1 }, sfx: 'launch' },
    ram:      { name: 'Impact',           kind: 'mine', dmg: 0, vs: {} },
    wreck:    { name: 'Wreck Blast',      kind: 'mine', dmg: 0, vs: { heavy: 0.5, cap: 0.05 } },
    // ── vehicles ──
    skiffgun: { name: 'Twin Repeaters',   kind: 'bolt', dmg: 17, rate: 9,   speed: 340, range: 320, spread: 0.02, heat: 0.04, scale: 1.2, vs: { heavy: 0.3, cap: 0.02 }, sfx: 'pulse' },
    cannon:   { name: 'Siege Cannon',     kind: 'shell', dmg: 300, rate: 0.6, speed: 210, range: 520, spread: 0.006, splash: 11, heat: 0, grav: 6, cv: 1.6, vs: { inf: 0.8, cap: 0.4 }, sfx: 'cannon' },
    coax:     { name: 'Coaxial Repeater', kind: 'bolt', dmg: 12, rate: 9,   speed: 320, range: 260, spread: 0.025, heat: 0.03, supp: 1.4, vs: { light: 0.6, heavy: 0.15, cap: 0.01 }, sfx: 'rifle' },
    aaflak:   { name: 'Flak Cannon',      kind: 'bolt', dmg: 16, rate: 7.5, speed: 520, range: 720, spread: 0.02, heat: 0.03, scale: 1.4, supp: 1.2, vs: { inf: 0.35, heavy: 0.15, cap: 0.02 }, sfx: 'pd' },
    aamissile:{ name: 'Skyhook Missile',  kind: 'missile', dmg: 210, rate: 0.2, speed: 250, range: 1200, spread: 0.004, seek: 3.1, splash: 8, cd: 5.5, vs: { inf: 0.3, heavy: 0.3, light: 1.15, cap: 0.3 }, sfx: 'missile' },
    // ── emplacements ──
    turret:   { name: 'Defense Battery',  kind: 'bolt', dmg: 34, rate: 3.2, speed: 420, range: 420, spread: 0.012, heat: 0, scale: 1.5, vs: { cap: 0.1 }, sfx: 'pulse' },
    nestgun:  { name: 'Nest Repeater',    kind: 'bolt', dmg: 11, rate: 11,  speed: 300, range: 250, spread: 0.026, heat: 0, supp: 1.5, vs: { light: 0.6, heavy: 0.15, cap: 0.01 }, sfx: 'rifle' },
    ioncannon:{ name: 'Ion Cannon',       kind: 'ion', dmg: 450, rate: 0.02, speed: 0, range: 4400, cd: 42, shield: 3600, vs: { cap: 1 }, sfx: 'capital' },
    inert:    { name: 'None',             kind: 'bolt', dmg: 0, rate: 0.1, speed: 100, range: 0, vs: {} },
  });

  // Infantry classes — what the player (and every bot) deploys as.
  // Jobs: trooper = all-rounder, heavy = suppression + anti-armor/air,
  // sniper = picks priority targets at range, medic = sustain, engineer = vehicles/fortifications.
  E.INFANTRY = {
    trooper: { name: 'Trooper',  hp: 110, speed: 6.4, sprint: 10.2, r: 0.55, h: 1.85, weapon: 'blaster',   alt: 'grenade',  armor: 'inf', cost: 1,
               desc: 'Line infantry. Accurate blaster and a frag charge. Takes ground and holds it.' },
    heavy:   { name: 'Heavy',    hp: 175, speed: 5.3, sprint: 8.0,  r: 0.62, h: 1.95, weapon: 'repeater',  alt: 'rocket',   armor: 'inf', cost: 1,
               desc: 'Rotary repeater suppresses; the guided launcher breaks armor and aircraft. Slow to turn on a flank.' },
    sniper:  { name: 'Marksman', hp: 85,  speed: 6.6, sprint: 10.6, r: 0.5,  h: 1.8,  weapon: 'longrifle', alt: 'grenade',  armor: 'inf', cost: 1, zoom: 3.2,
               desc: 'Lance rifle that kills at any range. Fragile; hunts heavies, menders and engineers.' },
    medic:   { name: 'Mender',   hp: 100, speed: 6.8, sprint: 10.8, r: 0.52, h: 1.8,  weapon: 'carbine',   alt: 'medburst', armor: 'inf', cost: 1,
               desc: 'Carbine and a healing pulse. Passive aura mends nearby allies.' },
    engineer:{ name: 'Engineer', hp: 105, speed: 6.2, sprint: 9.8,  r: 0.55, h: 1.85, weapon: 'engcarbine', alt: 'mine',    armor: 'inf', cost: 1,
               desc: 'Repairs vehicles and emplacements, raises barricades, lays tread mines and plants charges. Cycle tools with the cycle key.' },
  };

  E.VEHICLES = {
    skiff: { name: 'Skiff',     hp: 420,  shield: 160, speed: 34, accel: 26, brake: 38, grip: 1.7, turn: 2.4, r: 3.2, h: 2.4, hover: 1.1, weapon: 'skiffgun', alt: null,   armor: 'light', cost: 2,
             mass: 1, armorF: { front: 0.85, side: 1.0, rear: 1.25, top: 1.2 }, turret: { arc: 0.75, rate: 3.0, pitchMin: -0.25, pitchMax: 0.6 },
             desc: 'Fast hover scout. Twin repeaters in a fixed forward arc, thin armor, drifts through turns.' },
    tank:  { name: 'Bulwark',   hp: 1500, shield: 400, speed: 17, accel: 10, brake: 18, grip: 3.6, turn: 1.3, r: 4.6, h: 3.4, hover: 0.8, weapon: 'cannon',   alt: 'coax', armor: 'heavy', cost: 3,
             mass: 4, armorF: { front: 0.55, side: 1.0, rear: 1.55, top: 1.3 }, turret: { arc: Math.PI, rate: 1.15, pitchMin: -0.12, pitchMax: 0.5 },
             desc: 'Hover tank. Heavy frontal armor, soft rear. Siege cannon with splash, coaxial repeater, slow turret.' },
    aa:    { name: 'Sentinel',  hp: 520,  shield: 200, speed: 25, accel: 16, brake: 28, grip: 2.4, turn: 1.9, r: 3.4, h: 3.0, hover: 0.9, weapon: 'aaflak', alt: 'aamissile', armor: 'light', cost: 2,
             mass: 1.6, armorF: { front: 0.8, side: 1.0, rear: 1.3, top: 1.15 }, turret: { arc: Math.PI, rate: 2.6, pitchMin: -0.1, pitchMax: 1.45 },
             desc: 'Mobile anti-air platform. Flak and Skyhook seekers; weak against ground attackers.' },
  };

  // Emplacements and structures (kind 'turret').
  E.TURRETS = {
    battery:  { name: 'Defense Battery', hp: 900, shield: 0, r: 2.6, h: 3.6, weapon: 'turret', armor: 'heavy', turn: 2.2 },
    aabattery:{ name: 'AA Battery',      hp: 560, shield: 0, r: 2.8, h: 3.4, weapon: 'aaflak', alt: 'aamissile', armor: 'light', turn: 2.8, aa: true, pitchMax: 1.5,
                desc: 'Anti-air emplacement. Deadly to low, slow aircraft; helpless against infantry.' },
    nest:     { name: 'MG Nest',         hp: 650, shield: 0, r: 2.4, h: 2.2, weapon: 'nestgun', armor: 'light', turn: 3.0, nest: true,
                desc: 'Sandbagged machine-gun nest. Suppresses infantry.' },
    shieldgen:{ name: 'Shield Generator', hp: 1600, shield: 0, r: 3.8, h: 6, weapon: 'inert', armor: 'heavy', turn: 0, structure: true, shieldR: 150,
                desc: 'No weapon. While alive, shields everything within its dome from orbital strikes.' },
    ioncannon:{ name: 'Ion Cannon',      hp: 2800, shield: 0, r: 5.5, h: 9, weapon: 'ioncannon', armor: 'heavy', turn: 0.5, structure: true,
                desc: 'Whoever holds its command post fires it at the nearest enemy capital ship.' },
  };

  // ── cover: destructible geometry. w/d are full width/depth, h height (m) ──
  // hard: shrugs off small arms (bolts x0.25), soft: sandbags/crates/foliage (x0.9)
  // vault: infantry hop over it (h<=1.35); climb: infantry clamber over (h<=2.1)
  // crush: vehicles drive through it and destroy it; solid: vehicles are stopped
  E.COVER = {
    sandbag:  { name: 'Sandbag Wall',  w: [3.4, 5.2], d: 1.0, h: 1.0, hp: 240,  hard: false, vault: true, crush: true,  fort: true },
    barrier:  { name: 'Barricade',     w: [3.2, 4.6], d: 0.6, h: 1.7, hp: 520,  hard: true,  climb: true, solid: true, fort: true },
    crates:   { name: 'Crate Stack',   w: [2.0, 3.0], d: 2.0, h: 1.9, hp: 300,  hard: false, climb: true, crush: true,  fort: true },
    bunker:   { name: 'Bunker Wall',   w: [7, 10],    d: 1.4, h: 2.4, hp: 1300, hard: true,  solid: true, fort: true },
    trap:     { name: 'Tank Trap',     w: [2.6, 3.4], d: 1.2, h: 1.1, hp: 700,  hard: true,  vault: true, solid: true, fort: true },
    rock:     { name: 'Boulder',       w: [2.6, 5.5], d: 2.4, h: 2.0, hp: 1100, hard: true,  climb: true, solid: true, round: true },
    slab:     { name: 'Ice Slab',      w: [2.6, 4.5], d: 1.1, h: 1.5, hp: 380,  hard: false, climb: true, solid: true },
    tree:     { name: 'Tree Trunk',    w: [1.3, 2.0], d: 1.5, h: 4.5, hp: 420,  hard: false, solid: true, round: true },
    cactus:   { name: 'Cactus',        w: [1.0, 1.6], d: 1.2, h: 2.2, hp: 120,  hard: false, crush: true, round: true },
    ruin:     { name: 'Ruined Wall',   w: [4.5, 8],   d: 1.0, h: 2.6, hp: 1000, hard: true,  solid: true },
    ledge:    { name: 'Rubble Ledge',  w: [3.5, 6],   d: 1.6, h: 1.25, hp: 700, hard: true,  vault: true, solid: true },
    tower:    { name: 'Tower Base',    w: [4.5, 6],   d: 4.5, h: 6.0, hp: 1800, hard: true,  solid: true },
    wreck:    { name: 'Wreck',         w: [4, 7],     d: 3.0, h: 1.8, hp: 700,  hard: true,  climb: true, solid: true, dyn: true },
    shield:   { name: 'Deployed Barrier', w: [3.6, 3.6], d: 0.5, h: 1.6, hp: 340, hard: false, climb: true, solid: true, dyn: true },
  };
  // How a biome's `cover` keys turn into natural cover pieces: key -> [[type, weight], ...]
  E.COVER_BIOME = {
    rocks: [['rock', 1], ['ledge', 0.25]], ice: [['slab', 1]], trees: [['tree', 1]], vines: [['tree', 0.4]], cactus: [['cactus', 1]],
    buildings: [['tower', 0.35], ['ruin', 0.9]], ruins: [['ruin', 1], ['ledge', 0.5]], vents: [['rock', 0.6]],
  };

  // ── perks: two tiers per class, one pick per tier (mutually exclusive) ──
  // mul/add edit the unit's modifier sheet `u.m` (see land_perks.js for every key).
  E.PERKS = {
    trooper: {
      t1: [
        { id: 'trooper.stim',   name: 'Stim Pack',    desc: 'Sprint 12% faster, vaults quicker.',        mul: { sprint: 1.12, vault: 0.75 } },
        { id: 'trooper.plate',  name: 'Plate Carrier', desc: '+18 health and 30% less suppression taken.', add: { hp: 18 }, mul: { suppTake: 0.7 } },
      ],
      t2: [
        { id: 'trooper.frag',   name: 'Frag Specialist', desc: 'Frag cooldown -30%, blast +20%.',          mul: { gCd: 0.7, gBlast: 1.2 } },
        { id: 'trooper.overcharge', name: 'Overcharge', desc: '+12% blaster damage, runs hotter.',          mul: { dmg: 1.12, heat: 1.25 } },
      ],
    },
    heavy: {
      t1: [
        { id: 'heavy.suppressor', name: 'Suppressor',  desc: 'Your fire suppresses 60% harder.',         mul: { suppGive: 1.6 } },
        { id: 'heavy.ironclad',   name: 'Ironclad',    desc: '+30 health, 12% damage resistance.',       add: { hp: 30, dr: 0.12 } },
      ],
      t2: [
        { id: 'heavy.tandem',     name: 'Tandem Warhead', desc: 'Launcher reloads 25% faster, +10% damage.', mul: { rCd: 0.75, rDmg: 1.1 } },
        { id: 'heavy.skyhunter',  name: 'Skyhunter',   desc: 'Missiles track harder and hit aircraft +25%.', mul: { seek: 1.8, vsAir: 1.25 } },
      ],
    },
    sniper: {
      t1: [
        { id: 'sniper.steady',    name: 'Steady Breath', desc: 'Far less bloom; fires 10% faster.',       mul: { bloom: 0.4, rate: 1.1 } },
        { id: 'sniper.ghillie',   name: 'Ghillie Wrap',  desc: 'Crouched, you are hard for enemies to spot.', add: { stealth: 0.5 } },
      ],
      t2: [
        { id: 'sniper.piercing',  name: 'Piercing Round', desc: '+12% damage; shots do double damage to cover.', mul: { dmg: 1.12, coverDmg: 2 } },
        { id: 'sniper.cooler',    name: 'Vented Coil',   desc: 'Rifle runs 35% cooler.',                  mul: { heat: 0.65 } },
      ],
    },
    medic: {
      t1: [
        { id: 'medic.triage',     name: 'Triage',       desc: 'Healing pulse restores 45% more.',          mul: { heal: 1.45 } },
        { id: 'medic.aura',       name: 'Wide Field',   desc: 'Healing aura reaches 50% further.',         mul: { aura: 1.5 } },
      ],
      t2: [
        { id: 'medic.bulwark',    name: 'Bulwark Field', desc: 'Allies in your aura take 15% less damage.', add: { auraRes: 0.15 } },
        { id: 'medic.sprinter',   name: 'Field Medic',  desc: '+10% speed and self-regeneration.',         mul: { speed: 1.1 }, add: { regen: 2.5 } },
      ],
    },
    engineer: {
      t1: [
        { id: 'engineer.fabricator', name: 'Fabricator',  desc: 'Barricades have +60% health and deploy 30% faster.', mul: { cover: 1.6, buildCd: 0.7 } },
        { id: 'engineer.minelayer',  name: 'Minelayer',   desc: 'Carry 7 mines (not 4); mines hit 25% harder.',       add: { mines: 3 }, mul: { mineDmg: 1.25 } },
      ],
      t2: [
        { id: 'engineer.welder',     name: 'Master Welder', desc: 'Repairs 50% faster.',                      mul: { repair: 1.5 } },
        { id: 'engineer.sapper',     name: 'Sapper',       desc: 'Charges do +50% damage and fuse 35% faster.', mul: { chargeDmg: 1.5, fuse: 0.65 } },
      ],
    },
  };

  // what bots deploy as (weighted); the lead's E.FORCE.mix is replaced with this at sim load
  E.LAND_MIX = [['trooper', 5], ['heavy', 2.2], ['sniper', 1.3], ['medic', 1.5], ['engineer', 1.6]];

  // tunables for structures and objectives
  E.LAND = {
    shieldR: 150,            // shield generator dome radius (m)
    ionCd: 42, ionFirst: 25, ionShield: 3600, ionHull: 450,
    aaMaxAlt: 900,           // AA batteries ignore aircraft above this height over the ground
    mineArm: 1.6, mineR: 3.4,
  };
})(window.E = window.E || {});
