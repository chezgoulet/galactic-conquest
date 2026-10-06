#!/usr/bin/env node
// Hitch / playtest harness. Boots the game headless, instruments the main thread
// (long tasks, rAF deltas, sim tick time, JS heap), runs a scripted battle, and
// prints a JSON report. Locates main-thread freezes; not part of the game.
//
//   node tools/hitch.cjs [--backend webgl|webgpu] [--secs 15] [--quality low]
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const ROOT = path.join(__dirname, '..');

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : def; };
const BACKEND = arg('backend', 'webgl');
const SECS = +arg('secs', 15);
const QUAL = arg('quality', 'low');

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const connect = (port) => new Promise((res) => { const s = net.connect({ host: '127.0.0.1', port }); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const port = await freePort();
  const server = spawn('node', [path.join(ROOT, 'tools', 'serve.cjs'), String(port)], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { if (await connect(port)) break; await sleep(100); }
  const args = BACKEND === 'webgl'
    ? ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-features=WebGPU']
    : ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=Vulkan'];
  const browser = await chromium.launch({ headless: true, args });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(120000);
  await page.addInitScript((c) => {
    window.GC_AUTOSTART = { biome: 'desert', seed: 7 };
    window.GC_QUALITY = c.q;
    window.GC_NO_GOV = true;
    window.GC_RES = 0.4;
    if (c.b === 'webgl') window.GC_BACKEND = 'webgl';
  }, { b: BACKEND, q: QUAL });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  let report = null;
  try {
    await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'load' });
    await page.waitForFunction('window.GC && GC.game && GC.game.renderer && GC.game.renderer.scene.frames >= 10', null, { timeout: 120000, polling: 200 });

    await page.evaluate(() => {
      const H = window.__H = { longtasks: [], rAF: [], simMax: 0, simTicks: 0, simTotal: 0, mem: [], forced: 0, marks: [] };
      H.raf = { last: performance.now(), max: 0 };
      H.reset = () => { H.raf.last = performance.now(); H.raf.max = 0; };
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) H.longtasks.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); H.ltOk = true; } catch (e) { H.ltOk = false; }
      (function loop() { const n = performance.now(), d = n - H.raf.last; H.raf.last = n; if (d > 50) H.rAF.push(Math.round(d)); requestAnimationFrame(loop); })();
      const orig = E.SIM.update;
      E.SIM.update = function (w, dt) { const a = performance.now(); try { orig(w, dt); } finally { const ms = performance.now() - a; H.simTicks++; H.simTotal += ms; if (ms > H.simMax) H.simMax = ms; } };
      H.memTimer = setInterval(() => { if (performance.memory) H.mem.push(Math.round(performance.memory.usedJSHeapSize / 1048576)); }, 500);
    });

    // confirm long-task reporting works by forcing one
    await page.evaluate(() => { const a = performance.now(); while (performance.now() - a < 180) {} window.__H.forced = 1; });
    await sleep(500);
    await page.evaluate(() => window.__H.reset());     // exclude the load/throttle warm-up
    await sleep(3000);
    // battle
    await sleep(SECS * 1000);
    // force an IBL/material recompile and a tier swap (measure synchronous cost)
    const swap = await page.evaluate(() => {
      const s = GC.game.renderer.scene, out = {};
      let a = performance.now(); if (s._env && s._env.space) E.Mat.setEnv(s._env.space); out.setEnv = +(performance.now() - a).toFixed(2);
      a = performance.now(); s.scene.traverse(o => { if (o.material && (o.isMesh || o.isInstancedMesh)) o.material.needsUpdate = true; }); out.traverse = +(performance.now() - a).toFixed(2);
      a = performance.now(); s._swap('medium'); out.swapMedium = +(performance.now() - a).toFixed(2); s._swap('' + s.qualityName) ; return out;
    });
    await sleep(1500);

    report = await page.evaluate(() => {
      const H = window.__H, s = GC.game.renderer.scene, w = GC.game.world;
      const lt = H.longtasks.slice().sort((a, b) => b - a), ra = H.rAF.slice().sort((a, b) => b - a);
      const heap = H.mem.length ? { first: H.mem[0], last: H.mem[H.mem.length - 1], max: Math.max.apply(null, H.mem), samples: H.mem.length } : null;
      return {
        backend: s.backend, quality: s.qualityName, res: s.resScale, frames: s.frames,
        units: w.units.length, projectiles: w.projectiles.length,
        longtaskSupported: !!H.ltOk,
        sim: { ticks: H.simTicks, avgMs: +(H.simTotal / Math.max(1, H.simTicks)).toFixed(3), maxMs: +H.simMax.toFixed(1) },
        longtasks: { count: lt.length, over50: lt.filter(x => x > 50).length, over100: lt.filter(x => x > 100).length, over250: lt.filter(x => x > 250).length, top: lt.slice(0, 8) },
        rAF: { over50: ra.filter(x => x > 50).length, over100: ra.filter(x => x > 100).length, top: ra.slice(0, 8) },
        heap,
      };
    });
    report.syncErrorMs = { setEnv: swap.setEnv, traverse: swap.traverse, swapMedium: swap.swapMedium };
  } finally { try { await browser.close(); } catch (e) {} try { server.kill('SIGKILL'); } catch (e) {} }
  console.log(JSON.stringify({ report, errors }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
