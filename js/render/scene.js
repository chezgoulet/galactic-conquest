// three.js scene core: renderer, camera, lights, fog, the group hierarchy, and
// a light quality governor (downgrades pixel ratio / shadows when frames drop).
// Browser-only (needs THREE + WebGL).
(function (E) {
  'use strict';

  class Scene {
    constructor(canvas) {
      const T = E.THREE;
      this.cv = canvas;
      this.renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.outputColorSpace = T.SRGBColorSpace;
      this.renderer.toneMapping = T.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = T.PCFShadowMap;

      this.scene = new T.Scene();
      this.scene.background = new T.Color(0x05070c);
      this.camera = new T.PerspectiveCamera(60, 1, 0.5, 60000);
      this.camera.position.set(0, 30, 80);

      // group hierarchy
      this.world = new T.Group();   // terrain, water, cover
      this.units = new T.Group();   // infantry/vehicles/fighters/capitals
      this.fx = new T.Group();      // projectiles, flashes, trails, particles
      this.hud3d = new T.Group();   // world-anchored labels/rings
      this.scene.add(this.world, this.units, this.fx, this.hud3d);

      // lights
      this.hemi = new T.HemisphereLight(0xbfd4ff, 0x0a0a0a, 0.5);
      this.scene.add(this.hemi);
      this.sun = new T.DirectionalLight(0xffffff, 1.4);
      this.sun.position.set(0.4, 0.6, -0.5).multiplyScalar(2000);
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const sc = this.sun.shadow.camera;
      sc.near = 50; sc.far = 6000; sc.left = sc.bottom = -1500; sc.right = sc.top = 1500;
      this.scene.add(this.sun, this.sun.target);
      this.fill = new T.AmbientLight(0x223040, 0.4);
      this.scene.add(this.fill);

      this.fog = new T.Fog(0x9fb4c9, 200, 3000);
      this.scene.fog = this.fog;

      this.quality = 'high';
      this.frameGapAvg = 16.7;
      this.lastT = 0;
      this.onResize = null;
      this.resize();
    }

    setBiomeAtmosphere(b) {
      const T = E.THREE;
      const pal = b.palette;
      this.scene.background = new T.Color().setRGB(pal.sky[0] / 255, pal.sky[1] / 255, pal.sky[2] / 255);
      this.fog.color.setRGB(pal.fog[0] / 255, pal.fog[1] / 255, pal.fog[2] / 255);
      // fog distance from the biome's inherent visibility challenge
      const vis = (b.challenge && b.challenge.fog) || 3000;
      this.fog.far = Math.max(400, vis);
      this.fog.near = Math.max(30, vis * 0.08);
      this._fogFar = this.fog.far; this._fogNear = this.fog.near;
      this.hemi.color.setRGB(pal.sky[0] / 255, pal.sky[1] / 255, pal.sky[2] / 255);
      this.hemi.groundColor.setRGB(pal.low[0] / 255, pal.low[1] / 255, pal.low[2] / 255);
      const s = b.sun || {};
      this.sun.color.setRGB(s.color[0] / 255, s.color[1] / 255, s.color[2] / 255);
      this.sun.intensity = (s.strength || 1) * 1.3;
      this.sun.position.set((s.dir ? s.dir[0] : 0.4), (s.dir ? s.dir[1] : 0.6), (s.dir ? s.dir[2] : -0.5)).multiplyScalar(2600);
      this.sun.castShadow = this.quality !== 'low';
    }

    resize() {
      const W = window.innerWidth || this.cv.clientWidth || 1280;
      const H = window.innerHeight || this.cv.clientHeight || 720;
      this.camera.aspect = W / H;
      this.camera.updateProjectionMatrix();
      const dpr = Math.min(this.quality === 'low' ? 1 : 2, window.devicePixelRatio || 1);
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(W, H, false);
    }

    // Fade ground fog as the camera climbs into air/space (clearer horizon up high).
    setCameraAltitude(alt) {
      if (!this.scene.fog) return;
      const t = E.clamp01(E.invLerp(60, 3000, alt));
      const base = this._fogFar || this.fog.far;
      this.fog.far = base * (1 + t * 6);      // horizon opens up with altitude
      this.fog.near = (this._fogNear || this.fog.near) * (1 + t * 3);
    }

    // Quality governor: downgrades before a visible stutter, probes back up.
    gov(dtMs) {
      this.frameGapAvg = this.frameGapAvg * 0.95 + dtMs * 0.05;
      if (this._gt === undefined) this._gt = 0;
      this._gt += dtMs;
      if (this._gt < 2000) return;
      this._gt = 0;
      const r = this.renderer;
      if (this.frameGapAvg > 20 && this.quality === 'high') {
        this.quality = 'medium'; r.setPixelRatio(1); r.shadowMap.enabled = false;
        this.sun.castShadow = false; this.scene.userData.low = true;
      } else if (this.frameGapAvg > 30 && this.quality === 'medium') {
        this.quality = 'low'; r.setPixelRatio(0.75);
      } else if (this.frameGapAvg < 12 && this.quality === 'low') {
        this.quality = 'medium'; r.setPixelRatio(1);
      } else if (this.frameGapAvg < 10 && this.quality === 'medium') {
        this.quality = 'high'; r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.shadowMap.enabled = true;
      }
    }

    render() { this.renderer.render(this.scene, this.camera); }
    dispose() { this.renderer.dispose(); }
  }

  E.Scene = Scene;
})(window.E = window.E || {});
