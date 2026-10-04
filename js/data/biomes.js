// Planets and biomes. Each biome carries parameters for terrain, palette,
// skybox, weather and an inherent challenge that changes how the battle plays.
// The world generator reads these, so a (biome, seed) is fully reproducible.
(function (E) {
  'use strict';
  const rgb = E.rgb;

  // Each biome: terrain amplitudes, color stops (low->high), sky/fog, sun, and
  // a set of modifiers (the "inherent challenge") plus dynamic weather.
  const BIOMES = {
    tundra: {
      id: 'tundra',
      name: 'Kethara', class: 'ice', theme: 'Tundra',
      desc: 'Frozen plains under a bruised sky. Fog rolls across the ice and cuts visibility to a fraction of a screen.',
      palette: { low: rgb('#9aa8bb'), mid: rgb('#7f92ab'), high: rgb('#c3cedb'), fog: rgb('#5f7a94'), sky: rgb('#5f7488'), skyHi: rgb('#8fa9c0') },
      sun: { color: rgb('#cfe0ff'), dir: [0.4, 0.5, -0.4], strength: 0.85 },
      amp: { low: 0.25, mid: 0.5, high: 1.2, rough: 0.5, ridged: 0.2 },
      water: { level: 0.0, color: rgb('#bcd4e6'), cover: 0.0 },
      cover: { rocks: 0.1, ice: 0.5, trees: 0.02, buildings: 0.0 },
      challenge: { name: 'Ice Fog', desc: 'Thick fog: visibility cut, enemy sensors degraded.', fog: 2400, visDeg: 0.4 },
      weather: { kind: 'snow', density: 0.5, speed: 0.4, wind: 6 },
      sound: { wind: 0.4 },
    },
    desert: {
      id: 'desert',
      name: 'Sarruun', class: 'dune', theme: 'Desert',
      desc: 'Endless dunes and cracked salt flats. Heat haze shimmers the horizon and long sightlines favour snipers.',
      palette: { low: rgb('#c9a066'), mid: rgb('#b9884a'), high: rgb('#dcb878'), fog: rgb('#c99a63'), sky: rgb('#6f86a0'), skyHi: rgb('#a9c0d4') },
      sun: { color: rgb('#ffe6b0'), dir: [0.3, 0.6, -0.35], strength: 1.0 },
      amp: { low: 0.5, mid: 0.8, high: 0.3, rough: 0.3, ridged: 0.35 },
      water: { level: 0.0, color: rgb('#c9a06a'), cover: 0.0 },
      cover: { rocks: 0.08, ice: 0.0, trees: 0.01, buildings: 0.0, cactus: 0.05 },
      challenge: { name: 'Heat Haze', desc: 'Shimmering air distorts long-range aiming; +range, -stability beyond 400m.', fog: 4200, visDeg: -0.15 },
      weather: { kind: 'dust', density: 0.35, speed: 1.2, wind: 22 },
      sound: { wind: 0.55 },
    },
    jungle: {
      id: 'jungle',
      name: 'Veyra', class: 'jungle', theme: 'Jungle',
      desc: 'A drowned green. Dense canopy, rivers, and smoke. Everything is close and in your face.',
      palette: { low: rgb('#2c4a2e'), mid: rgb('#3a6b34'), high: rgb('#5f9a4a'), fog: rgb('#4d7a55'), sky: rgb('#7fae8a'), skyHi: rgb('#cfe8cf') },
      sun: { color: rgb('#eaffd0'), dir: [0.5, 0.5, -0.4], strength: 0.8 },
      amp: { low: 0.35, mid: 0.9, high: 1.4, rough: 0.7, ridged: 0.15 },
      water: { level: 0.02, color: rgb('#2f5a44'), cover: 0.3 },
      cover: { rocks: 0.05, ice: 0.0, trees: 0.7, buildings: 0.0, vines: 0.3 },
      challenge: { name: 'Dense Canopy', desc: 'Trees break line of sight and slow vehicles; smoke from hits lingers.', fog: 1600, visDeg: 0.25 },
      weather: { kind: 'rain', density: 0.7, speed: 0.6, wind: 8 },
      sound: { rain: 0.35 },
    },
    urban: {
      id: 'urban',
      name: 'Necropolis', class: 'urban', theme: 'City',
      desc: 'A ruined capital city, a vertical maze of towers and streets. Cover everywhere, fights at every floor.',
      palette: { low: rgb('#5a5f6b'), mid: rgb('#767b88'), high: rgb('#a7adbd'), fog: rgb('#8a8f9c'), sky: rgb('#9aa2b2'), skyHi: rgb('#d4dae6') },
      sun: { color: rgb('#ffe9c8'), dir: [0.6, 0.3, -0.5], strength: 0.85 },
      amp: { low: 0.1, mid: 0.15, high: 0.05, rough: 0.1, ridged: 0.0 },
      water: { level: -0.1, color: rgb('#4a5560'), cover: 0.0 },
      cover: { rocks: 0.0, ice: 0.0, trees: 0.02, buildings: 0.4, ruins: 0.3 },
      challenge: { name: 'Vertical City', desc: 'Towers block fire but offer cover; multi-level, close quarters.', fog: 2400, visDeg: 0.1 },
      weather: { kind: 'ash', density: 0.25, speed: 0.3, wind: 5 },
      sound: { rumble: 0.2 },
    },
    volcanic: {
      id: 'volcanic',
      name: 'Pyrrhus', class: 'volcanic', theme: 'Volcanic',
      desc: 'A living volcano. Gas pockets erupt, the ground breathes, and the only place to put down is the rim.',
      palette: { low: rgb('#2a2018'), mid: rgb('#4a3226'), high: rgb('#7a3a24'), fog: rgb('#6a3a2a'), sky: rgb('#7a2a1a'), skyHi: rgb('#d05a2a') },
      sun: { color: rgb('#ff8a4a'), dir: [0.2, 0.2, -0.6], strength: 0.9, flicker: 0.3 },
      amp: { low: 0.6, mid: 1.1, high: 1.8, rough: 0.9, ridged: 0.5 },
      water: { level: -0.2, color: rgb('#ff5a2a'), cover: 0.0, lava: 0.2 },
      cover: { rocks: 0.4, ice: 0.0, trees: 0.0, buildings: 0.0, vents: 0.2 },
      challenge: { name: 'Gas Eruptions', desc: 'Geysers erupt on a cycle, knocking units and shredding ships low to the ground.', fog: 2000, visDeg: 0.0 },
      weather: { kind: 'embers', density: 0.4, speed: 0.8, wind: 10 },
      sound: { rumble: 0.5 },
    },
    ocean: {
      id: 'ocean',
      name: 'Maelstrom', class: 'ocean', theme: 'Ocean',
      desc: 'A storm sea broken by reefs. Ships run the swells; land is scarce and every island is a prize.',
      palette: { low: rgb('#1f4a5a'), mid: rgb('#2a6b7a'), high: rgb('#4a9a8a'), fog: rgb('#4a8a9a'), sky: rgb('#5a9ab2'), skyHi: rgb('#cfe8f0') },
      sun: { color: rgb('#d0f0ff'), dir: [0.3, 0.7, -0.4], strength: 0.95 },
      amp: { low: 0.3, mid: 0.4, high: 0.8, rough: 0.5, ridged: 0.2 },
      water: { level: 0.24, color: rgb('#1f4a5a'), cover: 0.6, swell: 1.0 },
      cover: { rocks: 0.1, ice: 0.0, trees: 0.05, buildings: 0.0 },
      challenge: { name: 'Storm Swells', desc: 'Rising seas flood the low ground and slow surface vehicles; only the high ground holds.', fog: 3000, visDeg: 0.2 },
      weather: { kind: 'rain', density: 0.9, speed: 0.5, wind: 18, swell: true },
      sound: { rain: 0.3, surf: 0.4 },
    },
    cratered: {
      id: 'cratered',
      name: 'Vesta Minor', class: 'crater', theme: 'Cratered',
      desc: 'A pocked airless world. Thin air weakens shields, gravity bounces, and the horizon is littered with craters.',
      palette: { low: rgb('#8a8f9a'), mid: rgb('#a2a7b2'), high: rgb('#c4c9d4'), fog: rgb('#b0b5c0'), sky: rgb('#c8cdd8'), skyHi: rgb('#eef0f5') },
      sun: { color: rgb('#ffffff'), dir: [0.5, 0.4, -0.5], strength: 1.0 },
      amp: { low: 0.4, mid: 0.7, high: 0.9, rough: 0.4, ridged: 0.4, craters: 1.0 },
      water: { level: -0.3, color: rgb('#8a8f9a'), cover: 0.0 },
      cover: { rocks: 0.5, ice: 0.2, trees: 0.0, buildings: 0.0 },
      challenge: { name: 'Thin Air', desc: 'Shields recharge 40% slower and missiles lose reach; craters offer hard cover.', fog: 3600, visDeg: 0.0, thinAir: 1.0 },
      weather: { kind: 'dust', density: 0.2, speed: 0.6, wind: 8 },
      sound: { wind: 0.2 },
    },
    gas: {
      id: 'gas',
      name: 'Oblivion', class: 'gas', theme: 'Giant\'s Moon',
      desc: 'A shattered moon in the shadow of a ringed gas giant. Violet storms, glowing fissures, and a sky full of planet.',
      palette: { low: rgb('#3a2a4a'), mid: rgb('#5a3a6a'), high: rgb('#8a5a9a'), fog: rgb('#5a3a6a'), sky: rgb('#3a2a4a'), skyHi: rgb('#8a5a9a') },
      sun: { color: rgb('#ffd0ff'), dir: [0.4, 0.2, -0.5], strength: 0.7 },
      amp: { low: 0.5, mid: 0.9, high: 1.5, rough: 0.8, ridged: 0.3, craters: 0.5 },
      water: { level: -1, color: rgb('#5a3a6a'), cover: 0.0 },
      cover: {},
      challenge: { name: 'Giant\'s Shadow', desc: 'Twilight under the giant: long sightlines, deep shadow, and static storms on the horizon.', fog: 3400, visDeg: 0.3 },
      weather: { kind: 'bands', density: 1.0, speed: 0.4, wind: 30 },
      sound: { storm: 0.4 },
    },
  };

  E.BIOMES = BIOMES;
  E.BIOME_LIST = Object.values(BIOMES);
  E.biome = (id) => BIOMES[id] || BIOMES.tundra;

  // A planet is a biome + a seed + scale. The world generator fills the rest.
  E.makePlanet = (biomeId, seed, scale) => {
    const b = E.biome(biomeId);
    return {
      biome: biomeId, biomeDef: b, seed: seed >>> 0, scale: scale || 1,
      radius: 6000 * (scale || 1),        // stylized: big but not astronomical
      orbitR: 16000 * (scale || 1),        // where the space layer sits
      // 3-star system: this planet + up to two moons (space interest)
      moons: 1 + (seed % 2),
    };
  };
})(window.E = window.E || {});
