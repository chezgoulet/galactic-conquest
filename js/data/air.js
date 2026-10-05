// AIR roster: fighters, bombers, gunships, strike craft and their weapons. See
// units.js for armor classes and the shared lookup helpers.
//
// Craft fields (all optional unless noted):
//   speed   cruise speed at the default throttle (m/s)      boost   top speed on afterburner / in space
//   stall   stall speed at sea-level air density            corner  best cornering speed
//   turn    max pitch rate at corner speed (rad/s)           roll    max roll rate (rad/s)
//   accel   thrust acceleration at full throttle (m/s^2)     gmax    structural turn-rate limit scale
//   vtol    hovers on lift jets at low speed                 carry   troop capacity (gunship)
//   ord     rounds of the alt weapon carried, rearmed one per `rearm` seconds
//   cm      countermeasure charges                           arc     gun traverse (rad) around the nose
//   role    doctrine key used by the air AI
(function (E) {
  'use strict';

  Object.assign(E.WEAPONS = E.WEAPONS || {}, {
    // ── air ──
    laser:    { name: 'Wing Lasers',      kind: 'bolt', dmg: 24, rate: 9,   speed: 560, range: 720, spread: 0.008, heat: 0.035, scale: 1.6, vs: { heavy: 0.45, cap: 0.22 }, sfx: 'lance' },
    missile:  { name: 'Hunter Missile',   kind: 'missile', dmg: 280, speed: 210, range: 900, seek: 2.6, splash: 9, cd: 5, vs: { inf: 0.6, cap: 1.8 }, sfx: 'missile' },
    bomb:     { name: 'Plasma Bomb',      kind: 'bomb', dmg: 520, speed: 0, grav: 32, splash: 26, cd: 1.1, vs: { cap: 1.6, heavy: 1.25 }, sfx: 'launch' },
    chin:     { name: 'Chin Cannon',      kind: 'bolt', dmg: 22, rate: 11,  speed: 430, range: 560, spread: 0.016, heat: 0.028, scale: 1.3, vs: { heavy: 0.5, cap: 0.08, inf: 1.3 }, sfx: 'pulse' },
    pod:      { name: 'Rocket Pod',       kind: 'rocket', dmg: 92, speed: 240, range: 650, spread: 0.02, splash: 8, cd: 0.3, scale: 1.4, vs: { inf: 1.15, heavy: 0.85, cap: 0.3 }, sfx: 'launch' },
    ptorp:    { name: 'Proton Torpedo',   kind: 'missile', dmg: 900, speed: 175, range: 1500, seek: 1.1, splash: 18, cd: 6, scale: 2.2, vs: { cap: 2.3, heavy: 1.0 }, sfx: 'missile' },
  });

  // Tunables shared by the flight model and the air AI (sim/air*.js).
  Object.assign(E.AIR = E.AIR || {}, {
    G: 18,                  // gravity at the surface (m/s^2); scales with density
    boostDrain: 0.26, boostRegen: 0.1, boostLockout: 0.3,   // boost resource (0..1) per second
    driftMax: 2.2, driftRegen: 0.3,                         // seconds of drift per full charge
    evadeTime: 1.15, evadeCooldown: 7,                      // barrel roll / break turn
    cmCooldown: 5.5, cmJam: 2.4, cmRegen: 14,               // countermeasures
    lockCone: 0.3, lockTime: 1.4, lockDecay: 1.6, lockGrace: 0.5,
    hullRepair: 0.05,                                       // hp fraction / s near a friendly carrier
    callCooldown: 25,                                       // per team close-air-support call-in
  });

  E.FIGHTERS = {
    interceptor: { name: 'Lancer', role: 'interceptor', hp: 260, shield: 120, speed: 115, boost: 195, minSpeed: 55, stall: 48, corner: 105, turn: 2.1, roll: 3.6, accel: 42, gmax: 1,
                   r: 4.2, h: 2.4, weapon: 'laser', alt: 'missile', ord: 4, rearm: 12, cm: 3, armor: 'light', cost: 2, lockCone: 0.32, lockTime: 1.25,
                   desc: 'Air-superiority fighter. Fast and agile; wing lasers, hunter missiles and countermeasures.' },
    bomber:      { name: 'Mauler', role: 'bomber', hp: 560, shield: 180, speed: 85, boost: 135, minSpeed: 45, stall: 42, corner: 88, turn: 1.15, roll: 1.8, accel: 28, gmax: 0.8,
                   r: 5.2, h: 3.0, weapon: 'laser', alt: 'bomb', ord: 6, rearm: 8, cm: 2, armor: 'light', cost: 2, lockCone: 0.2, lockTime: 1.0,
                   desc: 'Strike bomber. Plasma bombs crack armor and capital hulls; fragile in a turning fight.' },
    gunship:     { name: 'Drake', role: 'gunship', hp: 820, shield: 280, speed: 55, boost: 95, minSpeed: 0, stall: 24, corner: 52, turn: 1.0, roll: 1.2, accel: 22, gmax: 0.6,
                   r: 6.5, h: 3.4, weapon: 'chin', alt: 'pod', ord: 16, rearm: 3, cm: 4, armor: 'light', cost: 3, vtol: true, carry: 6, arc: 1.35,
                   desc: 'VTOL gunship. Slow and tough; chin cannon and rocket pods for close air support, and a hold for six troops.' },
    strike:      { name: 'Reaver', role: 'strike', hp: 330, shield: 140, speed: 135, boost: 215, minSpeed: 60, stall: 55, corner: 120, turn: 1.5, roll: 2.6, accel: 46, gmax: 0.9,
                   r: 4.6, h: 2.6, weapon: 'laser', alt: 'ptorp', ord: 3, rearm: 15, cm: 3, armor: 'light', cost: 3, lockCone: 0.45, lockTime: 0.9,
                   desc: 'Fast strike craft. Proton torpedoes for capital-ship and subsystem runs.' },
  };
})(window.E = window.E || {});
