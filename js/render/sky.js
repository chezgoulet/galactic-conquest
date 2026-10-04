// Procedural sky: a shader sky-dome (horizon->zenith gradient with a sun glow),
// a starfield, and distant moons/asteroids. All generated from code, no images.
(function (E) {
  'use strict';

  function makeSky(scene, planet, biome) {
    const T = E.THREE;
    const group = new T.Group();

    // Sky dome: big inverted sphere with a gradient + sun glow shader.
    const geo = new T.SphereGeometry(48000, 32, 16);
    const pal = biome.palette;
    const sun = biome.sun || {};
    const uniforms = {
      top: { value: new T.Color().setRGB(pal.skyHi[0] / 255, pal.skyHi[1] / 255, pal.skyHi[2] / 255) },
      bot: { value: new T.Color().setRGB(pal.sky[0] / 255, pal.sky[1] / 255, pal.sky[2] / 255) },
      sunDir: { value: new T.Vector3(sun.dir ? sun.dir[0] : 0.4, sun.dir ? sun.dir[1] : 0.6, sun.dir ? sun.dir[2] : -0.5).normalize() },
      sunCol: { value: new T.Color().setRGB(sun.color[0] / 255, sun.color[1] / 255, sun.color[2] / 255) },
      sunI: { value: (sun.strength || 1) },
      offset: { value: 6 },
      exponent: { value: 0.9 },
    };
    const mat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false, uniforms,
      vertexShader: `
        varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vDir; uniform vec3 top,bot,sunDir,sunCol; uniform float sunI,offset,exponent;
        void main(){
          float h = clamp(vDir.y,0.0,1.0);
          vec3 col = mix(bot, top, pow(h, exponent));
          float sd = max(dot(vDir, normalize(sunDir)),0.0);
          col += sunCol * (pow(sd, 900.0)*1.4 + pow(sd, 10.0)*0.12) * sunI;
          gl_FragColor = vec4(col,1.0);
        }`,
    });
    const dome = new T.Mesh(geo, mat);
    dome.renderOrder = -10;
    group.add(dome);

    // Stars (visible in the upper dome; subtle in gas biomes, bright in cratered).
    const sr = E.RNG(planet.seed ^ 0xabcd);
    const starCount = (biome.class === 'gas') ? 1600 : 900;
    const pos = new Float32Array(starCount * 3), size = new Float32Array(starCount);
    for (let i = 0; i < starCount; i++) {
      const a = sr.angle(), y = sr.f(0.1, 1.0), r = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * r * 47000; pos[i * 3 + 1] = y * 47000; pos[i * 3 + 2] = Math.sin(a) * r * 47000;
      size[i] = sr.f(0.8, 2.6);
    }
    const sg = new T.BufferGeometry();
    sg.setAttribute('position', new T.BufferAttribute(pos, 3));
    sg.setAttribute('size', new T.BufferAttribute(size, 1));
    const smat = new T.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: T.AdditiveBlending,
      uniforms: { opacity: { value: (biome.class === 'gas') ? 0.5 : 0.85 } },
      vertexShader: `uniform float opacity; attribute float size; varying float vA; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*(300.0/-mv.z); gl_Position=projectionMatrix*mv; vA=opacity; }`,
      fragmentShader: `varying float vA; void main(){ float d=length(gl_PointCoord-0.5); if(d>0.5) discard; gl_FragColor=vec4(vec3(1.0), (1.0-d*2.0)*vA); }`,
    });
    const stars = new T.Points(sg, smat);
    stars.renderOrder = -9;
    group.add(stars);

    // Moons: a few distant spheres, tinted by the biome.
    const mr = E.RNG(planet.seed ^ 0x1234);
    const moons = Math.min(planet.moons || 1, 3);
    for (let i = 0; i < moons; i++) {
      const a = mr.angle(), y = mr.f(0.15, 0.6), r = Math.sqrt(1 - y * y);
      const md = new T.Mesh(
        new T.SphereGeometry(mr.f(2600, 4200), 24, 16),
        new T.MeshStandardMaterial({ color: new T.Color().setRGB(
          (pal.mid[0] + 30) / 255, (pal.mid[1] + 30) / 255, (pal.mid[2] + 30) / 255), roughness: 0.9, metalness: 0.1 }),
      );
      md.position.set(Math.cos(a) * r, y, Math.sin(a) * r).multiplyScalar(46000);
      group.add(md);
    }

    const scene3 = scene.scene; // the three.js Scene (scene is the E.Scene wrapper)
    scene3.add(group);
    return { group, dome, mat: uniforms, stars, setSun(t) { /* day/night can drive uniforms here */ } };
  }

  E.makeSky = makeSky;
})(window.E = window.E || {});
