// AIR roster: fighters, bombers and their weapons. See units.js for armor
// classes and the shared lookup helpers.
(function (E) {
  'use strict';

  Object.assign(E.WEAPONS = E.WEAPONS || {}, {
    // ── air ──
    laser:    { name: 'Wing Lasers',      kind: 'bolt', dmg: 24, rate: 9,   speed: 560, range: 720, spread: 0.008, heat: 0.035, scale: 1.6, vs: { heavy: 0.45, cap: 0.22 }, sfx: 'lance' },
    missile:  { name: 'Hunter Missile',   kind: 'missile', dmg: 280, speed: 210, range: 900, seek: 2.6, splash: 9, cd: 5, vs: { inf: 0.6, cap: 1.5 }, sfx: 'missile' },
    bomb:     { name: 'Plasma Bomb',      kind: 'bomb', dmg: 420, speed: 0, grav: 32, splash: 24, cd: 1.1, vs: { cap: 1.6, heavy: 1.2 }, sfx: 'launch' },
  });

  E.FIGHTERS = {
    interceptor: { name: 'Lancer', hp: 260, shield: 120, speed: 115, boost: 175, minSpeed: 55, turn: 1.9, r: 4.2, h: 2.4, weapon: 'laser', alt: 'missile', armor: 'light', cost: 2,
                   desc: 'Air-superiority fighter. Wing lasers and hunter missiles.' },
    bomber:      { name: 'Mauler', hp: 420, shield: 160, speed: 90,  boost: 135, minSpeed: 45, turn: 1.3, r: 5.2, h: 3.0, weapon: 'laser', alt: 'bomb',    armor: 'light', cost: 2,
                   desc: 'Strike bomber. Plasma bombs crack armor and capital hulls.' },
  };
})(window.E = window.E || {});
