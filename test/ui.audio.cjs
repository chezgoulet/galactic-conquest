// Audio level test. The mixer is injected with an OfflineAudioContext, key sounds and a dense fight are
// rendered, and peak / RMS (dBFS), clipping and the "vacuum muffles exterior sound" behaviour are checked.
// This does NOT replace listening: nothing here says a sound is pleasant, only that it is audible,
// bounded by the limiter and routed through the right bus.
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const ROOT = path.join(__dirname, '..');
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const canConnect = (port) => new Promise((res) => { const s = net.connect({ host: '127.0.0.1', port }); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });

(async () => {
  const port = await freePort();
  const server = spawn('node', [path.join(ROOT, 'tools', 'serve.cjs'), String(port)], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { if (await canConnect(port)) break; await new Promise(r => setTimeout(r, 100)); }
  const BACKEND = process.env.GC_UI_BACKEND === 'webgl' ? 'webgl' : 'webgpu';
  const browser = await chromium.launch({ headless: true, args: (BACKEND === 'webgl'
    ? ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-features=WebGPU']
    : ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu', '--enable-features=Vulkan']).concat('--autoplay-policy=no-user-gesture-required') });
  const page = await browser.newPage();
  await page.addInitScript((backend) => { if (backend === 'webgl') window.GC_BACKEND = 'webgl'; }, BACKEND);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__GC_READY__ === true', null, { timeout: 120000, polling: 300 });
  const res = await page.evaluate(async () => {
    const E = window.E, M = E.Mixer, SR = 44100;
    const stats = (buf) => { const d = buf.getChannelData(0), e = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d; let pk = 0, ss = 0, df = 0, nan = 0;
      for (let i = 0; i < d.length; i++) { const v = Math.max(Math.abs(d[i]), Math.abs(e[i])); if (v !== v) nan++; if (v > pk) pk = v; ss += d[i] * d[i]; if (i) df += (d[i] - d[i - 1]) ** 2; }
      return { peak: +(20 * Math.log10(pk || 1e-9)).toFixed(1), rms: +(10 * Math.log10(ss / d.length || 1e-12)).toFixed(1), bright: +(df / (ss || 1)).toFixed(3), nan, clip: pk > 1.0 }; };
    const fresh = (sec, dens) => { dens = dens == null ? 1 : dens; M.ready = false; M.buses = {}; M.voices = 0; M.density = 0; M.env = { dens, vac: dens < 0.08, interior: false }; const c = new OfflineAudioContext(2, SR * sec, SR); M.init(c); M.listener = { x: 0, y: 0, z: 0, rx: 1, ry: 0, rz: 0 }; return c; };
    const out = { sounds: {}, fight: null, vacuum: null, loops: {} };
    const kinds = ['rifle', 'repeater', 'lance', 'rocket', 'launch', 'cannon', 'pulse', 'laser', 'chin', 'pod', 'torpedo', 'capital', 'pd', 'orbital', 'ion', 'bolthit', 'shieldhit', 'hullhit', 'sysboom', 'breach', 'covbreak', 'boom0', 'boom1', 'boom2', 'boom3', 'hitmark', 'kill', 'hurt', 'capture', 'alarm', 'klaxon', 'lock', 'locked', 'msl', 'stall', 'flare', 'whistle', 'boost', 'call', 'deny', 'thud', 'stinger', 'footstep', 'ui', 'select', 'confirm', 'move', 'build', 'endturn', 'enemy', 'ops'];
    for (const k of kinds) {
      const c = fresh(6); E.SFX.play(k, 0, 1, { pos: { x: 0, y: 0, z: 25 } }); if (!E.SFX.kinds[k]) { out.sounds[k] = 'missing'; continue; }
      out.sounds[k] = stats(await c.startRendering());
    }
    // a dense fight: 70 rifle shots, 14 explosions, 6 capital salvos, 20 shield hits, in 5 seconds at various positions
    { const c = fresh(7); const R = (a, b) => a + Math.random() * (b - a);
      for (let i = 0; i < 70; i++) E.SFX.play(['rifle', 'repeater', 'pulse', 'rocket'][i % 4], R(0, 5), 1, { pos: { x: R(-80, 80), y: 0, z: R(10, 120) } });
      for (let i = 0; i < 14; i++) E.SFX.play(['boom1', 'boom2', 'boom3'][i % 3], R(0, 5), 1, { pos: { x: R(-200, 200), y: 0, z: R(30, 300) } });
      for (let i = 0; i < 6; i++) E.SFX.play('capital', R(0, 5), 1, { pos: { x: R(-900, 900), y: 300, z: R(500, 1500) } });
      for (let i = 0; i < 20; i++) E.SFX.play('shieldhit', R(0, 5), 1, { pos: { x: R(-300, 300), y: 100, z: R(100, 600) } });
      E.SFX.play('orbital', 1, 1, { pos: { x: 0, y: 300, z: 200 } }); E.SFX.play('klaxon', 2, 1, { interior: true }); E.SFX.play('msl', 3, 1, { interior: true });
      out.fight = stats(await c.startRendering()); }
    // vacuum vs air: the same rifle shot at 40 m; the vacuum render must be darker (less high-frequency content) and quieter
    for (const [name, dens] of [['air', 1], ['vacuum', 0]]) { const c = fresh(4, dens); E.SFX.play('rifle', 2, 1, { pos: { x: 0, y: 0, z: 40 } }); E.SFX.play('flare', 2.5, 1, { pos: { x: 0, y: 0, z: 40 } }); const b = await c.startRendering(); (out.vacuum = out.vacuum || {})[name] = Object.assign(stats(b), { lp: Math.round(M.buses.weapons.extLP.frequency.value), g: +M.buses.weapons.extGain.gain.value.toFixed(2) }); }
    // loops: jet at full throttle with afterburner, in air and in space; reactor; vehicle
    for (const [name, mk, p] of [['jet-air', 'jet', { thr: 1, boost: true, dens: 1, speed: 200, buffet: 0.3 }], ['jet-space', 'jet', { thr: 1, boost: true, dens: 0, speed: 200 }], ['reactor', 'reactor', { thr: 1, engines: 0.55, core: 1 }], ['vehicle', 'vehicle', { speed: 1, servo: 1, heavy: 1 }], ['wind', 'wind', { dens: 1, gain: 1 }]]) {
      const c = fresh(3); const L = E.SFX.loops[mk]({ interior: true, heavy: 1 }); L.set(Object.assign({ gain: 0.8 }, p)); out.loops[name] = stats(await c.startRendering()); }
    return out;
  });
  // ── live music smoke on a second page of the SAME browser ──
  // (kept here rather than as a 4th browser launch: the UI job runs several
  //  Chromium instances and a fresh one this late was flaky on CI)
  let mres = null;
  try {
    const mp = await browser.newPage();
    await mp.addInitScript((backend) => { window.GC_QUALITY = 'low'; window.GC_RES = 0.4; window.GC_NO_GOV = true; if (backend === 'webgl') window.GC_BACKEND = 'webgl'; }, BACKEND);
    mp.on('pageerror', (e) => errors.push('music: ' + e.message));
    mp.on('console', (m) => { if (m.type() === 'error') errors.push('music console: ' + m.text()); });
    await mp.goto(`http://localhost:${port}/index.html`, { waitUntil: 'load', timeout: 60000 });
    await mp.waitForFunction('window.__GC_READY__ === true', null, { timeout: 120000, polling: 300 });
    mres = await mp.evaluate(async () => {
      const E = window.E, out = {}; const wait = (ms) => new Promise(r => setTimeout(r, ms));
      E.Mixer.unlock(); if (E.Mixer.ctx && E.Mixer.ctx.state === 'suspended') { try { await E.Mixer.ctx.resume(); } catch (e) {} }
      E.Music.start('aegis'); out.started = E.Music.on;
      E.Music.setDomain('ground'); E.Music.setIntensity(0.5); E.Music.setState({});
      await wait(900); const a = E.Music._step;
      E.Music.setDomain('air'); E.Music.setIntensity(0.95); E.Music.setState({ lastStand: true }); await wait(900);
      out.advanced = E.Music._step !== a; out.hook = !!(E.Music._hooks && Object.keys(E.Music._hooks).length);
      E.Music.setMode('map'); E.Music.setDomain('space'); await wait(400); E.Music.setMode('battle');
      for (const k of ['victory', 'defeat', 'capture', 'shipLost', 'alert', 'turn']) { try { k === 'victory' ? E.Music.victory('aegis') : k === 'defeat' ? E.Music.defeat('verdant') : E.Music.sting(k); } catch (e) { out['stingErr_' + k] = String(e.message); } await wait(120); }
      E.Music.setVolume(0.5); E.Music.stop(); out.stopped = !E.Music.on;
      return out;
    });
    await mp.close();
  } catch (e) { errors.push('music phase: ' + (e && e.message || e)); }
  await browser.close(); server.kill('SIGKILL');
  let bad = 0; const line = (n, s) => console.log(String(n).padEnd(12), typeof s === 'string' ? s : `peak ${String(s.peak).padStart(6)} dBFS  rms ${String(s.rms).padStart(6)} dBFS  bright ${s.bright}${s.clip ? '  CLIP' : ''}${s.nan ? '  NaN!' : ''}`);
  console.log('--- one-shots (vol 1, 25 m away) ---'); for (const k in res.sounds) { line(k, res.sounds[k]); const s = res.sounds[k]; if (typeof s === 'string' || s.clip || s.nan || s.peak < -60) bad++; }
  console.log('--- dense fight (limited) ---'); line('fight', res.fight); if (res.fight.clip || res.fight.nan || res.fight.peak < -30) bad++;
  console.log('--- air vs vacuum, same rifle shot at 40 m ---'); line('air', res.vacuum.air); line('vacuum', res.vacuum.vacuum);
  console.log('exterior filter: air ' + res.vacuum.air.lp + ' Hz x' + res.vacuum.air.g + ', vacuum ' + res.vacuum.vacuum.lp + ' Hz x' + res.vacuum.vacuum.g); if (!(res.vacuum.vacuum.lp < 800 && res.vacuum.air.lp > 15000 && res.vacuum.vacuum.g < 0.5)) { console.error('FAIL: the vacuum exterior filter is not engaged (render comparison of one rifle shot was inconclusive, see report)'); bad++; }
  console.log('--- loops ---'); for (const k in res.loops) { line(k, res.loops[k]); if (res.loops[k].clip || res.loops[k].nan || res.loops[k].peak < -70) bad++; }
  console.log('--- music (live) ---');
  if (!mres) { console.error('FAIL: music phase did not run'); bad++; }
  else {
    console.log('started', mres.started, '| advanced', mres.advanced, '| hook', mres.hook, '| stopped', mres.stopped);
    if (!mres.started || !mres.advanced || !mres.hook || !mres.stopped) { console.error('FAIL: the music engine did not run'); bad++; }
    for (const k in mres) if (/^stingErr_/.test(k)) { console.error('FAIL', k, mres[k]); bad++; }
  }
  if (errors.length) { console.error('page errors', errors); bad++; }
  console.log(bad ? 'ui.audio FAIL (' + bad + ')' : 'ui.audio ok');
  process.exit(bad ? 1 : 0);
})();
