// Builds the visible planet surface from the pure terrain sampler: a
// vertex-colored heightfield, an animated water plane, and instanced cover
// (rocks, vegetation, ruins). All geometry and color from code.
(function (E) {
  'use strict';

  function buildTerrain(scene, terrain, biome, quality) {
    const T = E.THREE;
    const R = (quality === 'low' ? 96 : 160);       // grid resolution
    const EXT = 4000;                                // half-extent of the tile
    const pal = biome.palette;
    const water = biome.water || {};
    const wlevel = (water.level || 0) * 90;          // meters
    const group = new T.Group();

    const pos = new Float32Array((R + 1) * (R + 1) * 3);
    const col = new Float32Array((R + 1) * (R + 1) * 3);
    const idx = [];
    const rng = E.RNG(terrain.planet.seed ^ 0x51);
    let k = 0;
    const cLow = pal.low, cMid = pal.mid, cHigh = pal.high;
    for (let iz = 0; iz <= R; iz++) {
      for (let ix = 0; ix <= R; ix++) {
        const x = -EXT + (ix / R) * EXT * 2;
        const z = -EXT + (iz / R) * EXT * 2;
        const h = terrain.height(x, z);
        const sl = terrain.slope(x, z);
        pos[k] = x; pos[k + 1] = h; pos[k + 2] = z; k += 3;

        // color: blend low->mid->high by height, darken rock on steep slopes
        const t = E.clamp01(E.invLerp(-40, 120, h));
        let c = t < 0.5 ? E.mixC(cLow, cMid, t * 2) : E.mixC(cMid, cHigh, (t - 0.5) * 2);
        const rock = E.clamp01(sl * 0.8) * 0.7;
        c = E.mixC(c, [90, 88, 92], rock);
        // waterline tint (wet)
        if (water.cover > 0.05 && h < wlevel + 3) c = E.mixC(c, water.color, 0.5);
        // slight per-vertex jitter to kill banding
        const j = (rng.next() - 0.5) * 6;
        col[k - 3] = E.clamp(c[0] + j, 0, 255) / 255;
        col[k - 2] = E.clamp(c[1] + j, 0, 255) / 255;
        col[k - 1] = E.clamp(c[2] + j, 0, 255) / 255;
      }
    }
    for (let iz = 0; iz < R; iz++) {
      for (let ix = 0; ix < R; ix++) {
        const a = iz * (R + 1) + ix, b = a + 1, c = a + R + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02, flatShading: false });
    const mesh = new T.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);

    // Water plane (animated shader for oceans; simple elsewhere)
    if (water.cover > 0.02) {
      const wg = new T.PlaneGeometry(EXT * 2.2, EXT * 2.2, 48, 48);
      wg.rotateX(-Math.PI / 2);
      const wm = new T.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: {
          time: { value: 0 },
          cA: { value: new T.Color().setRGB(water.color[0] / 255, water.color[1] / 255, water.color[2] / 255) },
          cB: { value: new T.Color().setRGB(1, 1, 1) },
          amp: { value: (water.swell || biome.weather && biome.weather.swell ? 1.0 : 0.3) },
        },
        vertexShader: `uniform float time,amp; varying float vW;
          void main(){ vec3 p=position; float w=sin(p.x*0.03+time*1.3)*amp+cos(p.z*0.04+time*1.7)*amp; p.y+=w; vW=w;
            gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); }`,
        fragmentShader: `uniform vec3 cA,cB; varying float vW;
          void main(){ float f=clamp(0.5+vW*0.15,0.0,1.0); gl_FragColor=vec4(mix(cA,cB,f*0.2),0.75); }`,
      });
      const waterMesh = new T.Mesh(wg, wm);
      waterMesh.position.y = wlevel;
      group.add(waterMesh);
      group.userData.water = waterMesh;
    }

    buildCover(group, terrain, biome, R);
    scene.world.add(group);
    return group;
  }

  // Instanced cover. Density and kinds come from the biome's cover table.
  function buildCover(group, terrain, biome, res) {
    const T = E.THREE;
    const cov = biome.cover || {};
    const EXT = 3800;
    const rng = E.RNG(terrain.planet.seed ^ 0x99);
    const n = E.Noise(terrain.planet.seed ^ 0x44);
    const place = (proto, count, tint) => {
      if (count < 1) return;
      const mat = new T.MeshStandardMaterial({ color: tint, roughness: 0.9, metalness: 0.05 });
      const im = new T.InstancedMesh(proto, mat, count);
      const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3();
      let placed = 0, tries = count * 8;
      while (placed < count && tries-- > 0) {
        const x = rng.f(-EXT, EXT), z = rng.f(-EXT, EXT);
        const h = terrain.height(x, z);
        if (h < (biome.water ? (biome.water.level || 0) * 90 + 1 : -6)) continue; // don't sink in water
        p.set(x, h, z); q.setFromAxisAngle(new T.Vector3(0, 1, 0), rng.angle());
        const sc = rng.f(0.7, 1.6); s.set(sc, sc, sc);
        m.compose(p, q, s); im.setMatrixAt(placed, m); placed++;
      }
      im.count = placed; im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.receiveShadow = true;
      group.add(im);
    };

    // rocks
    const rockG = new T.IcosahedronGeometry(3, 0);
    place(rockG, Math.round((cov.rocks || 0) * 220), 0x6b6f78);
    // ice chunks (tundra/cratered)
    if (cov.ice) place(new T.IcosahedronGeometry(4, 0), Math.round(cov.ice * 160), 0xbcd4e6);
    // cacti
    if (cov.cactus) place(new T.CylinderGeometry(0.6, 0.9, 5, 5), Math.round(cov.cactus * 120), 0x5f8a4a);
    // vegetation (trees) — a simple trunk + canopy combo
    if (cov.trees) {
      const count = Math.round(cov.trees * 260);
      const trunkG = new T.CylinderGeometry(0.5, 0.8, 4, 5);
      const canG = new T.IcosahedronGeometry(3.4, 0);
      const trunkMat = new T.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 });
      const canMat = new T.MeshStandardMaterial({ color: 0x2f6b34, roughness: 1 });
      const trunks = new T.InstancedMesh(trunkG, trunkMat, count);
      const cans = new T.InstancedMesh(canG, canMat, count);
      const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(), p2 = new T.Vector3();
      let placed = 0, tries = count * 8;
      while (placed < count && tries-- > 0) {
        const x = rng.f(-EXT, EXT), z = rng.f(-EXT, EXT);
        const h = terrain.height(x, z);
        if (h < (biome.water ? (biome.water.level || 0) * 90 + 1 : -6)) continue;
        p.set(x, h + 2, z); q.setFromAxisAngle(new T.Vector3(0, 1, 0), rng.angle());
        const sc = rng.f(0.8, 2.0); s.set(sc, sc, sc);
        m.compose(p, q, s); trunks.setMatrixAt(placed, m);
        p2.set(x, h + 6 * sc, z); m.compose(p2, q, s); cans.setMatrixAt(placed, m);
        placed++;
      }
      trunks.count = placed; cans.count = placed;
      trunks.instanceMatrix.needsUpdate = true; cans.instanceMatrix.needsUpdate = true;
      trunks.castShadow = cans.castShadow = true; trunks.receiveShadow = true;
      group.add(trunks, cans);
    }
    // buildings / ruins (urban)
    if (cov.buildings) {
      const count = Math.round(cov.buildings * 240);
      const g = new T.BoxGeometry(1, 1, 1);
      const mat = new T.MeshStandardMaterial({ color: 0x8a8f9c, roughness: 0.8, metalness: 0.1 });
      const im = new T.InstancedMesh(g, mat, count);
      const m = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3();
      let placed = 0, tries = count * 8;
      while (placed < count && tries-- > 0) {
        const x = rng.f(-EXT, EXT), z = rng.f(-EXT, EXT);
        const h = terrain.height(x, z);
        p.set(x, h, z); q.setFromAxisAngle(new T.Vector3(0, 1, 0), (rng.next() < 0.5 ? 0 : Math.PI / 2));
        const w = rng.f(6, 16), hgt = rng.f(10, 70); s.set(w, hgt, w * rng.f(0.8, 1.4));
        m.compose(p, q, s); m.elements[13] += hgt / 2; im.setMatrixAt(placed, m); placed++;
      }
      im.count = placed; im.instanceMatrix.needsUpdate = true; im.castShadow = im.receiveShadow = true;
      group.add(im);
    }
  }

  E.buildTerrain = buildTerrain;
  E.buildCover = buildCover;
})(window.E = window.E || {});
