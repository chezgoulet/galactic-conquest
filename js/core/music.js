// The score. Orchestral, adaptive and synthesized in real time — no samples.
// A lookahead scheduler plays 16th-note steps on the AudioContext clock. Harmony
// is a Markov chain over the faction's mode (cinematic moves), melody is the
// faction's seeded leitmotif re-harmonised per bar, and voices are strings,
// brass, timpani and a bass ostinato. An intensity signal from the match moves
// the score between sections (drift -> pulse -> battle) and drives a victory
// fanfare. Every note is built from oscillators, filters and gains.
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
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s >>>= 0; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function pick(r, arr) { let tot = 0; for (const [, w] of arr) tot += w; let x = r() * tot; for (const [v, w] of arr) { x -= w; if (x <= 0) return v; } return arr[0][0]; }
  function theme(factionId) { const f = E.faction(factionId); return f.music; }

  const M = { on: false, faction: 'aegis', I: 0.2, won: false, vol: 0.8 };
  let c, out, master, strings, brass, timb, bass, bell, rev, dly, noiseBuf;

  function hall(sec) {
    const len = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const x = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) { const t = i / len; lp += ((Math.random() * 2 - 1) - lp) * (1 - (0.08 + 0.9 * t) * 0.95);
        x[i] = lp * Math.pow(1 - t, 2.4) * (i < c.sampleRate * 0.01 ? i / (c.sampleRate * 0.01) : 1); } }
    return b;
  }

  M.start = function (factionId) {
    if (M.on) return;
    if (typeof AudioContext === 'undefined') return;
    c = new (window.AudioContext || window.webkitAudioContext)();
    M.on = true;
    out = c.createGain(); out.gain.value = 0.0; out.connect(c.destination);
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -18; comp.knee.value = 14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    comp.connect(out);
    master = c.createGain(); master.gain.value = 0.9; master.connect(comp);
    // vast dark hall
    rev = c.createConvolver(); rev.buffer = hall(4.5);
    const revG = c.createGain(); revG.gain.value = 0.5; rev.connect(revG); revG.connect(master);
    const revIn = c.createGain(); revIn.connect(rev);
    M.revIn = revIn;
    // ping-pong delay (tempo-synced)
    dly = c.createDelay(2); dly.delayTime.value = 0.42;
    const fb = c.createGain(); fb.gain.value = 0.32; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    dly.connect(lp); lp.connect(fb); fb.connect(dly);
    const dOut = c.createGain(); dOut.gain.value = 0.28; dly.connect(dOut); dOut.connect(master);
    M.dly = dly;
    // buses
    const bus = (l, r) => { const g = c.createGain(); g.gain.value = l; g.connect(master); const rg = c.createGain(); rg.gain.value = r; rg.connect(M.revIn); return { g, rg }; };
    const s = bus(0.5, 0.5), br = bus(0.42, 0.4), ti = bus(0.5, 0.2), ba = bus(0.4, 0.2), be = bus(0.3, 0.6);
    strings = s.g; brass = br.g; timb = ti.g; bass = ba.g; bell = be.g;
    // noise buffer
    noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    M.setTheme(factionId || 'aegis', true);
    out.gain.setTargetAtTime(M.vol, c.currentTime, 1.2);
    M._step = 0; M._nextT = c.currentTime + 0.12;
    M._timer = setInterval(tick, 25);
  };
  M.stop = function () { if (!M.on) return; clearInterval(M._timer); out.gain.setTargetAtTime(0, c.currentTime, 0.4); const cc = c; setTimeout(() => cc.close().catch(() => {}), 600); M.on = false; };
  M.resume = function () { if (M.on && c && c.state === 'suspended') c.resume(); };

  M.setTheme = function (factionId, hard) {
    M.faction = factionId;
    const th = theme(factionId);
    M.mode = MODES[th.mode] || MODES.aeolian;
    M.root = th.root; M.bpm = th.bpm; M.motifSeed = th.motif; M.bell = th.bell; M.saw = th.saw;
    M.r = rng(th.motif * 7919);
    M.motif = makeMotif(rng(th.motif * 7919 + 3), 4);
    M.deg = 0; M.chord = chordOf(0); M.chordBars = 0;
    M.section = 'drift'; M.sectBars = 0; M.won = false;
    M.impactT = 0;
  };

  function chordOf(deg) { const m = M.mode; return [m[deg % 7], m[(deg + 2) % 7], m[(deg + 4) % 7]]; }

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
  function env(g, t, a, d, s, r, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.linearRampToValueAtTime(peak * s, t + a + d);
    g.gain.setValueAtTime(peak * s, t + a + d + Math.max(0.01, 0));
    g.gain.linearRampToValueAtTime(0.0001, t + a + d + r);
  }
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
  function bra(t, freq, dur, vol) {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq * 2; f.Q.value = 1.2;
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

  // ── scheduler ────────────────────────────────────────────────
  function tick() {
    if (!M.on) return;
    const spb = 60 / M.bpm; const step = spb / 4; // 16th
    while (M._nextT < c.currentTime + 0.16) {
      scheduleStep(M._step, M._nextT, step);
      M._step = (M._step + 1) % 64; M._nextT += step;
    }
  }
  function scheduleStep(step, t, stepDur) {
    const I = M.I;
    // section logic (per 4 bars)
    if (step % 64 === 0) {
      M.sectBars = 0;
      if (M.won) M.section = 'fanfare';
      else if (I > 0.66) M.section = 'battle';
      else if (I > 0.34) M.section = 'pulse';
      else M.section = 'drift';
      // new chord every 2 bars on section start
    }
    if (step % 32 === 0) { // every 2 bars: maybe change chord
      M.deg = pick(M.r, CHAIN[M.deg] || CHAIN[0]);
      M.chord = chordOf(M.deg);
    }
    const bar = Math.floor(step / 16);
    const beat = step % 16;
    const rootMidi = M.root + M.chord[0];
    const chordMidi = M.chord.map(d => M.root + d + 12);

    // timpani pattern (Euclidean-ish), denser in battle
    const isDown = (beat === 0) || (beat === 8) || (M.section === 'battle' && (beat === 4 || beat === 12));
    if (M.section !== 'drift' && isDown && step % 2 === 0) tim(t, mtof(rootMidi - 12), 0.7 * (0.6 + I * 0.6));
    // offbeat rim in battle
    if (M.section === 'battle' && beat % 4 === 2) tim(t, mtof(rootMidi - 5), 0.22);

    // bass ostinato on beats 0 and 8
    if (beat === 0 || beat === 8) bas(t, mtof(rootMidi - 12), stepDur * 3, 0.5);

    // strings: swell the chord, hold across the bar
    if (beat === 0 || (M.section !== 'drift' && beat === 8)) {
      for (const md of chordMidi) str(t, mtof(md - 12), stepDur * (M.section === 'battle' ? 6 : 10), 0.16 + I * 0.1);
    }
    // brass: staccato hits on the beat in pulse/battle/fanfare
    if ((M.section === 'pulse' || M.section === 'battle' || M.section === 'fanfare') && beat % 4 === 0) {
      const md = chordMidi[beat % 8 < 4 ? 0 : 1];
      bra(t, mtof(md - 12 + (M.section === 'fanfare' ? 12 : 0)), stepDur * 3, 0.28 + I * 0.15);
    }
    // bells: verdant flavour / sparkle on the top note
    if (M.bell && beat % 4 === 2 && I > 0.3) bel(t, mtof(chordMidi[2]), stepDur * 5, 0.18 * M.bell);

    // melody (leitmotif) — a note on most 8th notes, re-harmonised to the chord
    if (M.section !== 'drift' && step % 2 === 0 && M.motif.length) {
      const n = M.motif[Math.floor(step / 2) % M.motif.length];
      if (n && M.r() < 0.85) {
        const md = chordMidi[0] + ((n.deg % 7) + 7) % 7 + 12;
        if (M.bell > 0.8) bel(t, mtof(md), stepDur * Math.max(2, n.len), 0.22);
        else bra(t, mtof(md), stepDur * Math.max(2, n.len), 0.16);
      }
    }
  }

  // ── intensity + victory ──────────────────────────────────────
  M.setIntensity = function (v) { M.I = E.clamp01(v); };
  M.victory = function (factionId) { M.setTheme(factionId || M.faction, true); M.won = true; M.section = 'fanfare'; M.I = 1; };
  M.setVolume = function (v) { M.vol = v; if (M.on && out) out.gain.setTargetAtTime(v, c.currentTime, 0.1); };

  // ── SFX (synthesized) ────────────────────────────────────────
  const SFX = {
    play(kind, t, vol) {
      if (!M.on) return; t = t || c.currentTime; vol = vol == null ? 1 : vol;
      const out2 = c.createGain(); out2.gain.value = vol; out2.connect(master);
      switch (kind) {
        case 'rifle': {
          const o = c.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(180, t + 0.12);
          const g = c.createGain(); o.connect(g); g.connect(out2);
          g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
          const ns = c.createBufferSource(); ns.buffer = noiseBuf; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200;
          const ng = c.createGain(); ns.connect(f); f.connect(ng); ng.connect(out2); ng.gain.setValueAtTime(0.3, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
          o.start(t); o.stop(t + 0.15); ns.start(t); ns.stop(t + 0.09); break;
        }
        case 'cannon': case 'capital': case 'pulse': {
          const big = kind === 'capital';
          const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(big ? 90 : 160, t); o.frequency.exponentialRampToValueAtTime(40, t + (big ? 0.5 : 0.25));
          const g = c.createGain(); o.connect(g); g.connect(out2);
          g.gain.setValueAtTime(big ? 0.9 : 0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + (big ? 0.6 : 0.3));
          const ns = c.createBufferSource(); ns.buffer = noiseBuf; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = big ? 300 : 700; f.Q.value = 0.7;
          const ng = c.createGain(); ns.connect(f); f.connect(ng); ng.connect(out2);
          ng.gain.setValueAtTime(big ? 0.5 : 0.3, t); ng.gain.exponentialRampToValueAtTime(0.001, t + (big ? 0.4 : 0.18));
          o.start(t); o.stop(t + 0.7); ns.start(t); ns.stop(t + 0.45); break;
        }
        case 'lance': case 'spore': {
          const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.1);
          const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 2;
          const g = c.createGain(); o.connect(f); f.connect(g); g.connect(out2);
          g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
          o.start(t); o.stop(t + 0.13); break;
        }
        case 'missile': {
          const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.4);
          const g = c.createGain(); o.connect(g); g.connect(out2); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
          o.start(t); o.stop(t + 0.42); break;
        }
        case 'pd': {
          const ns = c.createBufferSource(); ns.buffer = noiseBuf; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
          const g = c.createGain(); ns.connect(f); f.connect(g); g.connect(out2); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
          ns.start(t); ns.stop(t + 0.05); break;
        }
        case 'shield': {
          const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(520, t); o.frequency.linearRampToValueAtTime(300, t + 0.2);
          const g = c.createGain(); o.connect(g); g.connect(out2); g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
          o.start(t); o.stop(t + 0.22); break;
        }
        case 'explosion': {
          const ns = c.createBufferSource(); ns.buffer = noiseBuf; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(80, t + 0.5);
          const g = c.createGain(); ns.connect(f); f.connect(g); g.connect(out2);
          g.gain.setValueAtTime(0.8, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
          const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
          const og = c.createGain(); o.connect(og); og.connect(out2); og.gain.setValueAtTime(0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
          ns.start(t); ns.stop(t + 0.6); o.start(t); o.stop(t + 0.6); break;
        }
        case 'ui': {
          const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 660; const g = c.createGain(); o.connect(g); g.connect(out2);
          g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08); o.start(t); o.stop(t + 0.09); break;
        }
        case 'launch': {
          const ns = c.createBufferSource(); ns.buffer = noiseBuf; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(1200, t + 0.4);
          const g = c.createGain(); ns.connect(f); f.connect(g); g.connect(out2); g.gain.setValueAtTime(0.3, t); g.gain.linearRampToValueAtTime(0.5, t + 0.3); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
          ns.start(t); ns.stop(t + 0.55); break;
        }
        case 'hitmark': case 'kill': {
          const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(kind === 'kill' ? 1250 : 1900, t); o.frequency.exponentialRampToValueAtTime(kind === 'kill' ? 620 : 1500, t + 0.09);
          const g = c.createGain(); o.connect(g); g.connect(out2); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'kill' ? 0.22 : 0.06)); o.start(t); o.stop(t + 0.25); break;
        }
        case 'hurt': {
          const ns = c.createBufferSource(); ns.buffer = noiseBuf; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
          const g = c.createGain(); ns.connect(f); f.connect(g); g.connect(out2); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16); ns.start(t); ns.stop(t + 0.18); break;
        }
        case 'capture': {
          [0, 4, 7, 12].forEach((s, i) => { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = 440 * Math.pow(2, s / 12); const g = c.createGain(); o.connect(g); g.connect(out2); g.connect(M.revIn);
            const a = t + i * 0.09; g.gain.setValueAtTime(0.0001, a); g.gain.linearRampToValueAtTime(0.22, a + 0.02); g.gain.exponentialRampToValueAtTime(0.001, a + 0.5); o.start(a); o.stop(a + 0.55); }); break;
        }
        case 'alarm': {
          for (let i = 0; i < 3; i++) { const o = c.createOscillator(); o.type = 'square'; const a = t + i * 0.28; o.frequency.setValueAtTime(880, a); o.frequency.linearRampToValueAtTime(660, a + 0.2); const g = c.createGain(); o.connect(g); g.connect(out2); g.gain.setValueAtTime(0.12, a); g.gain.exponentialRampToValueAtTime(0.001, a + 0.24); o.start(a); o.stop(a + 0.26); } break;
        }
        default: break;
      }
    },
  };

  // route sim events to SFX (called with drained events + volume by distance)
  M.onEvents = function (events) {
    for (const e of events) {
      if (e.type === 'muzzle') SFX.play(e.kind === 'capital' ? 'capital' : (e.kind === 'missile' ? 'missile' : (e.kind === 'pd' ? 'pd' : 'pulse')));
      else if (e.type === 'impact') SFX.play('explosion', null, 0.5);
      else if (e.type === 'death') SFX.play('explosion', null, e.kind === 'capital' ? 1 : e.kind === 'vehicle' ? 0.8 : 0.5);
      else if (e.type === 'shieldhit') SFX.play('shield', null, 0.5);
      else if (e.type === 'launch') SFX.play('launch');
      else if (e.type === 'objectiveCaptured') SFX.play('explosion', null, 0.9);
    }
  };

  E.Music = M;
  E.SFX = SFX;
})(window.E = window.E || {});
