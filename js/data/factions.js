// The two factions. Everything downstream (hulls, weapons, insignia, music,
// doctrine) reads from here so each side is unmistakably itself. They are
// original — inspired by the land/air/space grand-battle archetype, not by any
// licensed property.
(function (E) {
  'use strict';

  // palette helpers: store as hex strings for authoring, expose [r,g,b] 0-255.
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

  const AEGIS = {
    id: 'aegis',
    name: 'The Aegis Concord',
    short: 'Concord',
    tagline: 'One shield. One line. No retreat.',
    culture: {
      desc: 'A veteran alliance of fortress-worlds that survived the Sundering by outlasting, out-shelling and out-holding every rival. Their ships are fortresses that move; their infantry holds ground like it is law.',
      values: 'Discipline, endurance, firepower.',
      flag: { field: '#141a26', charge: '#ff5a2b', shape: 'aegis' }, // chevron shield
    },
    palette: {
      hull: rgb('#39414f'), hullDark: rgb('#1d222c'), hullLight: rgb('#6b7686'),
      accent: rgb('#ff5a2b'), engine: rgb('#ff8a2a'), shield: rgb('#3fa9ff'),
      trim: rgb('#c8d2e0'), glow: rgb('#ff7a2a'), canopies: rgb('#bfe0ff'),
    },
    hull: { style: 'angular', chamfer: 0.35, plate: 0.9, fin: 0.4, round: 0.08, bulk: 1.0 },
    // Doctrine: capital-ship superiority, heavy armor, slow-but-brutal, big guns.
    doctrine: {
      summary: 'Armored capital fleet, broadside batteries, infantry that holds ground.',
      ship: 'superiority', fighter: 'interdiction', ground: 'assault',
      weights: { capital: 1.2, fighter: 1.0, ground: 1.15, mobility: 0.8 },
    },
    // hook: a 2-bar leitmotif [16th-step (0..31), scale degree, length] — the
    // score repeats and develops it so the faction has a tune you can hum.
    music: { mode: 'phrygian', root: 33, bpm: 104, motif: 21131, brass: 1.0, saw: 0.75, bell: 0.4,
      hook: [[0, 0, 2], [2, 2, 2], [4, 4, 2], [6, 7, 2], [8, 4, 3], [12, 2, 2], [14, 0, 2], [16, 0, 2], [18, 4, 2], [20, 7, 2], [22, 4, 2], [24, 2, 4], [28, 0, 4]] },
    weapons: {
      main: { kind: 'railgun', dmg: 34, rate: 0.5, speed: 260, pierce: 1.0, color: '#ff8a2a', sfx: 'railgun' },
      side: { kind: 'pulse', dmg: 6, rate: 4.5, speed: 180, pierce: 0.2, color: '#ffd27a', sfx: 'pulse' },
      pd: { kind: 'autocannon', dmg: 2.5, rate: 18, speed: 220, pierce: 0.1, color: '#ffe0a0', sfx: 'pd' },
      missile: { kind: 'missile', dmg: 20, rate: 0.6, speed: 90, seek: 1.0, color: '#ff5a2b', sfx: 'missile' },
    },
    sounds: { engine: 44, shot: 220, shield: 520, hit: 160 },
    ships: { battleship: 'Aegis-class Dreadnought', carrier: 'Warden Carrier', cruiser: 'Sentinel Cruiser' },
    fighters: { interceptor: 'Lancer', gunship: 'Mauler', strike: 'Reaver' },
    vehicles: { scout: 'Skiff', gunship: 'Bulwark', siege: 'Juggernaut', gunshipA: 'Hornet' },
    infantry: { rifle: 'Concord Line', heavy: 'Bulwark Trooper', medic: 'Field Medic', recon: 'Scout' },
  };

  const VERDANT = {
    id: 'verdant',
    name: 'The Verdant Pact',
    short: 'Pact',
    tagline: 'Many roots. One storm.',
    culture: {
      desc: 'A loose confederation of greened moons and sky-harbors that turned adaptability into a weapon. Their hulls grow as much as they are built, their ships split into swarms, and they fight like weather: over you, then gone.',
      values: 'Adaptability, numbers, endurance of the swarm.',
      flag: { field: '#0f1a14', charge: '#3df0b0', shape: 'bloom' }, // radial bloom
    },
    palette: {
      hull: rgb('#31452f'), hullDark: rgb('#18231a'), hullLight: rgb('#5f7a4f'),
      accent: rgb('#3df0b0'), engine: rgb('#7cff66'), shield: rgb('#57ffd0'),
      trim: rgb('#d8e6c0'), glow: rgb('#4dff9a'), canopies: rgb('#c8ffe0'),
    },
    hull: { style: 'organic', chamfer: 0.1, plate: 0.3, fin: 0.9, round: 0.55, bulk: 0.85 },
    // Doctrine: swarm fighters, hit-and-run, mobility, organic layered armor.
    doctrine: {
      summary: 'Bioluminescent swarm, fast strike craft, guerrilla ground forces.',
      ship: 'ambush', fighter: 'swarm', ground: 'guerrilla',
      weights: { capital: 0.85, fighter: 1.25, ground: 1.0, mobility: 1.2 },
    },
    music: { mode: 'dorian', root: 36, bpm: 92, motif: 77731, brass: 0.3, saw: 0.35, bell: 1.2,
      hook: [[0, 0, 1], [1, 2, 1], [2, 3, 2], [4, 2, 2], [6, 0, 2], [8, -2, 3], [11, 0, 1], [12, 2, 4], [16, 3, 2], [18, 4, 2], [20, 3, 2], [22, 2, 2], [24, 0, 2], [26, -3, 2], [28, 0, 4]] },
    weapons: {
      main: { kind: 'lance', dmg: 11, rate: 2.4, speed: 220, pierce: 0.3, color: '#7cff66', sfx: 'lance' },
      side: { kind: 'spore', dmg: 4, rate: 6, speed: 150, pierce: 0.15, color: '#a6ff8a', sfx: 'spore' },
      pd: { kind: 'autocannon', dmg: 1.8, rate: 20, speed: 200, pierce: 0.1, color: '#d8ffe0', sfx: 'pd' },
      missile: { kind: 'missile', dmg: 13, rate: 0.9, speed: 110, seek: 1.2, color: '#3df0b0', sfx: 'missile' },
    },
    sounds: { engine: 36, shot: 160, shield: 440, hit: 120 },
    ships: { battleship: 'Bloomheart Dreadnought', carrier: 'Sporeward Carrier', cruiser: 'Thornbark Cruiser' },
    fighters: { interceptor: 'Needle', gunship: 'Locust', strike: 'Stinger' },
    vehicles: { scout: 'Skitter', gunship: 'Bramble', siege: 'Colossus', gunshipA: 'Wasp' },
    infantry: { rifle: 'Rootwalker', heavy: 'Thornback', medic: 'Mender', recon: 'Sporerunner' },
  };

  E.FACTIONS = { aegis: AEGIS, verdant: VERDANT };
  E.FACTION_LIST = [AEGIS, VERDANT];
  E.faction = (id) => E.FACTIONS[id] || AEGIS;
  E.rgb = rgb;
  // pick the opposing faction
  E.opponent = (id) => (id === 'aegis' ? 'verdant' : 'aegis');
})(window.E = window.E || {});
