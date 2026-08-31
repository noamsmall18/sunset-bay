// 04b-terrain.js - the ground itself.
//
// The old map was a single flat plane with roads painted on it. Map 2.0 has
// hills, a shelving beach and roads that climb, so the ground is a real height
// field - and, crucially, the roads are cut into that height field rather than
// laid on top of it. Every road sample pulls the surrounding terrain toward
// the road's own height, which is what turns a switchback drawn on paper into
// something a car can actually drive up.
//
// The same field is handed to the physics world, so what you see and what you
// collide with are the same surface by construction rather than by agreement.
(function (SB) {
  'use strict';

  var M = SB.M, QB = SB.QB, Roads = SB.Roads;

  var CELL = 11;              // metres per height-field sample
  var PAD = 260;              // overrun past the road network, so the land
                              // does not visibly end inside the fog

  // ------------------------------------------------------- height field ----
  function HeightField(L) {
    var B = L.bounds;
    this.minX = B.minX - PAD;
    this.minZ = B.minZ - PAD;
    this.nx = Math.ceil((B.maxX + PAD - this.minX) / CELL) + 1;
    this.nz = Math.ceil((B.maxZ + PAD - this.minZ) / CELL) + 1;
    this.cell = CELL;
    this.h = new Float32Array(this.nx * this.nz);
    this.road = new Uint8Array(this.nx * this.nz);   // 1 where a road owns the height
    this.beachX = L.beachX;
  }

  HeightField.prototype.baseAt = function (x, z) {
    if (x < this.beachX) {
      // the shore shelves under the water instead of dropping off a cliff
      var t = M.clamp((this.beachX - x) / 110, 0, 1);
      return -t * t * 7.5;
    }
    var land = Roads.terrainAt(x, z);
    // a short run of sand between the water and the first buildings
    var s = M.clamp((x - this.beachX) / 70, 0, 1);
    return M.lerp(-0.4, land, M.smoothstep(s));
  };

  // Everything - cars, feet, road ribbons, tree placement - reads the ground
  // through this one function, so it samples the *triangles the ground mesh is
  // actually built from* rather than interpolating bilinearly across the cell.
  // A bilinear sample and a triangulated surface only agree at the grid points;
  // in between, on a steep slope, they diverge by far more than the few
  // centimetres a road decal is lifted, and the hillside tears itself apart.
  HeightField.prototype.at = function (x, z) {
    var fx = (x - this.minX) / this.cell;
    var fz = (z - this.minZ) / this.cell;
    var i = Math.floor(fx), j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= this.nx - 1 || j >= this.nz - 1) return this.baseAt(x, z);
    var tx = fx - i, tz = fz - j;
    var h = this.h, nx = this.nx;
    var h00 = h[j * nx + i], h10 = h[j * nx + i + 1];
    var h01 = h[(j + 1) * nx + i], h11 = h[(j + 1) * nx + i + 1];
    // the mesh splits each cell along the anti-diagonal (i,j+1)-(i+1,j)
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h10 * (1 - tz) + h01 * (1 - tx) + h11 * (tx + tz - 1);
  };

  // Whether the ground here is carriageway rather than open land. Drives the
  // surface kind, which in turn drives tyre grip and footstep sounds.
  HeightField.prototype.roadAt = function (x, z) {
    var i = Math.round((x - this.minX) / this.cell);
    var j = Math.round((z - this.minZ) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return false;
    return this.road[j * this.nx + i] === 1;
  };

  HeightField.prototype.normalAt = function (x, z, out) {
    var d = this.cell;
    var hx = this.at(x + d, z) - this.at(x - d, z);
    var hz = this.at(x, z + d) - this.at(x, z - d);
    var nx = -hx, ny = 2 * d, nz = -hz;
    var l = Math.hypot(nx, ny, nz) || 1;
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  };

  // Carve the roads in. Each sample looks for the nearest surface road and,
  // if it is close enough, is pulled toward that road's height - fully inside
  // the carriageway, tapering off over the verge beyond it.
  function carveRoads(field, L) {
    var q = [], stamp = 1;
    var VERGE = 13;
    for (var j = 0; j < field.nz; j++) {
      var z = field.minZ + j * field.cell;
      for (var i = 0; i < field.nx; i++) {
        var x = field.minX + i * field.cell;
        var base = field.baseAt(x, z);
        var near = L.edgeGrid.queryPoint(x, z, VERGE + 20, q, stamp++);
        var bestW = 0, bestY = 0;
        for (var k = 0; k < near.length; k++) {
          var e = near[k];
          if (e.elevated) continue;                  // flyovers do not touch the ground
          var a = L.nodes[e.a], b = L.nodes[e.b];
          var dx = b.x - a.x, dz = b.z - a.z;
          var len2 = dx * dx + dz * dz;
          if (len2 < 1e-6) continue;
          var t = M.clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
          var px = a.x + dx * t, pz = a.z + dz * t;
          var d = M.dist(px, pz, x, z);
          var half = e.width * 0.5 + 1.5;
          if (d > half + VERGE) continue;
          var w = d <= half ? 1 : 1 - M.smoothstep((d - half) / VERGE);
          if (w > bestW) { bestW = w; bestY = M.lerp(a.y, b.y, t); }
        }
        var idx = j * field.nx + i;
        field.h[idx] = bestW > 0 ? M.lerp(base, bestY, bestW) : base;
        field.road[idx] = bestW > 0.88 ? 1 : 0;
      }
    }
  }

  // --------------------------------------------------------- ground mesh ---
  // Split into a grid of chunks so the far side of the map frustum-culls
  // instead of being drawn every frame and again for every shadow cascade.
  var TERRAIN_CHUNKS = 8;

  function terrainMeshes(field, mat) {
    var meshes = [];
    var chunkCount = SB.Q && SB.Q.tier === 'low' ? 4 : TERRAIN_CHUNKS;
    var perX = Math.ceil((field.nx - 1) / chunkCount);
    var perZ = Math.ceil((field.nz - 1) / chunkCount);
    // This is a dry west-coast city, not a water meadow. The open ground is
    // scrub and bleached grass with the green only in the folds, which is what
    // stops the map between the roads reading as one enormous lawn.
    var sand = new THREE.Color(0xd8c8a0);
    var scrub = new THREE.Color(0xa79c6d);
    var straw = new THREE.Color(0xbcae7c);
    var olive = new THREE.Color(0x7e864f);
    var rock = new THREE.Color(0x968d7c);
    var road = new THREE.Color(0x4a4a4d);
    var c = new THREE.Color(), c2 = new THREE.Color();

    // cheap value noise, so the ground varies over hundreds of metres instead
    // of being one flat colour to the horizon
    function vnoise(x, z) {
      var xi = Math.floor(x), zi = Math.floor(z);
      var xf = x - xi, zf = z - zi;
      function h(a, b) {
        var n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
        return n - Math.floor(n);
      }
      var u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
      return M.lerp(M.lerp(h(xi, zi), h(xi + 1, zi), u),
        M.lerp(h(xi, zi + 1), h(xi + 1, zi + 1), u), v);
    }

    for (var cz = 0; cz < chunkCount; cz++) {
      for (var cx = 0; cx < chunkCount; cx++) {
        var i0 = cx * perX, j0 = cz * perZ;
        var i1 = Math.min(i0 + perX, field.nx - 1);
        var j1 = Math.min(j0 + perZ, field.nz - 1);
        if (i1 <= i0 || j1 <= j0) continue;
        var w = i1 - i0 + 1, d = j1 - j0 + 1;
        var pos = new Float32Array(w * d * 3);
        var nor = new Float32Array(w * d * 3);
        var uv = new Float32Array(w * d * 2);
        var col = new Float32Array(w * d * 3);
        var n = { x: 0, y: 1, z: 0 };
        var v = 0;
        for (var j = j0; j <= j1; j++) {
          for (var i = i0; i <= i1; i++) {
            var x = field.minX + i * field.cell;
            var z = field.minZ + j * field.cell;
            var y = field.h[j * field.nx + i];
            pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
            field.normalAt(x, z, n);
            nor[v * 3] = n.x; nor[v * 3 + 1] = n.y; nor[v * 3 + 2] = n.z;
            uv[v * 2] = x / 18; uv[v * 2 + 1] = z / 18;

            // ground cover follows the land: sand at the shore, grass inland,
            // dry scrub and bare rock as the slope and the altitude climb
            var slope = 1 - n.y;
            if (x < field.beachX + 46) c.copy(sand);
            else if (field.road[j * field.nx + i]) c.copy(road);
            else {
              // two octaves of drift between straw and scrub, with damper
              // hollows going olive and exposed slopes going to bare rock
              var nz2 = vnoise(x / 210, z / 210) * 0.68 + vnoise(x / 62, z / 62) * 0.32;
              c.copy(straw).lerp(scrub, M.clamp(nz2 * 1.5 - 0.25, 0, 1));
              c2.copy(olive);
              c.lerp(c2, M.clamp((0.34 - nz2) * 2.1, 0, 0.65));
              c.lerp(sand, M.clamp((field.beachX + 190 - x) / 150, 0, 0.55));
              c.lerp(rock, M.clamp((slope - 0.20) / 0.44, 0, 0.72));
              c.lerp(rock, M.clamp((y - 42) / 60, 0, 0.38));
            }
            col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
            v++;
          }
        }
        var idx = [];
        for (j = 0; j < d - 1; j++) {
          for (i = 0; i < w - 1; i++) {
            var a = j * w + i, b2 = a + 1, cc = a + w, dd = cc + 1;
            idx.push(a, cc, b2, b2, cc, dd);
          }
        }
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setIndex(idx);
        geo.computeBoundingSphere();
        var mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.renderOrder = -3;
        meshes.push(mesh);
      }
    }
    return meshes;
  }

  // ---------------------------------------------------------- road decks ---
  // A ribbon per edge plus a cap over each junction. All of it is coplanar
  // with the carved terrain and shares one material, so the places where
  // ribbons overlap at junctions resolve to the same pixels either way.
  function roadRibbons(L, field, qb, lift) {
    var i;
    for (i = 0; i < L.edges.length; i++) {
      var e = L.edges[i];
      if (e.elevated) continue;
      var a = L.nodes[e.a], b = L.nodes[e.b];
      var dx = b.x - a.x, dz = b.z - a.z;
      var len = Math.hypot(dx, dz) || 1;
      var ux = dx / len, uz = dz / len;
      var hw = e.width * 0.5;
      var px = -uz * hw, pz = ux * hw;
      // Subdivide along the road AND across it. A carriageway is up to 25 m
      // wide, and one quad that wide is a flat plank: over a hillside its
      // middle sinks into the ground and the slope tears into shards. Each
      // patch has to end up smaller than a terrain cell to sit on the surface.
      var steps = Math.max(1, Math.ceil(len / 6));
      var lanesAcross = Math.max(1, Math.ceil(e.width / 5));
      for (var s = 0; s < steps; s++) {
        var t0 = s / steps, t1 = (s + 1) / steps;
        var x0 = a.x + dx * t0, z0 = a.z + dz * t0;
        var x1 = a.x + dx * t1, z1 = a.z + dz * t1;
        for (var w = 0; w < lanesAcross; w++) {
          var o0 = -1 + (2 * w) / lanesAcross;
          var o1 = -1 + (2 * (w + 1)) / lanesAcross;
          var ax0 = x0 + px * o0, az0 = z0 + pz * o0;
          var ax1 = x0 + px * o1, az1 = z0 + pz * o1;
          var bx0 = x1 + px * o0, bz0 = z1 + pz * o0;
          var bx1 = x1 + px * o1, bz1 = z1 + pz * o1;
          qb.quad(
            ax0, field.at(ax0, az0) + lift, az0,
            ax1, field.at(ax1, az1) + lift, az1,
            bx1, field.at(bx1, bz1) + lift, bz1,
            bx0, field.at(bx0, bz0) + lift, bz0,
            (o0 + 1) * e.width / 16, len * t0 / 8,
            (o1 + 1) * e.width / 16, len * t1 / 8);
        }
      }
    }
    // junction caps: a fan over each node, wide enough to swallow the corners
    for (i = 0; i < L.nodes.length; i++) {
      var n = L.nodes[i];
      if (n.edges.length < 3) continue;
      var r = 0, ground = false;
      for (var k = 0; k < n.edges.length; k++) {
        var ed = L.edges[n.edges[k]];
        if (ed.elevated) continue;
        ground = true;
        r = Math.max(r, ed.width * 0.5);
      }
      if (!ground) continue;
      r *= 1.25;
      var SEG = 12;
      var RINGS = Math.max(1, Math.ceil(r / 5));
      for (var g = 0; g < SEG; g++) {
        var a0 = (g / SEG) * Math.PI * 2, a1 = ((g + 1) / SEG) * Math.PI * 2;
        var c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        for (var ri = 0; ri < RINGS; ri++) {
          var r0 = r * ri / RINGS, r1 = r * (ri + 1) / RINGS;
          var p0x = n.x + c0 * r0, p0z = n.z + s0 * r0;
          var p1x = n.x + c1 * r0, p1z = n.z + s1 * r0;
          var p2x = n.x + c1 * r1, p2z = n.z + s1 * r1;
          var p3x = n.x + c0 * r1, p3z = n.z + s0 * r1;
          if (ri === 0) {
            qb.tri(n.x, field.at(n.x, n.z) + lift, n.z,
              p3x, field.at(p3x, p3z) + lift, p3z,
              p2x, field.at(p2x, p2z) + lift, p2z, 0.5, 0.5, 0, 0, 1, 0);
            continue;
          }
          qb.quad(
            p0x, field.at(p0x, p0z) + lift, p0z,
            p1x, field.at(p1x, p1z) + lift, p1z,
            p2x, field.at(p2x, p2z) + lift, p2z,
            p3x, field.at(p3x, p3z) + lift, p3z, 0, 0, 1, 1);
        }
      }
    }
  }

  // Centre lines and lane dashes, stopping short of junctions so the markings
  // do not run straight through an intersection.
  function roadPaint(L, field, qb, lift) {
    for (var i = 0; i < L.edges.length; i++) {
      var e = L.edges[i];
      if (e.elevated || e.len < 26) continue;
      var a = L.nodes[e.a], b = L.nodes[e.b];
      var dx = b.x - a.x, dz = b.z - a.z;
      var len = Math.hypot(dx, dz) || 1;
      var ux = dx / len, uz = dz / len;
      var clear = Math.min(len * 0.34, 13);
      var t0 = clear / len, t1 = 1 - clear / len;
      if (e.avenue) {
        stripe(qb, field, a, ux, uz, len, t0, t1, -0.55, -0.15, lift, true);
        stripe(qb, field, a, ux, uz, len, t0, t1, 0.15, 0.55, lift, true);
      } else {
        stripe(qb, field, a, ux, uz, len, t0, t1, -0.16, 0.16, lift, false);
      }
    }
  }

  function stripe(qb, field, a, ux, uz, len, t0, t1, o0, o1, lift, solid) {
    var px = -uz, pz = ux;
    var seg = solid ? (t1 - t0) * len : 3.0;
    var gap = solid ? 0 : 4.2;
    var d = t0 * len;
    var end = t1 * len;
    while (d < end) {
      var d2 = Math.min(d + seg, end);
      var x0 = a.x + ux * d, z0 = a.z + uz * d;
      var x1 = a.x + ux * d2, z1 = a.z + uz * d2;
      qb.quad(
        x0 + px * o0, field.at(x0, z0) + lift, z0 + pz * o0,
        x0 + px * o1, field.at(x0, z0) + lift, z0 + pz * o1,
        x1 + px * o1, field.at(x1, z1) + lift, z1 + pz * o1,
        x1 + px * o0, field.at(x1, z1) + lift, z1 + pz * o0,
        0, 0, 1, 1);
      d = d2 + gap;
      if (gap === 0) break;
    }
  }

  // ---------------------------------------------------------------- build --
  SB.buildTerrain = function (scene, world, L) {
    var field = new HeightField(L);
    carveRoads(field, L);
    world.setHeightField(field);

    var root = new THREE.Group();
    root.name = 'terrain';
    scene.add(root);

    var NM = SB.Q.settings.normalMaps;
    var groundMat = new THREE.MeshStandardMaterial({
      map: SB.Tex.ground(), vertexColors: true, roughness: 0.96, metalness: 0.0
    });
    if (NM) {
      groundMat.normalMap = SB.Tex.groundNormal();
      groundMat.normalScale = new THREE.Vector2(0.55, 0.55);
    }
    var chunks = terrainMeshes(field, groundMat);
    for (var i = 0; i < chunks.length; i++) root.add(chunks[i]);

    var asphaltMat = new THREE.MeshStandardMaterial({
      map: SB.Tex.asphalt(), roughness: 0.92, metalness: 0.0,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
    });
    if (NM) {
      asphaltMat.normalMap = SB.Tex.asphaltNormal();
      asphaltMat.normalScale = new THREE.Vector2(0.7, 0.7);
    }
    var rb = new QB();
    roadRibbons(L, field, rb, 0.07);
    var roadMesh = rb.mesh(asphaltMat, false, true);
    roadMesh.renderOrder = -2;
    root.add(roadMesh);

    var paintMat = new THREE.MeshStandardMaterial({
      color: 0xe8e2cf, roughness: 0.7, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
    });
    var pb = new QB();
    roadPaint(L, field, pb, 0.10);
    var paintMesh = pb.mesh(paintMat, false, true);
    paintMesh.renderOrder = -1;
    root.add(paintMesh);

    return {
      root: root, field: field,
      materials: { ground: groundMat, asphalt: asphaltMat, paint: paintMat },
      cullables: chunks.concat([roadMesh, paintMesh])
    };
  };

  SB.HeightField = HeightField;

})(window.SB = window.SB || {});
