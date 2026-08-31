// 04-geom.js - a tiny quad-soup builder. Everything static in the city is
// pushed through this so an entire district collapses into one draw call.
(function (SB) {
  'use strict';

  function QB() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
    this.col = null;          // filled lazily, only if anyone sets a colour
    this.count = 0;
    this._r = 1; this._g = 1; this._b = 1;
  }

  // Tint everything emitted from here on. One batch can then carry a whole
  // district's worth of differently coloured buildings without needing a
  // material - and a material per building would cost a draw call per
  // building, which is the thing the batching exists to avoid.
  QB.prototype.setColor = function (hex) {
    if (!this.col) {
      this.col = [];
      // anything already emitted was untinted; back-fill it as white
      for (var i = 0; i < this.count; i++) this.col.push(1, 1, 1);
    }
    this._r = ((hex >> 16) & 255) / 255;
    this._g = ((hex >> 8) & 255) / 255;
    this._b = (hex & 255) / 255;
    return this;
  };

  QB.prototype._pushCol = function (n) {
    if (!this.col) return;
    for (var i = 0; i < n; i++) this.col.push(this._r, this._g, this._b);
  };

  // Corners in order a-b-c-d (counter-clockwise seen from the front face).
  // UVs map a->(u0,v0), b->(u1,v0), c->(u1,v1), d->(u0,v1).
  QB.prototype.quad = function (
    ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz,
    u0, v0, u1, v1) {
    var e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    var e2x = dx - ax, e2y = dy - ay, e2z = dz - az;
    var nx = e1y * e2z - e1z * e2y;
    var ny = e1z * e2x - e1x * e2z;
    var nz = e1x * e2y - e1y * e2x;
    var l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) { nx = 0; ny = 1; nz = 0; } else { nx /= l; ny /= l; nz /= l; }

    var p = this.pos, n = this.nor, u = this.uv, i = this.idx;
    p.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
    u.push(u0, v0, u1, v0, u1, v1, u0, v1);
    var b = this.count;
    i.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.count += 4;
    this._pushCol(4);
    return this;
  };

  // Axis-aligned box. `uScale`/`vScale` are metres per texture tile on the
  // sides; roofs use `topU`. Pass skipTop/skipBottom to drop hidden faces.
  QB.prototype.box = function (x0, y0, z0, x1, y1, z1, uScale, vScale, topU, opts) {
    opts = opts || {};
    var w = x1 - x0, d = z1 - z0, h = y1 - y0;
    var uw = w / uScale, ud = d / uScale, vh = h / vScale;
    var vOff = opts.vOffset || 0;

    if (!opts.skipSides) {
      // v runs 0 at the kerb to vh at the parapet: textures are authored with
      // their ground floor at the bottom of the canvas.
      // +z face
      this.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, 0, vOff, uw, vOff + vh);
      // -z face
      this.quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, 0, vOff, uw, vOff + vh);
      // +x face
      this.quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 0, vOff, ud, vOff + vh);
      // -x face
      this.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, 0, vOff, ud, vOff + vh);
    }
    if (!opts.skipTop) {
      var tu = topU || uScale;
      this.quad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 0, w / tu, d / tu);
    }
    if (opts.bottom) {
      this.quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, 0, w / (topU || uScale), d / (topU || uScale));
    }
    return this;
  };

  // Oriented box: the same as `box`, but rotated about Y. `hw` runs along the
  // box's local x axis (cos yaw, sin yaw) and `hd` along its local z axis
  // (-sin yaw, cos yaw) - the same convention the physics world uses for
  // oriented colliders, so a building's geometry and its collider are built
  // from one set of numbers. This is what lets buildings face a curved street
  // instead of all facing north.
  QB.prototype.obox = function (cx, y0, cz, hw, hd, y1, yaw, uScale, vScale, topU, opts) {
    opts = opts || {};
    var c = Math.cos(yaw), s = Math.sin(yaw);
    var axx = c * hw, axz = s * hw;          // half-extent along local x
    var azx = -s * hd, azz = c * hd;         // half-extent along local z
    // corners, counter-clockwise seen from above
    var p0x = cx - axx - azx, p0z = cz - axz - azz;
    var p1x = cx + axx - azx, p1z = cz + axz - azz;
    var p2x = cx + axx + azx, p2z = cz + axz + azz;
    var p3x = cx - axx + azx, p3z = cz - axz + azz;
    var vh = (y1 - y0) / vScale;
    var vOff = opts.vOffset || 0;
    var uw = (hw * 2) / uScale, ud = (hd * 2) / uScale;

    if (!opts.skipSides) {
      this.quad(p0x, y0, p0z, p1x, y0, p1z, p1x, y1, p1z, p0x, y1, p0z, 0, vOff, uw, vOff + vh);
      this.quad(p1x, y0, p1z, p2x, y0, p2z, p2x, y1, p2z, p1x, y1, p1z, 0, vOff, ud, vOff + vh);
      this.quad(p2x, y0, p2z, p3x, y0, p3z, p3x, y1, p3z, p2x, y1, p2z, 0, vOff, uw, vOff + vh);
      this.quad(p3x, y0, p3z, p0x, y0, p0z, p0x, y1, p0z, p3x, y1, p3z, 0, vOff, ud, vOff + vh);
    }
    if (!opts.skipTop) {
      var tu = topU || uScale;
      this.quad(p0x, y1, p0z, p3x, y1, p3z, p2x, y1, p2z, p1x, y1, p1z,
        0, 0, (hw * 2) / tu, (hd * 2) / tu);
    }
    return this;
  };

  // Fill a polygon as a fan from its centroid. City blocks are recovered as
  // road faces, which are convex enough for a fan; `yAt` lets the fill drape
  // over sloping ground instead of hovering flat above it.
  QB.prototype.polyFill = function (poly, yAt, uScale) {
    var s = uScale || 1;
    var n = poly.length, i;
    if (n < 3) return this;
    var cx = 0, cz = 0, area = 0;
    for (i = 0; i < n; i++) {
      cx += poly[i].x; cz += poly[i].z;
      var q = poly[(i + 1) % n];
      area += poly[i].x * q.z - q.x * poly[i].z;
    }
    cx /= n; cz /= n;
    // Ground faces up. Winding decides which way the normal points, and an
    // inset polygon can come back wound the other way - which would light this
    // surface from underneath and render it black.
    var flip = area < 0;
    var cy = typeof yAt === 'function' ? yAt(cx, cz) : yAt;
    for (i = 0; i < n; i++) {
      var a = poly[flip ? (n - 1 - i) : i];
      var b = poly[flip ? (n - 1 - (i + 1) % n) : (i + 1) % n];
      if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6) continue;
      var ay = typeof yAt === 'function' ? yAt(a.x, a.z) : yAt;
      var by = typeof yAt === 'function' ? yAt(b.x, b.z) : yAt;
      this.tri(cx, cy, cz, a.x, ay, a.z, b.x, by, b.z,
        cx / s, cz / s, a.x / s, a.z / s, b.x / s, b.z / s);
    }
    return this;
  };

  // Quad strip between two polygons with matching vertex counts - the outer
  // edge of a block and its inset lot boundary, which is exactly a pavement.
  QB.prototype.polyRing = function (outer, inner, yAt, uScale) {
    var s = uScale || 1;
    var n = Math.min(outer.length, inner.length);
    for (var i = 0; i < n; i++) {
      var a = outer[i], b = outer[(i + 1) % n];
      var c = inner[(i + 1) % n], d = inner[i];
      var ay = typeof yAt === 'function' ? yAt(a.x, a.z) : yAt;
      var by = typeof yAt === 'function' ? yAt(b.x, b.z) : yAt;
      var cy = typeof yAt === 'function' ? yAt(c.x, c.z) : yAt;
      var dy = typeof yAt === 'function' ? yAt(d.x, d.z) : yAt;
      this.quad(a.x, ay, a.z, b.x, by, b.z, c.x, cy, c.z, d.x, dy, d.z,
        a.x / s, a.z / s, c.x / s, c.z / s);
    }
    return this;
  };

  // Vertical skirt around a polygon: the kerb face.
  QB.prototype.polySkirt = function (poly, yBase, height) {
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      var ay = typeof yBase === 'function' ? yBase(a.x, a.z) : yBase;
      var by = typeof yBase === 'function' ? yBase(b.x, b.z) : yBase;
      var len = Math.hypot(b.x - a.x, b.z - a.z);
      this.quad(a.x, ay, a.z, b.x, by, b.z, b.x, by + height, b.z, a.x, ay + height, a.z,
        0, 0, len / 3, height / 3);
    }
    return this;
  };

  // Horizontal quad at height y, spanning a rectangle. Used for ground,
  // sidewalks, lot surfaces, road paint.
  QB.prototype.plane = function (x0, z0, x1, z1, y, uScale) {
    var s = uScale || 1;
    this.quad(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0,
      0, 0, (x1 - x0) / s, (z1 - z0) / s);
    return this;
  };

  // A vertical quad from (x0,z0) to (x1,z1), from y0 up to y1.
  QB.prototype.wall = function (x0, z0, x1, z1, y0, y1, uScale, vScale) {
    var len = Math.hypot(x1 - x0, z1 - z0);
    this.quad(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0,
      0, 0, len / uScale, (y1 - y0) / vScale);
    return this;
  };

  // Single triangle. Winding a-b-c decides the facing, same as quad.
  QB.prototype.tri = function (ax, ay, az, bx, by, bz, cx, cy, cz, u0, v0, u1, v1, u2, v2) {
    var e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    var e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    var nx = e1y * e2z - e1z * e2y;
    var ny = e1z * e2x - e1x * e2z;
    var nz = e1x * e2y - e1y * e2x;
    var l = Math.hypot(nx, ny, nz);
    // A degenerate triangle has no cross product to normalise, and a normal of
    // (0,0,0) shades pure black rather than disappearing - so fall back to up.
    if (l < 1e-9) { nx = 0; ny = 1; nz = 0; } else { nx /= l; ny /= l; nz /= l; }
    var p = this.pos, n = this.nor, u = this.uv, i = this.idx;
    p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    u.push(u0 || 0, v0 || 0, u1 || 0, v1 || 0, u2 || 0, v2 || 0);
    var b = this.count;
    i.push(b, b + 1, b + 2);
    this.count += 3;
    this._pushCol(3);
    return this;
  };

  QB.prototype.isEmpty = function () { return this.count === 0; };

  QB.prototype.geometry = function () {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  };

  QB.prototype.mesh = function (material, castShadow, receiveShadow) {
    var m = new THREE.Mesh(this.geometry(), material);
    m.castShadow = !!castShadow;
    m.receiveShadow = !!receiveShadow;
    m.matrixAutoUpdate = false;
    return m;
  };

  SB.QB = QB;

  // --------------------------------------------------------------- hull ----
  // Shared cross-section lofting used by car bodies, boat hulls and aircraft
  // fuselages: a chain of rounded-rectangle "stations" skinned into a tube and
  // capped at both ends.
  var Hull = SB.Hull = {};

  Hull.station = function (x, hw, y0, y1, c) {
    return { x: x, hw: hw, y0: y0, y1: y1, c: c === undefined ? 0.14 : c };
  };

  Hull.ring = function (s) {
    var hw = s.hw, y0 = s.y0, y1 = s.y1, c = Math.min(s.c, hw * 0.7, (y1 - y0) * 0.45);
    return [
      [-hw, y0 + c], [-hw + c, y0], [hw - c, y0], [hw, y0 + c],
      [hw, y1 - c], [hw - c, y1], [-hw + c, y1], [-hw, y1 - c]
    ];
  };

  // Stations run nose (max x) to tail (min x). The skin quad is wound
  // a -> a+1 -> b+1 -> b so the surface normal points outward; the reverse
  // order leaves the hull inside out and you see straight through the body.
  Hull.loft = function (qb, stations) {
    var i, k;
    for (i = 0; i < stations.length - 1; i++) {
      var A = Hull.ring(stations[i]), B = Hull.ring(stations[i + 1]);
      var xa = stations[i].x, xb = stations[i + 1].x;
      for (k = 0; k < 8; k++) {
        var k2 = (k + 1) % 8;
        qb.quad(
          xa, A[k][1], A[k][0],
          xa, A[k2][1], A[k2][0],
          xb, B[k2][1], B[k2][0],
          xb, B[k][1], B[k][0],
          0, 0, 1, 1);
      }
    }
    Hull.capRing(qb, stations[0], 1);                       // nose, normal +x
    Hull.capRing(qb, stations[stations.length - 1], -1);    // tail, normal -x
  };

  // Triangle fan closing off an end station.
  Hull.capRing = function (qb, s, outward) {
    var R = Hull.ring(s);
    var cy = (s.y0 + s.y1) / 2;
    for (var k = 0; k < 8; k++) {
      var k2 = (k + 1) % 8;
      if (outward > 0) {
        qb.tri(s.x, cy, 0, s.x, R[k2][1], R[k2][0], s.x, R[k][1], R[k][0]);
      } else {
        qb.tri(s.x, cy, 0, s.x, R[k][1], R[k][0], s.x, R[k2][1], R[k2][0]);
      }
    }
  };

  // Merge several QBs into one geometry with per-part material groups.
  Hull.mergeGroups = function (parts) {
    var pos = [], nor = [], uv = [], idx = [];
    var groups = [];
    var base = 0, iStart = 0;
    for (var p = 0; p < parts.length; p++) {
      var qb = parts[p].qb;
      if (qb.count === 0) { groups.push(null); continue; }
      for (var i = 0; i < qb.pos.length; i++) pos.push(qb.pos[i]);
      for (i = 0; i < qb.nor.length; i++) nor.push(qb.nor[i]);
      for (i = 0; i < qb.uv.length; i++) uv.push(qb.uv[i]);
      for (i = 0; i < qb.idx.length; i++) idx.push(qb.idx[i] + base);
      groups.push({ start: iStart, count: qb.idx.length, name: parts[p].name });
      iStart += qb.idx.length;
      base += qb.count;
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    var slot = 0;
    var names = [];
    for (p = 0; p < groups.length; p++) {
      if (!groups[p]) continue;
      g.addGroup(groups[p].start, groups[p].count, slot);
      names.push(groups[p].name);
      slot++;
    }
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return { geometry: g, slots: names };
  };

  // Merge a list of {geo, matrix} into one non-indexed BufferGeometry. The UMD
  // three build ships no BufferGeometryUtils, so this stands in for it.
  SB.mergeGeos = function (parts) {
    var pos = [], nor = [], uv = [];
    var nm = new THREE.Matrix3();
    for (var p = 0; p < parts.length; p++) {
      var src = parts[p].geo.index ? parts[p].geo.toNonIndexed() : parts[p].geo;
      var m = parts[p].matrix;
      var ap = src.attributes.position.array;
      var an = src.attributes.normal ? src.attributes.normal.array : null;
      var au = src.attributes.uv ? src.attributes.uv.array : null;
      if (m) nm.getNormalMatrix(m);
      var v = new THREE.Vector3();
      for (var i = 0; i < ap.length; i += 3) {
        v.set(ap[i], ap[i + 1], ap[i + 2]);
        if (m) v.applyMatrix4(m);
        pos.push(v.x, v.y, v.z);
        if (an) {
          v.set(an[i], an[i + 1], an[i + 2]);
          if (m) v.applyMatrix3(nm).normalize();
          nor.push(v.x, v.y, v.z);
        } else nor.push(0, 1, 0);
      }
      var count = ap.length / 3;
      for (i = 0; i < count; i++) {
        uv.push(au ? au[i * 2] : 0, au ? au[i * 2 + 1] : 0);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  };

  // Build an InstancedMesh from a list, letting the caller pose a scratch
  // Object3D per item.
  SB.instances = function (geo, mat, list, pose, castShadow, receiveShadow) {
    if (!list.length) return null;
    var mesh = new THREE.InstancedMesh(geo, mat, list.length);
    var d = new THREE.Object3D();
    for (var i = 0; i < list.length; i++) {
      d.position.set(0, 0, 0);
      d.rotation.set(0, 0, 0);
      d.scale.set(1, 1, 1);
      pose(d, list[i], i);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = !!castShadow;
    mesh.receiveShadow = !!receiveShadow;
    return mesh;
  };

  // Shared unit geometries for instanced props.
  var _cache = Object.create(null);
  SB.geo = function (name, make) {
    return _cache[name] || (_cache[name] = make());
  };

})(window.SB = window.SB || {});
