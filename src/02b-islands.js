// 02b-islands.js - the offshore chain.
//
// Sunset Bay had a coastline and then nothing: a shelving seabed, an ocean
// plane, and a hard stop where the play area ended. Everything west of the
// promenade was scenery you looked at. This puts three islands out there and
// makes each one a different kind of place to reach.
//
//   Pelican Key    a low sandy key joined to the mainland by a causeway, so
//                  you can simply drive there. It has its own streets, which
//                  means the ordinary city machinery - blocks, buildings,
//                  traffic, routing - works on it with no special cases.
//   Mercy Island   a decommissioned prison on a rock, with no road to it at
//                  all. Boat, plane or helicopter, and nothing else.
//   Gull Rock      a lighthouse and a jetty, and a long way from anywhere.
//
// The height field is the single source of truth for what is land: this module
// contributes the shape, 04b-terrain samples it, and the physics world reads
// the same field. Nothing here needs its own collision, and nothing can
// disagree about where the shoreline is.
(function (SB) {
  'use strict';

  var M = SB.M;

  var SEA = -1.4;             // World.waterY: the flat the waves ride on
  var SEABED = -7.5;          // what 04b-terrain gives the open shelf

  // Islands are authored, not generated. There are three of them, they are
  // the destinations of story missions, and a seed that moved them would move
  // the missions with them.
  var LIST = [
    {
      id: 'pelican', name: 'Pelican Key',
      x: -1300, z: -180, r: 205, peak: 10, plateau: 0.62, seed: 1.73,
      roads: true, tint: 'sand',
      blurb: 'Holiday homes, a jetty and one road on and off.'
    },
    {
      id: 'mercy', name: 'Mercy Island',
      x: -1585, z: 380, r: 215, peak: 29, plateau: 0.42, seed: 4.11,
      tint: 'rock',
      blurb: 'Mercy Point Correctional. Closed in 1974. Nobody goes out there.'
    },
    {
      id: 'gull', name: 'Gull Rock',
      x: -1330, z: 770, r: 76, peak: 22, plateau: 0.9, seed: 2.62,
      steep: true, tint: 'rock',
      blurb: 'A lighthouse on a rock, and the light still turns.'
    }
  ];

  var Islands = SB.Islands = { LIST: LIST };

  // How far west the world has to reach to hold all of this. The terrain
  // field, the play-area clamp and the map viewport all read it, so there is
  // one number and the islands cannot end up outside the world they are in.
  Islands.minX = (function () {
    var west = 0;
    for (var i = 0; i < LIST.length; i++) west = Math.min(west, LIST[i].x - LIST[i].r * 1.35);
    return Math.floor(west - 120);
  })();

  // ------------------------------------------------------------- shape ----
  // An island is a circle with two low harmonics on its radius. That is
  // enough to stop it reading as a disc without needing an outline anyone has
  // to author by hand, and it keeps the shoreline a closed curve, which the
  // beach ramp below depends on.
  function shapeRadius(isl, ang) {
    return isl.r * (1 +
      Math.sin(ang * 2 + isl.seed) * 0.15 +
      Math.sin(ang * 3 - isl.seed * 1.7) * 0.085);
  }

  var BEACH_RUN = 48;         // metres from seabed to the top of the sand
  var BEACH_OUT = 34;         // how far out to sea the shelf starts to climb
  var BEACH_Y = 1.2;          // height of the dry sand behind the waterline

  // The land height at a point, or null if the point is out at sea. Returns
  // absolute world height, so callers never have to know about the shelf.
  Islands.heightAt = function (x, z) {
    var best = null;
    for (var i = 0; i < LIST.length; i++) {
      var isl = LIST[i];
      var dx = x - isl.x, dz = z - isl.z;
      var d = Math.hypot(dx, dz);
      if (d > isl.r * 1.4) continue;
      var s = shapeRadius(isl, Math.atan2(dz, dx)) - d;   // metres inland
      if (s < -BEACH_OUT) continue;

      // The beach: a smooth climb out of the shelf. The waterline falls a few
      // metres seaward of the nominal radius, which is what leaves dry sand.
      var beach = M.smoothstep(M.clamp((s + BEACH_OUT) / BEACH_RUN, 0, 1));
      var y = M.lerp(SEABED, BEACH_Y, beach);

      // The land behind it. `plateau` is how far in the island reaches full
      // height: a low key is nearly flat, a prison rock tops out early and
      // stays there, which is what gives it somewhere to put a compound.
      var inland = M.clamp((s - 14) / (isl.r * 0.7), 0, 1);
      var t = M.clamp(inland / (isl.plateau || 1), 0, 1);
      y += isl.peak * (isl.steep ? Math.pow(t, 0.62) : M.smoothstep(t));

      // Relief, so the middle is not a dome. Scaled by how far inland we are
      // so it never disturbs the shoreline.
      y += Math.sin(x * 0.031 + isl.seed) * Math.sin(z * 0.027 - isl.seed) *
        isl.peak * 0.13 * inland;

      if (best === null || y > best) best = y;
    }
    return best;
  };

  // Dry land, as opposed to shelf that happens to be shallow.
  Islands.landAt = function (x, z) {
    var y = Islands.heightAt(x, z);
    return y !== null && y > SEA + 0.15;
  };

  Islands.byId = function (id) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return null;
  };

  // Is this point on or near any island? Used by the terrain colouring and by
  // the block filter, both of which otherwise assume everything west of the
  // beach is sea.
  Islands.near = function (x, z, pad) {
    pad = pad || 0;
    for (var i = 0; i < LIST.length; i++) {
      var isl = LIST[i];
      if (M.dist2(x, z, isl.x, isl.z) < (isl.r * 1.25 + pad) * (isl.r * 1.25 + pad)) return isl;
    }
    return null;
  };

  // A point on the island's shore at a given bearing, `inset` metres inland.
  // Jetties, ramps and mission markers all need this and all got it wrong
  // independently before it existed.
  Islands.shorePoint = function (isl, ang, inset) {
    var r = shapeRadius(isl, ang) - (inset || 0);
    return { x: isl.x + Math.cos(ang) * r, z: isl.z + Math.sin(ang) * r };
  };

  // ------------------------------------------------------------- roads ----
  // Pelican Key's streets go into the ordinary road network rather than
  // being drawn separately, which is the whole reason it is the drivable one:
  // block extraction, buildings, traffic, pedestrians, signals and navigation
  // all pick it up without knowing an island exists. The causeway is a normal
  // surface road with an explicit height, so the terrain carve raises an
  // embankment under it exactly the way it cuts a cutting into a hillside.
  var CAUSEWAY_Y = 3.2;
  var CAUSEWAY_Z = -180;
  Islands.causeway = { z: CAUSEWAY_Z, y: CAUSEWAY_Y };

  Islands.layRoads = function (net, shoreX) {
    var R = SB.Roads;
    var key = Islands.byId('pelican');
    var i, t, a;

    // --- the causeway. It starts on the promenade so it welds into the
    // mainland grid, and lands on the key's east shore.
    var landing = Islands.shorePoint(key, Math.PI, 26);
    var cause = [];
    for (i = 0; i <= 26; i++) {
      t = i / 26;
      var cx = M.lerp(shoreX + 88, landing.x, t);
      var cz = CAUSEWAY_Z + Math.sin(t * Math.PI) * 34;
      // Level with the ground at both ends, up on the embankment between.
      var ends = Math.min(t, 1 - t) / 0.13;
      var cy = M.lerp(0.2, CAUSEWAY_Y, M.smoothstep(M.clamp(ends, 0, 1)));
      var land = Islands.heightAt(cx, cz);
      if (land !== null && land > cy) cy = land;
      cause.push({ x: cx, z: cz, y: cy });
    }
    net.add(cause, { width: R.AVENUE_W, lanes: 2 });

    // --- a loop around the key, at the height of the land it sits on
    var loop = [];
    for (i = 0; i <= 56; i++) {
      a = (i / 56) * Math.PI * 2;
      var rr = shapeRadius(key, a) * 0.60;
      var lx = key.x + Math.cos(a) * rr, lz = key.z + Math.sin(a) * rr;
      loop.push({ x: lx, z: lz, y: Islands.heightAt(lx, lz) });
    }
    net.add(loop, { width: R.STREET_W, lanes: 1 });

    // --- two streets across it, so the loop encloses real blocks rather than
    // one ring-shaped hole
    for (var k = 0; k < 2; k++) {
      var base = k === 0 ? 0.35 : 1.95;
      var cross = [];
      for (i = 0; i <= 16; i++) {
        t = i / 16;
        var u = M.lerp(-0.62, 0.62, t);
        var px = key.x + Math.cos(base) * u * key.r + Math.sin(base) * Math.sin(t * 3.1) * 22;
        var pz = key.z + Math.sin(base) * u * key.r - Math.cos(base) * Math.sin(t * 3.1) * 22;
        cross.push({ x: px, z: pz, y: Islands.heightAt(px, pz) });
      }
      net.add(cross, { width: R.STREET_W, lanes: 1 });
    }

    // --- the jetty road down to the water on the north shore
    var jet = Islands.shorePoint(key, -Math.PI / 2, 6);
    net.add([
      { x: key.x + 8, z: key.z - key.r * 0.42, y: Islands.heightAt(key.x + 8, key.z - key.r * 0.42) },
      { x: jet.x, z: jet.z, y: Math.max(BEACH_Y, Islands.heightAt(jet.x, jet.z)) }
    ], { width: 12, lanes: 1 });
  };


  // ==================================================== what is out there ===
  // Everything above is geometry the terrain and the road network consume.
  // What follows is the built world on top of it, constructed once during
  // world build. Static, batched, and given real colliders where you can walk
  // on it: a jetty you cannot stand on is a texture.
  function Works(game) {
    this.game = game;
    this.root = new THREE.Group();
    this.root.name = 'offshore-islands';
    game.scene.add(this.root);
    this.landmarks = [];
    this.glows = [];
    this.beam = null;
    this.time = 0;

    this.mats = {
      wood: new THREE.MeshStandardMaterial({ color: 0x8f7350, roughness: 0.92 }),
      pile: new THREE.MeshStandardMaterial({ color: 0x4a3f33, roughness: 1 }),
      concrete: new THREE.MeshStandardMaterial({ color: 0x9d9a92, roughness: 0.88 }),
      grimy: new THREE.MeshStandardMaterial({ color: 0x6f6a60, roughness: 0.95 }),
      paint: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.72 }),
      metal: new THREE.MeshStandardMaterial({ color: 0x39424a, metalness: 0.6, roughness: 0.42 }),
      rock: new THREE.MeshStandardMaterial({ color: 0x8b8275, roughness: 1, flatShading: true }),
      frond: new THREE.MeshStandardMaterial({ color: 0x54763f, roughness: 0.85, side: THREE.DoubleSide }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x7d6647, roughness: 0.95 })
    };

    this.buildPelican();
    this.buildMercy();
    this.buildGull();
  }

  // Ground height as the game will actually see it - the carved height field
  // if it exists yet, the island shape otherwise. Everything placed here uses
  // it, so nothing floats or sinks when the roads cut into the land.
  Works.prototype.groundAt = function (x, z) {
    var f = this.game.terrain && this.game.terrain.field;
    if (f) return f.at(x, z);
    var y = Islands.heightAt(x, z);
    return y === null ? SEABED : y;
  };

  // ------------------------------------------------------------ pieces ----
  // A jetty: a plank deck on piles, running from the sand out into water deep
  // enough to tie a boat to. Every one of the three islands needs one, and a
  // boat that can only be beached is a boat you lose.
  Works.prototype.jetty = function (isl, ang, length, width) {
    var g = this.game, world = g.world;
    var deck = new SB.QB(), piles = new SB.QB();
    var start = Islands.shorePoint(isl, ang, 10);
    var ux = Math.cos(ang), uz = Math.sin(ang);
    var y = Math.max(SEA + 1.9, this.groundAt(start.x, start.z) + 0.6);
    var hw = width * 0.5;
    var px = -uz * hw, pz = ux * hw;

    for (var i = 0; i < length; i += 3) {
      var t0 = i, t1 = Math.min(i + 3, length);
      var ax = start.x - ux * t0, az = start.z - uz * t0;
      var bx = start.x - ux * t1, bz = start.z - uz * t1;
      deck.quad(ax + px, y, az + pz, ax - px, y, az - pz,
        bx - px, y, bz - pz, bx + px, y, bz + pz, 0, 0, 2, 2);
      // side rails, one plank high, so the deck reads as a structure
      for (var sgn = -1; sgn <= 1; sgn += 2) {
        piles.box(ax + px * sgn - 0.5, y - 7, az + pz * sgn - 0.5,
          ax + px * sgn + 0.5, y, az + pz * sgn + 0.5, 2, 2, 2, {});
      }
    }
    var ex = start.x - ux * length, ez = start.z - uz * length;
    world.addPlatform(Math.min(start.x, ex) - hw, Math.min(start.z, ez) - hw,
      Math.max(start.x, ex) + hw, Math.max(start.z, ez) + hw, y, 'wood');
    // A ramp off the landward end, or the deck is a step you cannot climb.
    var lx = start.x + ux * 9, lz = start.z + uz * 9;
    var land = this.groundAt(lx, lz);
    deck.quad(start.x + px, y, start.z + pz, start.x - px, y, start.z - pz,
      lx - px, land, lz - pz, lx + px, land, lz + pz, 0, 0, 2, 2);
    // addRamp interpolates from the low coordinate to the high one along its
    // axis, so which end gets which height depends on the sign of the run.
    var axis = Math.abs(ux) > Math.abs(uz) ? 'x' : 'z';
    var lowIsShore = axis === 'x' ? (start.x < lx) : (start.z < lz);
    world.addRamp(Math.min(start.x, lx) - hw, Math.min(start.z, lz) - hw,
      Math.max(start.x, lx) + hw, Math.max(start.z, lz) + hw,
      lowIsShore ? y : land, lowIsShore ? land : y, axis, 'wood');

    this.root.add(deck.mesh(this.mats.wood, false, true));
    this.root.add(piles.mesh(this.mats.pile, true, true));
    return { x: ex, z: ez, y: y, headX: start.x, headZ: start.z };
  };

  // Palms and scrub. Cheap crossed-quad fronds rather than modelled leaves:
  // at the distance these are seen from, the silhouette is the whole job.
  Works.prototype.scatter = function (isl, rng, palms, rocks) {
    var trunk = new SB.QB(), frond = new SB.QB(), rock = new SB.QB();
    var i, tries;
    for (i = 0, tries = 0; i < palms && tries < palms * 8; tries++) {
      var a = rng() * Math.PI * 2;
      var rr = shapeRadius(isl, a) * (0.30 + rng() * 0.66);
      var x = isl.x + Math.cos(a) * rr, z = isl.z + Math.sin(a) * rr;
      var y = this.groundAt(x, z);
      if (y < SEA + 0.4 || y > isl.peak * 0.75 + 2) continue;
      if (this.game.layout && SB.Roads.onRoad(this.game.layout, x, z)) continue;
      i++;
      // Trunk: five stacked boxes leaning off the vertical. A palm's lean is
      // most of what makes it read as a palm from a moving car.
      var h = 7 + rng() * 6;
      var lean = (rng() - 0.5) * 1.7;
      var leanZ = (rng() - 0.5) * 1.7;
      for (var seg = 0; seg < 5; seg++) {
        var t0 = seg / 5, t1 = (seg + 1) / 5;
        var w0 = 0.34 - t0 * 0.15;
        var sx = x + lean * t0 * t0, sz = z + leanZ * t0 * t0;
        trunk.box(sx - w0, y + h * t0, sz - w0, sx + w0, y + h * t1, sz + w0, 2, 2, 2, {});
      }
      var tx = x + lean, ty = y + h, tzc = z + leanZ;
      for (var f = 0; f < 6; f++) {
        var fa = (f / 6) * Math.PI * 2 + rng();
        var dx = Math.cos(fa) * 3.2, dz = Math.sin(fa) * 3.2;
        var wx = -Math.sin(fa) * 0.5, wz = Math.cos(fa) * 0.5;
        frond.quad(tx + wx, ty, tzc + wz, tx - wx, ty, tzc - wz,
          tx + dx - wx * 1.6, ty - 1.6, tzc + dz - wz * 1.6,
          tx + dx + wx * 1.6, ty - 1.6, tzc + dz + wz * 1.6, 0, 0, 1, 1);
      }
    }
    for (i = 0, tries = 0; i < rocks && tries < rocks * 8; tries++) {
      var ra = rng() * Math.PI * 2;
      var rd = shapeRadius(isl, ra) * (0.15 + rng() * 0.9);
      var rx = isl.x + Math.cos(ra) * rd, rz2 = isl.z + Math.sin(ra) * rd;
      var ry = this.groundAt(rx, rz2);
      if (ry < SEA - 1.2) continue;
      if (this.game.layout && SB.Roads.onRoad(this.game.layout, rx, rz2)) continue;
      i++;
      // Boulders, not blocks: small, squat and turned every which way. A
      // metre or two is a rock; four is a shipping container someone left.
      var s = 0.55 + rng() * 1.5;
      rock.obox(rx, ry - s * 0.5, rz2, s, s * (0.55 + rng() * 0.7),
        ry - s * 0.5 + s * (0.55 + rng() * 0.7), rng() * 3.14, 2, 2, 2, {});
    }
    if (!trunk.isEmpty()) this.root.add(trunk.mesh(this.mats.trunk, true, true));
    if (!frond.isEmpty()) this.root.add(frond.mesh(this.mats.frond, false, true));
    if (!rock.isEmpty()) this.root.add(rock.mesh(this.mats.rock, true, true));
  };

  // ------------------------------------------------------ pelican key -----
  Works.prototype.buildPelican = function () {
    var isl = Islands.byId('pelican');
    var rng = M.rng(0x9E1CA1);
    var pier = this.jetty(isl, -Math.PI / 2, 46, 7);
    this.scatter(isl, rng, 34, 22);

    // A boathouse at the head of the jetty, and a row of beach huts along the
    // north sand. Both are colliders as well as geometry.
    var paint = new SB.QB(), roof = new SB.QB();
    var world = this.game.world;
    var bx = pier.headX + 14, bz = pier.headZ + 12;
    var by = this.groundAt(bx, bz);
    paint.setColor(0xdfe6ea);
    paint.box(bx - 8, by, bz - 6, bx + 8, by + 4.6, bz + 6, 3, 3, 3, {});
    roof.setColor(0x3f5a68);
    roof.box(bx - 9, by + 4.6, bz - 7, bx + 9, by + 5.4, bz + 7, 3, 3, 3, {});
    world.addBox(bx - 8, bz - 6, bx + 8, bz + 6, by, by + 5.4, 'building');

    var hutCols = [0xef7f6a, 0x6fc3c0, 0xf2c96a, 0x8f9ee0, 0xe8e2d4];
    for (var k = 0; k < 7; k++) {
      var ha = -Math.PI / 2 + (k - 3) * 0.17;
      var hp = Islands.shorePoint(isl, ha, 26);
      var hy = this.groundAt(hp.x, hp.z);
      if (hy < SEA + 0.6) continue;
      paint.setColor(hutCols[k % hutCols.length]);
      paint.box(hp.x - 2.4, hy, hp.z - 2.4, hp.x + 2.4, hy + 3, hp.z + 2.4, 2, 2, 2, {});
      roof.setColor(0x59493a);
      roof.box(hp.x - 2.9, hy + 3, hp.z - 2.9, hp.x + 2.9, hy + 3.5, hp.z + 2.9, 2, 2, 2, {});
      world.addBox(hp.x - 2.4, hp.z - 2.4, hp.x + 2.4, hp.z + 2.4, hy, hy + 3.5, 'building');
    }
    this.root.add(paint.mesh(this.mats.paint, true, true));
    this.root.add(roof.mesh(this.mats.paint, true, true));

    this.landmarks.push({ id: 'pelican-key', name: 'Pelican Key', x: isl.x, z: isl.z,
      color: 0x6fe0b8, icon: '▲', kind: 'island', priority: 2 });
    this.landmarks.push({ id: 'pelican-jetty', name: 'Pelican Key jetty', x: pier.x, z: pier.z,
      color: 0x53c6c8, icon: '⚓', kind: 'marina', priority: 3 });
    this.pelicanJetty = pier;
  };

  // ------------------------------------------------------- mercy island ---
  // No road reaches it. The compound is the reason to go: a wall you have to
  // come through the gate or the roof to get past, two cell blocks, a yard,
  // and a helipad that is the only flat ground on the island.
  Works.prototype.buildMercy = function () {
    var isl = Islands.byId('mercy');
    var rng = M.rng(0x3E1C0D);
    var world = this.game.world;
    var conc = new SB.QB(), grimy = new SB.QB(), metal = new SB.QB();
    var cx = isl.x, cz = isl.z;
    var deck = this.groundAt(cx, cz);

    // The yard, levelled: a slab the buildings sit on, so nothing has to
    // follow the relief and nothing ends up half buried.
    var HW = 74, HD = 60;
    conc.plane(cx - HW, cz - HD, cx + HW, cz + HD, deck + 0.08, 6);
    world.addPlatform(cx - HW, cz - HD, cx + HW, cz + HD, deck + 0.08, 'concrete');

    // Perimeter wall with one gate on the jetty side.
    var WALL = 6.2;
    function wallRun(x0, z0, x1, z1) {
      grimy.box(Math.min(x0, x1), deck, Math.min(z0, z1),
        Math.max(x0, x1), deck + WALL, Math.max(z0, z1), 4, 4, 4, {});
      world.addBox(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1),
        deck, deck + WALL, 'wall');
    }
    wallRun(cx - HW, cz - HD, cx - HW + 2, cz + HD);
    wallRun(cx + HW - 2, cz - HD, cx + HW, cz + HD);
    wallRun(cx - HW, cz + HD - 2, cx + HW, cz + HD);
    // north wall, split for the gate
    wallRun(cx - HW, cz - HD, cx - 11, cz - HD + 2);
    wallRun(cx + 11, cz - HD, cx + HW, cz - HD + 2);
    grimy.box(cx - 11, deck + 4.6, cz - HD, cx + 11, deck + WALL, cz - HD + 2, 4, 4, 4, {});

    // Two cell blocks, four storeys, with window slots picked out in the dark
    // trim so they read as cells rather than warehouses.
    var slot = new SB.QB();
    for (var b = 0; b < 2; b++) {
      var ox = cx - 34 + b * 68;
      grimy.box(ox - 17, deck, cz - 28, ox + 17, deck + 16, cz + 30, 5, 5, 5, {});
      world.addBox(ox - 17, cz - 28, ox + 17, cz + 30, deck, deck + 16, 'building');
      for (var fl = 0; fl < 4; fl++) {
        for (var w = 0; w < 9; w++) {
          var wz = cz - 25 + w * 6.6;
          for (var side = -1; side <= 1; side += 2) {
            slot.box(ox + side * 17 - 0.12, deck + 2.4 + fl * 3.6, wz - 0.55,
              ox + side * 17 + 0.12, deck + 4.4 + fl * 3.6, wz + 0.55, 2, 2, 2, {});
          }
        }
      }
      conc.box(ox - 18, deck + 16, cz - 29, ox + 18, deck + 17, cz + 31, 5, 5, 5, {});
    }

    // Watchtower on the corner: the one thing on the island you can see from
    // the mainland, and the reason the silhouette reads as a prison.
    var tx = cx - HW + 12, tz2 = cz + HD - 12;
    for (var leg = 0; leg < 4; leg++) {
      var lx = tx + (leg & 1 ? 4 : -4), lz = tz2 + (leg & 2 ? 4 : -4);
      metal.box(lx - 0.5, deck, lz - 0.5, lx + 0.5, deck + 21, lz + 0.5, 2, 2, 2, {});
    }
    grimy.box(tx - 6, deck + 21, tz2 - 6, tx + 6, deck + 27, tz2 + 6, 3, 3, 3, {});
    conc.box(tx - 7, deck + 27, tz2 - 7, tx + 7, deck + 27.8, tz2 + 7, 3, 3, 3, {});
    world.addBox(tx - 6, tz2 - 6, tx + 6, tz2 + 6, deck + 21, deck + 27.8, 'building');

    // Helipad, marked, and flat: for most players this is how they arrive.
    var hx = cx, hz = cz + HD - 22;
    conc.setColor(0x2f3338);
    conc.plane(hx - 13, hz - 13, hx + 13, hz + 13, deck + 0.14, 4);
    conc.setColor(0xffffff);
    conc.plane(hx - 5.5, hz - 1.2, hx - 3.5, hz + 1.2, deck + 0.17, 1);
    conc.plane(hx + 3.5, hz - 1.2, hx + 5.5, hz + 1.2, deck + 0.17, 1);
    conc.plane(hx - 4.5, hz - 5.5, hx + 4.5, hz + 5.5, deck + 0.16, 1);
    conc.setColor(0x9d9a92);

    this.root.add(conc.mesh(this.mats.concrete, false, true));
    this.root.add(grimy.mesh(this.mats.grimy, true, true));
    this.root.add(metal.mesh(this.mats.metal, true, true));
    this.root.add(slot.mesh(new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 1 }), false, false));

    var pier = this.jetty(isl, -Math.PI / 2, 52, 8);
    this.scatter(isl, rng, 6, 44);

    this.mercy = { x: cx, z: cz, deck: deck, helipad: { x: hx, z: hz, y: deck + 0.14 },
      gate: { x: cx, z: cz - HD - 4 }, jetty: pier, yard: { x: cx, z: cz + 6 } };
    this.landmarks.push({ id: 'mercy-island', name: 'Mercy Island', x: cx, z: cz,
      color: 0xc8b3ff, icon: '▲', kind: 'island', priority: 2 });
    this.landmarks.push({ id: 'mercy-pad', name: 'Mercy Island helipad', x: hx, z: hz,
      color: 0xff8ea8, icon: 'H', kind: 'helipad', priority: 3 });
    // A real pad, not a painted square: addHelipad registers the landing zone
    // the aircraft solver looks for, so a helicopter can actually set down
    // here rather than hovering over a marking.
    if (this.game.transport && this.game.transport.addHelipad) {
      this.game.transport.addHelipad(hx, hz, deck + 0.16, 12, 'Mercy Island Pad');
    }
  };

  // ---------------------------------------------------------- gull rock ---
  Works.prototype.buildGull = function () {
    var isl = Islands.byId('gull');
    var rng = M.rng(0x6011C0);
    var world = this.game.world;
    var white = new SB.QB(), band = new SB.QB(), metal = new SB.QB();
    var cx = isl.x, cz = isl.z;
    var base = this.groundAt(cx, cz);

    // The tower: a stack of shrinking boxes reads as a taper at this size and
    // costs a fraction of a lathe.
    var H = 30;
    for (var i = 0; i < 12; i++) {
      var t0 = i / 12, t1 = (i + 1) / 12;
      var r0 = M.lerp(4.4, 2.6, t0);
      var q = (i % 2) ? band : white;
      q.box(cx - r0, base + H * t0, cz - r0, cx + r0, base + H * t1, cz + r0, 3, 3, 3, {});
    }
    world.addBox(cx - 4.4, cz - 4.4, cx + 4.4, cz + 4.4, base, base + H, 'building');
    metal.box(cx - 3.6, base + H, cz - 3.6, cx + 3.6, base + H + 0.5, cz + 3.6, 2, 2, 2, {});
    metal.box(cx - 2.9, base + H + 4.2, cz - 2.9, cx + 2.9, base + H + 5.4, cz + 2.9, 2, 2, 2, {});
    for (var c = 0; c < 4; c++) {
      var lx = cx + (c & 1 ? 2.6 : -2.6), lz = cz + (c & 2 ? 2.6 : -2.6);
      metal.box(lx - 0.16, base + H + 0.5, lz - 0.16, lx + 0.16, base + H + 4.2, lz + 0.16, 2, 2, 2, {});
    }

    // The lamp itself, and the beam it throws. The beam is a long thin cone
    // with additive blending: in fog it is the only part of Gull Rock you can
    // see from the promenade at night, which is the point of a lighthouse.
    var lampMat = new THREE.MeshStandardMaterial({ color: 0xfff0c4,
      emissive: 0xffdf9a, emissiveIntensity: 2.4, roughness: 0.35 });
    this.glows.push(lampMat);
    var lamp = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 8), lampMat);
    lamp.position.set(cx, base + H + 2.4, cz);
    this.root.add(lamp);
    var beamMat = new THREE.MeshBasicMaterial({ color: 0xffeec2, transparent: true,
      opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    var beamGeo = new THREE.ConeGeometry(9, 190, 10, 1, true);
    beamGeo.rotateZ(Math.PI / 2);
    beamGeo.translate(95, 0, 0);
    this.beam = new THREE.Mesh(beamGeo, beamMat);
    this.beam.position.set(cx, base + H + 2.4, cz);
    this.beam.frustumCulled = false;
    this.root.add(this.beam);
    this.beamMat = beamMat;
    this.lampMat = lampMat;

    // Keeper's cottage, tucked in the lee.
    var kx = cx + 14, kz = cz + 10, ky = this.groundAt(kx, kz);
    white.box(kx - 6, ky, kz - 5, kx + 6, ky + 4, kz + 5, 3, 3, 3, {});
    band.box(kx - 6.6, ky + 4, kz - 5.6, kx + 6.6, ky + 5.2, kz + 5.6, 3, 3, 3, {});
    world.addBox(kx - 6, kz - 5, kx + 6, kz + 5, ky, ky + 5.2, 'building');

    this.root.add(white.mesh(new THREE.MeshStandardMaterial({ color: 0xece8de, roughness: 0.8 }), true, true));
    this.root.add(band.mesh(new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.8 }), true, true));
    this.root.add(metal.mesh(this.mats.metal, true, true));

    var pier = this.jetty(isl, Math.PI * 0.5, 34, 6);
    this.scatter(isl, rng, 3, 26);

    this.gull = { x: cx, z: cz, base: base, jetty: pier, lamp: { x: cx, y: base + H + 2.4, z: cz } };
    this.landmarks.push({ id: 'gull-rock', name: 'Gull Rock', x: cx, z: cz,
      color: 0xffd489, icon: '▲', kind: 'island', priority: 2 });
  };

  // The light turns. Twelve seconds a revolution, and the lamp dims on the
  // back swing so it flashes rather than glowing steadily.
  Works.prototype.render = function (dt) {
    if (!this.beam) return;
    this.time += dt;
    var a = this.time * (Math.PI * 2 / 12);
    this.beam.rotation.y = -a;
    var face = Math.max(0, Math.cos(a - Math.PI * 0.5));
    var night = this.game.sky ? M.clamp(this.game.sky.night, 0, 1) : 1;
    this.beamMat.opacity = (0.05 + 0.18 * face) * (0.25 + 0.75 * night);
    this.lampMat.emissiveIntensity = 1.2 + 2.6 * night;
  };

  Islands.Works = Works;

})(window.SB = window.SB || {});
