// Camera rig. One look direction (yaw/pitch, driven by the mouse) and a set of
// framings chosen by what the player controls:
//   infantry   over-the-shoulder third person (ADS / scope zoom)
//   vehicle    orbiting chase camera; the turret follows the look direction
//   fighter    chase camera behind the look direction; the craft banks to catch up
//   capital    wide orbit around the hull
//   commander  tilted overhead map view (pan / rotate / zoom)
//   orbit      cinematic drift around a point (menus, deploy screen, death)
// Also resolves the crosshair into a world aim point, and applies trauma shake.
(function (E) {
  'use strict';

  class Camera {
    constructor(scene) {
      this.scene = scene; this.cam = scene.camera;
      this.yaw = 0; this.pitch = 0; this.zoom = 0;        // zoom 0..1 (ADS)
      this.mode = 'orbit';
      this.cmd = { x: 0, z: 0, yaw: 0.35, dist: 420, pitch: 0.95 };
      this.orbit = { x: 0, y: 30, z: 0, r: 520, h: 150, a: 0, speed: 0.03 };
      this.trauma = 0; this.fov = 60; this._p = new E.THREE.Vector3(0, 80, 200); this._l = new E.THREE.Vector3(); this._snap = true;
      this.aimPoint = { x: 0, y: 0, z: 0 }; this.aimTarget = null; this.terrain = null;
    }
    look(dx, dy, sens) {
      const k = sens * (1 - this.zoom * 0.6);
      this.yaw -= dx * k; this.pitch = E.clamp(this.pitch - dy * k, -1.35, 1.35);
    }
    shake(p) { this.trauma = Math.min(1, this.trauma + p); }
    snap() { this._snap = true; }

    // view: { mode, pos {x,y,z} (smoothed unit position), unit, zoomFov }
    update(dt, t, view) {
      const cam = this.cam, T = E.THREE;
      let px, py, pz, lx, ly, lz, fov = 62, stiff = 14;
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const dx = sy * cp, dy = sp, dz = cy * cp;       // look direction
      this.mode = view.mode;
      if (view.mode === 'unit' && view.unit) {
        const u = view.unit, p = view.pos, z = this.zoom;
        if (u.kind === 'infantry') {
          const D = E.lerp(3.5, 1.5, z), side = E.lerp(0.72, 0.5, z), hy = p.y + u.h * 0.9 + 0.2;
          px = p.x - cy * side - dx * D; py = hy - dy * D + 0.1; pz = p.z + sy * side - dz * D;
          fov = E.lerp(66, view.zoomFov || 44, z); stiff = 40;
        } else if (u.kind === 'vehicle' || u.kind === 'turret') {
          const D = u.r * 2.4 + 5.5; px = p.x - dx * D; py = p.y + u.h + 2.2 - dy * D; pz = p.z - dz * D; fov = E.lerp(64, 40, z); stiff = 12;
        } else if (u.kind === 'fighter') {
          const D = u.r * 3.2 + 3; px = p.x - dx * D; py = p.y - dy * D + 2.6; pz = p.z - dz * D;
          fov = E.lerp(70 + Math.min(14, (u.spd || 0) * 0.07), 42, z); stiff = 9;
        } else {
          const D = u.def.len * 1.15; px = p.x - dx * D; py = p.y + u.h * 1.3 - dy * D; pz = p.z - dz * D; fov = E.lerp(58, 26, z); stiff = 5;
        }
        lx = px + dx * 200; ly = py + dy * 200; lz = pz + dz * 200;
      } else if (view.mode === 'commander') {
        const c = this.cmd, cpz = Math.cos(c.pitch), gy = this.terrain ? this.terrain.height(c.x, c.z) : 0;
        px = c.x - Math.sin(c.yaw) * cpz * c.dist; py = gy + Math.sin(c.pitch) * c.dist; pz = c.z - Math.cos(c.yaw) * cpz * c.dist;
        lx = c.x; ly = gy; lz = c.z; fov = 50; stiff = 9;
      } else {
        const o = this.orbit; o.a += dt * o.speed;
        px = o.x + Math.cos(o.a) * o.r; py = o.y + o.h; pz = o.z + Math.sin(o.a) * o.r;
        lx = o.x; ly = o.y; lz = o.z; fov = view.fov || 52; stiff = 2.5;
      }
      // keep above the ground
      if (this.terrain) { const g = Math.max(this.terrain.height(px, pz), this.terrain.waterLevel) + 0.45; if (py < g) py = g; }
      const k = this._snap ? 1 : 1 - Math.exp(-dt * stiff);
      this._snap = false;
      this._p.x += (px - this._p.x) * k; this._p.y += (py - this._p.y) * k; this._p.z += (pz - this._p.z) * k;
      if (view.mode === 'unit') this._l.set(this._p.x + dx * 200, this._p.y + dy * 200, this._p.z + dz * 200);
      else { this._l.x += (lx - this._l.x) * k; this._l.y += (ly - this._l.y) * k; this._l.z += (lz - this._l.z) * k; }
      cam.position.copy(this._p);
      cam.up.set(0, 1, 0);
      cam.lookAt(this._l);
      // trauma shake
      if (this.trauma > 0.001) {
        const s = this.trauma * this.trauma;
        cam.rotation.x += (Math.sin(t * 71) + Math.sin(t * 113)) * 0.012 * s; cam.rotation.y += (Math.sin(t * 83) + Math.cos(t * 97)) * 0.012 * s; cam.rotation.z += Math.sin(t * 59) * 0.02 * s;
        this.trauma = Math.max(0, this.trauma - dt * 1.4);
      }
      this.fov += (fov - this.fov) * Math.min(1, dt * 10);
      if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
      cam.updateMatrixWorld();
    }

    // Resolve the screen-centre ray into a world aim point + the yaw/pitch the
    // unit must fire along to hit it.
    aim(world, u, range) {
      const o = this._p, cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const d = { x: sy * cp, y: sp, z: cy * cp };
      const minT = Math.hypot(u.pos.x - o.x, u.pos.y + u.h - o.y, u.pos.z - o.z) + 2.5;
      let best = range || 500, tgt = null;
      const tg = world.terrain.raycast(o, d, best);
      if (tg > minT && tg < best) best = tg;
      for (const e of world.units) {
        if (!e.alive || e === u || e.team === u.team) continue;
        const cx = e.pos.x - o.x, cyy = e.pos.y + (e.kind === 'infantry' || e.kind === 'vehicle' || e.kind === 'turret' ? e.h * 0.5 : 0) - o.y, cz = e.pos.z - o.z;
        const tc = cx * d.x + cyy * d.y + cz * d.z; if (tc < minT || tc > best + e.r) continue;
        const r = e.kind === 'capital' ? e.h * 1.3 : e.kind === 'infantry' ? 1.1 : e.r * 1.15;
        const d2 = cx * cx + cyy * cyy + cz * cz - tc * tc;
        if (d2 < r * r) { const th = tc - Math.sqrt(r * r - d2) * 0.5; if (th < best) { best = Math.max(minT, th); tgt = e; } }
      }
      const ap = this.aimPoint; ap.x = o.x + d.x * best; ap.y = o.y + d.y * best; ap.z = o.z + d.z * best;
      this.aimTarget = tgt;
      const ex = u.pos.x, ey = u.pos.y + (u.kind === 'infantry' ? u.h * 0.84 : u.h * 0.8), ez = u.pos.z;
      const ax = ap.x - ex, ay = ap.y - ey, az = ap.z - ez;
      return { yaw: Math.atan2(ax, az), pitch: Math.atan2(ay, Math.hypot(ax, az)), target: tgt, dist: best };
    }

    // ground point under a screen pixel (commander picking)
    pick(sx, sy, world) {
      const T = E.THREE, v = new T.Vector3((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1, 0.5).unproject(this.cam);
      const o = this.cam.position, d = v.sub(o).normalize();
      const t = world.terrain.raycast(o, d, 6000);
      return t > 0 ? { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t } : null;
    }
    project(p, out) {
      const v = (this._pv || (this._pv = new E.THREE.Vector3())).set(p.x, p.y, p.z).project(this.cam);
      out.x = (v.x * 0.5 + 0.5) * window.innerWidth; out.y = (-v.y * 0.5 + 0.5) * window.innerHeight; out.vis = v.z < 1 && v.z > -1;
      return out;
    }
  }

  E.Camera = Camera;
})(window.E = window.E || {});
