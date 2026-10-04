// Procedural geometry toolkit. Every model in the game is assembled from
// primitives and lofted hulls by a Builder, then merged into ONE BufferGeometry
// with per-vertex colour and an `aFx` attribute (x = emissive strength,
// y = surface mode: 0 plain, 1 fine panels, 2 coarse panels, 3 panels+windows),
// so a whole ship draws in a single call with a shared material.
(function (E) {
  'use strict';

  const lin = (c) => { const T = E.THREE, k = new T.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, T.SRGBColorSpace); return [k.r, k.g, k.b]; };
  const shade = (c, k) => [E.clamp(c[0] * k, 0, 255), E.clamp(c[1] * k, 0, 255), E.clamp(c[2] * k, 0, 255)];

  class Builder {
    constructor() { this.pos = []; this.nor = []; this.col = []; this.fx = []; this._m = new E.THREE.Matrix4(); this._e = new E.THREE.Euler(); this._q = new E.THREE.Quaternion(); }

    // add any BufferGeometry, transformed, with a flat colour
    add(geo, x, y, z, color, o) {
      const T = E.THREE; o = o || {};
      const sc = new T.Vector3(o.sx || 1, o.sy || 1, o.sz || 1);
      this._e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'); this._q.setFromEuler(this._e);
      this._m.compose(new T.Vector3(x, y, z), this._q, sc);
      let g = geo.index ? geo.toNonIndexed() : geo.clone();
      g.applyMatrix4(this._m);
      if (!o.smooth) g.computeVertexNormals();
      const p = g.attributes.position.array, n = g.attributes.normal.array, c = lin(color);
      const emi = o.emi || 0, mode = o.mode === undefined ? 1 : o.mode;
      for (let i = 0; i < p.length; i += 3) {
        this.pos.push(p[i], p[i + 1], p[i + 2]); this.nor.push(n[i], n[i + 1], n[i + 2]);
        this.col.push(c[0], c[1], c[2]); this.fx.push(emi, mode);
      }
      g.dispose(); if (geo !== g) geo.dispose();
      return this;
    }
    // box; o.taper = [tx, tz] scales the top face (wedges, sloped armour); o.shear = z-offset of the top
    box(w, h, d, x, y, z, color, o) {
      const g = new E.THREE.BoxGeometry(w, h, d);
      if (o && (o.taper || o.shear)) {
        const p = g.attributes.position, tx = o.taper ? o.taper[0] : 1, tz = o.taper ? o.taper[1] : 1, sh = o.shear || 0;
        for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * tx); p.setZ(i, p.getZ(i) * tz + sh); }
      }
      return this.add(g, x, y, z, color, o);
    }
    cyl(rt, rb, h, seg, x, y, z, color, o) { return this.add(new E.THREE.CylinderGeometry(rt, rb, h, seg || 8), x, y, z, color, o); }
    sphere(r, x, y, z, color, o) { return this.add(new E.THREE.SphereGeometry(r, (o && o.seg) || 10, (o && o.seg2) || 8), x, y, z, color, Object.assign({ smooth: true }, o)); }
    cone(r, h, seg, x, y, z, color, o) { return this.add(new E.THREE.ConeGeometry(r, h, seg || 8), x, y, z, color, o); }
    torus(r, t, x, y, z, color, o) { return this.add(new E.THREE.TorusGeometry(r, t, 6, (o && o.seg) || 18), x, y, z, color, o); }

    // Loft a hull along +z through cross-sections {z, w, h, y?, x?, p?}. p is the
    // superellipse power: 2 = round, 5+ = boxy. n = sides around.
    loft(secs, color, o) {
      const T = E.THREE; o = o || {};
      const n = o.n || 10, P = [], I = [];
      const pw = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
      for (let i = 0; i < secs.length; i++) {
        const s = secs[i], e = 2 / (s.p || o.p || 2);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * E.TAU + (o.rot || 0);
          P.push((s.x || 0) + pw(Math.cos(a), e) * s.w * 0.5, (s.y || 0) + pw(Math.sin(a), e) * s.h * 0.5, s.z);
        }
      }
      for (let i = 0; i < secs.length - 1; i++) for (let k = 0; k < n; k++) {
        const a = i * n + k, b = i * n + (k + 1) % n, c = a + n, d = b + n;
        I.push(a, b, c, b, d, c);
      }
      // end caps
      const cap = (i, flip) => { const s = secs[i], ci = P.length / 3; P.push(s.x || 0, s.y || 0, s.z);
        for (let k = 0; k < n; k++) { const a = i * n + k, b = i * n + (k + 1) % n; flip ? I.push(ci, b, a) : I.push(ci, a, b); } };
      cap(0, true); cap(secs.length - 1, false);
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
      return this.add(g, o.x || 0, o.y || 0, o.z || 0, color, o);
    }

    build() {
      const T = E.THREE, g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(this.nor, 3));
      g.setAttribute('color', new T.Float32BufferAttribute(this.col, 3));
      g.setAttribute('aFx', new T.Float32BufferAttribute(this.fx, 2));
      g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    }
  }

  // Shared hull material (PBR + vertex colour + procedural panels/windows/emissive) lives in the
  // material factory: see E.Mat.hull() in mat.js.
  const material = () => E.Mat.hull();

  E.Geo = { Builder, material, lin, shade };
})(window.E = window.E || {});
