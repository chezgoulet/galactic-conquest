// Battlefield structures: command posts (platform, pylon, holo-beacon, capture
// ring), home-base bunkers and scattered barricades. The glowing parts use a
// per-post material so they can be tinted live by ownership and capture state.
(function (E) {
  'use strict';
  const GREY = { hull: [84, 90, 102], dark: [44, 48, 58], light: [128, 136, 150] };
  const TEAM_COL = { aegis: [1.0, 0.3, 0.1], verdant: [0.15, 1.0, 0.5], neutral: [0.75, 0.82, 1.0] };
  let postGeo = null, baseGeo = {}, barGeo = null;

  function postGeometry() {
    if (postGeo) return postGeo;
    const b = new E.Geo.Builder();
    b.cyl(6.5, 7.4, 0.7, 6, 0, 0.35, 0, GREY.dark);
    b.cyl(4.2, 4.6, 0.35, 6, 0, 0.85, 0, GREY.hull);
    b.cyl(0.75, 1.25, 7.5, 6, 0, 4.6, 0, GREY.hull);
    b.cyl(1.5, 0.8, 1.0, 6, 0, 8.6, 0, GREY.light);
    b.cyl(0.08, 0.08, 4.5, 4, 0, 11.3, 0, GREY.dark, { mode: 0 });
    for (let i = 0; i < 3; i++) { const a = i / 3 * E.TAU + 0.5; b.box(0.5, 3.2, 1.6, Math.cos(a) * 1.3, 2.2, Math.sin(a) * 1.3, GREY.light, { ry: -a, taper: [1, 0.3] }); b.box(1.6, 1.3, 2.4, Math.cos(a) * 5.2, 1.3, Math.sin(a) * 5.2, GREY.hull, { ry: -a + Math.PI / 2, taper: [0.8, 0.8] }); }
    postGeo = b.build(); return postGeo;
  }
  function baseGeometry(team) {
    if (baseGeo[team]) return baseGeo[team];
    const P = E.faction(team).palette, b = new E.Geo.Builder(), s = team === 'aegis' ? -1 : 1;
    // bunker behind the post (away from the front)
    b.box(18, 5.5, 11, s * 20, 2.75, 0, P.hull, { taper: [0.86, 0.8], mode: 2 });
    b.box(12, 2.4, 7, s * 20, 6.6, 0, P.hullDark, { taper: [0.8, 0.8], mode: 3 });
    b.box(0.3, 2.6, 3.2, s * 10.9, 1.5, 0, P.canopies, { emi: 1.6, mode: 0 });
    b.box(17, 0.3, 0.4, s * 20, 5.2, 5.2, P.accent, { emi: 1.4, mode: 0 }); b.box(17, 0.3, 0.4, s * 20, 5.2, -5.2, P.accent, { emi: 1.4, mode: 0 });
    b.cyl(0.25, 0.4, 9, 5, s * 25, 12, 3, P.hullDark, { mode: 0 }); b.sphere(1.6, s * 25, 16.5, 3, P.hullLight, { sy: 0.35 });
    // landing pads
    for (const z of [-24, 24]) { b.cyl(8, 8.6, 0.5, 8, s * 14, 0.25, z, P.hullDark, { mode: 2 }); b.torus(6.6, 0.16, s * 14, 0.56, z, P.glow, { rx: Math.PI / 2, emi: 2.2, mode: 0 }); }
    baseGeo[team] = b.build(); return baseGeo[team];
  }
  function barricadeGeometry() {
    if (barGeo) return barGeo;
    const b = new E.Geo.Builder();
    b.box(3.4, 1.25, 0.7, 0, 0.62, 0, GREY.hull, { taper: [0.92, 0.5] }); b.box(0.5, 1.5, 1.0, 1.9, 0.75, 0, GREY.dark); b.box(0.5, 1.5, 1.0, -1.9, 0.75, 0, GREY.dark);
    barGeo = b.build(); return barGeo;
  }

  function makePost(cp, terrain) {
    const T = E.THREE, g = new T.Group();
    g.position.set(cp.pos.x, cp.pos.y, cp.pos.z);
    const m = new T.Mesh(postGeometry(), E.Geo.material()); m.castShadow = m.receiveShadow = true; g.add(m);
    if (cp.home) { const bm = new T.Mesh(baseGeometry(cp.home), E.Geo.material()); bm.castShadow = bm.receiveShadow = true; g.add(bm); }
    // barricades around the pad
    const rng = E.RNG(cp.id * 977 + 13), n = 7, im = new T.InstancedMesh(barricadeGeometry(), E.Geo.material(), n), mat = new T.Matrix4(), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const a = i / n * E.TAU + rng.f(-0.25, 0.25), d = cp.r * rng.f(0.5, 0.92), x = Math.cos(a) * d, z = Math.sin(a) * d;
      q.setFromAxisAngle(up, -a + Math.PI / 2 + rng.f(-0.3, 0.3));
      mat.compose(new T.Vector3(x, terrain.height(cp.pos.x + x, cp.pos.z + z) - cp.pos.y, z), q, new T.Vector3(1, 1, 1)); im.setMatrixAt(i, mat);
    }
    im.castShadow = im.receiveShadow = true; g.add(im);
    // glow: beam, holo ring, ground ring (tinted live)
    const glow = E.Mat.emissive({ color: 0xffffff, opacity: 0.9, additive: true, side: 'double' });
    const beamMat = E.Mat.emissive({ color: 0xffffff, opacity: 0.16, additive: true, side: 'double' });
    const beam = new T.Mesh(new T.CylinderGeometry(0.5, 1.5, 220, 10, 1, true), beamMat); beam.position.y = 119; g.add(beam);
    const holo = new T.Mesh(new T.TorusGeometry(2.3, 0.12, 6, 28), glow); holo.position.y = 10.4; holo.rotation.x = Math.PI / 2; g.add(holo);
    const holo2 = new T.Mesh(new T.TorusGeometry(1.5, 0.08, 6, 24), glow); holo2.position.y = 11.6; g.add(holo2);
    const ringMat = E.Mat.emissive({ color: 0xffffff, opacity: 0.55, additive: true, side: 'double' });
    const ring = new T.Mesh(new T.RingGeometry(cp.r - 0.5, cp.r, 72).rotateX(-Math.PI / 2), ringMat); ring.position.y = 0.25; g.add(ring);
    const light = new T.PointLight(0xffffff, 60, 46, 1.6); light.position.y = 9; g.add(light);
    return { g, glow, beamMat, ringMat, holo, holo2, light, col: new T.Color(1, 1, 1) };
  }

  function updatePost(p, cp, t, dt) {
    const a = TEAM_COL.aegis, v = TEAM_COL.verdant, n = TEAM_COL.neutral, k = Math.abs(cp.cap), c = cp.cap >= 0 ? a : v;
    const own = cp.owner ? 1 : k * 0.85;
    let r = n[0] + (c[0] - n[0]) * own, g = n[1] + (c[1] - n[1]) * own, b = n[2] + (c[2] - n[2]) * own;
    const pulse = cp.contested || (!cp.owner && k > 0.02) || (cp.owner && k < 0.99) ? 0.65 + 0.35 * Math.sin(t * 9) : 1;
    p.col.setRGB(r * 2.4 * pulse, g * 2.4 * pulse, b * 2.4 * pulse);
    p.glow.color.copy(p.col); p.beamMat.color.copy(p.col); p.ringMat.color.copy(p.col); p.light.color.setRGB(r, g, b);
    p.holo.rotation.z += dt * 0.8; p.holo2.rotation.y += dt * 1.6; p.holo2.rotation.x += dt * 0.5;
  }

  E.Props = { makePost, updatePost, TEAM_COL };
})(window.E = window.E || {});
