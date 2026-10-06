// Music smoke test. Starts the score on a live AudioContext, drives it through
// intensity / domain / mode / state changes and every sting, and fails on any
// page error or if the scheduler did not advance. It does not judge the tune,
// only that the arrangement engine runs and never throws.
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
  for (let i = 0; i < 50; i++) { if (await canConnect(port)) break; await new Promise(r => setTimeout(r, 100)); }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-features=WebGPU'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(() => { window.GC_QUALITY = 'low'; window.GC_RES = 0.4; window.GC_NO_GOV = true; window.GC_BACKEND = 'webgl'; });

  let bad = 0;
  try {
    await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__GC_READY__ === true', null, { timeout: 60000 });
    const r = await page.evaluate(async () => {
      const E = window.E, out = {};
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      E.Mixer.unlock();
      if (E.Mixer.ctx && E.Mixer.ctx.state === 'suspended') { try { await E.Mixer.ctx.resume(); } catch (e) {} }
      E.Music.start('aegis');
      out.started = E.Music.on;
      E.Music.setDomain('ground'); E.Music.setIntensity(0.5); E.Music.setState({});
      await wait(900);
      const a = E.Music._step;
      E.Music.setDomain('air'); E.Music.setIntensity(0.95); E.Music.setState({ lastStand: true });
      await wait(900);
      out.advanced = E.Music._step !== a;
      out.sectionHigh = E.Music.section;
      E.Music.setMode('map'); E.Music.setDomain('space'); await wait(500);
      E.Music.setMode('battle'); await wait(200);
      out.hook = !!(E.Music._hooks && Object.keys(E.Music._hooks).length);
      for (const k of ['victory', 'defeat', 'capture', 'shipLost', 'alert', 'turn']) { try { k === 'victory' ? E.Music.victory('aegis') : k === 'defeat' ? E.Music.defeat('verdant') : E.Music.sting(k); } catch (e) { out['stingErr_' + k] = String(e.message); } await wait(150); }
      E.Music.setVolume(0.5);
      E.Music.stop();
      out.stopped = !E.Music.on;
      return out;
    });
    const line = (k, v) => console.log(String(k).padEnd(14), v);
    line('started', r.started); line('advanced', r.advanced); line('sectionHigh', r.sectionHigh); line('hook', r.hook); line('stopped', r.stopped);
    if (!r.started) { console.error('FAIL: music did not start (needs a running AudioContext)'); bad++; }
    if (!r.advanced) { console.error('FAIL: scheduler did not advance'); bad++; }
    if (!r.hook) { console.error('FAIL: no leitmotif hook indexed'); bad++; }
    if (!r.stopped) { console.error('FAIL: music did not stop'); bad++; }
    for (const k in r) if (/^stingErr_/.test(k)) { console.error('FAIL', k, r[k]); bad++; }
    if (errors.length) { console.error('page errors', errors); bad++; }
  } finally {
    await browser.close(); server.kill('SIGKILL');
  }
  console.log(bad ? 'ui.music FAIL (' + bad + ')' : 'ui.music ok');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
