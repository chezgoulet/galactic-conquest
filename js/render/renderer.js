// The Renderer: owns the three.js Scene, the planet (terrain/sky/atmosphere),
// and a pool of unit meshes it keeps in sync with world state. It is the only
// bridge between the simulation and the GPU. Browser-only (needs THREE).
(function (E) {
  'use strict';

  class Renderer {
    constructor(canvas) {
      this.scene = new E.Scene(canvas);
      this.camera = new E.Camera(this.scene);
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
      this.scene.units.add(group);
      m = { group, kind: unit.kind, faction: unit.faction, role: unit.role, type: unit.type, prev: E.V3.make(unit.pos.x, unit.pos.y, unit.pos.z) };
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
        g.rotation.y += E.lerpAngle(g.rotation.y, u.yaw || 0, k);
        prev.x = p.x; prev.y = p.y; prev.z = p.z;
        // vehicle turret follows unit yaw (aim handled by sim aim offset later)
        if (g.userData.turret && !g.userData.turret.userData.locked) g.userData.turret.rotation.y = (u.aim || 0) - (u.yaw || 0);
        // health bar scale
        if (g.userData.hp && u.maxHp) {
          const f = E.clamp01(u.hp / u.maxHp);
          g.userData.hp.scale.x = f;
          g.userData.hp.position.x = (f - 1) * (g.userData.hp.userData.baseW || 2) * 0.5;
          g.userData.hp.material.color.setRGB(1 - f * 0.5, f, 0.2);
        }
      }
      // remove stale
      for (const id of [...this.meshes.keys()]) if (!seen.has(id)) this.removeUnit(id);
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
        this.camera.setMode(world.controllerMode, world.focusedUnit());
      }
      this.camera.update(dt, t);
      this.scene.render();
    }
  }

  E.Renderer = Renderer;
})(window.E = window.E || {});
