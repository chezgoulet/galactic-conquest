// Procedural models: infantry, vehicles, fighters, and capital ships, all built
// from code with faction-distinct hull grammar (angular Concord vs organic Pact).
// A small material cache keeps memory flat across many units.
(function (E) {
  'use strict';

  const matCache = new Map();
  function mat(faction, part, extra) {
    const pal = faction.palette;
    const key = faction.id + ':' + part;
    if (!matCache.has(key)) {
      const c = pal[part] || pal.hull;
      matCache.set(key, new E.THREE.MeshStandardMaterial({
        color: new E.THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255),
        roughness: 0.55, metalness: 0.5,
        ...(extra || {}),
      }));
    }
    return matCache.get(key);
  }
  const accentMat = (faction) => mat(faction, 'accent');
  const hullMat = (faction) => mat(faction, 'hull');
  const darkMat = (faction) => mat(faction, 'hullDark');

  // ── INFANTRY ────────────────────────────────────────────────
  function makeInfantry(faction, role) {
    const T = E.THREE;
    const g = new T.Group();
    const m = hullMat(faction), am = accentMat(faction), cm = mat(faction, 'canopies');
    // legs, torso, head, backpack, weapon
    const body = new T.Mesh(new T.CapsuleGeometry(0.32, 0.7, 4, 8), m); body.position.y = 0.95; g.add(body);
    const chest = new T.Mesh(new T.BoxGeometry(0.55, 0.5, 0.4), am); chest.position.y = 1.15; g.add(chest);
    const head = new T.Mesh(new T.SphereGeometry(0.2, 10, 8), m); head.position.y = 1.62; g.add(head);
    const visor = new T.Mesh(new T.BoxGeometry(0.24, 0.1, 0.12), cm); visor.position.set(0, 1.62, -0.16); g.add(visor);
    // weapon in front (muzzle at z=-0.7)
    const gun = new T.Mesh(new T.BoxGeometry(0.08, 0.1, 0.7), darkMat(faction)); gun.position.set(0.2, 1.05, -0.35); g.add(gun);
    // backpack (medic has a glowing cross)
    const pack = new T.Mesh(new T.BoxGeometry(0.4, 0.45, 0.2), darkMat(faction)); pack.position.set(0, 1.2, 0.28); g.add(pack);
    if (role === 'medic') { const c = new T.Mesh(new T.BoxGeometry(0.16, 0.16, 0.05), new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0x66ffcc, emissiveIntensity: 1 })); c.position.set(0, 1.2, 0.4); g.add(c); }
    if (role === 'heavy') { const sh = new T.Mesh(new T.BoxGeometry(0.7, 0.3, 0.5), am); sh.position.set(0, 1.35, 0); g.add(sh); }
    g.userData.viewH = 1.7; g.userData.role = role;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
    return g;
  }

  // ── GROUND VEHICLE ──────────────────────────────────────────
  function makeVehicle(faction, type) {
    const T = E.THREE;
    const v = E.VEHICLES[type];
    const g = new T.Group();
    const organic = faction.hull.style === 'organic';
    const hull = organic
      ? new T.CapsuleGeometry(v.r * 0.5, v.r * 1.1, 4, 10)
      : new T.BoxGeometry(v.r * 1.4, v.r * 0.6, v.r * 1.8);
    const body = new T.Mesh(hull, hullMat(faction));
    body.position.y = v.viewH * 0.5; body.rotation.x = Math.PI / 2 * (organic ? 1 : 0);
    g.add(body);
    // hover ring / skids
    const ring = new T.Mesh(new T.TorusGeometry(v.r * 0.9, v.r * 0.12, 8, 20), accentMat(faction));
    ring.rotation.x = Math.PI / 2; ring.position.y = v.viewH * 0.25; g.add(ring);
    // engine glow at rear
    const eng = new T.Mesh(new T.BoxGeometry(v.r * 0.9, v.r * 0.4, v.r * 0.4), new T.MeshStandardMaterial({ color: 0x000000, emissive: new E.THREE.Color().setRGB(faction.palette.engine[0] / 255, faction.palette.engine[1] / 255, faction.palette.engine[2] / 255), emissiveIntensity: 2 }));
    eng.position.set(0, v.viewH * 0.5, v.r * 0.9); g.add(eng);
    // turret
    const turret = new T.Group(); turret.position.y = v.viewH * 0.7; g.add(turret);
    const turretBase = new T.Mesh(new T.CylinderGeometry(v.r * 0.35, v.r * 0.5, v.r * 0.4, organic ? 14 : 6), hullMat(faction)); turret.add(turretBase);
    const barrel = new T.Mesh(new T.CylinderGeometry(0.2, 0.25, v.r * 1.6, 8), darkMat(faction));
    barrel.rotation.x = Math.PI / 2; barrel.position.z = -v.r * 0.8; turret.add(barrel);
    g.userData.turret = turret; g.userData.viewH = v.viewH; g.userData.kind = 'vehicle';
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  // ── FIGHTER ─────────────────────────────────────────────────
  function makeFighter(faction, type) {
    const T = E.THREE;
    const g = new T.Group();
    const organic = faction.hull.style === 'organic';
    const hullG = organic
      ? new T.SphereGeometry(1, 10, 8)
      : new T.ConeGeometry(1, 4, 4);
    const body = new T.Mesh(hullG, hullMat(faction));
    body.rotation.x = -Math.PI / 2; body.scale.set(0.6, 2.4, 1); g.add(body);
    // canopy
    const canopy = new T.Mesh(new T.SphereGeometry(0.4, 8, 6), mat(faction, 'canopies'));
    canopy.position.set(0, 0.4, -0.6); canopy.scale.set(0.7, 0.6, 1.2); g.add(canopy);
    // wings
    const wing = new T.Mesh(organic ? new T.ConeGeometry(1.4, 1.2, 3) : new T.BoxGeometry(3, 0.1, 1.2), hullMat(faction));
    wing.position.set(0, 0, 0.6); wing.scale.x *= (type === 'strike' ? 0.7 : 1); g.add(wing);
    // engine
    const eng = new T.Mesh(new T.CylinderGeometry(0.3, 0.4, 0.6, 8), new T.MeshStandardMaterial({ color: 0x000000, emissive: new E.THREE.Color().setRGB(faction.palette.engine[0] / 255, faction.palette.engine[1] / 255, faction.palette.engine[2] / 255), emissiveIntensity: 2 }));
    eng.rotation.x = Math.PI / 2; eng.position.set(0, 0, 2.0); g.add(eng);
    // wingtip cannons
    const cannon = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 1.2, 6), darkMat(faction));
    cannon.rotation.x = Math.PI / 2; cannon.position.set(type === 'strike' ? 1 : 1.4, 0, 0.4); g.add(cannon);
    const cannon2 = cannon.clone(); cannon2.position.x *= -1; g.add(cannon2);
    g.scale.setScalar(0.8);
    g.userData.viewH = 2.5; g.userData.kind = 'fighter'; g.userData.type = type;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  // ── CAPITAL SHIP ────────────────────────────────────────────
  // A big hull from the faction's grammar + a genome that varies proportions.
  function makeCapital(faction, type, genome) {
    const T = E.THREE;
    const c = E.CAPITALS[type];
    const g = new T.Group();
    const organic = faction.hull.style === 'organic';
    const r = genome ? genome.r : 1;
    const len = c.r * 3.2 * r, wid = c.r * 1.6 * r, hei = c.r * 0.8 * r;

    // main hull
    let hullG;
    if (organic) {
      hullG = new T.SphereGeometry(1, 18, 14);
      const body = new T.Mesh(hullG, hullMat(faction));
      body.scale.set(len, hei, wid); g.add(body);
    } else {
      hullG = new T.BoxGeometry(len, hei, wid);
      const body = new T.Mesh(hullG, hullMat(faction)); g.add(body);
      // bow plate
      const bow = new T.Mesh(new T.ConeGeometry(wid, len * 0.6, 4), hullMat(faction));
      bow.rotation.x = -Math.PI / 2; bow.rotation.z = Math.PI / 4; bow.position.z = -(len / 2) * 1.1; bow.scale.set(1, hei / wid, 1); g.add(bow);
    }
    // superstructure / bridge
    const bridge = new T.Mesh(organic ? new T.SphereGeometry(1, 12, 10) : new T.BoxGeometry(len * 0.35, hei * 1.4, wid * 0.5), hullMat(faction));
    bridge.position.y = hei * 0.8; bridge.scale.z *= organic ? 1.2 : 1; g.add(bridge);
    const bridgeWin = new T.Mesh(new T.BoxGeometry(len * 0.3, hei * 0.3, wid * 0.52), mat(faction, 'canopies'));
    bridgeWin.position.y = hei * 0.9; g.add(bridgeWin);
    // wings / fins (the faction's signature)
    const finMat = accentMat(faction);
    if (organic) {
      // flowing blades
      for (const sgn of [-1, 1]) {
        const blade = new T.Mesh(new T.ConeGeometry(wid * 0.9, len * 0.8, 4), hullMat(faction));
        blade.scale.set(1, 0.15, 0.5); blade.rotation.z = sgn * 0.5; blade.position.set(sgn * wid * 0.6, 0, len * 0.2);
        g.add(blade);
        const blade2 = new T.Mesh(new T.ConeGeometry(wid * 0.6, len * 0.5, 4), finMat);
        blade2.scale.set(1, 0.1, 0.35); blade2.rotation.z = sgn * 0.7; blade2.position.set(sgn * wid * 0.9, hei * 0.3, len * 0.1);
        g.add(blade2);
      }
    } else {
      // angular wing boxes
      for (const sgn of [-1, 1]) {
        const wing = new T.Mesh(new T.BoxGeometry(wid * 1.4, hei * 0.25, len * 0.7), hullMat(faction));
        wing.position.set(sgn * wid * 0.9, 0, len * 0.1); wing.rotation.y = sgn * 0.25; g.add(wing);
        const fin = new T.Mesh(new T.BoxGeometry(2, hei * 1.2, wid * 0.4), finMat);
        fin.position.set(sgn * wid * 1.4, hei * 0.3, -len * 0.2); g.add(fin);
      }
    }
    // engine nacelles with glow
    const engMat = new T.MeshStandardMaterial({ color: 0x000000, emissive: new E.THREE.Color().setRGB(faction.palette.engine[0] / 255, faction.palette.engine[1] / 255, faction.palette.engine[2] / 255), emissiveIntensity: 2.2 });
    for (const sgn of [-1, 1]) {
      const nac = new T.Mesh(organic ? new T.CylinderGeometry(wid * 0.25, wid * 0.3, len * 0.7, 10) : new T.BoxGeometry(wid * 0.4, hei * 0.5, len * 0.6), darkMat(faction));
      nac.rotation.x = Math.PI / 2; nac.position.set(sgn * wid * 0.7, 0, len * 0.55); g.add(nac);
      const glow = new T.Mesh(new T.CircleGeometry(wid * 0.22, 16), engMat);
      glow.position.set(sgn * wid * 0.7, 0, len * 0.9); glow.rotation.y = Math.PI; g.add(glow);
    }
    // main gun turrets (front)
    const turretGroup = new T.Group(); g.add(turretGroup);
    const nTurret = type === 'cruiser' ? 2 : 3;
    for (let i = 0; i < nTurret; i++) {
      const t = new T.Group();
      t.position.set((i - (nTurret - 1) / 2) * wid * 0.6, hei * 0.5, -len * 0.35);
      const base = new T.Mesh(new T.CylinderGeometry(wid * 0.18, wid * 0.25, hei * 0.4, organic ? 12 : 6), hullMat(faction)); t.add(base);
      const barrel = new T.Mesh(new T.CylinderGeometry(wid * 0.05, wid * 0.08, wid * 1.2, 8), darkMat(faction));
      barrel.rotation.x = Math.PI / 2; barrel.position.z = -wid * 0.7; t.add(barrel);
      turretGroup.add(t);
    }
    g.userData.turrets = turretGroup;
    g.userData.viewH = c.viewH; g.userData.kind = 'capital'; g.userData.type = type; g.userData.radius = c.r;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  E.matCache = matCache;
  E.makeInfantry = makeInfantry;
  E.makeVehicle = makeVehicle;
  E.makeFighter = makeFighter;
  E.makeCapital = makeCapital;
})(window.E = window.E || {});
