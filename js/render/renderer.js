// The Renderer: owns the three.js Scene, the planet (terrain / sky / props),
// the FX, and a set of unit models it keeps in sync with world state. It is the
// only bridge between the simulation and the GPU. Browser-only (needs THREE).
(function (E) {
  'use strict';

  class Renderer {
    constructor(canvas, opts) {
      opts = opts || {};
      this.scene = new E.Scene(canvas, opts);
      this.camera = new E.Camera(this.scene);
      this.fx = new E.FX(this.scene, this.scene.Q.particles);
      this.fx.onShake = (p, size) => { const d = this.scene.camera.position.distanceTo(p); this.camera.shake(E.clamp(size * 5 / (d + 12), 0, 0.7)); };
      this.models = new Map();     // unit id -> record
      this.corpses = []; this.wrecks = []; this.posts = [];
      this.selRings = []; this.time = 0; this.world = null;
      this._q = new E.THREE.Quaternion(); this._q2 = new E.THREE.Quaternion(); this._up = new E.THREE.Vector3(0, 1, 0); this._n = new E.THREE.Vector3(); this._e = new E.THREE.Euler(0, 0, 0, 'YXZ');
      this._resize = () => this.scene.resize();
      window.addEventListener('resize', this._resize);
    }

    // Build the visible world for a match.
    setWorld(world) {
      const T = E.THREE, S = this.scene;
      this.clear();
      this.world = world; this.terrain = world.terrain;
      const biome = world.planet.biomeDef;
      this.sky = E.makeSky(S, world.planet, biome);
      S.setAtmosphere(this.sky.atmosphere);
      S.setEnvironment(this.sky);
      this.planetGroup = E.buildTerrain(S, world.terrain, biome, S.qualityName);
      this.camera.terrain = world.terrain;
      this.fx.setBiome(biome, world.terrain);
      for (const cp of world.cps) { const p = E.Props.makePost(cp, world.terrain); S.world.add(p.g); this.posts.push(p); }
      // art layers: cover pieces, domes / beams / mines / objectives, ground clutter, debris + scorch
      this.fx.initArt();
      this.cover = new E.ArtCover.CoverView(S, world.planet.biome, E.LOOK[world.planet.biome] || E.LOOK.desert, world);
      this.overlay = new E.ArtStruct.Overlay(this);
      this.clutter = new E.ArtStruct.Clutter(this, world.planet.biome, world.terrain);
      this.fx.cover = this.cover; this.fx.overlay = this.overlay;
      this.space = new E.ArtSpace.Space(this); this.fx.space = this.space;
      this.localTeam = null;
      this.camera.snap();
    }
    clear() {
      const S = this.scene;
      const kill = (g) => g.traverse(o => { if (o.isInstancedMesh || (o.geometry && o.geometry.userData.own)) o.geometry.dispose(); });
      if (this.cover) { this.cover.dispose(); this.cover = null; }
      if (this.overlay) { this.overlay.dispose(); this.overlay = null; }
      if (this.clutter) { S.world.remove(this.clutter.group); this.clutter = null; }
      if (this.planetGroup) { S.world.remove(this.planetGroup); this.planetGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); }); this.planetGroup = null; }
      if (this.sky) { S.scene.remove(this.sky.group); this.sky = null; }
      for (const p of this.posts) S.world.remove(p.g); this.posts.length = 0;
      this.models.forEach(m => S.units.remove(m.m.root)); this.models.clear();
      for (const c of this.corpses) S.units.remove(c.root); this.corpses.length = 0;
      for (const w of this.wrecks) S.units.remove(w.rec.m.root); this.wrecks.length = 0;
      for (const r of this.selRings) S.hud3d.remove(r); this.selRings.length = 0;
      this.fx.emitters.length = 0;
    }

    record(u) {
      let r = this.models.get(u.id);
      if (r) return r;
      const m = E.Models.makeUnit(u);
      m.root.position.set(u.pos.x, u.pos.y, u.pos.z); m.root.rotation.y = u.yaw;
      this.scene.units.add(m.root);
      r = { m, kind: u.kind, x: u.pos.x, y: u.pos.y, z: u.pos.z, phase: (u.id * 1.7) % 6.28, fresh: true, smokeT: 0, u };
      if (u.kind === 'capital') { this.capitalGlow(r, u); if (this.space) this.space.attach(r, u); r.team = u.team; }
      this.models.set(u.id, r);
      return r;
    }
    capitalGlow(r, u) {
      const T = E.THREE, c = E.faction(u.team).palette.engine, d = u.def, org = E.faction(u.team).hull.style === 'organic';
      const tex = this._glowTex || (this._glowTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new T.CanvasTexture(cv); })());
      const n = org ? 3 : (u.type === 'dreadnought' ? 4 : 3), W = d.h * 2.5, H = d.h * 1.25;
      for (let i = 0; i < n; i++) {
        const s = new T.Sprite(E.Mat.sprite({ map: tex, color: new T.Color(c[0] / 255 * 0.7, c[1] / 255 * 0.7, c[2] / 255 * 0.7), additive: true }));
        s.scale.setScalar(H * 1.5); s.position.set((i - (n - 1) / 2) * W * (org ? 0.26 : 0.24), 0, -d.len * 0.57); r.m.body.add(s);
      }
    }

    syncUnits(world, dt, t, localId) {
      const k = 1 - Math.exp(-dt * 20), T = this.terrain, seen = this._seen || (this._seen = new Set());
      seen.clear();
      const cam = this.scene.camera.position;
      // fog of war: on an authoritative fogged world hide enemies the local team
      // cannot see. A guest's RemoteWorld is already filtered by the host, so it
      // needs no second pass (and lacks the full unit set to compute one).
      const remote = !!(world.isRemote && world.isRemote());
      const vis = (!remote && world.cfg && world.cfg.fog && E.SIM.vision) ? E.SIM.vision(world, world.human) : null;
      for (const u of world.units) {
        if (!u.alive) continue;
        if (vis && !vis.has(u.id)) continue;
        seen.add(u.id);
        const r = this.record(u), m = r.m, g = m.root;
        r.u = u;
        if (u.kind === 'capital' && r.team && r.team !== u.team) { this.scene.units.remove(m.root); this.models.delete(u.id); continue; }
        if (r.fresh || Math.abs(u.pos.x - r.x) + Math.abs(u.pos.z - r.z) > 60) { r.x = u.pos.x; r.y = u.pos.y; r.z = u.pos.z; r.fresh = false; }
        else { r.x += (u.pos.x - r.x) * k; r.y += (u.pos.y - r.y) * k; r.z += (u.pos.z - r.z) * k; }
        g.position.set(r.x, r.y, r.z);
        const d2 = (r.x - cam.x) * (r.x - cam.x) + (r.z - cam.z) * (r.z - cam.z);
        if (u.kind === 'infantry') {
          g.rotation.y = E.lerpAngle(g.rotation.y, u.yaw, Math.min(1, dt * 14));
          E.ArtInfantry.animate(m.rig, u, dt, t, world, d2, d2 < 1500 * 1500);
          if (m.rig.lod === 0 || m.rig.lod === 1) m.rig.phase += 0;
        } else if (u.kind === 'vehicle') {
          T.normal(r.x, r.z, this._n);
          this._q.setFromUnitVectors(this._up, this._n); this._q2.setFromAxisAngle(this._up, u.yaw); this._q.multiply(this._q2);
          g.quaternion.slerp(this._q, Math.min(1, dt * 7));
          m.body.position.y = Math.sin(t * 2.2 + u.id) * 0.07;
          m.turret.rotation.y = u.aimYaw - u.yaw; m.gun.rotation.x = -u.aimPitch;
          const rec = Math.max(0, 1 - (world.t - u.lastFire) * 5); m.gun.position.z = 0.5 - rec * 0.5;
          if (d2 < 500 * 500 && Math.abs(u.spd) > 4 && this.fx.rng.next() < dt * 14) this.fx.puff({ x: r.x - Math.sin(u.yaw) * u.r * 0.7, y: r.y - u.def.hover + 0.2, z: r.z - Math.cos(u.yaw) * u.r * 0.7 }, 1, this.fx.dustCol, 1.5, 1.4, 0.8, 2.5);
        } else if (u.kind === 'turret') {
          m.turret.rotation.y = u.aimYaw; m.gun.rotation.x = -u.aimPitch;
          if (m.spin) m.spin.rotation.y = t * 0.9;
          if (m.glow) m.glow.material.opacity = 0.7 + 0.3 * Math.sin(t * 3 + u.id);
          if (m.core) { const k = u.charging ? 0.5 + 0.5 * Math.abs(Math.sin(t * 9)) : (u.active ? 0.12 : 0.01); m.core.scale.setScalar(0.01 + k * 2.4); if (u.charging && this.fx.rng.next() < dt * 25) this.fx.add.emit(r.x, r.y + 12, r.z, this.fx.rng.f(-3, 3), this.fx.rng.f(2, 8), this.fx.rng.f(-3, 3), 0.5, 1.2, 0.2, 1.5, 3, 5, 1, 1, 0); }
        } else if (u.kind === 'fighter') {
          this._e.set(-u.pitch, u.yaw, -u.roll); this._q.setFromEuler(this._e);
          g.quaternion.slerp(this._q, Math.min(1, dt * 16));
          {
            const thr = E.clamp(u.thr === undefined ? 0.6 : u.thr, 0, 1.2), bo = u.boosting ? 1 : 0, em = 0.5 + thr * 1.1 + bo * 1.6;
            for (const f of m.flames) { f.scale.set(1 + bo * 0.4, 1 + bo * 0.4, (0.6 + thr * 2.6 + bo * 4.5) * (0.9 + 0.1 * Math.sin(t * 50 + u.id))); f.visible = !u.landed; }
            for (const gl of m.glows) gl.scale.setScalar((0.9 + thr * 1.4 + bo * 2.2) * (u.r * 0.35));
            const fx = Math.sin(u.yaw) * Math.cos(u.pitch), fy = Math.sin(u.pitch), fz = Math.cos(u.yaw) * Math.cos(u.pitch), sp = u.spd || Math.hypot(u.vel.x, u.vel.y, u.vel.z);
            const rgx = Math.cos(u.yaw), rgz = -Math.sin(u.yaw), wg = m.wing || 4.4;
            // contrails in dense air, wingtip vortices in hard turns, stall / damage smoke
            if (d2 < 2500 * 2500 && sp > 70) {
              if ((u.dens || 0) > 0.35 && this.fx.rng.next() < dt * 24) for (const sd of [-1, 1]) this.fx.trail(r.x - fx * 3 + rgx * sd * wg * 0.95, r.y - fy * 3, r.z - fz * 3 + rgz * sd * wg * 0.95, 0.5, 2.4, 0.16 * Math.min(1, u.dens));
              if ((u.g || 0) > 5 && this.fx.rng.next() < dt * 40) for (const sd of [-1, 1]) this.fx.add.emit(r.x + rgx * sd * wg, r.y, r.z + rgz * sd * wg, 0, 0, 0, 0.5, 0.35, 0.12, 1.4, 1.6, 1.8, Math.min(0.8, (u.g - 5) * 0.15), 0, 0);
            }
            const hpf = u.hp / (u.maxHp || 1);
            if (hpf < 0.5 && d2 < 1500 * 1500 && this.fx.rng.next() < dt * 20 * (1 - hpf)) { this.fx.smoke.emit(r.x - fx * 2, r.y - fy * 2, r.z - fz * 2, 0, 1, 0, 2.2, 0.8, 3.5, 0.08, 0.08, 0.08, 0.55, 0.5, -0.4); if (hpf < 0.25) this.fx.add.emit(r.x - fx * 2, r.y - fy * 2, r.z - fz * 2, 0, 0, 0, 0.3, 1.2, 0.4, 3, 1.2, 0.3, 0.9, 0, 0); }
          }
        } else if (u.kind === 'capital') {
          this._e.set(0, u.yaw, -u.roll); g.quaternion.setFromEuler(this._e);
          // battle damage: fires and smoke along the hull as health drops
          const dmg = 1 - u.hp / u.maxHp;
          if (dmg > 0.25) {
            r.smokeT -= dt * dmg * 6;
            while (r.smokeT < 0) {
              r.smokeT += 1;
              const rg = this.fx.rng, lz = rg.f(-0.4, 0.3) * u.def.len, lx = rg.f(-0.3, 0.3) * u.h * 2, fx = Math.sin(u.yaw), fz = Math.cos(u.yaw);
              const px = r.x + fx * lz - fz * lx, py = r.y + u.h * 0.45, pz = r.z + fz * lz + fx * lx;
              this.fx.smoke.emit(px, py, pz, rg.f(-3, 3), rg.f(4, 12), rg.f(-3, 3), 5, 9, 40, 0.07, 0.07, 0.07, 0.55, 0.3, -1);
              if (rg.next() < dmg) this.fx.add.emit(px, py, pz, rg.f(-2, 2), rg.f(3, 9), rg.f(-2, 2), 0.9, 8, 15, 3, 1.3, 0.3, 1, 0.6, -2);
            }
          }
        }
        if (u.id === localId) g.visible = !(u.kind === 'infantry' && this.camera.zoom > 0.85 && u.type === 'sniper');
      }
      for (const [id, r] of this.models) if (!seen.has(id)) { this.scene.units.remove(r.m.root); this.models.delete(id); }
    }

    // deaths: infantry fall, capitals break up and fall out of the sky
    applyEvents(events, world) {
      this.fx.applyEvents(events, world);
      this.fx.events2(events, world);
      for (const e of events) {
        if (e.type !== 'death') continue;
        const r = this.models.get(e.uid); if (!r) continue;
        this.models.delete(e.uid);
        if (e.kind === 'infantry') { this.corpses.push({ root: r.m.root, body: r.m.body, rig: r.m.rig, kind: (e.uid | 0), t: 0, dir: this.fx.rng.sign() }); if (this.corpses.length > 40) this.scene.units.remove(this.corpses.shift().root); }
        else if (e.kind === 'capital') { this.wrecks.push({ rec: r, t: 0, vy: 0, len: r.u.def.len, h: r.u.h, yaw: e.yaw, boomT: 0 });
          const hc = E.faction(e.team).palette.hull, L = r.u.def.len;
          this.fx.blast(e.pos, 60, { space: true, hull: hc }); this.fx.ring(e.pos, L * 1.4, [1, 0.8, 0.5], 1.6, false); this.fx.light(e.pos, [1, 0.7, 0.4], 500, L * 1.2);
          for (let k = 0; k < 5; k++) this.fx.debris({ x: e.pos.x + this.fx.rng.f(-1, 1) * L * 0.3, y: e.pos.y, z: e.pos.z + this.fx.rng.f(-1, 1) * L * 0.3 }, 36, hc, L * 0.18, L * 0.2, { grav: 0, life: 70, size: Math.max(2, L * 0.025), trail: true });
          this.camera.shake(0.8); }
        else this.scene.units.remove(r.m.root);
      }
    }
    updateDead(dt) {
      for (let i = this.corpses.length - 1; i >= 0; i--) {
        const c = this.corpses[i]; c.t += dt;
        if (c.rig) E.ArtInfantry.deathPose(c.rig, c.t, c.dir, c.kind || 0);
        else { c.body.rotation.x = -Math.min(1, c.t * 3.2) * (Math.PI / 2 - 0.08) * c.dir; c.body.position.y = Math.min(1, c.t * 3.2) * 0.25; }
        if (c.t > 9) c.root.position.y -= dt * 0.5;
        if (c.t > 12) { this.scene.units.remove(c.root); this.corpses.splice(i, 1); }
      }
      for (let i = this.wrecks.length - 1; i >= 0; i--) {
        const w = this.wrecks[i], g = w.rec.m.root, rg = this.fx.rng; w.t += dt;
        w.vy += dt * 5; g.position.y -= w.vy * dt; g.rotation.x += dt * 0.035; g.rotation.z += dt * 0.022;
        g.position.x += Math.sin(w.yaw) * 6 * dt; g.position.z += Math.cos(w.yaw) * 6 * dt;
        w.boomT -= dt;
        if (w.boomT <= 0) { w.boomT = rg.f(0.12, 0.4); const lz = rg.f(-0.45, 0.45) * w.len; const p = { x: g.position.x + Math.sin(w.yaw) * lz + rg.f(-20, 20), y: g.position.y + rg.f(-w.h, w.h) * 0.6, z: g.position.z + Math.cos(w.yaw) * lz + rg.f(-20, 20) }; this.fx.explosion(p, rg.f(14, 34)); }
        const gy = this.terrain.height(g.position.x, g.position.z);
        if (g.position.y < gy + w.h * 0.3 || w.t > 40) {
          for (let k = 0; k < 7; k++) this.fx.explosion({ x: g.position.x + rg.f(-1, 1) * w.len * 0.4, y: gy + 8, z: g.position.z + rg.f(-1, 1) * w.len * 0.4 }, rg.f(40, 80));
          this.camera.shake(1); this.fx.emitter({ pos: { x: g.position.x, y: gy + 4, z: g.position.z }, life: 40, rate: 14, kind: 'burn', size: 14 });
          this.scene.units.remove(g); this.wrecks.splice(i, 1);
        }
      }
    }

    // selection rings under commanded units
    syncSelection(ids, world, team) {
      const T = E.THREE, col = E.Props.TEAM_COL[team] || [1, 1, 1];
      let n = 0;
      for (const id of ids || []) {
        const r = this.models.get(id); if (!r) continue;
        let m = this.selRings[n];
        if (!m) { m = new T.Mesh(new T.RingGeometry(0.86, 1, 32).rotateX(-Math.PI / 2), E.Mat.emissive({ opacity: 0.9, depthTest: false, additive: true })); m.renderOrder = 9; this.scene.hud3d.add(m); this.selRings.push(m); }
        m.visible = true; m.material.color.setRGB(col[0] * 2, col[1] * 2, col[2] * 2);
        const u = r.u, s = Math.max(1.4, u.r * 1.5); m.scale.setScalar(s);
        m.position.set(r.x, (u.kind === 'fighter' ? r.y - 2 : this.terrain.height(r.x, r.z) + 0.3), r.z); n++;
      }
      for (let i = n; i < this.selRings.length; i++) this.selRings[i].visible = false;
    }

    // Per-frame: sync, animate, frame the camera, render.
    update(dt, t, world, view) {
      this.time = t;
      const S = this.scene;
      S.gov(dt * 1000);
      const local = view.unit ? view.unit.id : 0;
      this.syncUnits(world, dt, t, local);
      // compile every material's GPU pipeline once, on the first frame (behind the
      // loading splash), so entering new visual states does not compile mid-fight
      if (!this._warmed && S.frames >= 1) { this._warmed = true; if (S.warm) S.warm(); }
      this.updateDead(dt);
      for (let i = 0; i < this.posts.length; i++) E.Props.updatePost(this.posts[i], world.cps[i], t, dt);
      if (view.unit) { const r = this.models.get(view.unit.id); view.pos = r ? r : view.unit.pos; }
      if (view.mode === 'commander') this.camera.setFront(world);
      else this.camera.front = null;
      this.camera.update(dt, t, view);
      const cam = S.camera;
      this.fx.update(dt, t, cam);
      this.fx.updateArt(dt, t, world);
      this.localTeam = view.unit ? view.unit.team : null;
      if (this.cover) this.cover.sync(world);
      if (this.overlay) this.overlay.update(dt, t, world, cam.position);
      if (this.space) this.space.update(dt, t, world);
      if (this.clutter) this.clutter.update(cam.position);
      this.sky.update(t, cam.position);
      // shadows hug the action; widen for the map view
      const f = view.mode === 'unit' && view.unit ? view.pos : (view.mode === 'commander' ? { x: this.camera.cmd.x, y: 0, z: this.camera.cmd.z } : this.camera.orbit);
      const ext = view.mode === 'unit' && view.unit ? (view.unit.kind === 'infantry' ? 110 : view.unit.kind === 'capital' ? 700 : 240) : 520;
      S.focusShadows(f, ext);
      this.postFor(view, dt);
      S.render(t);
    }
    // per-frame post-processing parameters from the camera mode: depth of field is off in first/third person
    // gameplay and used by the cinematic (menu / orbit), commander and capital framings; motion blur follows camera speed.
    postFor(view, dt) {
      const S = this.scene, cam = S.camera, c = this.camera;
      const mode = view.mode === 'commander' ? 'commander' : (view.mode === 'unit' && view.unit ? 'unit' : 'orbit');
      const cinematic = mode === 'orbit';
      let focus = 80, range = 90, bokeh = 2.5;
      if (mode === 'orbit') { const o = c.orbit; focus = Math.hypot(cam.position.x - o.x, cam.position.y - o.y, cam.position.z - o.z); range = Math.max(60, focus * 0.4); bokeh = 2.8; }
      S.post.set({ dof: { on: cinematic, focus, range, bokeh } });
      const p = cam.position, l = this._pp || (this._pp = { x: p.x, y: p.y, z: p.z });
      const sp = Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z) / Math.max(dt, 1e-3); l.x = p.x; l.y = p.y; l.z = p.z;
      this._sp = (this._sp || 0) * 0.9 + Math.min(sp, 130) * 0.1;
      const lu = view.mode === 'unit' ? view.unit : null, air = lu && lu.kind === 'fighter';
      S.post.set({ shimmer: air ? E.clamp((-(lu.vel ? lu.vel.y : 0) - 40) / 160, 0, 1) * Math.min(1, (lu.dens || 0) * 2) * Math.min(1, (lu.spd || 0) / 150) : 0 });
      if (air) { S.post.set({ motionBlur: Math.min(0.7, (lu.sens || 0) * 0.55 + (lu.boosting ? 0.2 : 0) + Math.min(0.2, (lu.g || 0) * 0.015)) }); return; }
      S.post.set({ motionBlur: mode === 'unit' && view.unit && view.unit.kind !== 'infantry' ? Math.min(1, this._sp / 120) * 0.4 : Math.min(1, this._sp / 200) * 0.15 });
    }
    dispose() { window.removeEventListener('resize', this._resize); this.clear(); this.scene.dispose(); }
  }

  E.Renderer = Renderer;
})(window.E = window.E || {});
