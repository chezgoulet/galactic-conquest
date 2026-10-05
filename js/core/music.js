// The score. Orchestral, adaptive and synthesized in real time — no samples.
// A lookahead scheduler plays 16th-note steps on the AudioContext clock. Harmony
// is a Markov chain over the faction's mode (cinematic moves), melody is the
// faction's seeded leitmotif re-harmonised per bar, and voices are strings,
// brass, timpani, bells and a bass ostinato. It adapts to:
//   intensity  (0..1, drift -> pulse -> battle sections)
//   domain     ground (timpani and brass), air (driving strings, high brass), space (pads, bells, little percussion)
//   state      winning / losing (minor-leaning harmony, thinner), last tickets (faster, urgent), ship lost (sting)
//   mode       'map' = the campaign table: slow pads, sparse bells, a low drone
// plus victory / defeat / ship-lost / alert stings. Every note is oscillators + filters + gains
// on the mixer's music bus, so ducking, the limiter and the music volume all apply.
(function (E) {
  'use strict';

  const MODES = {
    dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
    aeolian: [0, 2, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
    harmminor: [0, 2, 3, 5, 7, 8, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  };
  // degree transitions (0 = i .. 6 = VII), weighted to filmic motion.
  const CHAIN = {
    0: [[5, 5], [3, 3], [6, 3], [2, 1]], 1: [[4, 3], [6, 2], [0, 1]],
    2: [[5, 3], [3, 2], [6, 2]], 3: [[0, 3], [5, 2], [6, 2]],
    4: [[0, 3], [5, 3]], 5: [[6, 4], [3, 3], [0, 3]], 6: [[0, 4], [5, 2], [2, 2]],
  };
  // when losing the harmony stays on the dark degrees
  const CHAIN_LOSE = { 0: [[5, 4], [3, 3], [0, 2]], 1: [[0, 3], [5, 2]], 2: [[5, 3], [0, 2]], 3: [[5, 3], [0, 3]], 4: [[0, 3], [5, 3]], 5: [[0, 3], [3, 3], [6, 2]], 6: [[0, 4], [5, 3]] };
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s >>>= 0; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function pick(r, arr) { let tot = 0; for (const [, w] of arr) tot += w; let x = r() * tot; for (const [v, w] of arr) { x -= w; if (x <= 0) return v; } return arr[0][0]; }
  function theme(factionId) { const f = E.faction(factionId); return f.music; }

  const M = { on: false, faction: 'aegis', I: 0.2, won: false, lost: false, vol: 0.8, domain: 'ground', mode: 'battle', st: {}, section: 'drift', tempoMul: 1 };
  let c, strings, brass, timb, bass, bell, rev, dly, noiseBuf, mbus;

  function hall(sec) {
    const len = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const x = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) { const t = i / len; lp += ((Math.random() * 2 - 1) - lp) * (1 - (0.08 + 0.9 * t) * 0.95);
        x[i] = lp * Math.pow(1 - t, 2.4) * (i < c.sampleRate * 0.01 ? i / (c.sampleRate * 0.01) : 1); } }
    return b;
  }

  // The score lives on the mixer's music bus (ducking, the limiter and the music volume all apply).
  M.start = function (factionId) {
    if (M.on) return;
    if (!E.Mixer || !E.Mixer.unlock()) return;
    c = E.Mixer.ctx; if (!c) return;
    M.on = true;
    mbus = c.createGain(); mbus.gain.value = 0; mbus.connect(E.Mixer.input('music'));
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    comp.connect(mbus);
    const mg = c.createGain(); mg.gain.value = 0.9; mg.connect(comp); M.mg = mg;
    rev = c.createConvolver(); rev.buffer = hall(4.5);   // vast dark hall
    const revG = c.createGain(); revG.gain.value = 0.5; rev.connect(revG); revG.connect(mg);
    const revIn = c.createGain(); revIn.connect(rev); M.revIn = revIn;
    dly = c.createDelay(2); dly.delayTime.value = 0.42;   // delay
    const fb = c.createGain(); fb.gain.value = 0.32; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    dly.connect(lp); lp.connect(fb); fb.connect(dly);
    const dOut = c.createGain(); dOut.gain.value = 0.28; dly.connect(dOut); dOut.connect(mg); M.dly = dly;
    const bus = (l, r) => { const g = c.createGain(); g.gain.value = l; g.connect(mg); const rg = c.createGain(); rg.gain.value = r; rg.connect(M.revIn); return { g, rg }; };
    const s = bus(0.5, 0.5), br = bus(0.42, 0.4), ti = bus(0.5, 0.2), ba = bus(0.4, 0.2), be = bus(0.3, 0.6);
    strings = s.g; brass = br.g; timb = ti.g; bass = ba.g; bell = be.g;
    noiseBuf = E.Mixer.noise;
    M.setTheme(factionId || 'aegis', true);
    mbus.gain.setTargetAtTime(1, c.currentTime, 1.2);
    M._step = 0; M._nextT = c.currentTime + 0.12;
    M._timer = setInterval(tick, 25);
  };
  M.stop = function () { if (!M.on) return; clearInterval(M._timer); if (mbus) mbus.gain.setTargetAtTime(0, c.currentTime, 0.4); M.on = false; };
  M.resume = function () { if (E.Mixer) E.Mixer.unlock(); };

  M.setTheme = function (factionId, hard) {
    M.faction = factionId;
    const th = theme(factionId);
    M.baseMode = MODES[th.mode] || MODES.aeolian; M.mode_ = M.baseMode;
    M.root = th.root; M.bpm = th.bpm; M.motifSeed = th.motif; M.bell = th.bell; M.saw = th.saw;
    M.r = rng(th.motif * 7919);
    M.motif = makeMotif(rng(th.motif * 7919 + 3), 4);
    M.deg = 0; M.chord = chordOf(0); M.chordBars = 0;
    M.section = 'drift'; M.sectBars = 0; M.won = false; M.lost = false;
    M.impactT = 0;
  };

  function chordOf(deg) { const m = M.mode_ || M.baseMode; return [m[deg % 7], m[(deg + 2) % 7], m[(deg + 4) % 7]]; }

  function makeMotif(r, bars) {
    const CELLS = [
      [[0, 6], [6, 2], [8, 8]],
      [[0, 3], [3, 3], [6, 4], [12, 4]],
      [[0, 8], [10, 2], [12, 4]],
      [[2, 2], [4, 4], [8, 2], [10, 6]],
    ];
    const notes = [];
    let d = [0, 2, 4][Math.floor(r() * 3)];
    for (let b = 0; b < bars; b++) {
      const cell = CELLS[Math.floor(r() * CELLS.length)];
      for (const [st, len] of cell) {
        const step = (b * 4 + Math.floor(st / 4)) % 16;
        const note = d + (Math.floor(r() * 5) - 2) * 2;
        if (r() < 0.82) notes.push({ step, len, deg: note });
        d = note;
      }
    }
    return notes;
  }

  // ── voices ───────────────────────────────────────────────────
  // sustained string swell (a detuned sawtooth stack)
  function str(t, freq, dur, vol) {
    const n = 3; const g = c.createGain(); g.gain.value = vol; g.connect(strings); g.connect(M.dly);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400 + 900 * (M.I || 0.3); f.Q.value = 0.6; f.connect(g);
    for (let i = 0; i < n; i++) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = (i - 1) * 7;
      o.connect(f); o.start(t); o.stop(t + dur + 0.1);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.5, dur * 0.4));
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
  }
  // brass hit (sawtooth -> bandpass), staccato on the strong beats
  function bra(t, freq, dur, vol, q) {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq * 2; f.Q.value = q || 1.2;
    const g = c.createGain(); o.connect(f); f.connect(g); g.connect(brass);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.linearRampToValueAtTime(vol * 0.6, t + 0.18);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // timpani hit (sine pitch drop + noise)
  function tim(t, freq, vol) {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.4);
    const g = c.createGain(); o.connect(g); g.connect(timb);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.start(t); o.stop(t + 0.55);
    const ns = c.createBufferSource(); ns.buffer = noiseBuf;
    const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 400;
    const ng = c.createGain(); ns.connect(nf); nf.connect(ng); ng.connect(timb);
    ng.gain.setValueAtTime(vol * 0.4, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    ns.start(t); ns.stop(t + 0.15);
  }
  // bass ostinato
  function bas(t, freq, dur, vol) {
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = c.createGain(); o.connect(g); g.connect(bass);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.03); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
  }
  // bell (FM) — the verdant signature
  function bel(t, freq, dur, vol) {
    const o = c.createOscillator(); o.frequency.value = freq;
    const m = c.createOscillator(); m.frequency.value = freq * 3;
    const mg = c.createGain(); mg.gain.value = freq * 2; m.connect(mg); mg.connect(o.frequency);
    const g = c.createGain(); o.connect(g); g.connect(bell); g.connect(M.dly);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); m.start(t); o.stop(t + dur + 0.05); m.stop(t + dur + 0.05);
  }

  // per-domain instrument weights: timpani, brass, strings, bells, bass, brass filter Q
  const DOM = {
    ground: { tim: 1, bra: 1, str: 1, bel: 1, bas: 1, arp: 0 },
    air:    { tim: 0.5, bra: 1.1, str: 1.15, bel: 0.8, bas: 0.8, arp: 1 },
    space:  { tim: 0.35, bra: 0.55, str: 1.5, bel: 1.5, bas: 1, arp: 0 },
  };

  // ── scheduler ────────────────────────────────────────────────
  function tick() {
    if (!M.on) return;
    const bpm = M.bpm * M.tempoMul * (M.mode === 'map' ? 0.62 : 1), spb = 60 / bpm; const step = spb / 4; // 16th
    while (M._nextT < c.currentTime + 0.16) {
      scheduleStep(M._step, M._nextT, step);
      M._step = (M._step + 1) % 64; M._nextT += step;
    }
  }
  function scheduleStep(step, t, stepDur) {
    const I = M.I, S = M.st, D = DOM[M.domain] || DOM.ground, map = M.mode === 'map';
    // section logic (per 4 bars)
    if (step % 64 === 0) {
      M.sectBars = 0;
      if (M.won) M.section = 'fanfare';
      else if (M.lost) M.section = 'dirge';
      else if (map) M.section = 'map';
      else if (I > 0.66 || S.lastStand) M.section = 'battle';
      else if (I > 0.34) M.section = 'pulse';
      else M.section = 'drift';
      // the winning side hears the major-leaning lydian colour, the losing side the harmonic minor
      const th = theme(M.faction);
      M.mode_ = S.losing || M.lost ? MODES.phrygian : S.winning ? (M.baseMode === MODES.aeolian ? MODES.dorian : M.baseMode) : M.baseMode;
      void th;
    }
    if (step % 32 === 0) { // every 2 bars: maybe change chord
      M.deg = pick(M.r, (S.losing || M.lost ? CHAIN_LOSE : CHAIN)[M.deg] || CHAIN[0]);
      M.chord = chordOf(M.deg);
    }
    const beat = step % 16, sec = M.section;
    const rootMidi = M.root + M.chord[0];
    const chordMidi = M.chord.map(d => M.root + d + 12);

    if (sec === 'map') {   // the war table: slow pad, a low drone, sparse bells
      if (beat === 0) { for (const md of chordMidi) str(t, mtof(md - 12), stepDur * 16, 0.12); bas(t, mtof(rootMidi - 24), stepDur * 14, 0.5); }
      if (beat === 8 && step % 32 === 8) tim(t, mtof(rootMidi - 12), 0.35);
      if (beat % 4 === 2 && M.r() < 0.35) bel(t, mtof(chordMidi[Math.floor(M.r() * 3)] + 12), stepDur * 8, 0.16);
      return;
    }
    if (sec === 'dirge') {   // defeat: slow low brass + hollow timpani
      if (beat === 0) { for (const md of chordMidi) str(t, mtof(md - 24), stepDur * 16, 0.16); bra(t, mtof(rootMidi - 12), stepDur * 14, 0.3, 0.9); }
      if (beat === 0 || beat === 8) tim(t, mtof(rootMidi - 17), 0.7);
      if (beat === 4 && step % 32 === 4) bel(t, mtof(chordMidi[0]), stepDur * 12, 0.12);
      return;
    }

    // timpani pattern (Euclidean-ish), denser in battle
    const isDown = (beat === 0) || (beat === 8) || (sec === 'battle' && (beat === 4 || beat === 12));
    if (sec !== 'drift' && isDown && step % 2 === 0 && D.tim > 0.4) tim(t, mtof(rootMidi - 12), 0.7 * (0.6 + I * 0.6) * D.tim);
    else if (sec !== 'drift' && D.tim <= 0.4 && beat === 0) tim(t, mtof(rootMidi - 12), 0.5 * D.tim * 1.4);
    // offbeat rim in battle (and a heartbeat when the last tickets are going)
    if (sec === 'battle' && beat % 4 === 2 && D.tim > 0.4) tim(t, mtof(rootMidi - 5), 0.22);
    if (S.lastStand && (beat === 6 || beat === 14)) tim(t, mtof(rootMidi - 17), 0.4);

    // bass ostinato on beats 0 and 8
    if (beat === 0 || beat === 8) bas(t, mtof(rootMidi - 12), stepDur * 3, 0.5 * D.bas);

    // strings: swell the chord, hold across the bar
    if (beat === 0 || (sec !== 'drift' && beat === 8)) {
      for (const md of chordMidi) str(t, mtof(md - 12), stepDur * (sec === 'battle' && M.domain !== 'space' ? 6 : 10), (0.16 + I * 0.1) * D.str);
    }
    // air: a driving 8th-note string ostinato on the root and fifth
    if (D.arp && sec !== 'drift' && step % 2 === 0) bas(t, mtof(rootMidi + (step % 8 < 4 ? 0 : 7)), stepDur * 1.6, 0.16);
    // brass: staccato hits on the beat in pulse/battle/fanfare
    if ((sec === 'pulse' || sec === 'battle' || sec === 'fanfare') && beat % 4 === 0) {
      const md = chordMidi[beat % 8 < 4 ? 0 : 1];
      bra(t, mtof(md - 12 + (sec === 'fanfare' ? 12 : 0) + (M.domain === 'air' ? 12 : 0)), stepDur * 3, (0.28 + I * 0.15) * D.bra);
    }
    // bells: verdant flavour / sparkle on the top note; space leans on them
    if ((M.bell || M.domain === 'space') && beat % 4 === 2 && I > 0.2) bel(t, mtof(chordMidi[2]), stepDur * 5, 0.18 * Math.max(M.bell || 0.5, 0.5) * D.bel);

    // melody (leitmotif) — a note on most 8th notes, re-harmonised to the chord
    if (sec !== 'drift' && step % 2 === 0 && M.motif.length && !(S.losing && step % 4 === 2)) {
      const n = M.motif[Math.floor(step / 2) % M.motif.length];
      if (n && M.r() < 0.85) {
        const md = chordMidi[0] + ((n.deg % 7) + 7) % 7 + 12;
        if (M.bell > 0.8 || M.domain === 'space') bel(t, mtof(md), stepDur * Math.max(2, n.len), 0.22);
        else bra(t, mtof(md), stepDur * Math.max(2, n.len), 0.16 * D.bra);
      }
    }
  }

  // ── intensity, domain, battle state ──────────────────────────
  M.setIntensity = function (v) { M.I = E.clamp01(v); };
  M.setDomain = function (d) { if (DOM[d]) M.domain = d; };
  M.setMode = function (m) { if (M.mode !== m) { M.mode = m; M._step = Math.ceil(M._step / 64) * 64 % 64; if (m === 'map') { M.won = false; M.lost = false; } } };
  // st: { winning, losing, lastStand }
  M.setState = function (st) { M.st = st || {}; M.tempoMul = M.st.lastStand ? 1.12 : 1; };
  M.victory = function (factionId) { M.setTheme(factionId || M.faction, true); M.won = true; M.section = 'fanfare'; M.I = 1; M.sting('victory'); };
  M.defeat = function (factionId) { M.setTheme(factionId || M.faction, true); M.lost = true; M.section = 'dirge'; M.I = 0.5; M.sting('defeat'); };
  M.setVolume = function (v) { M.vol = v; if (E.Mixer) E.Mixer.setMix({ master: v }); };

  // one-shot stings played over the score
  M.sting = function (kind) {
    if (!M.on) return; const t = c.currentTime + 0.05, root = M.root, m = M.mode_ || MODES.aeolian;
    if (kind === 'victory') {   // rising brass triad + bell shimmer
      [0, 7, 12, 16].forEach((s, i) => { bra(t + i * 0.16, mtof(root + 12 + s), 1.4, 0.45); str(t + i * 0.16, mtof(root + s), 3.5, 0.2); });
      bel(t + 0.6, mtof(root + 31), 3, 0.3); tim(t, mtof(root - 12), 1); tim(t + 0.5, mtof(root - 12), 1);
    } else if (kind === 'defeat') {   // falling minor line over a low drone
      [12, 10, 7, 3, 0].forEach((s, i) => { bra(t + i * 0.45, mtof(root + s), 1.6, 0.34, 0.9); });
      for (const s of [0, 3, 7]) str(t, mtof(root - 12 + s), 6, 0.2); tim(t, mtof(root - 24), 1); tim(t + 0.9, mtof(root - 24), 0.9);
    } else if (kind === 'shipLost') {   // a heavy low hit with a hollow bell
      tim(t, mtof(root - 24), 1); bra(t, mtof(root - 12 + m[3]), 1.2, 0.3, 0.8); bel(t + 0.2, mtof(root + 12 + m[4]), 2.2, 0.2);
    } else if (kind === 'capture') {
      bel(t, mtof(root + 24), 1.5, 0.25); bel(t + 0.12, mtof(root + 31), 1.5, 0.2);
    } else if (kind === 'alert') {
      tim(t, mtof(root - 12), 0.8); tim(t + 0.25, mtof(root - 12), 0.6);
    } else if (kind === 'turn') {
      str(t, mtof(root), 3, 0.2); str(t, mtof(root + 7), 3, 0.15); bel(t + 0.2, mtof(root + 24), 2, 0.2);
    }
  };

  E.Music = M;
})(window.E = window.E || {});
