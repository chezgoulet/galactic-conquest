// Visual effects: instanced energy bolts, two CPU particle systems (additive
// fire/sparks/glow and alpha-blended smoke/dust), shockwave rings, pooled
// explosion lights, strike markers and biome weather. Driven by
// world.projectiles and the sim's drained events. Browser-only.
(function (E) {
  'use strict';

  const TEAM_BOLT = { aegis: [1.0, 0.2, 0.06], verdant: [0.15, 1.0, 0.32] };
  const HOT = [1.0, 0.82, 0.5];

  function softTex(kind) {
    const T = E.THREE, c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    if (kind === 'smoke') { g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
    else { g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.75)'); g.addColorStop(0.6, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)'); }
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    if (kind === 'smoke') { // break up the disc so smoke reads as billows
      const id = x.getImageData(0, 0, 64, 64), d = id.data; let s = 7;
      for (let i = 0; i < d.length; i += 4) { s = (s * 16807) % 2147483647; const px = (i / 4) % 64, py = (i / 4 / 64) | 0; d[i + 3] *= 0.72 + 0.28 * Math.sin(px * 0.5 + (s % 7)) * Math.cos(py * 0.45); }
      x.putImageData(id, 0, 0);
    }
    const t = new T.CanvasTexture(c); t.colorSpace = T.NoColorSpace; return t;
  }
  function boltTex() {
    const T = E.THREE, c = document.createElement('canvas'); c.width = 16; c.height = 128;
    const x = c.getContext('2d'), id = x.createImageData(16, 128), d = id.data;
    for (let y = 0; y < 128; y++) for (let px = 0; px < 16; px++) {
      const u = (px + 0.5) / 16 * 2 - 1, v = 1 - (y + 0.5) / 128;                 // v: 0 tail .. 1 head
      const w = Math.exp(-u * u * 5.5), l = Math.pow(Math.sin(Math.min(1, v * 1.02) * Math.PI), 0.6) * (0.35 + 0.65 * v);
      const core = Math.exp(-u * u * 40) * l, a = w * l, i = (y * 16 + px) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.min(255, (a * 0.75 + core * 1.2) * 255); d[i + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    const t = new T.CanvasTexture(c); t.colorSpace = T.NoColorSpace; return t;
  }

  class Particles {
    constructor(scene, n, additive, tex) {
      const T = E.THREE;
      this.n = n; this.i = 0; this.live = 0;
      this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.c = new Float32Array(n * 4); this.s = new Float32Array(n);
      this.life = new Float32Array(n); this.max = new Float32Array(n); this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
      this.c0 = new Float32Array(n * 4); this.drag = new Float32Array(n); this.grav = new Float32Array(n);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(this.p, 3).setUsage(T.DynamicDrawUsage));
      g.setAttribute('aColor', new T.BufferAttribute(this.c, 4).setUsage(T.DynamicDrawUsage));
      g.setAttribute('aSize', new T.BufferAttribute(this.s, 1).setUsage(T.DynamicDrawUsage));
      this.mat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending,
        uniforms: { map: { value: tex }, uScale: { value: 600 } },
        vertexShader: 'attribute vec4 aColor; attribute float aSize; varying vec4 vC; uniform float uScale; void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = min(aSize * uScale / max(-mv.z, 0.1), 900.0); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'varying vec4 vC; uniform sampler2D map; void main(){ float a = texture2D(map, gl_PointCoord).r; gl_FragColor = vec4(vC.rgb' + (additive ? ' * a * vC.a, 1.0' : ', a * vC.a') + '); }',
      });
      this.pts = new T.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = additive ? 6 : 5;
      this.geo = g; scene.fx.add(this.pts);
    }
    emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, drag, grav) {
      const i = this.i; this.i = (i + 1) % this.n;
      this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z; this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
      this.life[i] = this.max[i] = life; this.s0[i] = s0; this.s1[i] = s1;
      this.c0[i * 4] = r; this.c0[i * 4 + 1] = g; this.c0[i * 4 + 2] = b; this.c0[i * 4 + 3] = a;
      this.drag[i] = drag || 0; this.grav[i] = grav || 0;
    }
    update(dt) {
      const n = this.n, p = this.p, v = this.v, c = this.c, c0 = this.c0;
      for (let i = 0; i < n; i++) {
        let l = this.life[i];
        if (l <= 0) { if (this.s[i] !== 0) this.s[i] = 0; continue; }
        l -= dt; this.life[i] = l;
        if (l <= 0) { this.s[i] = 0; continue; }
        const k = 1 - l / this.max[i], j = i * 3, q = i * 4, dr = Math.max(0, 1 - this.drag[i] * dt);
        v[j] *= dr; v[j + 1] = v[j + 1] * dr - this.grav[i] * dt; v[j + 2] *= dr;
        p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
        this.s[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(k);
        const fade = k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88;
        c[q] = c0[q]; c[q + 1] = c0[q + 1] * (1 - k * 0.45); c[q + 2] = c0[q + 2] * (1 - k * 0.8); c[q + 3] = c0[q + 3] * fade;
      }
      this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aColor.needsUpdate = true; this.geo.attributes.aSize.needsUpdate = true;
    }
  }

  const WEATHER = {
    snow:   { n: 2600, col: [1, 1, 1], size: 0.16, fall: 3.5, wind: 5, a: 0.9, stretch: 0 },
    dust:   { n: 1200, col: [0.95, 0.8, 0.58], size: 0.2, fall: 0.2, wind: 16, a: 0.35, stretch: 0 },
    rain:   { n: 3600, col: [0.75, 0.86, 1], size: 0.12, fall: 42, wind: 8, a: 0.55, stretch: 1 },
    ash:    { n: 1500, col: [0.5, 0.48, 0.47], size: 0.18, fall: 1.2, wind: 4, a: 0.75, stretch: 0 },
    embers: { n: 1400, col: [5, 1.6, 0.3], size: 0.13, fall: -2.4, wind: 6, a: 1, stretch: 0, add: 1 },
    bands:  { n: 1400, col: [2.2, 1.0, 3.0], size: 0.15, fall: -0.6, wind: 14, a: 0.8, stretch: 0, add: 1 },
  };

  class FX {
    constructor(scene, quality) {
      const T = E.THREE;
      this.scene = scene; this.q = quality || 1;
      this.rng = E.RNG(12345);
      this.add = new Particles(scene, Math.round(5000 * this.q), true, softTex('glow'));
      this.smoke = new Particles(scene, Math.round(2600 * this.q), false, softTex('smoke'));
      this.dustCol = [0.6, 0.5, 0.4]; this.onShake = null;
      // bolts
      const a = new T.PlaneGeometry(1, 1).rotateX(Math.PI / 2), b = new T.PlaneGeometry(1, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
      const bg = T.mergeGeometries([a, b]);
      this.boltN = 1400;
      this.bolts = new T.InstancedMesh(bg, new T.MeshBasicMaterial({ map: boltTex(), transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false }), this.boltN);
      this.bolts.frustumCulled = false; this.bolts.count = 0; this.bolts.renderOrder = 7;
      this.bolts.setColorAt(0, new T.Color(1, 1, 1));
      scene.fx.add(this.bolts);
      // solid ordnance (grenades, bombs)
      this.shells = new T.InstancedMesh(new T.IcosahedronGeometry(1, 0), new T.MeshStandardMaterial({ color: 0x15171c, roughness: 0.5, metalness: 0.7, emissive: 0xff5a1a, emissiveIntensity: 0.6 }), 128);
      this.shells.frustumCulled = false; this.shells.count = 0; scene.fx.add(this.shells);
      // shockwave rings + markers
      this.rings = []; this.ringPool = [];
      this.ringGeo = new T.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);
      // explosion lights
      this.lights = [];
      for (let i = 0; i < 4; i++) { const l = new T.PointLight(0xffa050, 0, 120, 1.6); l.userData.t = 0; scene.fx.add(l); this.lights.push(l); }
      this.emitters = []; this.weather = null;
      this._m = new T.Matrix4(); this._q = new T.Quaternion(); this._v = new T.Vector3(); this._s = new T.Vector3(); this._z = new T.Vector3(0, 0, 1); this._c = new T.Color();
    }

    setBiome(biome, terrain) {
      const T = E.THREE, c = biome.palette.low;
      this.dustCol = [c[0] / 255 * 0.9, c[1] / 255 * 0.9, c[2] / 255 * 0.9]; this.terrain = terrain;
      if (this.weather) { this.scene.fx.remove(this.weather); this.weather.geometry.dispose(); this.weather = null; }
      const W = WEATHER[(biome.weather || {}).kind]; if (!W) return;
      const n = Math.round(W.n * this.q * (biome.weather.density || 0.5) * 1.4), pos = new Float32Array(n * 3), r = E.RNG(99);
      for (let i = 0; i < n * 3; i++) pos[i] = r.next();
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
      const m = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: W.add ? T.AdditiveBlending : T.NormalBlending,
        uniforms: { time: { value: 0 }, cam: { value: new T.Vector3() }, col: { value: new T.Vector3(W.col[0], W.col[1], W.col[2]) }, size: { value: W.size }, fall: { value: W.fall }, wind: { value: W.wind }, alpha: { value: W.a }, uScale: { value: 600 }, stretch: { value: W.stretch } },
        vertexShader: `uniform float time, size, fall, wind, uScale, stretch; uniform vec3 cam; varying float vA;
          void main(){ vec3 B = vec3(90.0, 60.0, 90.0);
            vec3 p = position * B; p.y -= time * fall; p.x += time * wind + sin(time * 0.7 + position.z * 40.0) * 1.5; p.z += time * wind * 0.4;
            p = mod(p - cam, B) - B * 0.5 + cam;
            vec4 mv = modelViewMatrix * vec4(p, 1.0); float d = max(-mv.z, 0.1);
            vA = smoothstep(45.0, 28.0, length(p - cam)) * smoothstep(0.6, 3.0, d);
            gl_PointSize = min(size * (1.0 + stretch * 5.0) * uScale / d, 64.0); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 col; uniform float alpha, stretch; varying float vA;
          void main(){ vec2 c = gl_PointCoord - 0.5; float a = stretch > 0.5 ? smoothstep(0.09, 0.0, abs(c.x + c.y * 0.12)) * smoothstep(0.5, 0.2, abs(c.y)) : smoothstep(0.5, 0.1, length(c));
            gl_FragColor = vec4(col, a * alpha * vA); }`,
      });
      this.weather = new T.Points(g, m); this.weather.frustumCulled = false; this.weather.renderOrder = 8;
      this.scene.fx.add(this.weather);
    }

    // ── primitives ───────────────────────────────────────────
    spark(p, n, col, speed, life, size) {
      const r = this.rng;
      for (let i = 0; i < n; i++) {
        const a = r.angle(), e = Math.acos(r.f(-0.2, 1)), s = speed * r.f(0.4, 1);
        this.add.emit(p.x, p.y, p.z, Math.sin(e) * Math.cos(a) * s, Math.cos(e) * s, Math.sin(e) * Math.sin(a) * s, life * r.f(0.5, 1), size, size * 0.3, col[0] * 3.2, col[1] * 3.2, col[2] * 3.2, 1, 1.2, 14);
      }
    }
    puff(p, n, col, size, life, rise, spread) {
      const r = this.rng;
      for (let i = 0; i < n; i++) {
        const a = r.angle(), s = (spread || size) * r.f(0.2, 1), k = r.f(0.75, 1.1);
        this.smoke.emit(p.x + Math.cos(a) * s * 0.3, p.y + r.f(0, size * 0.3), p.z + Math.sin(a) * s * 0.3, Math.cos(a) * s * 0.8, (rise || 1.5) * r.f(0.5, 1.4), Math.sin(a) * s * 0.8,
          life * r.f(0.6, 1.2), size * 0.5, size * r.f(1.6, 2.6), col[0] * k, col[1] * k, col[2] * k, r.f(0.35, 0.6), 1.4, -0.3);
      }
    }
    flash(p, size, col, life) { this.add.emit(p.x, p.y, p.z, 0, 0, 0, life || 0.12, size, size * 1.5, col[0] * 3, col[1] * 3, col[2] * 3, 1, 0, 0); }
    ring(p, r1, col, life, flat) {
      const T = E.THREE;
      let m = this.ringPool.pop();
      if (!m) { m = new T.Mesh(this.ringGeo, new T.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false })); m.renderOrder = 6; this.scene.fx.add(m); }
      m.visible = true; m.position.set(p.x, p.y + 0.3, p.z); m.material.color.setRGB(col[0] * 2, col[1] * 2, col[2] * 2);
      this.rings.push({ m, t: 0, life: life || 0.5, r1, flat: !!flat });
    }
    light(p, col, power, dist) {
      let best = this.lights[0];
      for (const l of this.lights) if (l.userData.t < best.userData.t) best = l;
      best.position.set(p.x, p.y + 2, p.z); best.color.setRGB(col[0], col[1], col[2]); best.intensity = power; best.distance = dist; best.userData.t = 1; best.userData.p = power;
    }
    explosion(p, size, col) {
      const r = this.rng, c = col || HOT, k = Math.min(3, 0.6 + size / 9);
      this.flash(p, size * 3.2, [1, 0.9, 0.7], 0.14);
      const nf = Math.round(7 * k * this.q) + 3;
      for (let i = 0; i < nf; i++) {
        const a = r.angle(), e = Math.acos(r.f(-0.1, 1)), s = size * r.f(0.6, 2.2);
        this.add.emit(p.x, p.y + size * 0.15, p.z, Math.sin(e) * Math.cos(a) * s, Math.cos(e) * s * 0.9 + size * 0.3, Math.sin(e) * Math.sin(a) * s, r.f(0.35, 0.85), size * 0.5, size * r.f(1.1, 1.9), c[0] * 2.6, c[1] * 1.5, c[2] * 0.7, 1, 2.2, -1);
      }
      this.spark(p, Math.round(9 * k * this.q), [1, 0.7, 0.35], size * 4.5, 1.1, Math.max(0.25, size * 0.05));
      this.puff({ x: p.x, y: p.y + size * 0.2, z: p.z }, Math.round(6 * k * this.q) + 2, [0.13, 0.12, 0.12], size * 0.95, 2.8, size * 0.35 + 1.5, size * 1.4);
      this.ring(p, size * 2.6, [1, 0.75, 0.45], 0.45);
      this.light(p, [1, 0.6, 0.3], 40 * size, size * 9 + 30);
      if (this.onShake) this.onShake(p, size);
    }
    dustHit(p, size) { this.puff(p, 3, this.dustCol, size, 1.1, 1.2, size * 1.5); }
    emitter(o) { this.emitters.push(Object.assign({ t: 0, acc: 0 }, o)); }

    // ── sim events ───────────────────────────────────────────
    applyEvents(events, world) {
      const cam = this.scene.camera.position;
      for (const e of events) {
        if (e.type === 'fire') {
          const W = E.WEAPONS[e.wk] || {}, c = TEAM_BOLT[e.team] || HOT, sc = W.scale || 1;
          if (E.distXZ2(cam, e.pos) > 900 * 900 && sc < 2) continue;
          if (W.kind === 'bolt' || W.kind === 'turbo') this.flash(e.pos, 1.3 * sc, c, 0.07);
          else if (W.kind === 'shell' || W.kind === 'rocket' || W.kind === 'missile') { this.flash(e.pos, 3.2 * sc, HOT, 0.1); this.puff(e.pos, 3, [0.5, 0.5, 0.5], 1.2 * sc, 0.9, 0.6, 2); }
        } else if (e.type === 'impact') {
          const W = E.WEAPONS[e.wk] || {}, c = TEAM_BOLT[e.team] || HOT;
          if (e.splash > 0) {
            if (e.surf === 'water') { this.puff(e.pos, 8, [0.85, 0.92, 1], e.splash * 0.7, 1.6, e.splash * 0.9, e.splash); this.ring(e.pos, e.splash * 1.6, [0.6, 0.8, 1], 0.7, true); }
            else this.explosion(e.pos, e.splash, e.wk === 'orbital' || W.kind === 'turbo' ? c : null);
            if (e.surf === 'ground') this.puff(e.pos, 5, this.dustCol, e.splash * 0.8, 2.2, 2.5, e.splash * 1.6);
          } else if (e.surf === 'shield') { const sc = E.faction(e.team === 'aegis' ? 'verdant' : 'aegis').palette.shield; this.flash(e.pos, e.big ? 16 : 3.2, [sc[0] / 255, sc[1] / 255, sc[2] / 255], 0.22); this.spark(e.pos, 2, [0.5, 0.8, 1], 6, 0.3, 0.14); }
          else if (e.surf === 'unit') { this.spark(e.pos, e.big ? 6 : 4, c, e.big ? 26 : 9, 0.4, e.big ? 0.5 : 0.14); this.flash(e.pos, e.big ? 9 : 1.6, c, 0.1); }
          else if (e.surf === 'water') this.puff(e.pos, 2, [0.85, 0.92, 1], 0.6, 0.6, 2.5, 0.6);
          else { this.dustHit(e.pos, 0.7); this.spark(e.pos, 2, c, 5, 0.25, 0.12); }
        } else if (e.type === 'death') {
          const F = E.faction(e.team).palette.engine, c = [F[0] / 255, F[1] / 255, F[2] / 255];
          if (e.kind === 'infantry') { this.spark(e.pos, 5, HOT, 5, 0.4, 0.12); this.puff({ x: e.pos.x, y: e.pos.y + 1, z: e.pos.z }, 2, [0.2, 0.2, 0.2], 0.9, 1.2, 1); }
          else if (e.kind === 'capital') { /* the renderer stages the breakup */ }
          else {
            this.explosion({ x: e.pos.x, y: e.pos.y + 1, z: e.pos.z }, e.kind === 'vehicle' ? 9 : 7);
            if (e.kind !== 'fighter') this.emitter({ pos: { x: e.pos.x, y: e.pos.y + 1.2, z: e.pos.z }, life: 10, rate: 7, kind: 'burn' });
            else this.emitter({ pos: E.V3.clone(e.pos), vel: { x: e.vel.x * 0.6, y: e.vel.y * 0.6, z: e.vel.z * 0.6 }, life: 3.5, rate: 26, kind: 'debris', grav: 16 });
          }
        } else if (e.type === 'capture') { const c = TEAM_BOLT[e.team]; this.ring(e.pos, 46, c, 1.2, true); this.spark({ x: e.pos.x, y: e.pos.y + 4, z: e.pos.z }, 30, c, 22, 1.6, 0.3); this.light(e.pos, c, 300, 90); }
        else if (e.type === 'heal') { this.ring(e.pos, e.r, [0.3, 1, 0.6], 0.8, true); for (let i = 0; i < 10; i++) this.add.emit(e.pos.x + this.rng.f(-4, 4), e.pos.y + 0.4, e.pos.z + this.rng.f(-4, 4), 0, this.rng.f(2, 5), 0, 1.1, 0.3, 0.1, 0.6, 3, 1.4, 1, 0.5, 0); }
        else if (e.type === 'strikeWarn') this.rings.push({ m: this._marker(e.pos, e.r), t: 0, life: 6.2, r1: e.r, flat: true, marker: true });
        else if (e.type === 'launch') this.flash(e.pos, 14, HOT, 0.4);
      }
    }
    _marker(p, r) {
      const T = E.THREE, m = new T.Mesh(this.ringGeo, new T.MeshBasicMaterial({ color: new T.Color(3, 0.25, 0.1), transparent: true, depthWrite: false, depthTest: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false }));
      m.position.set(p.x, (this.terrain ? this.terrain.height(p.x, p.z) : p.y) + 0.6, p.z); m.scale.setScalar(r); m.renderOrder = 6; this.scene.fx.add(m);
      return m;
    }

    // projectiles -> instanced bolts / shells, plus exhaust trails
    syncProjectiles(list, dt) {
      const T = E.THREE, m = this._m, q = this._q, v = this._v, s = this._s, col = this._c;
      let nb = 0, ns = 0;
      for (let i = 0; i < list.length; i++) {
        const p = list[i], sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z) || 1;
        const k = p.kind, c = TEAM_BOLT[p.team] || HOT;
        if (k === 'grenade' || k === 'bomb') {
          if (ns < 128) { const r = k === 'bomb' ? 0.7 : 0.22; m.makeScale(r, r, r); m.setPosition(p.pos.x, p.pos.y, p.pos.z); this.shells.setMatrixAt(ns++, m); }
          if (k === 'bomb') this.add.emit(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, 0.25, 1.4, 0.3, c[0] * 2, c[1] * 2, c[2] * 2, 1, 0, 0);
          continue;
        }
        if (nb >= this.boltN) continue;
        let len, wid, r = c[0], g = c[1], b = c[2], I = 5;
        const sc = p.scale || 1;
        if (k === 'bolt' || k === 'turbo') { len = E.clamp(sp * 0.032, 2.5, 26) * (0.6 + sc * 0.5); wid = 0.34 * sc; }
        else if (k === 'shell') { len = 5; wid = 0.5; r = 1; g = 0.8; b = 0.5; I = 4; }
        else { len = 3.2 * sc; wid = 0.55 * sc; r = 1; g = 0.7; b = 0.3; I = 6;
          this.smoke.emit(p.pos.x, p.pos.y, p.pos.z, this.rng.f(-0.5, 0.5), this.rng.f(0, 0.8), this.rng.f(-0.5, 0.5), 1.3, 0.5 * sc, 2.2 * sc, 0.75, 0.75, 0.78, 0.4, 0.8, -0.2);
          this.add.emit(p.pos.x, p.pos.y, p.pos.z, 0, 0, 0, 0.12, 1.6 * sc, 0.4, 3, 1.6, 0.5, 1, 0, 0); }
        v.set(p.vel.x / sp, p.vel.y / sp, p.vel.z / sp); q.setFromUnitVectors(this._z, v);
        s.set(wid, wid, len);
        m.compose(v.set(p.pos.x - p.vel.x / sp * len * 0.4, p.pos.y - p.vel.y / sp * len * 0.4, p.pos.z - p.vel.z / sp * len * 0.4), q, s);
        this.bolts.setMatrixAt(nb, m); this.bolts.setColorAt(nb, col.setRGB(r * I + 0.6, g * I + 0.6, b * I + 0.6)); nb++;
      }
      this.bolts.count = nb; this.shells.count = ns;
      if (nb) { this.bolts.instanceMatrix.needsUpdate = true; this.bolts.instanceColor.needsUpdate = true; }
      if (ns) this.shells.instanceMatrix.needsUpdate = true;
    }

    update(dt, t, cam) {
      const sc = this.scene.renderer.domElement.height / (2 * Math.tan(cam.fov * Math.PI / 360));
      this.add.mat.uniforms.uScale.value = sc; this.smoke.mat.uniforms.uScale.value = sc;
      // continuous emitters (burning wrecks, falling debris)
      for (let i = this.emitters.length - 1; i >= 0; i--) {
        const e = this.emitters[i]; e.t += dt; e.acc += dt * e.rate;
        if (e.vel) { e.vel.y -= (e.grav || 0) * dt; e.pos.x += e.vel.x * dt; e.pos.y += e.vel.y * dt; e.pos.z += e.vel.z * dt; if (this.terrain && e.pos.y < this.terrain.height(e.pos.x, e.pos.z)) { this.explosion(e.pos, 6); e.t = e.life; } }
        const k = 1 - e.t / e.life, r = this.rng, s = e.size || 1;
        while (e.acc >= 1) { e.acc -= 1;
          this.smoke.emit(e.pos.x + r.f(-s, s), e.pos.y, e.pos.z + r.f(-s, s), r.f(-1, 1), r.f(3, 6) * s, r.f(-1, 1), 2.6, 1.2 * s, 5.5 * s, 0.1, 0.1, 0.1, 0.5 * k + 0.1, 0.5, -0.8);
          if (r.next() < 0.7 * k) this.add.emit(e.pos.x + r.f(-s, s), e.pos.y, e.pos.z + r.f(-s, s), r.f(-1, 1), r.f(2, 5), r.f(-1, 1), 0.55, 1.3 * s, 2.6 * s, 3, 1.4, 0.4, 0.9, 1, -2);
        }
        if (e.t >= e.life) this.emitters.splice(i, 1);
      }
      this.add.update(dt); this.smoke.update(dt);
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i]; r.t += dt; const k = r.t / r.life;
        if (k >= 1) { if (r.marker) { this.scene.fx.remove(r.m); r.m.material.dispose(); } else { r.m.visible = false; this.ringPool.push(r.m); } this.rings.splice(i, 1); continue; }
        if (r.marker) { r.m.material.opacity = 0.5 + 0.5 * Math.sin(r.t * 14); r.m.rotation.y = r.t; }
        else { const s = r.r1 * (0.15 + 0.85 * (1 - (1 - k) * (1 - k))); r.m.scale.setScalar(s); r.m.material.opacity = (1 - k) * 0.85; }
      }
      for (const l of this.lights) if (l.userData.t > 0) { l.userData.t -= dt * 3.2; l.intensity = Math.max(0, l.userData.t) * l.userData.p; }
      if (this.weather) { const u = this.weather.material.uniforms; u.time.value = t; u.cam.value.copy(cam.position); u.uScale.value = sc; }
    }
  }

  E.FX = FX;
  E.TEAM_BOLT = TEAM_BOLT;
})(window.E = window.E || {});
