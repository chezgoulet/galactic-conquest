// One-shot sounds, all synthesised. Each kind is a recipe: which bus it lives on,
// how far it carries, how much reverb it sends, and a builder that wires
// oscillators / filtered noise into the voice the mixer hands it.
//   E.SFX.play(kind, t, vol, { pos, rate, interior })   pos = world position (panned + attenuated)
// Families: infantry small arms, heavy weapons, vehicle guns, air guns and
// missiles, capital batteries, point defence, impacts, explosions by size,
// shield / hull / subsystem events, cockpit and bridge alerts, UI.
(function (E) {
  'use strict';
  const M = E.Mixer;
  const R = (a, b) => a + Math.random() * (b - a);
  const N = (t, d, o, x) => M.noiseSrc(t, d, o, x), T = (t, d, o, x) => M.tone(t, d, o, x);
  const K = {};
  // def(kind, {bus, ref, max, send, dur}, builder(t, out, rate))
  const def = (kinds, meta, fn) => { for (const k of [].concat(kinds)) K[k] = Object.assign({ fn, dur: 0.5, ref: 25, max: 500, bus: 'weapons', g: 1 }, meta); };
  const TRIM = {"rifle": 6, "repeater": 7, "pulse": 5, "laser": 6, "chin": 7, "pd": 8, "bolthit": 6, "hitmark": 4, "covbreak": 3, "footstep": 3, "ui": 4, "launch": 3, "pod": 2, "spore": 3, "shield": 2, "hover": 3, "whiz": 2, "weld": 3, "mine": 3, "tool": 3, "beep": 2, "deny": 2, "select": 2, "move": 2, "build": 2, "ops": 2, "bombaway": 2, "kill": 2, "hurt": 2, "rocket": 1.6, "shieldhit": 1.8};

  // ── infantry small arms ──
  def(['rifle', 'blaster'], { ref: 18, max: 380, dur: 0.3, send: 0.12 }, (t, o, r) => {
    T(t, 0.13, o, { type: 'square', f0: 820 * r, f1: 170 * r, gain: 0.22 });
    T(t, 0.07, o, { type: 'sawtooth', f0: 1900 * r, f1: 500 * r, gain: 0.14 });
    N(t, 0.06, o, { type: 'highpass', f0: 1800, q: 0.5, gain: 0.34 });
    N(t + 0.01, 0.12, o, { type: 'lowpass', f0: 600, f1: 200, gain: 0.2 });
  });
  def('repeater', { ref: 20, max: 420, dur: 0.2, send: 0.1 }, (t, o, r) => {
    T(t, 0.09, o, { type: 'square', f0: 520 * r, f1: 130 * r, gain: 0.2 });
    N(t, 0.05, o, { type: 'bandpass', f0: 1400, q: 0.8, gain: 0.36 });
    N(t, 0.1, o, { type: 'lowpass', f0: 500, gain: 0.22 });
  });
  def(['lance', 'sniper'], { ref: 40, max: 900, dur: 1.1, send: 0.35 }, (t, o, r) => {
    N(t, 0.05, o, { type: 'highpass', f0: 1200, gain: 0.6 });
    T(t, 0.35, o, { type: 'sawtooth', f0: 1500 * r, f1: 90 * r, gain: 0.26 });
    T(t, 0.9, o, { type: 'sine', f0: 110, f1: 38, gain: 0.5 });
    N(t + 0.02, 0.8, o, { type: 'lowpass', f0: 900, f1: 120, gain: 0.35 });
  });
  def('spore', { ref: 20, max: 400, dur: 0.3, send: 0.2 }, (t, o, r) => {
    T(t, 0.18, o, { type: 'sine', f0: 280 * r, f1: 700 * r, gain: 0.26 }); T(t, 0.14, o, { type: 'triangle', f0: 560 * r, f1: 1400 * r, gain: 0.12 });
    N(t, 0.12, o, { type: 'bandpass', f0: 900, q: 3, gain: 0.14 });
  });
  // ── heavy weapons ──
  def(['missile', 'rocket'], { ref: 35, max: 800, dur: 1.2, send: 0.3 }, (t, o, r) => {
    N(t, 0.9, o, { type: 'bandpass', f0: 500 * r, f1: 2600 * r, q: 0.9, gain: 0.42, a: 0.06 });
    T(t, 0.25, o, { type: 'sine', f0: 140, f1: 55, gain: 0.55 });
    N(t, 0.2, o, { type: 'lowpass', f0: 700, gain: 0.35 });
  });
  def(['launch', 'grenade'], { ref: 20, max: 350, dur: 0.5, send: 0.15 }, (t, o, r) => {
    T(t, 0.22, o, { type: 'sine', f0: 190 * r, f1: 62, gain: 0.55 }); N(t, 0.18, o, { type: 'lowpass', f0: 1100, f1: 250, gain: 0.4 }); N(t + 0.08, 0.25, o, { type: 'bandpass', f0: 1800, q: 1, gain: 0.1 });
  });
  def('cannon', { ref: 50, max: 1000, dur: 1.4, send: 0.4 }, (t, o, r) => {
    T(t, 0.7, o, { type: 'sine', f0: 118 * r, f1: 30, gain: 0.8 }); N(t, 0.35, o, { type: 'lowpass', f0: 1600, f1: 120, gain: 0.7 });
    N(t, 0.04, o, { type: 'highpass', f0: 2500, gain: 0.45 }); N(t + 0.1, 1.0, o, { type: 'lowpass', f0: 300, f1: 80, gain: 0.25, brown: true });
  });
  def('pulse', { ref: 25, max: 520, dur: 0.3, send: 0.15 }, (t, o, r) => {
    T(t, 0.16, o, { type: 'square', f0: 360 * r, f1: 95 * r, gain: 0.26 }); T(t, 0.12, o, { type: 'sawtooth', f0: 720 * r, f1: 180, gain: 0.12 }); N(t, 0.08, o, { type: 'bandpass', f0: 1100, q: 1, gain: 0.3 });
  });
  // ── air guns ──
  def('laser', { ref: 50, max: 900, dur: 0.25, send: 0.1 }, (t, o, r) => {
    T(t, 0.11, o, { type: 'sawtooth', f0: 2300 * r, f1: 420 * r, gain: 0.2 }); T(t, 0.08, o, { type: 'square', f0: 1200 * r, f1: 300, gain: 0.1 }); N(t, 0.03, o, { type: 'highpass', f0: 3000, gain: 0.24 });
  });
  def('chin', { ref: 40, max: 700, dur: 0.2 }, (t, o, r) => { T(t, 0.08, o, { type: 'square', f0: 640 * r, f1: 160, gain: 0.2 }); N(t, 0.06, o, { type: 'bandpass', f0: 1500, q: 1, gain: 0.34 }); N(t, 0.1, o, { type: 'lowpass', f0: 420, gain: 0.25 }); });
  def('pod', { ref: 40, max: 700, dur: 0.6, send: 0.2 }, (t, o, r) => { N(t, 0.4, o, { type: 'bandpass', f0: 700, f1: 2200, q: 1, gain: 0.34, a: 0.03 }); T(t, 0.15, o, { type: 'sine', f0: 150, f1: 60, gain: 0.4 }); });
  def('torpedo', { ref: 60, max: 1100, dur: 1.5, send: 0.35 }, (t, o, r) => {
    N(t, 1.2, o, { type: 'bandpass', f0: 220, f1: 1400, q: 0.8, gain: 0.4, a: 0.15 }); T(t, 0.6, o, { type: 'sine', f0: 100, f1: 36, gain: 0.7 });
  });
  // ── capital ships ──
  def(['capital', 'turbo'], { ref: 250, max: 4200, dur: 2.2, send: 0.65 }, (t, o, r) => {
    T(t, 1.4, o, { type: 'sine', f0: 92 * r, f1: 28, gain: 0.85 }); T(t, 0.5, o, { type: 'sawtooth', f0: 420 * r, f1: 70, gain: 0.2 });
    N(t, 1.0, o, { type: 'lowpass', f0: 1100, f1: 90, gain: 0.5, brown: true }); N(t, 0.05, o, { type: 'highpass', f0: 1500, gain: 0.3 });
  });
  def('pd', { ref: 120, max: 1800, dur: 0.12 }, (t, o, r) => { N(t, 0.035, o, { type: 'highpass', f0: 3200 * r, gain: 0.3 }); T(t, 0.03, o, { type: 'square', f0: 2400 * r, f1: 1500, gain: 0.07 }); });
  def('orbital', { ref: 600, max: 6000, dur: 5.5, send: 0.9, bus: 'impacts' }, (t, o) => {
    T(t, 3.0, o, { type: 'sawtooth', f0: 60, f1: 420, gain: 0.25, a: 2.4, curve: 'lin' });
    T(t + 3.0, 2.2, o, { type: 'sine', f0: 62, f1: 22, gain: 1.0 }); N(t + 3.0, 2.0, o, { type: 'lowpass', f0: 1800, f1: 60, gain: 0.9, brown: true }); N(t + 3.0, 0.08, o, { type: 'highpass', f0: 1200, gain: 0.6 });
  });
  def('ion', { ref: 400, max: 5000, dur: 3, send: 0.7 }, (t, o) => { T(t, 2.5, o, { type: 'sawtooth', f0: 90, f1: 55, gain: 0.35, a: 0.5 }); T(t, 2.5, o, { type: 'sine', f0: 880, f1: 120, gain: 0.2, a: 0.1 }); N(t, 2.4, o, { type: 'bandpass', f0: 1800, f1: 300, q: 1.5, gain: 0.3 }); });
  // ── impacts ──
  def('bolthit', { bus: 'impacts', ref: 12, max: 160, dur: 0.12 }, (t, o) => { N(t, 0.05, o, { type: 'bandpass', f0: 2400, q: 2, gain: 0.3 }); T(t, 0.05, o, { type: 'triangle', f0: 900, f1: 300, gain: 0.1 }); });
  def('shieldhit', { bus: 'impacts', ref: 40, max: 1400, dur: 0.7, send: 0.35 }, (t, o, r) => {
    T(t, 0.55, o, { type: 'sine', f0: 880 * r, f1: 330 * r, gain: 0.22 }); T(t, 0.45, o, { type: 'sine', f0: 1320 * r, f1: 520, gain: 0.1 }); N(t, 0.12, o, { type: 'bandpass', f0: 3200, q: 3, gain: 0.14 });
  });
  def('hullhit', { bus: 'impacts', ref: 50, max: 1500, dur: 0.8, send: 0.3 }, (t, o, r) => {
    T(t, 0.5, o, { type: 'sine', f0: 105 * r, f1: 50, gain: 0.6 }); N(t, 0.15, o, { type: 'bandpass', f0: 640 * r, q: 4, gain: 0.3 }); T(t, 0.4, o, { type: 'triangle', f0: 1480, f1: 1470, gain: 0.05 }); N(t, 0.3, o, { type: 'lowpass', f0: 500, f1: 90, gain: 0.35 });
  });
  def('sysboom', { bus: 'impacts', ref: 60, max: 1800, dur: 1.4, send: 0.5 }, (t, o) => {
    T(t, 0.9, o, { type: 'sine', f0: 85, f1: 26, gain: 0.9 }); N(t, 0.7, o, { type: 'lowpass', f0: 1400, f1: 70, gain: 0.7 }); N(t + 0.1, 0.4, o, { type: 'bandpass', f0: 800, f1: 300, q: 2, gain: 0.2 });
    for (let i = 0; i < 4; i++) N(t + 0.2 + i * 0.11, 0.09, o, { type: 'bandpass', f0: 1500 + i * 300, q: 3, gain: 0.12 });
  });
  def('breach', { bus: 'impacts', ref: 60, max: 1600, dur: 2.2, send: 0.5 }, (t, o) => {
    N(t, 1.8, o, { type: 'bandpass', f0: 2600, f1: 200, q: 0.8, gain: 0.5, a: 0.05 }); T(t, 1.6, o, { type: 'sine', f0: 62, f1: 34, gain: 0.7 });
    T(t + 0.1, 1.4, o, { type: 'sawtooth', f0: 190, f1: 70, gain: 0.08 }); T(t + 0.4, 0.5, o, { type: 'triangle', f0: 140, f1: 150, gain: 0.1 });
  });
  def('covbreak', { bus: 'impacts', ref: 15, max: 250, dur: 0.5, send: 0.1 }, (t, o) => { N(t, 0.3, o, { type: 'lowpass', f0: 2600, f1: 300, gain: 0.5 }); for (let i = 0; i < 5; i++) N(t + i * 0.05, 0.05, o, { type: 'bandpass', f0: R(900, 2400), q: 2, gain: 0.14 }); });
  // explosions by size
  const boom = (size) => (t, o, r) => {
    const L = size, dur = [0.35, 0.7, 1.3, 2.4][L];
    T(t, dur, o, { type: 'sine', f0: [140, 90, 62, 46][L] * r, f1: 24, gain: [0.55, 0.8, 0.95, 1.0][L] });
    N(t, dur * 0.8, o, { type: 'lowpass', f0: [2500, 1600, 1100, 900][L], f1: 60, gain: [0.5, 0.65, 0.8, 0.9][L], brown: L > 1 });
    N(t, 0.04, o, { type: 'highpass', f0: 2000, gain: [0.3, 0.4, 0.5, 0.6][L] });
    if (L > 1) for (let i = 0; i < 2 + L; i++) N(t + 0.12 + i * R(0.08, 0.16), 0.25, o, { type: 'lowpass', f0: R(500, 1200), f1: 90, gain: 0.18 });
  };
  def('boom0', { bus: 'impacts', ref: 25, max: 450, dur: 0.6, send: 0.2 }, boom(0));
  def(['boom1', 'explosion'], { bus: 'impacts', ref: 40, max: 900, dur: 1.0, send: 0.35 }, boom(1));
  def('boom2', { bus: 'impacts', ref: 80, max: 1800, dur: 1.8, send: 0.5 }, boom(2));
  def('boom3', { bus: 'impacts', ref: 250, max: 4500, dur: 3, send: 0.8 }, boom(3));
  // ── player feedback / cockpit / bridge ──
  def('hitmark', { bus: 'ui', dur: 0.1 }, (t, o) => T(t, 0.06, o, { type: 'triangle', f0: 1900, f1: 1500, gain: 0.3 }));
  def('kill', { bus: 'ui', dur: 0.3 }, (t, o) => { T(t, 0.2, o, { type: 'triangle', f0: 1250, f1: 620, gain: 0.3 }); T(t + 0.06, 0.18, o, { type: 'sine', f0: 1880, f1: 1250, gain: 0.14 }); });
  def('hurt', { bus: 'impacts', ref: 100, max: 200, dur: 0.3 }, (t, o) => { N(t, 0.16, o, { type: 'lowpass', f0: 520, gain: 0.55 }); T(t, 0.12, o, { type: 'sine', f0: 120, f1: 55, gain: 0.4 }); });
  def('shield', { bus: 'impacts', ref: 100, max: 300, dur: 0.3 }, (t, o) => { T(t, 0.22, o, { type: 'sine', f0: 560, f1: 300, gain: 0.2 }); N(t, 0.05, o, { type: 'bandpass', f0: 3000, q: 3, gain: 0.1 }); });
  def('capture', { bus: 'voice', dur: 0.8, send: 0.4 }, (t, o) => { [0, 4, 7, 12].forEach((s, i) => T(t + i * 0.09, 0.5, o, { type: 'triangle', f0: 440 * Math.pow(2, s / 12), gain: 0.2 })); });
  def('lost', { bus: 'voice', dur: 0.9, send: 0.4 }, (t, o) => { [0, -3, -7, -12].forEach((s, i) => T(t + i * 0.1, 0.5, o, { type: 'triangle', f0: 440 * Math.pow(2, s / 12), gain: 0.2 })); });
  def('alarm', { bus: 'voice', dur: 1, ref: 1e9, max: 2e9 }, (t, o) => { for (let i = 0; i < 3; i++) T(t + i * 0.28, 0.26, o, { type: 'square', f0: 880, f1: 660, gain: 0.12, curve: 'lin' }); });
  def('klaxon', { bus: 'voice', dur: 1.6 }, (t, o) => { for (let i = 0; i < 2; i++) { T(t + i * 0.8, 0.72, o, { type: 'sawtooth', f0: 330, f1: 520, gain: 0.14, curve: 'lin', a: 0.2 }); T(t + i * 0.8, 0.72, o, { type: 'square', f0: 165, f1: 260, gain: 0.07, curve: 'lin', a: 0.2 }); } });
  def('lock', { bus: 'voice', dur: 0.16 }, (t, o, r) => T(t, 0.1, o, { type: 'sine', f0: 1150 * r, gain: 0.26, sus: 0.8 }));
  def('locked', { bus: 'voice', dur: 0.5 }, (t, o) => { T(t, 0.4, o, { type: 'square', f0: 1560, gain: 0.12, sus: 0.9 }); T(t, 0.4, o, { type: 'sine', f0: 1560, gain: 0.2, sus: 0.9 }); });
  def('msl', { bus: 'voice', dur: 0.2 }, (t, o, r) => { T(t, 0.07, o, { type: 'square', f0: 2100 * r, gain: 0.16 }); T(t + 0.09, 0.07, o, { type: 'square', f0: 1700 * r, gain: 0.13 }); });
  def('stall', { bus: 'voice', dur: 0.5 }, (t, o) => { T(t, 0.4, o, { type: 'sawtooth', f0: 520, f1: 380, gain: 0.14, curve: 'lin', sus: 0.8 }); T(t, 0.4, o, { type: 'square', f0: 260, f1: 190, gain: 0.08, curve: 'lin' }); });
  def('flare', { bus: 'weapons', ref: 30, max: 400, dur: 0.9 }, (t, o) => { N(t, 0.8, o, { type: 'highpass', f0: 3500, f1: 6500, gain: 0.3, a: 0.02 }); for (let i = 0; i < 6; i++) N(t + i * 0.05, 0.06, o, { type: 'bandpass', f0: R(3500, 7000), q: 4, gain: 0.1 }); });
  def('whistle', { bus: 'impacts', ref: 60, max: 900, dur: 2.5 }, (t, o) => { T(t, 2.2, o, { type: 'sine', f0: 2400, f1: 700, gain: 0.14, a: 0.3, curve: 'lin' }); T(t, 2.2, o, { type: 'triangle', f0: 2420, f1: 710, gain: 0.05, a: 0.3, curve: 'lin' }); });
  def('bombaway', { bus: 'weapons', ref: 40, max: 600, dur: 0.5 }, (t, o) => { T(t, 0.15, o, { type: 'sine', f0: 100, f1: 50, gain: 0.5 }); N(t, 0.2, o, { type: 'lowpass', f0: 600, gain: 0.3 }); });
  def('boost', { bus: 'weapons', ref: 60, max: 700, dur: 0.9 }, (t, o) => { N(t, 0.8, o, { type: 'lowpass', f0: 400, f1: 2400, q: 0.7, gain: 0.55, a: 0.12 }); T(t, 0.6, o, { type: 'sawtooth', f0: 60, f1: 130, gain: 0.35 }); });
  def('call', { bus: 'voice', dur: 0.5 }, (t, o) => { T(t, 0.1, o, { type: 'sine', f0: 880, gain: 0.2 }); T(t + 0.12, 0.1, o, { type: 'sine', f0: 1175, gain: 0.2 }); T(t + 0.24, 0.2, o, { type: 'sine', f0: 1760, gain: 0.18 }); });
  def('deny', { bus: 'ui', dur: 0.3 }, (t, o) => { T(t, 0.12, o, { type: 'square', f0: 220, gain: 0.14 }); T(t + 0.13, 0.15, o, { type: 'square', f0: 165, gain: 0.14 }); });
  def('thud', { bus: 'impacts', ref: 1e9, max: 2e9, dur: 0.6, interior: true }, (t, o, r) => { T(t, 0.5, o, { type: 'sine', f0: 70 * r, f1: 30, gain: 0.8 }); N(t, 0.3, o, { type: 'lowpass', f0: 240, f1: 60, gain: 0.5, brown: true }); });
  def('creak', { bus: 'ambience', ref: 1e9, max: 2e9, dur: 1.4, interior: true }, (t, o) => { T(t, 1.2, o, { type: 'sawtooth', f0: 70, f1: 58, gain: 0.07, a: 0.4 }); T(t, 1.2, o, { type: 'triangle', f0: 215, f1: 170, gain: 0.04, a: 0.5 }); });
  def('stinger', { bus: 'voice', dur: 1.2, send: 0.5 }, (t, o) => { T(t, 1.0, o, { type: 'sawtooth', f0: 110, f1: 55, gain: 0.2 }); T(t, 0.9, o, { type: 'sine', f0: 55, gain: 0.5 }); });
  def('footstep', { bus: 'ambience', ref: 8, max: 80, dur: 0.12 }, (t, o, r) => { N(t, 0.07, o, { type: 'lowpass', f0: 520 * r, f1: 160, gain: 0.5 }); T(t, 0.06, o, { type: 'sine', f0: 90, f1: 50, gain: 0.3 }); });
  def('vault', { bus: 'ambience', ref: 8, max: 60, dur: 0.3 }, (t, o) => { N(t, 0.2, o, { type: 'lowpass', f0: 900, f1: 200, gain: 0.45, a: 0.04 }); T(t + 0.12, 0.1, o, { type: 'sine', f0: 110, f1: 55, gain: 0.5 }); });
  def('tool', { bus: 'ui', dur: 0.15 }, (t, o) => { T(t, 0.05, o, { type: 'square', f0: 1400, gain: 0.08 }); T(t + 0.05, 0.08, o, { type: 'square', f0: 1900, gain: 0.08 }); });
  def('weld', { bus: 'ambience', ref: 15, max: 100, dur: 0.2 }, (t, o) => { N(t, 0.15, o, { type: 'bandpass', f0: 3800, q: 2, gain: 0.2 }); });
  def('mine', { bus: 'weapons', ref: 15, max: 120, dur: 0.3 }, (t, o) => { T(t, 0.06, o, { type: 'square', f0: 700, gain: 0.15 }); T(t + 0.1, 0.12, o, { type: 'square', f0: 1000, gain: 0.12 }); });
  def('beep', { bus: 'voice', dur: 0.15 }, (t, o) => T(t, 0.1, o, { type: 'sine', f0: 1320, gain: 0.2 }));
  // ── UI (map, menus) ──
  def('ui', { bus: 'ui', dur: 0.1 }, (t, o) => T(t, 0.08, o, { type: 'sine', f0: 660, gain: 0.2 }));
  def('hover', { bus: 'ui', dur: 0.06 }, (t, o) => T(t, 0.04, o, { type: 'sine', f0: 1500, gain: 0.07 }));
  def('select', { bus: 'ui', dur: 0.2 }, (t, o) => { T(t, 0.07, o, { type: 'triangle', f0: 880, gain: 0.18 }); T(t + 0.06, 0.12, o, { type: 'triangle', f0: 1320, gain: 0.16 }); });
  def('confirm', { bus: 'ui', dur: 0.4 }, (t, o) => { [0, 7, 12].forEach((s, i) => T(t + i * 0.07, 0.25, o, { type: 'triangle', f0: 523 * Math.pow(2, s / 12), gain: 0.18 })); });
  def('move', { bus: 'ui', dur: 0.5 }, (t, o) => { T(t, 0.4, o, { type: 'sawtooth', f0: 140, f1: 420, gain: 0.1, curve: 'lin', a: 0.1 }); N(t, 0.4, o, { type: 'bandpass', f0: 600, f1: 2000, q: 1, gain: 0.1, a: 0.1 }); });
  def('build', { bus: 'ui', dur: 0.5 }, (t, o) => { N(t, 0.05, o, { type: 'bandpass', f0: 1800, q: 2, gain: 0.3 }); N(t + 0.1, 0.05, o, { type: 'bandpass', f0: 1500, q: 2, gain: 0.3 }); T(t + 0.18, 0.3, o, { type: 'triangle', f0: 660, f1: 990, gain: 0.15, curve: 'lin' }); });
  def('endturn', { bus: 'ui', dur: 1.2, send: 0.4 }, (t, o) => { T(t, 0.9, o, { type: 'sine', f0: 110, f1: 82, gain: 0.5 }); [0, 5, 9].forEach((s, i) => T(t + 0.1 + i * 0.12, 0.6, o, { type: 'triangle', f0: 330 * Math.pow(2, s / 12), gain: 0.12 })); });
  def('enemy', { bus: 'voice', dur: 1, send: 0.3 }, (t, o) => { T(t, 0.35, o, { type: 'sawtooth', f0: 98, f1: 92, gain: 0.2 }); T(t + 0.4, 0.4, o, { type: 'sawtooth', f0: 98, f1: 78, gain: 0.2 }); T(t, 0.8, o, { type: 'sine', f0: 49, gain: 0.5 }); });
  def('ops', { bus: 'ui', dur: 0.8 }, (t, o) => { N(t, 0.6, o, { type: 'bandpass', f0: 4000, f1: 800, q: 4, gain: 0.12, a: 0.1 }); T(t + 0.3, 0.3, o, { type: 'sine', f0: 1800, f1: 900, gain: 0.1 }); });
  def('whiz', { bus: 'impacts', ref: 1e9, max: 2e9, dur: 0.25 }, (t, o, r) => { N(t, 0.18, o, { type: 'bandpass', f0: 2600 * r, f1: 900, q: 3, gain: 0.35, a: 0.03 }); });
  def('hum', { bus: 'ui', dur: 0.3 }, (t, o) => T(t, 0.2, o, { type: 'sine', f0: 440, gain: 0.12 }));

  const SFX = {
    kinds: K,
    // alias table for weapon `sfx` names used by data/*.js
    alias: { pulse: 'pulse', launch: 'launch', pd: 'pd', capital: 'capital', missile: 'missile', lance: 'lance', rifle: 'rifle' },
    play(kind, t, vol, o) {
      if (!M.ready) return null;
      const k = K[kind] || K[SFX.alias[kind]]; if (!k) return null;
      o = o || {}; const c = M.ctx; t = t || c.currentTime;
      const out = M.voice({ bus: o.bus || k.bus, ref: k.ref, max: k.max, send: k.send, interior: o.interior != null ? o.interior : k.interior, vol: (vol == null ? 1 : vol) * (TRIM[kind] || k.g || 1), prio: o.prio }, o.pos, k.dur);
      if (!out) return null;
      k.fn(t, out, o.rate || R(0.94, 1.06));
      return out;
    },
  };

  // ── continuous voices (engines, wind, reactor, hum): the audio director drives their params ──
  const loops = {};
  // each returns {set(params, dt), stop()}; nodes live on the ambience bus
  function mk(name, fn) { loops[name] = (opts) => { if (!M.ready) return null; const c = M.ctx, out = c.createGain(); out.gain.value = 0; const bus = M.input('ambience', !!(opts && opts.interior)); out.connect(bus); const L = fn(c, out, opts || {}); L.out = out; L.stop = () => { out.gain.setTargetAtTime(0, c.currentTime, 0.15); setTimeout(() => { try { L.nodes.forEach(n => { try { n.stop && n.stop(); } catch (e) {} n.disconnect && n.disconnect(); }); out.disconnect(); } catch (e) {} }, 700); }; return L; }; }
  const osc = (c, type, f, dest, g) => { const o = c.createOscillator(); o.type = type; o.frequency.value = f; const x = c.createGain(); x.gain.value = g; o.connect(x); x.connect(dest); o.start(); return { o, g: x }; };
  const nz = (c, brown, ftype, f, q, dest, g) => { const s = c.createBufferSource(); s.buffer = brown ? M.brown : M.noise; s.loop = true; const fl = c.createBiquadFilter(); fl.type = ftype; fl.frequency.value = f; fl.Q.value = q; const x = c.createGain(); x.gain.value = g; s.connect(fl); fl.connect(x); x.connect(dest); s.start(0, Math.random() * 1.5); return { s, f: fl, g: x }; };
  const smooth = (p, v, c) => p.setTargetAtTime(v, c.currentTime, 0.08);
  // ground vehicle: engine hum that follows speed, hover whine, rumble; turret servo when `servo` > 0
  mk('vehicle', (c, out, o) => {
    const heavy = o.heavy || 0, a = osc(c, 'sawtooth', 50, out, 0.13), b = osc(c, 'square', 25, out, 0.1), w = osc(c, 'sine', 300, out, 0.06), r = nz(c, true, 'lowpass', 260, 0.7, out, 0.5), sv = osc(c, 'triangle', 420, out, 0);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; a.g.disconnect(); b.g.disconnect(); a.g.connect(lp); b.g.connect(lp); lp.connect(out);
    return { nodes: [a.o, b.o, w.o, r.s, sv.o], set(p) { const s = Math.min(1, p.speed || 0), base = heavy ? 34 : 52;
      smooth(a.o.frequency, base + s * (heavy ? 40 : 70), c); smooth(b.o.frequency, base * 0.5 + s * 30, c); smooth(w.o.frequency, 240 + s * 520, c); smooth(w.g.gain, 0.03 + s * 0.07, c); smooth(lp.frequency, 260 + s * 900, c);
      smooth(r.g.gain, 0.25 + s * 0.45, c); smooth(sv.g.gain, (p.servo || 0) * 0.05, c); smooth(sv.o.frequency, 330 + (p.servo || 0) * 120, c); smooth(out.gain, p.gain == null ? 0.7 : p.gain, c); } };
  });
  // aircraft: thrust rumble, turbine whine, afterburner roar, wind and buffet. dens 0 = vacuum: only the cockpit hum remains
  mk('jet', (c, out, o) => {
    const rum = nz(c, true, 'lowpass', 220, 0.8, out, 0.45), whine = osc(c, 'sawtooth', 300, out, 0.025), w2 = osc(c, 'triangle', 600, out, 0.02), roar = nz(c, false, 'lowpass', 1100, 0.6, out, 0), wind = nz(c, false, 'bandpass', 900, 0.7, out, 0), buf = nz(c, true, 'lowpass', 120, 1, out, 0), hum = osc(c, 'sine', 118, out, 0);
    const lfo = c.createOscillator(); lfo.frequency.value = 11; const lg = c.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(buf.g.gain); lfo.start();
    return { nodes: [rum.s, whine.o, w2.o, roar.s, wind.s, buf.s, hum.o, lfo], set(p) { const thr = p.thr || 0, d = p.dens == null ? 1 : p.dens, bo = p.boost ? 1 : 0, sp = Math.min(1, (p.speed || 0) / 220);
      smooth(rum.g.gain, (0.15 + thr * 0.5) * (0.35 + 0.65 * d) + (d < 0.1 ? 0.04 : 0), c); smooth(rum.f.frequency, 160 + thr * 260, c);
      smooth(whine.o.frequency, 260 + thr * 700 + bo * 300, c); smooth(whine.g.gain, (0.012 + thr * 0.03) * (0.3 + 0.7 * d), c); smooth(w2.o.frequency, 520 + thr * 1400, c); smooth(w2.g.gain, 0.01 * (0.3 + 0.7 * d), c);
      smooth(roar.g.gain, bo * 0.5 * (0.4 + 0.6 * d) + 0.04 * thr, c); smooth(roar.f.frequency, 700 + bo * 1600, c);
      smooth(wind.g.gain, Math.pow(sp, 1.4) * 0.55 * Math.pow(d, 1.2), c); smooth(wind.f.frequency, 500 + sp * 2800, c);
      smooth(buf.g.gain, (p.buffet || 0) * 0.5 * (0.3 + 0.7 * d), c); smooth(hum.g.gain, d < 0.15 ? 0.1 : 0.03, c);
      smooth(out.gain, p.gain == null ? 0.75 : p.gain, c); } };
  });
  // capital ship: reactor rumble and structure-borne hum (level follows throttle / engine power)
  mk('reactor', (c, out) => {
    const a = osc(c, 'sine', 38, out, 0.3), b = osc(c, 'sine', 57, out, 0.18), cc = osc(c, 'triangle', 114, out, 0.05), r = nz(c, true, 'lowpass', 140, 0.7, out, 0.22);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.23; const lg = c.createGain(); lg.gain.value = 0.15; lfo.connect(lg); lg.connect(a.g.gain); lfo.start();
    return { nodes: [a.o, b.o, cc.o, r.s, lfo], set(p) { const th = p.thr || 0, pw = p.engines == null ? 0.33 : p.engines; smooth(a.o.frequency, 36 + th * 8 + pw * 8, c); smooth(b.o.frequency, 54 + th * 10, c); smooth(r.g.gain, 0.15 + th * 0.25 + pw * 0.2, c); smooth(cc.g.gain, 0.02 + (p.core || 0) * 0.08, c); smooth(out.gain, p.gain == null ? 0.7 : p.gain, c); } };
  });
  // wind bed for the ground (biome ambience); gain follows density
  mk('wind', (c, out) => {
    const w = nz(c, false, 'bandpass', 500, 0.5, out, 0.25), l = nz(c, true, 'lowpass', 200, 0.5, out, 0.3);
    const lfo = c.createOscillator(); lfo.frequency.value = 0.11; const lg = c.createGain(); lg.gain.value = 260; lfo.connect(lg); lg.connect(w.f.frequency); lfo.start();
    return { nodes: [w.s, l.s, lfo], set(p) { smooth(out.gain, (p.gain == null ? 0.5 : p.gain) * (p.dens == null ? 1 : p.dens), c); } };
  });
  // boarding deck / bridge interior drone
  mk('deck', (c, out) => {
    const a = osc(c, 'sine', 62, out, 0.3), b = osc(c, 'sawtooth', 124, out, 0.025), r = nz(c, true, 'lowpass', 120, 0.7, out, 0.3);
    return { nodes: [a.o, b.o, r.s], set(p) { smooth(out.gain, p.gain == null ? 0.6 : p.gain, c); } };
  });
  SFX.loops = loops;
  E.SFX = SFX;
})(window.E = window.E || {});
