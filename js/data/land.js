// LAND roster: infantry classes, ground vehicles, emplacements and their
// weapons. Distances are meters, speeds m/s, rates shots/s. See units.js for
// armor classes and the shared lookup helpers.
(function (E) {
  'use strict';

  Object.assign(E.WEAPONS = E.WEAPONS || {}, {
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
    // ── emplacements ──
    turret:   { name: 'Defense Battery',  kind: 'bolt', dmg: 34, rate: 3.2, speed: 420, range: 420, spread: 0.012, heat: 0, scale: 1.5, vs: { cap: 0.1 }, sfx: 'pulse' },
  });

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

  E.TURRETS = {
    battery: { name: 'Defense Battery', hp: 900, shield: 0, r: 2.6, h: 3.6, weapon: 'turret', armor: 'heavy', turn: 2.2 },
  };
})(window.E = window.E || {});
