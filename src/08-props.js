// 08-props.js - everything that dresses the city: street furniture, planting,
// signals, rooftop clutter, billboards, the beach and pier, the multi-storey
// car park you can actually drive up, and the quiet collision board at the
// edge of the playable island.
//
// Repeated props go through InstancedMesh so a few thousand objects stay at a
// handful of draw calls.
(function (SB) {
  'use strict';

  var M = SB.M, Roads = SB.Roads, QB = SB.QB;
  var DIST = Roads.DIST;

  function buildProps(scene, world, L, city) {
    var rng = M.rng(0x50FA);
    var P = {
      root: new THREE.Group(),
      lampMats: [],
      glowMeshes: [],
      signals: [],
      parkSpots: [],
      doors: [],
      update: function () { }
    };
    P.root.name = 'props';
    scene.add(P.root);

    placeStreetFurniture(L, city, rng);
    addBeachPalms(L, city, rng);
    var groups = {
      lamps: buildLamps(P, city.props.lamps, rng),
      palms: buildPalms(P, city.props.palms, rng),
      trees: buildTrees(P, city.props.trees, rng),
      small: buildSmallProps(P, city.props, world, rng),
      signals: buildSignals(P, L, rng),
      roof: buildRoofClutter(P, city.props, rng),
      bills: buildBillboards(P, city.props.billboards)
    };

    buildBeach(P, world, L, city, rng);
    buildGarage(P, world, L, rng);
    buildStunts(P, world, L, rng);
    buildMapBoundary(P, world, L);
    collectParkingSpots(P, L, city, rng);

    // --------------------------------------------------------- per frame ---
    var sigDummyColor = new THREE.Color();
    P.update = function (dt, lamps, camera) {
      // street lighting: emissive heads plus a cheap additive pool on the road
      for (var i = 0; i < P.lampMats.length; i++) {
        P.lampMats[i].emissiveIntensity = lamps * 2.6;
      }
      for (i = 0; i < P.glowMeshes.length; i++) {
        P.glowMeshes[i].visible = lamps > 0.04;
        P.glowMeshes[i].material.opacity = lamps * 0.40;
      }
      // traffic signal lenses follow the layout's light phases
      if (P.signalMesh) {
        var changed = false;
        for (i = 0; i < P.signals.length; i++) {
          var sg = P.signals[i];
          var green = Roads.lightGreen(sg.light, sg.axis);
          var amber = sg.light && sg.light.amber;
          var state = green ? (amber ? 1 : 2) : 0;   // 0 red, 1 amber, 2 green
          if (state !== sg.state) { sg.state = state; changed = true; }
        }
        if (changed || P.signalDirty) {
          for (i = 0; i < P.signals.length; i++) {
            var s2 = P.signals[i];
            sigDummyColor.setHex(s2.state === 0 ? 0xff2a1a : (s2.state === 1 ? 0xffa310 : 0x2bff5a));
            P.signalMesh.setColorAt(i, sigDummyColor);
          }
          if (P.signalMesh.instanceColor) P.signalMesh.instanceColor.needsUpdate = true;
          P.signalDirty = false;
        }
      }
      if (P.waterFoam) P.waterFoam.material.opacity = 0.30 + Math.sin(performance.now() / 900) * 0.06;
    };
    P.signalDirty = true;

    return P;
  }

  // -------------------------------------------------- placement pass ------
  // Walks every block edge and drops lamps, planting and small props along the
  // kerb at a sensible spacing for the district.
  function placeStreetFurniture(L, city, rng) {
    var p = city.props;
    for (var b = 0; b < L.blocks.length; b++) {
      var blk = L.blocks[b];
      var inset = 1.9;
      var edges = [
        { x0: blk.x0 + inset, z0: blk.z0 + inset, x1: blk.x1 - inset, z1: blk.z0 + inset, out: [0, -1] },
        { x0: blk.x1 - inset, z0: blk.z0 + inset, x1: blk.x1 - inset, z1: blk.z1 - inset, out: [1, 0] },
        { x0: blk.x1 - inset, z0: blk.z1 - inset, x1: blk.x0 + inset, z1: blk.z1 - inset, out: [0, 1] },
        { x0: blk.x0 + inset, z0: blk.z1 - inset, x1: blk.x0 + inset, z1: blk.z0 + inset, out: [-1, 0] }
      ];
      var beach = blk.district === DIST.BEACH;
      var lampGap = blk.district === DIST.INDUSTRIAL ? 34 : 26;
      for (var e = 0; e < edges.length; e++) {
        var ed = edges[e];
        var dx = ed.x1 - ed.x0, dz = ed.z1 - ed.z0;
        var len = Math.hypot(dx, dz);
        if (len < 8) continue;
        var ux = dx / len, uz = dz / len;
        var yaw = Math.atan2(uz, ux);
        // lamps: alternate sides of the junction so they never collide
        for (var t = 9; t < len - 6; t += lampGap) {
          var jitter = rng.range(-1.4, 1.4);
          var lx = ed.x0 + ux * (t + jitter), lz = ed.z0 + uz * (t + jitter);
          city.props.lamps.push({ x: lx, z: lz, yaw: yaw + Math.PI / 2 * (e % 2 ? -1 : 1), arm: ed.out });
        }
        // planting between the lamps
        var plantGap = beach ? 15 : (blk.district === DIST.RESIDENTIAL ? 21 : 26);
        for (t = 16; t < len - 8; t += plantGap) {
          var px = ed.x0 + ux * t, pz = ed.z0 + uz * t;
          if (beach || blk.district === DIST.DOWNTOWN && rng.chance(0.4)) {
            p.palms.push({ x: px, z: pz, h: rng.range(6.5, 11.5), lean: rng.range(-0.14, 0.14), rot: rng() * M.TAU });
          } else if (rng.chance(0.72)) {
            p.trees.push({ x: px, z: pz, s: rng.range(0.85, 1.35), rot: rng() * M.TAU });
          }
        }
        // small furniture
        for (t = 6; t < len - 5; t += rng.range(11, 26)) {
          var sx = ed.x0 + ux * t, sz = ed.z0 + uz * t;
          var roll = rng();
          if (roll < 0.20) p.hydrants.push({ x: sx, z: sz });
          else if (roll < 0.46) p.bins.push({ x: sx, z: sz, rot: rng() * M.TAU });
          else if (roll < 0.62) p.benches.push({ x: sx, z: sz, yaw: yaw });
          else if (roll < 0.74) p.newsboxes.push({ x: sx, z: sz, yaw: yaw, hue: rng() });
          else if (roll < 0.82 && blk.district !== DIST.INDUSTRIAL) {
            p.planters.push({ x: sx, z: sz });
          }
        }
      }
      // park interiors get scattered trees
      if (blk.kind === 'park') {
        var n = Math.floor((blk.w * blk.d) / 260);
        for (var i = 0; i < n; i++) {
          p.trees.push({
            x: rng.range(blk.lot.x0 + 3, blk.lot.x1 - 3),
            z: rng.range(blk.lot.z0 + 3, blk.lot.z1 - 3),
            s: rng.range(1.0, 1.9), rot: rng() * M.TAU
          });
        }
      }
      if (blk.kind === 'plaza') {
        for (i = 0; i < 6; i++) {
          p.planters.push({
            x: rng.range(blk.lot.x0 + 4, blk.lot.x1 - 4),
            z: rng.range(blk.lot.z0 + 4, blk.lot.z1 - 4)
          });
        }
      }
    }
  }

  // ------------------------------------------------------------- lamps ----
  function buildLamps(P, list, rng) {
    if (!list.length) return null;
    var poleG = new THREE.CylinderGeometry(0.09, 0.13, 8.0, 7);
    poleG.translate(0, 4.0, 0);
    var armG = new THREE.CylinderGeometry(0.07, 0.07, 3.7, 6);
    armG.rotateZ(Math.PI / 2);
    armG.translate(1.75, 7.9, 0);
    var baseG = new THREE.CylinderGeometry(0.22, 0.28, 0.5, 8);
    baseG.translate(0, 0.25, 0);
    var poleGeo = SB.mergeGeos([{ geo: poleG }, { geo: armG }, { geo: baseG }]);
    var poleMat = new THREE.MeshStandardMaterial({ color: 0x3e4348, roughness: 0.55, metalness: 0.6 });

    var headG = new THREE.BoxGeometry(0.96, 0.20, 0.42);
    headG.translate(3.55, 7.72, 0);
    var headMat = new THREE.MeshStandardMaterial({
      color: 0xdfd8c8, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.4
    });
    P.lampMats.push(headMat);

    var pose = function (d, it) {
      d.position.set(it.x, 0.18, it.z);
      d.rotation.y = -Math.atan2(it.arm[1], it.arm[0]);
    };
    var poles = SB.instances(poleGeo, poleMat, list, pose, true, false);
    var heads = SB.instances(headG, headMat, list, pose, false, false);
    P.root.add(poles, heads);

    // light pool on the ground under each lamp
    var poolG = new THREE.PlaneGeometry(17, 17);
    poolG.rotateX(-Math.PI / 2);
    var poolMat = new THREE.MeshBasicMaterial({
      map: SB.Tex.blob(), color: 0xffd9a0, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var pools = SB.instances(poolG, poolMat, list, function (d, it) {
      var a = Math.atan2(it.arm[1], it.arm[0]);
      // sit the pool out over the road, where the lamp head actually points
      d.position.set(it.x + Math.cos(a) * 4.2, 0.06, it.z + Math.sin(a) * 4.2);
    });
    if (pools) { pools.renderOrder = 3; P.glowMeshes.push(pools); P.root.add(pools); }
    return poles;
  }

  // ------------------------------------------------------------- palms ----
  function buildPalms(P, list, rng) {
    if (!list.length) return null;
    var trunkMat = new THREE.MeshStandardMaterial({ color: 0x9a8368, roughness: 0.94 });
    var frondMat = new THREE.MeshStandardMaterial({
      map: SB.Tex.palmLeaf(), transparent: true, alphaTest: 0.4,
      side: THREE.DoubleSide, roughness: 0.85
    });

    // trunk is a slightly curved stack so it does not read as a pipe
    var segs = [];
    var segH = 1.0;
    for (var i = 0; i < 10; i++) {
      var g = new THREE.CylinderGeometry(0.16 - i * 0.008, 0.19 - i * 0.008, segH, 7);
      var m = new THREE.Matrix4().makeTranslation(
        Math.sin(i * 0.55) * 0.10, i * segH + segH / 2, Math.cos(i * 0.4) * 0.06);
      segs.push({ geo: g, matrix: m });
    }
    var trunkGeo = SB.mergeGeos(segs);

    // frond crown, baked once
    var fronds = [];
    for (i = 0; i < 9; i++) {
      var fg = new THREE.PlaneGeometry(3.6, 1.5);
      fg.translate(1.8, 0, 0);
      var mm = new THREE.Matrix4();
      var q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        (i % 2 ? 0.22 : -0.10), i * (M.TAU / 9), -0.42 - (i % 3) * 0.14, 'YXZ'));
      mm.compose(new THREE.Vector3(0, 10.0, 0), q, new THREE.Vector3(1, 1, 1));
      fronds.push({ geo: fg, matrix: mm });
    }
    var frondGeo = SB.mergeGeos(fronds);

    var poseT = function (d, it) {
      d.position.set(it.x, 0.18, it.z);
      d.rotation.set(it.lean * 0.6, it.rot, it.lean);
      d.scale.set(1, it.h / 10, 1);
    };
    var trunks = SB.instances(trunkGeo, trunkMat, list, poseT, true, false);
    // The crown geometry already sits at y = 10, so shifting by (h - 10) puts
    // it exactly on top of the trunk once the trunk is scaled to height h.
    var crowns = SB.instances(frondGeo, frondMat, list, function (d, it) {
      d.position.set(it.x, 0.18 + it.h - 10, it.z);
      d.rotation.set(it.lean * 0.6, it.rot, it.lean);
    }, true, false);
    P.root.add(trunks, crowns);
    return trunks;
  }

  // ------------------------------------------------------------- trees ----
  function buildTrees(P, list, rng) {
    if (!list.length) return null;
    var trunkG = new THREE.CylinderGeometry(0.16, 0.26, 2.6, 6);
    trunkG.translate(0, 1.3, 0);
    var trunkMat = new THREE.MeshStandardMaterial({ color: 0x584434, roughness: 0.95 });
    var leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7a34, roughness: 0.92, flatShading: true });
    var blobs = [];
    var cfg = [[0, 3.5, 0, 1.7], [0.9, 4.3, 0.4, 1.25], [-0.8, 4.1, -0.5, 1.15], [0.2, 4.9, -0.7, 0.95]];
    for (var i = 0; i < cfg.length; i++) {
      var g = new THREE.IcosahedronGeometry(cfg[i][3], 0);
      blobs.push({ geo: g, matrix: new THREE.Matrix4().makeTranslation(cfg[i][0], cfg[i][1], cfg[i][2]) });
    }
    var leafGeo = SB.mergeGeos(blobs);
    var pose = function (d, it) {
      d.position.set(it.x, 0.18, it.z);
      d.rotation.y = it.rot;
      d.scale.setScalar(it.s);
    };
    var trunks = SB.instances(trunkG, trunkMat, list, pose, true, false);
    var leaves = SB.instances(leafGeo, leafMat, list, pose, true, false);
    P.root.add(trunks, leaves);
    return trunks;
  }

  // ------------------------------------------------------ small props -----
  function buildSmallProps(P, props, world, rng) {
    var out = {};
    var Y = 0.18;

    if (props.hydrants.length) {
      var hg = SB.mergeGeos([
        { geo: new THREE.CylinderGeometry(0.16, 0.19, 0.62, 8), matrix: new THREE.Matrix4().makeTranslation(0, 0.31, 0) },
        { geo: new THREE.SphereGeometry(0.16, 8, 6), matrix: new THREE.Matrix4().makeTranslation(0, 0.64, 0) },
        { geo: new THREE.CylinderGeometry(0.07, 0.07, 0.42, 6).rotateZ(Math.PI / 2), matrix: new THREE.Matrix4().makeTranslation(0, 0.42, 0) }
      ]);
      out.hydrants = SB.instances(hg,
        new THREE.MeshStandardMaterial({ color: 0xc2352b, roughness: 0.6 }),
        props.hydrants, function (d, it) { d.position.set(it.x, Y, it.z); }, true, false);
      P.root.add(out.hydrants);
    }

    if (props.bins.length) {
      var bg = new THREE.CylinderGeometry(0.36, 0.30, 1.0, 10);
      bg.translate(0, 0.5, 0);
      out.bins = SB.instances(bg,
        new THREE.MeshStandardMaterial({ color: 0x2f3a33, roughness: 0.85 }),
        props.bins, function (d, it) { d.position.set(it.x, Y, it.z); d.rotation.y = it.rot; }, true, false);
      P.root.add(out.bins);
    }

    if (props.benches.length) {
      var seat = new THREE.BoxGeometry(1.9, 0.09, 0.52);
      var back = new THREE.BoxGeometry(1.9, 0.45, 0.08);
      var leg = new THREE.BoxGeometry(0.09, 0.45, 0.48);
      var bench = SB.mergeGeos([
        { geo: seat, matrix: new THREE.Matrix4().makeTranslation(0, 0.46, 0) },
        { geo: back, matrix: new THREE.Matrix4().makeTranslation(0, 0.70, -0.24) },
        { geo: leg, matrix: new THREE.Matrix4().makeTranslation(-0.82, 0.23, 0) },
        { geo: leg, matrix: new THREE.Matrix4().makeTranslation(0.82, 0.23, 0) }
      ]);
      out.benches = SB.instances(bench,
        new THREE.MeshStandardMaterial({ color: 0x6b4c33, roughness: 0.88 }),
        props.benches, function (d, it) { d.position.set(it.x, Y, it.z); d.rotation.y = -it.yaw; }, true, false);
      P.root.add(out.benches);
    }

    if (props.newsboxes.length) {
      var nb = SB.mergeGeos([
        { geo: new THREE.BoxGeometry(0.52, 0.95, 0.44), matrix: new THREE.Matrix4().makeTranslation(0, 0.70, 0) },
        { geo: new THREE.BoxGeometry(0.10, 0.42, 0.10), matrix: new THREE.Matrix4().makeTranslation(-0.16, 0.21, 0) },
        { geo: new THREE.BoxGeometry(0.10, 0.42, 0.10), matrix: new THREE.Matrix4().makeTranslation(0.16, 0.21, 0) }
      ]);
      var nmat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 });
      out.news = new THREE.InstancedMesh(nb, nmat, props.newsboxes.length);
      var d = new THREE.Object3D(), col = new THREE.Color();
      for (var i = 0; i < props.newsboxes.length; i++) {
        var it = props.newsboxes[i];
        d.position.set(it.x, Y, it.z); d.rotation.set(0, -it.yaw, 0); d.scale.setScalar(1);
        d.updateMatrix();
        out.news.setMatrixAt(i, d.matrix);
        col.setHSL(it.hue, 0.62, 0.45);
        out.news.setColorAt(i, col);
      }
      out.news.castShadow = true;
      P.root.add(out.news);
    }

    if (props.planters.length) {
      var pg = SB.mergeGeos([
        { geo: new THREE.BoxGeometry(1.5, 0.62, 1.5), matrix: new THREE.Matrix4().makeTranslation(0, 0.31, 0) },
        { geo: new THREE.IcosahedronGeometry(0.72, 0), matrix: new THREE.Matrix4().makeTranslation(0, 0.95, 0) }
      ]);
      out.planters = SB.instances(pg,
        new THREE.MeshStandardMaterial({ color: 0x8d8477, roughness: 0.9 }),
        props.planters, function (dd, it) { dd.position.set(it.x, Y, it.z); }, true, true);
      P.root.add(out.planters);
      // planters are solid: they are the one bit of street furniture that
      // should actually stop a car
      for (i = 0; i < props.planters.length; i++) {
        var pl = props.planters[i];
        world.addBox(pl.x - 0.75, pl.z - 0.75, pl.x + 0.75, pl.z + 0.75, 0, 0.9, 'prop');
      }
    }
    return out;
  }

  // ----------------------------------------------------------- signals ----
  function buildSignals(P, L, rng) {
    var poles = [], lenses = [];
    for (var i = 0; i < L.nodes.length; i++) {
      var n = L.nodes[i];
      if (!n.hasLight) continue;
      // one head per approach, facing oncoming traffic
      var approaches = [
        { dx: -1, dz: 0, axis: 'x' }, { dx: 1, dz: 0, axis: 'x' },
        { dx: 0, dz: -1, axis: 'z' }, { dx: 0, dz: 1, axis: 'z' }
      ];
      for (var a = 0; a < approaches.length; a++) {
        var ap = approaches[a];
        var px = n.x + ap.dx * (n.halfX + 1.6) + (ap.dz !== 0 ? (n.halfX + 1.4) * ap.dz : 0);
        var pz = n.z + ap.dz * (n.halfZ + 1.6) + (ap.dx !== 0 ? -(n.halfZ + 1.4) * ap.dx : 0);
        var yaw = Math.atan2(-ap.dz, -ap.dx);
        poles.push({ x: px, z: pz, yaw: yaw });
        lenses.push({ x: px, z: pz, yaw: yaw, light: n.light, axis: ap.axis, state: -1 });
      }
    }
    if (!poles.length) return null;

    var poleGeo = SB.mergeGeos([
      { geo: new THREE.CylinderGeometry(0.08, 0.11, 5.2, 7), matrix: new THREE.Matrix4().makeTranslation(0, 2.6, 0) },
      { geo: new THREE.BoxGeometry(0.34, 1.0, 0.30), matrix: new THREE.Matrix4().makeTranslation(0.30, 4.7, 0) },
      { geo: new THREE.CylinderGeometry(0.06, 0.06, 0.62, 6).rotateZ(Math.PI / 2), matrix: new THREE.Matrix4().makeTranslation(0.16, 4.9, 0) }
    ]);
    var polesMesh = SB.instances(poleGeo,
      new THREE.MeshStandardMaterial({ color: 0x30363a, roughness: 0.6, metalness: 0.5 }),
      poles, function (d, it) { d.position.set(it.x, 0.18, it.z); d.rotation.y = -it.yaw; }, true, false);
    P.root.add(polesMesh);

    var lensGeo = new THREE.SphereGeometry(0.13, 8, 6);
    lensGeo.translate(0.47, 4.7, 0);
    var lensMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.4, roughness: 0.3
    });
    var lensMesh = new THREE.InstancedMesh(lensGeo, lensMat, lenses.length);
    var dd = new THREE.Object3D();
    for (i = 0; i < lenses.length; i++) {
      dd.position.set(lenses[i].x, 0.18, lenses[i].z);
      dd.rotation.set(0, -lenses[i].yaw, 0);
      dd.scale.setScalar(1);
      dd.updateMatrix();
      lensMesh.setMatrixAt(i, dd.matrix);
      lensMesh.setColorAt(i, new THREE.Color(0xff2a1a));
    }
    P.root.add(lensMesh);
    P.signalMesh = lensMesh;
    P.signals = lenses;
    return lensMesh;
  }

  // ------------------------------------------------------ roof clutter ----
  function buildRoofClutter(P, props, rng) {
    var out = {};
    if (props.ac.length) {
      var ag = SB.mergeGeos([
        { geo: new THREE.BoxGeometry(1.9, 1.0, 1.6), matrix: new THREE.Matrix4().makeTranslation(0, 0.5, 0) },
        { geo: new THREE.CylinderGeometry(0.55, 0.55, 0.14, 10), matrix: new THREE.Matrix4().makeTranslation(0, 1.05, 0) }
      ]);
      out.ac = SB.instances(ag,
        new THREE.MeshStandardMaterial({ color: 0x9aa0a5, roughness: 0.7, metalness: 0.4 }),
        props.ac, function (d, it) {
          d.position.set(it.x, it.y, it.z);
          d.rotation.y = it.r;
          d.scale.setScalar(it.s);
        }, true, false);
      P.root.add(out.ac);
    }
    if (props.tanks.length) {
      var tg = SB.mergeGeos([
        { geo: new THREE.CylinderGeometry(1.6, 1.6, 3.0, 12), matrix: new THREE.Matrix4().makeTranslation(0, 4.2, 0) },
        { geo: new THREE.ConeGeometry(1.75, 1.0, 12), matrix: new THREE.Matrix4().makeTranslation(0, 6.2, 0) },
        { geo: new THREE.BoxGeometry(0.16, 2.8, 0.16), matrix: new THREE.Matrix4().makeTranslation(1.2, 1.4, 1.2) },
        { geo: new THREE.BoxGeometry(0.16, 2.8, 0.16), matrix: new THREE.Matrix4().makeTranslation(-1.2, 1.4, 1.2) },
        { geo: new THREE.BoxGeometry(0.16, 2.8, 0.16), matrix: new THREE.Matrix4().makeTranslation(1.2, 1.4, -1.2) },
        { geo: new THREE.BoxGeometry(0.16, 2.8, 0.16), matrix: new THREE.Matrix4().makeTranslation(-1.2, 1.4, -1.2) }
      ]);
      out.tanks = SB.instances(tg,
        new THREE.MeshStandardMaterial({ color: 0x6b5344, roughness: 0.95 }),
        props.tanks, function (d, it) { d.position.set(it.x, it.y, it.z); }, true, false);
      P.root.add(out.tanks);
    }
    return out;
  }

  // -------------------------------------------------------- billboards ----
  function buildBillboards(P, list) {
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var w = b.w, h = w * 0.5;
      var g = new THREE.Group();
      var face = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({
          map: SB.Tex.billboard(b.variant), roughness: 0.75,
          emissiveMap: SB.Tex.billboard(b.variant),
          emissive: 0xffffff, emissiveIntensity: 0.22,
          side: THREE.DoubleSide
        }));
      face.position.y = h / 2 + 2.4;
      face.castShadow = true;
      g.add(face);
      var frameMat = new THREE.MeshStandardMaterial({ color: 0x33383d, roughness: 0.7, metalness: 0.5 });
      for (var s = -1; s <= 1; s += 2) {
        var leg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.6, 0.24), frameMat);
        leg.position.set(s * w * 0.32, 1.3, 0);
        g.add(leg);
      }
      g.position.set(b.x, b.y, b.z);
      g.rotation.y = b.yaw;
      P.root.add(g);
    }
    return list.length;
  }

  // ------------------------------------------------------------- beach ----
  function buildBeach(P, world, L, city, rng) {
    var z0 = L.bounds.minZ - 200, z1 = L.bounds.maxZ + 200;
    var xEnd = L.beachX, xStart = xEnd - 150;

    // sand mesh follows World.baseHeight so it matches what wheels stand on
    var segX = 30, segZ = 40;
    var g = new THREE.PlaneGeometry(xEnd - xStart, z1 - z0, segX, segZ);
    g.rotateX(-Math.PI / 2);
    var pos = g.attributes.position;
    var cx = (xStart + xEnd) / 2, cz = (z0 + z1) / 2;
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i) + cx, z = pos.getZ(i) + cz;
      pos.setY(i, world.baseHeight(x, z) + Math.sin(x * 0.09) * 0.22 + Math.cos(z * 0.05) * 0.3);
    }
    g.computeVertexNormals();
    var sandMat = new THREE.MeshStandardMaterial({ map: SB.Tex.sand(), roughness: 1 });
    if (SB.Q.settings.normalMaps) {
      sandMat.normalMap = SB.Tex.sandNormal();
      sandMat.normalScale = new THREE.Vector2(0.6, 0.6);
    }
    var sand = new THREE.Mesh(g, sandMat);
    sand.position.set(cx, 0, cz);
    sand.receiveShadow = true;
    P.root.add(sand);

    // a line of foam where the sand meets the water
    var fg = new THREE.PlaneGeometry(26, z1 - z0);
    fg.rotateX(-Math.PI / 2);
    var foam = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false
    }));
    foam.position.set(xEnd - 86, -5.2, cz);
    foam.renderOrder = 2;
    P.root.add(foam);
    P.waterFoam = foam;

    // ---- pier: drivable deck out over the water, reached by a ramp
    var pierZ = 40, deckY = 3.2;
    var pierX0 = xEnd - 190, pierX1 = xEnd - 4;
    var deck = new QB();
    deck.box(pierX0, deckY - 0.5, pierZ - 9, pierX1, deckY, pierZ + 9, 6, 6, 6, {});
    var deckMat = new THREE.MeshStandardMaterial({ color: 0x8a7358, roughness: 0.95 });
    var deckMesh = deck.mesh(deckMat, true, true);
    P.root.add(deckMesh);
    world.addPlatform(pierX0, pierZ - 9, pierX1, pierZ + 9, deckY, 'wood');

    // approach ramp from the beach up onto the deck
    var rampX0 = pierX1, rampX1 = pierX1 + 26;
    var rampQB = new QB();
    rampQB.quad(
      rampX0, deckY, pierZ + 7, rampX1, world.baseHeight(rampX1, pierZ) + 0.1, pierZ + 7,
      rampX1, world.baseHeight(rampX1, pierZ) + 0.1, pierZ - 7, rampX0, deckY, pierZ - 7,
      0, 0, 4, 3);
    P.root.add(rampQB.mesh(deckMat, false, true));
    world.addRamp(rampX0, pierZ - 7, rampX1, pierZ + 7,
      deckY, world.baseHeight(rampX1, pierZ) + 0.1, 'x', 'wood');

    // pilings + rails
    var pileG = new THREE.CylinderGeometry(0.3, 0.34, 12, 7);
    var piles = [];
    for (var px = pierX0 + 4; px < pierX1; px += 12) {
      piles.push({ x: px, z: pierZ - 8 }, { x: px, z: pierZ + 8 });
    }
    P.root.add(SB.instances(pileG, new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 1 }),
      piles, function (d, it) { d.position.set(it.x, deckY - 6.4, it.z); }, true, false));

    for (var s = -1; s <= 1; s += 2) {
      world.addBox(pierX0, pierZ + s * 9 - 0.2, pierX1 - 24, pierZ + s * 9 + 0.2, deckY, deckY + 1.1, 'wall');
    }
    world.addBox(pierX0 - 0.3, pierZ - 9, pierX0 + 0.3, pierZ + 9, deckY, deckY + 1.1, 'wall');
    var railQB = new QB();
    for (s = -1; s <= 1; s += 2) {
      railQB.box(pierX0, deckY + 0.9, pierZ + s * 9 - 0.09, pierX1 - 24, deckY + 1.05, pierZ + s * 9 + 0.09, 3, 3, 3, {});
    }
    P.root.add(railQB.mesh(deckMat, true, false));

  }

  function addBeachPalms(L, city, rng) {
    var xEnd = L.beachX;
    for (var i = 0; i < 54; i++) {
      city.props.palms.push({
        x: rng.range(xEnd - 62, xEnd - 6),
        z: rng.range(L.bounds.minZ - 120, L.bounds.maxZ + 120),
        h: rng.range(7, 13), lean: rng.range(-0.2, 0.2), rot: rng() * M.TAU
      });
    }
  }

  // ------------------------------------------------------ car park -------
  // Three decks joined by ramps. The roof is a genuine drivable space, which
  // makes it the best jump in the city.
  function buildGarage(P, world, L, rng) {
    var blk = L.landmarks && L.landmarks.garage;
    if (!blk) return;
    var x0 = blk.lot.x0, x1 = blk.lot.x1, z0 = blk.lot.z0, z1 = blk.lot.z1;
    var w = x1 - x0, d = z1 - z0;
    if (w < 30 || d < 30) return;

    var decks = [0.2, 4.6, 9.0, 13.4];
    var rampW = 11;
    var qb = new QB();
    var mat = new THREE.MeshStandardMaterial({ color: 0x8f8b83, roughness: 0.92 });

    // Ramps alternate ends so the route spirals up through the structure.
    for (var lvl = 1; lvl < decks.length; lvl++) {
      var yBot = decks[lvl - 1], yTop = decks[lvl];
      var atEast = lvl % 2 === 1;
      var rz0 = z0 + 2, rz1 = z1 - 2;
      var rx0 = atEast ? x1 - rampW - 2 : x0 + 2;
      var rx1 = rx0 + rampW;

      // Slab for this level, split either side of the ramp corridor so the
      // ramp runs up an open shaft rather than into the underside of a floor.
      var slabX0 = x0 + 1, slabX1 = x1 - 1;
      if (rx0 > slabX0 + 0.5) {
        qb.box(slabX0, yTop - 0.42, z0 + 1, rx0, yTop, z1 - 1, 6, 6, 6, {});
        world.addPlatform(slabX0, z0 + 1, rx0, z1 - 1, yTop, 'concrete');
      }
      if (rx1 < slabX1 - 0.5) {
        qb.box(rx1, yTop - 0.42, z0 + 1, slabX1, yTop, z1 - 1, 6, 6, 6, {});
        world.addPlatform(rx1, z0 + 1, slabX1, z1 - 1, yTop, 'concrete');
      }

      // the ramp itself, rising along z
      qb.quad(
        rx0, yBot, rz0, rx1, yBot, rz0, rx1, yTop, rz1, rx0, yTop, rz1, 0, 0, 3, 8);
      world.addRamp(rx0, rz0, rx1, rz1, yBot, yTop, 'z', 'concrete');
      // a short landing at the top so you roll off the ramp onto the deck
      world.addPlatform(rx0, rz1 - 5, rx1, rz1 + 1, yTop, 'concrete');
      qb.box(rx0, yTop - 0.42, rz1 - 5, rx1, yTop, z1 - 1, 6, 6, 6, {});

      // perimeter parapet, with the ramp end left open
      var pH = 1.0;
      qb.box(x0, yTop, z0 + 1, x0 + 0.5, yTop + pH, z1 - 1, 3, 3, 3, {});
      qb.box(x1 - 0.5, yTop, z0 + 1, x1, yTop + pH, z1 - 1, 3, 3, 3, {});
      qb.box(x0, yTop, z0 + 1, x1, yTop + pH, z0 + 1.5, 3, 3, 3, {});
      world.addBox(x0, z0 + 1, x0 + 0.5, z1 - 1, yTop, yTop + pH, 'wall');
      world.addBox(x1 - 0.5, z0 + 1, x1, z1 - 1, yTop, yTop + pH, 'wall');
      world.addBox(x0, z0 + 1, x1, z0 + 1.5, yTop, yTop + pH, 'wall');
      // the far edge is deliberately left open: that is the jump
    }

    // columns
    var colMat = new THREE.MeshStandardMaterial({ color: 0x7d7a73, roughness: 0.95 });
    var cols = [];
    for (var cx = x0 + 8; cx < x1 - 6; cx += 13) {
      for (var cz = z0 + 8; cz < z1 - 6; cz += 13) {
        cols.push({ x: cx, z: cz });
        world.addBox(cx - 0.4, cz - 0.4, cx + 0.4, cz + 0.4, 0, decks[decks.length - 1], 'prop');
      }
    }
    var colGeo = new THREE.BoxGeometry(0.8, decks[decks.length - 1], 0.8);
    colGeo.translate(0, decks[decks.length - 1] / 2, 0);
    P.root.add(SB.instances(colGeo, colMat, cols, function (dd, it) { dd.position.set(it.x, 0, it.z); }, true, true));
    P.root.add(qb.mesh(mat, true, true));

    P.garage = { x0: x0, z0: z0, x1: x1, z1: z1, decks: decks, entryX: (x0 + x1) / 2, entryZ: z0 + 3 };
  }

  // ------------------------------------------------------- stunt ramps ----
  function buildStunts(P, world, L, rng) {
    var mat = new THREE.MeshStandardMaterial({
      color: 0x7a6a52, roughness: 0.9, side: THREE.DoubleSide
    });
    var qb = new QB();
    var spots = [
      { x: -20, z: -190, yaw: 0, len: 16, h: 3.2 },
      { x: 148, z: 68, yaw: Math.PI / 2, len: 20, h: 4.4 },
      { x: -262, z: 238, yaw: Math.PI, len: 18, h: 3.8 },
      { x: 232, z: -258, yaw: -Math.PI / 2, len: 22, h: 5.0 }
    ];
    for (var i = 0; i < spots.length; i++) {
      var s = spots[i];
      var alongX = Math.abs(Math.cos(s.yaw)) > 0.5;
      var hw = 5.5;
      var x0, x1, z0, z1, axis;
      if (alongX) {
        var dir = Math.cos(s.yaw) > 0 ? 1 : -1;
        x0 = dir > 0 ? s.x : s.x - s.len;
        x1 = dir > 0 ? s.x + s.len : s.x;
        z0 = s.z - hw; z1 = s.z + hw;
        axis = 'x';
        world.addRamp(x0, z0, x1, z1, dir > 0 ? 0.2 : s.h, dir > 0 ? s.h : 0.2, axis, 'concrete');
        qb.quad(x0, dir > 0 ? 0.2 : s.h, z1, x1, dir > 0 ? s.h : 0.2, z1,
          x1, dir > 0 ? s.h : 0.2, z0, x0, dir > 0 ? 0.2 : s.h, z0, 0, 0, 3, 3);
      } else {
        var dirz = Math.sin(s.yaw) > 0 ? 1 : -1;
        z0 = dirz > 0 ? s.z : s.z - s.len;
        z1 = dirz > 0 ? s.z + s.len : s.z;
        x0 = s.x - hw; x1 = s.x + hw;
        axis = 'z';
        world.addRamp(x0, z0, x1, z1, dirz > 0 ? 0.2 : s.h, dirz > 0 ? s.h : 0.2, axis, 'concrete');
        qb.quad(x0, dirz > 0 ? 0.2 : s.h, z1, x1, dirz > 0 ? 0.2 : s.h, z1,
          x1, dirz > 0 ? s.h : 0.2, z0, x0, dirz > 0 ? s.h : 0.2, z0, 0, 0, 3, 3);
      }
      s.axis = axis;
    }
    P.root.add(qb.mesh(mat, true, true));
    P.stunts = spots;
  }

  // -------------------------------------------------------- map boundary ---
  // These are intentionally collision-only boxes: the player feels a solid
  // board at the edge, while the horizon stays clean and free of z-fighting
  // "mountains". The low board contains ground vehicles while aircraft can
  // climb over the shoreline and leave the city naturally.
  function buildMapBoundary(P, world, L) {
    var B = L.playBounds || {
      minX: L.bounds.minX - 220, maxX: L.bounds.maxX + 60,
      minZ: L.bounds.minZ - 60, maxZ: L.bounds.maxZ + 60
    };
    var t = 12, y0 = -12, y1 = 8;
    world.addBox(B.minX - t, B.minZ - t, B.minX, B.maxZ + t, y0, y1, 'boundary');
    world.addBox(B.maxX, B.minZ - t, B.maxX + t, B.maxZ + t, y0, y1, 'boundary');
    world.addBox(B.minX, B.minZ - t, B.maxX, B.minZ, y0, y1, 'boundary');
    world.addBox(B.minX, B.maxZ, B.maxX, B.maxZ + t, y0, y1, 'boundary');
  }

  // ------------------------------------------------- parking positions ----
  // Kerbside bays and surface lots, handed to the traffic system so it can
  // fill the city with stealable cars.
  function collectParkingSpots(P, L, city, rng) {
    var spots = [];
    for (var i = 0; i < L.blocks.length; i++) {
      var b = L.blocks[i];
      if (b.kind === 'lot') {
        for (var x = b.lot.x0 + 3; x < b.lot.x1 - 3; x += 3.1) {
          for (var z = b.lot.z0 + 6; z < b.lot.z1 - 6; z += 12) {
            if (rng.chance(0.55)) spots.push({ x: x, z: z, yaw: Math.PI / 2, lot: true });
          }
        }
      }
      // kerbside: one side of each block, offset into the parking lane
      var edge = rng.int(0, 3);
      var along = edge % 2 === 0;
      for (var t = 0.18; t < 0.85; t += 0.14) {
        if (!rng.chance(0.6)) continue;
        var px, pz, yaw;
        if (along) {
          px = M.lerp(b.x0, b.x1, t);
          pz = (edge === 0 ? b.z0 - 2.6 : b.z1 + 2.6);
          yaw = 0;
        } else {
          px = (edge === 1 ? b.x1 + 2.6 : b.x0 - 2.6);
          pz = M.lerp(b.z0, b.z1, t);
          yaw = Math.PI / 2;
        }
        spots.push({ x: px, z: pz, yaw: yaw, lot: false });
      }
    }
    P.parkSpots = spots;
  }

  SB.buildProps = buildProps;

})(window.SB = window.SB || {});
