// Space art: everything that sits on top of a capital hull and the events that happen to it.
//   attach(r, u)   per-ship layer: subsystem structures at their sys positions (bridge tower, shield domes, battery pods,
//                  engine bank, hangar bay, reactor stack) in alive / destroyed variants, an elliptical shield shell with
//                  directional hit flares, nav lights, thrust glow tied to throttle, breach scars
//   update(...)    thrust, shield alpha from the four arcs, fires and venting at breaches and dead subsystems,
//                  core-breach build-up, boarding deck (platforms + objective nodes) while marines are aboard
//   event(e)       shieldHit / shieldDown / shieldCollapse / sysDamaged / sysDestroyed / hullBreach / coreBreach /
//                  shipDestroyed / shipRetreating / shipRetreated / shipStranded / shipCaptured / brace / pdIntercept /
//                  pdKill / boardingLaunched / boardFire / boardNode
// Hull-local coordinates: the sim's lx maps to mesh -x (sim x = right of the bow, three.js +x = left).
(function (E) {
  'use strict';
  const sh = (c, k) => E.Geo.shade(c, k);
  const cache = new Map();

  function sysGeo(F, d, name, s, dead) {
    const P = F.palette, b = new E.Geo.Builder(2), k = s.r, c1 = dead ? [34, 32, 32] : P.hullLight, c2 = dead ? [22, 21, 21] : P.hull, acc = dead ? [60, 40, 30] : P.accent, glow = P.glow, eng = P.engine;
    const emi = dead ? 0 : 1, rng = E.RNG(E.hashStr(name + F.id));
    const x = -s.lx, y = s.ly, z = s.lz, org = F.hull.style === 'organic';
    if (name === 'bridge') {
      b.box(k * 0.5, k * 0.5, k * 0.8, x, y + k * 0.25, z, c2, { mode: 3, taper: [0.85, 0.85] });
      b.box(k * 0.34, k * 0.4, k * 0.5, x, y + k * 0.7, z, c1, { mode: 3, taper: [0.9, 0.8] });
      b.box(k * 0.5, k * 0.07, k * 0.12, x, y + k * 0.78, z + k * 0.26, P.canopies, { mode: 0, emi: 2.6 * emi });
      b.cyl(k * 0.02, k * 0.03, k * 0.6, 5, x + k * 0.1, y + k * 1.2, z, c2, { mode: 0 }); b.sphere(k * 0.04, x + k * 0.1, y + k * 1.5, z, [255, 60, 40], { emi: 4 * emi, mode: 0 });
    } else if (name === 'shield') {
      for (const sx of [-1, 1]) { b.cyl(k * 0.3, k * 0.36, k * 0.18, 12, x + sx * k * 0.4, y, z, c2, { mode: 2 }); b.sphere(k * 0.28, x + sx * k * 0.4, y + k * 0.1, z, c1, { sy: 0.7, seg: 12, seg2: 6, mode: 1 }); b.torus(k * 0.3, k * 0.025, x + sx * k * 0.4, y + k * 0.08, z, P.shield, { rx: Math.PI / 2, emi: 2.4 * emi, mode: 0, seg: 24 }); }
    } else if (name === 'batteries') {
      for (let i = 0; i < 3; i++) { const zz = z + (i - 1) * k * 0.55; b.cyl(k * 0.22, k * 0.28, k * 0.18, 8, x, y, zz, c2, { mode: 2 }); b.box(k * 0.3, k * 0.16, k * 0.4, x, y + k * 0.16, zz, c1, { mode: 2 }); for (const sx of [-1, 1]) b.cyl(k * 0.03, k * 0.035, k * 0.62, 6, x + sx * k * 0.08, y + k * 0.18, zz + k * 0.45, sh(c2, 0.6), { rx: Math.PI / 2, mode: 0 }); }
    } else if (name === 'engines') {
      for (let i = 0; i < 5; i++) { const xx = x + (i - 2) * k * 0.3; b.box(k * 0.2, k * 0.2, k * 0.5, xx, y, z, c2, { mode: 2 }); b.box(k * 0.14, k * 0.03, k * 0.52, xx, y + k * 0.11, z, glow, { mode: 0, emi: 1.6 * emi }); }
      b.box(k * 1.7, k * 0.06, k * 0.2, x, y - k * 0.14, z - k * 0.3, c1, { mode: 2 });
    } else if (name === 'hangar') {
      b.box(k * 0.9, k * 0.07, k * 1.1, x, y - k * 0.05, z, [8, 8, 10], { mode: 0 });
      b.box(k * 0.8, k * 0.03, k * 0.9, x, y - k * 0.085, z, P.canopies, { mode: 0, emi: 2.0 * emi });
      b.box(k * 0.96, k * 0.05, k * 0.06, x, y - k * 0.06, z + k * 0.58, acc, { mode: 0, emi: 1.5 * emi }); b.box(k * 0.96, k * 0.05, k * 0.06, x, y - k * 0.06, z - k * 0.58, acc, { mode: 0, emi: 1.5 * emi });
    } else if (name === 'reactor') {
      b.cyl(k * 0.22, k * 0.3, k * 0.3, 10, x, y + k * 0.15, z, c2, { mode: 2 });
      for (let i = 0; i < 3; i++) b.cyl(k * 0.05, k * 0.07, k * 0.4, 6, x + (i - 1) * k * 0.14, y + k * 0.4, z, c1, { mode: 1 });
      b.sphere(k * 0.1, x, y + k * 0.33, z, org ? P.glow : [120, 200, 255], { emi: 3 * emi, mode: 0, seg: 8, seg2: 6 });
    }
    if (dead) for (let i = 0; i < 12; i++) b.box(k * 0.04, k * 0.04, k * 0.04, x + rng.f(-0.4, 0.4) * k, y + rng.f(-0.1, 0.4) * k, z + rng.f(-0.4, 0.4) * k, [255, 110, 30], { emi: 2.4, mode: 0 });
    return b.build();
  }

  function mergeGeos(list) {
    const b = new E.Geo.Builder(2);
    for (const g of list) { b.pos.push(...g.attributes.position.array); b.nor.push(...g.attributes.normal.array); b.col.push(...g.attributes.color.array); b.fx.push(...g.attributes.aFx.array); }
    return b.build();
  }

  class Space {
    constructor(renderer) { this.R = renderer; this.fx = renderer.fx; this.recs = new Map(); this.decals = null; }
    rec(uid) { return this.R.models.get(uid); }

    attach(r, u) {
      const T = E.THREE, F = E.faction(u.team), body = r.m.body, d = u.def;
      const S = r.space = { u, F, team: u.team, alive: {}, sysMesh: null, breaches: [], hits: [], eng: body.children.filter(c => c.isSprite), flash: 0, boarding: null, nodes: {}, navT: Math.random() * 6, coreK: 0 };
      // subsystem structures
      this.rebuildSys(r);
      // shield shell
      const ex = d.h * 1.9, ey = d.h * 1.25, ez = d.len * 0.58;
      const mat = E.Mat.dome({ color: 0x4fb4ff }), m = new T.Mesh(new T.SphereGeometry(1, 36, 22), mat);
      m.scale.set(ex, ey, ez); m.renderOrder = 4; m.frustumCulled = false; body.add(m);
      S.shield = m; S.sm = mat; S.ext = [ex, ey, ez];
      const sc = F.palette.shield; mat.userData.col.value.setRGB(sc[0] / 255, sc[1] / 255, sc[2] / 255);
      // nav lights
      const tex = E.ArtStruct.glowTex(); S.nav = [];
      for (const [x, y, z, c] of [[-d.h * 1.7, 0, d.len * 0.1, [3, 0.2, 0.2]], [d.h * 1.7, 0, d.len * 0.1, [0.2, 3, 0.3]], [0, d.h * 0.9, -d.len * 0.45, [3, 3, 3]], [0, -d.h * 0.7, d.len * 0.3, [3, 3, 3]]]) {
        const s = new T.Sprite(E.Mat.sprite({ map: tex, color: new T.Color(c[0], c[1], c[2]), additive: true })); s.scale.setScalar(Math.max(4, d.len * 0.018)); s.position.set(x, y, z); body.add(s); S.nav.push(s);
      }
      // dark scorch scars share one texture
      S.scarTex = tex;
    }
    rebuildSys(r) {
      const S = r.space, u = r.u, T = E.THREE; if (!u.sys) return;
      const key = Object.keys(u.sys).map(n => u.sys[n].alive ? 1 : 0).join('');
      if (S.sysKey === key) return; S.sysKey = key;
      const list = [];
      for (const n of Object.keys(u.sys)) {
        const s = u.sys[n], ck = 'sys:' + S.F.id + ':' + u.type + ':' + n + ':' + (s.alive ? 1 : 0);
        let g = cache.get(ck); if (!g) { g = sysGeo(S.F, u.def, n, s, !s.alive); cache.set(ck, g); }
        list.push(g);
      }
      const geo = mergeGeos(list);
      if (S.sysMesh) { r.m.body.remove(S.sysMesh); S.sysMesh.geometry.dispose(); }
      const m = new T.Mesh(geo, E.Geo.material()); m.castShadow = m.receiveShadow = true; r.m.body.add(m); S.sysMesh = m;
    }
    toLocal(u, p, out) {
      const dx = p.x - u.pos.x, dy = p.y - u.pos.y, dz = p.z - u.pos.z, c = Math.cos(u.yaw), s = Math.sin(u.yaw);
      out.x = dx * c - dz * s; out.y = dy; out.z = dx * s + dz * c; return out;
    }

    update(dt, t, world) {
      for (const [id, r] of this.R.models) {
        const S = r.space, u = r.u; if (!S || u.kind !== 'capital') continue;
        const body = r.m.body, d = u.def, rg = this.fx.rng;
        this.rebuildSys(r);
        // thrust glow tracks throttle; a stranded or retreating ship runs hot
        const thr = u.stranded ? 0 : E.clamp(u.throttle === undefined ? 0.6 : u.throttle, 0, 1) + (u.retreat ? 0.5 : 0) + (u.boost ? 0.4 : 0);
        const eng = u.sys && u.sys.engines && u.sys.engines.alive ? 1 : 0.25;
        for (const s of S.eng) s.scale.setScalar(d.h * 1.9 * (0.35 + thr * 0.9 * eng));
        S.navT += dt; const on = (Math.sin(S.navT * 3) > 0.5) ? 1 : 0.15; S.nav[2].material.opacity = on; S.nav[3].material.opacity = 1 - on * 0.6;
        // shield shell: alpha follows the four arcs; hits flare
        let a = 0, n = 0; if (u.arcs) for (const x of u.arcs) { a += x.v / (x.max || 1); n++; }
        a = n ? a / n : 0; S.flash = Math.max(0, S.flash - dt * 1.6);
        const up = a > 0.02;
        S.sm.userData.alpha.value = (up ? 0.06 + a * 0.12 : 0) + S.flash * 1.4 + (u.braceT > 0 ? 0.35 + 0.2 * Math.sin(t * 8) : 0);
        S.sm.userData.hitT.value = Math.min(9, S.sm.userData.hitT.value + dt * 1.0);
        S.shield.visible = S.sm.userData.alpha.value > 0.02;
        const far = E.distXZ2(this.R.scene.camera.position, u.pos) > 4500 * 4500;
        // fires: breaches, dead subsystems, core
        if (!far) {
          for (const b of S.breaches) if (rg.next() < dt * 10) { this.emitAt(r, b.x, b.y, b.z, b.nx, b.ny, 'fire', d.h); }
          if (u.sys) for (const n2 of Object.keys(u.sys)) { const s = u.sys[n2]; if (!s.alive && rg.next() < dt * 6) this.emitAt(r, -s.lx + rg.f(-0.3, 0.3) * s.r, s.ly + s.r * 0.2, s.lz + rg.f(-0.3, 0.3) * s.r, 0, 1, 'smoke', d.h); }
          if (u.coreT > 0) {
            const k = 1 - u.coreT / (E.SPACE ? E.SPACE.coreTime : 25), s = u.sys.reactor;
            S.coreK = k;
            for (let i = 0; i < 2; i++) if (rg.next() < dt * (10 + k * 60)) this.emitAt(r, -s.lx + rg.f(-0.5, 0.5) * s.r, s.ly + s.r * 0.3, s.lz + rg.f(-0.5, 0.5) * s.r, 0, 1, 'jet', d.h * (1 + k));
            if (rg.next() < dt * 3 * k) this.fx.flash(this.world(r, -s.lx, s.ly + s.r * 0.3, s.lz), d.h * (0.6 + k), [1, 0.7, 0.4], 0.18);
          }
        }
        if (u.boarding || (world.units && S.boardCheck !== world.tickN)) { S.boardCheck = world.tickN; }
      }
      this.decks(world, dt, t);
    }
    world(r, lx, ly, lz) {
      const u = r.u, c = Math.cos(u.yaw), s = Math.sin(u.yaw), q = this.R.models.get(u.id) || { x: u.pos.x, y: u.pos.y, z: u.pos.z };
      return { x: q.x + lx * c + lz * s, y: q.y + ly, z: q.z - lx * s + lz * c };
    }
    emitAt(r, lx, ly, lz, nx, ny, kind, h) {
      const p = this.world(r, lx, ly, lz), f = this.fx, g = f.rng;
      if (kind === 'fire') { f.add.emit(p.x, p.y, p.z, g.f(-3, 3), g.f(2, 9), g.f(-3, 3), 1.0, h * 0.12, h * 0.3, 3, 1.3, 0.35, 0.9, 0.6, 0); f.smoke.emit(p.x, p.y, p.z, g.f(-3, 3), g.f(6, 14), g.f(-3, 3), 5, h * 0.1, h * 0.7, 0.07, 0.07, 0.07, 0.5, 0.3, -0.5); }
      else if (kind === 'smoke') f.smoke.emit(p.x, p.y, p.z, g.f(-2, 2), g.f(4, 9), g.f(-2, 2), 5, h * 0.08, h * 0.5, 0.06, 0.06, 0.06, 0.45, 0.3, -0.4);
      else f.add.emit(p.x, p.y, p.z, g.f(-8, 8), g.f(15, 40), g.f(-8, 8), 1.4, h * 0.25, h * 0.7, 4, 2.2, 0.8, 0.9, 0.3, 0);
    }

    event(e, world) {
      const u = world.umap ? world.umap.get(e.uid) : null, r = e.uid ? this.R.models.get(e.uid) : null, f = this.fx;
      const near = (p, d) => p && E.distXZ2(this.R.scene.camera.position, p) < d * d;
      switch (e.type) {
        case 'shieldHit': {
          if (!r || !r.space) break;
          const S = r.space, l = this.toLocal(r.u, e.pos, {}), ex = S.ext;
          const v = S.sm.userData; v.hitDir.value.set(l.x / ex[0], l.y / ex[1], l.z / ex[2]).normalize(); v.hitT.value = 0; S.flash = Math.min(1, S.flash + 0.25 + (e.amt || 0) * 0.0005);
          f.flash(e.pos, Math.max(4, r.u.def.h * 0.5), [0.5, 0.8, 1.2], 0.12);
          break;
        }
        case 'shieldDown': if (r && r.space) { r.space.flash = 1; f.flash(e.pos, r.u.def.h, [0.6, 0.9, 1.5], 0.3); f.spark(e.pos, 14, [0.6, 0.9, 1.2], 40, 0.8, 0.5); } break;
        case 'shieldCollapse': if (r && r.space) { r.space.flash = 1; f.ring(e.pos, r.u.def.len * 0.7, [0.5, 0.85, 1.3], 1.2, false); f.flash(e.pos, r.u.def.len * 0.25, [0.6, 0.9, 1.5], 0.4); } break;
        case 'sysDamaged': if (near(e.pos, 3000)) { f.spark(e.pos, 8, [1, 0.7, 0.4], 30, 0.7, 0.4); f.flash(e.pos, 14, [1, 0.8, 0.5], 0.12); } break;
        case 'sysDestroyed': { f.blast(e.pos, e.sys === 'reactor' ? 40 : 24, { space: true, hull: r ? E.faction(r.u.team).palette.hull : null }); f.light(e.pos, [1, 0.6, 0.3], 1500, 500); if (this.R.camera) this.R.camera.shake(0.25); break; }
        case 'hullBreach': {
          if (!r || !r.space) break; const S = r.space, d = r.u.def, g = f.rng;
          const side = g.pick ? g.pick([-1, 1]) : (g.next() < 0.5 ? -1 : 1), top = g.next() < 0.5;
          const x = top ? g.f(-0.5, 0.5) * d.h * 1.4 : side * d.h * 1.3, y = top ? d.h * 0.7 : g.f(-0.3, 0.5) * d.h, z = g.f(-0.35, 0.3) * d.len;
          S.breaches.push({ x, y, z, nx: top ? 0 : side, ny: top ? 1 : 0 });
          const sp = new E.THREE.Sprite(E.Mat.sprite({ map: S.scarTex, color: new E.THREE.Color(0.02, 0.015, 0.012) })); sp.scale.setScalar(d.h * 0.8); sp.position.set(x, y, z); r.m.body.add(sp);
          const p = this.world(r, x, y, z); f.blast(p, 22 + (e.level || 1) * 4, { space: true, hull: E.faction(r.u.team).palette.hull }); if (this.R.camera) this.R.camera.shake(0.35);
          break;
        }
        case 'coreBreach': if (r) f.ring(e.pos, 30, [1, 0.5, 0.2], 1.0, false); break;
        case 'shipRetreating': case 'shipStranded': if (r && near(e.pos, 4000)) f.flash(e.pos, 20, [0.6, 0.8, 1.2], 0.3); break;
        case 'shipRetreated': {
          const rec = r || this.R.models.get(e.uid); f.flash(e.pos, e.utype ? E.CAPITALS[e.utype].len * 0.2 : 40, [0.7, 0.85, 1.5], 0.6); f.ring(e.pos, 160, [0.6, 0.85, 1.4], 1.2, false);
          if (rec) { this.R.scene.units.remove(rec.m.root); this.R.models.delete(e.uid); }
          break;
        }
        case 'shipCaptured': if (r) { r.m.root.userData.recolor = e.team; f.ring(e.pos, 200, [1, 1, 1], 1.0, false); } break;
        case 'brace': if (r && r.space) r.space.flash = Math.min(1, r.space.flash + 0.5); break;
        case 'pdIntercept': f.flash(e.pos, 3.5, [1, 0.9, 0.6], 0.08); f.spark(e.pos, 4, [1, 0.9, 0.6], 18, 0.3, 0.2); break;
        case 'pdKill': f.blast(e.pos, 5, { space: true }); break;
        case 'boardingLaunched': {
          const tg = world.umap ? world.umap.get(e.tid) : null, to = tg ? tg.pos : e.pos, N = Math.min(6, e.n || 3);
          for (let i = 0; i < N; i++) f.transit.push({ x0: e.pos.x + i * 6, y0: e.pos.y - 6, z0: e.pos.z + i * 4, to: { x: to.x, y: to.y, z: to.z }, target: e.tid, dur: Math.max(4, e.eta || 8), t: 0, x: e.pos.x, y: e.pos.y, z: e.pos.z });
          f.flash(e.pos, 12, [1, 0.9, 0.7], 0.3);
          break;
        }
        case 'boardFire': { const o = this.R.overlay; if (o) { o.beamAt('hold-line', e.from, e.to, 0.12, e.team === 'aegis' ? [3, 0.8, 0.3] : [0.4, 3, 1.2], 0.12, 1); } f.flash(e.to, 1.6, [1, 0.9, 0.7], 0.06); break; }
        case 'boardNode': if (r && r.space) r.space.nodes[e.node] = e.state; break;
      }
    }

    // boarding deck: platforms, rails and objective nodes inside the boarded ship, built when marines are aboard
    decks(world, dt, t) {
      const T = E.THREE, boarded = new Set();
      for (const u of world.units) if (u.alive && u.mode === 'boarding' && u.board) boarded.add(u.board.ship);
      for (const id of boarded) {
        const r = this.R.models.get(id); if (!r || !r.space) continue;
        if (!r.space.deck) r.space.deck = this.buildDeck(r);
      }
      for (const [id, r] of this.R.models) {
        const S = r.space; if (!S || !S.deck) continue;
        S.deck.visible = boarded.has(id);
        if (S.deck.visible) for (const nd of S.deck.userData.nodes) { const st = S.nodes[nd.name]; const c = st === 'sabotaged' ? [3, 0.3, 0.2] : [0.5, 2.2, 3]; nd.mat.color.setRGB(c[0] * (0.7 + 0.3 * Math.sin(t * 4)), c[1] * (0.7 + 0.3 * Math.sin(t * 4)), c[2] * (0.7 + 0.3 * Math.sin(t * 4))); }
      }
    }
    buildDeck(r) {
      const T = E.THREE, u = r.u, F = E.faction(u.team), P = F.palette, g = new T.Group(), SIM = E.SIM, decks = SIM && SIM.BOARD_DECKS || [], nodes = SIM && SIM.BOARD_NODES || {};
      const b = new E.Geo.Builder(1), z0 = u.def.len * -0.2, yb = u.h * 0.25;
      for (const d of decks) {
        const x = -d.cx, z = z0 + d.cz, y = yb + d.y;
        b.box(d.hx * 2, 0.6, d.hz * 2, x, y - 0.3, z, [46, 50, 58], { mode: 2 });
        b.box(d.hx * 2 + 0.4, 0.15, 0.3, x, y + 0.05, z + d.hz, P.accent, { mode: 0, emi: 1.8 }); b.box(d.hx * 2 + 0.4, 0.15, 0.3, x, y + 0.05, z - d.hz, P.accent, { mode: 0, emi: 1.8 });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) { b.box(0.8, 12, 0.8, x + sx * d.hx, y + 6, z + sz * d.hz, [60, 64, 72], { mode: 2 }); b.box(0.2, 11, 0.2, x + sx * (d.hx - 0.4), y + 6, z + sz * (d.hz - 0.4), P.glow, { mode: 0, emi: 1.4 }); }
        b.box(d.hx * 1.6, 0.25, 0.5, x, y + 13.5, z, [230, 235, 255], { mode: 0, emi: 2.0 }); b.box(0.5, 0.25, d.hz * 1.6, x, y + 13.5, z, [230, 235, 255], { mode: 0, emi: 2.0 });
        b.box(d.hx * 2, 1.1, 0.25, x, y + 0.55, z + d.hz - 0.1, [90, 96, 108], { mode: 1 }); b.box(d.hx * 2, 1.1, 0.25, x, y + 0.55, z - d.hz + 0.1, [90, 96, 108], { mode: 1 });
      }
      const m = new T.Mesh(b.build(), E.Geo.material()); g.add(m); g.userData.nodes = [];
      for (const name of Object.keys(nodes)) {
        const n = nodes[name], d = decks[n.deck], y = yb + (d ? d.y : 0), x = -n.x, z = z0 + n.z;
        const mat = E.Mat.emissive({ color: 0x66ccff, additive: true, opacity: 0.8, side: 'double' });
        const ring = new T.Mesh(new T.RingGeometry(6.3, 7, 40).rotateX(-Math.PI / 2), mat); ring.position.set(x, y + 0.12, z);
        const col = new T.Mesh(new T.CylinderGeometry(0.6, 1.2, 12, 8, 1, true), mat); col.position.set(x, y + 6, z); g.add(ring, col);
        const l = new T.PointLight(0x88ccff, 400, 60, 1.6); l.position.set(x, y + 6, z); g.add(l);
        g.userData.nodes.push({ name, mat });
      }
      r.m.body.add(g); return g;
    }
  }

  E.ArtSpace = { Space };
})(window.E = window.E || {});
