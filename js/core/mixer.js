// The mixer. One AudioContext, six buses (music, weapons, impacts, ambience,
// voice/alerts, ui), a limiter at the end, positional panning and distance
// roll-off from a listener, density-aware ducking and an "environment" filter
// that muffles every exterior sound when the air thins out (the sim's `dens`
// goes to 0 in space). Nothing here makes a sound by itself: sfx.js, music.js
// and ui/audio.js build voices and hand them to Mixer.input()/Mixer.voice().
// An OfflineAudioContext can be injected with Mixer.init(ctx) for level tests.
(function (E) {
  'use strict';
  const M = { ctx: null, ready: false, buses: {}, listener: { x: 0, y: 0, z: 0, rx: 1, ry: 0, rz: 0 }, density: 0, voices: 0, maxVoices: 30,
    env: { dens: 1, vac: false, interior: false }, vol: { master: 0.8, music: 0.8, sfx: 0.9, ambience: 0.8, voice: 1, ui: 0.8 }, alertUntil: 0, noise: null, brown: null };
  const BUSES = ['music', 'weapons', 'impacts', 'ambience', 'voice', 'ui'];
  const WORLD = { weapons: 1, impacts: 1, ambience: 1 };
  // Percussive buses run hotter than the rest so single hits stay punchy and the
  // limiter only catches the sum of a big fight (it used to flatten everything).
  const GAIN = { music: 0.85, weapons: 0.95, impacts: 1.05, ambience: 0.55, voice: 0.85, ui: 0.75 };
  M.BUSES = BUSES;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // build the graph on `ctx` (a new AudioContext unless one is injected)
  M.init = function (ctx) {
    if (M.ready) return M.ctx;
    if (!ctx) { const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext); if (!AC) return null; ctx = new AC(); }
    const c = M.ctx = ctx;
    M.offline = typeof OfflineAudioContext !== 'undefined' && c instanceof OfflineAudioContext;
    // master chain: pre -> master gain -> limiter -> out gain -> destination
    M.pre = c.createGain();
    M.master = c.createGain(); M.master.gain.value = M.vol.master;
    const lim = M.limiter = c.createDynamicsCompressor();
    // A gentler, faster limiter: catches the dense-fight sum but lets single
    // transients through instead of squashing every shot to the same level.
    lim.threshold.value = -1.5; lim.knee.value = 6; lim.ratio.value = 8; lim.attack.value = 0.003; lim.release.value = 0.1;
    M.out = c.createGain(); M.out.gain.value = 0.86;
    M.pre.connect(M.master); M.master.connect(lim); lim.connect(M.out); M.out.connect(c.destination);
    M.meter = c.createAnalyser(); M.meter.fftSize = 2048; M.out.connect(M.meter);
    // shared noise buffers
    const n = Math.floor(c.sampleRate * 2.5), nb = c.createBuffer(1, n, c.sampleRate), d = nb.getChannelData(0);
    let seed = 1234567; for (let i = 0; i < n; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = (seed / 2147483648) - 1; }
    M.noise = nb;
    const bb = c.createBuffer(1, n, c.sampleRate), bd = bb.getChannelData(0); let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * d[i]) / 1.02; bd[i] = last * 3.5; }
    M.brown = bb;
    // reverb: dark hall, fed by sends
    M.revIn = c.createGain(); const conv = c.createConvolver(); conv.buffer = hall(c, 3.2); const rg = c.createGain(); rg.gain.value = 0.55;
    M.revIn.connect(conv); conv.connect(rg); rg.connect(M.pre);
    // buses
    for (const name of BUSES) {
      const gain = c.createGain(), duck = c.createGain(); gain.gain.value = GAIN[name] * busVol(name); duck.gain.value = 1;
      gain.connect(duck); duck.connect(M.pre);
      const b = M.buses[name] = { name, gain, duck, ext: null };
      if (WORLD[name]) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.5; const eg = c.createGain(); lp.connect(eg); eg.connect(gain); b.ext = lp; b.extGain = eg; b.extLP = lp; }
    }
    M.ready = true;
    M.applyEnv();
    return c;
  };
  function busVol(name) { const v = M.vol; return name === 'music' ? v.music : name === 'ambience' ? v.ambience : name === 'voice' ? v.voice : name === 'ui' ? v.ui : v.sfx; }
  function hall(c, sec) {
    const len = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, len, c.sampleRate); let s = 99991;
    for (let ch = 0; ch < 2; ch++) { const x = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) { s = (s * 1664525 + 1013904223) >>> 0; const r = s / 2147483648 - 1, t = i / len; lp += (r - lp) * (1 - (0.08 + 0.9 * t) * 0.95); x[i] = lp * Math.pow(1 - t, 2.4) * (i < c.sampleRate * 0.01 ? i / (c.sampleRate * 0.01) : 1); } }
    return b;
  }
  // browsers need a gesture before audio can run
  M.unlock = function () { if (!M.ctx) { if (!M.init()) return false; } if (M.ctx.state === 'suspended' && M.ctx.resume) M.ctx.resume(); return true; };
  M.now = () => (M.ctx ? M.ctx.currentTime : 0);

  // user mix: {master, music, sfx, ambience, voice, ui} each 0..1
  M.setMix = function (mix) {
    if (!mix) return;
    for (const k in M.vol) if (typeof mix[k] === 'number') M.vol[k] = clamp(mix[k], 0, 1);
    if (!M.ready) return; const t = M.ctx.currentTime;
    M.master.gain.setTargetAtTime(M.vol.master, t, 0.05);
    for (const n of BUSES) M.buses[n].gain.gain.setTargetAtTime(GAIN[n] * busVol(n), t, 0.05);
  };

  // where a voice plugs in: the bus (through the environment filter when it is an exterior sound)
  M.input = function (bus, interior) { const b = M.buses[bus]; return b.ext && !interior ? b.ext : b.gain; };

  // environment: dens 0..1 (0 = vacuum), interior = player inside a cockpit/bridge
  M.setEnv = function (dens, interior) { dens = clamp(dens, 0, 1); if (Math.abs(dens - M.env.dens) < 0.01 && interior === M.env.interior) return; M.env.dens = dens; M.env.vac = dens < 0.08; M.env.interior = !!interior; M.applyEnv(); };
  M.applyEnv = function () {
    if (!M.ready) return; const t = M.ctx.currentTime, e = M.env;
    // thin air carries high frequencies poorly and little energy overall; in vacuum only structure-borne sound is left
    const f = e.vac ? 520 : 1500 + 18500 * Math.pow(e.dens, 0.6), g = e.vac ? 0.38 : 0.55 + 0.45 * Math.pow(e.dens, 0.5);
    for (const n in WORLD) { const b = M.buses[n]; b.extLP.frequency.setTargetAtTime(f, t, 0.25); b.extGain.gain.setTargetAtTime(n === 'ambience' && e.vac ? 0.25 : g, t, 0.25); }
  };
  M.setListener = function (cam) {   // cam: THREE camera (matrixWorld)
    const L = M.listener, m = cam.matrixWorld.elements;
    L.x = m[12]; L.y = m[13]; L.z = m[14]; L.rx = m[0]; L.ry = m[1]; L.rz = m[2];
    if (M.ready && M.ctx.listener && M.ctx.listener.positionX) { /* panning is computed per voice; the native listener stays at the origin */ }
  };

  // distance roll-off: 1 inside `ref`, inverse-distance beyond, silent past `max`
  M.atten = function (d, ref, max) { if (d <= ref) return 1; if (d >= max) return 0; const k = ref / (ref + (d - ref) * 1.15); return k * Math.pow(1 - (d - ref) / (max - ref), 0.8); };
  M.distTo = function (p) { const L = M.listener; return Math.hypot(p.x - L.x, (p.y || 0) - L.y, p.z - L.z); };
  M.pan = function (p) { const L = M.listener, dx = p.x - L.x, dy = (p.y || 0) - L.y, dz = p.z - L.z, d = Math.hypot(dx, dy, dz) || 1; return clamp((dx * L.rx + dy * L.ry + dz * L.rz) / d, -1, 1) * Math.min(1, 0.35 + d / 25); };

  // A voice: returns the node a sound should connect to, already panned, attenuated
  // and air-filtered for `pos`. `end` (seconds) tells the mixer when the voice is over.
  // opts: bus, ref, max, send (reverb 0..1), interior, vol, prio
  M.voice = function (opts, pos, dur) {
    if (!M.ready) return null;
    const c = M.ctx;
    if (M.voices >= M.maxVoices && !(opts.prio > 1)) return null;
    let g = opts.vol == null ? 1 : opts.vol, d = 0;
    const chain = [];
    const out = c.createGain();
    let tail = out;
    if (pos) {
      d = M.distTo(pos); g *= M.atten(d, opts.ref || 20, opts.max || 600);
      if (g < 0.006) return null;
      if (d > 40) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = clamp(16000 / (1 + d / 90), 700, 16000); tail.connect(lp); tail = lp; }
      if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = M.pan(pos); tail.connect(p); tail = p; }
    }
    out.gain.value = g;
    tail.connect(M.input(opts.bus || 'weapons', opts.interior));
    if (opts.send && M.revIn) { const s = c.createGain(); s.gain.value = opts.send * Math.min(1, 0.4 + d / 300); tail.connect(s); s.connect(M.revIn); }
    M.voices++; setTimeout(() => { M.voices = Math.max(0, M.voices - 1); }, Math.max(80, (dur || 0.5) * 1000));
    M.density += (opts.bus === 'impacts' ? 0.16 : 0.07) * clamp(g * 2, 0.2, 1.2);
    return out;
  };

  // ducking: a big fight lowers music and ambience; alerts lower everything but the voice bus
  M.update = function (dt) {
    if (!M.ready) return;
    M.density = Math.max(0, M.density - dt * 0.9);
    const t = M.ctx.currentTime, dens = clamp(M.density / 1.4, 0, 1);
    const alert = t < M.alertUntil ? 1 : 0;
    M.buses.music.duck.gain.setTargetAtTime(1 - 0.38 * dens - 0.3 * alert, t, 0.12);
    M.buses.ambience.duck.gain.setTargetAtTime(1 - 0.5 * dens - 0.25 * alert, t, 0.15);
    M.buses.weapons.duck.gain.setTargetAtTime(1 - 0.18 * alert, t, 0.06);
    M.buses.impacts.duck.gain.setTargetAtTime(1 - 0.18 * alert, t, 0.06);
  };
  M.alert = function (sec) { if (M.ready) M.alertUntil = Math.max(M.alertUntil, M.ctx.currentTime + sec); };

  // measurement: peak and RMS (dBFS) of the output right now
  M.level = function () {
    if (!M.ready) return { peak: -Infinity, rms: -Infinity };
    const a = M.meter, buf = new Float32Array(a.fftSize); a.getFloatTimeDomainData(buf);
    let pk = 0, ss = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > pk) pk = v; ss += v * v; }
    return { peak: 20 * Math.log10(pk || 1e-9), rms: 10 * Math.log10(ss / buf.length || 1e-12) };
  };

  // small synthesis helpers shared by sfx.js / music.js / ui/audio.js
  M.noiseSrc = function (t, dur, out, o) {   // o: {type, f0, f1, q, gain, a, brown, loop}
    const c = M.ctx, s = c.createBufferSource(); s.buffer = o.brown ? M.brown : M.noise; s.loop = !!o.loop;
    if (!o.loop) s.playbackRate.value = 0.8 + ((t * 7919) % 1) * 0.4;
    let n = s;
    if (o.type) { const f = c.createBiquadFilter(); f.type = o.type; f.frequency.setValueAtTime(o.f0 || 1000, t); if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + dur); f.Q.value = o.q || 0.7; s.connect(f); n = f; }
    const g = c.createGain(); n.connect(g); g.connect(out);
    const pk = o.gain == null ? 0.5 : o.gain, a = o.a || 0.002;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pk, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.start(t, ((t * 3331) % 1) * 1.5); if (!o.loop) s.stop(t + dur + 0.02);
    return { src: s, gain: g };
  };
  M.tone = function (t, dur, out, o) {   // o: {type, f0, f1, gain, a, curve:'exp'|'lin', det}
    const c = M.ctx, osc = c.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t); if (o.f1) { if (o.curve === 'lin') osc.frequency.linearRampToValueAtTime(o.f1, t + dur); else osc.frequency.exponentialRampToValueAtTime(o.f1, t + dur); }
    if (o.det) osc.detune.value = o.det;
    const g = c.createGain(); osc.connect(g); g.connect(out); const pk = o.gain == null ? 0.4 : o.gain, a = o.a || 0.003;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(pk, t + a); if (o.sus) g.gain.setValueAtTime(pk * o.sus, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t); osc.stop(t + dur + 0.03);
    return { osc, gain: g };
  };

  E.Mixer = M;
})(window.E = window.E || {});
