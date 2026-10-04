// Procedural sky: an art-directed shader dome per biome (scattering-style
// gradient, sun disc + halo, drifting fbm clouds, stars and nebulae that emerge
// as the camera climbs toward space), plus distant shaded planets, moons and
// rings. Everything is generated in the shader — no images.
(function (E) {
  'use strict';

  E.GLSL_NOISE = `
    float gcH2(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float gcN2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(gcH2(i), gcH2(i + vec2(1, 0)), f.x), mix(gcH2(i + vec2(0, 1)), gcH2(i + vec2(1, 1)), f.x), f.y); }
    float gcFbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * gcN2(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
    float gcFbm3(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * gcN2(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }`;

  const hex = (h) => new E.THREE.Color(h);
  // Per-biome art direction. sun = direction to the sun; space = how much of
  // the sky is already "space" at ground level (airless worlds).
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

  function planetMesh(radius, cA, cB, seed, banded, sunDir) {
    const T = E.THREE;
    const m = new T.ShaderMaterial({
      fog: false, uniforms: { cA: { value: hex(cA) }, cB: { value: hex(cB) }, sunDir: { value: sunDir }, seed: { value: seed }, banded: { value: banded ? 1 : 0 } },
      vertexShader: 'varying vec3 vN, vP; void main(){ vN = normalize(normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: E.GLSL_NOISE + `
        varying vec3 vN, vP; uniform vec3 cA, cB, sunDir; uniform float seed, banded;
        void main(){
          vec3 n = normalize(vN);
          vec2 uv = vec2(atan(n.z, n.x) * 2.0, n.y * 6.0) + seed;
          float pat = banded > 0.5 ? gcFbm(vec2(uv.x * 0.25 + gcFbm(uv * 1.5) * 0.6, uv.y * 2.2)) : gcFbm(uv * 3.0);
          vec3 col = mix(cA, cB, smoothstep(0.3, 0.7, pat));
          if (banded < 0.5) col *= 0.75 + 0.5 * gcFbm(uv * 9.0);
          float l = smoothstep(-0.15, 0.55, dot(n, sunDir));
          float rim = pow(1.0 - max(dot(n, normalize(cameraPosition - vP)), 0.0), 3.0);
          gl_FragColor = vec4(col * (0.03 + l * 1.1) + cB * rim * l * 0.5, 1.0);
        }`,
    });
    return new T.Mesh(new T.SphereGeometry(radius, 48, 32), m);
  }
  function ringMesh(r0, r1, col) {
    const T = E.THREE, g = new T.RingGeometry(r0, r1, 96, 1);
    const m = new T.ShaderMaterial({
      fog: false, transparent: true, side: T.DoubleSide, depthWrite: false, uniforms: { col: { value: hex(col) }, r0: { value: r0 }, r1: { value: r1 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: E.GLSL_NOISE + `varying vec3 vP; uniform vec3 col; uniform float r0, r1;
        void main(){ float t = (length(vP.xy) - r0) / (r1 - r0); float b = gcN2(vec2(t * 46.0, 0.5)) * 0.7 + gcN2(vec2(t * 9.0, 3.5)) * 0.5;
          gl_FragColor = vec4(col * (0.5 + b * 0.6), smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.9, t) * b * 0.8); }`,
    });
    return new T.Mesh(g, m);
  }

  function makeSky(scene, planet, biome) {
    const T = E.THREE, S = SKY[planet.biome] || SKY.desert;
    const group = new T.Group();
    const sunDir = new T.Vector3(S.sun[0], S.sun[1], S.sun[2]).normalize();
    const uniforms = {
      top: { value: hex(S.top) }, hor: { value: hex(S.hor) }, sunDir: { value: sunDir }, sunCol: { value: hex(S.sunCol) },
      cloudCol: { value: hex(S.cloudCol) }, cloudDark: { value: hex(S.cloudDark) }, cover: { value: S.cloud },
      time: { value: 0 }, space: { value: S.space }, seed: { value: (planet.seed % 1000) * 0.37 },
      nebA: { value: hex(E.rgbStr(E.hsl2rgb((planet.seed % 97) / 97, 0.7, 0.45))) }, nebB: { value: hex(E.rgbStr(E.hsl2rgb(((planet.seed % 97) / 97 + 0.35) % 1, 0.8, 0.4))) },
    };
    const mat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, depthTest: false, fog: false, uniforms,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: E.GLSL_NOISE + `
        varying vec3 vDir; uniform vec3 top, hor, sunDir, sunCol, cloudCol, cloudDark, nebA, nebB; uniform float cover, time, space, seed;
        float stars(vec3 d, float sc){
          vec3 p = d * sc; vec3 i = floor(p), f = fract(p) - 0.5;
          float h = fract(sin(dot(i, vec3(127.1, 311.7, 74.7))) * 43758.5453);
          float s = smoothstep(0.985, 1.0, h) * smoothstep(0.38, 0.0, length(f));
          return s * (0.6 + 0.4 * sin(time * 2.0 + h * 90.0));
        }
        void main(){
          vec3 d = normalize(vDir);
          float h = max(d.y, 0.0);
          float sd = max(dot(d, sunDir), 0.0);
          vec3 sky = mix(hor, top, pow(h, 0.5));
          sky += sunCol * pow(sd, 6.0) * 0.22 * (1.0 - h);                    // warm scatter near the sun
          sky = mix(sky, hor * 0.7, smoothstep(0.0, -0.3, d.y));
          float sp = clamp(space, 0.0, 1.0) * smoothstep(-0.2, 0.35, d.y + space * 0.4);
          vec3 col = sky * (1.0 - sp * 0.97);
          // stars + nebula (space)
          float st = stars(d, 140.0) + stars(d, 260.0) * 0.6;
          vec2 nuv = vec2(atan(d.z, d.x) * 1.4, d.y * 2.6) + seed;
          float nb = gcFbm(nuv * 1.3 + gcFbm(nuv * 2.0) * 0.8);
          vec3 neb = mix(nebA, nebB, gcFbm(nuv * 0.7 + 5.0)) * smoothstep(0.42, 0.85, nb) * 0.5;
          col += (vec3(st) * 2.2 + neb) * sp;
          // clouds: project onto a plane above the viewer
          if (cover > 0.01 && d.y > 0.0) {
            vec2 cp = d.xz / (d.y + 0.14) * 1.1 + vec2(time * 0.006, time * 0.003) + seed;
            float n = gcFbm(cp + gcFbm(cp * 2.3 + time * 0.01) * 0.35);
            float dens = smoothstep(1.0 - cover, 1.0 - cover + 0.3, n + 0.18) * smoothstep(0.0, 0.16, d.y);
            float lit = smoothstep(0.2, 0.9, gcFbm(cp + sunDir.xz * 0.12) - n + 0.55);
            vec3 cc = mix(cloudDark, cloudCol, lit) + sunCol * pow(sd, 10.0) * 0.6;
            col = mix(col, cc, dens * 0.92 * (1.0 - sp * 0.85));
          }
          // sun disc + halo
          col += sunCol * (smoothstep(0.9994, 0.9998, sd) * 30.0 + pow(sd, 400.0) * 3.0 + pow(sd, 40.0) * 0.4);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const dome = new T.Mesh(new T.SphereGeometry(20000, 48, 24), mat);
    dome.renderOrder = -100; dome.frustumCulled = false;
    group.add(dome);

    // distant bodies (they ride with the dome so they never get closer)
    const r = E.RNG(planet.seed ^ 0x1234), bodies = new T.Group(); group.add(bodies);
    const place = (m, az, el, dist) => { m.position.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(dist); bodies.add(m); return m; };
    if (planet.biome === 'gas') {
      const g = place(planetMesh(6200, '#c08a5a', '#6a3a8c', planet.seed % 50, true, sunDir), 2.4, 0.42, 16000);
      const ring = ringMesh(7800, 12500, '#d8b8e8'); ring.rotation.x = 1.25; ring.rotation.y = 0.3; g.add(ring);
      place(planetMesh(520, '#8a8f9a', '#c4c9d4', 3, false, sunDir), 0.9, 0.5, 17000);
    } else {
      const n = 1 + (planet.seed % 2) + (S.space > 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const big = i === 0 && r.chance(0.5);
        const hue = r.next();
        const m = place(planetMesh(big ? r.f(1700, 2600) : r.f(380, 900), E.rgbStr(E.hsl2rgb(hue, 0.25, 0.55)), E.rgbStr(E.hsl2rgb(hue + 0.08, 0.35, 0.3)), r.f(0, 50), big && r.chance(0.5), sunDir), r.angle(), r.f(0.2, 0.75), 17500);
        if (big && r.chance(0.4)) { const ring = ringMesh(m.geometry.parameters.radius * 1.3, m.geometry.parameters.radius * 2.1, '#cfc8b8'); ring.rotation.x = r.f(1.0, 1.5); m.add(ring); }
      }
    }
    bodies.traverse(o => { if (o.isMesh) { o.renderOrder = -90; o.material.depthWrite = false; o.frustumCulled = false; } });
    scene.scene.add(group);

    const atmosphere = {
      fogColor: hex(S.fog), sunColor: hex(S.sunCol), sunDir, sunI: S.sunI, skyColor: hex(S.hor).lerp(hex(S.top), 0.45), groundColor: new T.Color().setRGB(biome.palette.low[0] / 255, biome.palette.low[1] / 255, biome.palette.low[2] / 255, T.SRGBColorSpace).multiplyScalar(0.5),
      ambI: S.amb, density: 2.0 / ((biome.challenge && biome.challenge.fog) || 3000), heightK: S.space > 0.5 ? 0.02 : 0.0045, base: 0, bloom: S.bloom,
    };
    return {
      group, dome, uniforms, atmosphere, S,
      update(t, camPos) {
        uniforms.time.value = t;
        group.position.copy(camPos);
        uniforms.space.value = Math.max(S.space, E.smoothstep(350, 1500, camPos.y) * 0.85);
      },
    };
  }

  E.makeSky = makeSky;
  E.SKY = SKY;
})(window.E = window.E || {});
