// Camera manager: drives the camera from the possessed unit across all modes.
// Modes:
//   fps        on-foot first person (mouse-look, WASD in the controller)
//   vehicle    chase cam behind a ground/air vehicle (mouse steers the vehicle)
//   ship       capital-ship bridge: a high chase view showing the hull + space
//   commander  free overhead / orbiting view for commanding the force
// The camera is a pure function of (mode, unit, lookYaw/Pitch, distance, t).
(function (E) {
  'use strict';

  class Camera {
    constructor(scene) {
      this.scene = scene;
      this.cam = scene.camera;
      this.mode = 'commander';
      this.unit = null;
      this.lookYaw = 0;
      this.lookPitch = 0;
      this.dist = 18;
      this.roll = 0;
      this._sm = { p: E.V3.make(), r: 0, d: 18 };
      this._tmp = E.V3.make();
      this._look = E.V3.make(0, 0, -1);
    }

    setMode(mode, unit) {
      this.mode = mode;
      this.unit = unit;
      if (unit) {
        this.lookYaw = unit.yaw || 0;
        this.lookPitch = mode === 'fps' ? 0 : 0;
        this.dist = mode === 'fps' ? 0 : mode === 'vehicle' ? 16 : mode === 'ship' ? 220 : 120;
      }
    }

    // controller calls this when the player turns (mouse / strafe)
    look(dYaw, dPitch) {
      this.lookYaw += dYaw;
      this.lookPitch = E.clamp(this.lookPitch + dPitch, -1.35, 1.35);
    }

    // update the camera to follow the unit at time t (render frame)
    update(dt, t) {
      const cam = this.cam, u = this.unit;
      if (!u) { this.commander(dt, t); return; }

      const pos = u.pos || E.V3.make(0, 0, 0);
      const yaw = u.yaw || 0;
      const up = E.V3.make(0, 1, 0);
      const fwd = E.V3.make(Math.sin(yaw), 0, Math.cos(yaw));

      if (this.mode === 'fps') {
        // camera at eye height, oriented by yaw/pitch
        cam.position.set(pos.x, pos.y + (u.viewH || 1.7), pos.z);
        const dir = E.V3.make(
          Math.sin(yaw) * Math.cos(this.lookPitch),
          Math.sin(this.lookPitch),
          Math.cos(yaw) * Math.cos(this.lookPitch),
        );
        cam.up.set(0, 1, 0);
        cam.lookAt(E.V3.add(cam.position, dir, E.V3.make()));
        cam.fov = 72; cam.updateProjectionMatrix();
        return;
      }

      if (this.mode === 'vehicle') {
        const d = this.dist;
        const back = E.V3.scale(fwd, -d, E.V3.make());
        const eye = E.V3.add(pos, back, E.V3.make());
        eye.y += 5 + Math.abs(this.lookPitch) * 6;
        // smooth
        const k = 1 - Math.exp(-dt * 8);
        this._sm.p = E.V3.lerp(this._sm.p, eye, k, this._sm.p);
        cam.position.set(this._sm.p.x, this._sm.p.y, this._sm.p.z);
        cam.up.set(0, 1, 0);
        const target = E.V3.add(pos, E.V3.make(0, 3, 0), E.V3.make());
        target.x += Math.sin(yaw + this.lookYaw * 0.3) * 4;
        cam.lookAt(target);
        cam.fov = 68; cam.updateProjectionMatrix();
        return;
      }

      if (this.mode === 'ship') {
        // bridge: high and behind, looking out at the bow and the space ahead
        const d = this.dist;
        const back = E.V3.scale(fwd, -d, E.V3.make());
        const eye = E.V3.add(pos, back, E.V3.make());
        eye.y += u.viewH * 0.7 + 20;
        const k = 1 - Math.exp(-dt * 4);
        this._sm.p = E.V3.lerp(this._sm.p, eye, k, this._sm.p);
        cam.position.set(this._sm.p.x, this._sm.p.y, this._sm.p.z);
        cam.up.set(0, 1, 0);
        const target = E.V3.add(pos, E.V3.make(0, u.viewH * 0.2, 0), E.V3.make());
        target.x += fwd.x * 200; target.z += fwd.z * 200;
        cam.lookAt(target);
        cam.fov = 60; cam.updateProjectionMatrix();
        return;
      }

      this.commander(dt, t);
    }

    // Free orbiting view for the commander. The controller steers this with
    // arrow keys / Q,E (orbit), R,F (height). The camera orbits a focus point.
    commander(dt, t) {
      const u = this.unit;
      const cx = u ? (u.pos ? u.pos.x : u.x) : 0;
      const cy = u ? (u.pos ? u.pos.y : u.y) : 0;
      const cz = u ? (u.pos ? u.pos.z : u.z) : 0;
      this.cmdYaw = (this.cmdYaw === undefined) ? t * 0.05 : this.cmdYaw;
      this.cmdPitch = this.cmdPitch === undefined ? -0.6 : this.cmdPitch;
      this.cmdDist = this.cmdDist === undefined ? 260 : this.cmdDist;
      const cp = Math.cos(this.cmdPitch), sp = Math.sin(this.cmdPitch);
      const eye = E.V3.make(
        cx + Math.sin(this.cmdYaw) * cp * this.cmdDist,
        cy + sp * this.cmdDist,
        cz + Math.cos(this.cmdYaw) * cp * this.cmdDist,
      );
      const k = 1 - Math.exp(-dt * 5);
      this._sm.p = E.V3.lerp(this._sm.p, eye, k, this._sm.p);
      this.cam.position.set(this._sm.p.x, this._sm.p.y, this._sm.p.z);
      this.cam.up.set(0, 1, 0);
      this.cam.lookAt(cx, cy, cz);
      this.cam.fov = 58; this.cam.updateProjectionMatrix();
    }

    // aim a world-space reticle from the current view (for targeting/selecting)
    aimRay(origin, dir) {
      if (this.mode === 'fps' || this.mode === 'vehicle') {
        this.cam.getWorldDirection(dir);
        origin.copy ? origin.set(this.cam.position.x, this.cam.position.y, this.cam.position.z) : 0;
      }
      return { origin, dir };
    }
  }

  E.Camera = Camera;
})(window.E = window.E || {});
