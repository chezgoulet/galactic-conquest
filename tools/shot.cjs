#!/usr/bin/env node
// Dev harness: boot the game headless, run a few scripted steps, and save
// screenshots. Used to eyeball rendering changes without a display.
//   node tools/shot.cjs '<json>'      (or a path to a .json file)
// json: { auto: {biome, seed, ...} | null (menu), attract: 'biome', w, h,
//         backend: 'webgpu' (default) | 'webgl',   which renderer backend to force
//         quality: 'low'|'medium'|'high'|'ultra',  res: 0..1 fixed internal resolution scale (disables the governor),
//         debug: true (on-screen readout), frames: N frames to wait for after boot (default 6),
//         steps: [{ wait, waitFrames, eval, click, shot }] }
// Headless Chromium has no GPU here: 'webgpu' runs REAL WebGPU on SwiftShader (software Vulkan), 'webgl' runs the
// renderer's WebGL2 backend on SwiftShader (software GL). Both are slow; keep captures at 1280x720 or lower.
// The backend the page actually used is printed ("backend: ...") from scene.backend, not assumed.
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const serve = require('./serve.cjs');

(async () => {
  const arg = process.argv[2] || '{}';
  const cfg = JSON.parse(arg.trim().startsWith('{') ? arg : require('fs').readFileSync(arg, 'utf8'));
  const backend = cfg.backend || 'webgpu';
  const server = serve(0); await new Promise(r => server.on('listening', r));
  const port = server.address().port;
  const args = ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
  if (backend === 'webgpu') args.push('--enable-unsafe-webgpu', '--enable-features=Vulkan');
  else args.push('--use-gl=angle', '--disable-features=WebGPU');
  const browser = await chromium.launch({ headless: true, args });
  const page = await browser.newPage({ viewport: { width: cfg.w || 1280, height: cfg.h || 720 } });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 500)); if (cfg.verbose) console.log('[page ' + m.type() + '] ' + m.text().slice(0, 300)); });
  await page.addInitScript((c) => {
    if (c.auto) window.GC_AUTOSTART = c.auto; if (c.attract) window.GC_ATTRACT_BIOME = c.attract; window.GC_SHOT = true;
    window.GC_BACKEND = c.backend === 'webgl' ? 'webgl' : undefined;
    window.GC_QUALITY = c.quality || 'medium'; window.GC_NO_GOV = true; if (c.res) window.GC_RES = c.res; if (c.debug) window.GC_DEBUG = true; if (c.trace) window.GC_TRACE = true;
  }, cfg);
  try {
    await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__GC_BATTLE__ === true || window.__GC_MENU__ === true || window.__GC_ERROR__', null, { timeout: (cfg.bootTimeout || 240000), polling: 250 });
    const frames = (n) => page.waitForFunction(`(window.GC && GC.game && GC.game.renderer && GC.game.renderer.scene.frames >= ${n}) || window.__GC_ERROR__`, null, { timeout: 300000, polling: 250 });
    await frames(cfg.frames || 6);
    console.log('backend:', await page.evaluate('GC.game.renderer.scene.backend'), '| requested:', backend, '| navigator.gpu:', await page.evaluate('!!navigator.gpu'));
    for (const s of cfg.steps || [{ wait: 1000, shot: 'test/shots/shot.png' }]) {
      if (s.eval) { const r = await page.evaluate(s.eval); if (r !== undefined && r !== null) console.log('eval ->', JSON.stringify(r)); }
      if (s.click) await page.click(s.click);
      if (s.wait) await page.waitForTimeout(s.wait);
      if (s.waitFrames) { const f0 = await page.evaluate('GC.game.renderer.scene.frames'); await frames(f0 + s.waitFrames); }
      if (s.shot) { await page.screenshot({ path: path.resolve(s.shot), timeout: 180000 }); console.log('shot', s.shot); }
    }
    console.log('stats:', JSON.stringify(await page.evaluate('GC.game.renderer.scene.stats()')));
    const err = await page.evaluate('window.__GC_ERROR__ || null'); if (err) errors.push('BOOT ERROR: ' + err);
  } catch (e) { errors.push('harness: ' + e.message); }
  await browser.close(); server.close();
  if (errors.length) { console.log('ERRORS:\n' + [...new Set(errors)].slice(0, 14).join('\n')); process.exit(1); }
})();
