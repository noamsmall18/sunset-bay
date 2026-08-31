// 05-city.js - turns the layout into geometry: ground, sidewalks, lots and
// every building in Sunset Bay. Buildings are batched by facade material so
// the whole skyline costs a couple of dozen draw calls.
(function (SB) {
  'use strict';

  var M = SB.M, Roads = SB.Roads, QB = SB.QB;
  var DIST = Roads.DIST;

  var STYLE_BY_DISTRICT = {
    downtown: ['glass', 'glass', 'concrete', 'glass', 'concrete'],
    midtown: ['concrete', 'brick', 'stucco', 'glass', 'brick'],
    residential: ['stucco', 'brick', 'stucco', 'stucco', 'brick'],
    suburb: ['stucco', 'brick', 'stucco', 'stucco'],
    hills: ['stucco', 'stucco', 'concrete', 'brick'],
    industrial: ['industrial', 'industrial', 'concrete'],
    beach: ['stucco', 'stucco', 'brick', 'concrete']
  };

  var HEIGHT_BY_DISTRICT = {
    downtown: [26, 128],
    midtown: [14, 46],
    residential: [7, 19],
    suburb: [6, 11],
    hills: [6, 14],
    industrial: [7, 15],
    beach: [6, 17]
  };

  // ------------------------------------------------------------ palette ---
  // One texture per style, but a colour per building. A city is not one shade
  // of concrete: it is a few hundred buildings that were each painted, clad or
  // weathered differently, and that variety is most of what makes a street
  // look inhabited rather than modelled.
  //
  // Each entry is [facade, structure, roof]. The structure colour is the
  // frame, slabs and mullions standing in front of the wall - usually a paler
  // or warmer relative of the facade, occasionally a metal.
  var PALETTE = {
    glass: [
      [0x6f9ec9, 0x8d949b, 0x3a3e42],
      [0x2f5f92, 0xb6bcc2, 0x33373b],
      [0x2f8378, 0x7f8a86, 0x333a37],
      [0x9c7440, 0x6f6656, 0x3c3730],
      [0x55677a, 0xd2d6da, 0x2f3336],
      [0x1f5570, 0x9aa6ae, 0x2c3033]
    ],
    concrete: [
      [0xc7ab7c, 0x9a9182, 0x4a463f],
      [0x9d9a92, 0x77756e, 0x3f3e3a],
      [0xd0aa6d, 0xa8967a, 0x4f4638],
      [0xb09070, 0x8a7f70, 0x443e37],
      [0x7e9080, 0x656d66, 0x373b38]
    ],
    brick: [
      [0x9c4a30, 0xd9cdb6, 0x3a302a],
      [0x772f22, 0xc4b49b, 0x33291f],
      [0xbb6435, 0xe6d8bd, 0x40332a],
      [0x7d5537, 0xcbbca4, 0x352d26],
      [0xa8764a, 0xe4d9c2, 0x3c332b]
    ],
    stucco: [
      [0xdcc48a, 0xfaf4e6, 0x9c4f34],
      [0xd98b4a, 0xf7ddc2, 0x8d4a30],
      [0x8fae86, 0xe8f1e6, 0x4e5b52],
      [0xd9b53f, 0xfdf1cf, 0x96593a],
      [0xc9767a, 0xf9ddd7, 0x8c4c42],
      [0x5f9aa8, 0xdfeef2, 0x47565c],
      [0xc79a5e, 0xf2e2c8, 0x8a5b3c],
      [0xa07fb0, 0xece0ea, 0x6a4560],
      [0xc9714a, 0xf6e2d4, 0x84452f]
    ],
    industrial: [
      [0x76808a, 0x5e646a, 0x35393c],
      [0x8f5334, 0x6d4b36, 0x3a2d24],
      [0x466253, 0x3f5449, 0x2c3833],
      [0x8a7c63, 0x6a6357, 0x3b3833],
      [0x4a5f73, 0x445260, 0x2d3439]
    ]
  };

  function paletteFor(style, seed) {
    var set = PALETTE[style] || PALETTE.concrete;
    return set[Math.abs(seed) % set.length];
  }

  function shade(hex, k) {
    var r = Math.round(((hex >> 16) & 255) * k);
    var g = Math.round(((hex >> 8) & 255) * k);
    var b = Math.round((hex & 255) * k);
    return (r << 16) | (g << 8) | b;
  }

  // The facade texture is already tinted, so multiplying the palette straight
  // through would double up and turn every tower to mud. Pull it most of the
  // way back to white and let it act as a wash instead.
  function wash(hex, toward) {
    var r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
    r = Math.round(r + (255 - r) * toward);
    g = Math.round(g + (255 - g) * toward);
    b = Math.round(b + (255 - b) * toward);
    return (r << 16) | (g << 8) | b;
  }

  var FACADE_TILE = { glass: [11, 12], concrete: [11, 12], brick: [10, 11], stucco: [10, 11], industrial: [12, 10] };
  var VARIANTS = 6;

  // ------------------------------------------------- frontage placement ---
  // Buildings are placed along a block's frontages rather than cut out of a
  // rectangle, because the blocks are now arbitrary polygons carved out of
  // curving streets. Walking each edge and setting buildings back from it is
  // also just how cities are actually built: everything fronts a street, and
  // the middle of the block is yard.

  // How far the inside of the block extends from a point on its edge. March
  // inward until we leave the polygon; that distance is the deepest a
  // building on this frontage could possibly be.
  // Arc-length parameterisation of a closed polygon, so a frontage can be
  // walked as one continuous run regardless of how finely the polygon that
  // describes it happens to be subdivided.
  function perimeter(poly) {
    var n = poly.length;
    var cum = [0], total = 0;
    for (var i = 0; i < n; i++) {
      total += M.dist(poly[i].x, poly[i].z, poly[(i + 1) % n].x, poly[(i + 1) % n].z);
      cum.push(total);
    }
    return {
      total: total,
      at: function (s, out) {
        s = M.clamp(s, 0, total);
        var lo = 0, hi = n;
        while (lo < hi - 1) {
          var mid = (lo + hi) >> 1;
          if (cum[mid] <= s) lo = mid; else hi = mid;
        }
        var a = poly[lo % n], b = poly[(lo + 1) % n];
        var segLen = cum[lo + 1] - cum[lo];
        var t = segLen > 1e-6 ? (s - cum[lo]) / segLen : 0;
        out.x = M.lerp(a.x, b.x, t);
        out.z = M.lerp(a.z, b.z, t);
        return out;
      }
    };
  }

  function depthInto(poly, x, z, nx, nz, limit) {
    var step = 2.0;
    var d = step;
    while (d < limit) {
      if (!SB.Poly.contains(poly, x + nx * d, z + nz * d)) return d - step;
      d += step;
    }
    return limit;
  }

  // The city is batched per material AND per chunk. Without the chunk split
  // every facade batch would be one mesh spanning the whole map, which never
  // frustum-culls: you would pay for the entire skyline on every frame and
  // again in the shadow pass.
  // The map is several times the size it was, so a 4x4 split now means each
  // batch spans hundreds of metres and frustum culling barely bites. More,
  // smaller chunks cost a few extra draw calls and save far more fill.
  var CHUNKS = 9;
  function activeChunks() {
    // Fewer material batches are cheaper on Low. The larger batches are still
    // frustum-culled as units, while Medium/High keep the finer skyline cull.
    return SB.Q && SB.Q.tier === 'low' ? 3 : CHUNKS;
  }
  function chunkOf(L, x, z) {
    var B = L.bounds;
    var chunks = activeChunks();
    var cx = M.clamp(Math.floor((x - B.minX) / ((B.maxX - B.minX) / chunks)), 0, chunks - 1);
    var cz = M.clamp(Math.floor((z - B.minZ) / ((B.maxZ - B.minZ) / chunks)), 0, chunks - 1);
    return cx * chunks + cz;
  }

  // --------------------------------------------------------------- build ---
  function buildCity(scene, world, L) {
    var city = {
      root: new THREE.Group(),
      buildings: [],
      props: {
        palms: [], trees: [], lamps: [], hydrants: [], bins: [], benches: [],
        parked: [], billboards: [], ac: [], tanks: [], signals: [], cones: [],
        planters: [], newsboxes: []
      },
      materials: {},
      emissiveTargets: [],
      cullables: []
    };
    city.root.name = 'city';
    scene.add(city.root);

    var rng = M.rng(1207);

    // The ground, the roads and the road markings are all built by the
    // terrain pass now, because they all have to agree with the height field.
    // What is left here is what stands on top of it.
    var field = world.heightField;
    var groundY = function (x, z) { return field.at(x, z); };
    var NM = SB.Q.settings.normalMaps;
    var i, j;

    // ------------------------------------------------- blocks + pavements --
    var kerb = new QB();
    var sidewalkTop = new QB();
    var grassQB = new QB();
    var lotQB = new QB();
    var plazaQB = new QB();
    var KERB_H = 0.18;

    for (i = 0; i < L.blocks.length; i++) {
      var b = L.blocks[i];
      var lotPoly = b.lot.poly;

      // A block's pavement and surface are drawn as one fan from its centre,
      // which can only represent ground that is close to flat: over a hillside
      // those few big triangles cut straight through the terrain and shatter
      // the slope into shards. So measure how much the ground actually moves
      // across this block, and where it moves too much, leave it as land -
      // which is what a hill neighbourhood looks like anyway.
      var lo = 1e9, hi = -1e9;
      for (var vv = 0; vv < b.poly.length; vv++) {
        var vy = field.at(b.poly[vv].x, b.poly[vv].z);
        if (vy < lo) lo = vy;
        if (vy > hi) hi = vy;
      }
      var mid = field.at(b.cx, b.cz);
      if (mid < lo) lo = mid;
      if (mid > hi) hi = mid;
      if (hi - lo > 1.6) { b.steep = true; continue; }
      // The pavement is the ring between the kerb line and the building line,
      // draped over whatever the ground underneath is doing.
      kerb.polySkirt(b.kerbPoly, groundY, KERB_H);
      sidewalkTop.polyRing(b.kerbPoly, lotPoly,
        function (x, z) { return field.at(x, z) + KERB_H; }, 6);

      var surfaceY = function (x, z) { return field.at(x, z) + KERB_H + 0.02; };
      if (b.kind === 'island') {
        // no pavement ring on a traffic island, just the paved top
        plazaQB.polyFill(lotPoly, surfaceY, 5);
      } else if (b.kind === 'park') {
        grassQB.polyFill(lotPoly, surfaceY, 9);
      } else if (b.kind === 'plaza') {
        plazaQB.polyFill(lotPoly, surfaceY, 5);
      } else {
        // Every other block gets a made ground surface too. Without this the
        // gaps between buildings show raw terrain, and a downtown block with
        // a lawn growing through the middle of it looks like a bug.
        lotQB.polyFill(lotPoly, surfaceY, 8);
      }
    }

    // crosswalks at signalled junctions, laid across each approach road
    var paint = new QB();
    for (i = 0; i < L.nodes.length; i++) {
      var n = L.nodes[i];
      if (!n.hasLight) continue;
      crosswalk(paint, n, L, field);
    }
    var paintMat2 = new THREE.MeshStandardMaterial({
      color: 0xe8e2cf, roughness: 0.7, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
    });
    if (!paint.isEmpty()) {
      var cwMesh = paint.mesh(paintMat2, false, true);
      cwMesh.renderOrder = -1;
      city.root.add(cwMesh);
    }

    var concreteMat = new THREE.MeshStandardMaterial({ map: SB.Tex.sidewalk(), roughness: 0.9 });
    if (NM) {
      concreteMat.normalMap = SB.Tex.sidewalkNormal();
      concreteMat.normalScale = new THREE.Vector2(0.85, 0.85);
    }
    city.materials.concrete = concreteMat;
    city.materials.asphalt = world.terrainMaterials ? world.terrainMaterials.asphalt : concreteMat;
    var kerbMesh = kerb.mesh(concreteMat, false, true);
    var swMesh = sidewalkTop.mesh(concreteMat, false, true);
    city.root.add(kerbMesh); city.root.add(swMesh);
    addCullable(city, kerbMesh); addCullable(city, swMesh);
    if (!grassQB.isEmpty()) {
      var gm = grassQB.mesh(new THREE.MeshStandardMaterial({ map: SB.Tex.grass(), roughness: 1 }), false, true);
      city.root.add(gm); addCullable(city, gm);
    }
    if (!plazaQB.isEmpty()) {
      var pm = plazaQB.mesh(new THREE.MeshStandardMaterial({
        map: SB.Tex.sidewalk(), color: 0xc9c2b6, roughness: 0.8
      }), false, true);
      city.root.add(pm); addCullable(city, pm);
    }
    if (!lotQB.isEmpty()) {
      var lm = lotQB.mesh(new THREE.MeshStandardMaterial({
        map: SB.Tex.asphalt(), color: 0xb0b0b0, roughness: 0.95
      }), false, true);
      city.root.add(lm); addCullable(city, lm);
    }

    // --------------------------------------------------------- buildings ---
    var facadeQB = Object.create(null);     // 'style:variant#chunk' -> QB
    var shopQB = Object.create(null);       // 'variant#chunk' -> QB
    var roofQB = Object.create(null);       // chunk -> QB
    var trimQB = Object.create(null);       // chunk -> QB

    for (i = 0; i < L.blocks.length; i++) {
      var blk = L.blocks[i];
      if (blk.kind !== 'buildings') continue;
      var ch = chunkOf(L, blk.cx, blk.cz);
      var qbFor = (function (chunk) {
        return function (style, variant) {
          var k = style + ':' + variant + '#' + chunk;
          return facadeQB[k] || (facadeQB[k] = new QB());
        };
      })(ch);
      var roofFor = roofQB[ch] || (roofQB[ch] = new QB());
      var trimFor = trimQB[ch] || (trimQB[ch] = new QB());
      buildBlock(blk, city, world, rng, qbFor, shopQB, roofFor, trimFor, KERB_H, ch, field, L);
    }

    // One material per style/variant, shared by every chunk that uses it.
    var facadeMats = Object.create(null);
    var shopMats = Object.create(null);
    var key, mesh;
    for (key in facadeQB) {
      var styleVariant = key.split('#')[0];
      var mat = facadeMats[styleVariant];
      if (!mat) {
        var parts = styleVariant.split(':');
        var tex = SB.Tex.facade(parts[0], parts[1] | 0);
        mat = facadeMats[styleVariant] = new THREE.MeshStandardMaterial({
          vertexColors: true,
          map: tex.map,
          emissiveMap: tex.emissive,
          emissive: new THREE.Color(0xffffff),
          emissiveIntensity: 0.0,
          roughness: parts[0] === 'glass' ? 0.22 : 0.85,
          metalness: parts[0] === 'glass' ? 0.55 : 0.03
        });
        // Painted roughness makes windows glossy and the wall around them
        // matte, which is most of what separates a real elevation from a decal.
        if (tex.rough) { mat.roughnessMap = tex.rough; mat.roughness = 1.0; }
        if (tex.normal) {
          mat.normalMap = tex.normal;
          mat.normalScale = new THREE.Vector2(0.6, 0.6);
        }
        city.emissiveTargets.push(mat);
      }
      mesh = facadeQB[key].mesh(mat, true, true);
      mesh.name = 'facade:' + key;
      city.root.add(mesh);
      addCullable(city, mesh);
    }
    for (key in shopQB) {
      var variantKey = key.split('#')[0];
      var smat = shopMats[variantKey];
      if (!smat) {
        var stex = SB.Tex.storefront(variantKey | 0);
        smat = shopMats[variantKey] = new THREE.MeshStandardMaterial({
          map: stex.map,
          emissiveMap: stex.emissive,
          emissive: new THREE.Color(0xffffff),
          emissiveIntensity: 0.35,
          roughness: 0.6, metalness: 0.1
        });
        if (stex.normal) {
          smat.normalMap = stex.normal;
          smat.normalScale = new THREE.Vector2(0.5, 0.5);
        }
        smat.userData.shop = true;
        city.emissiveTargets.push(smat);
      }
      var shopMesh = shopQB[key].mesh(smat, true, true);
      city.root.add(shopMesh);
      addCullable(city, shopMesh);
    }
    var roofMat = new THREE.MeshStandardMaterial({
      map: SB.Tex.roof(), roughness: 0.95, vertexColors: true
    });
    if (NM) {
      roofMat.normalMap = SB.Tex.roofNormal();
      roofMat.normalScale = new THREE.Vector2(0.9, 0.9);
    }
    var trimMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.8, vertexColors: true
    });
    for (key in roofQB) {
      var rm = roofQB[key].mesh(roofMat, true, true);
      city.root.add(rm); addCullable(city, rm);
    }
    for (key in trimQB) {
      var tm = trimQB[key].mesh(trimMat, true, true);
      city.root.add(tm); addCullable(city, tm);
    }

    city.root.traverse(function (o) { if (o.isMesh) o.matrixAutoUpdate = false; });
    return city;
  }

  // Record a mesh's chunk centre so the renderer can distance-cull it.
  function addCullable(city, mesh) {
    var bs = mesh.geometry.boundingSphere;
    if (!bs) return;
    city.cullables.push({ mesh: mesh, x: bs.center.x, z: bs.center.z, r: bs.radius });
  }

  function crosswalk(qb, n, L, field) {
    for (var k = 0; k < n.edges.length; k++) {
      var e = L.edges[n.edges[k]];
      if (e.elevated) continue;
      var other = L.nodes[e.a === n.id ? e.b : e.a];
      var dx = other.x - n.x, dz = other.z - n.z;
      var len = Math.hypot(dx, dz) || 1;
      if (len < 22) continue;
      var ux = dx / len, uz = dz / len;
      var px = -uz, pz = ux;                  // across the carriageway
      var half = e.width * 0.5;
      var back = Math.max(half, 9) + 2.4;     // clear of the junction itself
      var bars = Math.max(6, Math.round(e.width / 1.35));
      for (var i = 0; i < bars; i++) {
        var t0 = -half + (i + 0.20) * (2 * half / bars);
        var t1 = -half + (i + 0.62) * (2 * half / bars);
        var ax = n.x + ux * back, az = n.z + uz * back;
        var y = field.at(ax, az) + 0.10;
        qb.quad(
          ax + px * t0 - ux * 1.35, y, az + pz * t0 - uz * 1.35,
          ax + px * t1 - ux * 1.35, y, az + pz * t1 - uz * 1.35,
          ax + px * t1 + ux * 1.35, y, az + pz * t1 + uz * 1.35,
          ax + px * t0 + ux * 1.35, y, az + pz * t0 + uz * 1.35,
          0, 0, 1, 1);
      }
    }
  }

  // ------------------------------------------------------------ a block ---
  // Walk the block's frontages and set buildings back off each one. Everything
  // that comes out is an oriented box, so a terrace on a curving street bends
  // with the street instead of stair-stepping along it.
  function buildBlock(blk, city, world, rng0, qbFor, shopQB, roofQB, trimQB, KERB_H, chunk, field, L2) {
    var rng = M.rng(blk.seed ^ 0x9E3779B9);
    var lotPoly = blk.lot.poly;
    var d = blk.district;
    var styles = STYLE_BY_DISTRICT[d] || STYLE_BY_DISTRICT.midtown;
    var hr = HEIGHT_BY_DISTRICT[d] || HEIGHT_BY_DISTRICT.midtown;

    // frontage width and building depth vary by district: deep towers
    // downtown, shallow rowhouses in the suburbs
    var wLo, wHi, dLo, dHi, gapLo, gapHi;
    if (d === DIST.DOWNTOWN) { wLo = 14; wHi = 32; dLo = 14; dHi = 30; gapLo = 0; gapHi = 1.2; }
    else if (d === DIST.INDUSTRIAL) { wLo = 24; wHi = 52; dLo = 20; dHi = 40; gapLo = 2; gapHi = 8; }
    else if (d === DIST.MIDTOWN) { wLo = 11; wHi = 25; dLo = 11; dHi = 23; gapLo = 0; gapHi = 1.8; }
    else if (d === DIST.SUBURB || d === DIST.HILLS) { wLo = 9; wHi = 15; dLo = 8; dHi = 13; gapLo = 2.5; gapHi = 7; }
    else { wLo = 9; wHi = 19; dLo = 9; dHi = 17; gapLo = 0.8; gapHi = 3.5; }

    var blockStyle = rng.chance(0.45) ? styles[rng.int(0, styles.length - 1)] : null;
    var blockVariant = rng.int(0, VARIANTS - 1);
    var placed = [];      // bounding circles, to stop frontages colliding at corners

    // Walk the frontage by arc length rather than edge by edge. A curved
    // street arrives here as dozens of short polyline segments, and treating
    // each of those as its own frontage means almost none of them is long
    // enough to hold a building - so the perimeter is measured as one
    // continuous run and buildings are set on chords across it.
    var per = perimeter(lotPoly);
    var slot = { x: 0, z: 0, ux: 0, uz: 0 };
    var head = { x: 0, z: 0, ux: 0, uz: 0 };
    var t = rng.range(0, 4);
    var guard = 0;

    while (t < per.total && guard++ < 900) {
      var w = rng.range(wLo, wHi);
      if (per.total - (t + w) < wLo * 0.7) w = per.total - t;
      if (w < wLo * 0.55) break;

      // A building sits on the chord across its stretch of frontage. Where the
      // street curves, the chord is shorter than the run it spans, and a
      // building built to the full width would cut the corner - so narrow the
      // building until it fits the curve rather than refusing to build.
      var chord = 0;
      for (var fit = 0; fit < 5; fit++) {
        per.at(t, slot);
        per.at(t + w, head);
        chord = M.dist(slot.x, slot.z, head.x, head.z);
        if (chord >= w * 0.80 || w <= wLo * 0.62) break;
        w *= 0.72;
      }
      if (chord < w * 0.62 || chord < 4) { t += 3; continue; }

      var ux = (head.x - slot.x) / (chord || 1), uz = (head.z - slot.z) / (chord || 1);
      var mx = (slot.x + head.x) * 0.5, mz = (slot.z + head.z) * 0.5;
      // Which side of the frontage is the inside of the block? Derive it by
      // testing, not from the winding: the chord's direction is not the local
      // edge direction on a curve, so a sign convention gets it wrong exactly
      // where the map is most interesting.
      var nx = -uz, nz = ux;
      if (!SB.Poly.contains(lotPoly, mx + nx * 0.9, mz + nz * 0.9)) { nx = -nx; nz = -nz; }
      if (!SB.Poly.contains(lotPoly, mx + nx * 0.9, mz + nz * 0.9)) { t += w * 0.5; continue; }

      var room = depthInto(lotPoly, mx + nx * 0.9, mz + nz * 0.9, nx, nz, 70);
      var depth = Math.min(rng.range(dLo, dHi), Math.max(7.2, room * 0.60));
      if (room < 8.4 || depth < 7.0) { t += w * 0.6; continue; }

      var cx = mx + nx * depth * 0.5, cz = mz + nz * depth * 0.5;
      var r = Math.hypot(chord, depth) * 0.42;
      var clash = false;
      for (var pi = 0; pi < placed.length; pi++) {
        var o = placed[pi];
        if (M.dist2(o.x, o.z, cx, cz) < (o.r + r) * (o.r + r) * 0.60) { clash = true; break; }
      }
      if (clash) { t += w * 0.5; continue; }
      if (L2.corridorNear && L2.corridorNear(cx, cz, Math.max(chord, depth) * 0.5)) {
        t += w + rng.range(gapLo, gapHi); continue;
      }
      placed.push({ x: cx, z: cz, r: r });

      emitBuilding(blk, city, world, rng, qbFor, shopQB, roofQB, trimQB, chunk, field,
        cx, cz, chord * 0.5 - rng.range(0.15, 0.7), depth * 0.5, Math.atan2(uz, ux),
        blockStyle, blockVariant, styles, hr, d, KERB_H, true);

      t += w + rng.range(gapLo, gapHi);
    }

    // A big block with a genuinely empty middle gets one interior structure,
    // so downtown superblocks are not hollow shells.
    if (blk.area > 9000 && rng.chance(0.5)) {
      var c = SB.Poly.centroid(lotPoly);
      var room2 = depthInto(lotPoly, c.x, c.z, 1, 0, 60);
      var far = 1e9;
      for (var pj = 0; pj < placed.length; pj++) {
        far = Math.min(far, M.dist(placed[pj].x, placed[pj].z, c.x, c.z) - placed[pj].r);
      }
      if (far > 12 && room2 > 12 && !(L2.corridorNear && L2.corridorNear(c.x, c.z, 20))) {
        var half = Math.min(far * 0.7, room2 * 0.7, 22);
        emitBuilding(blk, city, world, rng, qbFor, shopQB, roofQB, trimQB, chunk, field,
          c.x, c.z, half, half * rng.range(0.7, 1.0), rng.range(0, M.TAU),
          blockStyle, blockVariant, styles, hr, d, KERB_H, false);
      }
    }
  }

  // Four thin walls around a roof edge, leaving the roof itself open.
  function parapetRing(qb, cx, cz, yaw, hw, hd, y0, y1, t) {
    var c = Math.cos(yaw), s = Math.sin(yaw);
    // long sides
    for (var iz = -1; iz <= 1; iz += 2) {
      var lz = (hd - t * 0.5) * iz;
      qb.obox(cx - s * lz, y0, cz + c * lz, hw, t * 0.5, y1, yaw, 3, 3, 3, {});
    }
    // short sides, shortened so the corners do not double up
    for (var ix = -1; ix <= 1; ix += 2) {
      var lx = (hw - t * 0.5) * ix;
      qb.obox(cx + c * lx, y0, cz + s * lx, t * 0.5, hd - t, y1, yaw, 3, 3, 3, {});
    }
  }

  // ---------------------------------------------------- facade structure ---
  // Floor slabs and bay columns, standing proud of the recessed wall behind
  // them. Every storey gets a slab, so a tower reads as a stack of floors you
  // could count from the street rather than a single extruded rectangle.
  function facadeStructure(qb, rng, style, cx, cz, yaw, hw, hd, y0, y1, storeyH, rec) {
    var h = y1 - y0;
    if (h < 8 || hw < 2.4 || hd < 2.4) return;
    var c = Math.cos(yaw), s = Math.sin(yaw);
    var slabT = M.clamp(Math.min(hw, hd) * 0.035, 0.15, 0.34);

    // one slab per storey while that stays affordable, every other storey on
    // the very tall ones
    var storeys = Math.max(1, Math.round(h / storeyH));
    var stride = storeys > 22 ? 3 : (storeys > 11 ? 2 : 1);
    // on a small building the banding takes over the elevation, so only the
    // sill and cornice below are drawn
    if (h < 15) storeys = 0;
    for (var k = 1; k < storeys; k += stride) {
      var y = y0 + k * (h / storeys);
      if (y > y1 - 0.5) break;
      qb.obox(cx, y - slabT * 0.5, cz, hw, hd, y + slabT * 0.5, yaw, 3, 3, 3, {});
    }
    // sill and head slabs, so the stack is closed top and bottom
    qb.obox(cx, y0, cz, hw, hd, y0 + slabT, yaw, 3, 3, 3, {});
    qb.obox(cx, y1 - slabT, cz, hw, hd, y1, yaw, 3, 3, 3, {});

    // corner columns: the piece that stops a box looking like a box
    var col = Math.max(0.34, rec * 1.15);
    for (var ix = -1; ix <= 1; ix += 2) {
      for (var iz = -1; iz <= 1; iz += 2) {
        var lx = (hw - col) * ix, lz = (hd - col) * iz;
        qb.obox(cx + c * lx - s * lz, y0, cz + s * lx + c * lz,
          col, col, y1, yaw, 3, 3, 3, {});
      }
    }
  }

  // ------------------------------------------------------ facade relief ---
  // Depth is what separates a building from a photograph of one. Floor bands
  // catch the sun and throw a line of shadow, vertical fins break the glass
  // into bays, and balconies give a residential block a silhouette. All of it
  // goes into the shared trim batch, so the whole city still draws in a
  // couple of dozen calls.
  function facadeRelief(qb, rng, style, cx, cz, yaw, hw, hd, y0, y1, storeyH) {
    var h = y1 - y0;
    if (h < 6 || hw < 2.6 || hd < 2.6) return;
    var c = Math.cos(yaw), s = Math.sin(yaw);

    // horizontal bands, one every few floors
    var every = style === 'glass' ? 4 : 3;
    var band = storeyH * every;
    if (h > band * 1.5) {
      for (var y = y0 + band; y < y1 - 1.2; y += band) {
        qb.obox(cx, y - 0.16, cz, hw + 0.26, hd + 0.26, y + 0.16, yaw, 3, 3, 3, {});
      }
    }

    // Mullions between the bays, sitting ON the building line so they read
    // as part of the wall rather than floating beside it.
    if (h > 20) {
      var mull = style === 'glass' ? 0.13 : 0.20;
      var bays = Math.max(2, Math.round(hw / 4.2));
      for (var i = 1; i < bays; i++) {
        var t = -hw + (2 * hw) * (i / bays);
        for (var sd0 = -1; sd0 <= 1; sd0 += 2) {
          var mx = cx + c * t - s * (hd - mull) * sd0;
          var mz = cz + s * t + c * (hd - mull) * sd0;
          qb.obox(mx, y0 + 0.4, mz, mull, mull, y1 - 0.4, yaw, 3, 3, 3, {});
        }
      }
      var baysD = Math.max(1, Math.round(hd / 4.2));
      for (i = 1; i < baysD; i++) {
        var u = -hd + (2 * hd) * (i / baysD);
        for (sd0 = -1; sd0 <= 1; sd0 += 2) {
          var nx2 = cx + c * (hw - mull) * sd0 - s * u;
          var nz2 = cz + s * (hw - mull) * sd0 + c * u;
          qb.obox(nx2, y0 + 0.4, nz2, mull, mull, y1 - 0.4, yaw, 3, 3, 3, {});
        }
      }
    }

    // balconies on the residential-looking styles
    if ((style === 'stucco' || style === 'brick') && h > 9 && rng.chance(0.7)) {
      var bw = Math.min(hw * 0.62, 3.4);
      for (var by = y0 + storeyH; by < y1 - storeyH * 0.5; by += storeyH) {
        for (var sd = -1; sd <= 1; sd += 2) {
          var px = cx + (-s) * (hd + 0.55) * sd;
          var pz = cz + (c) * (hd + 0.55) * sd;
          qb.obox(px, by, pz, bw, 0.55, by + 0.18, yaw, 3, 3, 3, {});          // slab
          qb.obox(px + (-s) * 0.5 * sd, by, pz + c * 0.5 * sd,
            bw, 0.07, by + 0.95, yaw, 3, 3, 3, {});                            // railing
        }
      }
    }
  }

  // One building: facade, setbacks, roof, parapet, collider and record.
  function emitBuilding(blk, city, world, rng, qbFor, shopQB, roofQB, trimQB, chunk, field,
    cx, cz, hw, hd, yaw, blockStyle, blockVariant, styles, hr, d, KERB_H, onStreet) {
    if (hw < 3.0 || hd < 2.9) return;
    var style = blockStyle || styles[rng.int(0, styles.length - 1)];
    var variant = rng.chance(0.6) ? blockVariant : rng.int(0, VARIANTS - 1);
    var tile = FACADE_TILE[style];

    // Sit the building on the lowest ground under its footprint and sink the
    // base slightly, so nothing on a slope stands on stilts.
    var c = Math.cos(yaw), s2 = Math.sin(yaw);
    var baseY = 1e9;
    for (var k = 0; k < 4; k++) {
      var sx = (k === 0 || k === 3) ? -hw : hw;
      var sz = (k < 2) ? -hd : hd;
      var wx = cx + c * sx - s2 * sz, wz = cz + s2 * sx + c * sz;
      baseY = Math.min(baseY, field.at(wx, wz));
    }
    baseY = baseY + KERB_H - 0.55;

    var t = rng();
    var hNorm = t * t * (rng.chance(0.12) ? 1.0 : 0.62);
    // The skyline peaks at the core and falls away: height gets scaled down
    // with distance from downtown, which is what makes a city read as a city
    // from the freeway rather than as a uniform field of blocks.
    var far = Math.hypot(cx, cz);
    var coreFalloff = M.clamp(1.25 - far / 900, 0.42, 1.0);
    var h = M.lerp(hr[0], hr[1], hNorm) * (d === DIST.DOWNTOWN || d === DIST.MIDTOWN ? coreFalloff : 1);
    var storeyH = style === 'glass' ? 3.6 : 3.3;
    var storeys = Math.max(2, Math.round(h / storeyH));
    h = storeys * storeyH;

    var qb = qbFor(style, variant);
    var pal = paletteFor(style, (blk.seed ^ (cx * 73 | 0) ^ (cz * 149 | 0)) >>> 0);
    // The structure stands in front of the wall and covers a lot of it, so if
    // it is lighter than the wall every building reads as a white frame with
    // a colour peeking through. Only a glass tower gets a contrasting metal
    // frame; everything else gets its own colour, a few shades down - which is
    // how a painted building actually looks.
    qb.setColor(pal[0]);
    trimQB.setColor(style === 'glass' ? pal[1] : shade(pal[0], 0.74));
    roofQB.setColor(pal[2]);
    var hasShop = onStreet && (d !== DIST.INDUSTRIAL) &&
      (d !== DIST.RESIDENTIAL && d !== DIST.SUBURB && d !== DIST.HILLS || rng.chance(0.2)) &&
      rng.chance(0.8);
    var shopH = 4.6;
    var bodyY0 = hasShop ? baseY + shopH : baseY;

    var sections = [];
    if (h > 55 && rng.chance(0.75)) {
      var levels = rng.int(2, 3);
      var cy = bodyY0, sw = hw, sd = hd;
      for (var lv = 0; lv < levels; lv++) {
        var frac = lv === levels - 1 ? 1 : rng.range(0.42, 0.68);
        var top = cy + (bodyY0 + h - cy) * frac;
        sections.push([sw, sd, cy, top]);
        cy = top;
        var shrink = rng.range(0.12, 0.26);
        sw *= (1 - shrink); sd *= (1 - shrink);
      }
    } else {
      sections.push([hw, hd, bodyY0, bodyY0 + h]);
    }

    for (var si = 0; si < sections.length; si++) {
      var sc = sections[si];
      // The wall itself sits BACK from the building line. What you see at the
      // building line is the structure: a floor slab at every storey and a
      // column at every bay, with the glass recessed behind them. That recess
      // is the whole difference between a building and a photograph of one -
      // it is what casts shadows across itself as the sun moves.
      var REC = M.clamp(Math.min(sc[0], sc[1]) * 0.045, 0.09, 0.40);
      qb.obox(cx, sc[2], cz, sc[0] - REC, sc[1] - REC, sc[3], yaw,
        tile[0], tile[1], 0, { skipTop: true });
      roofQB.obox(cx, sc[3] - 0.02, cz, sc[0], sc[1], sc[3], yaw, 7, 7, 7, { skipSides: true });
      var pw = 0.35, ph = si === sections.length - 1 ? 1.0 : 0.6;
      // A parapet is a wall around the edge, not a lid. This used to be one
      // solid box spanning the whole roof, which buried everything standing on
      // it - plant, helipads, the lift head - under a metre of concrete and
      // made every roof read as a blank white slab.
      parapetRing(trimQB, cx, cz, yaw, sc[0] + pw, sc[1] + pw, sc[3], sc[3] + ph, pw);
      facadeStructure(trimQB, rng, style, cx, cz, yaw, sc[0], sc[1], sc[2], sc[3], storeyH, REC);
      facadeRelief(trimQB, rng, style, cx, cz, yaw, sc[0], sc[1], sc[2], sc[3], storeyH);
    }

    if (hasShop) {
      var sv = ((variant + blk.id) % 6) + '#' + chunk;
      var sqb = shopQB[sv] || (shopQB[sv] = new QB());
      sqb.obox(cx, baseY, cz, hw, hd, baseY + shopH, yaw, 26, shopH, 8, { skipTop: true });
      // canopy over the shopfront, so the street edge has something overhead
      trimQB.obox(cx, baseY + shopH - 0.55, cz, hw + 0.9, hd + 0.9,
        baseY + shopH - 0.25, yaw, 3, 3, 3, {});
    }

    var topSec = sections[sections.length - 1];
    var totalTop = topSec[3];

    world.addOBB(cx, cz, hw, hd, yaw, baseY - 2, totalTop, 'building');
    // The top of a building is a surface, not a lid: an oriented strip across
    // the roof is what lets you walk out onto it and land a helicopter on it.
    var topHw = topSec[0], topHd = topSec[1];
    world.addStrip(cx - c * topHw, cz - s2 * topHw, cx + c * topHw, cz + s2 * topHw,
      topHd, totalTop, totalTop, 'concrete');

    // Keep an axis-aligned envelope on the record too: doors, missions and the
    // minimap all still reason about buildings as rectangles.
    var ex = Math.abs(c) * hw + Math.abs(s2) * hd;
    var ez = Math.abs(s2) * hw + Math.abs(c) * hd;
    var rec = {
      id: city.buildings.length,
      x0: cx - ex, z0: cz - ez, x1: cx + ex, z1: cz + ez,
      cx: cx, cz: cz, hw: hw, hd: hd, yaw: yaw, baseY: baseY,
      h: totalTop - baseY, style: style, district: d, block: blk,
      hasShop: hasShop, roofY: sections[0][3], topY: totalTop,
      topHw: topSec[0], topHd: topSec[1],
      storeys: storeys, onStreet: onStreet
    };
    city.buildings.push(rec);

    // Stair and lift head on anything tall enough to be worth going up.
    if (totalTop - baseY > 26 && topSec[0] > 4.5 && topSec[1] > 4.5) {
      var bw = Math.min(3.2, topSec[0] * 0.42), bd = Math.min(2.6, topSec[1] * 0.42);
      var bx = cx + (-s2) * (topSec[1] - bd - 0.8);
      var bz = cz + (c) * (topSec[1] - bd - 0.8);
      trimQB.obox(bx, totalTop, bz, bw, bd, totalTop + 2.9, yaw, 3, 3, 3, {});
      world.addOBB(bx, bz, bw, bd, yaw, totalTop, totalTop + 2.9, 'building');
      rec.lift = { x: bx, z: bz, yaw: yaw, roofY: totalTop, baseY: baseY };
    }

    // Only put plant on a roof with room for it, and keep it inside the
    // parapet - an inverted random range was throwing units off the edge.
    var acCount = (topSec[0] > 3.2 && topSec[1] > 3.2)
      ? Math.min(6, Math.floor(topSec[0] * topSec[1] * 4 / 90)) : 0;
    for (var a = 0; a < acCount; a++) {
      var lx = rng.range(-topSec[0] + 2.0, topSec[0] - 2.0);
      var lz = rng.range(-topSec[1] + 2.0, topSec[1] - 2.0);
      city.props.ac.push({
        x: cx + c * lx - s2 * lz, z: cz + s2 * lx + c * lz,
        y: totalTop, r: rng.range(0, M.TAU), s: rng.range(0.8, 1.5)
      });
    }
    if (topSec[0] > 7 && topSec[1] > 7 && rng.chance(0.22)) {
      city.props.tanks.push({ x: cx, z: cz, y: totalTop });
    }
    if (totalTop > 16 && totalTop < 60 && rng.chance(0.16)) {
      city.props.billboards.push({
        x: cx, z: cz, y: totalTop + 1, yaw: yaw,
        w: Math.min(22, hw * 1.6), variant: rng.int(0, 9)
      });
    }
  }

  SB.buildCity = buildCity;

})(window.SB = window.SB || {});


