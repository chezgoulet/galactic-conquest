#!/usr/bin/env node
// Dev harness: boot the game headless (software GL), run a few scripted steps,
// and save screenshots. Used to eyeball rendering changes without a display.
//   node tools/shot.cjs '<json>'
// json: { auto: {biome, seed, ...} | null (menu), w, h, steps: [{ wait, eval, shot }] }
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const serve = require('./serve.cjs');

(async () => {
  const cfg = JSON.parse(process.argv[2] || '{}');
  const server = serve(0); await new Promise(r => server.on('listening', r));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: cfg.w || 1280, height: cfg.h || 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 400)); });
  await page.addInitScript((c) => { if (c.auto) window.GC_AUTOSTART = c.auto; if (c.attract) window.GC_ATTRACT_BIOME = c.attract; window.GC_SHOT = true; }, cfg);
  try {
    await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction('window.__GC_BATTLE__ === true || window.__GC_MENU__ === true || window.__GC_ERROR__', null, { timeout: 90000, polling: 250 });
    for (const s of cfg.steps || [{ wait: 3000, shot: 'test/shots/shot.png' }]) {
      if (s.eval) { const r = await page.evaluate(s.eval); if (r !== undefined) console.log('eval ->', JSON.stringify(r)); }
      if (s.click) await page.click(s.click);
      if (s.wait) await page.waitForTimeout(s.wait);
      if (s.shot) { await page.screenshot({ path: path.resolve(s.shot) }); console.log('shot', s.shot); }
    }
    const err = await page.evaluate('window.__GC_ERROR__ || null'); if (err) errors.push('BOOT ERROR: ' + err);
  } catch (e) { errors.push('harness: ' + e.message); }
  await browser.close(); server.close();
  if (errors.length) { console.log('ERRORS:\n' + [...new Set(errors)].slice(0, 12).join('\n')); process.exit(1); }
})();
