#!/usr/bin/env node
// Performance harness: boot a battle and measure real frame time on a REAL GPU.
//   node tools/perf.cjs [--w 2560] [--h 1440] [--quality ultra] [--biome desert]
//                       [--seed 7] [--secs 30] [--view fighter] [--headless]
//                       [--sw] [--gov]
//
// The automated `tools/shot.cjs` capture runs on software SwiftShader (~5 fps);
// THIS script is meant to be run on a machine with a real WebGPU GPU, where it
// launches a headed browser by default. It prints avg / median / p95 / min / max
// frame time and FPS, plus draw calls and triangles, for the 60 fps @ 1440p target.
//   --view infantry|vehicle|fighter|capital  possess that unit kind before sampling
//   --gov      leave the dynamic-resolution governor on (default: off, for stable numbers)
//   --headless / --sw   force headless / software rendering (still useful for a smoke run)
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const serve = require('./serve.cjs');

function arg(name, def) { const i = process.argv.indexOf('--' + name); if (i < 0) return def; const v = process.argv[i + 1]; return (v && !v.startsWith('--')) ? v : true; }
const has = (name) => process.argv.includes('--' + name);

(async () => {
  const W = +arg('w', 2560), H = +arg('h', 1440), QUAL = String(arg('quality', 'ultra'));
  const BIOME = String(arg('biome', 'desert')), SEED = +arg('seed', 7), SECS = +arg('secs', 30);
  const VIEW = arg('view', null), GOV = has('gov'), HEADLESS = has('headless'), SW = has('sw');

  const server = serve(0); await new Promise(r => server.on('listening', r));
  const port = server.address().port;
  const args = ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=Vulkan'];
  if (SW) args.push('--enable-unsafe-swiftshader', '--use-angle=swiftshader');
  const browser = await chromium.launch({ headless: HEADLESS, args });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(240000);
  await page.addInitScript((c) => {
    window.GC_AUTOSTART = { biome: c.BIOME, seed: c.SEED };
    window.GC_QUALITY = c.QUAL; if (!c.GOV) window.GC_NO_GOV = true; window.GC_SHOT = true;
  }, { BIOME, QUAL, GOV });
  try {
    await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__GC_BATTLE__ === true || window.__GC_ERROR__', null, { timeout: 240000, polling: 250 });
    await page.waitForFunction('window.GC && GC.game && GC.game.renderer && GC.game.renderer.scene.frames >= 90', null, { timeout: 300000, polling: 250 });
    const info = await page.evaluate(() => ({ backend: GC.game.renderer.scene.backend, gpu: !!navigator.gpu, tier: GC.game.renderer.scene.qualityName, size: GC.game.renderer.scene._W + 'x' + GC.game.renderer.scene._H }));
    if (VIEW) await page.evaluate((v) => GC.game.quickControl(v), VIEW);
    console.log(`backend ${info.backend} | navigator.gpu ${info.gpu} | tier ${info.tier} | viewport ${info.size} | quality ${QUAL} | governor ${GOV ? 'on' : 'off'}`);
    if (info.backend !== 'webgpu' || !info.gpu) console.log('WARNING: not running on WebGPU — numbers are not representative of the target.');

    const ms = [], draws = [], tris = [];
    const t0 = Date.now();
    let last = 0, frames0 = await page.evaluate(() => GC.game.renderer.scene.frames);
    while ((Date.now() - t0) / 1000 < SECS) {
      await page.waitForTimeout(500);
      const s = await page.evaluate(() => GC.game.renderer.scene.stats());
      ms.push(s.frameMs); draws.push(s.drawCalls); tris.push(s.triangles);
      process.stdout.write(`\r  t=${((Date.now() - t0) / 1000).toFixed(1)}s  ${(1000 / s.frameMs).toFixed(1)} fps  ${s.frameMs} ms  draws ${s.drawCalls}  tris ${s.triangles}   `);
      void last;
    }
    const frames1 = await page.evaluate(() => GC.game.renderer.scene.frames);
    process.stdout.write('\n');
    const sorted = ms.slice().sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const avg = ms.reduce((a, b) => a + b, 0) / ms.length;
    const avgDraws = Math.round(draws.reduce((a, b) => a + b, 0) / draws.length);
    const maxTris = Math.max.apply(null, tris);
    console.log('── result ─────────────────────────────────────────────');
    console.log(`  window            ${SECS}s, ${ms.length} samples, ${frames1 - frames0} frames rendered`);
    console.log(`  frame time (ms)   avg ${avg.toFixed(2)}  median ${q(0.5).toFixed(2)}  p95 ${q(0.95).toFixed(2)}  min ${sorted[0].toFixed(2)}  max ${sorted[sorted.length - 1].toFixed(2)}`);
    console.log(`  fps               avg ${(1000 / avg).toFixed(1)}  median ${(1000 / q(0.5)).toFixed(1)}  p95-low ${(1000 / q(0.95)).toFixed(1)}  peak ${(1000 / sorted[0]).toFixed(1)}`);
    console.log(`  draw calls        avg ${avgDraws}   triangles peak ${maxTris}`);
    console.log(`  backend           ${info.backend} @ ${info.size} (${QUAL})`);
    console.log(`  target            60 fps @ ${W}x${H}: ${(1000 / q(0.95)) >= 60 ? 'MET (p95 >= 60)' : 'NOT met at p95'}`);
  } catch (e) {
    console.error('perf harness error:', e.message);
    process.exitCode = 1;
  }
  await browser.close(); server.close();
})();
