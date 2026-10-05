// UI flow test: drives the real DOM like a player.
//   new campaign -> select fleet -> forecast -> assault -> battle starts -> (test forces the win by setting
//   world.winner) -> results -> map shows the captured world and the fleet's damage -> build -> ops -> end turn
//   (playback) -> controls reference. Saves screenshots under test/shots/ui/. Fails on any page error.
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(ROOT, 'test', 'shots', 'ui');
fs.mkdirSync(SHOTS, { recursive: true });

const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; throw new Error(m); } console.log('ok  -', m); };

(async () => {
  const port = await freePort();
  const server = spawn('node', [path.join(ROOT, 'tools', 'serve.cjs'), String(port)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const BACKEND = process.env.GC_UI_BACKEND === 'webgl' ? 'webgl' : 'webgpu';
  const browser = await chromium.launch({ headless: true, args: BACKEND === 'webgl'
    ? ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-features=WebGPU']
    : ['--use-angle=swiftshader', '--no-sandbox', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=Vulkan'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(240000);
  await page.addInitScript((backend) => { window.GC_QUALITY = 'low'; window.GC_NO_GOV = true; window.GC_RES = 0.5; window.GC_PB_SPEED = 0.35; localStorage.clear(); if (backend === 'webgl') window.GC_BACKEND = 'webgl'; }, BACKEND);
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n) });
  const cleanup = async () => { try { await browser.close(); } catch (e) {} try { server.kill('SIGKILL'); } catch (e) {} };
  try {
    await page.goto(`http://localhost:${port}/index.html`, { waitUntil: 'load' });
    await page.waitForFunction('window.__GC_MENU__ === true || window.__GC_ERROR__', null, { polling: 300 });
    ok(!(await page.evaluate('window.__GC_ERROR__')), 'game booted');
    // ── new campaign ──
    await page.click('.m-item[data-a="campaign"]');
    await page.waitForSelector('.m-go'); await shot('01b-new-campaign.png');
    await page.click('.m-fac.verdant'); await page.click('.m-fac.aegis');
    await page.click('.m-go');
    await page.waitForSelector('.g-svg g.pl');
    ok((await page.$$('.g-svg g.pl')).length === 10, 'ten worlds on the map');
    ok((await page.$$('.g-svg g.fl.mine')).length === 1, 'player fleet piece drawn');
    await page.waitForTimeout(500); await shot('02-galaxy-idle.png');
    // ── select fleet: reach is highlighted ──
    await page.click('.g-svg g.fl.mine', { force: true });
    ok((await page.$$('.g-svg g.pl.fre')).length >= 1 && (await page.$$('.g-svg g.pl.tgt')).length >= 1, 'selecting a fleet highlights free moves and strike targets');
    await shot('03-fleet-selected.png');
    // ── forecast ──
    await page.click('.g-svg g.pl.tgt', { force: true });
    await page.waitForSelector('.g-fc.show');
    ok(await page.$('.g-fc .odds') !== null && (await page.$$('.g-fc .cmp')).length >= 4, 'forecast shows odds and three-domain comparison');
    await shot('04-forecast.png');
    // ── assault ──
    const target = await page.evaluate('GC.menu.galaxy.gs.target');
    const credBefore = await page.evaluate('GC.menu.campaign.credits.aegis');
    await page.click('.go-assault');
    await page.waitForFunction('window.__GC_BATTLE__ === true && GC.game && GC.game.world && GC.game.role === "sp"', null, { polling: 300 });
    ok(await page.evaluate('GC.game.world.units.some(u=>u.kind==="capital" && u.team===GC.game.team)'), 'battle started with the fleet in orbit');
    await page.waitForTimeout(1500); await shot('10b-battle-deploy.png');
    // ── force a win (the test, not the UI, sets the winner) and damage the flagship ──
    await page.evaluate(() => {
      const g = GC.game, w = g.world, E = GC.E;
      for (const u of w.units) if (u.kind === 'capital' && u.team === g.team) { u.hp *= 0.55; E.SIM.reportShip(w, u, 'active'); }
      g.noAutoPause = true; w.winner = g.team;
    });
    await page.waitForSelector('.r-card', { timeout: 240000 });
    await page.waitForSelector('.r-camp');
    await page.waitForTimeout(300); await shot('20-results.png');
    ok(await page.evaluate('!!document.querySelector(".r-doms .r-dom h4")') && (await page.$$('.r-doms .r-dom')).length === 3, 'results report ground, air and space');
    ok((await page.$$('.rc-s')).length >= 1, 'results show what the battle cost the campaign fleet');
    await page.click('.r-go');
    await page.waitForSelector('.g-svg g.pl', { timeout: 240000 });
    // ── map afterwards ──
    const st = await page.evaluate((t) => { const c = GC.menu.campaign; return { owner: c.planets[t].owner, hp: c.fleets.filter(f => f.owner === 'aegis').flatMap(f => f.ships.map(s => s.hp)), at: c.fleets.find(f => f.owner === 'aegis').at, credits: c.credits.aegis }; }, target);
    ok(st.owner === 'aegis', 'campaign shows the captured world');
    ok(st.hp.some(h => h < 0.9), 'the fleet carries its damage back to the map (' + st.hp.map(h => h.toFixed(2)) + ')');
    ok(st.credits > credBefore, 'reward credited');
    await page.waitForTimeout(600); await shot('21-after-battle-map.png');
    // ── build ──
    await page.click('.g-svg g.pl[data-p="' + st.at + '"]', { force: true });
    await page.click('.tb[data-tab="build"]');
    await shot('05-build.png');
    const c0 = await page.evaluate('GC.menu.campaign.credits.aegis');
    await page.click('.bi[data-build="army"]');
    const c1 = await page.evaluate('GC.menu.campaign.credits.aegis');
    ok(c1 < c0, 'building a legion spent credits (' + c0 + ' -> ' + c1 + ')');
    // ── ops on an enemy-side world ──
    await page.evaluate(() => { const g = GC.menu.galaxy; g.gs.planet = 9; g.gs.tab = 'ops'; g.render(); });
    await shot('06-ops.png');
    const c2 = await page.evaluate('GC.menu.campaign.credits.aegis');
    await page.click('.bi[data-op="recon"]');
    ok((await page.evaluate('GC.menu.campaign.credits.aegis')) < c2, 'reconnaissance spent credits');
    await page.waitForTimeout(300); await shot('06b-ops-recon.png');
    // ── end turn: playback ──
    await page.click('.g-end');
    await page.waitForSelector('.g-pb.on');
    await page.waitForTimeout(500); await shot('07-end-turn-playback.png');
    await page.keyboard.press('Escape');
    await page.waitForFunction('!GC.menu.galaxy.busy', null, { polling: 300 });
    if (await page.$('.g-modal.on .a-auto')) { await shot('08-under-attack.png'); await page.click('.a-auto'); await page.waitForSelector('.g-svg g.pl'); }
    ok((await page.evaluate('GC.menu.campaign.turn')) === 2, 'turn advanced to 2');
    await page.waitForTimeout(500); await shot('09-turn2-map.png');
    // ── controls reference ──
    await page.click('.g-menu'); await page.waitForSelector('.m-item[data-a="controls"]');
    await page.click('.m-item[data-a="controls"]'); await page.waitForSelector('.ct-tbl');
    await page.click('.ct-tab[data-k="capital"]'); await page.waitForTimeout(200); await shot('30-controls.png');
    ok((await page.$$('.ct-tab')).length === 7, 'controls reference lists every unit kind');
    const fatal = errors.filter(e => !/favicon|manifest|404/.test(e));
    ok(fatal.length === 0, 'no page console errors ' + JSON.stringify(fatal));
    console.log('ui.flow ok');
  } catch (e) {
    console.error(e); process.exitCode = 1; try { await shot('flow-failure.png'); } catch (e2) {}
  } finally { await cleanup(); }
  process.exit(process.exitCode || 0);
})();
