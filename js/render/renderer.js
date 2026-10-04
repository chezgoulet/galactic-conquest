// The Renderer: owns the three.js Scene, the planet (terrain/sky/atmosphere),
// and a pool of unit meshes it keeps in sync with world state. It is the only
// bridge between the simulation and the GPU. Browser-only (needs THREE).
(function (E) {
  'use strict';

  class Renderer {
    constructor(canvas) {
      this.scene = new E.Scene(canvas);
      this.camera = new E.Camera(this.scene);
      this.fx = new E.FX(this.scene);
      this.terrain = null;
      this.planetGroup = null;
      this.sky = null;
      this.meshes = new Map();      // unit id -> { group, kind, faction, prev }
      this.time = 0;
      window.addEventListener('resize', () => this.scene.resize());
    }

    // Build a full visible world for a planet.
    setPlanet(planet) {
      const biome = E.biome(planet.biome);
      const T = E.THREE;
      // clear any previous world
      if (this.planetGroup) { this.scene.world.remove(this.planetGroup); this.planetGroup.traverse(o => o.geometry && o.geometry.dispose()); }
      if (this.sky) { this.scene.scene.remove(this.sky.group); }
      this.meshes.forEach(m => this.scene.units.remove(m.group));
      this.meshes.clear();

      this.terrain = E.makeTerrain(planet);
      this.scene.setBiomeAtmosphere(biome);
      this.planetGroup = E.buildTerrain(this.scene, this.terrain, biome, this.scene.quality);
      this.sky = E.makeSky(this.scene, planet, biome);
      this.planet = planet;
    }

    groundY(x, z) { return this.terrain ? this.terrain.height(x, z) : 0; }

    // Create (once) the mesh for a unit, return it.
    meshFor(unit) {
      let m = this.meshes.get(unit.id);
      if (m && m.kind === unit.kind) return m;
      if (m) { this.scene.units.remove(m.group); this.scene.units.remove(m); }
      const faction = E.faction(unit.faction);
      let group;
      if (unit.kind === 'infantry') group = E.makeInfantry(faction, unit.role);
      else if (unit.kind === 'vehicle') group = E.makeVehicle(faction, unit.type);
      else if (unit.kind === 'fighter') group = E.makeFighter(faction, unit.type);
      else if (unit.kind === 'capital') group = E.makeCapital(faction, unit.type, unit.genome || null);
      else group = new E.THREE.Group();
      // faction ring marker under ground units
      group.position.set(unit.pos.x, unit.pos.y, unit.pos.z);
      group.rotation.y = unit.yaw || 0;
      // floating health bar (hidden at full health)
      const bar = new E.THREE.Mesh(new E.THREE.PlaneGeometry(2, 0.35), new E.THREE.MeshBasicMaterial({ color: 0x22ff66, side: E.THREE.DoubleSide, transparent: true, depthTest: false }));
      bar.position.y = (unit.viewH || 2) + 1.2; bar.renderOrder = 10;
      bar.userData.baseW = 2;
      group.add(bar);
      this.scene.units.add(group);
      m = { group, kind: unit.kind, faction: unit.faction, role: unit.role, type: unit.type, bar, prev: E.V3.make(unit.pos.x, unit.pos.y, unit.pos.z) };
      this.meshes.set(unit.id, m);
      return m;
    }

    removeUnit(id) {
      const m = this.meshes.get(id);
      if (m) { this.scene.units.remove(m.group); this.meshes.delete(id); }
    }

    // Sync all tracked units to their world state (with a little smoothing).
    syncUnits(units, dt) {
      const k = 1 - Math.exp(-dt * 10);
      const seen = new Set();
      for (const u of units) {
        if (!u.alive) { this.removeUnit(u.id); continue; }
        seen.add(u.id);
        const m = this.meshFor(u);
        const g = m.group;
        const p = u.pos, prev = m.prev;
        g.position.x += (p.x - g.position.x) * k;
        g.position.y += (p.y - g.position.y) * k;
        g.position.z += (p.z - g.position.z) * k;
        g.rotation.y = E.lerpAngle(g.rotation.y, u.yaw || 0, k);
        prev.x = p.x; prev.y = p.y; prev.z = p.z;
        // vehicle turret follows unit aim
        if (g.userData.turret && !g.userData.turret.userData.locked) g.userData.turret.rotation.y = (u.aim || 0) - (u.yaw || 0);
        // health bar: show only when damaged
        if (m.bar && u.maxHp) {
          const f = E.clamp01(u.hp / u.maxHp);
          const show = f < 0.999;
          m.bar.visible = show;
          if (show) {
            m.bar.scale.x = f;
            m.bar.position.x = (f - 1) * (m.bar.userData.baseW || 2) * 0.5;
            m.bar.material.color.setRGB(1 - f * 0.6, f, 0.2);
          }
        }
      }
      // remove stale
      for (const id of [...this.meshes.keys()]) if (!seen.has(id)) this.removeUnit(id);
    }

    // Objective beacons: a pillar + base ring, tinted by owner, height = progress.
    syncObjectives(objectives, dt) {
      if (!this.objGroup) { this.objGroup = new E.THREE.Group(); this.scene.hud3d.add(this.objGroup); this.obj = new Map(); }
      const T = E.THREE, seen = new Set();
      for (const o of objectives) {
        seen.add(o.id);
        let m = this.obj.get(o.id);
        if (!m) {
          const g = new T.Group();
          const base = new T.Mesh(new T.TorusGeometry(o.radius, 1.2, 8, 32), new T.MeshBasicMaterial({ color: 0x88aaff, transparent: true, opacity: 0.7, side: T.DoubleSide }));
          base.rotation.x = Math.PI / 2; base.position.y = 1; g.add(base);
          const pillar = new T.Mesh(new T.CylinderGeometry(2.5, 2.5, 400, 12, 1, true), new T.MeshBasicMaterial({ color: 0x88aaff, transparent: true, opacity: 0.28, side: T.DoubleSide, depthWrite: false }));
          pillar.position.y = 200; g.add(pillar);
          g.position.set(o.pos.x, o.pos.y, o.pos.z);
          this.objGroup.add(g);
          m = { g, base, pillar };
          this.obj.set(o.id, m);
        }
        const col = o.owner === 'aegis' ? new T.Color(0xff5a2b) : o.owner === 'verdant' ? new T.Color(0x3df0b0) : new T.Color(0x8fa8cc);
        m.base.material.color.copy(col);
        m.pillar.material.color.copy(col);
        m.pillar.scale.y = 0.2 + (o.progress || 0) * 0.8;
      }
      for (const id of [...this.obj.keys()]) if (!seen.has(id)) { const m = this.obj.get(id); this.objGroup.remove(m.g); this.obj.delete(id); }
    }

    // Target ring on the unit the focused capital/ship is engaging.
    syncTarget(world) {
      const T = E.THREE;
      if (!this.targetRing) {
        this.targetRing = new T.Mesh(new T.TorusGeometry(1, 0.6, 8, 28), new T.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.8, side: T.DoubleSide, depthTest: false }));
        this.targetRing.rotation.x = Math.PI / 2; this.targetRing.renderOrder = 20;
        this.scene.hud3d.add(this.targetRing);
      }
      const f = world.focusedUnit();
      if (!f || (f.kind !== 'capital' && f.kind !== 'fighter')) { this.targetRing.visible = false; return; }
      // nearest enemy unit
      let best = null, bd = Infinity;
      for (const e of world.unitList()) {
        if (!e.alive || e.team === f.team) continue;
        const d = E.distXZ2(f.pos, e.pos);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) { this.targetRing.visible = false; this.currentTarget = null; return; }
      this.currentTarget = best; this.currentTargetDist = Math.sqrt(bd);
      this.targetRing.visible = true;
      this.targetRing.position.set(best.pos.x, best.pos.y + best.viewH * 0.5, best.pos.z);
      const s = Math.max(10, best.r * 1.6);
      this.targetRing.scale.set(s, s, s);
      this.targetRing.rotation.z += 0.02;
    }

    // Per-frame animation + camera + render.
    update(dt, t, world) {
      this.time = t;
      this.scene.gov(dt * 1000);
      if (this.planetGroup && this.planetGroup.userData.water) {
        this.planetGroup.userData.water.material.uniforms.time.value = t;
      }
      if (world) {
        this.syncUnits(world.unitList(), dt);
        this.syncObjectives(world.objectives, dt);
        this.syncTarget(world);
        // focus: possessed unit, else the centroid of my force
        let focus = world.focusedUnit();
        if (!focus && world.playerUnit && world.playerUnit.alive) {
          let x = 0, z = 0, y = 0, n = 0;
          for (const u of world.unitList()) if (u.alive && u.team === world.human) { x += u.pos.x; y += u.pos.y; z += u.pos.z; n++; }
          if (n) focus = { id: 'force', pos: { x: x / n, y: y / n, z: z / n }, viewH: 10, yaw: 0 };
        }
        this.camera.setMode(world.mode(), focus);
      }
      this.fx.update(dt, t);
      this.camera.update(dt, t);
      // never let the camera sink below the surface
      if (this.terrain) {
        const cp = this.camera.cam.position;
        const minY = this.terrain.height(cp.x, cp.z) + 4;
        if (cp.y < minY) cp.y = minY;
      }
      this.scene.setCameraAltitude(this.camera.cam.position.y);
      this.scene.render();
    }
  }

  E.Renderer = Renderer;
})(window.E = window.E || {});
