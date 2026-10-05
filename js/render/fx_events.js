// VFX library, part 2: mixes into E.FX. Adds
//   debris(pos, n, rgb, speed, spread, {grav})   physical chunks (boxes) that tumble, bounce on the terrain and fade
//   scorch(pos, r, k)                            persistent dark ground decals (scars of battle, visible from altitude)
//   muzzle(pos, size, rgb, light)                muzzle flash with a small dynamic-light budget
//   fireball / smoke column / shockwave          layered explosion (flash, core, smoke, sparks, ring, dust ring, light)
//   events2(events, world)                       every sim event the base FX does not handle: land, air, space
//   flares, vapour trails, missile smoke, flak bursts, crash fireballs, shield-arc flares, ship death staging
(function (E) {
  'use strict';
  const FX = E.FX, P = FX.prototype;
  const HOT = [1.0, 0.82, 0.5];
  const TAU = Math.PI * 2;

  function chunkGeo() {
    const T = E.THREE, g = T.mergeGeometries ? null : null;
    const b = new E.Geo.Builder(0), r = E.RNG(31);
    b.box(1, 0.6, 0.8, 0, 0, 0, [255, 255, 255], { taper: [0.8, 0.7], mode: 0 });
    return b.build();
  }

  // a flash never swallows the camera: its size is capped by the distance to the viewer
  const baseFlash = P.flash;
  P.flash = function (p, size, col, life) {
    const c = this.scene.camera.position, d = Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z);
    return baseFlash.call(this, p, Math.min(size, d * 0.35 + 0.5), col, life);
  };

  P.initArt = function () {
    const T = E.THREE;
    if (this._art) return; this._art = true;
    // ── debris ──
    this.dN = Math.round(260 * Math.max(0.5, this.q));
    this.dGeo = chunkGeo();
    this.deb = new T.InstancedMesh(this.dGeo, E.Mat.pbr({ vertexColors: true, roughness: 0.85, metalness: 0.1 }), this.dN);
    this.deb.frustumCulled = false; this.deb.castShadow = false; this.deb.count = 0;
    this.deb.setColorAt(0, new T.Color(1, 1, 1));
    this.scene.fx.add(this.deb);
    this.dp = new Float32Array(this.dN * 3); this.dv = new Float32Array(this.dN * 3); this.dr = new Float32Array(this.dN * 3); this.dw = new Float32Array(this.dN * 3);
    this.dlife = new Float32Array(this.dN); this.dsz = new Float32Array(this.dN); this.dgrav = new Float32Array(this.dN); this.dtrail = new Float32Array(this.dN); this.dI = 0;
    // ── scorch decals ──
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d'), id = x.createImageData(64, 64), rn = E.RNG(5);
    for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
      const dx = (i - 31.5) / 32, dy = (j - 31.5) / 32, d = Math.hypot(dx, dy), ang = Math.atan2(dy, dx), edge = 0.7 + 0.28 * Math.sin(ang * 7 + 1.3) * Math.cos(ang * 3) + (rn.next() - 0.5) * 0.12;
      const a = Math.max(0, 1 - d / edge); const k = (i + j * 64) * 4; id.data[k] = id.data[k + 1] = id.data[k + 2] = 255; id.data[k + 3] = Math.min(255, Math.pow(a, 0.6) * 255);
    }
    x.putImageData(id, 0, 0); const stex = new T.CanvasTexture(cv);
    this.sN = 96; this.sI = 0;
    const sg = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.scorchMat = E.Mat.emissive({ map: stex, color: 0x0b0907, transparent: true, opacity: 0.72 });
    this.scorchMat.polygonOffset = true; this.scorchMat.polygonOffsetFactor = -2; this.scorchMat.polygonOffsetUnits = -2;
    this.scorches = new T.InstancedMesh(sg, this.scorchMat, this.sN); this.scorches.frustumCulled = false; this.scorches.count = 0; this.scorches.renderOrder = 1;
    this.scene.fx.add(this.scorches); this.sRec = [];
    // ── flares (countermeasures) ──
    this.flareList = [];
    // ── pods and bolts in transit ──
    this.transit = [];
    this._dm = new T.Matrix4(); this._dq = new T.Quaternion(); this._dv = new T.Vector3(); this._ds = new T.Vector3(); this._de = new T.Euler(); this._dc = new T.Color();
    this.lightBudget = 0;
  };

  P.debris = function (p, n, rgb, speed, spread, o) {
    this.initArt(); o = o || {};
    const r = this.rng, T = this.dN;
    n = Math.min(n, 40);
    for (let k = 0; k < n; k++) {
      const i = this.dI; this.dI = (i + 1) % T;
      const a = r.angle(), e = Math.acos(r.f(0.05, 1)), s = speed * r.f(0.3, 1);
      this.dp[i * 3] = p.x + Math.cos(a) * spread * r.f(0, 0.6); this.dp[i * 3 + 1] = p.y; this.dp[i * 3 + 2] = p.z + Math.sin(a) * spread * r.f(0, 0.6);
      this.dv[i * 3] = Math.sin(e) * Math.cos(a) * s; this.dv[i * 3 + 1] = Math.cos(e) * s * (o.up || 1); this.dv[i * 3 + 2] = Math.sin(e) * Math.sin(a) * s;
      this.dr[i * 3] = r.f(0, TAU); this.dr[i * 3 + 1] = r.f(0, TAU); this.dr[i * 3 + 2] = r.f(0, TAU);
      this.dw[i * 3] = r.f(-6, 6); this.dw[i * 3 + 1] = r.f(-6, 6); this.dw[i * 3 + 2] = r.f(-6, 6);
      this.dlife[i] = o.life ? o.life * r.f(0.7, 1.2) : r.f(3.5, 7); this.dsz[i] = (o.size || 0.3) * r.f(0.5, 1.5); this.dgrav[i] = o.grav === undefined ? 16 : o.grav; this.dtrail[i] = o.trail ? 1 : 0;
      const v = r.f(0.7, 1.15); this.deb.setColorAt(i, this._dc.setRGB(rgb[0] / 255 * v * 0.45, rgb[1] / 255 * v * 0.45, rgb[2] / 255 * v * 0.45));
    }
    this.deb.count = T; if (this.deb.instanceColor) this.deb.instanceColor.needsUpdate = true;
  };

  P.updateDebris = function (dt) {
    if (!this._art) return;
    const m = this._dm, q = this._dq, v = this._dv, s = this._ds, e = this._de, N = this.dN, t = this.terrain;
    let any = false;
    for (let i = 0; i < N; i++) {
      const L = this.dlife[i];
      if (L <= 0) { if (this.dsz[i] !== 0) { this.dsz[i] = 0; m.makeScale(0, 0, 0); this.deb.setMatrixAt(i, m); any = true; } continue; }
      this.dlife[i] = L - dt; any = true;
      const j = i * 3, g = this.dgrav[i];
      this.dv[j + 1] -= g * dt;
      this.dp[j] += this.dv[j] * dt; this.dp[j + 1] += this.dv[j + 1] * dt; this.dp[j + 2] += this.dv[j + 2] * dt;
      if (g > 0 && t) {
        const gy = t.height(this.dp[j], this.dp[j + 2]) + this.dsz[i] * 0.2;
        if (this.dp[j + 1] < gy) { this.dp[j + 1] = gy; this.dv[j + 1] *= -0.32; this.dv[j] *= 0.55; this.dv[j + 2] *= 0.55; this.dw[j] *= 0.5; this.dw[j + 1] *= 0.5; this.dw[j + 2] *= 0.5; if (Math.abs(this.dv[j + 1]) < 0.8) { this.dv[j + 1] = 0; this.dw[j] = this.dw[j + 1] = this.dw[j + 2] = 0; } }
      }
      this.dr[j] += this.dw[j] * dt; this.dr[j + 1] += this.dw[j + 1] * dt; this.dr[j + 2] += this.dw[j + 2] * dt;
      const sc = this.dsz[i] * Math.min(1, L * 1.2);
      e.set(this.dr[j], this.dr[j + 1], this.dr[j + 2]); q.setFromEuler(e); m.compose(v.set(this.dp[j], this.dp[j + 1], this.dp[j + 2]), q, s.set(sc, sc, sc)); this.deb.setMatrixAt(i, m);
      if (this.dtrail[i] && this.rng.next() < dt * 20) { this.smoke.emit(this.dp[j], this.dp[j + 1], this.dp[j + 2], 0, 0, 0, 1.6, sc * 0.7, sc * 3, 0.1, 0.1, 0.1, 0.4, 0.5, 0); if (this.rng.next() < 0.5) this.add.emit(this.dp[j], this.dp[j + 1], this.dp[j + 2], 0, 0, 0, 0.35, sc, sc * 0.3, 3, 1.2, 0.3, 0.9, 0, 0); }
    }
    if (any) this.deb.instanceMatrix.needsUpdate = true;
  };

  // persistent dark scars on the ground
  P.scorch = function (p, r, k) {
    this.initArt();
    const t = this.terrain, y = (t ? t.height(p.x, p.z) : p.y) + 0.07;
    const rec = { x: p.x, y, z: p.z, r: Math.max(2, r * 2.4), a: this.rng.angle(), k: k || 0.5, age: 0 };
    if (this.sRec.length >= this.sN) this.sRec.shift();
    this.sRec.push(rec); this.dirtyScorch = true;
  };
  P.updateScorch = function () {
    if (!this._art || !this.dirtyScorch) return; this.dirtyScorch = false;
    const m = this._dm, q = this._dq, v = this._dv, s = this._ds, up = new E.THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.sRec.length; i++) { const c = this.sRec[i]; q.setFromAxisAngle(up, c.a); m.compose(v.set(c.x, c.y, c.z), q, s.set(c.r, 1, c.r)); this.scorches.setMatrixAt(i, m); }
    this.scorches.count = this.sRec.length; this.scorches.visible = this.sRec.length > 0; this.scorches.instanceMatrix.needsUpdate = true;
  };

  // a flash that also borrows one of the pooled point lights when the budget allows
  P.muzzle = function (p, size, col, power) {
    this.flash(p, size, col, 0.06);
    if (power && this.lightBudget < 2) { this.light(p, col, power, 24 + size * 8); this.lightBudget++; }
  };

  // layered explosion on top of the base one: ground shock ring, dust ring, debris, scorch, lingering smoke column
  P.blast = function (p, size, o) {
    this.initArt(); o = o || {};
    const t = this.terrain, gy = t ? t.height(p.x, p.z) : p.y, near = p.y - gy < size * 0.9 + 3;
    this.explosion(p, size, o.col);
    if (o.space) { this.debris(p, Math.min(30, 6 + size * 0.6), o.hull || [90, 94, 104], size * 2.6, size * 0.5, { grav: 0, life: 18, size: Math.max(0.4, size * 0.12), trail: size > 12 }); return; }
    this.debris(p, Math.min(26, 6 + size * 0.8), o.dirt || [110, 96, 78], size * 1.5, size * 0.6, { grav: 18, size: Math.max(0.2, size * 0.04), trail: size > 10 });
    if (near) {
      this.ring({ x: p.x, y: gy, z: p.z }, size * 3.4, [1, 0.8, 0.5], 0.5, true);
      const c = this.dustCol; for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + this.rng.f(-0.3, 0.3); this.smoke.emit(p.x, gy + 0.6, p.z, Math.cos(a) * size * 1.6, size * 0.2, Math.sin(a) * size * 1.6, 1.8, size * 0.5, size * 1.9, c[0], c[1], c[2], 0.5, 1.6, 0); }
      if (size >= 5) this.scorch({ x: p.x, y: gy, z: p.z }, size * 0.9, 0.7);
      if (size >= 8) this.emitter({ pos: { x: p.x, y: gy + 1, z: p.z }, life: 4 + size * 0.25, rate: 3 + size * 0.2, kind: 'burn', size: Math.max(1, size * 0.12) });
    }
  };

  // vapour / contrail / smoke column helpers
  P.trail = function (x, y, z, size, life, alpha, rgb) { rgb = rgb || [0.9, 0.93, 0.98]; this.smoke.emit(x, y, z, 0, 0, 0, life, size, size * 3.2, rgb[0], rgb[1], rgb[2], alpha, 0.2, 0); };

  P.flare = function (pos, vel) { this.initArt(); this.flareList.push({ x: pos.x, y: pos.y, z: pos.z, vx: vel.x * 0.4, vy: vel.y * 0.4 - 4, vz: vel.z * 0.4, t: 0 }); if (this.flareList.length > 24) this.flareList.shift(); };

  // flak: a black burst with a flash and shrapnel
  P.flak = function (p) { this.flash(p, 5, [1, 0.8, 0.5], 0.09); this.puff(p, 2, [0.08, 0.08, 0.09], 3.6, 2.4, 0.3, 1.6); this.spark(p, 5, [1, 0.85, 0.5], 22, 0.4, 0.1); };

  const SURF = { ground: 'dust', water: 'splash' };

  // ── per-frame art updates called by the renderer ──
  P.updateArt = function (dt, t, world) {
    this.lightBudget = 0;
    // emitters may follow a unit (crippled vehicles): keep them in step and end them with the unit
    for (const e of this.emitters) if (e.follow) { if (!e.follow.alive) e.t = e.life; else { e.pos.x = e.follow.pos.x; e.pos.y = e.follow.pos.y + 1.5; e.pos.z = e.follow.pos.z; } }
    this.updateDebris(dt); this.updateScorch();
    for (let i = this.flareList.length - 1; i >= 0; i--) {
      const f = this.flareList[i]; f.t += dt; f.vy -= 14 * dt; f.vx *= 1 - dt * 0.6; f.vz *= 1 - dt * 0.6; f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
      const k = 1 - f.t / 4.2;
      this.add.emit(f.x, f.y, f.z, 0, 0, 0, 0.12, 2.6 * Math.max(0.3, k), 1.2, 4, 3.0, 1.6, Math.max(0.2, k), 0, 0);
      if (this.rng.next() < dt * 40) this.smoke.emit(f.x, f.y, f.z, this.rng.f(-1, 1), this.rng.f(0, 1), this.rng.f(-1, 1), 3.2, 0.6, 3.4, 0.85, 0.85, 0.88, 0.35, 0.6, 0);
      if (f.t > 4.2) this.flareList.splice(i, 1);
    }
    for (let i = this.transit.length - 1; i >= 0; i--) {
      const q = this.transit[i]; q.t += dt; const k = Math.min(1, q.t / q.dur);
      const tp = q.target ? (world.umap && world.umap.get(q.target) ? world.umap.get(q.target).pos : q.to) : q.to;
      q.x = q.x0 + (tp.x - q.x0) * k; q.y = q.y0 + (tp.y - q.y0) * k; q.z = q.z0 + (tp.z - q.z0) * k;
      this.add.emit(q.x, q.y, q.z, 0, 0, 0, 0.5, 2.4, 0.5, 3, 1.8, 0.5, 0.9, 0, 0);
      this.smoke.emit(q.x, q.y, q.z, 0, 0, 0, 1.6, 1.0, 3.5, 0.8, 0.85, 0.9, 0.3, 0.3, 0);
      if (k >= 1) { this.flash(q.to, 14, [1, 0.8, 0.5], 0.2); this.transit.splice(i, 1); }
    }
  };

  // ── events not handled by the base FX ──
  P.events2 = function (events, world) {
    this.initArt();
    const cam = this.scene.camera.position, near = (p, d) => p && E.distXZ2(cam, p) < d * d;
    for (const e of events) {
      switch (e.type) {
        case 'fire': {
          const W = E.WEAPONS[e.wk] || {}, big = (W.scale || 1) >= 2;
          if (!near(e.pos, big ? 3000 : 400)) break;
          // muzzle flash with a light for the heavier guns and anything near the camera
          const c = E.TEAM_BOLT[e.team] || HOT;
          if (W.kind === 'bolt' && e.wk !== 'flak') this.muzzle(e.pos, 0.9 + (W.scale || 1) * 0.5, [c[0] * 1.2, c[1] * 1.2, c[2] * 1.2], near(e.pos, 40) ? 5 : 0);
          else if (W.kind === 'turbo') { this.flash(e.pos, 22, c, 0.2); this.light(e.pos, c, 600, 260); }
          else if (W.kind === 'shell') { this.muzzle(e.pos, 4, HOT, 80); this.puff(e.pos, 3, [0.5, 0.48, 0.45], 3, 1.2, 0.5, 5); }
          break;
        }
        case 'impact': {
          const p = e.pos, W = E.WEAPONS[e.wk] || {};
          if (!near(p, 900)) break;
          if (e.surf === 'air' && (e.wk === 'aaflak' || e.wk === 'flak')) this.flak(p);
          else if (e.surf === 'ground' && !(e.splash > 0)) { this.debris(p, 2, [this.dustCol[0] * 255, this.dustCol[1] * 255, this.dustCol[2] * 255], 4, 0.3, { grav: 14, size: 0.08, life: 1.5 }); }
          else if (e.surf === 'water' && !(e.splash > 0)) { this.ring(p, 1.8, [0.8, 0.92, 1], 0.5, true); this.puff(p, 3, [0.9, 0.95, 1], 0.7, 0.8, 3, 0.5); }
          else if (e.surf === 'hull') { this.spark(p, 8, [1, 0.8, 0.5], 14, 0.5, 0.12); this.flash(p, 5, [1, 0.9, 0.7], 0.1); }
          if (e.splash > 0 && e.surf !== 'water' && e.surf !== 'shield') { const sz = e.splash; this.debris(p, Math.min(20, 4 + sz), [this.dustCol[0] * 255, this.dustCol[1] * 255, this.dustCol[2] * 255], sz * 1.3, sz * 0.4, { grav: 18, size: Math.max(0.15, sz * 0.03) }); if (sz >= 5 && (e.surf === 'ground')) this.scorch(p, sz * 0.7, 0.6); }
          break;
        }
        case 'wreck': { const p = e.pos; this.blast({ x: p.x, y: p.y + 1.5, z: p.z }, 12, { dirt: [60, 56, 52] }); this.emitter({ pos: { x: p.x, y: p.y + 1.5, z: p.z }, life: 70, rate: 5, kind: 'burn', size: 2.2 }); if (this.onShake) this.onShake(p, 12); break; }
        case 'structureDown': { const p = e.pos; this.blast({ x: p.x, y: p.y + 2, z: p.z }, e.utype === 'ioncannon' ? 24 : 14, {}); this.emitter({ pos: { x: p.x, y: p.y + 2, z: p.z }, life: 80, rate: 6, kind: 'burn', size: 2.6 }); if (this.onShake) this.onShake(p, 16); break; }
        case 'armor': if (near(e.pos, 300)) { this.spark(e.pos, 6, [1, 0.8, 0.5], 12, 0.4, 0.1); this.flash(e.pos, 2.4, [1, 0.9, 0.7], 0.06); } break;
        case 'cripple': { const u = world.umap && world.umap.get(e.uid); if (u) this.emitter({ pos: u.pos, follow: u, life: 40, rate: 6, kind: 'burn', size: 1.2 }); break; }
        case 'recover': break;
        case 'ram': case 'bump': if (near(e.pos, 400)) { this.spark(e.pos, 10, [1, 0.8, 0.5], 12, 0.5, 0.1); this.puff(e.pos, 3, this.dustCol, 1.6, 1.2, 1, 2.5); if (this.onShake) this.onShake(e.pos, 3); } break;
        case 'slide': this.puff({ x: e.pos.x, y: e.pos.y + 0.1, z: e.pos.z }, 3, this.dustCol, 0.7, 0.9, 0.8, 1.2); break;
        case 'vault': this.puff({ x: e.pos.x, y: e.pos.y + 0.2, z: e.pos.z }, 2, this.dustCol, 0.5, 0.7, 0.6, 0.9); break;
        case 'suppress': break;
        case 'flare': this.flare(e.pos, e.vel || { x: 0, y: 0, z: 0 }); break;
        case 'bombAway': this.puff(e.pos, 2, [0.8, 0.8, 0.82], 3, 1.4, 0.2, 2); break;
        case 'boost': if (e.on) { const u = world.umap && world.umap.get(e.uid); if (u) { this.flash(u.pos, 10, [1, 0.8, 0.5], 0.18); this.ring(u.pos, 18, [0.8, 0.9, 1], 0.5, false); } } break;
        case 'evade': { const u = world.umap && world.umap.get(e.uid); if (u) for (let i = 0; i < 10; i++) this.trail(u.pos.x + (i - 5) * 0.6, u.pos.y, u.pos.z, 1.0, 1.2, 0.4); break; }
        case 'crash': {
          const p = e.pos;
          if (e.surf === 'water') { this.puff(p, 10, [0.9, 0.95, 1], 10, 2.4, 9, 12); this.ring(p, 36, [0.7, 0.88, 1], 1.2, true); this.explosion({ x: p.x, y: p.y + 1, z: p.z }, 6); }
          else if (e.surf === 'hull') { this.blast(p, 9, { space: true }); this.spark(p, 30, [1, 0.75, 0.4], 30, 1.2, 0.2); this.light(p, [1, 0.6, 0.3], 800, 200); }
          else { this.blast({ x: p.x, y: p.y + 1, z: p.z }, 16, {}); this.spark(p, 20, [1, 0.7, 0.35], 24, 1.4, 0.2); this.scorch(p, 12, 0.8); this.emitter({ pos: { x: p.x, y: p.y + 1, z: p.z }, life: 45, rate: 6, kind: 'burn', size: 2 }); }
          if (this.onShake) this.onShake(p, 18); break;
        }
        case 'airDrop': { const p = e.pos, gy = this.terrain ? this.terrain.height(p.x, p.z) : 0; this.ring({ x: p.x, y: gy, z: p.z }, 14, [0.6, 0.9, 1], 0.9, true); this.puff({ x: p.x, y: gy + 0.5, z: p.z }, 6, this.dustCol, 4, 2, 1.2, 8); break; }
        case 'troopsLost': this.blast(e.pos, 9, { space: false }); break;
        case 'mine': case 'mineBlast': case 'charge': case 'chargeBlast': case 'defuse': case 'build': case 'repair': case 'ion': case 'strikeBlocked':
          if (this.overlay) this.overlay.event(e, world); break;
        case 'objDone': if (e.success) { const o = (world.objs || []).find(x => x.id === e.id); if (o && o.pos) this.ring(o.pos, 40, [1, 0.9, 0.5], 1.2, true); } break;
        case 'coverBreak': case 'coverStage': if (this.cover && e.type === 'coverBreak') this.cover.breakFx(this, e); else if (e.type === 'coverStage' && near(e.pos, 300)) { this.debris(e.pos, 4, [140, 134, 120], 3.5, 0.4, { grav: 16, size: 0.1, life: 2 }); this.puff(e.pos, 2, this.dustCol, 1.0, 0.9, 0.8, 1.4); } break;
        default: if (this.space) this.space.event(e, world); break;
      }
    }
  };
})(window.E = window.E || {});
