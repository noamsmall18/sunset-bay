// 30-freeway.js - the elevated ring, its ramps and everything holding them up.
//
// The layout already knows where the freeway runs; this turns those edges into
// something you can see, drive on and fall off. Decks are lofted along each
// edge, parapets run down both sides as real colliders, and piers drop from
// the deck to whatever the ground is doing underneath - which on this map
// means anything from sea-level asphalt to the side of a hill.
(function (SB) {
  'use strict';

  var M = SB.M, QB = SB.QB;

  var DECK_T = 1.15;          // deck slab thickness
  var RAIL_H = 1.05;          // parapet height
  var RAIL_T = 0.34;
  var PIER_EVERY = 46;        // metres between piers along a run

  function Freeway(game) {
    this.game = game;
    this.scene = game.scene;
    this.world = game.world;
    this.layout = game.layout;
    this.field = game.world.heightField;

    this.root = new THREE.Group();
    this.root.name = 'freeway';
    this.scene.add(this.root);
    this.cullables = [];

    this.build();
  }

  Freeway.prototype.build = function () {
    var L = this.layout, W = this.world, field = this.field;
    var NM = SB.Q.settings.normalMaps;

    var deckQB = new QB();      // driving surface
    var underQB = new QB();     // soffit and edge beams
    var railQB = new QB();      // parapets
    var pierQB = new QB();      // columns and pier caps

    var pierAt = [];            // where a column is wanted, deduplicated
    var i;

    for (i = 0; i < L.edges.length; i++) {
      var e = L.edges[i];
      if (!e.elevated) continue;
      var a = L.nodes[e.a], b = L.nodes[e.b];
      this.deck(deckQB, underQB, railQB, a, b, e);
      W.addStrip(a.x, a.z, b.x, b.z, e.width * 0.5, a.y, b.y, 'asphalt');

      // Parapets are solid: without them you would slide straight off the
      // side of a road that is thirty metres in the air.
      var dx = b.x - a.x, dz = b.z - a.z;
      var len = Math.hypot(dx, dz) || 1;
      var ux = dx / len, uz = dz / len;
      var yaw = Math.atan2(uz, ux);
      var off = e.width * 0.5 + RAIL_T * 0.5;
      var midY = (a.y + b.y) * 0.5;
      for (var side = -1; side <= 1; side += 2) {
        W.addOBB(
          (a.x + b.x) * 0.5 + (-uz) * off * side,
          (a.z + b.z) * 0.5 + (ux) * off * side,
          len * 0.5, RAIL_T * 0.5, yaw,
          midY - 1.0, midY + RAIL_H, 'barrier');
      }

      // piers along the run, spaced by distance rather than per edge so a
      // chain of short edges does not sprout a forest of columns
      var n = Math.max(1, Math.round(len / PIER_EVERY));
      for (var k = 0; k <= n; k++) {
        var t = k / n;
        pierAt.push({
          x: a.x + dx * t, z: a.z + dz * t, y: M.lerp(a.y, b.y, t),
          w: e.width * 0.5, yaw: yaw
        });
      }
    }

    // drop columns, skipping any that would land on top of another
    var used = new SB.Grid(20);
    var q = [], stamp = 1;
    for (i = 0; i < pierAt.length; i++) {
      var p = pierAt[i];
      var near = used.queryPoint(p.x, p.z, 22, q, stamp++);
      var skip = false;
      for (var j = 0; j < near.length; j++) {
        if (M.dist2(near[j].x, near[j].z, p.x, p.z) < 22 * 22) { skip = true; break; }
      }
      if (skip) continue;
      used.insert(p, p.x, p.z, p.x, p.z);
      var ground = field.at(p.x, p.z);
      var top = p.y - DECK_T;
      if (top - ground < 2.2) continue;         // deck is already near the ground
      this.pier(pierQB, p, ground, top);
      W.addOBB(p.x, p.z, 2.0, 1.5, p.yaw, ground - 1, top, 'pier');
    }

    var asphalt = new THREE.MeshStandardMaterial({
      map: SB.Tex.asphalt(), roughness: 0.9, metalness: 0.0
    });
    if (NM) {
      asphalt.normalMap = SB.Tex.asphaltNormal();
      asphalt.normalScale = new THREE.Vector2(0.7, 0.7);
    }
    var concrete = new THREE.MeshStandardMaterial({
      map: SB.Tex.sidewalk(), color: 0xb3aea4, roughness: 0.92, metalness: 0.0
    });
    if (NM) {
      concrete.normalMap = SB.Tex.sidewalkNormal();
      concrete.normalScale = new THREE.Vector2(0.6, 0.6);
    }
    var railMat = new THREE.MeshStandardMaterial({ color: 0xc4bfb5, roughness: 0.85 });

    this.add(deckQB.mesh(asphalt, false, true));
    this.add(underQB.mesh(concrete, true, true));
    this.add(railQB.mesh(railMat, true, true));
    this.add(pierQB.mesh(concrete, true, true));

    this.materials = { asphalt: asphalt, concrete: concrete, rail: railMat };
  };

  Freeway.prototype.add = function (mesh) {
    if (!mesh.geometry.attributes.position ||
      mesh.geometry.attributes.position.count === 0) return;
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    var bs = mesh.geometry.boundingSphere;
    if (bs) this.cullables.push({ mesh: mesh, x: bs.center.x, z: bs.center.z, r: bs.radius });
  };

  // One span: road surface on top, soffit underneath, box beams down the sides
  // and a parapet along each edge.
  Freeway.prototype.deck = function (deck, under, rail, a, b, e) {
    var dx = b.x - a.x, dz = b.z - a.z;
    var len = Math.hypot(dx, dz) || 1;
    var ux = dx / len, uz = dz / len;
    var hw = e.width * 0.5;
    var px = -uz * hw, pz = ux * hw;
    var y0 = a.y, y1 = b.y;

    // top surface
    deck.quad(
      a.x - px, y0, a.z - pz, a.x + px, y0, a.z + pz,
      b.x + px, y1, b.z + pz, b.x - px, y1, b.z - pz,
      0, 0, e.width / 8, len / 8);
    // soffit, wound the other way so it faces down
    var uy = y0 - DECK_T, vy = y1 - DECK_T;
    under.quad(
      a.x - px, uy, a.z - pz, b.x - px, vy, b.z - pz,
      b.x + px, vy, b.z + pz, a.x + px, uy, a.z + pz,
      0, 0, e.width / 6, len / 6);
    // side beams
    for (var s = -1; s <= 1; s += 2) {
      var ex = -uz * hw * s, ez = ux * hw * s;
      if (s < 0) {
        under.quad(a.x + ex, uy, a.z + ez, b.x + ex, vy, b.z + ez,
          b.x + ex, y1, b.z + ez, a.x + ex, y0, a.z + ez, 0, 0, len / 6, DECK_T / 2);
      } else {
        under.quad(b.x + ex, vy, b.z + ez, a.x + ex, uy, a.z + ez,
          a.x + ex, y0, a.z + ez, b.x + ex, y1, b.z + ez, 0, 0, len / 6, DECK_T / 2);
      }
      // parapet
      var rx = -uz * (hw + RAIL_T * 0.5) * s, rz = ux * (hw + RAIL_T * 0.5) * s;
      rail.quad(a.x + rx, y0, a.z + rz, b.x + rx, y1, b.z + rz,
        b.x + rx, y1 + RAIL_H, b.z + rz, a.x + rx, y0 + RAIL_H, a.z + rz, 0, 0, len / 4, 0.3);
      rail.quad(b.x + rx, y1, b.z + rz, a.x + rx, y0, a.z + rz,
        a.x + rx, y0 + RAIL_H, a.z + rz, b.x + rx, y1 + RAIL_H, b.z + rz, 0, 0, len / 4, 0.3);
      // capping strip along the top of the parapet
      var ox = -uz * RAIL_T * 0.5, oz = ux * RAIL_T * 0.5;
      rail.quad(
        a.x + rx - ox, y0 + RAIL_H, a.z + rz - oz,
        b.x + rx - ox, y1 + RAIL_H, b.z + rz - oz,
        b.x + rx + ox, y1 + RAIL_H, b.z + rz + oz,
        a.x + rx + ox, y0 + RAIL_H, a.z + rz + oz, 0, 0, len / 4, 0.1);
    }
  };

  // A column, slightly tapered, with a cap spreading out under the deck.
  Freeway.prototype.pier = function (qb, p, ground, top) {
    var baseR = 2.1, topR = 1.5;
    var SEG = 8, k;
    var foot = ground - 1.0;
    for (k = 0; k < SEG; k++) {
      var a0 = (k / SEG) * M.TAU, a1 = ((k + 1) / SEG) * M.TAU;
      var b0x = p.x + Math.cos(a0) * baseR, b0z = p.z + Math.sin(a0) * baseR;
      var b1x = p.x + Math.cos(a1) * baseR, b1z = p.z + Math.sin(a1) * baseR;
      var t0x = p.x + Math.cos(a0) * topR, t0z = p.z + Math.sin(a0) * topR;
      var t1x = p.x + Math.cos(a1) * topR, t1z = p.z + Math.sin(a1) * topR;
      qb.quad(b0x, foot, b0z, b1x, foot, b1z, t1x, top - 1.1, t1z, t0x, top - 1.1, t0z,
        0, 0, 2, (top - foot) / 3);
    }
    // pier cap
    var cw = p.w * 0.75, cd = 2.0;
    qb.obox(p.x, top - 1.1, p.z, cw, cd, top, p.yaw, 3, 3, 3, {});
  };

  SB.Freeway = Freeway;

})(window.SB = window.SB || {});
