// Material factory + TSL helper library. This is the ONE place materials are
// built: no other file may construct a THREE material by hand. Everything here
// is a TSL node material (WebGPU renderer, with its WebGL2 fallback backend),
// so the same code path serves both backends.
//
//   E.Mat.pbr({...})       MeshStandard/Physical node material (PBR, lit, shadowed, IBL)
//   E.Mat.emissive({...})  unlit HDR colour (glows, beams, rings, bolts) - feeds bloom
//   E.Mat.particle({...})  camera-facing billboard material for instanced particles
//   E.Mat.terrain(biome)   procedural ground
//   E.Mat.water(biome)     procedural water surface
//   E.Mat.hull()           shared panelled hull material (vertex colour + aFx attribute)
//   E.TSLN                 noise / hash / fbm node functions for building more procedural materials
//   E.Mat.U                shared global uniforms (time, sun, camera altitude, space factor)
// Browser-only.
(function (E) {
  'use strict';

  // ── TSL noise library (built lazily: THREE.TSL exists only after the vendor bundle loads) ──
  let LIB = null;
  function lib() {
    if (LIB) return LIB;
    const { Fn, float, vec2, vec3, mix, dot, floor, fract, sin, abs, sub } = E.THREE.TSL;
    const hash21 = Fn(([p_]) => {
      const p = fract(p_.mul(vec2(123.34, 456.21))).toVar();
      p.addAssign(dot(p, p.add(45.32)));
      return fract(p.x.mul(p.y));
    });
    const hash31 = Fn(([p]) => fract(sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453)));
    const noise2 = Fn(([p]) => {
      const i = floor(p), f = fract(p);
      const u = f.mul(f).mul(f.mul(-2).add(3));
      const a = hash21(i), b = hash21(i.add(vec2(1, 0))), c = hash21(i.add(vec2(0, 1))), d = hash21(i.add(vec2(1, 1)));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    });
    const octaves = (n) => Fn(([p_]) => {
      const p = p_.toVar(), s = float(0).toVar();
      let a = 0.5;
      for (let i = 0; i < n; i++) { s.addAssign(noise2(p).mul(a)); p.assign(p.mul(2.03).add(17.1)); a *= 0.5; }
      return s;
    });
    const noise3 = Fn(([p]) => {
      const i = floor(p), f = fract(p);
      const u = f.mul(f).mul(f.mul(-2).add(3));
      const h = (x, y, z) => hash31(i.add(vec3(x, y, z)));
      return mix(mix(mix(h(0, 0, 0), h(1, 0, 0), u.x), mix(h(0, 1, 0), h(1, 1, 0), u.x), u.y),
        mix(mix(h(0, 0, 1), h(1, 0, 1), u.x), mix(h(0, 1, 1), h(1, 1, 1), u.x), u.y), u.z);
    });
    LIB = { hash21, hash31, noise2, noise3, fbm5: octaves(5), fbm3: octaves(3), fbm4: octaves(4) };
    return LIB;
  }
  Object.defineProperty(E, 'TSLN', { get: lib, configurable: true });

  // ── shared uniforms: updated once per frame by E.Scene, readable by any node material ──
  let U = null;
  function uniforms() {
    if (U) return U;
    const { uniform } = E.THREE.TSL, T = E.THREE;
    U = {
      time: uniform(0),
      sunDir: uniform(new T.Vector3(0.4, 0.6, -0.5)),
      sunColor: uniform(new T.Color(1, 0.9, 0.7)),
      camPos: uniform(new T.Vector3()),
      altitude: uniform(0),           // camera height above the surface, metres
      space: uniform(0),              // 0 = full atmosphere .. 1 = vacuum (altitude + airless biomes)
      airless: uniform(0),            // 1 on worlds with no atmosphere at all
    };
    return U;
  }

  const color = (c) => {
    const T = E.THREE;
    if (c && c.isColor) return c;
    if (Array.isArray(c)) return new T.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, T.SRGBColorSpace);
    return new T.Color(c === undefined ? 0xffffff : c);
  };

  // materials that asked for a custom env intensity, refreshed when the sky environment changes
  const envUsers = new Set();
  let envTex = null;
  function setEnv(tex) {
    envTex = tex;
    for (const m of envUsers) { m.envMap = tex; m.needsUpdate = true; }
  }

  const SIDES = { front: 0, back: 1, double: 2 };

  // PBR surface. Options: color, map, roughness, metalness, emissive, emissiveIntensity, envIntensity,
  // opacity, transparent, side ('front'|'back'|'double'), flatShading, vertexColors,
  // clearcoat/clearcoatRoughness/sheen/iridescence/transmission/ior (=> MeshPhysical),
  // and node overrides: colorNode, roughnessNode, metalnessNode, emissiveNode, normalNode,
  // opacityNode, positionNode, aoNode.
  function pbr(o) {
    const T = E.THREE; o = o || {};
    const phys = o.clearcoat !== undefined || o.sheen !== undefined || o.iridescence !== undefined || o.transmission !== undefined || o.ior !== undefined;
    const m = new (phys ? T.MeshPhysicalNodeMaterial : T.MeshStandardNodeMaterial)();
    m.color = color(o.color);
    m.roughness = o.roughness === undefined ? 0.7 : o.roughness;
    m.metalness = o.metalness === undefined ? 0 : o.metalness;
    if (o.map) m.map = o.map;
    if (o.emissive !== undefined) { m.emissive = color(o.emissive); m.emissiveIntensity = o.emissiveIntensity === undefined ? 1 : o.emissiveIntensity; }
    if (o.opacity !== undefined) m.opacity = o.opacity;
    if (o.transparent) { m.transparent = true; m.depthWrite = o.depthWrite === true; }
    if (o.side) m.side = SIDES[o.side] || 0;
    if (o.flatShading) m.flatShading = true;
    if (o.vertexColors) m.vertexColors = true;
    if (phys) for (const k of ['clearcoat', 'clearcoatRoughness', 'sheen', 'sheenRoughness', 'iridescence', 'transmission', 'ior', 'thickness']) if (o[k] !== undefined) m[k] = o[k];
    for (const k of ['colorNode', 'roughnessNode', 'metalnessNode', 'emissiveNode', 'normalNode', 'opacityNode', 'positionNode', 'aoNode']) if (o[k]) m[k] = o[k];
    if (o.envIntensity !== undefined) { m.envMapIntensity = o.envIntensity; m.envMap = envTex; envUsers.add(m); }
    if (o.name) m.name = o.name;
    return m;
  }

  // Unlit HDR colour. `intensity` > 1 is what bloom picks up. Options: color, intensity, map, opacity,
  // additive, transparent, side, depthTest, depthWrite, colorNode, opacityNode, positionNode.
  function emissive(o) {
    const T = E.THREE; o = o || {};
    const m = new T.MeshBasicNodeMaterial();
    m.color = color(o.color);
    if (o.intensity !== undefined && o.intensity !== 1) m.color.multiplyScalar(o.intensity);
    if (o.map) m.map = o.map;
    if (o.additive) { m.blending = T.AdditiveBlending; m.transparent = true; m.depthWrite = false; }
    if (o.transparent) { m.transparent = true; m.depthWrite = o.depthWrite === true; }
    if (o.opacity !== undefined) m.opacity = o.opacity;
    if (o.side) m.side = SIDES[o.side] || 0;
    if (o.depthTest === false) m.depthTest = false;
    if (o.depthWrite !== undefined) m.depthWrite = o.depthWrite;
    for (const k of ['colorNode', 'opacityNode', 'positionNode']) if (o[k]) m[k] = o[k];
    m.fog = false;
    if (o.name) m.name = o.name;
    return m;
  }

  // Billboard material for instanced particles: the geometry carries per-instance attributes
  // aPos (vec3 centre), aSize (float, metres) and aColor (vec4, rgb HDR + alpha).
  // `tex` is a greyscale mask. Options: additive.
  function particle(o) {
    const T = E.THREE, X = T.TSL; o = o || {};
    const m = new T.SpriteNodeMaterial();
    const aPos = X.attribute('aPos', 'vec3'), aSize = X.attribute('aSize', 'float'), aCol = X.attribute('aColor', 'vec4');
    m.positionNode = aPos;
    m.scaleNode = aSize;
    const a = X.texture(o.tex, X.uv()).r;
    m.colorNode = X.vec4(aCol.rgb.mul(o.additive ? a.mul(aCol.a) : 1), o.additive ? 1 : a.mul(aCol.a));
    m.transparent = true; m.depthWrite = false; m.fog = false;
    m.blending = o.additive ? T.AdditiveBlending : T.NormalBlending;
    m.sizeAttenuation = true;
    return m;
  }

  // ── hull: PBR + vertex colour + procedural panel lines, lit windows and HDR emissive ──
  let hullMat = null;
  function hull() {
    if (hullMat) return hullMat;
    const X = E.THREE.TSL, N = lib();
    const { vec3, float, floor, fract, abs, max, smoothstep, step, attribute, positionGeometry, vertexColor, clamp, mix } = X;
    const fx = attribute('aFx', 'vec2');
    const mode = floor(fx.y.add(0.5));
    const hash3 = (p) => N.hash31(p);
    const fq = mix(float(2.6), float(0.16), step(1.5, mode));
    const pc = positionGeometry.mul(fq);
    const pn = hash3(floor(pc)).toVar('gcPn');
    const fr = abs(fract(pc).sub(0.5));
    const seam = smoothstep(0.455, 0.5, max(fr.x, max(fr.y, fr.z)));
    const panels = step(0.5, mode);
    const shade = mix(float(1), pn.mul(0.3).add(0.84).mul(float(1).sub(seam.mul(0.3))), panels);
    // lit windows on mode 3 surfaces
    const wc = positionGeometry.mul(vec3(0.55, 0.9, 0.3));
    const wf = abs(fract(wc).sub(0.5));
    const lit = step(0.63, hash3(floor(wc).add(7.0)));
    const win = lit.mul(step(wf.y, 0.16)).mul(step(max(wf.x, wf.z), 0.3)).mul(step(2.5, mode));
    const m = pbr({
      metalness: 0.62, roughness: 0.5, name: 'hull',
      colorNode: vertexColor(0).mul(shade),
      roughnessNode: clamp(float(0.5).add(pn.sub(0.5).mul(0.3).mul(panels)), 0.08, 1.0),
      emissiveNode: vertexColor(0).mul(fx.x).add(vec3(1.0, 0.86, 0.6).mul(win).mul(1.8)),
    });
    hullMat = m;
    return m;
  }

  // ── terrain ──
  const LOOK = {};   // filled by planet.js (per-biome ground look), kept there with the geometry code
  function terrain(biomeId, look) {
    const X = E.THREE.TSL, N = lib(), T = E.THREE, L = look;
    const { vec3, float, vec2, uniform, positionWorld, normalWorld, vertexColor, smoothstep, normalize, mix, sin, cameraViewMatrix, vec4, normalView, abs, max } = X;
    const U = uniforms();
    const uRock = uniform(new T.Color(L.rock)), uTint = uniform(new T.Vector3(L.tint[0], L.tint[1], L.tint[2])), uLava = uniform(new T.Color(L.lava || '#000000'));
    const uTime = U.time, uLavaLevel = float(L.lava ? L.lavaLevel : -1e6), uRockAt = float(L.rockAt), uBump = float(L.bump);
    const gwp = positionWorld.xz;
    const gn1 = N.fbm5(gwp.mul(0.31)), gn2 = N.fbm3(gwp.mul(0.045).add(31.0)), gn3 = N.noise2(gwp.mul(2.7));
    const steep = float(1).sub(normalize(normalWorld).y);
    const rockK = smoothstep(uRockAt, uRockAt.add(0.2), steep.add(gn2.sub(0.5).mul(0.22))).toVar();
    const base0 = vertexColor(0).mul(gn1.mul(0.42).add(0.7).add(gn3.mul(0.14)));
    const base = mix(base0, base0.mul(uTint), smoothstep(0.42, 0.68, gn2));
    const rockC = uRock.mul(N.fbm5(vec2(gwp.x.mul(0.4).add(positionWorld.y.mul(0.8)), gwp.y.mul(0.4).sub(positionWorld.y.mul(0.6)))).mul(0.7).add(0.55));
    const colorNode = mix(base, rockC, rockK);
    // per-pixel bump from finite differences of the same noise
    const ge = 0.4, b0 = N.fbm3(gwp.mul(0.8)), bx = N.fbm3(gwp.add(vec2(ge, 0)).mul(0.8)), bz = N.fbm3(gwp.add(vec2(0, ge)).mul(0.8));
    const off = vec3(b0.sub(bx), 0, b0.sub(bz)).mul(uBump).mul(rockK.add(1));
    const normalNode = normalize(normalView.add(cameraViewMatrix.mul(vec4(off, 0)).xyz));
    // lava cracks
    const lv = smoothstep(uLavaLevel.add(5.0), uLavaLevel.sub(3.0), positionWorld.y);
    const cr = N.fbm5(gwp.mul(0.07).add(vec2(uTime.mul(0.012), 0)));
    const crack = smoothstep(0.1, 0.0, abs(cr.sub(0.5))).add(lv.mul(smoothstep(0.45, 0.62, cr)));
    const emissiveNode = uLava.mul(lv).mul(crack).mul(sin(uTime.mul(1.7).add(cr.mul(30))).mul(0.8).add(2.2));
    return pbr({ name: 'terrain:' + biomeId, roughness: L.rough, metalness: 0, colorNode, normalNode, emissiveNode });
  }

  // ── water: PBR with procedural wave normals; reflects the sky through the environment map + SSR ──
  function water(biome) {
    const X = E.THREE.TSL, N = lib(), T = E.THREE;
    const { vec3, float, vec2, uniform, positionWorld, normalize, mix, cameraViewMatrix, vec4, pow, max, dot, cameraPosition, clamp } = X;
    const U = uniforms(), w = biome.water.color, swell = float(biome.water.swell ? 1.0 : 0.45);
    const deep = uniform(new T.Color().setRGB(w[0] / 255, w[1] / 255, w[2] / 255, T.SRGBColorSpace));
    const p = positionWorld.xz, t = U.time;
    const wave = (q) => N.fbm3(q.mul(0.05).add(vec2(t.mul(0.06), t.mul(0.04)))).add(N.fbm3(q.mul(0.19).sub(vec2(t.mul(0.09), t.mul(-0.07)))).mul(0.5)).add(N.noise2(q.mul(0.9).add(t.mul(0.5))).mul(0.12));
    const e = 0.6, h0 = wave(p), hx = wave(p.add(vec2(e, 0))), hz = wave(p.add(vec2(0, e)));
    const nW = normalize(vec3(h0.sub(hx).mul(2.2).mul(swell), 1.0, h0.sub(hz).mul(2.2).mul(swell)));
    const normalNode = normalize(cameraViewMatrix.mul(vec4(nW, 0)).xyz);
    const v = normalize(cameraPosition.sub(positionWorld));
    const fr = pow(float(1).sub(max(dot(nW, v), 0)), 4);
    return pbr({
      name: 'water', roughness: 0.06, metalness: 0.0, transparent: true, depthWrite: true,
      colorNode: deep.mul(h0.mul(0.5).add(0.5)),
      normalNode,
      opacityNode: clamp(float(0.72).add(fr.mul(0.28)), 0, 1),
      envIntensity: 1.0,
    });
  }

  // Camera-facing sprite (glows, flares): a THREE.Sprite material with an HDR tint and a greyscale/alpha map.
  function sprite(o) {
    const T = E.THREE; o = o || {};
    const m = new T.SpriteNodeMaterial();
    m.color = color(o.color);
    if (o.intensity) m.color.multiplyScalar(o.intensity);
    if (o.map) m.map = o.map;
    m.transparent = true; m.depthWrite = false; m.fog = false;
    if (o.additive) m.blending = T.AdditiveBlending;
    return m;
  }

  // Escape hatch for bespoke node materials (sky, weather...): still created here, never by hand elsewhere.
  // kind: 'basic' (unlit) | 'sprite' (billboard) | 'standard' | 'physical'; props are assigned onto the material.
  function node(kind, props) {
    const T = E.THREE;
    const C = { basic: T.MeshBasicNodeMaterial, sprite: T.SpriteNodeMaterial, standard: T.MeshStandardNodeMaterial, physical: T.MeshPhysicalNodeMaterial }[kind];
    return Object.assign(new C(), props || {});
  }

  E.Mat = { pbr, emissive, particle, sprite, node, hull, terrain, water, color, setEnv, LOOK, get U() { return uniforms(); } };
  // geometry code (geo.js / hulls.js / planet.js) asks for the shared hull material through E.Geo.material()
})(window.E = window.E || {});
