// three.js scene core on the WebGPU renderer (THREE.WebGPURenderer, which falls
// back to its WebGL2 backend when navigator.gpu is missing): renderer boot,
// light rig + cascaded shadow maps, altitude-dependent ambient, the environment
// (IBL) baked from the procedural sky, the post stack (post.js), quality tiers,
// the resolution/tier governor and the ?debug readout. Browser-only.
//
// Boot is async:   await E.Scene.preinit(canvas, settings)   then   new E.Scene(canvas, opts)
// (js/ui/main.js does this before it constructs the Game).
(function (E) {
  'use strict';

  // ── quality tiers: every pass is a per-tier toggle ──
  //  res/resMin  internal render scale range for the dynamic-resolution governor (TAAU resolves to native)
  //  dpr         cap on devicePixelRatio (ultra supersamples hi-dpi screens)
  //  csm         shadow cascades x map size    ao/ssr  {scale: pass res, samples/quality}
  //  atmo        {fog, clouds: march steps (0 = off), shafts: steps (0 = off)}
  const QUALITY = {
    low:    { name: 'low',    res: 0.6, resMin: 0.5, dpr: 1,   csm: { n: 2, size: 1024 }, taa: true, ao: null, ssr: null, bloom: true, motionBlur: 0, dof: false, ca: false, grain: false, atmo: { fog: true, clouds: 10, shafts: 0 },   particles: 0.4, shadows: 1024, msaa: 0 },
    medium: { name: 'medium', res: 0.75, resMin: 0.55, dpr: 1,  csm: { n: 3, size: 1024 }, taa: true, ao: { scale: 0.5, samples: 8 }, ssr: null, bloom: true, motionBlur: 0, dof: true, ca: true, grain: true, atmo: { fog: true, clouds: 12, shafts: 12 },   particles: 0.7, shadows: 1024, msaa: 0 },
    high:   { name: 'high',   res: 1.0, resMin: 0.62, dpr: 1.5, csm: { n: 3, size: 2048 }, taa: true, ao: { scale: 0.75, samples: 12 }, ssr: { scale: 0.5, quality: 0.5 }, bloom: true, motionBlur: 8, dof: true, ca: true, grain: true, atmo: { fog: true, clouds: 14, shafts: 24 }, particles: 1, shadows: 2048, msaa: 0 },
    ultra:  { name: 'ultra',  res: 1.0, resMin: 0.75, dpr: 2,   csm: { n: 4, size: 2048 }, taa: true, ao: { scale: 1, samples: 16 }, ssr: { scale: 0.75, quality: 0.8 }, bloom: true, motionBlur: 12, dof: true, ca: true, grain: true, atmo: { fog: true, clouds: 20, shafts: 32 }, particles: 1, shadows: 4096, msaa: 0 },
  };
  const ORDER = ['low', 'medium', 'high', 'ultra'];
  const AUTO_MAX = 2;      // the governor never probes above 'high'; ultra is opt-in

  const urlParam = (k) => { try { return new URLSearchParams(window.location.search).get(k); } catch (e) { return null; } };

  class Scene {
    // Create + initialise the renderer. Must complete before `new Scene`.
    static async preinit(canvas, opts) {
      const T = E.THREE;
      if (window.GC_TRACE) T.Node.captureStackTrace = true;
      if (!T.WebGPURenderer) throw new Error('vendor/three.min.js is not the WebGPU build (run npm run vendor:three)');
      const force = (window.GC_BACKEND || urlParam('backend')) === 'webgl';
      const make = (forceWebGL) => new T.WebGPURenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', forceWebGL, reversedDepthBuffer: true, stencil: false });
      let r = make(force);
      try { await r.init(); }
      catch (e) {
        console.warn('WebGPU init failed, retrying on the WebGL2 backend:', e && e.message);
        try { r.dispose(); } catch (e2) { /* ignore */ }
        r = make(true); await r.init();
      }
      Scene._pre = r;
      return r;
    }

    constructor(canvas, opts) {
      const T = E.THREE; opts = opts || {};
      this.cv = canvas;
      const r = this.renderer = Scene._pre;
      if (!r) throw new Error('E.Scene: renderer not initialised; await E.Scene.preinit(canvas) first');
      Scene._pre = null;
      this.backend = r.backend && r.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';
      r.toneMapping = T.NoToneMapping;               // tone mapping happens in the post graph (post.js)
      r.shadowMap.enabled = true;
      r.shadowMap.type = T.PCFShadowMap;
      r.info.autoReset = false;

      this.scene = new T.Scene();
      this.scene.background = null;
      // soldier at 2 m ... hull several km away: near 0.3, far 60 km, with a reversed floating-point depth buffer
      // (depth precision is ~uniform in log space; falls back to the same layout on WebGL2 via EXT_clip_control)
      this.camera = new T.PerspectiveCamera(60, 1, 0.3, 60000);
      this.camera.position.set(0, 60, 160);

      this.world = new T.Group(); this.units = new T.Group(); this.fx = new T.Group(); this.hud3d = new T.Group();
      this.scene.add(this.world, this.units, this.fx, this.hud3d);

      this.hemi = new T.HemisphereLight(0xbfd4ff, 0x30281c, 0.9);
      this.sun = new T.DirectionalLight(0xffffff, 3);
      this.sun.castShadow = true;
      this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.35; this.sun.shadow.radius = 2.5;
      this.scene.add(this.hemi, this.sun, this.sun.target);
      this.sunDir = new T.Vector3(0.4, 0.6, -0.5).normalize();
      this.shadowRange = 600;

      this.qualityName = 'high';
      const want = window.GC_QUALITY || urlParam('quality') || opts.quality;
      this.auto = !want || want === 'auto';
      this.qualityName = want && QUALITY[want] ? want : 'high';
      this.Q = QUALITY[this.qualityName];
      this.resScale = this.Q.res; this.altitude = 0; this.frames = 0;
      this.frameMs = 16; this._gt = 0; this._lastT = 0; this._upT = 0; this._downT = 0;
      this.noGov = !!(window.GC_NO_GOV || urlParam('gov') === '0');
      const fixedRes = parseFloat(window.GC_RES || urlParam('res'));
      if (fixedRes > 0) { this.noGov = true; this.resScale = Math.min(1, fixedRes); }

      this._atm = null; this._env = {}; this._envKey = '';
      this.post = new E.Post(this);
      // compatibility handle for the game controller: damage / zoom / fade live in the post stack
      const u = this.post.u;
      this.grade = { uniforms: { damage: u.damage, zoom: u.zoom, fade: u.fade, time: u.time } };
      this.applyQuality();
      this.resize();
      this.makeDebug();
    }

    // ── quality ──
    applyQuality() {
      const Q = this.Q;
      this.makeShadows();
      this.resScale = Math.min(Q.res, Math.max(Q.resMin, this.resScale));
      this.post.P.bloom.strength = this.post.P.bloom.strength || 0.5;
      this.post.setScale(this.resScale);
      this.post.build();
      this.scene.traverse(o => { if (o.material && (o.isMesh || o.isInstancedMesh)) o.material.needsUpdate = true; });
    }
    setQuality(name) {
      this.auto = name === 'auto';
      if (this.auto) name = this.qualityName;
      if (!QUALITY[name]) name = 'high';
      const changed = name !== this.qualityName;
      this.qualityName = name; this.Q = QUALITY[name];
      if (changed || !this._built) { this._built = true; this.resScale = this.Q.res; this.applyQuality(); }
      this.resize();
      if (this.fxScale) this.fxScale(this.Q.particles);
    }

    // cascaded shadow maps for the sun, split for a 2 m soldier .. km-scale view ranges
    makeShadows() {
      const T = E.THREE, c = this.Q.csm, sun = this.sun;
      if (this.csm) { try { this.csm.dispose(); } catch (e) { /* ignore */ } this.csm = null; }
      sun.shadow.mapSize.set(c.size, c.size);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      const n = c.n, self = this;
      // cascade k covers [r*f(k-1), r*f(k)] of the range r; tight near the player, long toward the horizon
      const fr = { 1: [1], 2: [0.12, 1], 3: [0.06, 0.24, 1], 4: [0.04, 0.12, 0.38, 1] }[n];
      this.csm = new T.CSMShadowNode(sun, { cascades: n, maxFar: this.shadowRange, mode: 'custom', customSplitsCallback: (cascades, near, far, target) => { for (const f of fr) target.push(f); } });
      sun.shadow.shadowNode = this.csm;
    }

    // ── atmosphere / lighting driven by the biome ──
    setAtmosphere(a) {
      this._atm = a;
      const A = E.Atmo.U, M = E.Mat.U;
      A.fogColor.value.copy(a.fogColor); A.sunColor.value.copy(a.sunColor); A.sunDir.value.copy(a.sunDir);
      A.density.value = a.density; A.heightK.value = a.heightK; A.base.value = a.base || 0;
      A.cover.value = a.cloud; A.cloudCol.value.copy(a.cloudCol); A.cloudDark.value.copy(a.cloudDark);
      A.airless.value = a.airless; M.airless.value = a.airless;
      M.sunDir.value.copy(a.sunDir); M.sunColor.value.copy(a.sunColor);
      this.sunDir.copy(a.sunDir);
      this.sun.color.copy(a.sunColor); this.sun.intensity = a.sunI;
      this.hemi.color.copy(a.skyColor); this.hemi.groundColor.copy(a.groundColor); this.hemi.intensity = a.ambI;
      this.post.P.bloom.strength = a.bloom || 0.5;
      this.post.setBiome(a.biome);
      this.post.apply();
    }

    // Bake the sky into image-based lighting: one cube for the surface, one for orbit (stars + planet below).
    setEnvironment(sky) {
      const T = E.THREE, M = E.Mat.U;
      try {
        const pm = new T.PMREMGenerator(this.renderer);
        const bake = (alt) => {
          const s = new T.Scene(), m = new T.Mesh(sky.dome.geometry, sky.dome.material);
          s.add(m); M.altitude.value = alt;
          return pm.fromScene(s, 0, 1, 50000, { size: 128 }).texture;
        };
        for (const k of ['ground', 'space']) if (this._env[k]) this._env[k].dispose();
        this._env.ground = bake(2); this._env.space = bake(3300);
        pm.dispose();
        this._envKey = ''; this.scene.environment = this._env.ground; E.Mat.setEnv(this._env.ground);
      } catch (e) { console.warn('env map failed', e); }
    }

    resize() {
      const W = window.innerWidth || 1280, H = window.innerHeight || 720;
      this.camera.aspect = W / H; this.camera.updateProjectionMatrix();
      const dpr = Math.min(this.Q.dpr, window.devicePixelRatio || 1);
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(W, H, false);
      this._W = W; this._H = H; this._dpr = dpr;
    }

    // keep the shadow cascades sized for what the player is looking at
    focusShadows(p, extent) {
      const ex = extent || 160, range = Math.max(250, Math.min(3600, ex * 5));
      if (Math.abs(range - this.shadowRange) > this.shadowRange * 0.15 && this.csm) {
        this.shadowRange = range; this.csm.maxFar = range;
        if (this.csm.camera) this.csm.updateFrustums();
      }
      const s = this.sun, c = this.camera.position;
      s.target.position.copy(c);
      s.position.set(c.x + this.sunDir.x * 1000, c.y + this.sunDir.y * 1000, c.z + this.sunDir.z * 1000);
      s.target.updateMatrixWorld(); s.updateMatrixWorld();
    }

    // ── governor: dynamic resolution first, then tier steps, both from measured wall-clock frame time ──
    gov(dtMs) {
      if (this.noGov) return;
      this._gt += dtMs; if (this._gt < 500) return;
      const ms = this.frameMs; this._gt = 0;
      const Q = this.Q;
      if (ms > 21) {
        this._upT = 0; this._downT++;
        if (this.resScale > Q.resMin + 1e-3) { this.resScale = Math.max(Q.resMin, this.resScale - 0.06); this.post.setScale(this.resScale); }
        else if (this.auto && this._downT >= 6) { const i = ORDER.indexOf(this.qualityName); if (i > 0) this._swap(ORDER[i - 1]); }
      } else if (ms < 13.5) {
        this._downT = 0; this._upT++;
        if (this.resScale < Q.res - 1e-3) { this.resScale = Math.min(Q.res, this.resScale + 0.03); this.post.setScale(this.resScale); }
        else if (this.auto && this._upT >= 20) { const i = ORDER.indexOf(this.qualityName); if (i < AUTO_MAX && !this._capped) { this._swap(ORDER[i + 1]); this._capped = (this._ups = (this._ups || 0) + 1) > 3; } this._upT = 0; }
      } else { this._upT = 0; this._downT = Math.max(0, this._downT - 1); }
    }
    _swap(name) { this.qualityName = name; this.Q = QUALITY[name]; this.resScale = this.Q.res; this.applyQuality(); this.resize(); this.frameMs = 16; this._downT = this._upT = 0; if (this.fxScale) this.fxScale(this.Q.particles); }

    // ── per-frame ──
    render(t) {
      const cam = this.camera, A = E.Atmo.U, M = E.Mat.U, P = this.post;
      cam.updateMatrixWorld();
      const alt = cam.position.y; this.altitude = alt;
      const ALT = (E.SIM && E.SIM.ALT) || { cloudLo: 700, cloudHi: 1000, space: 2600, orbit: 3200, ceiling: 4400 };
      const airless = this._atm ? this._atm.airless : 0;
      const k = Math.max(0, Math.min(1, 1 - alt / ALT.space));                  // air density 1 at the surface .. 0 in space
      const spaceK = Math.max(airless, 1 - k);
      M.time.value = t; M.camPos.value.copy(cam.position); M.altitude.value = alt; M.space.value = spaceK;
      A.camPos.value.copy(cam.position); A.frame.value = (A.frame.value + 1) % 4096; A.wind.value.set(t * 7, 0, t * 3.5);
      A.cloudLo.value = ALT.cloudLo; A.cloudHi.value = ALT.cloudHi;
      P.u.time.value = t % 100;
      if (this._atm) {
        const a = this._atm;
        A.density.value = a.density * (1 - E.smoothstep(300, 1400, alt) * 0.75);
        // ground bounce low down; hard single-source light with planet-shine in space
        const sm = 1 - Math.pow(k, 0.6);
        this.hemi.intensity = a.ambI * (0.12 + 0.88 * Math.pow(k, 0.7)) + 0.16 * sm * (1 - airless * 0.5);
        this.sun.intensity = a.sunI * (1 + 0.45 * sm);
        if (sm > 0.05) { this._shine = this._shine || new (E.THREE.Color)(); this._shine.copy(a.groundColor).multiplyScalar(2); this.hemi.groundColor.copy(a.groundColor).lerp(this._shine, sm); this.hemi.color.copy(a.skyColor).lerp(new (E.THREE.Color)(0.02, 0.03, 0.07), sm); }
        else { this.hemi.color.copy(a.skyColor); this.hemi.groundColor.copy(a.groundColor); }
        this.scene.environmentIntensity = 0.75 * (0.18 + 0.82 * k) + 0.25 * sm * 0.6;
        const key = alt > 1750 || airless ? 'space' : 'ground';
        if (key !== this._envKey && this._env[key]) { this._envKey = key; this.scene.environment = this._env[key]; E.Mat.setEnv(this._env[key]); }
      }
      // keep cascade frusta in step with FOV changes (ADS zoom)
      if (this.csm && this.csm.camera && Math.abs(this._csmFov - cam.fov) > 0.4) { this._csmFov = cam.fov; this.csm.updateFrustums(); }
      this.renderer.info.reset();
      const t0 = performance.now();
      P.render();
      this.frames++;
      const now = performance.now();
      if (this._lastT) { const d = now - this._lastT; this.frameMs += (Math.min(d, 200) - this.frameMs) * 0.08; }
      this._lastT = now;
      this._renderMs = now - t0;
      if (this.dbg) this.updateDebug(now);
    }

    // ── ?debug / window.GC_DEBUG readout ──
    makeDebug() {
      if (!(window.GC_DEBUG || urlParam('debug') !== null)) return;
      const el = document.createElement('pre');
      el.id = 'gc-debug';
      el.style.cssText = 'position:fixed;right:8px;bottom:8px;margin:0;padding:6px 8px;font:11px/1.35 ui-monospace,Menlo,monospace;color:#9f9;background:rgba(0,0,0,.6);border-radius:4px;z-index:99999;pointer-events:none;white-space:pre';
      document.body.appendChild(el); this.dbg = el; this._dbgT = 0;
    }
    stats() {
      const i = this.renderer.info.render;
      return { frameMs: +this.frameMs.toFixed(1), cpuMs: +(this._renderMs || 0).toFixed(1), drawCalls: i.drawCalls, triangles: i.triangles, backend: this.backend, tier: this.qualityName + (this.auto ? ' (auto)' : ''), resScale: +this.resScale.toFixed(2), size: this._W + 'x' + this._H, frames: this.frames };
    }
    updateDebug(now) {
      if (now - this._dbgT < 250) return; this._dbgT = now;
      const s = this.stats();
      this.dbg.textContent = `frame  ${s.frameMs} ms (${(1000 / s.frameMs).toFixed(0)} fps)  cpu ${s.cpuMs} ms\ndraws  ${s.drawCalls}   tris ${s.triangles}\nbackend ${s.backend}   tier ${s.tier}\nres    ${s.size} x${s.resScale} (TAAU)`;
    }

    dispose() { this.post.dispose(); this.renderer.dispose(); if (this.dbg) this.dbg.remove(); }
  }

  E.Scene = Scene;
  E.QUALITY = QUALITY;
})(window.E = window.E || {});
