// SPACE roster: capital ships and their batteries. See units.js for armor
// classes and the shared lookup helpers.
(function (E) {
  'use strict';

  Object.assign(E.WEAPONS = E.WEAPONS || {}, {
    // ── capital ──
    turbo:    { name: 'Main Battery',     kind: 'turbo', dmg: 250, rate: 0.5, speed: 460, range: 1900, spread: 0.008, splash: 12, scale: 4, vs: { cap: 0.1 }, sfx: 'capital' },
    broadside:{ name: 'Broadside',        kind: 'turbo', dmg: 62, rate: 2.2, speed: 460, range: 1500, spread: 0.014, splash: 5, scale: 2.4, vs: { cap: 0.05 }, sfx: 'pulse' },
    flak:     { name: 'Point Defense',    kind: 'bolt', dmg: 11, rate: 10,  speed: 520, range: 420, spread: 0.035, scale: 1.2, vs: { cap: 0.05 }, sfx: 'pd' },
    torpedo:  { name: 'Capital Torpedo',  kind: 'missile', dmg: 380, speed: 150, range: 2200, seek: 1.2, splash: 16, cd: 7, scale: 2.4, vs: { cap: 0.35 }, sfx: 'missile' },
    orbital:  { name: 'Orbital Strike',   kind: 'orbital', dmg: 520, splash: 26, cd: 40, shots: 7, vs: { cap: 0 }, sfx: 'capital' },
  });

  E.CAPITALS = {
    cruiser:     { name: 'Cruiser',     hp: 16000, shield: 5000,  speed: 16, turn: 0.07, r: 110, h: 34, len: 300, bays: 4,  main: 2, side: 3, pd: 3, armor: 'cap',
                   desc: 'Fast escort. Hits hard and gets out before the return fire.' },
    carrier:     { name: 'Carrier',     hp: 22000, shield: 7000,  speed: 13, turn: 0.06, r: 135, h: 40, len: 370, bays: 8,  main: 2, side: 3, pd: 4, armor: 'cap',
                   desc: 'Fleet wing. Carries the largest fighter group in the sector.' },
    dreadnought: { name: 'Dreadnought', hp: 32000, shield: 10000, speed: 11, turn: 0.05, r: 160, h: 48, len: 440, bays: 6,  main: 4, side: 5, pd: 5, armor: 'cap',
                   desc: 'The centerpiece of a fleet. Endless broadside.' },
  };
})(window.E = window.E || {});
