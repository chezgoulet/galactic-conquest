// The roster. Pure data: what each unit is, how it fights, how big it is.
// Rendering and simulation both read from here so the numbers and the visuals
// always agree. Distances are meters, speeds m/s, rates shots/s.
(function (E) {
  'use strict';

  // The roster itself lives per domain: data/land.js (infantry, vehicles,
  // turrets), data/air.js (fighters) and data/space.js (capitals). Each adds its
  // weapons to E.WEAPONS and its unit tables to E.INFANTRY / E.VEHICLES / …
  //
  // Armor classes: inf (flesh + plate), light (skiffs, fighters), heavy (tanks,
  // turrets), cap (capital hulls). Each weapon lists a damage multiplier per
  // class; anything unlisted is 1.
  E.WEAPONS = E.WEAPONS || {};

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
