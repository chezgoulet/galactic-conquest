// Visual effects: projectile tracers (a single Points cloud), and a pool of
// expanding billboard "flashes" (muzzle, impact, explosion, shield) that expand
// and fade. Driven by world.projectiles and world.drainEvents(). Browser-only.
(function (E) {
  'use strict';

  function radialTexture() {
    const T = E.THREE, c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    const t = new T.CanvasTexture(c); t.needsUpdate = true; return t;
  }

  class FX {
    constructor(scene) {
      const T = E.THREE;
      this.scene = scene;
      this.tex = radialTexture();
      this.flashes = [];
      this.pool = [];
      // projectile Points cloud
      const N = 1024;
      this.capN = N;
      this.pPos = new Float32Array(N * 3);
      this.pCol = new Float32Array(N * 3);
      this.pGeo = new T.BufferGeometry();
      this.pGeo.setAttribute('position', new T.BufferAttribute(this.pPos, 3).setUsage(T.DynamicDrawUsage));
      this.pGeo.setAttribute('color', new T.BufferAttribute(this.pCol, 3).setUsage(T.DynamicDrawUsage));
      this.pMat = new T.PointsMaterial({ size: 6, map: this.tex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, vertexColors: true, sizeAttenuation: true });
      this.points = new T.Points(this.pGeo, this.pMat);
      this.points.frustumCulled = false;
      this.points.visible = false;
      scene.fx.add(this.points);
    }

    // spawn a billboard flash
    flash(pos, opts) {
      opts = opts || {};
      let f = this.pool.pop();
      if (!f) {
        const T = E.THREE;
        const m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide }));
        f = { mesh: m, life: 0, max: 0.3, size: 4, col: new T.Color(1, 1, 1), rot: Math.random() * 6.28 };
        this.scene.fx.add(f.mesh);
      }
      f.life = f.max = opts.max || 0.3;
      f.size = opts.size || 6;
      f.col.set(opts.color || '#ffffff');
      f.mesh.material.color.copy(f.col);
      f.mesh.position.set(pos.x, pos.y, pos.z);
      f.mesh.visible = true;
      this.flashes.push(f);
    }

    boom(pos, color, big) {
      const n = big ? 7 : 3;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.28, d = Math.random() * (big ? 30 : 10);
        this.flash({ x: pos.x + Math.cos(a) * d, y: pos.y + (Math.random() - 0.3) * (big ? 25 : 8), z: pos.z + Math.sin(a) * d },
          { color, max: (big ? 0.6 : 0.3) + Math.random() * 0.3, size: (big ? 40 : 14) + Math.random() * 20 });
      }
    }

    // apply drained sim events
    applyEvents(events) {
      for (const e of events) {
        if (e.type === 'muzzle') this.flash(e.pos, { color: E.faction(e.faction).palette.engine, max: 0.08, size: 8 });
        else if (e.type === 'impact') this.flash(e.pos, { color: E.faction(e.faction).palette.engine, max: 0.18, size: 10 });
        else if (e.type === 'shieldhit') this.flash(e.pos, { color: E.faction(e.team).palette.shield, max: 0.25, size: 22 });
        else if (e.type === 'death') {
          const c = E.faction(e.faction).palette.engine;
          this.boom(e.pos, c, e.kind === 'capital' ? true : e.kind === 'vehicle' ? true : false);
        }         else if (e.type === 'launch') this.flash(e.pos, { color: E.faction(e.faction).palette.engine, max: 0.5, size: 26 });
        else if (e.type === 'objectiveCaptured') {
          this.boom(e.pos, e.team === 'aegis' ? '#ff5a2b' : '#3df0b0', true);
        }
      }
    }

    // sync the projectile tracer cloud
    syncProjectiles(projectiles) {
      const n = Math.min(projectiles.length, this.capN);
      this.points.visible = n > 0;
      if (!n) return;
      for (let i = 0; i < n; i++) {
        const p = projectiles[i];
        this.pPos[i * 3] = p.pos.x; this.pPos[i * 3 + 1] = p.pos.y; this.pPos[i * 3 + 2] = p.pos.z;
        const c = p.color; this.pCol[i * 3] = c[0] / 255; this.pCol[i * 3 + 1] = c[1] / 255; this.pCol[i * 3 + 2] = c[2] / 255;
      }
      this.pGeo.setDrawRange(0, n);
      this.pGeo.attributes.position.needsUpdate = true;
      this.pGeo.attributes.color.needsUpdate = true;
    }

    update(dt, t) {
      // flashes expand + fade
      for (let i = this.flashes.length - 1; i >= 0; i--) {
        const f = this.flashes[i];
        f.life -= dt;
        if (f.life <= 0) { f.mesh.visible = false; this.pool.push(f); this.flashes.splice(i, 1); continue; }
        const k = 1 - f.life / f.max;      // 0 -> 1
        const s = f.size * (0.3 + k * 1.7);
        f.mesh.scale.set(s, s, s);
        f.mesh.material.opacity = (1 - k) * 0.9;
        // face camera
        f.mesh.quaternion.copy(this.scene.camera.quaternion);
      }
    }
  }

  E.FX = FX;
})(window.E = window.E || {});
