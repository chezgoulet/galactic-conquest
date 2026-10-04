// Procedural sky (TSL node material on a camera-centred dome):
//  - single-scattering Rayleigh + Mie atmosphere, ray-marched through an
//    exponential atmosphere on a small (game-scaled) planet. Because the camera
//    height is a real input, the same shader gives blue sky at the surface,
//    thinning air with altitude, a curved limb with a glowing atmosphere rim
//    and a star field once above the air (E.SIM.ALT.space ~ 2600 m).
//  - a planet under the camera: rays that miss the atmosphere's far side hit a
//    shaded planet sphere, so the horizon curves away from orbit.
//  - stars, nebulae, sun disc, plus distant shaded planets / moons / rings.
// Per-biome art direction (palette, sun, airless) comes from the SKY table and
// is carried by uniforms, so every biome shares one compiled shader.
// Clouds, fog and light shafts are screen-space volumetrics in atmo.js.
(function (E) {
  'use strict';

  const hex = (h) => new E.THREE.Color(h);
  // sun = direction to the sun; space = how much of the sky is already "space" at ground level (airless worlds);
  // cloud/cloudCol/cloudDark drive the volumetric layer (atmo.js); fog = aerial-perspective colour.
  const SKY = {
    tundra:   { top: '#1d3f78', hor: '#c6d6ea', sunCol: '#ffe2c4', sun: [0.55, 0.3, -0.5], sunI: 3.0, cloud: 0.5, cloudCol: '#eef3fa', cloudDark: '#7d8ea8', fog: '#a9bfd6', amb: 1.0, space: 0.0, bloom: 0.5 },
    desert:   { top: '#1f4f9a', hor: '#efcfa2', sunCol: '#fff0d0', sun: [0.4, 0.52, -0.55], sunI: 3.6, cloud: 0.22, cloudCol: '#fff3e0', cloudDark: '#c9a988', fog: '#e2c49c', amb: 0.95, space: 0.0, bloom: 0.5 },
    jungle:   { top: '#2c6f96', hor: '#c4e2cc', sunCol: '#fff6d8', sun: [0.5, 0.55, -0.4], sunI: 3.0, cloud: 0.6, cloudCol: '#f4fbf2', cloudDark: '#6f9082', fog: '#a8cdb6', amb: 1.05, space: 0.0, bloom: 0.5 },
    urban:    { top: '#232a52', hor: '#f08e4e', sunCol: '#ffb070', sun: [0.75, 0.16, -0.4], sunI: 3.2, cloud: 0.5, cloudCol: '#ffb48a', cloudDark: '#4a3a5e', fog: '#c98a6c', amb: 0.85, space: 0.05, bloom: 0.6 },
    volcanic: { top: '#140808', hor: '#a03812', sunCol: '#ff7a3a', sun: [0.3, 0.22, -0.7], sunI: 2.6, cloud: 0.78, cloudCol: '#c0502a', cloudDark: '#1c1210', fog: '#6a2a1a', amb: 0.7, space: 0.0, bloom: 0.75 },
    ocean:    { top: '#27506f', hor: '#b4ccd6', sunCol: '#e8f6ff', sun: [0.35, 0.6, -0.5], sunI: 2.7, cloud: 0.72, cloudCol: '#e6eef2', cloudDark: '#55697a', fog: '#93b2c0', amb: 1.1, space: 0.0, bloom: 0.5 },
    cratered: { top: '#020308', hor: '#1a1d2a', sunCol: '#ffffff', sun: [0.5, 0.4, -0.5], sunI: 4.0, cloud: 0.0, cloudCol: '#ffffff', cloudDark: '#888888', fog: '#3a3d48', amb: 0.45, space: 1.0, bloom: 0.6 },
    gas:      { top: '#120a2a', hor: '#7a3f8c', sunCol: '#ffd0f0', sun: [0.45, 0.3, -0.6], sunI: 2.6, cloud: 0.35, cloudCol: '#e0a8f0', cloudDark: '#2c1a44', fog: '#5a3470', amb: 0.8, space: 0.45, bloom: 0.7 },
  };

  // game-scaled planet: radius and atmosphere heights in metres
  const PLANET = { R: 40000, Ratm: 49000, Hr: 1500, Hm: 450 };

  // ── dome material (one shared compiled shader; per-biome values are uniforms) ──
  let domeMat = null, SU = null;
  function skyUniforms() {
    if (SU) return SU;
    const { uniform } = E.THREE.TSL, T = E.THREE;
    SU = {
      betaR: uniform(new T.Vector3(0.2, 0.45, 1.0)), hor: uniform(new T.Color()), sunI: uniform(3), ground: uniform(new T.Color()),
      nebA: uniform(new T.Color()), nebB: uniform(new T.Color()), seed: uniform(0),
    };
    return SU;
  }
  function dome() {
    if (domeMat) return domeMat;
    const T = E.THREE, X = T.TSL, N = E.TSLN, U = E.Mat.U, S = skyUniforms();
    const { Fn, float, vec2, vec3, vec4, dot, normalize, length, exp, max, min, sqrt, pow, mix, smoothstep, select, positionLocal, floor, fract, sin, clamp, atan, abs, cameraPosition } = X;
    const { R, Ratm, Hr, Hm } = PLANET;
    const STEPS = 10;
    const raySphere = (o, d, r) => {
      const b = dot(o, d), c = dot(o, o).sub(r * r), disc = b.mul(b).sub(c);
      const s = sqrt(max(disc, 0));
      return { t0: b.negate().sub(s), t1: b.negate().add(s), hit: disc.greaterThan(0) };
    };
    const stars = (d, sc) => {
      const p = d.mul(sc), i = floor(p), f = fract(p).sub(0.5);
      const h = N.hash31(i);
      return smoothstep(0.985, 1.0, h).mul(smoothstep(0.38, 0.0, length(f))).mul(sin(U.time.mul(2.0).add(h.mul(90.0))).mul(0.4).add(0.6));
    };
    const m = E.Mat.node('basic');
    m.side = T.BackSide; m.depthWrite = false; m.depthTest = false; m.fog = false;
    m.colorNode = Fn(() => {
      const d = normalize(positionLocal);
      const alt = max(U.altitude, 0.5);
      const o = vec3(0, alt.add(R), 0);
      const sd = U.sunDir;
      const air = float(1).sub(U.airless);
      const atm = raySphere(o, d, Ratm), pl = raySphere(o, d, R);
      const hitP = pl.hit.and(pl.t0.greaterThan(0));
      const tmax = select(hitP, pl.t0, max(atm.t1, 0.0)).toVar();
      const tau = vec3(0).toVar(), sum = vec3(0).toVar();
      const cosV = dot(d, sd);
      const phR = float(0.0596831).mul(cosV.mul(cosV).add(1));                    // 3/(16 pi) (1 + cos^2)
      const g = 0.76, gg = g * g;
      const phM = float(0.0795775).mul(float(1 - gg)).mul(cosV.mul(cosV).add(1)).div(float(2 + gg).mul(pow(float(1 + gg).sub(cosV.mul(2 * g)), 1.5)));
      const betaM = vec3(0.045, 0.047, 0.05).div(Hm);
      const betaR = S.betaR.div(Hr);
      for (let i = 0; i < STEPS; i++) {
        const u = (i + 0.5) / STEPS, dt = tmax.mul(2 * u / STEPS), p = o.add(d.mul(tmax.mul(u * u)));
        const h = max(length(p).sub(R), 0.0);
        const rR = exp(h.negate().div(Hr)).mul(air), rM = exp(h.negate().div(Hm)).mul(air);
        const ext = betaR.mul(rR).add(betaM.mul(rM));
        tau.addAssign(ext.mul(dt));
        const cosS = dot(normalize(p), sd);
        const k = float(1).div(max(cosS, 0.0).mul(0.9).add(0.1));
        const sunT = exp(betaR.mul(rR.mul(Hr)).add(betaM.mul(rM.mul(Hm))).mul(k).negate()).mul(smoothstep(-0.12, 0.1, cosS));
        sum.addAssign(sunT.mul(betaR.mul(rR).mul(phR).add(betaM.mul(rM).mul(phM))).mul(exp(tau.negate())).mul(dt));
      }
      const viewT = exp(tau.negate());
      let col = sum.mul(S.sunI).mul(U.sunColor).mul(0.9).toVar();
      // ground-level multiple-scatter haze: the horizon lifts toward the biome's palette colour
      const hz = pow(float(1).sub(abs(d.y)), 3).mul(exp(alt.negate().div(Hr * 1.4))).mul(air);
      col.addAssign(S.hor.mul(hz).mul(0.35));
      // the planet below: shaded surface seen through the atmosphere
      const pp = o.add(d.mul(pl.t0));
      const pn = normalize(pp);
      const gn = N.fbm3(pp.xz.mul(0.0006).add(S.seed)).mul(0.5).add(0.75);
      const sunOnGround = smoothstep(-0.05, 0.4, dot(pn, sd));
      const sunTg = exp(S.betaR.div(Hr).mul(Hr).mul(air).mul(float(1).div(max(dot(pn, sd), 0.08))).negate().mul(0.9));
      const groundLit = S.ground.mul(gn).mul(sunOnGround).mul(sunTg).mul(U.sunColor).mul(S.sunI).mul(0.32).add(S.ground.mul(0.01));
      col.addAssign(select(hitP, groundLit.mul(viewT), vec3(0)));
      // stars + nebula, dimmed by the air in front of them
      const space = float(1);
      const st = stars(d, 140.0).add(stars(d, 260.0).mul(0.6));
      const nuv = vec2(atan(d.z, d.x).mul(1.4), d.y.mul(2.6)).add(S.seed);
      const nb = N.fbm5(nuv.mul(1.3).add(N.fbm3(nuv.mul(2.0)).mul(0.8)));
      const neb = mix(S.nebA, S.nebB, N.fbm3(nuv.mul(0.7).add(5.0))).mul(smoothstep(0.42, 0.85, nb)).mul(0.5);
      const skyView = select(hitP, vec3(0), viewT);                              // no stars through the planet
      col.addAssign(vec3(st).mul(2.2).add(neb).mul(skyView));
      // sun disc + halo (attenuated by the atmosphere, hidden by the planet)
      const sdot = max(dot(d, sd), 0.0);
      const sunTr = exp(betaR.mul(exp(alt.negate().div(Hr)).mul(Hr)).add(betaM.mul(exp(alt.negate().div(Hm)).mul(Hm))).mul(air).mul(float(1).div(max(sd.y, 0.04))).negate().mul(1.0));
      const disc = smoothstep(0.9994, 0.9998, sdot).mul(30.0).add(pow(sdot, 400.0).mul(3.0)).add(pow(sdot, 40.0).mul(0.25));
      const sunVis = select(hitP, float(0), float(1));
      col.addAssign(U.sunColor.mul(sunTr).mul(disc).mul(sunVis));
      return vec4(col, 1.0);
    })();
    domeMat = m;
    return m;
  }

  // ── distant bodies ──
  function planetMesh(radius, cA, cB, seed, banded) {
    const T = E.THREE, X = T.TSL, N = E.TSLN, U = E.Mat.U;
    const { vec2, vec3, vec4, float, uniform, normalLocal, normalize, atan, mix, smoothstep, dot, max, pow, positionView, normalView } = X;
    const m = E.Mat.node('basic'); m.fog = false;
    const A = uniform(hex(cA)), B = uniform(hex(cB));
    const n = normalize(normalLocal);
    const uv = vec2(atan(n.z, n.x).mul(2.0), n.y.mul(6.0)).add(seed);
    const pat = banded ? N.fbm5(vec2(uv.x.mul(0.25).add(N.fbm5(uv.mul(1.5)).mul(0.6)), uv.y.mul(2.2))) : N.fbm5(uv.mul(3.0));
    let col = mix(A, B, smoothstep(0.3, 0.7, pat));
    if (!banded) col = col.mul(N.fbm5(uv.mul(9.0)).mul(0.5).add(0.75));
    const l = smoothstep(-0.15, 0.55, dot(n, U.sunDir));
    const rim = pow(float(1).sub(max(dot(normalView, normalize(positionView.negate())), 0)), 3);
    m.colorNode = vec4(col.mul(l.mul(1.1).add(0.03)).add(B.mul(rim).mul(l).mul(0.5)).mul(2.2), 1);
    return new T.Mesh(new T.SphereGeometry(radius, 48, 32), m);
  }
  function ringMesh(r0, r1, col) {
    const T = E.THREE, X = T.TSL, N = E.TSLN;
    const { vec2, vec4, float, uniform, positionLocal, length, smoothstep } = X;
    const m = E.Mat.node('basic'); m.fog = false; m.transparent = true; m.side = T.DoubleSide; m.depthWrite = false;
    const C = uniform(hex(col));
    const t = length(positionLocal.xy).sub(r0).div(r1 - r0);
    const b = N.noise2(vec2(t.mul(46.0), 0.5)).mul(0.7).add(N.noise2(vec2(t.mul(9.0), 3.5)).mul(0.5));
    m.colorNode = vec4(C.mul(b.mul(0.6).add(0.5)).mul(2.0), smoothstep(0.0, 0.06, t).mul(smoothstep(1.0, 0.9, t)).mul(b).mul(0.8));
    return new T.Mesh(new T.RingGeometry(r0, r1, 96, 1), m);
  }

  function makeSky(scene, planet, biome) {
    const T = E.THREE, S = SKY[planet.biome] || SKY.desert, SUn = skyUniforms();
    const group = new T.Group();
    const sunDir = new T.Vector3(S.sun[0], S.sun[1], S.sun[2]).normalize();
    // per-biome scattering tint: the Rayleigh colour follows the palette's zenith colour
    const tc = hex(S.top), mx = Math.max(tc.r, tc.g, tc.b, 1e-3);
    const tint = [Math.max(tc.r / mx, 0.06) * 0.2, Math.max(tc.g / mx, 0.06) * 0.45, Math.max(tc.b / mx, 0.06)];
    const lowC = biome.palette.low, ground = new T.Color().setRGB(lowC[0] / 255, lowC[1] / 255, lowC[2] / 255, T.SRGBColorSpace);
    const setBiome = () => {
      const k = 0.55 * (S.space >= 1 ? 1 : 1);
      SUn.betaR.value.set(tint[0] * k, tint[1] * k, tint[2] * k);
      SUn.hor.value.copy(hex(S.hor)); SUn.sunI.value = S.sunI * 7.5; SUn.ground.value.copy(ground);
      SUn.seed.value = (planet.seed % 1000) * 0.37;
      SUn.nebA.value.copy(hex(E.rgbStr(E.hsl2rgb((planet.seed % 97) / 97, 0.7, 0.45))));
      SUn.nebB.value.copy(hex(E.rgbStr(E.hsl2rgb(((planet.seed % 97) / 97 + 0.35) % 1, 0.8, 0.4))));
    };
    setBiome();
    const dm = new T.Mesh(new T.SphereGeometry(30000, 48, 24), dome());
    dm.renderOrder = -100; dm.frustumCulled = false;
    group.add(dm);

    // distant bodies (they ride with the dome so they never get closer)
    const r = E.RNG(planet.seed ^ 0x1234), bodies = new T.Group(); group.add(bodies);
    const place = (m, az, el, dist) => { m.position.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(dist); bodies.add(m); return m; };
    if (planet.biome === 'gas') {
      const g = place(planetMesh(6200, '#c08a5a', '#6a3a8c', planet.seed % 50, true), 2.4, 0.42, 16000);
      const ring = ringMesh(7800, 12500, '#d8b8e8'); ring.rotation.x = 1.25; ring.rotation.y = 0.3; g.add(ring);
      place(planetMesh(520, '#8a8f9a', '#c4c9d4', 3, false), 0.9, 0.5, 17000);
    } else {
      const n = 1 + (planet.seed % 2) + (S.space > 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const big = i === 0 && r.chance(0.5);
        const hue = r.next();
        const m = place(planetMesh(big ? r.f(1700, 2600) : r.f(380, 900), E.rgbStr(E.hsl2rgb(hue, 0.25, 0.55)), E.rgbStr(E.hsl2rgb(hue + 0.08, 0.35, 0.3)), r.f(0, 50), big && r.chance(0.5)), r.angle(), r.f(0.2, 0.75), 17500);
        if (big && r.chance(0.4)) { const ring = ringMesh(m.geometry.parameters.radius * 1.3, m.geometry.parameters.radius * 2.1, '#cfc8b8'); ring.rotation.x = r.f(1.0, 1.5); m.add(ring); }
      }
    }
    bodies.traverse(o => { if (o.isMesh) { o.renderOrder = -90; o.material.depthWrite = false; o.frustumCulled = false; } });
    scene.scene.add(group);

    const atmosphere = {
      fogColor: hex(S.fog), sunColor: hex(S.sunCol), sunDir, sunI: S.sunI, skyColor: hex(S.hor).lerp(hex(S.top), 0.45), groundColor: new T.Color().setRGB(lowC[0] / 255, lowC[1] / 255, lowC[2] / 255, T.SRGBColorSpace).multiplyScalar(0.5),
      ambI: S.amb, density: 2.0 / ((biome.challenge && biome.challenge.fog) || 3000), heightK: S.space > 0.5 ? 0.02 : 0.0045, base: 0, bloom: S.bloom,
      biome: planet.biome, cloud: S.cloud, cloudCol: hex(S.cloudCol), cloudDark: hex(S.cloudDark), airless: S.space >= 1 ? 1 : 0, spaceBase: S.space,
    };
    return {
      group, dome: dm, atmosphere, S,
      // ride the camera; `alt` (height above the surface) is written to the shared uniforms by Scene
      update(t, camPos) { group.position.copy(camPos); },
    };
  }

  E.makeSky = makeSky;
  E.SKY = SKY;
  E.PLANET = PLANET;
})(window.E = window.E || {});
