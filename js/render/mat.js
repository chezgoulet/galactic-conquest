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

  // ── hull: PBR + vertex colour + procedural plating, lit windows and HDR emissive ──
  // aFx.y encodes surface mode + 16 * size class: mode 0 plain, 1 fine panels, 2 coarse panels, 3 panels + windows;
  // size class 0 small craft / props, 1 structures, 2 capital ships. The plating grid, seam width and window grid all scale
  // with the size class, and every layer fades to its average colour once a cell is under ~3 pixels, so a 780 m hull
  // shows coherent plates and window rows up close and a calm tone at range instead of aliasing into stripes.
  let hullMat = null;
  function hull() {
    if (hullMat) return hullMat;
    const X = E.THREE.TSL, N = lib();
    const { vec2, vec3, float, floor, fract, abs, max, min, smoothstep, step, attribute, positionGeometry, normalGeometry, positionWorld, cameraPosition, vertexColor, clamp, mix, length, select } = X;
    const fx = attribute('aFx', 'vec2');
    const sc = floor(fx.y.div(16.0).add(0.02));
    const mode = floor(fx.y.sub(sc.mul(16.0)).add(0.5));
    const dist = length(cameraPosition.sub(positionWorld));
    const fp = dist.mul(0.0021);                                   // metres per pixel at this depth (60deg fov, ~540 px)
    const cell = (a, b, c) => select(sc.lessThan(0.5), float(a), select(sc.lessThan(1.5), float(b), float(c)));
    const P = positionGeometry, nrm = abs(normalGeometry);
    // plane coordinates on the face's dominant axis
    const sideX = step(nrm.y, nrm.x).mul(step(nrm.z, nrm.x)), topY = step(nrm.x, nrm.y).mul(step(nrm.z, nrm.y)).mul(float(1).sub(sideX));
    const uvp = mix(mix(vec2(P.x, P.y), vec2(P.z, P.y), sideX), vec2(P.x, P.z), topY);
    // two plating levels
    const plate = (c, jit) => {
      const q = uvp.div(c), id = floor(q), f = abs(fract(q).sub(0.5)), edge = max(f.x, f.y);
      const seam = smoothstep(0.5 - 0.035 - 0.02, 0.5, edge);
      const fade = smoothstep(c.mul(0.12), c.mul(0.035), fp);       // seams vanish when a cell is only a few pixels
      return { id: N.hash21(id.add(jit)), seam: seam.mul(fade), fade };
    };
    const cF = cell(0.4, 1.4, 5.0), cC = cell(1.6, 6.0, 26.0);
    const pf = plate(cF, 3.7), pc = plate(cC, 11.3);
    const panels = step(0.5, mode), coarseOnly = step(1.5, mode);
    const tone = mix(float(1), pf.id.sub(0.5).mul(0.2).mul(pf.fade).add(1.0).mul(pc.id.sub(0.5).mul(0.28).add(1.0)), panels);
    const seamDark = float(1).sub(pf.seam.mul(0.28).mul(float(1).sub(coarseOnly)).add(pc.seam.mul(0.4)).mul(panels));
    const weather = N.noise2(uvp.div(cC.mul(1.7))).mul(0.3).add(0.82);
    // windows on mode 3: rows of lit portholes; row/deck variation, coloured, fading to a mean glow with distance
    const wcell = vec2(cell(0.9, 2.0, 4.2), cell(1.2, 2.6, 5.4));
    const wq = uvp.div(wcell), wid = floor(wq), wf = abs(fract(wq).sub(0.5));
    const deck = N.hash21(vec2(wid.y, 5.0));
    const lit = step(float(0.5).add(deck.mul(0.22)), N.hash21(wid.add(7.0))).mul(step(0.18, deck));
    const wshape = step(wf.y, 0.2).mul(step(wf.x, 0.33));
    const isWin = step(2.5, mode);
    const winFade = smoothstep(wcell.x.mul(1.1), wcell.x.mul(0.35), fp);
    const avg = float(0.42);   // mean lit fraction of the window shape (keeps hulls reading as lit cities at range)
    const wcol = mix(vec3(1.0, 0.82, 0.55), mix(vec3(0.7, 0.9, 1.0), vec3(1.0, 0.65, 0.35), step(0.5, N.hash21(wid.add(31.0)))), step(0.8, N.hash21(wid.add(19.0))));
    const win = wcol.mul(lit.mul(wshape).mul(winFade).add(avg.mul(float(1).sub(winFade)))).mul(isWin).mul(2.4);
    // deep recessed windows read as dark glass when unlit
    const m = pbr({
      metalness: 0.55, roughness: 0.5, name: 'hull',
      colorNode: vertexColor(0).mul(tone).mul(seamDark).mul(mix(float(1), weather, panels)),
      roughnessNode: clamp(float(0.5).add(pf.id.sub(0.5).mul(0.3).mul(panels)).add(float(1).sub(weather).mul(0.4).mul(panels)), 0.1, 1.0),
      emissiveNode: vertexColor(0).mul(fx.x.add(0.05)).add(win),
    });
    hullMat = m;
    return m;
  }

  // ── infantry suit: fabric + armour plate, grime and scuffs (object-space noise, vertex colours) ──
  let suitMat = null;
  function suit() {
    if (suitMat) return suitMat;
    const X = E.THREE.TSL, N = lib();
    const { float, floor, step, attribute, positionLocal, vertexColor, mix, vec3, smoothstep, normalLocal } = X;
    const fx = attribute('aFx', 'vec2');
    const mode = floor(fx.y.add(0.5));
    const armor = step(0.5, mode).mul(step(mode, 1.5));
    const grunge = N.noise3(positionLocal.mul(9.0)), scuff = N.noise3(positionLocal.mul(41.0));
    const wear = smoothstep(0.55, 0.9, scuff);
    const col = vertexColor(0).mul(grunge.mul(0.32).add(0.84)).mul(scuff.mul(0.14).add(0.93));
    suitMat = pbr({
      name: 'suit', metalness: 0, roughness: 0.8,
      colorNode: mix(col, col.mul(1.35).add(0.015), wear.mul(armor)),
      roughnessNode: mix(float(0.86), float(0.4), armor).sub(scuff.mul(0.14)),
      metalnessNode: armor.mul(0.45).mul(float(1).sub(wear.mul(0.3))),
      emissiveNode: vertexColor(0).mul(fx.x),
    });
    return suitMat;
  }

  // ── prop: cover / foliage / rocks. Vertex colour + grime, dust or snow settling on up-facing surfaces ──
  const propMats = {};
  function prop(dust, key) {
    key = key || 'default'; if (propMats[key]) return propMats[key];
    const X = E.THREE.TSL, N = lib(), T = E.THREE;
    const { float, vec2, vec3, floor, step, attribute, positionLocal, positionWorld, normalWorld, vertexColor, mix, smoothstep, uniform, normalize } = X;
    const fx = attribute('aFx', 'vec2');
    const dustC = uniform(new T.Color(dust === undefined ? 0xb8a98a : dust));
    const g = N.noise3(positionLocal.mul(2.3)), g2 = N.noise3(positionWorld.mul(6.0));
    const up = normalize(normalWorld).y;
    const settle = smoothstep(0.55, 0.95, up).mul(smoothstep(0.3, 0.7, g)).mul(0.55);
    const col = vertexColor(0).mul(g.mul(0.3).add(0.82)).mul(g2.mul(0.16).add(0.92));
    propMats[key] = pbr({
      name: 'prop:' + key, roughness: 0.9, metalness: 0,
      colorNode: mix(col, dustC.mul(g2.mul(0.2).add(0.9)), settle),
      emissiveNode: vertexColor(0).mul(fx.x),
    });
    propMats[key].userData.dust = dustC;
    return propMats[key];
  }

  // ── shield dome: fresnel rim, hex-cell lattice and an expanding ripple where it was last struck ──
  function dome(o) {
    const X = E.THREE.TSL, N = lib(), T = E.THREE; o = o || {};
    const { vec2, vec3, vec4, float, uniform, normalLocal, positionLocal, normalWorld, positionWorld, cameraPosition, normalize, dot, abs, pow, mix, smoothstep, fract, floor, max, min, atan, sin, length, step } = X;
    const U = uniforms();
    const col = uniform(new T.Color(o.color === undefined ? 0x4fb4ff : o.color)), alpha = uniform(1.0), hitDir = uniform(new T.Vector3(0, 1, 0)), hitT = uniform(9.0);
    const v = normalize(cameraPosition.sub(positionWorld));
    const fr = pow(float(1).sub(abs(dot(normalize(normalWorld), v))), 2.4);
    const d = normalize(positionLocal);
    const q = vec2(atan(d.z, d.x).mul(9.0), d.y.mul(12.0));
    const row = floor(q.y), qq = vec2(q.x.add(row.mod(2.0).mul(0.5)), q.y), f = abs(fract(qq).sub(0.5));
    const hex = smoothstep(0.43, 0.5, max(f.x.mul(1.1), f.y.mul(0.9)));
    const ang = length(d.sub(normalize(hitDir))), ring = float(1).sub(smoothstep(0.0, 0.18, abs(ang.sub(hitT.mul(0.9)))));
    const hitFade = smoothstep(1.8, 0.0, hitT);
    const shimmer = N.noise2(q.mul(0.7).add(U.time.mul(0.3))).mul(0.5).add(0.5);
    const a = fr.mul(0.55).add(hex.mul(0.1).mul(fr.mul(2.0).add(0.2))).add(ring.mul(hitFade).mul(0.9)).add(shimmer.mul(0.03));
    const m = new T.MeshBasicNodeMaterial();
    m.colorNode = col.mul(a.mul(alpha));
    m.transparent = true; m.blending = T.AdditiveBlending; m.depthWrite = false; m.side = T.DoubleSide; m.fog = false;
    m.userData = { col, alpha, hitDir, hitT };
    return m;
  }

  // ── beam: additive volumetric-looking cylinder (ion cannon, repair torch, tractor, boarding fire) ──
  function beam(o) {
    const X = E.THREE.TSL, N = lib(), T = E.THREE; o = o || {};
    const { float, uniform, uv, normalWorld, positionWorld, cameraPosition, normalize, dot, abs, pow, smoothstep, sin, mix, vec3 } = X;
    const U = uniforms();
    const col = uniform(new T.Color(o.color === undefined ? 0xffffff : o.color)), amp = uniform(1.0);
    const v = normalize(cameraPosition.sub(positionWorld));
    const core = pow(abs(dot(normalize(normalWorld), v)), o.sharp || 2.0);
    const run = sin(uv().y.mul(o.freq || 40.0).sub(U.time.mul(o.speed || 18.0))).mul(0.25).add(0.75);
    const m = new T.MeshBasicNodeMaterial();
    m.colorNode = col.mul(core.mul(run).mul(amp));
    m.transparent = true; m.blending = T.AdditiveBlending; m.depthWrite = false; m.side = T.DoubleSide; m.fog = false;
    m.userData = { col, amp };
    return m;
  }

  // ── terrain ──
  // Layered procedural ground: macro colour blotches, per-kind micro detail (sand ripples, snow crust, mud, paving,
  // ash, regolith), triplanar rock with strata on slopes, wet shoreline, height/slope blending and a distance fade that
  // keeps the fine layers from shimmering. The bump is the same height field sampled three times.
  const LOOK = {};   // filled by planet.js (per-biome ground look), kept there with the geometry code
  function terrain(biomeId, look) {
    const X = E.THREE.TSL, N = lib(), T = E.THREE, L = look;
    const { vec3, float, vec2, uniform, positionWorld, normalWorld, vertexColor, smoothstep, normalize, mix, sin, cos, cameraViewMatrix, vec4, abs, max, min, pow, length, cameraPosition, fract, step, clamp, dot } = X;
    const U = uniforms();
    const uRock = uniform(new T.Color(L.rock)), uRock2 = uniform(new T.Color(L.rock2 || L.rock)), uTint = uniform(new T.Vector3(L.tint[0], L.tint[1], L.tint[2])), uLava = uniform(new T.Color(L.lava || '#000000'));
    const uTime = U.time, uLavaLevel = float(L.lava ? L.lavaLevel : -1e6), uRockAt = float(L.rockAt), uBump = float(L.bump);
    const kind = L.kind || 'sand', gwp = positionWorld.xz, wy = positionWorld.y;
    const dist = length(cameraPosition.sub(positionWorld));
    const nWn = normalize(normalWorld);
    const near = smoothstep(90, 12, dist), mid = smoothstep(700, 120, dist);
    const gn1 = N.fbm4(gwp.mul(0.31)), gn2 = N.fbm3(gwp.mul(0.045).add(31.0)), gm = N.fbm3(gwp.mul(0.0075).add(7.0));
    const fine = N.noise2(gwp.mul(7.3)).mul(near);
    const steep = float(1).sub(nWn.y);
    const rockK = smoothstep(uRockAt, uRockAt.add(0.16), steep.add(gn2.sub(0.5).mul(0.2))).toVar();
    // macro variation: broad light/dark patches and a tint shift, so the same palette never reads flat
    const macro = gm.sub(0.5).mul(0.55).add(1.0);
    let base0 = vertexColor(0).mul(gn1.mul(0.34).add(0.78)).mul(macro).mul(fine.mul(0.2).add(0.9));
    base0 = mix(base0, base0.mul(uTint), smoothstep(0.38, 0.66, gn2));
    // ripples / drifts / frost crust: a directional wave field warped by noise
    const dir = vec2(Math.cos(L.ripDir || 0.5), Math.sin(L.ripDir || 0.5));
    const warp = N.fbm3(gwp.mul(0.11)).mul(7.0);
    const rf = L.ripF || 2.2, rph = dot(gwp, dir).mul(rf).add(warp);
    const ripple = sin(rph).mul(0.5).add(0.5);
    const ripAmp = float(L.rip || 0.0).mul(smoothstep(0.55, 0.12, steep)).mul(smoothstep(230, 35, dist));
    // kind specific albedo modulation
    let albedo = base0;
    if (kind === 'sand' || kind === 'regolith') {
      albedo = base0.mul(ripple.mul(0.22).mul(ripAmp.mul(3.0).min(1.0)).add(0.89)).mul(N.noise2(gwp.mul(19.0)).mul(0.08).mul(near).add(0.96));
    } else if (kind === 'snow') {
      const crust = N.noise2(gwp.mul(1.7)).mul(0.5).add(N.noise2(gwp.mul(9.0)).mul(0.5));
      albedo = mix(base0.mul(0.92), vec3(0.93, 0.96, 1.0), smoothstep(0.35, 0.8, gm).mul(0.55)).mul(crust.mul(0.1).add(0.93));
      albedo = mix(albedo, albedo.mul(vec3(0.78, 0.84, 0.95)), ripple.mul(ripAmp.mul(3.0).min(1.0)).mul(0.5));
    } else if (kind === 'mud') {
      const wet = smoothstep(0.52, 0.72, N.fbm3(gwp.mul(0.06).add(3.0))).add(smoothstep(L.wl === undefined ? -1e5 : L.wl + 2.8, L.wl === undefined ? -1e5 : L.wl + 0.2, wy).mul(0.7)).min(1.0);
      const grass = smoothstep(0.35, 0.6, N.fbm4(gwp.mul(0.09).add(11.0)));
      albedo = mix(base0, base0.mul(vec3(0.82, 1.1, 0.78)), grass.mul(0.6));
      albedo = mix(albedo, albedo.mul(vec3(0.48, 0.42, 0.36)), wet.mul(0.8)).mul(N.noise2(gwp.mul(3.1)).mul(0.14).mul(near).add(0.94));
    } else if (kind === 'concrete') {
      const cell = gwp.div(9.0), f = abs(fract(cell).sub(0.5)), seam = smoothstep(0.455, 0.5, max(f.x, f.y)), id = N.hash21(cell.floor());
      const stain = N.fbm3(gwp.mul(0.28)).sub(0.5);
      albedo = base0.mul(id.mul(0.22).add(0.88)).mul(float(1).sub(seam.mul(0.55).mul(mid))).mul(stain.mul(0.5).add(1.0));
    } else if (kind === 'ash') {
      albedo = base0.mul(ripple.mul(0.12).mul(ripAmp).add(0.94)).mul(N.noise2(gwp.mul(5.0)).mul(0.12).mul(near).add(0.94));
    }
    // rock: triplanar fbm with horizontal strata, two-tone
    const trip = vec3(abs(nWn.x), 0, abs(nWn.z)); const tw = trip.x.add(trip.z).max(1e-3);
    const rn = N.fbm4(vec2(positionWorld.z, wy).mul(0.5)).mul(trip.x.div(tw)).add(N.fbm4(vec2(positionWorld.x, wy).mul(0.5)).mul(trip.z.div(tw)));
    const strata = sin(wy.mul(L.strataF || 1.4).add(rn.mul(5.0)).add(N.noise2(vec2(positionWorld.x.add(positionWorld.z), 0).mul(0.05)).mul(4.0))).mul(0.5).add(0.5);
    const rockC = mix(uRock, uRock2, strata.mul(L.strata === undefined ? 0.7 : L.strata)).mul(rn.mul(0.6).add(0.62)).mul(N.noise2(vec2(positionWorld.x.add(positionWorld.z), wy).mul(3.1)).mul(0.14).mul(near).add(0.93));
    // wet shoreline darkening for every kind
    const hasWl = L.wl !== undefined && L.wl > -1e6;
    const shore = hasWl ? smoothstep(float(L.wl + 2.2), float(L.wl + 0.1), wy) : float(0);
    // roads: packed, desaturated ground with two wheel ruts, between the posts
    let rd = float(1e5);
    for (const sg of (L.roads || [])) {
      const a = vec2(sg[0], sg[1]), ba = vec2(sg[2] - sg[0], sg[3] - sg[1]), pa = gwp.sub(a);
      rd = min(rd, length(pa.sub(ba.mul(clamp(dot(pa, ba).div(dot(ba, ba)), 0, 1)))));
    }
    const edgeN = N.noise2(gwp.mul(0.4)).sub(0.5).mul(2.4);
    const roadK = smoothstep(3.4, 1.9, rd.add(edgeN)).mul(smoothstep(0.5, 0.2, steep)).mul(mid.mul(0.6).add(0.4)).toVar();
    const rut = smoothstep(0.5, 0.0, abs(rd.sub(1.45))).mul(roadK).mul(near);
    const luma0 = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    const packed = mix(vec3(luma0), albedo, 0.55).mul(0.74).mul(float(1).sub(rut.mul(0.3)));
    const colorNode = mix(mix(albedo, packed, roadK.mul(0.8)), rockC, rockK).mul(float(1).sub(shore.mul(0.45)));
    // bump: height field = ripples + mid noise + grain, differenced three times
    const hf = (p) => N.fbm3(p.mul(0.8)).mul(0.6).mul(float(1).sub(roadK.mul(0.5))).add(sin(dot(p, dir).mul(rf).add(warp)).mul(ripAmp).mul(0.9)).add(N.noise2(p.mul(7.3)).mul(0.2).mul(near));
    const ge = 0.35, b0 = hf(gwp), bx = hf(gwp.add(vec2(ge, 0))), bz = hf(gwp.add(vec2(0, ge)));
    const off = vec3(b0.sub(bx), 0, b0.sub(bz)).mul(uBump).mul(rockK.mul(1.4).add(1)).mul(mid.mul(0.8).add(0.2));
    const normalNode = normalize(cameraViewMatrix.mul(vec4(normalize(nWn.add(off)), 0)).xyz);
    // lava cracks
    const lv = smoothstep(uLavaLevel.add(5.0), uLavaLevel.sub(3.0), positionWorld.y);
    const cr = N.fbm5(gwp.mul(0.07).add(vec2(uTime.mul(0.012), 0)));
    const crack = smoothstep(0.1, 0.0, abs(cr.sub(0.5))).add(lv.mul(smoothstep(0.45, 0.62, cr)));
    const emissiveNode = uLava.mul(lv).mul(crack).mul(sin(uTime.mul(1.7).add(cr.mul(30))).mul(0.8).add(2.2));
    // wet / frosty ground is glossier
    const roughNode = clamp(float(L.rough).sub(shore.mul(0.35)).sub(kind === 'snow' ? float(0.12) : float(0)), 0.2, 1.0);
    return pbr({ name: 'terrain:' + biomeId, roughness: L.rough, metalness: 0, colorNode, normalNode, roughnessNode: roughNode, emissiveNode });
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

  E.Mat = { pbr, emissive, particle, sprite, node, hull, suit, prop, dome, beam, terrain, water, color, setEnv, LOOK, get U() { return uniforms(); } };
  // geometry code (geo.js / hulls.js / planet.js) asks for the shared hull material through E.Geo.material()
})(window.E = window.E || {});
