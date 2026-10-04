// The post-processing stack (THREE.RenderPipeline + TSL nodes). Frame graph:
//
//   scene pass (HDR, rendered below native res, MRT: colour / view normal / velocity [/ metal+rough])
//     -> GTAO ambient occlusion              (tier-gated)
//     -> screen-space reflections            (tier-gated)
//     -> atmosphere: height fog, volumetric clouds, light shafts   (atmo.js)
//     -> TAAU: jittered temporal anti-aliasing + upscale to native  (this IS the temporal super-resolution;
//                                                                    it is TAA-upsampling, not a vendor upscaler)
//     -> depth of field                      (off unless a cinematic camera asks)
//     -> motion blur                         (velocity buffer, scaled by camera speed)
//     -> bloom
//     -> chromatic aberration, ACES filmic tone map + exposure, sRGB, lift/gamma/gain grade,
//        vignette, damage / fade, film grain
//
// Everything user-facing goes through Post.set(); the graph only rebuilds when a
// structural flag (a pass on/off, tier, res scale mode) changes.
//   scene.post.set({ dof: { on: true, focus: 80, range: 60, bokeh: 3 }, grade: { exposure: 1.1, sat: 1.1 }, motionBlur: 0.5 })
(function (E) {
  'use strict';

  // per-biome colour grade (lift/gamma/gain in display space). Subtle by design.
  const BIOME_GRADE = {
    tundra:   { lift: [0.0, 0.004, 0.012], gamma: [1, 1, 1.02], gain: [0.97, 1.0, 1.06], sat: 0.96, contrast: 1.04 },
    desert:   { lift: [0.006, 0.004, 0.004], gamma: [1, 1, 1], gain: [1.02, 1.0, 0.96], sat: 0.94, contrast: 1.03 },
    jungle:   { lift: [0.004, 0.004, 0.004], gamma: [1, 1, 1], gain: [1.0, 1.0, 0.97], sat: 0.95, contrast: 1.03 },
    urban:    { lift: [0.01, 0.004, 0.012], gamma: [1.02, 1, 0.98], gain: [1.08, 0.98, 0.92], sat: 1.05, contrast: 1.08 },
    volcanic: { lift: [0.012, 0.0, 0.0], gamma: [1.02, 0.98, 0.96], gain: [1.1, 0.94, 0.84], sat: 1.1, contrast: 1.1 },
    ocean:    { lift: [0, 0.004, 0.01], gamma: [0.98, 1, 1.02], gain: [0.94, 1.02, 1.08], sat: 1.04, contrast: 1.03 },
    cratered: { lift: [0, 0, 0.004], gamma: [1, 1, 1], gain: [0.98, 0.98, 1.02], sat: 0.9, contrast: 1.1 },
    gas:      { lift: [0.01, 0.0, 0.016], gamma: [1.02, 0.98, 1.02], gain: [1.04, 0.92, 1.1], sat: 1.12, contrast: 1.06 },
  };

  const DEFAULTS = {
    exposure: 1.0, sat: 1.0, contrast: 1.0, lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
    vignette: 0.32, grain: 0.018, aberration: 0.012, motionBlur: 0.0,
    bloom: { strength: 0.5, radius: 0.55, threshold: 1.0 },
    dof: { on: false, focus: 60, range: 80, bokeh: 3 },
    ao: { intensity: 1.0 }, ssr: { intensity: 1.0 }, shafts: 0.3,
  };

  class Post {
    constructor(S) {
      const T = E.THREE, { uniform } = T.TSL;
      this.S = S;
      this.P = JSON.parse(JSON.stringify(DEFAULTS));
      this.biomeGrade = null;
      this.pipeline = new T.RenderPipeline(S.renderer);
      this.pipeline.outputColorTransform = false;
      this._nodes = []; this._sig = ''; this.flags = {};
      // user-facing uniforms
      const v3 = (a) => uniform(new T.Vector3(a[0], a[1], a[2]));
      this.u = {
        exposure: uniform(1), sat: uniform(1), contrast: uniform(1), lift: v3([0, 0, 0]), gamma: v3([1, 1, 1]), gain: v3([1, 1, 1]),
        vig: uniform(0), grain: uniform(0), ca: uniform(0), mb: uniform(0),
        bloomS: uniform(0.5), bloomR: uniform(0.55), bloomT: uniform(1.0),
        dofFocus: uniform(60), dofRange: uniform(80), dofBokeh: uniform(3),
        aoI: uniform(1), ssrI: uniform(1), time: uniform(0), damage: uniform(0), fade: uniform(0), zoom: uniform(0),
      };
      this.apply();
    }

    // Deep-merge a patch of user parameters. Structural changes (dof.on) rebuild the graph.
    set(patch) {
      const merge = (dst, src) => { for (const k of Object.keys(src)) { if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) merge(dst[k] || (dst[k] = {}), src[k]); else dst[k] = src[k]; } };
      if (patch.grade) { const g = patch.grade; patch = Object.assign({}, patch); delete patch.grade; merge(this.P, g); }
      merge(this.P, patch);
      this.apply();
    }
    // biome grade sits under user grade (user values multiply/override via set({grade}))
    setBiome(id) { this.biomeGrade = BIOME_GRADE[id] || null; this.apply(); }

    apply() {
      const P = this.P, u = this.u, B = this.biomeGrade || {}, v = (a, b, d) => a || b || d;
      u.exposure.value = P.exposure;
      u.sat.value = P.sat * (B.sat || 1); u.contrast.value = P.contrast * (B.contrast || 1);
      const L = v(null, B.lift, [0, 0, 0]), G = v(null, B.gamma, [1, 1, 1]), N = v(null, B.gain, [1, 1, 1]);
      u.lift.value.set(L[0] + P.lift[0], L[1] + P.lift[1], L[2] + P.lift[2]);
      u.gamma.value.set(G[0] * P.gamma[0], G[1] * P.gamma[1], G[2] * P.gamma[2]);
      u.gain.value.set(N[0] * P.gain[0], N[1] * P.gain[1], N[2] * P.gain[2]);
      u.vig.value = P.vignette; u.grain.value = P.grain; u.ca.value = P.aberration; u.mb.value = P.motionBlur;
      u.bloomS.value = P.bloom.strength; u.bloomR.value = P.bloom.radius; u.bloomT.value = P.bloom.threshold;
      u.dofFocus.value = P.dof.focus; u.dofRange.value = P.dof.range; u.dofBokeh.value = P.dof.bokeh;
      u.aoI.value = P.ao.intensity; u.ssrI.value = P.ssr.intensity;
      if (E.Atmo && E.Atmo.U) E.Atmo.U.shaft.value = P.shafts;
      if (this._sig && this._sig !== this.signature()) this.build();
    }

    signature() {
      const Q = this.S.Q, P = this.P;
      return [Q.name, P.dof.on ? 1 : 0, P.motionBlur > 0.001 && Q.motionBlur ? 1 : 0, this.S.renderer.reversedDepthBuffer ? 1 : 0].join('|');
    }

    setScale(s) {
      this.scale = s;
      if (this.sp) this.sp.setResolutionScale(s);
      if (this.beauty && this.beauty.setResolutionScale) this.beauty.setResolutionScale(s);
    }

    build() {
      const T = E.THREE, X = T.TSL, XX = T.TSLX, S = this.S, Q = S.Q, u = this.u, P = this.P;
      const { pass, mrt, output, velocity, normalView, metalness, roughness, vec2, vec3, vec4, float, uniform, uv, mix, pow, max, min, clamp,
        dot, smoothstep, length, Fn, convertToTexture, rtt, toneMapping, convertColorSpace, interleavedGradientNoise, screenCoordinate, fract, sin, abs, select } = X;
      for (const n of this._nodes) { try { n.dispose && n.dispose(); } catch (e) { /* node already gone */ } }
      this._nodes = [];
      const track = (n) => { this._nodes.push(n); return n; };
      this._sig = this.signature();
      const cam = S.camera, scale = this.scale || S.resScale;

      // ── scene pass ──
      const spec = { output, normal: normalView, velocity };
      if (Q.ssr) spec.metalrough = vec2(metalness, roughness);
      const sp = track(pass(S.scene, cam, { samples: 0 }));
      sp.setMRT(mrt(spec));
      sp.setResolutionScale(scale);
      this.sp = sp;
      const depthN = sp.getTextureNode('depth'), normalN = sp.getTextureNode('normal'), velN = sp.getTextureNode('velocity');
      let color = sp.getTextureNode('output');

      const skyMask = Fn(() => X.perspectiveDepthToViewZ(depthN.sample(uv()).x, float(cam.near), float(cam.far)).negate().greaterThan(float(cam.far).mul(0.985)).select(float(0), float(1)))();
      // ── ambient occlusion (applied to the lit colour; screen-space approximation of indirect shadowing) ──
      if (Q.ao) {
        const aoP = track(XX.ao(depthN, normalN, cam));
        aoP.resolutionScale = Q.ao.scale; aoP.samples.value = Q.ao.samples; aoP.radius.value = 0.6; aoP.thickness.value = 1.5; aoP.distanceExponent.value = 1.2; aoP.distanceFallOff.value = 1.0; aoP.scale.value = 1.1;
        const aoT = aoP.getTextureNode().r;
        color = vec4(color.rgb.mul(mix(float(1), aoT, u.aoI.mul(skyMask))), color.a);
      }
      // ── screen-space reflections (SSR): metals, glass canopies, water ──
      if (Q.ssr) {
        const mr = sp.getTextureNode('metalrough');
        const ssrP = track(XX.ssr(convertToTexture(color), depthN, normalN, { metalnessNode: mr.r, roughnessNode: mr.g, camera: cam, reflectNonMetals: true }));
        ssrP.resolutionScale = Q.ssr.scale; ssrP.quality.value = Q.ssr.quality; ssrP.maxDistance.value = 600; ssrP.thickness.value = 2.0; ssrP.intensity.value = 1.0;
        color = vec4(color.rgb.add(ssrP.getTextureNode().rgb.mul(u.ssrI).mul(0.9).mul(skyMask)), color.a);
      }
      // ── atmosphere: fog / clouds / shafts ──
      const A = Q.atmo;
      if (A.fog || A.clouds || A.shafts) {
        color = E.Atmo.node({ color: convertToTexture(color), depth: depthN, camera: cam, near: cam.near, far: cam.far, fog: A.fog, clouds: A.clouds > 0, cloudSteps: A.clouds, shafts: A.shafts > 0, shaftSteps: A.shafts });
      }
      // ── TAAU: temporal AA + upscale ──
      const beauty = track(rtt(color, null, null, { resolutionScale: scale }));
      this.beauty = beauty;
      let out;
      if (Q.taa) out = track(XX.taau(beauty, depthN, velN, cam));
      else out = beauty;
      // ── depth of field ──
      if (P.dof.on && Q.dof) out = track(XX.dof(out, sp.getViewZNode(), u.dofFocus, u.dofRange, u.dofBokeh));
      // ── motion blur ──
      if (P.motionBlur > 0.001 && Q.motionBlur) out = track(convertToTexture(XX.motionBlur(convertToTexture(out), velN.xy.mul(u.mb.mul(2.5)), X.int(Q.motionBlur))));
      // ── bloom ──
      let bloomN = null;
      if (Q.bloom) { const b = track(XX.bloom(convertToTexture(out), u.bloomS, u.bloomR, u.bloomT)); bloomN = b; }
      const hdr = convertToTexture(out);

      // ── output stage: CA, tone map, grade ──
      const final = Fn(() => {
        const p = uv();
        const c = p.sub(0.5), r2 = dot(c, c);
        const ab = c.mul(r2).mul(u.ca);
        const col = (Q.ca ? vec3(hdr.sample(p.add(ab)).r, hdr.sample(p).g, hdr.sample(p.sub(ab)).b) : hdr.sample(p).rgb).toVar();
        if (bloomN) col.addAssign(bloomN.rgb);
        const tm = toneMapping(T.ACESFilmicToneMapping, u.exposure, col).rgb;
        const srgb = convertColorSpace(tm, T.LinearSRGBColorSpace, T.SRGBColorSpace).toVar();
        // lift / gamma / gain
        srgb.assign(pow(max(srgb.mul(u.gain).add(u.lift), 0.0), float(1).div(u.gamma)));
        const l = dot(srgb, vec3(0.2126, 0.7152, 0.0722));
        srgb.assign(mix(vec3(l), srgb, u.sat.sub(u.damage.mul(0.5))));
        srgb.assign(srgb.sub(0.5).mul(u.contrast).add(0.5));
        // vignette (tightens when zoomed), damage tint, fade
        srgb.mulAssign(float(1).sub(smoothstep(0.12, 0.85, r2.mul(u.zoom.mul(2.4).add(1.6))).mul(u.vig.add(u.zoom.mul(0.5)))));
        srgb.assign(mix(srgb, vec3(0.75, 0.03, 0.0).mul(l.add(0.4)), smoothstep(0.08, 0.5, r2).mul(u.damage)));
        if (Q.grain) srgb.addAssign(interleavedGradientNoise(screenCoordinate.xy.add(u.time.mul(37.0))).sub(0.5).mul(u.grain));
        const o = max(srgb, 0.0).mul(float(1).sub(u.fade)); return vec4(o.x, o.y, o.z, 1.0);
      })();
      this.pipeline.outputNode = final;
      this.pipeline.needsUpdate = true;
    }

    render() { this.pipeline.render(); }
    dispose() { for (const n of this._nodes) { try { n.dispose && n.dispose(); } catch (e) { /* ignore */ } } this.pipeline.dispose && this.pipeline.dispose(); }
  }

  E.Post = Post;
  E.Post.BIOME_GRADE = BIOME_GRADE;
  E.Post.DEFAULTS = DEFAULTS;
})(window.E = window.E || {});
