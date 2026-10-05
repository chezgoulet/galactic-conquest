// SPACE roster: capital ships, their batteries and the tuning tables for
// subsystems, shields, power and the staged fleet battle. See units.js for
// armor classes and the shared lookup helpers.
(function (E) {
  'use strict';

  Object.assign(E.WEAPONS = E.WEAPONS || {}, {
    // ── capital ──  (ranges are sized for fleets 1-2 km apart in orbit)
    turbo:    { name: 'Main Battery',     kind: 'turbo', dmg: 300, rate: 0.5, speed: 620, range: 2500, spread: 0.006, splash: 12, scale: 5, vs: { cap: 0.3 }, sfx: 'capital' },
    broadside:{ name: 'Broadside',        kind: 'turbo', dmg: 140, rate: 1.1, speed: 600, range: 1700, spread: 0.01, splash: 5, scale: 2.8, vs: { cap: 0.1 }, sfx: 'pulse' },
    flak:     { name: 'Point Defense',    kind: 'bolt', dmg: 26, rate: 7,  speed: 760, range: 700, spread: 0.012, scale: 1.4, vs: { cap: 0.02 }, sfx: 'pd' },
    torpedo:  { name: 'Capital Torpedo',  kind: 'missile', dmg: 420, speed: 170, range: 2600, seek: 1.4, splash: 16, cd: 8, scale: 2.8, vs: { cap: 0.5 }, sfx: 'missile' },
    orbital:  { name: 'Orbital Strike',   kind: 'orbital', dmg: 520, splash: 26, cd: 40, shots: 7, vs: { cap: 0 }, sfx: 'capital' },
  });

  // role: screen (frigates), line (cruisers), carrier, flagship (dreadnought).
  // len/r/h drive the renderer's hull generator: length, half-width, thickness.
  E.CAPITALS = {
    frigate:     { name: 'Frigate',     role: 'screen',   hp: 6000,  shield: 4500, speed: 34, turn: 0.16,  r: 36,  h: 28, len: 190, bays: 1, wing: 0, crew: 4,  main: 1, side: 2, pd: 3, armor: 'cap',
                   desc: 'Picket and escort. Fast, fragile, and the first thing an attacker must strip away.' },
    cruiser:     { name: 'Cruiser',     role: 'line',     hp: 18000, shield: 15000, speed: 24, turn: 0.085, r: 70,  h: 56, len: 420, bays: 2, wing: 1, crew: 8,  main: 2, side: 3, pd: 4, armor: 'cap',
                   desc: 'Line of battle. Hits hard and manoeuvres for the broadside.' },
    carrier:     { name: 'Carrier',     role: 'carrier',  hp: 24000, shield: 19000, speed: 17, turn: 0.07,  r: 90,  h: 72, len: 620, bays: 8, wing: 1, crew: 10, main: 2, side: 3, pd: 6, armor: 'cap',
                   desc: 'Fleet wing. Carries the largest fighter group in the sector and stays behind the line.' },
    dreadnought: { name: 'Dreadnought', role: 'flagship', hp: 36000, shield: 28000, speed: 15, turn: 0.06,  r: 100, h: 80, len: 780, bays: 6, wing: 1, crew: 14, main: 4, side: 5, pd: 6, armor: 'cap',
                   desc: 'The centerpiece of a fleet. Endless broadside.' },
  };

  // Subsystems, in hull-local fractions: lz of hull length (+ forward), ly of
  // hull thickness h (+ up), r of hull half-width. hp is a share of hull hp.
  // order = the cycle order when a commander picks a subsystem to focus.
  E.SPACE = {
    sys: {
      shield:    { label: 'Shield Generator', hp: 0.10, lz: -0.05, ly: 0.9,  r: 0.55 },
      batteries: { label: 'Main Batteries',   hp: 0.12, lz: 0.16,  ly: 0.8,  r: 0.55 },
      engines:   { label: 'Engines',          hp: 0.12, lz: -0.40, ly: 0,    r: 0.6 },
      hangar:    { label: 'Hangar Bay',       hp: 0.11, lz: 0.27,  ly: -0.3, r: 0.55 },
      bridge:    { label: 'Bridge',           hp: 0.08, lz: -0.30, ly: 0.85, r: 0.45 },
      reactor:   { label: 'Reactor',          hp: 0.10, lz: -0.18, ly: 0,    r: 0.4 },
    },
    order: ['shield', 'batteries', 'engines', 'hangar', 'bridge', 'reactor'],
    arcs: ['fore', 'aft', 'port', 'stbd'],
    arcShare: [0.2, 0.2, 0.3, 0.3],
    sysHpMul: 2.2, sysShare: 0.8, hullShare: 0.45,          // a hit that reaches a subsystem: share it takes / share the hull also takes
    regenDelay: 5, regenRate: 0.06,           // per-arc, seconds without a hit / fraction of arc per second
    power: { balanced: [0.34, 0.33, 0.33], shields: [0.55, 0.25, 0.20], weapons: [0.20, 0.55, 0.25], engines: [0.20, 0.25, 0.55] },
    powerNames: ['balanced', 'shields', 'weapons', 'engines'],
    stageHull: [0.6, 0.8, 1.25],              // hull damage multiplier by the attacker's stage (screens always 1)
    stageSys: [0.5, 1, 1],                    // subsystem damage multiplier by stage
    stageNames: ['Win local space', 'Break the shields', 'Finish the ship'],
    retreatHull: 0.35, retreatHullFlag: 0.22,
    braceTime: 6, braceCd: 30, braceMul: 0.45,
    coreTime: 25,
    boardCrew: 6, boardTime: 95,
  };
})(window.E = window.E || {});
