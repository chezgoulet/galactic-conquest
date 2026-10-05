// Battle modes: small, data-driven rule tweaks a quick battle can pick. All of
// them reuse the command-post / reinforcement loop — a mode only changes the
// ticket pool and how hard holding posts bleeds the enemy, so the sim, AI and UI
// need no special cases.
(function (E) {
  'use strict';
  const MODES = {
    conquest:    { id: 'conquest',    name: 'Conquest',    ticketMul: 1,    bleed: true,  bleedMul: 1,   desc: 'Hold more command posts than the enemy to drain their reinforcements. The standard battle.' },
    blitz:       { id: 'blitz',       name: 'Blitz',       ticketMul: 0.65, bleed: true,  bleedMul: 2,   desc: 'Fewer reinforcements and a much faster bleed: a short, sharp fight.' },
    annihilation:{ id: 'annihilation',name: 'Annihilation',ticketMul: 1.2,  bleed: false, bleedMul: 1,   desc: 'Command posts do not bleed a side. Break the enemy army to win.' },
    onslaught:   { id: 'onslaught',   name: 'Onslaught',   ticketMul: 1.5,  bleed: true,  bleedMul: 0.5, desc: 'Deep reserves and a slow bleed: a war of attrition.' },
  };
  E.MODES = MODES;
  E.MODE_LIST = ['conquest', 'blitz', 'annihilation', 'onslaught'].map((id) => MODES[id]);
  E.mode = (id) => MODES[id] || MODES.conquest;
})(window.E = window.E || {});
