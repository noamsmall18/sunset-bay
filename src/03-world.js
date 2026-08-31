// 03-world.js - the collision and surface model everything physical queries.
// Buildings are axis-aligned boxes in a hash grid; drivable ground is a set of
// flat and sloped quads layered over an infinite plane at y = 0, which is what
// lets cars climb the parking structure and launch off ramps.
(function (SB) {
  'use strict';

  var M = SB.M;

  function World() {
    this.boxes = [];                 // solid, blocks movement
    this.boxGrid = new SB.Grid(28);
    this.surfaces = [];              // drivable / walkable quads above y=0
    this.surfGrid = new SB.Grid(28);
    this.landingZones = [];           // authored aircraft touchdown areas
    this.waterZones = [];              // enclosed marinas / artificial basins
    this._stamp = 1;
    this._q = [];
    this.groundY = 0;
    this.beachX = -Infinity;         // west of this the ground slopes to sea
    this.waterY = -1.4;
    this.wetness = 0;                // driven by the weather, read by tyres
    this.weatherState = 'sun';
    this.weatherBlend = 0;
    this.snowAmount = 0;
    this.snowZones = [];
  }

  // --------------------------------------------------------------- solids --
  // kind: 'building' | 'prop' | 'wall'. `soft` props (bins, cones) get pushed
  // by cars instead of stopping them, so they are tracked separately.
  World.prototype.addBox = function (x0, z0, x1, z1, y0, y1, kind, ref) {
    var b = {
      x0: Math.min(x0, x1), x1: Math.max(x0, x1),
      z0: Math.min(z0, z1), z1: Math.max(z0, z1),
      y0: y0, y1: y1, kind: kind || 'building', ref: ref || null, _stamp: 0
    };
    this.boxes.push(b);
    this.boxGrid.insert(b, b.x0, b.z0, b.x1, b.z1);
    return b;
  };

  // Oriented solid. Buildings on a curved street have to face the street, and
  // an axis-aligned box around a rotated building leaves invisible walls on
  // the pavement, so rotated geometry gets a real oriented collider.
  World.prototype.addOBB = function (cx, cz, hw, hd, yaw, y0, y1, kind, ref) {
    var c = Math.cos(yaw), s = Math.sin(yaw);
    // world-space AABB of the rotated rectangle, for broadphase only
    var ex = Math.abs(c) * hw + Math.abs(s) * hd;
    var ez = Math.abs(s) * hw + Math.abs(c) * hd;
    var b = {
      x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez,
      y0: y0, y1: y1, kind: kind || 'building', ref: ref || null, _stamp: 0,
      obb: { cx: cx, cz: cz, hw: hw, hd: hd, cos: c, sin: s }
    };
    this.boxes.push(b);
    this.boxGrid.insert(b, b.x0, b.z0, b.x1, b.z1);
    return b;
  };

  // Flat walkable/drivable platform.
  World.prototype.addPlatform = function (x0, z0, x1, z1, y, kind) {
    var s = {
      x0: Math.min(x0, x1), x1: Math.max(x0, x1),
      z0: Math.min(z0, z1), z1: Math.max(z0, z1),
      y0: y, y1: y, axis: null, kind: kind || 'concrete', _stamp: 0
    };
    this.surfaces.push(s);
    this.surfGrid.insert(s, s.x0, s.z0, s.x1, s.z1);
    return s;
  };

  // Sloped quad: height ramps linearly from y0 to y1 along `axis` ('x' or 'z')
  // across the quad's extent.
  World.prototype.addRamp = function (x0, z0, x1, z1, y0, y1, axis, kind) {
    var s = {
      x0: Math.min(x0, x1), x1: Math.max(x0, x1),
      z0: Math.min(z0, z1), z1: Math.max(z0, z1),
      y0: y0, y1: y1, axis: axis, kind: kind || 'concrete', _stamp: 0
    };
    this.surfaces.push(s);
    this.surfGrid.insert(s, s.x0, s.z0, s.x1, s.z1);
    return s;
  };

  // Aircraft use the same physical surfaces as cars and pedestrians, but a
  // landing zone carries the extra operational information needed for a
  // stable touchdown: its bounds, deck height, and the type of aircraft it is
  // intended to receive. Keeping this separate from the surface grid means a
  // runway can share an apron without changing the ordinary ground query.
  World.prototype.addLandingZone = function (x0, z0, x1, z1, y, kind, opts) {
    opts = opts || {};
    var zone = {
      x0: Math.min(x0, x1), x1: Math.max(x0, x1),
      z0: Math.min(z0, z1), z1: Math.max(z0, z1),
      y: y, kind: kind || 'runway',
      plane: opts.plane !== false, heli: opts.heli !== false,
      heading: opts.heading === undefined ? null : opts.heading,
      _stamp: 0
    };
    this.landingZones.push(zone);
    return zone;
  };

  World.prototype.landingZoneAt = function (x, z, craftType) {
    var best = null;
    for (var i = 0; i < this.landingZones.length; i++) {
      var zone = this.landingZones[i];
      if (x < zone.x0 || x > zone.x1 || z < zone.z0 || z > zone.z1) continue;
      if (craftType === 'plane' && !zone.plane) continue;
      if (craftType === 'heli' && !zone.heli) continue;
      var area = (zone.x1 - zone.x0) * (zone.z1 - zone.z0);
      if (!best || area < best._area) { best = zone; best._area = area; }
    }
    if (best) delete best._area;
    return best;
  };

  World.prototype.addWaterZone = function (x0, z0, x1, z1, seabed, level, kind) {
    var zone = {
      x0: Math.min(x0, x1), x1: Math.max(x0, x1),
      z0: Math.min(z0, z1), z1: Math.max(z0, z1),
      seabed: seabed === undefined ? -3.5 : seabed,
      level: level === undefined ? this.waterY : level,
      kind: kind || 'basin'
    };
    this.waterZones.push(zone);
    return zone;
  };

  World.prototype.waterZoneAt = function (x, z) {
    for (var i = this.waterZones.length - 1; i >= 0; i--) {
      var zone = this.waterZones[i];
      if (x >= zone.x0 && x <= zone.x1 && z >= zone.z0 && z <= zone.z1) return zone;
    }
    return null;
  };

  // A road running at an arbitrary heading up a hillside cannot be expressed
  // as an axis-aligned ramp, so surfaces can also be oriented strips: a centre
  // line with a half width, sloping from y0 at one end to y1 at the other.
  World.prototype.addStrip = function (x0, z0, x1, z1, halfW, y0, y1, kind) {
    var dx = x1 - x0, dz = z1 - z0;
    var len = Math.hypot(dx, dz) || 1;
    var ux = dx / len, uz = dz / len;
    var ex = Math.abs(ux) * len * 0.5 + Math.abs(uz) * halfW;
    var ez = Math.abs(uz) * len * 0.5 + Math.abs(ux) * halfW;
    var cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5;
    var s = {
      x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez,
      y0: y0, y1: y1, axis: null, kind: kind || 'asphalt', _stamp: 0,
      strip: { x0: x0, z0: z0, ux: ux, uz: uz, len: len, halfW: halfW }
    };
    this.surfaces.push(s);
    this.surfGrid.insert(s, s.x0, s.z0, s.x1, s.z1);
    return s;
  };

  // Is (x,z) actually on this surface? Oriented strips are narrower than the
  // AABB the broadphase used, so they need a real containment test.
  World.prototype.surfaceContains = function (s, x, z) {
    if (!s.strip) return x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1;
    var st = s.strip;
    var dx = x - st.x0, dz = z - st.z0;
    var along = dx * st.ux + dz * st.uz;
    if (along < 0 || along > st.len) return false;
    var lat = -dx * st.uz + dz * st.ux;
    return Math.abs(lat) <= st.halfW;
  };

  World.prototype.surfaceHeight = function (s, x, z) {
    if (s.strip) {
      var st = s.strip;
      var t = ((x - st.x0) * st.ux + (z - st.z0) * st.uz) / Math.max(0.001, st.len);
      return M.lerp(s.y0, s.y1, M.clamp(t, 0, 1));
    }
    if (!s.axis) return s.y0;
    var t2 = s.axis === 'x'
      ? (x - s.x0) / Math.max(0.001, s.x1 - s.x0)
      : (z - s.z0) / Math.max(0.001, s.z1 - s.z0);
    return M.lerp(s.y0, s.y1, M.clamp(t2, 0, 1));
  };

  // Surface normal, used by the car to feel gradients.
  World.prototype.surfaceNormal = function (s, out) {
    if (s.strip) {
      var st = s.strip;
      var grad = (s.y1 - s.y0) / Math.max(0.001, st.len);
      var l = Math.hypot(grad, 1);
      out.nx = -st.ux * grad / l;
      out.nz = -st.uz * grad / l;
      out.ny = 1 / l;
      return out;
    }
    if (s.axis === 'x') {
      var dx = (s.y1 - s.y0) / Math.max(0.001, s.x1 - s.x0);
      var lx = Math.hypot(dx, 1);
      out.nx = -dx / lx; out.ny = 1 / lx; out.nz = 0;
    } else if (s.axis === 'z') {
      var dz = (s.y1 - s.y0) / Math.max(0.001, s.z1 - s.z0);
      var lz = Math.hypot(dz, 1);
      out.nx = 0; out.ny = 1 / lz; out.nz = -dz / lz;
    } else {
      out.nx = 0; out.ny = 1; out.nz = 0;
    }
    return out;
  };

  // Snow is deliberately sparse: road edges, lots, parks, and a few drifts
  // can become deep while the main lanes remain passable. The weather system
  // owns the authored zones; every physical surface query gets the same
  // answer, so feet, wheels, and suspension agree about where snow is.
  World.prototype.snowDepthAt = function (x, z) {
    if (this.weatherState !== 'snow' || this.snowAmount < 0.005) return 0;
    var best = 0;
    for (var i = 0; i < this.snowZones.length; i++) {
      var zone = this.snowZones[i];
      var dx = (x - zone.x) / Math.max(0.1, zone.rx);
      var dz = (z - zone.z) / Math.max(0.1, zone.rz);
      var inside = dx * dx + dz * dz;
      if (inside >= 1) continue;
      var falloff = 1 - Math.sqrt(inside);
      best = Math.max(best, (zone.depth || 0.16) * falloff * this.snowAmount);
    }
    return best;
  };

  // Highest supporting surface at or below `fromY` (plus a small step-up
  // tolerance so wheels can climb kerbs and ramp lips).
  var _res = { y: 0, nx: 0, ny: 1, nz: 0, kind: 'asphalt', surf: null };
  World.prototype.surfaceAt = function (x, z, fromY, tol) {
    tol = tol === undefined ? 1.2 : tol;
    var best = this.baseHeight(x, z);
    var kind = best < -0.001 ? 'sand' : 'asphalt';
    var nx = 0, ny = 1, nz = 0, surf = null;
    if (this.heightField) {
      var gn = this._gn || (this._gn = { x: 0, y: 1, z: 0 });
      this.heightField.normalAt(x, z, gn);
      nx = gn.x; ny = gn.y; nz = gn.z;
      if (best > 0.05 && !this.heightField.roadAt(x, z)) kind = 'grass';
    }

    var list = this.surfGrid.queryPoint(x, z, 0.1, this._q, this._stamp++);
    var nrm = this._nrm || (this._nrm = { nx: 0, ny: 1, nz: 0 });
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (!this.surfaceContains(s, x, z)) continue;
      var h = this.surfaceHeight(s, x, z);
      if (h > fromY + tol) continue;         // above us, we are underneath it
      if (h > best) {
        best = h; kind = s.kind; surf = s;
        this.surfaceNormal(s, nrm);
        nx = nrm.nx; ny = nrm.ny; nz = nrm.nz;
      }
    }
    var snowDepth = this.snowDepthAt(x, z);
    if (snowDepth > 0.004) {
      best += snowDepth;
      kind = 'snow';
    }
    _res.y = best; _res.nx = nx; _res.ny = ny; _res.nz = nz; _res.kind = kind; _res.surf = surf;
    return _res;
  };

  // ------------------------------------------------------------- terrain ---
  // Ground height before anything is built on it. The city floor is flat, the
  // west edge ramps down into the sea, and the hills region rises as a set of
  // smooth summed bumps. Everything that touches the ground - roads, blocks,
  // buildings, wheels, footsteps - samples this one function, so the terrain
  // and the things standing on it can never disagree.
  World.prototype.hills = [];

  World.prototype.addHill = function (x, z, radius, height) {
    this.hills.push({ x: x, z: z, r: radius, h: height, inv: 1 / (radius * radius) });
    return this.hills[this.hills.length - 1];
  };

  World.prototype.terrainHeight = function (x, z) {
    var y = 0;
    var hs = this.hills;
    for (var i = 0; i < hs.length; i++) {
      var h = hs[i];
      var dx = x - h.x, dz = z - h.z;
      var d2 = (dx * dx + dz * dz) * h.inv;
      if (d2 >= 1) continue;
      // smooth falloff: flat-topped near the summit, easing to zero at the rim
      var t = 1 - d2;
      y += h.h * t * t * (3 - 2 * t) * 0.5;
    }
    return y;
  };

  // Once the terrain pass has run, the height field is the ground - it already
  // has the hills in it AND the roads carved into it, so sampling it here is
  // what guarantees the surface you drive on is the surface you can see.
  World.prototype.setHeightField = function (field) {
    this.heightField = field;
    this.groundNormal = function (x, z, out) { return field.normalAt(x, z, out); };
  };

  World.prototype.baseHeight = function (x, z) {
    var waterZone = this.waterZoneAt(x, z);
    if (waterZone) return waterZone.seabed;
    if (this.heightField) return this.heightField.at(x, z);
    if (x < this.beachX) {
      var t = M.clamp((this.beachX - x) / 90, 0, 1);
      return -t * t * 6.5;
    }
    return this.hills.length ? this.terrainHeight(x, z) : 0;
  };

  // Animated open-water surface: a handful of summed sine waves rather than a
  // simulated ocean, cheap enough to sample every physics step for however
  // many boats are afloat. Rain widens the chop.
  World.prototype.waterSurfaceHeight = function (x, z, t) {
    t = t || 0;
    var amp = 0.12 + (this.wetness || 0) * 0.35;
    var waterZone = this.waterZoneAt(x, z);
    var level = waterZone ? waterZone.level : this.waterY;
    return level +
      Math.sin(x * 0.06 + t * 1.3) * amp * 0.5 +
      Math.sin(z * 0.05 - t * 0.9) * amp * 0.4 +
      Math.sin((x + z) * 0.02 + t * 0.5) * amp * 0.6;
  };

  // Open water is defined from the real terrain below the animated surface,
  // not from a magic x threshold. Walkable ramps and piers remain dry because
  // their authored surface wins over the seabed height.
  World.prototype.waterDepth = function (x, z, t) {
    return Math.max(0, this.waterSurfaceHeight(x, z, t) - this.baseHeight(x, z));
  };

  World.prototype.isWater = function (x, z, footY, t) {
    var surface = this.waterSurfaceHeight(x, z, t);
    if (this.waterDepth(x, z, t) < 0.28) return false;
    if (footY !== undefined && footY > surface - 0.18) return false;
    var authored = this.surfaceAt(x, z, (footY === undefined ? surface : footY) + 1.2, 1.5);
    return authored.y < surface - 0.18;
  };

  // -------------------------------------------------------- circle solve ---
  // Push a circle of radius r out of every solid box it overlaps, vertically
  // filtered so you can drive over a low wall's roof or under an overhang.
  // Returns the number of contacts and writes the resolved position + the
  // summed contact normal into `out`.
  World.prototype.resolveCircle = function (x, z, r, yLow, yHigh, out, ignoreKind) {
    var pad = r + 0.05;
    var list = this.boxGrid.query(x - pad, z - pad, x + pad, z + pad, this._q, this._stamp++);
    var hits = 0, nX = 0, nZ = 0, deepest = 0;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.disabled || (ignoreKind && b.kind === ignoreKind)) continue;
      if (yHigh <= b.y0 || yLow >= b.y1) continue;    // vertically clear
      var d, ux, uz;
      if (b.obb) {
        // Work in the box's own frame, then rotate the escape direction back.
        var o = b.obb;
        var rx = x - o.cx, rz = z - o.cz;
        var lx = rx * o.cos + rz * o.sin;
        var lz = -rx * o.sin + rz * o.cos;
        var qx = M.clamp(lx, -o.hw, o.hw);
        var qz = M.clamp(lz, -o.hd, o.hd);
        var ex = lx - qx, ez = lz - qz;
        var e2 = ex * ex + ez * ez;
        if (e2 >= r * r) continue;
        var lux, luz;
        if (e2 > 1e-8) {
          d = Math.sqrt(e2); lux = ex / d; luz = ez / d;
        } else {
          var tL = lx + o.hw, tR = o.hw - lx, tB = lz + o.hd, tT = o.hd - lz;
          var mn2 = Math.min(tL, tR, tB, tT);
          if (mn2 === tL) { lux = -1; luz = 0; } else if (mn2 === tR) { lux = 1; luz = 0; }
          else if (mn2 === tB) { lux = 0; luz = -1; } else { lux = 0; luz = 1; }
          d = -mn2;
        }
        ux = lux * o.cos - luz * o.sin;
        uz = lux * o.sin + luz * o.cos;
      } else {
        var cx = M.clamp(x, b.x0, b.x1);
        var cz = M.clamp(z, b.z0, b.z1);
        var dx = x - cx, dz = z - cz;
        var d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          d = Math.sqrt(d2); ux = dx / d; uz = dz / d;
        } else {
          // centre is inside the box: escape along the shallowest face
          var toL = x - b.x0, toR = b.x1 - x, toB = z - b.z0, toT = b.z1 - z;
          var mn = Math.min(toL, toR, toB, toT);
          if (mn === toL) { ux = -1; uz = 0; } else if (mn === toR) { ux = 1; uz = 0; }
          else if (mn === toB) { ux = 0; uz = -1; } else { ux = 0; uz = 1; }
          d = -mn;
        }
      }
      var pen = r - d;
      x += ux * pen; z += uz * pen;
      nX += ux; nZ += uz;
      if (pen > deepest) deepest = pen;
      hits++;
      if (out) out.hitBox = b;
    }
    if (out) {
      out.x = x; out.z = z; out.hits = hits; out.pen = deepest;
      var l = Math.hypot(nX, nZ);
      if (l > 1e-6) { out.nx = nX / l; out.nz = nZ / l; } else { out.nx = 0; out.nz = 0; }
    }
    return hits;
  };

  // ------------------------------------------------------------ raycast ----
  // Horizontal-ish ray against solid boxes. Returns distance or -1.
  // Used by bullets and by police line-of-sight.
  var _hit = { dist: 0, box: null, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
  World.prototype.raycast = function (ox, oy, oz, dx, dy, dz, maxDist) {
    var ex = ox + dx * maxDist, ez = oz + dz * maxDist;
    var list = this.boxGrid.query(
      Math.min(ox, ex) - 1, Math.min(oz, ez) - 1,
      Math.max(ox, ex) + 1, Math.max(oz, ez) + 1,
      this._q, this._stamp++);
    var bestT = maxDist, bestBox = null, bnx = 0, bny = 0, bnz = 0;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.disabled || b.noHit) continue;
      var t0 = 0, t1 = bestT, nx = 0, ny = 0, nz = 0;
      // Oriented boxes are traced in their own frame; the resulting normal is
      // rotated back to world space after the slab test.
      var rot = b.obb || null;
      var rox = ox, roy = oy, roz = oz, rdx = dx, rdy = dy, rdz = dz;
      var blo0, bhi0, blo2, bhi2;
      if (rot) {
        var px = ox - rot.cx, pz = oz - rot.cz;
        rox = px * rot.cos + pz * rot.sin;
        roz = -px * rot.sin + pz * rot.cos;
        rdx = dx * rot.cos + dz * rot.sin;
        rdz = -dx * rot.sin + dz * rot.cos;
        blo0 = -rot.hw; bhi0 = rot.hw;
        blo2 = -rot.hd; bhi2 = rot.hd;
      } else {
        blo0 = b.x0; bhi0 = b.x1;
        blo2 = b.z0; bhi2 = b.z1;
      }
      // slab test, tracking which slab produced the entry
      var ok = true;
      var axes = 3;
      for (var a = 0; a < axes; a++) {
        var o = a === 0 ? rox : (a === 1 ? roy : roz);
        var d = a === 0 ? rdx : (a === 1 ? rdy : rdz);
        var lo = a === 0 ? blo0 : (a === 1 ? b.y0 : blo2);
        var hi = a === 0 ? bhi0 : (a === 1 ? b.y1 : bhi2);
        if (Math.abs(d) < 1e-9) {
          if (o < lo || o > hi) { ok = false; break; }
          continue;
        }
        var inv = 1 / d;
        var ta = (lo - o) * inv, tb = (hi - o) * inv;
        var sgn = -1;
        if (ta > tb) { var tmp = ta; ta = tb; tb = tmp; sgn = 1; }
        if (ta > t0) {
          t0 = ta;
          nx = a === 0 ? sgn : 0; ny = a === 1 ? sgn : 0; nz = a === 2 ? sgn : 0;
        }
        if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
      if (ok && t0 > 0.001 && t0 < bestT) {
        bestT = t0; bestBox = b;
        if (rot) {
          bnx = nx * rot.cos - nz * rot.sin;
          bnz = nx * rot.sin + nz * rot.cos;
          bny = ny;
        } else { bnx = nx; bny = ny; bnz = nz; }
      }
    }
    if (!bestBox) return null;
    _hit.dist = bestT; _hit.box = bestBox;
    _hit.x = ox + dx * bestT; _hit.y = oy + dy * bestT; _hit.z = oz + dz * bestT;
    _hit.nx = bnx; _hit.ny = bny; _hit.nz = bnz;
    return _hit;
  };

  // Cheap boolean version for line of sight; ignores props.
  World.prototype.blocked = function (ax, ay, az, bx, by, bz) {
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var len = Math.hypot(dx, dy, dz);
    if (len < 0.001) return false;
    var h = this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.4);
    return !!(h && h.box.kind === 'building');
  };

  World.prototype.pointInSolid = function (x, y, z) {
    var list = this.boxGrid.queryPoint(x, z, 0.01, this._q, this._stamp++);
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.disabled) continue;
      if (y < b.y0 || y > b.y1) continue;
      if (b.obb) {
        var o = b.obb;
        var px = x - o.cx, pz = z - o.cz;
        var lx = px * o.cos + pz * o.sin;
        var lz = -px * o.sin + pz * o.cos;
        if (Math.abs(lx) <= o.hw && Math.abs(lz) <= o.hd) return b;
      } else if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
    }
    return null;
  };

  SB.World = World;

})(window.SB = window.SB || {});
