// Screen-space atmosphere, composited in HDR before the temporal resolve:
//   - height fog (analytic exponential-height integral along the view ray, with
//     patchy density and a sun in-scatter lobe) = aerial perspective
//   - ray-marched volumetric cloud layer between ALT.cloudLo and ALT.cloudHi (700-1000 m):
//     reads from below, from inside the slab and from above; stops at scene geometry
//   - screen-space light shafts (god rays) toward the sun, strongest in low, hazy air
// All parameters live in E.Atmo.U (TSL uniforms); Scene drives them from the biome
// (js/data/biomes.js through sky.js) and from camera altitude.
// Honest scope: these are screen-space/analytic approximations, not a froxel volume.
(function (E) {
  'use strict';

  let U = null, noiseTex = null;
  function uniforms() {
    if (U) return U;
    const T = E.THREE, { uniform } = T.TSL;
    U = {
      fogColor: uniform(new T.Color(0.6, 0.7, 0.8)), sunColor: uniform(new T.Color(1, 0.9, 0.7)), sunDir: uniform(new T.Vector3(0, 1, 0)),
      density: uniform(0.0006), heightK: uniform(0.006), base: uniform(0), maxFog: uniform(0.88),
      cloudLo: uniform(700), cloudHi: uniform(1000), cover: uniform(0.4), cloudDensity: uniform(0.045),
      cloudCol: uniform(new T.Color(1, 1, 1)), cloudDark: uniform(new T.Color(0.5, 0.55, 0.65)), wind: uniform(new T.Vector3()),
      shaft: uniform(0.5), camPos: uniform(new T.Vector3()), frame: uniform(0), airless: uniform(0),
    };
    return U;
  }

  // Tileable 64^3 noise volume, generated on the CPU (no assets): R = fbm value noise, G = inverted Worley, B = finer fbm.
  function noiseVolume() {
    if (noiseTex) return noiseTex;
    const T = E.THREE, N = 64, data = new Uint8Array(N * N * N * 4);
    const hash = (x, y, z, s) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; };
    const vnoise = (x, y, z, p, s) => {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi;
      const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
      const g = (a, b, c) => hash(((xi + a) % p + p) % p, ((yi + b) % p + p) % p, ((zi + c) % p + p) % p, s);
      const l = (a, b, t) => a + (b - a) * t;
      return l(l(l(g(0, 0, 0), g(1, 0, 0), u), l(g(0, 1, 0), g(1, 1, 0), u), v), l(l(g(0, 0, 1), g(1, 0, 1), u), l(g(0, 1, 1), g(1, 1, 1), u), v), w);
    };
    const fbm = (x, y, z, base, s) => { let a = 0.5, sum = 0, p = base, f = 1; for (let o = 0; o < 4; o++) { sum += a * vnoise(x * p / N * f, y * p / N * f, z * p / N * f, p * f, s + o); f *= 2; a *= 0.5; } return sum / 0.9375; };
    const cells = 6, pts = [];
    for (let i = 0; i < cells * cells * cells; i++) pts.push([hash(i, 1, 2, 9), hash(i, 3, 4, 9), hash(i, 5, 6, 9)]);
    const worley = (x, y, z) => {
      const px = x / N * cells, py = y / N * cells, pz = z / N * cells, ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
      let md = 9;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const cx = ix + a, cy = iy + b, cz = iz + c, k = (((cx % cells) + cells) % cells) + (((cy % cells) + cells) % cells) * cells + (((cz % cells) + cells) % cells) * cells * cells;
        const q = pts[k], dx = cx + q[0] - px, dy = cy + q[1] - py, dz = cz + q[2] - pz, d = dx * dx + dy * dy + dz * dz;
        if (d < md) md = d;
      }
      return 1 - Math.min(1, Math.sqrt(md));
    };
    for (let z = 0, i = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++, i += 4) {
      data[i] = Math.min(255, fbm(x, y, z, 4, 1) * 255);
      data[i + 1] = Math.min(255, worley(x, y, z) * 255);
      data[i + 2] = Math.min(255, fbm(x, y, z, 8, 7) * 255);
      data[i + 3] = 255;
    }
    const t = new T.Data3DTexture(data, N, N, N);
    t.format = T.RGBAFormat; t.type = T.UnsignedByteType; t.minFilter = t.magFilter = T.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = T.RepeatWrapping; t.generateMipmaps = false; t.unpackAlignment = 1; t.needsUpdate = true;
    return (noiseTex = t);
  }

  // Build the compositing node. opts: color (texture node), depth (texture node), camera, near, far,
  // fog, clouds, shafts (booleans), cloudSteps, shaftSteps.
  function node(o) {
    const T = E.THREE, X = T.TSL, A = uniforms(), N = E.TSLN;
    const { Fn, float, vec2, vec3, vec4, uniform, uv, dot, normalize, length, exp, max, min, pow, mix, smoothstep, select, clamp, abs, If, Loop, int, texture3D,
      getViewPosition, perspectiveDepthToViewZ, interleavedGradientNoise, screenCoordinate, sin, floor, fract, saturate } = X;
    const cam = o.camera;
    const projInv = uniform(cam.projectionMatrixInverse), camWorld = uniform(cam.matrixWorld), proj = uniform(cam.projectionMatrix), view = uniform(cam.matrixWorldInverse);
    const near = float(o.near), far = float(o.far);
    const vol = o.clouds ? texture3D(noiseVolume()) : null;
    return Fn(() => {
      const p = uv();
      const src = o.color.sample(p);
      const dep = o.depth.sample(p).x;
      const vz = perspectiveDepthToViewZ(dep, near, far);
      const isSky = vz.negate().greaterThan(far.mul(0.985));
      const vp = getViewPosition(p, dep, projInv);
      const wo = camWorld.mul(vec4(vp, 0)).xyz;                   // world-space offset from the camera to the surface
      const dist0 = length(wo), rd = wo.div(max(dist0, 1e-4));
      const ro = A.camPos;
      const dist = min(dist0, float(60000));
      const col = src.rgb.toVar();
      const jit = interleavedGradientNoise(screenCoordinate.xy.add(A.frame.mul(5.588)));

      // height fog (skipped for sky pixels: the dome already carries its own horizon haze)
      if (o.fog) {
        const t = rd.y.mul(A.heightK);
        const f = select(abs(t).lessThan(1e-5), dist, float(1).sub(exp(dist.negate().mul(t))).div(t));
        const wpos = ro.add(rd.mul(min(dist, float(3000))));
        const patch = N.noise2(wpos.xz.mul(0.004).add(A.frame.mul(0.0))).mul(0.6).add(0.7);
        const amt = A.density.mul(exp(clamp(ro.y.sub(A.base).mul(A.heightK).negate(), -20, 4))).mul(f).mul(patch);
        const fog = clamp(float(1).sub(exp(amt.negate())), 0, A.maxFog).mul(select(isSky, float(0), float(1)));
        const sun = pow(max(dot(rd, A.sunDir), 0), 8);
        col.assign(mix(col, mix(A.fogColor, A.sunColor, sun.mul(0.55)), fog));
      }

      // volumetric clouds
      if (o.clouds) {
        const lo = A.cloudLo, hi = A.cloudHi, thick = hi.sub(lo);
        const tA = lo.sub(ro.y).div(select(abs(rd.y).lessThan(1e-4), float(1e-4), rd.y)), tB = hi.sub(ro.y).div(select(abs(rd.y).lessThan(1e-4), float(1e-4), rd.y));
        const inSlab = ro.y.greaterThan(lo).and(ro.y.lessThan(hi));
        const horiz = abs(rd.y).lessThan(1e-4);
        const t0 = select(horiz, float(0), max(min(tA, tB), 0));
        const t1raw = select(horiz, select(inSlab, float(9000), float(-1)), max(tA, tB));
        const t1 = min(min(t1raw, select(isSky, float(60000), dist)), t0.add(float(o.cloudSteps * 420)));
        const seg = max(t1.sub(t0), 0);
        const dtv = seg.div(float(o.cloudSteps));
        const thr = float(0.74).sub(A.cover.mul(0.5));
        const trans = float(1).toVar(), scat = vec3(0).toVar();
        If(seg.greaterThan(1).and(A.cover.greaterThan(0.01)), () => {
          const cosS = dot(rd, A.sunDir);
          const g = 0.55, hg = float(1 - g * g).div(pow(float(1 + g * g).sub(cosS.mul(2 * g)), 1.5).mul(12.566));
          const phase = hg.mul(0.9).add(0.1 / 12.566 * 4).mul(4.0);
          for (let i = 0; i < o.cloudSteps; i++) {
            const tt = t0.add(dtv.mul(float(i).add(jit)));
            const pp = ro.add(rd.mul(tt));
            const h = clamp(pp.y.sub(lo).div(thick), 0, 1);
            const prof = smoothstep(0, 0.18, h).mul(smoothstep(1.0, 0.55, h));
            const q0 = pp.add(A.wind), q = q0.add(vol.sample(q0.mul(1 / 2300)).xzy.sub(0.5).mul(1400));
            const q2 = vec3(q.z, q.y, q.x.negate()).mul(1 / 3370).add(vec3(0.37, 0.11, 0.61)), base = vol.sample(q.mul(1 / 5200)).x.mul(0.6).add(vol.sample(q2).x.mul(0.4)), det = vol.sample(q.mul(1 / 1100)).y.mul(0.5).add(vol.sample(q.mul(1 / 380)).z.mul(0.5));
            const shape = base.mul(0.78).add(det.mul(0.22).mul(float(1).sub(base.mul(0.4))));
            const dens = clamp(shape.sub(thr).mul(3.2), 0, 1).mul(prof).mul(A.cloudDensity);
            If(dens.greaterThan(0.0005), () => {
              // light: two taps toward the sun through the layer
              const sd = A.sunDir;
              const l1 = vol.sample(pp.add(sd.mul(thick.mul(0.18))).add(A.wind).mul(1 / 5200)).x, l2 = vol.sample(pp.add(sd.mul(thick.mul(0.45))).add(A.wind).mul(1 / 5200)).x;
              const od = clamp(l1.sub(thr).mul(3.2), 0, 1).add(clamp(l2.sub(thr).mul(3.2), 0, 1)).mul(A.cloudDensity).mul(thick.mul(0.3));
              const beer = exp(od.negate().mul(1.1)), powder = float(1).sub(exp(dens.mul(dtv).mul(-2.0)));
              const lightE = beer.mul(mix(float(1), powder.mul(2.0), 0.5)).mul(max(sd.y.mul(2.5).add(0.5), 0.0).min(1.0));
              const amb = mix(A.cloudDark, A.cloudCol, h.mul(0.8).add(0.2));
              const lit = A.sunColor.mul(lightE).mul(phase).mul(0.9).add(amb.mul(0.55)).mul(A.cloudCol.mul(0.5).add(0.5));
              const ext = dens.mul(dtv);
              const stepT = exp(ext.negate());
              scat.addAssign(lit.mul(trans).mul(float(1).sub(stepT)));
              trans.mulAssign(stepT);
            });
          }
        });
        // aerial perspective: distant cloud fades into the haze
        const fade = exp(t0.negate().div(select(isSky, float(26000), float(40000))));
        col.assign(col.mul(trans).add(scat.mul(fade)).add(A.fogColor.mul(float(1).sub(fade)).mul(float(1).sub(trans)).mul(0.9)));
      }

      // light shafts toward the sun
      if (o.shafts) {
        const sc = proj.mul(view.mul(vec4(ro.add(A.sunDir.mul(1000)), 1)));
        const front = sc.w.greaterThan(0.1);
        const ndc = sc.xy.div(max(sc.w, 0.1));
        const suv = vec2(ndc.x.mul(0.5).add(0.5), ndc.y.mul(0.5).add(0.5).oneMinus());
        const acc = float(0).toVar();
        const dl = suv.sub(p).mul(1 / o.shaftSteps).mul(0.85);
        const sunPow = pow(max(dot(rd, A.sunDir), 0), 2.0);
        If(front.and(sunPow.greaterThan(0.01)), () => {
          for (let i = 0; i < o.shaftSteps; i++) {
            const sp = p.add(dl.mul(float(i).add(jit)));
            const inb = sp.x.greaterThan(0).and(sp.x.lessThan(1)).and(sp.y.greaterThan(0)).and(sp.y.lessThan(1));
            const dz = o.depth.sample(sp).x;
            const sky = perspectiveDepthToViewZ(dz, near, far).negate().greaterThan(far.mul(0.985));
            acc.addAssign(select(sky.and(inb), float(1), float(0)));
          }
        });
        const k = acc.div(o.shaftSteps).mul(sunPow).mul(A.shaft).mul(float(1).sub(A.airless));
        col.addAssign(A.sunColor.mul(k).mul(0.35).mul(select(isSky, float(0.25), float(1))));
      }
      return vec4(col, src.a);
    })();
  }

  E.Atmo = { get U() { return uniforms(); }, node, noiseVolume };
})(window.E = window.E || {});
