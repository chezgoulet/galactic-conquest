// UI smoke test: load the game headless, verify the renderer booted, the scene
// is populated, and no fatal errors occurred. Takes a screenshot.
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..');

async function freePort() {
  return new Promise((res) => {
    const net = require('net');
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

(async () => {
  const port = await freePort();
  const net = require('net');
  const canConnect = () => new Promise((res) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.on('connect', () => { s.destroy(); res(true); });
    s.on('error', () => res(false));
  });
  const server = spawn('node', [path.join(ROOT, 'tools', 'serve.cjs'), String(port)], { stdio: 'inherit' });
  let up = false;
  for (let i = 0; i < 50 && !up; i++) { await new Promise(r => setTimeout(r, 100)); up = await canConnect(); }
  if (!up) { console.error('static server did not start on port', port); process.exit(1); }

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=Vulkan'],
  });
  const cleanup = async () => { try { await browser.close(); } catch {} try { server.kill('SIGKILL'); } catch {} };
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => { window.GC_AUTOSTART = { biome: 'desert', seed: 7 }; window.GC_QUALITY = 'low'; window.GC_NO_GOV = true; window.GC_RES = 0.5; });
  const errors = [];
  const logs = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { logs.push(m.type() + ': ' + m.text()); if (m.type() === 'error') errors.push('console: ' + m.text()); });

  let info = null;
  try {
    console.error('[smoke] loading page', `http://localhost:${port}/index.html`);
    await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__GC_READY__ === true', null, { timeout: 60000, polling: 200 });
    console.error('[smoke] ready, waiting for frames');
    await page.waitForFunction('window.GC && GC.game && GC.game.renderer && GC.game.renderer.scene.frames >= 5', null, { timeout: 120000, polling: 300 });
    info = await page.evaluate(() => {
      const g = window.GC && window.GC.game;
      const w = g && g.world;
      const r = g && g.renderer;
      const canvas = document.getElementById('view');
      const sc = r && r.scene;
      return {
        ready: window.__GC_READY__,
        gcE: !!window.E,
        bootError: window.__GC_ERROR__ || null,
        renderer: !!(r && r.scene && r.scene.renderer),
        backend: sc ? sc.backend : null, frames: sc ? sc.frames : 0,
        hasTerrain: !!(w && w.terrain),
        unitCount: w ? w.units.length : 0,
        planet: w ? w.planet.biome : null,
        mode: w ? w.controllerMode : null,
        uiBuilt: !!document.getElementById('gc-top'),
      };
    });
    await page.screenshot({ path: path.join(ROOT, 'test', 'shots', 'smoke.png') });
  } finally {
    await cleanup();
  }

  console.error('[smoke] page logs:', logs.slice(-15));
  console.log(JSON.stringify(info, null, 2));
  const fatal = errors.filter(e => !/favicon|manifest|404/.test(e));
  if (info && info.bootError) { console.error('FAIL: boot error', info.bootError); process.exit(1); }
  if (!info.backend || info.frames < 5) { console.error('FAIL: no frames rendered', info); process.exit(1); }
  if (!info.renderer || !info.hasTerrain || info.unitCount < 10) {
    console.error('FAIL: renderer/terrain/units not ready', info, fatal);
    process.exit(1);
  }
  if (fatal.length) { console.error('FAIL: page errors', fatal); process.exit(1); }
  console.log('ui.smoke ok — renderer booted, ' + info.unitCount + ' units on ' + info.planet);
  process.exit(0);
})().catch(async (e) => { console.error(e); process.exit(1); });
