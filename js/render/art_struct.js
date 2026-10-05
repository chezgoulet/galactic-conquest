// Land structures and in-world markers:
//   makeStructure(F, type)   battery / aabattery / nest / shieldgen / ioncannon, each its own model
//   Overlay                  shield domes, ion cannon beam + charge glow, mines, planted charges, repair beams,
//                            objective markers: all driven from world state and sim events
//   Clutter                  camera-centred scatter of grass tufts / pebbles / shards so the ground holds up at 2 m
(function (E) {
  'use strict';
  const sh = (c, k) => E.Geo.shade(c, k);
  const cache = new Map();
  const cached = (k, f) => { let g = cache.get(k); if (!g) { g = f(); cache.set(k, g); } return g; };

  // ═══ structures ═══
  function build(F, type) {
    const P = F.palette, org = F.hull.style === 'organic';
    const base = new E.Geo.Builder(1), head = new E.Geo.Builder(1), gun = new E.Geo.Builder(1), extra = new E.Geo.Builder(1);
    const c1 = P.hull, c2 = P.hullDark, c3 = P.hullLight, acc = P.accent, dark = sh(P.hullDark, 0.55), glow = P.glow;
    const sand = [150, 132, 98];
    if (type === 'battery') {
      base.cyl(3.7, 4.2, 1.3, 10, 0, 0.65, 0, c2, { mode: 2 });
      base.cyl(3.0, 3.3, 0.5, 10, 0, 1.55, 0, c1, { mode: 2 });
      for (let i = 0; i < 6; i++) { const a = i / 6 * E.TAU; base.box(1.5, 0.9, 0.9, Math.cos(a) * 3.9, 0.45, Math.sin(a) * 3.9, c2, { ry: -a + Math.PI / 2, taper: [0.8, 0.8], mode: 2 }); }
      for (let i = 0; i < 3; i++) { const a = i / 3 * E.TAU + 0.5; base.box(0.5, 0.15, 0.5, Math.cos(a) * 2.6, 1.87, Math.sin(a) * 2.6, acc, { mode: 0, emi: 0.8 }); }
      if (org) head.sphere(1.9, 0, 0.55, 0, c3, { sy: 0.6, sz: 1.2, seg: 12, seg2: 8, mode: 1 }); else { head.box(2.8, 1.2, 3.2, 0, 0.6, -0.1, c3, { taper: [0.72, 0.78], mode: 2 }); head.box(3.2, 0.5, 2.0, 0, 0.3, -0.6, c1, { mode: 2 }); }
      head.box(0.7, 0.35, 0.8, 0.85, 1.35, -0.7, dark, { mode: 1 }); head.cyl(0.06, 0.06, 1.4, 5, -0.9, 1.7, -1.2, dark, { mode: 0 }); head.sphere(0.3, -0.9, 2.4, -1.2, glow, { emi: 2.5, mode: 0 });
      head.box(1.4, 0.18, 0.1, 0, 0.78, 1.55, glow, { emi: 3, mode: 0 });
      for (const s of [-1, 1]) { gun.cyl(0.17, 0.2, 4.2, 8, s * 0.62, 0, 2.2, dark, { rx: Math.PI / 2, mode: 1, smooth: true }); gun.cyl(0.26, 0.26, 0.6, 8, s * 0.62, 0, 4.2, c2, { rx: Math.PI / 2, mode: 1 }); gun.box(0.14, 0.14, 0.08, s * 0.62, 0, 4.52, glow, { emi: 5, mode: 0 }); gun.box(0.5, 0.55, 0.9, s * 0.62, 0, 0.2, c1, { mode: 1 }); }
      gun.box(1.9, 0.5, 1.0, 0, 0, 0.3, c2, { mode: 2 });
      return { base: base.build(), head: head.build(), gun: gun.build(), ty: 2.0, gy: 0.5, gz: 0.4 };
    }
    if (type === 'aabattery') {
      base.cyl(3.0, 3.4, 0.9, 8, 0, 0.45, 0, c2, { mode: 2 });
      for (let i = 0; i < 4; i++) { const a = i / 4 * E.TAU + 0.4; base.box(1.0, 0.8, 1.0, Math.cos(a) * 3.0, 0.4, Math.sin(a) * 3.0, sh(c1, 0.9), { ry: a, mode: 2 }); }   // ammo bunkers
      base.cyl(1.4, 1.8, 1.1, 8, 0, 1.4, 0, c1, { mode: 2 });
      for (let i = 0; i < 3; i++) { const a = i / 3 * E.TAU; base.cyl(0.08, 0.08, 3.4, 5, Math.cos(a) * 3.3, 2.2, Math.sin(a) * 3.3, dark, { mode: 0 }); }
      base.box(2.4, 0.1, 0.1, 0, 3.2, 0, acc, { mode: 0, emi: 0.9 });
      head.box(2.2, 1.0, 2.2, 0, 0.5, -0.1, c3, { taper: [0.8, 0.8], mode: 2 }); head.cyl(0.9, 1.1, 0.5, 8, 0, 0.1, 0, c1, { mode: 1 });
      head.box(0.12, 1.6, 1.4, 0.9, 1.45, -0.8, c2, { taper: [1, 0.3], mode: 1 }); head.cyl(0.04, 0.04, 1.0, 5, 0.9, 2.6, -0.8, dark, { mode: 0 });   // radar fin
      head.sphere(0.34, -0.7, 1.15, -0.2, glow, { emi: 2.8, mode: 0 });
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        gun.cyl(0.1, 0.12, 3.6, 7, sx * 0.55, sy * 0.3, 2.2, dark, { rx: Math.PI / 2, mode: 1, smooth: true });
        gun.cyl(0.18, 0.18, 0.5, 7, sx * 0.55, sy * 0.3, 4.0, c2, { rx: Math.PI / 2, mode: 1 });
        gun.box(0.08, 0.08, 0.06, sx * 0.55, sy * 0.3, 4.28, glow, { emi: 5, mode: 0 });
      }
      gun.box(1.7, 1.0, 1.2, 0, 0, 0.5, c1, { mode: 2 });
      return { base: base.build(), head: head.build(), gun: gun.build(), ty: 1.9, gy: 0.5, gz: 0.4 };
    }
    if (type === 'nest') {
      // sandbag ring open to the front, ammo crates, camo awning
      for (let r = 0; r < 3; r++) for (let i = 0; i < 16; i++) {
        const a = (i / 16 - 0.5) * 4.6 + Math.PI, rr = 2.3, x = Math.sin(a) * rr, z = Math.cos(a) * rr - 0.2;
        if (r === 2 && i % 3 === 0) continue;
        base.sphere(0.42, x, 0.22 + r * 0.34, z, sh(sand, 0.9 + ((i + r * 5) % 4) * 0.05), { sx: 1.0, sy: 0.55, sz: 0.7, ry: -a, seg: 7, seg2: 5, mode: 0, rz: ((i * 7) % 5 - 2) * 0.03 });
      }
      base.box(1.0, 0.8, 0.8, 1.5, 0.4, -1.8, sh(P.hull, 1.0), { ry: 0.3, mode: 1 }); base.box(0.8, 0.5, 0.8, 0.5, 0.25, -2.2, sh(P.hull, 0.85), { ry: -0.2, mode: 1 });
      base.box(1.6, 0.06, 1.2, -1.5, 2.1, -1.6, sh(P.hullDark, 1.3), { rz: 0.1, mode: 0 }); for (const s of [-1, 1]) base.cyl(0.04, 0.04, 2.1, 5, -1.5 + s * 0.7, 1.05, -1.6 - s * 0.4, dark, { mode: 0 });
      head.box(0.9, 0.9, 0.2, 0, 0.35, 0.65, c1, { taper: [1, 0.8], mode: 1 }); head.box(0.14, 0.14, 0.7, 0.4, 0.1, 0, dark, { mode: 0 }); head.cyl(0.35, 0.4, 0.3, 8, 0, -0.1, 0, c2, { mode: 1 });
      head.box(0.8, 0.05, 0.05, 0, 0.85, 0.66, glow, { emi: 2.4, mode: 0 });
      gun.cyl(0.07, 0.08, 1.7, 6, 0, 0, 0.9, dark, { rx: Math.PI / 2, mode: 1, smooth: true }); gun.box(0.4, 0.3, 0.7, 0, 0, 0.1, c1, { mode: 1 }); gun.box(0.05, 0.05, 0.06, 0, 0, 1.78, glow, { emi: 5, mode: 0 });
      gun.cyl(0.14, 0.14, 0.3, 7, 0, 0.26, 0.25, c2, { mode: 1 });    // ammo drum
      return { base: base.build(), head: head.build(), gun: gun.build(), ty: 0.9, gy: 0.35, gz: 0.1 };
    }
    if (type === 'shieldgen') {
      base.cyl(3.8, 4.3, 0.8, 8, 0, 0.4, 0, c2, { mode: 2 });
      base.cyl(2.4, 3.0, 1.2, 8, 0, 1.4, 0, c1, { mode: 2 });
      base.cyl(0.9, 1.5, 4.2, 8, 0, 4.1, 0, c3, { mode: 2 });
      for (let i = 0; i < 3; i++) { const a = i / 3 * E.TAU + 0.4; base.box(0.45, 3.6, 1.6, Math.cos(a) * 1.6, 3.2, Math.sin(a) * 1.6, sh(c1, 1.1), { ry: -a, taper: [1, 0.3], mode: 1 }); base.box(1.1, 0.9, 1.5, Math.cos(a) * 3.2, 0.9, Math.sin(a) * 3.2, c2, { ry: -a + Math.PI / 2, taper: [0.8, 0.8], mode: 2 }); }
      base.sphere(0.6, 0, 6.5, 0, glow, { emi: 2.8, mode: 0 });
      for (let i = 0; i < 5; i++) { const a = i / 5 * E.TAU; base.cyl(0.06, 0.06, 3.0, 4, Math.cos(a) * 3.6, 0.1, Math.sin(a) * 3.6, dark, { rz: Math.PI / 2, ry: a, mode: 0 }); }
      head.torus(2.0, 0.14, 0, 0, 0, glow, { rx: Math.PI / 2, emi: 2.6, mode: 0, seg: 28 }); head.torus(1.4, 0.1, 0, 0.5, 0, acc, { rx: Math.PI / 2, emi: 2.0, mode: 0, seg: 24 });
      for (let i = 0; i < 6; i++) { const a = i / 6 * E.TAU; head.box(0.3, 0.3, 0.6, Math.cos(a) * 2.0, 0, Math.sin(a) * 2.0, c3, { ry: -a, mode: 1 }); }
      return { base: base.build(), head: head.build(), gun: new E.Geo.Builder(1).build(), ty: 5.3, gy: 0, gz: 0 };
    }
    // ioncannon
    base.cyl(5.8, 6.4, 1.2, 10, 0, 0.6, 0, c2, { mode: 2 });
    base.cyl(4.0, 4.6, 1.4, 10, 0, 1.9, 0, c1, { mode: 2 });
    for (let i = 0; i < 4; i++) { const a = i / 4 * E.TAU + 0.8; base.box(1.1, 6.0, 1.1, Math.cos(a) * 3.6, 4.0, Math.sin(a) * 3.6, c2, { ry: -a, taper: [0.7, 0.7], mode: 2 }); base.cyl(0.3, 0.3, 0.5, 6, Math.cos(a) * 3.6, 7.2, Math.sin(a) * 3.6, glow, { emi: 2.0, mode: 0 }); }
    for (let i = 0; i < 8; i++) { const a = i / 8 * E.TAU; base.box(0.5, 0.18, 0.5, Math.cos(a) * 5.2, 1.26, Math.sin(a) * 5.2, acc, { emi: 1.2, mode: 0 }); }
    head.cyl(2.2, 2.6, 1.8, 10, 0, 0.8, 0, c1, { mode: 2 });
    head.sphere(3.8, 0, 3.0, 0.4, c3, { sy: 0.38, seg: 18, seg2: 8, mode: 1 });    // the dish (squashed hemisphere face-up)
    head.torus(3.6, 0.17, 0, 3.55, 0.4, glow, { rx: Math.PI / 2, emi: 2.0, mode: 0, seg: 32 });
    gun.cyl(0.18, 0.22, 7.0, 6, 0, 0, 3.6, dark, { rx: Math.PI / 2, mode: 1, smooth: true });
    for (let i = 0; i < 3; i++) { const a = i / 3 * E.TAU; gun.cyl(0.07, 0.07, 6.2, 4, Math.cos(a) * 0.9, Math.sin(a) * 0.9, 3.1, c2, { rx: Math.PI / 2 + Math.cos(a) * 0.1, mode: 0 }); }
    gun.cyl(0.32, 0.32, 0.5, 8, 0, 0, 7.1, c2, { rx: Math.PI / 2, mode: 1 });
    extra.sphere(0.5, 0, 0, 0, [220, 240, 255], { emi: 6, mode: 0, seg: 10, seg2: 8 });
    return { base: base.build(), head: head.build(), gun: gun.build(), extra: extra.build(), ty: 3.0, gy: 3.0, gz: 0.2 };
  }

  function makeStructure(F, type) {
    const T = E.THREE, g = cached('st:' + F.id + ':' + type, () => build(F, type));
    const mat = E.Geo.material(), mk = (geo) => { const m = new T.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; return m; };
    const root = new T.Group(); root.add(mk(g.base));
    const turret = new T.Group(); turret.position.y = g.ty; root.add(turret);
    const head = mk(g.head); turret.add(head);
    const gun = mk(g.gun); gun.position.set(0, g.gy, g.gz); turret.add(gun);
    const out = { root, body: root, turret, gun, head, fixedBase: true, kind: type, spin: type === 'shieldgen' ? head : null };
    if (g.extra) {
      const core = new T.Mesh(g.extra, E.Mat.emissive({ color: 0xbfe6ff, intensity: 4, additive: true, transparent: true })); core.position.set(0, 0, 7.3); core.scale.setScalar(0.01); gun.add(core); out.core = core;
    }
    if (type === 'shieldgen') {
      const gl = new T.Sprite(E.Mat.sprite({ map: E.ArtStruct.glowTex(), color: new T.Color(...F.palette.glow.map(v => v / 255 * 3)), additive: true })); gl.scale.setScalar(9); gl.position.y = 6.5; root.add(gl); out.glow = gl;
    }
    return out;
  }

  let _glow = null;
  function glowTex() {
    if (_glow) return _glow;
    const T = E.THREE, cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    _glow = new T.CanvasTexture(cv); return _glow;
  }

  // ═══ overlay: domes, beams, mines, charges, objectives ═══
  class Overlay {
    constructor(renderer) {
      const T = E.THREE; this.R = renderer; this.S = renderer.scene; this.group = new T.Group(); this.S.world.add(this.group);
      this.domes = new Map(); this.beams = []; this.objs = new Map(); this.t = 0;
      this._m = new T.Matrix4(); this._q = new T.Quaternion(); this._p = new T.Vector3(); this._s = new T.Vector3(); this._c = new T.Color(); this._y = new T.Vector3(0, 1, 0);
      // mines
      const mb = new E.Geo.Builder(0);
      mb.cyl(0.32, 0.38, 0.12, 10, 0, 0.06, 0, [62, 66, 60], { mode: 1 }); mb.cyl(0.18, 0.2, 0.06, 8, 0, 0.14, 0, [40, 42, 40], { mode: 1 });
      this.mines = new T.InstancedMesh(mb.build(), E.Geo.material(), 160); this.mines.count = 0; this.mines.frustumCulled = false; this.mines.setColorAt(0, this._c.setRGB(1, 1, 1));
      this.mineLed = new T.InstancedMesh(new T.SphereGeometry(0.07, 6, 4), E.Mat.emissive({ color: 0xffffff, additive: true, transparent: true }), 160); this.mineLed.count = 0; this.mineLed.frustumCulled = false; this.mineLed.setColorAt(0, this._c.setRGB(1, 1, 1));
      this.group.add(this.mines, this.mineLed);
      // charges
      const cb = new E.Geo.Builder(0);
      cb.box(0.5, 0.34, 0.5, 0, 0, 0, [92, 98, 88], { mode: 1 }); cb.box(0.4, 0.06, 0.4, 0, 0.2, 0, [220, 160, 40], { mode: 0 });
      this.charges = new T.InstancedMesh(cb.build(), E.Geo.material(), 48); this.charges.count = 0; this.charges.frustumCulled = false;
      this.chargeLed = new T.InstancedMesh(new T.SphereGeometry(0.1, 6, 4), E.Mat.emissive({ color: new T.Color(6, 0.4, 0.2), additive: true, transparent: true }), 48); this.chargeLed.count = 0; this.chargeLed.frustumCulled = false;
      this.group.add(this.charges, this.chargeLed);
      // beam pool (ion, repair)
      const bg = new T.CylinderGeometry(1, 1, 1, 10, 1, true);
      this.beamGeo = bg;
      for (let i = 0; i < 6; i++) { const m = new T.Mesh(bg, E.Mat.beam({ color: 0xffffff, freq: 14, speed: 30 })); m.visible = false; m.frustumCulled = false; m.renderOrder = 7; this.group.add(m); this.beams.push({ m, life: 0, max: 1, w: 1, a: 1, kind: '' }); }
      this.ionFlash = null; this.sparksT = 0;
    }
    beamAt(kind, a, b, width, color, life, amp) {
      let s = this.beams.find(x => x.life <= 0 && x.kind !== 'hold');
      if (!s) return null;
      s.kind = kind; s.life = s.max = life; s.w = width; s.m.visible = true; s.m.material.userData.col.value.setRGB(color[0], color[1], color[2]); s.amp = amp || 1;
      this.orient(s.m, a, b, width); return s;
    }
    orient(m, a, b, w) {
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz) || 1;
      m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      this._p.set(dx / len, dy / len, dz / len); m.quaternion.setFromUnitVectors(this._y, this._p); m.scale.set(w, len, w);
    }
    event(e, world) {
      const fx = this.R.fx;
      if (e.type === 'ion') {
        const f = e.from || (world.ion && world.ion.pos) || { x: 0, y: 0, z: 0 }, to = e.to;
        const a = { x: f.x, y: f.y + 9, z: f.z };
        this.beamAt('ion', a, to, 5.5, [0.55, 1.4, 3.2], 1.4, 1.0);
        this.beamAt('ion', a, to, 2.0, [3.0, 4.0, 5.0], 1.4, 1.0);
        fx.ring({ x: f.x, y: f.y, z: f.z }, 70, [0.4, 0.8, 1], 1.0, true); fx.flash({ x: f.x, y: f.y + 9, z: f.z }, 40, [0.5, 0.8, 1], 0.5); fx.light(a, [0.5, 0.8, 1], 200, 150);
        fx.spark(a, 24, [0.6, 0.9, 1], 30, 1.2, 0.3);
        this.R.camera.shake(0.3);
      } else if (e.type === 'strikeBlocked') {
        let best = null, bd = 1e12;
        for (const [id, d] of this.domes) { const dx = e.pos.x - d.u.pos.x, dz = e.pos.z - d.u.pos.z, q = dx * dx + dz * dz; if (q < bd) { bd = q; best = d; } }
        if (best) {
          const h = best.mat.userData, dx = e.pos.x - best.u.pos.x, dy = Math.max(60, e.pos.y - best.u.pos.y), dz = e.pos.z - best.u.pos.z, l = Math.hypot(dx, dy, dz);
          h.hitDir.value.set(dx / l, Math.abs(dy / l) + 0.3, dz / l).normalize(); h.hitT.value = 0;
          fx.flash({ x: best.u.pos.x + dx / l * best.R, y: best.u.pos.y + Math.abs(dy / l) * best.R, z: best.u.pos.z + dz / l * best.R }, 40, [0.5, 0.8, 1], 0.4);
        }
      } else if (e.type === 'mineBlast') { fx.explosion({ x: e.pos.x, y: e.pos.y + 0.3, z: e.pos.z }, 7); fx.debris({ x: e.pos.x, y: e.pos.y + 0.3, z: e.pos.z }, 12, [90, 80, 60], 12, 2, { grav: 22 }); if (fx.scorch) fx.scorch(e.pos, 5, 0.6); }
      else if (e.type === 'chargeBlast') { fx.explosion({ x: e.pos.x, y: e.pos.y + 1, z: e.pos.z }, 11); if (fx.scorch) fx.scorch(e.pos, 7, 0.6); }
      else if (e.type === 'mine') { fx.puff({ x: e.pos.x, y: e.pos.y + 0.2, z: e.pos.z }, 2, fx.dustCol, 0.7, 0.7, 0.6, 0.6); }
      else if (e.type === 'defuse') { /* the charge disappears with its world entry */ }
      else if (e.type === 'build') { const p = e.pos; fx.ring(p, 3.2, [0.5, 0.9, 1], 0.6, true); fx.spark({ x: p.x, y: p.y + 0.8, z: p.z }, 14, [0.6, 0.9, 1], 6, 0.6, 0.1); fx.puff({ x: p.x, y: p.y + 0.3, z: p.z }, 3, fx.dustCol, 1.4, 1, 1, 2); }
      else if (e.type === 'repair') { /* the beam is drawn from engineer state each frame; add a spark at the contact */ fx.spark(e.pos, 2, [0.5, 1, 0.8], 4, 0.3, 0.07); }
    }
    teamOf() { const g = window.GC && GC.game; return this.R.localTeam || (g && g.team) || 'aegis'; }

    update(dt, t, world, camPos) {
      this.t = t;
      const T = E.THREE, m = this._m, q = this._q, p = this._p, s = this._s, col = this._c, F = E.faction;
      // ── domes: one per live shield generator ──
      const seen = new Set();
      for (const u of world.units) {
        if (u.kind !== 'turret' || u.type !== 'shieldgen' || !u.alive) continue;
        seen.add(u.id);
        let d = this.domes.get(u.id);
        if (!d) {
          const R = (u.def && u.def.shieldR) || 150, mat = E.Mat.dome({ color: 0x4fb4ff });
          const mesh = new T.Mesh(new T.SphereGeometry(1, 40, 20, 0, E.TAU, 0, Math.PI / 2), mat); mesh.scale.setScalar(R); mesh.renderOrder = 4; mesh.frustumCulled = false;
          this.group.add(mesh); d = { mesh, mat, u, R }; this.domes.set(u.id, d);
        }
        d.u = u; const sc = F(u.team).palette.shield; d.mat.userData.col.value ? 0 : 0;
        d.mat.userData.col.value.setRGB(sc[0] / 255, sc[1] / 255, sc[2] / 255);
        d.mesh.position.set(u.pos.x, u.pos.y - 3, u.pos.z);
        const near = Math.hypot(camPos.x - u.pos.x, camPos.z - u.pos.z);
        d.mesh.visible = near < d.R * 7 && camPos.y < 1800;
        const hp = u.hp / (u.maxHp || 1);
        d.mat.userData.alpha.value = 0.55 + 0.25 * Math.sin(t * 1.3 + u.id) + (hp < 0.4 ? Math.sin(t * 22) * 0.25 : 0);
        d.mat.userData.hitT.value = Math.min(9, d.mat.userData.hitT.value + dt);
      }
      for (const [id, d] of this.domes) if (!seen.has(id)) { this.group.remove(d.mesh); d.mesh.geometry.dispose(); this.domes.delete(id); }

      // ── mines ──
      const mine = world.mines || [], local = this.teamOf(); let n = 0;
      for (const k of mine) {
        if (n >= 160) break;
        const show = k.team === local || k.seen; if (!show) continue;
        const gy = this.R.terrain.height(k.x, k.z);
        m.makeTranslation(k.x, gy, k.z); this.mines.setMatrixAt(n, m); this.mines.setColorAt(n, col.setRGB(1, 1, 1));
        const on = (Math.sin(t * 4 + k.id * 1.7) > 0.2) ? 1 : 0.2, c = k.team === local ? [0.2, 3, 0.8] : [3.5, 0.4, 0.2];
        s.set(on, on, on); p.set(k.x, gy + 0.2, k.z); q.identity(); m.compose(p, q, s); this.mineLed.setMatrixAt(n, m); this.mineLed.setColorAt(n, col.setRGB(c[0], c[1], c[2])); n++;
      }
      this.mines.count = this.mineLed.count = n; this.mines.visible = this.mineLed.visible = n > 0;
      if (n) { this.mines.instanceMatrix.needsUpdate = this.mineLed.instanceMatrix.needsUpdate = true; if (this.mineLed.instanceColor) this.mineLed.instanceColor.needsUpdate = true; if (this.mines.instanceColor) this.mines.instanceColor.needsUpdate = true; }

      // ── planted charges ride their target ──
      n = 0;
      for (const c of world.charges || []) {
        if (n >= 48) break;
        const tu = world.umap ? world.umap.get(c.uid) : null; if (!tu || !tu.alive) continue;
        const rr = this.R.models.get(tu.id), bx = rr ? rr.x : tu.pos.x, by = rr ? rr.y : tu.pos.y, bz = rr ? rr.z : tu.pos.z;
        const ox = -Math.sin(tu.yaw) * tu.r * 0.8, oz = -Math.cos(tu.yaw) * tu.r * 0.8, y = by + (tu.def.h || 2) * 0.55;
        q.setFromAxisAngle(this._y, tu.yaw); m.compose(p.set(bx + ox, y, bz + oz), q, s.set(1, 1, 1)); this.charges.setMatrixAt(n, m);
        const rem = Math.max(0, c.t - world.t), k = 1 - rem / (c.fuse || 11), rate = 2 + 12 * k * k, on = Math.sin(t * rate * 3.14) > 0 ? 1 : 0.15;
        m.compose(p.set(bx + ox, y + 0.26, bz + oz), q, s.set(on, on, on)); this.chargeLed.setMatrixAt(n, m);
        this.chargeLed.setColorAt(n, col.setRGB(c.team === local ? 0.4 : 6, c.team === local ? 5 : 0.4, 0.3)); n++;
      }
      this.charges.count = this.chargeLed.count = n; this.charges.visible = this.chargeLed.visible = n > 0;
      if (n) { this.charges.instanceMatrix.needsUpdate = this.chargeLed.instanceMatrix.needsUpdate = true; if (this.chargeLed.instanceColor) this.chargeLed.instanceColor.needsUpdate = true; }

      // ── beams: decay, plus held repair beams from engineers working this frame ──
      for (const b of this.beams) {
        if (b.life > 0) { b.life -= dt; const k = Math.max(0, b.life / b.max); b.m.material.userData.amp.value = (b.amp || 1) * (b.kind === 'ion' ? Math.min(1, k * 2.2) * (0.8 + 0.2 * Math.sin(t * 60)) : 1); b.m.scale.x = b.m.scale.z = b.w * (b.kind === 'ion' ? (0.5 + k * 0.5) : 1); if (b.life <= 0) { b.m.visible = false; b.kind = ''; } }
      }
      this.repairBeams(world, dt, t);
      this.objectives(world, t, dt);
    }
    repairBeams(world, dt, t) {
      let slot = 0;
      const free = this.beams.filter(b => b.kind === 'hold' || b.life <= 0);
      for (const u of world.units) {
        if (u.kind !== 'infantry' || !u.alive || !(u.repairT > 0) || !u.repairId || slot >= 3) continue;
        let tgt = world.umap ? world.umap.get(u.repairId) : null, tp = null;
        if (tgt && tgt.alive) tp = { x: tgt.pos.x, y: tgt.pos.y + (tgt.def.h || 2) * 0.5, z: tgt.pos.z };
        else { const c = (world.cover || []).find(x => x.id === u.repairId); if (c) tp = { x: c.x, y: c.y + c.h * 0.6, z: c.z }; }
        if (!tp) continue;
        const rr = this.R.models.get(u.id), a = { x: rr ? rr.x : u.pos.x, y: (rr ? rr.y : u.pos.y) + u.h * 0.72, z: rr ? rr.z : u.pos.z };
        a.x += Math.sin(u.yaw) * 0.6; a.z += Math.cos(u.yaw) * 0.6;
        const b = free[slot++]; if (!b) break;
        b.kind = 'hold'; b.life = 0.0001; b.m.visible = true; b.m.material.userData.col.value.setRGB(0.3, 2.6, 1.6); b.m.material.userData.amp.value = 0.9 + 0.2 * Math.sin(t * 40); this.orient(b.m, a, tp, 0.09);
        this.R.fx.add.emit(tp.x + (Math.random() - 0.5) * 0.8, tp.y + (Math.random() - 0.5) * 0.8, tp.z + (Math.random() - 0.5) * 0.8, 0, 2, 0, 0.4, 0.3, 0.05, 0.6, 3, 1.6, 1, 1, 6);
      }
      for (let i = slot; i < free.length; i++) { const b = free[i]; if (b.kind === 'hold') { b.kind = ''; b.m.visible = false; } }
    }
    objectives(world, t, dt) {
      const T = E.THREE, objs = world.objs || [], seen = new Set();
      for (const o of objs) {
        if (o.done) continue; seen.add(o.id);
        let rec = this.objs.get(o.id);
        const tu = o.target && world.umap ? world.umap.get(o.target) : null;
        const pos = tu ? tu.pos : o.pos; if (!pos) continue;
        if (!rec) {
          const g = new T.Group();
          const col = o.type === 'uplink' ? 0xffffff : 0xffcc55;
          const ringMat = E.Mat.emissive({ color: col, additive: true, opacity: 0.8, side: 'double' }), beamMat = E.Mat.emissive({ color: col, additive: true, opacity: 0.14, side: 'double' });
          const r = o.r || (tu ? tu.r + 6 : 14);
          const ring = new T.Mesh(new T.RingGeometry(r - 0.7, r, 64).rotateX(-Math.PI / 2), ringMat); ring.position.y = 0.4; g.add(ring);
          const beam = new T.Mesh(new T.CylinderGeometry(0.4, 1.2, 140, 10, 1, true), beamMat); beam.position.y = 71; g.add(beam);
          const dia = new T.Mesh(new T.OctahedronGeometry(1.4, 0), E.Mat.emissive({ color: col, intensity: 2.5, additive: true, opacity: 0.9 })); dia.scale.set(0.8, 1.3, 0.8); g.add(dia);
          this.group.add(g); rec = { g, ring, beam, dia, ringMat, beamMat, r }; this.objs.set(o.id, rec);
        }
        const gy = this.R.terrain.height(pos.x, pos.z), rr = tu ? this.R.models.get(tu.id) : null;
        rec.g.position.set(rr ? rr.x : pos.x, tu ? (rr ? rr.y : tu.pos.y) : gy, rr ? rr.z : pos.z);
        rec.dia.position.y = (tu ? (tu.def.h || 3) : 3) + 6 + Math.sin(t * 2 + o.id) * 0.6; rec.dia.rotation.y = t * 1.5;
        const team = o.holder || o.team, c = team ? (E.TEAM_BOLT[team] || [1, 1, 1]) : [1, 0.9, 0.5], pulse = 0.7 + 0.3 * Math.sin(t * (4 + (o.frac || 0) * 6));
        rec.ringMat.color.setRGB(c[0] * 2 * pulse, c[1] * 2 * pulse, c[2] * 2 * pulse); rec.beamMat.color.setRGB(c[0] * 2, c[1] * 2, c[2] * 2); rec.dia.material.color.setRGB(c[0] * 3, c[1] * 3, c[2] * 3);
        rec.ring.scale.setScalar(1 + (o.frac || 0) * 0.0); rec.beam.scale.y = 0.4 + 0.6 * Math.max(0.2, o.frac || 0.2);
      }
      for (const [id, rec] of this.objs) if (!seen.has(id)) { this.group.remove(rec.g); this.objs.delete(id); }
    }
    dispose() { this.S.world.remove(this.group); }
  }

  // ═══ ground clutter around the camera ═══
  class Clutter {
    constructor(renderer, biomeId, terrain) {
      const T = E.THREE; this.R = renderer; this.terrain = terrain; this.group = new T.Group(); renderer.scene.world.add(this.group);
      const kinds = {
        desert: { tuft: [150, 128, 76], stone: [138, 108, 78], tall: 0.5, dens: 0.55 }, tundra: { tuft: [150, 160, 150], stone: [120, 128, 140], tall: 0.35, dens: 0.35 },
        jungle: { tuft: [48, 110, 50], stone: [86, 80, 66], tall: 0.9, dens: 1.0 }, urban: { tuft: [96, 100, 94], stone: [118, 118, 120], tall: 0.3, dens: 0.6 },
        volcanic: { tuft: [40, 34, 32], stone: [48, 40, 38], tall: 0.4, dens: 0.5 }, ocean: { tuft: [120, 150, 90], stone: [150, 150, 140], tall: 0.5, dens: 0.6 },
        cratered: { tuft: [110, 112, 118], stone: [118, 120, 128], tall: 0.2, dens: 0.4 }, gas: { tuft: [150, 90, 190], stone: [90, 70, 120], tall: 0.55, dens: 0.5 },
      }[biomeId] || { tuft: [140, 128, 80], stone: [130, 110, 90], tall: 0.5, dens: 0.5 };
      this.k = kinds; this.biome = biomeId;
      const tb = new E.Geo.Builder(0), rng = E.RNG(77);
      for (let i = 0; i < 7; i++) { const a = i / 7 * E.TAU; const l = kinds.tall * rng.f(0.6, 1.1); tb.cone(0.035, l, 3, Math.cos(a) * 0.07, l / 2, Math.sin(a) * 0.07, sh(kinds.tuft, rng.f(0.8, 1.2)), { rx: Math.sin(a) * 0.35, rz: -Math.cos(a) * 0.35, mode: 0 }); }
      const sb = new E.Geo.Builder(0);
      sb.box(0.22, 0.12, 0.18, 0, 0.05, 0, kinds.stone, { ry: 0.5, rz: 0.2, taper: [0.8, 0.8], mode: 2 }); sb.box(0.12, 0.08, 0.1, 0.18, 0.03, 0.06, sh(kinds.stone, 0.85), { ry: 1.2, mode: 2 });
      const mat = E.Mat.prop(0xb8a98a, 'clutter:' + biomeId);
      this.N = 1800;
      this.tufts = new T.InstancedMesh(tb.build(), mat, this.N); this.stones = new T.InstancedMesh(sb.build(), mat, this.N);
      for (const im of [this.tufts, this.stones]) { im.frustumCulled = false; im.count = 0; im.receiveShadow = true; im.setColorAt(0, new T.Color(1, 1, 1)); this.group.add(im); }
      this.cx = 1e9; this.cz = 1e9;
      this._m = new T.Matrix4(); this._q = new T.Quaternion(); this._p = new T.Vector3(); this._s = new T.Vector3(); this._c = new T.Color(); this._up = new T.Vector3(0, 1, 0);
      this.cps = terrain.layout ? terrain.layout.cps : [];
    }
    rebuild(cx, cz) {
      const CELL = 2.6, RAD = 62, ti = this.terrain, m = this._m, q = this._q, p = this._p, s = this._s, col = this._c;
      const x0 = Math.floor((cx - RAD) / CELL), x1 = Math.floor((cx + RAD) / CELL), z0 = Math.floor((cz - RAD) / CELL), z1 = Math.floor((cz + RAD) / CELL);
      let nt = 0, ns = 0; const dens = this.k.dens, wl = ti.waterLevel;
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
        const h1 = Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663), r1 = ((h1 ^ (h1 >>> 13)) >>> 0) / 4294967295, r2 = (((Math.imul(h1, 1274126177)) >>> 7) & 0xffff) / 65535, r3 = (((Math.imul(h1, 2246822519)) >>> 5) & 0xffff) / 65535;
        const x = (ix + r2) * CELL, z = (iz + r3) * CELL, dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
        if (d > RAD || r1 > dens * (1 - d / RAD * 0.6)) continue;
        const y = ti.height(x, z); if (y < wl + 0.4 || ti.slope(x, z) > 0.55) continue;
        let skip = false; for (const c of this.cps) if ((x - c.x) * (x - c.x) + (z - c.z) * (z - c.z) < (c.r * 0.9) * (c.r * 0.9)) { skip = true; break; } if (skip) continue;
        const stone = r2 > 0.62;
        const sc = (stone ? 0.7 + r3 * 1.3 : 0.6 + r2 * 1.1) * (1 - d / RAD * 0.3), im = stone ? this.stones : this.tufts, n = stone ? ns : nt; if (n >= this.N) continue;
        q.setFromAxisAngle(this._up, r1 * 40); m.compose(p.set(x, y - 0.02, z), q, s.set(sc, sc * (0.8 + r1 * 0.4), sc)); im.setMatrixAt(n, m);
        const v = 0.78 + r3 * 0.4; im.setColorAt(n, col.setRGB(v, v, v * 0.97)); if (stone) ns++; else nt++;
      }
      this.tufts.count = nt; this.stones.count = ns; this.tufts.visible = nt > 0; this.stones.visible = ns > 0;
      for (const im of [this.tufts, this.stones]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
      this.cx = cx; this.cz = cz;
    }
    update(cam) {
      const vis = cam.y < 140; this.group.visible = vis; if (!vis) return;
      if (Math.hypot(cam.x - this.cx, cam.z - this.cz) > 9) this.rebuild(cam.x, cam.z);
    }
  }

  E.ArtStruct = { makeStructure, Overlay, Clutter, glowTex };
})(window.E = window.E || {});
