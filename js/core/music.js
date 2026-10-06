// The score. Modern-hybrid, adaptive and synthesized in real time — no samples.
// A lookahead scheduler drives 16th-note steps: a synthesized kit (kick, snare,
// hats, toms, crashes) and a driving bass carry the groove, strings/brass/bells
// carry harmony, and each faction has a hand-authored leitmotif that is repeated
// and developed. Everything is arranged into sections — drift -> build -> assault
// -> last stand — with builds, drops, impacts and stops, so the music breathes
// with the battle instead of droning. It adapts to:
//   intensity  (0..1, picks and scales the section)
//   domain     ground / air / space (which voices lead)
//   state      winning / losing / last tickets
//   mode       'map' = the campaign table (pads, sparse hook, low drone)
// plus victory / defeat / ship-lost / capture / alert stings. Every node lands on
// the mixer's music bus, so ducking, the limiter and the volume all apply.
(function (E) {
  'use strict';

  const MODES = {
    dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
    aeolian: [0, 2, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
    harmminor: [0, 2, 3, 5, 7, 8, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  };
  // a catchy, cinematic progression: i - VI - VII - V (one chord per bar, 4 bars)
  const PROG = [0, 5, 6, 4];
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const pick = (r, arr) => arr[(r() * arr.length) | 0];

  const M = { on: false, faction: 'aegis', I: 0.2, won: false, lost: false, vol: 0.8, domain: 'ground', mode: 'battle', st: {}, section: 'drift', tempoMul: 1, chordDeg: 0 };
  let c, mbus, duck, drumsG, bassG, harmG, leadG, fxG, delay;
  let noiseBuf;

  // ── synth voices (each takes an explicit start time) ─────────
  function env(g, t, a, pk, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pk, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
  function tone(dest, t, dur, type, f0, f1, pk, a) {
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); o.connect(g); g.connect(dest); env(g, t, a || 0.003, pk, dur); o.start(t); o.stop(t + dur + 0.03); return o;
  }
  function noise(dest, t, dur, type, f0, f1, q, pk, a) {
    const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur); f.Q.value = q || 0.7;
    const g = c.createGain(); s.connect(f); f.connect(g); g.connect(dest); env(g, t, a || 0.002, pk, dur); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02); return s;
  }
  const kick = (t, v) => { tone(drumsG, t, 0.18, 'sine', 128, 42, 0.95 * v, 0.002); noise(drumsG, t, 0.03, 'highpass', 3200, 0, 0.7, 0.35 * v, 0.001); };
  const snare = (t, v) => { noise(drumsG, t, 0.14, 'highpass', 1400, 0, 0.8, 0.5 * v, 0.001); tone(drumsG, t, 0.09, 'triangle', 200, 150, 0.28 * v, 0.002); };
  const clap = (t, v) => { for (let i = 0; i < 3; i++) noise(drumsG, t + i * 0.012, 0.05, 'bandpass', 1600, 0, 1.2, 0.32 * v, 0.001); };
  const hat = (t, v, open) => noise(drumsG, t, open ? 0.16 : 0.045, 'highpass', 7500, 0, 0.7, (open ? 0.16 : 0.12) * v, 0.001);
  const tom = (t, f, v) => tone(drumsG, t, 0.2, 'sine', f, f * 0.7, 0.4 * v, 0.002);
  const crash = (t, v) => { noise(fxG, t, 1.3, 'highpass', 4200, 5200, 0.8, 0.28 * v, 0.002); noise(fxG, t, 0.5, 'bandpass', 9000, 0, 0.5, 0.12 * v, 0.002); };
  function bass(t, f, dur, v) {
    const g = c.createGain(), o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const sub = c.createOscillator(); sub.type = 'sine'; sub.frequency.value = f / 2;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 6;
    o.connect(lp); lp.connect(g); sub.connect(g); g.connect(bassG);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.34 * v, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); sub.start(t); o.stop(t + dur + 0.02); sub.stop(t + dur + 0.02);
  }
  function pad(t, freqs, dur, v) {
    const g = c.createGain(); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600 + 600 * M.I; lp.Q.value = 0.6; lp.connect(g); g.connect(harmG);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.1 * v, t + Math.min(0.6, dur * 0.3)); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    for (const f of freqs) for (let i = 0; i < 2; i++) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (i ? 8 : -8); o.connect(lp); o.start(t); o.stop(t + dur + 0.05); }
  }
  function stab(t, freqs, dur, v) {
    const g = c.createGain(), bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.1; bp.connect(g); g.connect(harmG);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16 * v, t + 0.015); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    for (const f of freqs) for (let i = 0; i < 2; i++) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (i ? 6 : -6); o.connect(bp); o.start(t); o.stop(t + dur + 0.03); }
  }
  function lead(t, f, dur, v, brass) {
    const g = c.createGain(), o = c.createOscillator(); o.type = brass ? 'sawtooth' : 'square'; o.frequency.value = f;
    const o2 = c.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f * 1.005; o2.detune.value = 6;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = brass ? 2600 : 3400; lp.Q.value = 1.2;
    const vib = c.createOscillator(); vib.frequency.value = 5.5; const vg = c.createGain(); vg.gain.value = 4; vib.connect(vg); vg.connect(o.detune); vib.start(t); vib.stop(t + dur + 0.05);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(leadG);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.13 * v, t + 0.02); g.gain.setValueAtTime(0.13 * v, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }
  function bell(t, f, dur, v) {
    const o = c.createOscillator(); o.frequency.value = f;
    const m = c.createOscillator(); m.frequency.value = f * 3; const mg = c.createGain(); mg.gain.value = f * 2; m.connect(mg); mg.connect(o.frequency);
    const g = c.createGain(); o.connect(g); g.connect(leadG); g.connect(delay);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.16 * v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); m.start(t); o.stop(t + dur + 0.05); m.stop(t + dur + 0.05);
  }
  function riser(t, dur, v) { noise(fxG, t, dur, 'bandpass', 300, 6500, 1.4, 0.16 * v, dur * 0.8); tone(fxG, t, dur, 'sawtooth', 120, 900, 0.06 * v, dur * 0.7); }
  function boomHit(t, v) { tone(fxG, t, 0.6, 'sine', 90, 30, 0.5 * v, 0.002); noise(fxG, t, 0.5, 'lowpass', 900, 80, 0.7, 0.35 * v, 0.004); noise(fxG, t, 0.06, 'highpass', 3000, 0, 0.7, 0.2 * v, 0.001); }

  // ── harmony ──────────────────────────────────────────────────
  function scaleMidi(deg) { const m = M.mode_ || MODES.aeolian; const i = ((deg % 7) + 7) % 7, o = Math.floor(deg / 7); return M.root + 12 + m[i] + 12 * o; }
  function chordOf(deg) { return [scaleMidi(deg), scaleMidi(deg + 2), scaleMidi(deg + 4)]; }

  // ── arrangement tables (which 16th steps fire) ───────────────
  const KICK = { drift: [0, 8], build: [0, 8, 14], assault: [0, 6, 8, 14], last: [0, 4, 6, 10, 12, 14], map: [0] };
  const SNARE = { drift: [], build: [12], assault: [4, 12], last: [4, 12], map: [] };
  const HATS = { drift: [], build: [2, 6, 10, 14], assault: [0, 2, 4, 6, 8, 10, 12, 14], last: [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14], map: [] };
  const BASS8 = { drift: [0, 8], build: [0, 4, 8, 12], assault: [0, 2, 4, 6, 8, 10, 12, 14], last: [0, 2, 4, 6, 8, 10, 12, 14], map: [] };
  const STAB = { assault: [0, 6, 10], last: [0, 3, 6, 10, 13], build: [0, 10], drift: [], map: [] };
  const has = (arr, s) => arr.indexOf(s) >= 0;

  // ── scheduler ────────────────────────────────────────────────
  function tick() {
    if (!M.on) return;
    const bpm = M.bpm * M.tempoMul * (M.mode === 'map' ? 0.72 : 1), step = 60 / bpm / 4;
    while (M._nextT < c.currentTime + 0.18) {
      if (M._step % 64 === 0) updateSection(M._step);
      scheduleStep(M._step, M._nextT, step);
      M._step = (M._step + 1) % 64; M._nextT += step;
    }
  }

  function scheduleStep(step, t, stepDur) {
    const beat = step % 16, bar = Math.floor(step / 16) % 4, sect = M.section, I = M.I, v = 0.55 + 0.45 * I;
    const space = M.domain === 'space';
    if (beat === 0) {
      M.chordDeg = PROG[bar]; M._chord = chordOf(M.chordDeg);
      if (sect !== 'map') pad(t, M._chord.map(m => mtof(m - 12)), stepDur * 16, sect === 'drift' ? 0.8 : 1);
    }
    // drums
    if (has(KICK[sect] || [], beat)) {
      kick(t, sect === 'last' ? 1 : v);
      if (sect === 'assault' || sect === 'last') { duck.gain.setTargetAtTime(0.55, t, 0.02); duck.gain.setTargetAtTime(1, t + 0.14, 0.12); }
    }
    if (has(SNARE[sect] || [], beat)) { (sect === 'last' && beat === 12) ? clap(t, v) : snare(t, v); }
    if (has(HATS[sect] || [], beat)) hat(t, beat % 4 === 0 ? v : v * 0.7, beat === 14);
    if (sect === 'last' && beat === 15 && bar % 2 === 1) tom(t, mtof(scaleMidi(M.chordDeg) - 5), v); // fill
    // bass ostinato: root, with a fifth/octave bounce
    if (has(BASS8[sect] || [], beat)) {
      const deg = M.chordDeg + ((step % 8 === 4 || step % 8 === 6) ? 4 : 0);
      bass(t, mtof(scaleMidi(deg) - 24), stepDur * (sect === 'drift' ? 5 : 1.6), v);
    }
    // brass stabs on the chord
    if (has(STAB[sect] || [], beat)) stab(t, M._chord.map(m => mtof(m + (M.domain === 'air' ? 12 : 0))), stepDur * 2.4, v);
    // the faction hook: full in build/assault/last, sparse and bell-led in drift/space/map
    const hooks = M._hooks && M._hooks[step % 32];
    if (hooks && hooks.length) {
      const full = sect === 'assault' || sect === 'last' || sect === 'build';
      if (full) { for (const h of hooks) lead(t, mtof(scaleMidi(M.chordDeg + h[1]) + 12), stepDur * Math.max(2, h[2]), v, M.brass > 0.5); }
      else if ((sect === 'drift' || sect === 'map' || space) && beat % 8 === 0) bell(t, mtof(scaleMidi(hooks[0][1]) + 12), stepDur * 8, 0.7 * v);
    }
    // build riser into the drop
    if (sect === 'build' && step % 64 === 60) riser(t, stepDur * 8, v);
    // crash on the drop downbeat and after a section change
    if (beat === 0 && step % 64 === 0 && (sect === 'assault' || sect === 'last')) crash(t, v);
  }

  // ── lifecycle ────────────────────────────────────────────────
  M.start = function (factionId) {
    if (M.on) return;
    if (!E.Mixer || !E.Mixer.unlock()) return;
    c = E.Mixer.ctx; if (!c) return;
    M.on = true;
    noiseBuf = E.Mixer.noise;
    mbus = c.createGain(); mbus.gain.value = 0; mbus.connect(E.Mixer.input('music'));
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.008; comp.release.value = 0.25; comp.connect(mbus);
    const mg = c.createGain(); mg.gain.value = 0.9; mg.connect(comp); M.mg = mg;
    duck = c.createGain(); duck.gain.value = 1; duck.connect(mg);
    drumsG = c.createGain(); drumsG.gain.value = 0.95; drumsG.connect(mg);
    bassG = c.createGain(); bassG.gain.value = 0.9; bassG.connect(duck);
    harmG = c.createGain(); harmG.gain.value = 0.6; harmG.connect(duck);
    leadG = c.createGain(); leadG.gain.value = 0.55; leadG.connect(mg);
    fxG = c.createGain(); fxG.gain.value = 0.6; fxG.connect(mg);
    delay = c.createDelay(1); delay.delayTime.value = 0.36; const dg = c.createGain(); dg.gain.value = 0.22; delay.connect(dg); dg.connect(mg); const dfb = c.createGain(); dfb.gain.value = 0.3; delay.connect(dfb); dfb.connect(delay); leadG.connect(delay);
    M.setTheme(factionId || 'aegis', true);
    mbus.gain.setTargetAtTime(1, c.currentTime, 1.0);
    M._step = 0; M._nextT = c.currentTime + 0.12;
    M._timer = setInterval(tick, 25);
  };
  M.stop = function () { if (!M.on) return; clearInterval(M._timer); if (mbus) mbus.gain.setTargetAtTime(0, c.currentTime, 0.4); M.on = false; };
  M.resume = function () { if (E.Mixer) E.Mixer.unlock(); };

  M.setTheme = function (factionId, hard) {
    M.faction = factionId;
    const th = E.faction(factionId).music;
    M.baseMode = MODES[th.mode] || MODES.aeolian; M.mode_ = M.baseMode;
    M.root = th.root; M.bpm = th.bpm; M.bell = th.bell || 0; M.brass = th.brass || 0; M.saw = th.saw || 0;
    M.deg = 0; M.chordDeg = PROG[0]; M._chord = chordOf(0);
    M.section = 'drift'; M.sectBars = 0; M.won = false; M.lost = false; M.impactT = 0;
    // index the hook by step for O(1) lookup
    M._hooks = {};
    for (const h of (th.hook || [])) { const k = h[0] % 32; (M._hooks[k] = M._hooks[k] || []).push(h); }
    if (hard) { M._step = 0; }
  };

  // ── intensity / domain / mode / state ────────────────────────
  M.setIntensity = function (x) { M.I = E.clamp01(x); };
  M.setDomain = function (d) { if (d) M.domain = d; };
  M.setMode = function (m) { if (M.mode !== m) { M.mode = m; M._step = Math.ceil(M._step / 64) * 64 % 64; if (m === 'map') { M.won = false; M.lost = false; } } };
  M.setState = function (st) { M.st = st || {}; M.tempoMul = M.st.lastStand ? 1.12 : 1; };

  // section chosen once per bar, so the score can turn on a dime with the fight
  function updateSection(step) {
    if (step % 16 !== 0) return;
    const I = M.I, S = M.st, map = M.mode === 'map';
    const prev = M.section;
    if (M.won) M.section = 'assault';
    else if (M.lost) M.section = 'dirge';
    else if (map) M.section = 'map';
    else if (S.lastStand || I > 0.72) M.section = 'last';
    else if (I > 0.45) M.section = 'assault';
    else if (I > 0.22) M.section = 'build';
    else M.section = 'drift';
    // winning lifts the mode toward brighter colours; losing darkens it
    M.mode_ = M.lost ? MODES.phrygian : (S.winning && M.baseMode === MODES.aeolian ? MODES.dorian : M.baseMode);
    // impact + crash when a build/drift finally drops into the assault
    if (M.on && (M.section === 'assault' || M.section === 'last') && (prev === 'build' || prev === 'drift')) { const t = M._nextT; if (t) { boomHit(t, 0.9); crash(t, 0.9); } M.impactT = t || 0; }
  }



  // ── stings ───────────────────────────────────────────────────
  M.victory = function (factionId) { if (!M.on) return; M.setTheme(factionId || M.faction, false); M.won = true; M.I = 1; M.sting('victory'); };
  M.defeat = function (factionId) { if (!M.on) return; M.setTheme(factionId || M.faction, false); M.lost = true; M.I = 0.45; M.sting('defeat'); };
  M.setVolume = function (v) { M.vol = v; if (E.Mixer) E.Mixer.setMix({ music: v }); };
  M.sting = function (kind) {
    if (!M.on) return; const t = c.currentTime + 0.04, root = M.root;
    if (kind === 'victory') {
      [0, 4, 7, 12].forEach((s, i) => { stab(t + i * 0.14, [mtof(root + 12 + s), mtof(root + 16 + s), mtof(root + 19 + s)], 1.3, 1); pad(t + i * 0.14, [mtof(root + s)], 3, 0.5); });
      bell(t + 0.5, mtof(root + 31), 3, 0.8); kick(t, 1); kick(t + 0.28, 1); crash(t, 1);
    } else if (kind === 'defeat') {
      [12, 8, 5, 0, -4].forEach((s, i) => stab(t + i * 0.4, [mtof(root + s), mtof(root + s + 3), mtof(root + s + 7)], 1.4, 0.8));
      pad(t, [mtof(root - 12), mtof(root - 5)], 6, 0.6); boomHit(t, 0.9); boomHit(t + 0.9, 0.7);
    } else if (kind === 'shipLost') {
      boomHit(t, 1); stab(t, [mtof(root - 12 + 3), mtof(root - 12 + 7)], 1.2, 0.7); bell(t + 0.2, mtof(root + 19), 2.4, 0.6);
    } else if (kind === 'capture') {
      bell(t, mtof(root + 24), 1.4, 0.8); bell(t + 0.1, mtof(root + 31), 1.4, 0.6); stab(t, [mtof(root + 12), mtof(root + 16)], 0.5, 0.7);
    } else if (kind === 'alert') {
      kick(t, 1); kick(t + 0.22, 0.9); stab(t, [mtof(root), mtof(root + 5)], 0.4, 0.6);
    } else if (kind === 'turn') {
      pad(t, [mtof(root), mtof(root + 7), mtof(root + 12)], 3, 0.6); bell(t + 0.15, mtof(root + 24), 2, 0.6);
    }
  };

  E.Music = M;
})(window.E = window.E || {});
