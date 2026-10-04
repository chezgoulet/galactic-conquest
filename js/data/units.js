// The roster. Pure data: what each unit is, how it fights, how big it is.
// Rendering and simulation both read from here so the numbers and the visuals
// always agree. Distances are meters, speeds m/s, rates shots/s.
(function (E) {
  'use strict';

  // Armor classes: inf (flesh + plate), light (skiffs, fighters), heavy (tanks,
  // turrets), cap (capital hulls). Each weapon lists a damage multiplier per
  // class; anything unlisted is 1.
  E.WEAPONS = {
    // ── infantry ──
    blaster:  { name: 'DL-7 Blaster',     kind: 'bolt', dmg: 20, rate: 5.5, speed: 300, range: 240, spread: 0.012, heat: 0.085, vs: { light: 0.5, heavy: 0.12, cap: 0.01 }, sfx: 'rifle' },
    repeater: { name: 'Rotary Repeater',  kind: 'bolt', dmg: 13, rate: 10,  speed: 280, range: 200, spread: 0.03,  heat: 0.045, vs: { light: 0.6, heavy: 0.15, cap: 0.01 }, sfx: 'rifle' },
    longrifle:{ name: 'Lance Rifle',      kind: 'bolt', dmg: 95, rate: 0.9, speed: 620, range: 650, spread: 0.0015, heat: 0.42, scale: 1.7, vs: { light: 0.6, heavy: 0.15, cap: 0.01 }, sfx: 'lance' },
    carbine:  { name: 'Field Carbine',    kind: 'bolt', dmg: 15, rate: 7,   speed: 280, range: 170, spread: 0.022, heat: 0.06, vs: { light: 0.5, heavy: 0.12, cap: 0.01 }, sfx: 'rifle' },
    rocket:   { name: 'HX Launcher',      kind: 'rocket', dmg: 260, rate: 0.45, speed: 95, range: 420, spread: 0.004, splash: 8, heat: 0, seek: 1.4, vs: { inf: 0.55, light: 1.3, heavy: 1.6, cap: 0.5 }, sfx: 'missile' },
    grenade:  { name: 'Frag Charge',      kind: 'grenade', dmg: 150, speed: 27, grav: 19, fuse: 2.0, splash: 9, cd: 6, vs: { heavy: 0.6, cap: 0.05 }, sfx: 'launch' },
    medburst: { name: 'Mender Pulse',     kind: 'heal', heal: 70, radius: 14, cd: 9, sfx: 'shield' },
    // ── vehicles ──
    skiffgun: { name: 'Twin Repeaters',   kind: 'bolt', dmg: 17, rate: 9,   speed: 340, range: 320, spread: 0.02, heat: 0.04, scale: 1.2, vs: { heavy: 0.3, cap: 0.02 }, sfx: 'pulse' },
    cannon:   { name: 'Siege Cannon',     kind: 'shell', dmg: 280, rate: 0.6, speed: 210, range: 520, spread: 0.006, splash: 9, heat: 0, grav: 6, vs: { inf: 0.8, cap: 0.4 }, sfx: 'cannon' },
    coax:     { name: 'Coaxial Repeater', kind: 'bolt', dmg: 12, rate: 9,   speed: 320, range: 260, spread: 0.025, heat: 0.03, vs: { light: 0.6, heavy: 0.15, cap: 0.01 }, sfx: 'rifle' },
    // ── air ──
    laser:    { name: 'Wing Lasers',      kind: 'bolt', dmg: 24, rate: 9,   speed: 560, range: 720, spread: 0.008, heat: 0.035, scale: 1.6, vs: { heavy: 0.45, cap: 0.22 }, sfx: 'lance' },
    missile:  { name: 'Hunter Missile',   kind: 'missile', dmg: 280, speed: 210, range: 900, seek: 2.6, splash: 9, cd: 5, vs: { inf: 0.6, cap: 1.5 }, sfx: 'missile' },
    bomb:     { name: 'Plasma Bomb',      kind: 'bomb', dmg: 420, speed: 0, grav: 32, splash: 24, cd: 1.1, vs: { cap: 1.6, heavy: 1.2 }, sfx: 'launch' },
    // ── emplacements ──
    turret:   { name: 'Defense Battery',  kind: 'bolt', dmg: 34, rate: 3.2, speed: 420, range: 420, spread: 0.012, heat: 0, scale: 1.5, vs: { cap: 0.1 }, sfx: 'pulse' },
    // ── capital ──
    turbo:    { name: 'Main Battery',     kind: 'turbo', dmg: 250, rate: 0.5, speed: 460, range: 1900, spread: 0.008, splash: 12, scale: 4, vs: { cap: 0.1 }, sfx: 'capital' },
    broadside:{ name: 'Broadside',        kind: 'turbo', dmg: 62, rate: 2.2, speed: 460, range: 1500, spread: 0.014, splash: 5, scale: 2.4, vs: { cap: 0.05 }, sfx: 'pulse' },
    flak:     { name: 'Point Defense',    kind: 'bolt', dmg: 11, rate: 10,  speed: 520, range: 420, spread: 0.035, scale: 1.2, vs: { cap: 0.05 }, sfx: 'pd' },
    torpedo:  { name: 'Capital Torpedo',  kind: 'missile', dmg: 380, speed: 150, range: 2200, seek: 1.2, splash: 16, cd: 7, scale: 2.4, vs: { cap: 0.35 }, sfx: 'missile' },
    orbital:  { name: 'Orbital Strike',   kind: 'orbital', dmg: 520, splash: 26, cd: 40, shots: 7, vs: { cap: 0 }, sfx: 'capital' },
  };

  // Infantry classes — what the player (and every bot) deploys as.
  E.INFANTRY = {
    trooper: { name: 'Trooper',  hp: 110, speed: 6.4, sprint: 10.2, r: 0.55, h: 1.85, weapon: 'blaster',   alt: 'grenade',  armor: 'inf', cost: 1,
               desc: 'Line infantry. Accurate blaster and a frag charge. Takes ground and holds it.' },
    heavy:   { name: 'Heavy',    hp: 170, speed: 5.4, sprint: 8.2,  r: 0.62, h: 1.95, weapon: 'repeater',  alt: 'rocket',   armor: 'inf', cost: 1,
               desc: 'Rotary repeater and a guided launcher. The answer to armor and aircraft.' },
    sniper:  { name: 'Marksman', hp: 85,  speed: 6.6, sprint: 10.6, r: 0.5,  h: 1.8,  weapon: 'longrifle', alt: 'grenade',  armor: 'inf', cost: 1, zoom: 3.2,
               desc: 'Lance rifle that kills at any range. Fragile; keep distance.' },
    medic:   { name: 'Mender',   hp: 100, speed: 6.8, sprint: 10.8, r: 0.52, h: 1.8,  weapon: 'carbine',   alt: 'medburst', armor: 'inf', cost: 1,
               desc: 'Carbine and a healing pulse. Passive aura mends nearby allies.' },
  };

  E.VEHICLES = {
    skiff: { name: 'Skiff',     hp: 420,  shield: 160, speed: 34, accel: 26, turn: 2.4, r: 3.2, h: 2.4, hover: 1.1, weapon: 'skiffgun', alt: null,   armor: 'light', cost: 2,
             desc: 'Fast hover scout. Twin repeaters, thin armor.' },
    tank:  { name: 'Bulwark',   hp: 1500, shield: 400, speed: 17, accel: 10, turn: 1.3, r: 4.6, h: 3.4, hover: 0.8, weapon: 'cannon',   alt: 'coax', armor: 'heavy', cost: 3,
             desc: 'Hover tank. Siege cannon with splash, coaxial repeater.' },
  };

  E.FIGHTERS = {
    interceptor: { name: 'Lancer', hp: 260, shield: 120, speed: 115, boost: 175, minSpeed: 55, turn: 1.9, r: 4.2, h: 2.4, weapon: 'laser', alt: 'missile', armor: 'light', cost: 2,
                   desc: 'Air-superiority fighter. Wing lasers and hunter missiles.' },
    bomber:      { name: 'Mauler', hp: 420, shield: 160, speed: 90,  boost: 135, minSpeed: 45, turn: 1.3, r: 5.2, h: 3.0, weapon: 'laser', alt: 'bomb',    armor: 'light', cost: 2,
                   desc: 'Strike bomber. Plasma bombs crack armor and capital hulls.' },
  };

  E.CAPITALS = {
    cruiser:     { name: 'Cruiser',     hp: 16000, shield: 5000,  speed: 16, turn: 0.07, r: 110, h: 34, len: 300, bays: 4,  main: 2, side: 3, pd: 3, armor: 'cap',
                   desc: 'Fast escort. Hits hard and gets out before the return fire.' },
    carrier:     { name: 'Carrier',     hp: 22000, shield: 7000,  speed: 13, turn: 0.06, r: 135, h: 40, len: 370, bays: 8,  main: 2, side: 3, pd: 4, armor: 'cap',
                   desc: 'Fleet wing. Carries the largest fighter group in the sector.' },
    dreadnought: { name: 'Dreadnought', hp: 32000, shield: 10000, speed: 11, turn: 0.05, r: 160, h: 48, len: 440, bays: 6,  main: 4, side: 5, pd: 5, armor: 'cap',
                   desc: 'The centerpiece of a fleet. Endless broadside.' },
  };

  E.TURRETS = {
    battery: { name: 'Defense Battery', hp: 900, shield: 0, r: 2.6, h: 3.6, weapon: 'turret', armor: 'heavy', turn: 2.2 },
  };

  E.unitDef = (kind, type) => {
    const T = kind === 'infantry' ? E.INFANTRY : kind === 'vehicle' ? E.VEHICLES : kind === 'fighter' ? E.FIGHTERS : kind === 'capital' ? E.CAPITALS : E.TURRETS;
    return T[type] || T[Object.keys(T)[0]];
  };
  E.unitName = (kind, type) => (E.unitDef(kind, type) || {}).name || type;
  E.KINDS = ['infantry', 'vehicle', 'fighter', 'capital', 'turret'];

  // Per-faction doctrine multipliers: the Concord is heavier, the Pact is
  // faster and more numerous in the air.
  E.DOCTRINE = {
    aegis:   { infHp: 1.08, infSpeed: 0.98, vehHp: 1.15, capHp: 1.1, capDmg: 1.04, fighters: 3, fighterHp: 1.1, fighterSpeed: 0.96 },
    verdant: { infHp: 1.0, infSpeed: 1.06, vehHp: 0.95, capHp: 1.0, capDmg: 1.0, fighters: 4, fighterHp: 0.92, fighterSpeed: 1.08 },
  };

  // A battle's order of battle for one side at fleetScale 1.
  E.FORCE = {
    infantry: 16,                 // bots kept alive on the field (reinforced from tickets)
    mix: [['trooper', 5], ['heavy', 2], ['sniper', 1.5], ['medic', 1.5]],
    vehicles: { skiff: 1, tank: 1 },
    tickets: 260,
    capital: 'cruiser',
  };

  E.CP_NAMES = ['Alpha', 'Bravo', 'Citadel', 'Delta', 'Echo'];
})(window.E = window.E || {});
