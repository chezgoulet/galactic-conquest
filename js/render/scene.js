// three.js scene core: renderer, HDR post-processing chain, lights, shadows and
// a quality governor. The frame is rendered to a float target, then:
//   scene -> atmosphere (depth-based height fog + sun in-scatter)
//         -> bloom -> grade (vignette, grain, damage, fade) -> tone-map/output.
// Browser-only (needs THREE + WebGL2).
(function (E) {
  'use strict';

  const QUALITY = {
    low:    { dpr: 0.75, shadows: 0,    bloom: false, msaa: 0, particles: 0.4 },
    medium: { dpr: 1,    shadows: 1024, bloom: true,  msaa: 0, particles: 0.7 },
    high:   { dpr: 1.5,  shadows: 2048, bloom: true,  msaa: 4, particles: 1 },
  };

  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  function atmospherePass() {
    const T = E.THREE;
    const pass = new T.Pass();
    const mat = new T.ShaderMaterial({
      depthTest: false, depthWrite: false,
      uniforms: {
        tDiffuse: { value: null }, tDepth: { value: null },
        invProj: { value: new T.Matrix4() }, invView: { value: new T.Matrix4() }, camPos: { value: new T.Vector3() },
        fogColor: { value: new T.Color(0.6, 0.7, 0.8) }, sunColor: { value: new T.Color(1, 0.9, 0.7) }, sunDir: { value: new T.Vector3(0, 1, 0) },
        density: { value: 0.0006 }, heightK: { value: 0.006 }, base: { value: 0 }, maxFog: { value: 0.96 },
      },
      vertexShader: VS,
      fragmentShader: `
        varying vec2 vUv; uniform sampler2D tDiffuse, tDepth; uniform mat4 invProj, invView;
        uniform vec3 camPos, fogColor, sunColor, sunDir; uniform float density, heightK, base, maxFog;
        void main(){
          vec4 col = texture2D(tDiffuse, vUv);
          float d = texture2D(tDepth, vUv).x;
          if (d < 0.99999) {
            vec4 v = invProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); v /= v.w;
            vec3 wp = (invView * v).xyz;
            vec3 rd = wp - camPos; float dist = length(rd); rd /= max(dist, 1e-4);
            float t = rd.y * heightK;
            float f = abs(t) < 1e-5 ? dist : (1.0 - exp(-dist * t)) / t;
            float amt = density * exp(clamp(-(camPos.y - base) * heightK, -20.0, 4.0)) * f;
            float fog = clamp(1.0 - exp(-amt), 0.0, maxFog);
            float sun = pow(max(dot(rd, sunDir), 0.0), 8.0);
            col.rgb = mix(col.rgb, mix(fogColor, sunColor, sun * 0.55), fog);
          }
          gl_FragColor = col;
        }`,
    });
    const quad = new T.FullScreenQuad(mat);
    pass.uniforms = mat.uniforms;
    pass.render = function (renderer, writeBuffer, readBuffer) {
      mat.uniforms.tDiffuse.value = readBuffer.texture;
      mat.uniforms.tDepth.value = readBuffer.depthTexture;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      quad.render(renderer);
    };
    pass.dispose = function () { mat.dispose(); quad.dispose(); };
    return pass;
  }

  const GradeShader = {
    uniforms: { tDiffuse: { value: null }, time: { value: 0 }, damage: { value: 0 }, fade: { value: 0 }, sat: { value: 1.08 }, vig: { value: 0.32 }, zoom: { value: 0 } },
    vertexShader: VS,
    fragmentShader: `
      varying vec2 vUv; uniform sampler2D tDiffuse; uniform float time, damage, fade, sat, vig, zoom;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 c = vUv - 0.5; float r2 = dot(c, c);
        vec2 ab = c * r2 * 0.012;
        vec3 col = vec3(texture2D(tDiffuse, vUv + ab).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - ab).b);
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(l), col, sat - damage * 0.5);
        col *= 1.0 - smoothstep(0.12, 0.85, r2 * (1.6 + zoom * 2.4)) * (vig + zoom * 0.5);
        col = mix(col, vec3(0.75, 0.03, 0.0) * (0.4 + l), smoothstep(0.08, 0.5, r2) * damage);
        col += (h(vUv * 800.0 + time) - 0.5) * 0.018;
        gl_FragColor = vec4(col * (1.0 - fade), 1.0);
      }`,
  };

  class Scene {
    constructor(canvas, opts) {
      const T = E.THREE; opts = opts || {};
      this.cv = canvas;
      this.renderer = new T.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
      this.renderer.outputColorSpace = T.SRGBColorSpace;
      this.renderer.toneMapping = T.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = T.PCFSoftShadowMap;
      this.renderer.info.autoReset = false;

      this.scene = new T.Scene();
      this.scene.background = new T.Color(0x05070c);
      this.camera = new T.PerspectiveCamera(60, 1, 0.4, 30000);
      this.camera.position.set(0, 60, 160);

      this.world = new T.Group(); this.units = new T.Group(); this.fx = new T.Group(); this.hud3d = new T.Group();
      this.scene.add(this.world, this.units, this.fx, this.hud3d);

      this.hemi = new T.HemisphereLight(0xbfd4ff, 0x30281c, 0.9);
      this.sun = new T.DirectionalLight(0xffffff, 3);
      this.sun.castShadow = true;
      this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.6;
      this.scene.add(this.hemi, this.sun, this.sun.target);
      this.sunDir = new T.Vector3(0.4, 0.6, -0.5).normalize();
      this.shadowExtent = 160;

      this.qualityName = opts.quality && opts.quality !== 'auto' ? opts.quality : 'high';
      this.auto = !opts.quality || opts.quality === 'auto';
      this.Q = QUALITY[this.qualityName];
      this.frameAvg = 16; this._gt = 0;
      this.buildComposer();
      this.applyQuality();
      this.resize();
    }

    buildComposer() {
      const T = E.THREE, Q = this.Q;
      if (this.composer) { this.composer.dispose(); this.rt.dispose(); }
      const rt = new T.WebGLRenderTarget(4, 4, { type: T.HalfFloatType, samples: Q.msaa, depthBuffer: true });
      rt.depthTexture = new T.DepthTexture(4, 4, T.UnsignedIntType);
      this.rt = rt;
      const c = new T.EffectComposer(this.renderer, rt);
      c.addPass(new T.RenderPass(this.scene, this.camera));
      this.atmo = atmospherePass(); c.addPass(this.atmo);
      this.bloom = new T.UnrealBloomPass(new T.Vector2(256, 256), 0.5, 0.55, 1.0); c.addPass(this.bloom);
      this.grade = new T.ShaderPass(GradeShader); c.addPass(this.grade);
      c.addPass(new T.OutputPass());
      this.composer = c;
      if (this._atmo) this.setAtmosphere(this._atmo);
    }

    applyQuality() {
      const Q = this.Q, r = this.renderer;
      this.bloom.enabled = Q.bloom;
      r.shadowMap.enabled = Q.shadows > 0; this.sun.castShadow = Q.shadows > 0;
      if (Q.shadows && this.sun.shadow.mapSize.x !== Q.shadows) { this.sun.shadow.mapSize.set(Q.shadows, Q.shadows); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
      this.scene.traverse(o => { if (o.material && o.isMesh) o.material.needsUpdate = true; });
    }
    setQuality(name) {
      this.auto = name === 'auto';
      if (this.auto) name = this.qualityName;
      const msaa = this.Q.msaa;
      this.qualityName = name; this.Q = QUALITY[name] || QUALITY.high;
      if (this.Q.msaa !== msaa) this.buildComposer();
      this.applyQuality(); this.resize();
    }

    // biome atmosphere: sun, ambient, fog
    setAtmosphere(a) {
      this._atmo = a;
      const u = this.atmo.uniforms;
      u.fogColor.value.copy(a.fogColor); u.sunColor.value.copy(a.sunColor); u.sunDir.value.copy(a.sunDir);
      u.density.value = a.density; u.heightK.value = a.heightK; u.base.value = a.base || 0;
      this.sunDir.copy(a.sunDir);
      this.sun.color.copy(a.sunColor); this.sun.intensity = a.sunI;
      this.hemi.color.copy(a.skyColor); this.hemi.groundColor.copy(a.groundColor); this.hemi.intensity = a.ambI;
      this.bloom.strength = a.bloom || 0.5;
    }
    setEnvironment(skyMesh) {
      const T = E.THREE;
      try {
        const pm = new T.PMREMGenerator(this.renderer), s = new T.Scene();
        const m = new T.Mesh(skyMesh.geometry, skyMesh.material); s.add(m);
        const env = pm.fromScene(s, 0, 1, 40000).texture;
        if (this.scene.environment) this.scene.environment.dispose();
        this.scene.environment = env; this.scene.environmentIntensity = 0.75;
        pm.dispose();
      } catch (e) { console.warn('env map failed', e); }
    }

    resize() {
      const W = window.innerWidth || 1280, H = window.innerHeight || 720;
      this.camera.aspect = W / H; this.camera.updateProjectionMatrix();
      const dpr = Math.min(this.Q.dpr, window.devicePixelRatio || 1) * (this.dprScale || 1);
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(W, H, false);
      this.composer.setPixelRatio(dpr);
      this.composer.setSize(W, H);
    }

    // keep the shadow frustum centred on what the player is looking at
    focusShadows(p, extent) {
      const s = this.sun, cam = s.shadow.camera, ex = extent || this.shadowExtent;
      if (cam.right !== ex) { cam.left = cam.bottom = -ex; cam.right = cam.top = ex; cam.near = 10; cam.far = 2400; cam.updateProjectionMatrix(); }
      const texel = (ex * 2) / (this.Q.shadows || 1024) * 4;
      const fx = Math.round(p.x / texel) * texel, fz = Math.round(p.z / texel) * texel, fy = Math.round(p.y / texel) * texel;
      s.target.position.set(fx, fy, fz);
      s.position.set(fx + this.sunDir.x * 1100, fy + this.sunDir.y * 1100, fz + this.sunDir.z * 1100);
      s.target.updateMatrixWorld();
    }

    // quality governor: step down before a visible stutter, probe back up
    gov(dtMs) {
      this.frameAvg = this.frameAvg * 0.95 + dtMs * 0.05;
      if (!this.auto) return;
      this._gt += dtMs; if (this._gt < 2500) return; this._gt = 0;
      const order = ['low', 'medium', 'high'], i = order.indexOf(this.qualityName);
      if (this.frameAvg > 24 && i > 0) { this._swap(order[i - 1]); this._up = 0; }
      else if (this.frameAvg < 13 && i < 2) { this._up = (this._up || 0) + 1; if (this._up >= 4 && !this._capped) { this._swap(order[i + 1]); this._up = 0; this._capped = (this._downs = (this._downs || 0) + 1) > 3; } }
    }
    _swap(name) { const msaa = this.Q.msaa; this.qualityName = name; this.Q = QUALITY[name]; if (this.Q.msaa !== msaa) this.buildComposer(); this.applyQuality(); this.resize(); this.frameAvg = 16; }

    render(t) {
      const u = this.atmo.uniforms, cam = this.camera;
      cam.updateMatrixWorld();
      u.invProj.value.copy(cam.projectionMatrixInverse); u.invView.value.copy(cam.matrixWorld); u.camPos.value.copy(cam.position);
      this.grade.uniforms.time.value = t % 100;
      this.renderer.info.reset();
      this.composer.render();
    }
    dispose() { this.composer.dispose(); this.renderer.dispose(); }
  }

  E.Scene = Scene;
  E.QUALITY = QUALITY;
})(window.E = window.E || {});
