// 16-interiors.js - buildings you can walk into.
//
// Ten templates, each stamped out many times with a distinct name and a light
// palette jitter, and matched to real buildings across the whole city rather
// than a handful of hand-picked doors. Every instance still gets its own
// interior far to the north-east where nothing else is; you are only ever
// inside one at a time, so instances can sit close together in that space
// without any visual risk of bleeding into each other.
(function (SB) {
  'use strict';

  var M = SB.M, QB = SB.QB, Roads = SB.Roads;
  var DIST = Roads.DIST;

  var BASE_X = 2600, BASE_Z = 2600, CELL = 38;

  // needsShop: attach only to a building with a lit storefront (store, gun
  // shop, diner, club). Without it, the door lands on a plain facade, which
  // reads correctly as an apartment or warehouse entrance.
  var TYPES = [
    {
      id: 'store', color: 0x2e8b57, w: 15, d: 12, h: 3.4,
      floor: 0xb9b2a4, wall: 0xe6e0d2, service: 'store',
      needsShop: true, districts: null, count: 16, levels: 1,
      names: ['24/7 Convenience', 'QuickMart', 'Corner Store', 'Sunset Grocery',
        'Bay Market', 'Nite Owl Liquor', "Pick 'n Save", 'Value Mart',
        'GoGo Mini Mart', 'Harbor Convenience', 'Downtown Deli Mart',
        'Green Leaf Grocery', 'Fast Stop', 'Coastal Corner', 'Uptown Pantry',
        'Lucky Star Market']
    },
    {
      id: 'gunshop', color: 0x9c3b2a, w: 16, d: 13, h: 3.4,
      floor: 0x5c5348, wall: 0x8c8377, service: 'gunshop',
      needsShop: true, districts: [DIST.MIDTOWN, DIST.INDUSTRIAL], count: 3, levels: 1,
      names: ['Bayside Firearms', 'Dockside Arms Co.', 'Ironclad Outfitters']
    },
    {
      id: 'diner', color: 0x2f6fa8, w: 17, d: 12, h: 3.5,
      floor: 0xd8d2c2, wall: 0xf0ead8, service: 'diner',
      needsShop: true, districts: [DIST.MIDTOWN, DIST.BEACH, DIST.DOWNTOWN], count: 7, levels: 1,
      names: ['The Blue Crab Diner', 'Sunrise Grill', 'Pacific Coast Diner',
        'Moonlight Cafe', 'Retro Roadhouse', 'Harbor House Eats', 'Neon Diner']
    },
    {
      id: 'club', color: 0x7b2f8f, w: 20, d: 17, h: 4.6,
      floor: 0x1a1620, wall: 0x241d2c, service: 'club', dark: true,
      needsShop: true, districts: [DIST.DOWNTOWN, DIST.MIDTOWN], count: 4, levels: 2,
      names: ['Vermillion Club', 'Electric Lotus', 'Midnight Parlor', 'The Chrome Room']
    },
    {
      id: 'safehouse', color: 0xc08a2a, w: 15, d: 13, h: 3.3,
      floor: 0x8a6a4a, wall: 0xd8cdb8, service: 'safehouse',
      needsShop: false, districts: [DIST.RESIDENTIAL, DIST.BEACH, DIST.MIDTOWN], count: 10, levels: 2,
      names: ['Palm Court Apartments', 'Sunset Terrace', 'Bayview Flats',
        'Harborside Lofts', 'Ocean Breeze Residences', 'Golden Gate Suites',
        'The Meridian', 'Seabreeze Apartments', 'Copper Hill Flats', 'Lighthouse Residences']
    },
    {
      id: 'warehouse', color: 0x6a6a6a, w: 26, d: 20, h: 6.5,
      floor: 0x6e6a64, wall: 0x7c7870, service: 'warehouse',
      needsShop: false, districts: [DIST.INDUSTRIAL], count: 5, levels: 1,
      names: ['Dockside Storage', 'Bay Freight Depot', 'Harbor Storage Co.',
        'Industrial Self-Store', 'Portside Warehousing']
    },
    {
      id: 'bank', color: 0xb58a32, w: 22, d: 16, h: 4.1,
      floor: 0x837868, wall: 0xd9d0bd, service: 'bank',
      needsShop: true, districts: [DIST.DOWNTOWN, DIST.MIDTOWN], count: 4, levels: 2,
      names: ['First Sunset Bank', 'Bayside Trust', 'Pacific Reserve', 'Harbor Federal']
    },
    {
      id: 'hotel', color: 0x8b5d9b, w: 22, d: 18, h: 3.5,
      floor: 0x70616b, wall: 0xe5d8ca, service: 'hotel',
      needsShop: false, districts: [DIST.DOWNTOWN, DIST.BEACH], count: 4, levels: 3,
      names: ['The Sunset Grand', 'Bayline Hotel', 'Oceanic Motor Lodge', 'The Meridian Hotel']
    },
    {
      id: 'office', color: 0x3c718b, w: 20, d: 15, h: 3.8,
      floor: 0x6c7478, wall: 0xd5dde0, service: 'office',
      needsShop: false, districts: [DIST.DOWNTOWN, DIST.MIDTOWN, DIST.INDUSTRIAL], count: 5, levels: 3,
      names: ['Harbor Legal', 'Northstar Analytics', 'Coastline Realty', 'Tidewater Holdings', 'Signal House']
    },
    {
      id: 'clinic', color: 0x4c9a9e, w: 18, d: 14, h: 3.6,
      floor: 0xb9c5c3, wall: 0xe4eeea, service: 'clinic',
      needsShop: false, districts: [DIST.DOWNTOWN, DIST.MIDTOWN, DIST.RESIDENTIAL], count: 3, levels: 2,
      names: ['Bayside Medical', 'Sunset Urgent Care', 'Pacific Family Clinic']
    }
  ];

  function nameFor(type, n) {
    var pool = type.names;
    var base = pool[n % pool.length];
    var cycle = Math.floor(n / pool.length);
    return cycle > 0 ? base + ' ' + (cycle + 1) : base;
  }

  // Small hue/lightness jitter so forty stores do not all share one paint job.
  function jitter(hex, rng, dh, dl) {
    var c = new THREE.Color(hex);
    var hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(
      (hsl.h + (rng() - 0.5) * dh + 1) % 1,
      M.clamp(hsl.s + (rng() - 0.5) * 0.1, 0, 1),
      M.clamp(hsl.l + (rng() - 0.5) * dl, 0.05, 0.95));
    return c.getHex();
  }

  function Interiors(game) {
    this.game = game;
    this.scene = game.scene;
    this.world = game.world;
    this.L = game.layout;
    this.rng = M.rng(3141);

    this.root = new THREE.Group();
    this.root.name = 'interiors';
    this.scene.add(this.root);

    this.rooms = [];
    this.doors = [];
    this.current = null;
    this.fade = 0;
    this.fadeDir = 0;
    this.pending = null;

    // one roving light does every interior, since you can only be in one
    this.lamp = new THREE.PointLight(0xffe9c4, 0, 40, 1.4);
    this.lamp.position.set(0, -500, 0);
    this.scene.add(this.lamp);

    this.build();
    this.placeDoors();
    this.buildSpray();
  }

  // ------------------------------------------------------------- geometry --
  Interiors.prototype.build = function () {
    var instances = [];
    for (var t = 0; t < TYPES.length; t++) {
      for (var n = 0; n < TYPES[t].count; n++) instances.push({ type: TYPES[t], n: n });
    }
    // Reserve one stable grid slot per city building. The hidden interior
    // warehouse must never overlap two rooms, otherwise two nearby doors can
    // accidentally reveal each other's dressing while you explore.
    var cityCount = this.game.city && this.game.city.buildings ? this.game.city.buildings.length : instances.length;
    var cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(instances.length, cityCount))));
    for (var i = 0; i < instances.length; i++) {
      var it = instances[i];
      var built = this.buildRoom(it.type, nameFor(it.type, it.n), i, cols);
      // A room is only ever seen from the inside, so keep it out of the scene
      // graph until somebody walks through its door.
      if (built.group) built.group.visible = false;
      this.rooms.push(built);
    }
  };

  Interiors.prototype.generatedType = function (building, index) {
    var archetypes = ['loft', 'atelier', 'garage', 'arcade', 'salon', 'recording',
      'restaurant', 'lab', 'apartment', 'warehouse', 'dojo', 'studio', 'penthouse'];
    var archetype = archetypes[index % archetypes.length];
    var w = M.clamp(building.x1 - building.x0, 12, 28);
    var d = M.clamp(building.z1 - building.z0, 11, 24);
    // Tall downtown shells get a real vertical stack; smaller buildings still
    // occasionally hide a mezzanine so the city never feels one-storey.
    var levels = building.h > 72 ? 3 : (building.h > 34 || index % 5 === 0 ? 2 : 1);
    var palette = [0x4d72a8, 0xa85b4d, 0x6e4da8, 0x3d8a83, 0xb0783d, 0x75844b, 0x934d78];
    var color = palette[index % palette.length];
    return {
      id: 'generated', archetype: archetype, variant: index, color: color,
      w: w, d: d, h: 3.25 + (index % 4) * 0.22, floor: 0x77736c,
      wall: 0xc7c1b7, service: 'generated', needsShop: false,
      districts: null, count: 1, levels: levels,
      names: [archetype.toUpperCase()]
    };
  };

  Interiors.prototype.generatedName = function (building, index) {
    var districts = { downtown: 'Downtown', midtown: 'Midtown', residential: 'Residential', industrial: 'Industrial', beach: 'Beachfront' };
    var archetype = this.generatedType(building, index).archetype;
    var district = districts[building.district] || 'Bay';
    return district + ' ' + archetype + ' ' + String(index + 1).padStart(3, '0');
  };

  Interiors.prototype.buildRoom = function (t, name, index, cols) {
    var ox = BASE_X + (index % cols) * CELL;
    var oz = BASE_Z + Math.floor(index / cols) * CELL;
    var rng = this.rng;
    var g = new THREE.Group();
    var hw = t.w / 2, hd = t.d / 2;
    var levels = Math.max(1, t.levels || 1), levelH = t.h, totalH = levelH * levels;

    var qbFloor = new QB(), qbWall = new QB(), qbTrim = new QB();
    qbFloor.plane(ox - hw, oz - hd, ox + hw, oz + hd, 0.01, 4);
    // Upper slabs are real walkable floors; the ceiling is drawn facing down.
    for (var lv = 1; lv < levels; lv++) {
      var fy = lv * levelH;
      qbFloor.plane(ox - hw, oz - hd, ox + hw, oz + hd, fy, 4);
      this.world.addPlatform(ox - hw, oz - hd, ox + hw, oz + hd, fy, 'concrete');
    }
    qbFloor.quad(ox - hw, totalH, oz - hd, ox + hw, totalH, oz - hd,
      ox + hw, totalH, oz + hd, ox - hw, totalH, oz + hd, 0, 0, 4, 4);

    var W = 0.4;
    // four walls; the south wall carries the exit
    qbWall.box(ox - hw - W, 0, oz - hd - W, ox + hw + W, totalH, oz - hd, 4, 3, 4, {});
    qbWall.box(ox - hw - W, 0, oz + hd, ox + hw + W, totalH, oz + hd + W, 4, 3, 4, {});
    qbWall.box(ox - hw - W, 0, oz - hd, ox - hw, totalH, oz + hd, 4, 3, 4, {});
    qbWall.box(ox + hw, 0, oz - hd, ox + hw + W, totalH, oz + hd, 4, 3, 4, {});

    this.world.addBox(ox - hw - W, oz - hd - W, ox + hw + W, oz - hd, 0, totalH, 'building');
    this.world.addBox(ox - hw - W, oz + hd, ox + hw + W, oz + hd + W, 0, totalH, 'building');
    this.world.addBox(ox - hw - W, oz - hd, ox - hw, oz + hd, 0, totalH, 'building');
    this.world.addBox(ox + hw, oz - hd, ox + hw + W, oz + hd, 0, totalH, 'building');
    this.world.addPlatform(ox - hw, oz - hd, ox + hw, oz + hd, 0.01, 'concrete');

    // A real ramp connects each floor. The visual treads sit on top of the
    // walkable ramp, so upstairs traversal never depends on a teleport.
    if (levels > 1) {
      var stairX = ox - hw + 2.2;
      var stairZ0 = oz + hd - 6.4, stairZ1 = oz + hd - 1.4;
      var stairMat = new THREE.MeshStandardMaterial({ color: 0x695b4e, roughness: 0.86 });
      for (lv = 0; lv < levels - 1; lv++) {
        this.world.addRamp(stairX - 1.15, stairZ0, stairX + 1.15, stairZ1,
          lv * levelH + 0.02, (lv + 1) * levelH + 0.02, 'z', 'concrete');
        for (var step = 0; step < 8; step++) {
          var tread = new THREE.Mesh(new THREE.BoxGeometry(2.25, levelH * (step + 1) / 8, 0.58), stairMat);
          tread.position.set(stairX, lv * levelH + levelH * (step + 1) / 16,
            stairZ0 + 0.3 + step * (stairZ1 - stairZ0 - 0.6) / 7);
          g.add(tread);
        }
      }
    }

    var floorMat = new THREE.MeshStandardMaterial({
      map: SB.Tex.sidewalk(), color: jitter(t.floor, rng, 0.03, 0.08), roughness: 0.72
    });
    var wallMat = new THREE.MeshStandardMaterial({ color: jitter(t.wall, rng, 0.03, 0.06), roughness: 0.9 });
    g.add(qbFloor.mesh(floorMat, false, true));
    g.add(qbWall.mesh(wallMat, true, true));

    var room = {
      type: t, name: name, x: ox, z: oz, hw: hw, hd: hd, h: totalH,
      levels: levels, levelHeight: levelH, group: g, index: index,
      exit: { x: ox, z: oz + hd - 1.1 },
      spawn: { x: ox, z: oz + hd - 2.6 },
      counter: null, service: t.service, props: [], hotspots: []
    };

    this.furnish(room, qbTrim);
    this.furnishLevels(room);
    this.furnishArchitecture(room);
    var trimMat = new THREE.MeshStandardMaterial({ color: 0x8a7f6e, roughness: 0.8 });
    if (!qbTrim.isEmpty()) g.add(qbTrim.mesh(trimMat, true, true));

    // exit marker on the inside face of the south wall
    var exitMark = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 2.4),
      new THREE.MeshBasicMaterial({ color: 0x35e07a, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
    );
    exitMark.position.set(room.exit.x, 1.2, oz + hd - 0.16);
    g.add(exitMark);
    room.exitMark = exitMark;

    this.root.add(g);
    return room;
  };

  // Interior dressing per type. Counters double as the interaction point.
  Interiors.prototype.furnish = function (room, qb) {
    var t = room.type, ox = room.x, oz = room.z, hw = room.hw, hd = room.hd;
    var rng = this.rng;
    var g = room.group;
    var i;
    var brass = new THREE.MeshStandardMaterial({ color: 0xd8a943, roughness: 0.34, metalness: 0.72 });

    function counterAt(x, z, w, d) {
      qb.box(x - w / 2, 0, z - d / 2, x + w / 2, 1.05, z + d / 2, 3, 3, 3, {});
      room.counter = { x: x, z: z + d / 2 + 0.9 };
      return room.counter;
    }

    if (t.id === 'store' || t.id === 'gunshop') {
      counterAt(ox, oz - hd + 2.2, room.hw * 1.4, 1.0);
      // shelving runs
      var shelfMat = new THREE.MeshStandardMaterial({ color: 0xa9a296, roughness: 0.85 });
      var goodsMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, vertexColors: false });
      for (var s = -1; s <= 1; s += 2) {
        var sx = ox + s * hw * 0.52;
        var shelf = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, room.hd * 0.95), shelfMat);
        shelf.position.set(sx, 0.95, oz + 1.2);
        shelf.castShadow = true;
        g.add(shelf);
        this.world.addBox(sx - 0.55, oz + 1.2 - room.hd * 0.48, sx + 0.55, oz + 1.2 + room.hd * 0.48, 0, 1.9, 'prop');
        // colourful stock so the shelves read as full
        var stock = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.3, 0.22), goodsMat, 40);
        var d = new THREE.Object3D(), col = new THREE.Color();
        for (i = 0; i < 40; i++) {
          d.position.set(sx + (i % 2 ? 0.58 : -0.58),
            0.45 + Math.floor(i / 8) * 0.42,
            oz + 1.2 - room.hd * 0.42 + (i % 8) * (room.hd * 0.84 / 8));
          d.rotation.set(0, rng() * 0.4, 0);
          d.updateMatrix();
          stock.setMatrixAt(i, d.matrix);
          col.setHSL(rng(), 0.55, 0.5);
          stock.setColorAt(i, col);
        }
        g.add(stock);
      }
      if (t.id === 'gunshop') {
        // rack of display weapons on the back wall
        var rackMat = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.5, metalness: 0.55 });
        for (i = 0; i < 6; i++) {
          var gun = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.06), rackMat);
          gun.position.set(ox - 2.4 + i * 0.95, 1.9 + (i % 2) * 0.5, oz - hd + 0.35);
          g.add(gun);
        }
      }
    } else if (t.id === 'diner') {
      counterAt(ox + hw - 3.0, oz - hd + 2.4, 5.5, 1.0);
      var boothMat = new THREE.MeshStandardMaterial({ color: 0xa32f3a, roughness: 0.85 });
      var tableMat = new THREE.MeshStandardMaterial({ color: 0xdcd6c6, roughness: 0.6 });
      for (i = 0; i < 3; i++) {
        var bz = oz - hd + 3.5 + i * 3.2;
        var tbl = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 1.1), tableMat);
        tbl.position.set(ox - hw + 2.6, 0.76, bz);
        g.add(tbl);
        for (var b = -1; b <= 1; b += 2) {
          var seat = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.05, 0.55), boothMat);
          seat.position.set(ox - hw + 2.6, 0.52, bz + b * 1.0);
          seat.castShadow = true;
          g.add(seat);
        }
        this.world.addBox(ox - hw + 1.7, bz - 1.4, ox - hw + 3.5, bz + 1.4, 0, 1.05, 'prop');
      }
    } else if (t.id === 'club') {
      counterAt(ox - hw + 3.4, oz - hd + 2.6, 6.0, 1.0);
      // lit dance floor
      var tiles = new THREE.Group();
      var n = 6;
      var tileList = [];
      for (i = 0; i < n * n; i++) {
        var tile = new THREE.Mesh(
          new THREE.PlaneGeometry(1.3, 1.3),
          new THREE.MeshBasicMaterial({ color: 0x220033 }));
        tile.rotation.x = -Math.PI / 2;
        tile.position.set(ox + 2 + (i % n) * 1.35 - n * 0.68,
          0.03, oz + 2 + Math.floor(i / n) * 1.35 - n * 0.68);
        tiles.add(tile);
        tileList.push(tile);
      }
      g.add(tiles);
      room.tiles = tileList;
      // speaker stacks
      var spk = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.9 });
      for (var sside = -1; sside <= 1; sside += 2) {
        var sp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 1.0), spk);
        sp.position.set(ox + sside * (hw - 1.2), 1.2, oz - hd + 2.0);
        g.add(sp);
      }
    } else if (t.id === 'bank') {
      counterAt(ox, oz - hd + 2.5, room.hw * 1.45, 1.1);
      room.robbed = false;
      room.loot = 1800 + Math.floor(rng() * 2200);
      var tellerMat = new THREE.MeshStandardMaterial({ color: 0x5f4633, roughness: 0.75 });
      var teller = new THREE.Mesh(new THREE.BoxGeometry(room.hw * 1.45, 1.1, 1.1), tellerMat);
      teller.position.set(ox, 0.55, oz - hd + 2.5);
      g.add(teller);
      for (i = -1; i <= 1; i++) {
        var window = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.25, 0.10),
          new THREE.MeshStandardMaterial({ color: 0x273744, emissive: 0x0e1c29, emissiveIntensity: 0.4 }));
        window.position.set(ox + i * 3.2, 1.85, oz - hd + 1.92);
        g.add(window);
      }
      var vault = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, 0.55, 16),
        new THREE.MeshStandardMaterial({ color: 0xb58a32, metalness: 0.75, roughness: 0.32, emissive: 0x241700 }));
      vault.rotation.x = Math.PI / 2;
      vault.position.set(ox + hw - 3.0, 2.1, oz + hd - 1.0);
      g.add(vault);
      room.vault = vault;
    } else if (t.id === 'hotel') {
      counterAt(ox, oz - hd + 2.4, room.hw * 1.35, 1.0);
      var deskMat = new THREE.MeshStandardMaterial({ color: 0x4d324e, roughness: 0.7 });
      var concierge = new THREE.Mesh(new THREE.BoxGeometry(room.hw * 1.35, 1.05, 1.0), deskMat);
      concierge.position.set(ox, 0.52, oz - hd + 2.4);
      g.add(concierge);
      var lobby = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.55, 1.4),
        new THREE.MeshStandardMaterial({ color: 0x8f6b58, roughness: 0.85 }));
      lobby.position.set(ox, 0.3, oz + 1.5); g.add(lobby);
    } else if (t.id === 'office') {
      counterAt(ox, oz - hd + 2.2, 5.6, 0.9);
      var officeMat = new THREE.MeshStandardMaterial({ color: 0x354e5b, roughness: 0.72 });
      for (i = -1; i <= 1; i++) {
        var desk0 = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.75, 1.2), officeMat);
        desk0.position.set(ox + i * 4.2, 0.38, oz + 1.5); g.add(desk0);
      }
    } else if (t.id === 'clinic') {
      counterAt(ox, oz - hd + 2.0, 6.0, 0.9);
      var clinicMat = new THREE.MeshStandardMaterial({ color: 0x8fa7a2, roughness: 0.8 });
      for (i = -1; i <= 1; i++) {
        var exam0 = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.7, 1.4), clinicMat);
        exam0.position.set(ox + i * 4.0, 0.35, oz + 1.6); g.add(exam0);
      }
    } else if (t.id === 'generated') {
      this.furnishGenerated(room);
    } else if (t.id === 'safehouse') {
      counterAt(ox + hw - 2.6, oz - hd + 2.4, 3.0, 1.0);
      var sofaMat = new THREE.MeshStandardMaterial({ color: jitter(0x4a6b58, rng, 0.06, 0.1), roughness: 0.9 });
      var sofa = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.85, 1.0), sofaMat);
      sofa.position.set(ox - hw + 3.0, 0.42, oz + 1.5);
      sofa.castShadow = true;
      g.add(sofa);
      this.world.addBox(ox - hw + 1.5, oz + 1.0, ox - hw + 4.5, oz + 2.0, 0, 0.85, 'prop');
      var tv = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.95, 1.7),
        new THREE.MeshStandardMaterial({ color: 0x101216, emissive: 0x2a3f6a, emissiveIntensity: 0.7 }));
      tv.position.set(ox - hw + 0.6, 1.3, oz + 1.5);
      g.add(tv);
      var bed = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.55, 1.6),
        new THREE.MeshStandardMaterial({ color: jitter(0x7a8fa8, rng, 0.08, 0.1), roughness: 0.9 }));
      bed.position.set(ox + hw - 2.4, 0.3, oz + hd - 3.0);
      g.add(bed);
    } else if (t.id === 'warehouse') {
      counterAt(ox, oz - hd + 2.4, 3.0, 1.0);
      var crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6f45, roughness: 0.95 });
      for (i = 0; i < 26; i++) {
        var cw = rng.range(1.1, 1.9);
        var cx = rng.range(ox - hw + 2, ox + hw - 2);
        var cz = rng.range(oz - hd + 4, oz + hd - 2);
        var stack = rng.int(1, 3);
        for (var k = 0; k < stack; k++) {
          var crate = new THREE.Mesh(new THREE.BoxGeometry(cw, cw * 0.85, cw), crateMat);
          crate.position.set(cx, cw * 0.42 + k * cw * 0.85, cz);
          crate.rotation.y = rng() * 0.5;
          crate.castShadow = true;
          crate.receiveShadow = true;
          g.add(crate);
        }
        this.world.addBox(cx - cw / 2, cz - cw / 2, cx + cw / 2, cz + cw / 2, 0, stack * cw * 0.85, 'prop');
      }
    }

    // ceiling lights
    var lightMat = new THREE.MeshBasicMaterial({ color: t.dark ? 0x40204f : 0xfff4de });
    for (i = -1; i <= 1; i += 2) {
      var pane = new THREE.Mesh(new THREE.PlaneGeometry(room.hw * 0.9, 0.6), lightMat);
      pane.rotation.x = Math.PI / 2;
      pane.position.set(ox, room.h - 0.05, oz + i * room.hd * 0.4);
      g.add(pane);
    }
  };

  Interiors.prototype.furnishGenerated = function (room) {
    var t = room.type, ox = room.x, oz = room.z, hw = room.hw, hd = room.hd;
    var rng = M.rng(9109 + room.index * 37);
    var g = room.group;
    var shell = new THREE.MeshStandardMaterial({ color: 0x242b35, roughness: 0.68, metalness: 0.22 });
    var soft = new THREE.MeshStandardMaterial({ color: 0x7c536d + (room.index % 3) * 0x070707, roughness: 0.82 });
    var metal = new THREE.MeshStandardMaterial({ color: 0x59646b, roughness: 0.42, metalness: 0.78 });
    var brass = new THREE.MeshStandardMaterial({ color: 0xd8a943, roughness: 0.34, metalness: 0.72 });
    var lit = new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.38, metalness: 0.2, emissive: t.color, emissiveIntensity: 0.45 });
    var dark = new THREE.MeshStandardMaterial({ color: 0x12161c, roughness: 0.72, metalness: 0.18 });
    var brass = new THREE.MeshStandardMaterial({ color: 0xd8a943, roughness: 0.34, metalness: 0.72 });
    var brass = new THREE.MeshStandardMaterial({ color: 0xd8a943, roughness: 0.34, metalness: 0.72 });
    var archetype = t.archetype;
    var ix = function (n) { return ox + n; };
    var iz = function (n) { return oz + n; };
    var seat, k, n;

    // A seeded gallery wall and pendant arrangement is unique per address.
    // It is intentionally mounted clear of the walk path, so variation never
    // becomes a collision lottery.
    var artPalette = [0xe66f51, 0x5bc0be, 0xf1c453, 0x8f74d4, 0x72b86a];
    var artCount = 2 + room.variant % 4;
    for (n = 0; n < artCount; n++) {
      var artW = 0.75 + rng() * 1.1, artH = 0.42 + rng() * 0.75;
      var art = new THREE.MeshStandardMaterial({ color: artPalette[(room.variant + n) % artPalette.length], roughness: 0.58, metalness: 0.12, emissive: artPalette[(room.variant + n) % artPalette.length], emissiveIntensity: 0.16 });
      this.addPropBox(room, artW, artH, 0.08,
        ix(M.clamp(rng.range(-hw + 1.5, hw - 1.5), -hw + artW / 2 + 0.5, hw - artW / 2 - 0.5)),
        1.2 + rng() * Math.min(1.5, room.h - 2.0), iz(-hd + 0.32), art, false);
    }
    for (n = 0; n < 1 + room.variant % 3; n++) {
      this.addPropCylinder(room, 0.10, 0.52, ix(-hw * 0.45 + n * 1.7), room.h - 0.42, iz(0.4 + (n % 2) * 2.2), lit, false);
    }

    // Every generated room gets a different seed, footprint-proportional
    // spacing, and an archetype-specific kit. The result is a unique little
    // venue for every otherwise anonymous city shell, not a shared fallback.
    if (archetype === 'loft' || archetype === 'apartment') {
      this.addPropBox(room, hw * 0.72, 0.16, 0.24, ix(-hw * 0.08), 2.35, iz(-hd + 1.1), shell, false);
      this.addPropBox(room, 3.4, 0.58, 2.0, ix(hw - 3.4), 0.3, iz(hd - 3.0), soft, true);
      this.addPropBox(room, 3.2, 0.9, 1.0, ix(-hw + 2.8), 0.45, iz(1.8), soft, true);
      this.addPropBox(room, 4.2, 1.0, 0.8, ix(hw - 2.8), 0.5, iz(-hd + 1.3), metal, true);
      this.addPropCylinder(room, 0.36, 0.5, ix(-hw + 1.6), 0.25, iz(hd - 1.3), lit, true);
      this.addHotspot(room, ix(hw - 2.8), iz(-hd + 2.0), 'Search the kitchen drawer', 'stash');
      this.addHotspot(room, ix(-hw + 2.8), iz(1.8), 'Switch on the projector', 'display');
    } else if (archetype === 'atelier') {
      var canvasMat = new THREE.MeshStandardMaterial({ color: 0xd9d0bf, roughness: 0.9 });
      for (k = 0; k < 3; k++) {
        this.addPropBox(room, 1.9, 1.8 + (k % 2) * 0.6, 0.12, ix(-hw + 2.0 + k * 2.8), 1.25, iz(-hd + 0.35), canvasMat, false);
        this.addPropBox(room, 0.10, 2.1, 0.10, ix(-hw + 1.55 + k * 2.8), 1.05, iz(-hd + 0.28), shell, false);
      }
      for (k = 0; k < 4; k++) this.addPropCylinder(room, 0.45, 0.25, ix(-hw + 2.0 + k * 2.2), 0.13, iz(hd - 2.0), lit, true);
      this.addHotspot(room, ix(-hw + 4.2), iz(-hd + 1.6), 'Study the unfinished canvases', 'art');
      this.addHotspot(room, ix(hw - 2.0), iz(hd - 2.0), 'Turn the kiln dial', 'display');
    } else if (archetype === 'garage') {
      var lift = this.addPropBox(room, Math.min(7.5, hw * 1.25), 0.20, Math.min(5.5, hd * 0.62), ox, 0.12, oz + 1.4, metal, true);
      lift.material = new THREE.MeshStandardMaterial({ color: 0x313a42, roughness: 0.38, metalness: 0.75 });
      for (k = -1; k <= 1; k += 2) {
        this.addPropBox(room, 0.18, 2.9, 0.18, ix(k * 3.0), 1.45, iz(1.4), lit, true);
        this.addPropCylinder(room, 0.68, 0.26, ix(k * 4.4), 0.14, iz(-hd + 1.5), soft, true);
      }
      this.addPropBox(room, 5.6, 1.1, 0.9, ix(-hw + 3.3), 0.55, iz(-hd + 1.6), shell, true);
      this.addHotspot(room, ox, oz + 1.4, 'Inspect the vehicle lift', 'display');
      this.addHotspot(room, ix(-hw + 3.3), iz(-hd + 2.4), 'Open the mechanic locker', 'stash');
    } else if (archetype === 'arcade') {
      var cabinet = new THREE.MeshStandardMaterial({ color: 0x171d2b, roughness: 0.35, metalness: 0.35, emissive: 0x101b42, emissiveIntensity: 0.8 });
      n = 4 + room.variant % 3;
      for (k = 0; k < n; k++) {
        var ax = -hw + 1.6 + (k % 2) * 2.5, az = -hd + 2.0 + Math.floor(k / 2) * 2.5;
        this.addPropBox(room, 1.25, 1.95, 0.72, ix(ax), 0.98, iz(az), cabinet, true);
        this.addPropBox(room, 0.88, 0.48, 0.06, ix(ax), 1.58, iz(az - 0.39), lit, false);
      }
      var marquee = this.addPropBox(room, hw * 1.45, 0.18, 0.18, ox, 2.95, oz - hd + 0.5, lit, false);
      marquee.rotation.z = (room.variant % 2 ? 1 : -1) * 0.025;
      this.addHotspot(room, ix(-hw + 2.0), iz(-hd + 2.0), 'Start the cabinet tournament', 'jukebox');
      this.addHotspot(room, ix(hw - 2.0), iz(hd - 1.8), 'Claim the high-score ticket', 'stash');
    } else if (archetype === 'salon') {
      var mirror = new THREE.MeshStandardMaterial({ color: 0x9bd0d2, roughness: 0.15, metalness: 0.65, emissive: 0x173e46, emissiveIntensity: 0.35 });
      for (k = -1; k <= 1; k++) {
        this.addPropBox(room, 1.7, 2.1, 0.10, ix(k * 3.0), 1.45, iz(-hd + 0.3), mirror, false);
        seat = this.addPropCylinder(room, 0.42, 0.85, ix(k * 3.0), 0.42, iz(0.2), soft, true);
        seat.scale.x = 0.8;
      }
      this.addPropBox(room, hw * 1.25, 1.0, 0.8, ix(0), 0.5, iz(hd - 1.4), metal, true);
      this.addHotspot(room, ox, oz - hd + 1.4, 'Take the stylist chair', 'art');
      this.addHotspot(room, ox, oz + 1.2, 'Open the appointment book', 'notice');
    } else if (archetype === 'recording') {
      var stageMat = new THREE.MeshStandardMaterial({ color: 0x2a2037, roughness: 0.38, metalness: 0.3 });
      this.addPropBox(room, hw * 1.25, 0.65, 2.8, ox, 0.32, oz - hd + 2.7, stageMat, true);
      for (k = -1; k <= 1; k++) {
        this.addPropCylinder(room, 0.18, 2.7, ix(k * 2.0), 1.35, iz(-hd + 2.0), lit, false);
        this.addPropCylinder(room, 0.55, 0.35, ix(k * 2.0), 2.68, iz(-hd + 2.0), dark, false);
      }
      for (k = 0; k < 4; k++) this.addPropCylinder(room, 0.38, 0.22, ix(-hw + 2.0 + k * 1.5), 0.11, iz(hd - 2.0), soft, true);
      this.addHotspot(room, ox, oz - hd + 2.7, 'Cut a demo at the mic', 'stage');
      this.addHotspot(room, ix(hw - 2.0), iz(hd - 2.0), 'Open the sound booth', 'display');
    } else if (archetype === 'restaurant') {
      var bar = new THREE.MeshStandardMaterial({ color: 0x65452e, roughness: 0.62, metalness: 0.22 });
      this.addPropBox(room, hw * 1.35, 1.05, 1.0, ix(-hw + 3.2), 0.53, iz(-hd + 1.5), bar, true);
      for (k = -1; k <= 1; k++) this.addPropCylinder(room, 0.28, 0.82, ix(-hw + 1.7 + (k + 1) * 1.25), 0.41, iz(-hd + 3.0), brass, true);
      for (k = 0; k < 3; k++) {
        this.addPropBox(room, 1.8, 0.76, 1.0, ix(hw - 2.0), 0.38, iz(-hd + 3.0 + k * 2.5), soft, true);
      }
      this.addHotspot(room, ix(-hw + 3.2), iz(-hd + 2.4), 'Taste the house special', 'kitchen');
      this.addHotspot(room, ix(hw - 2.0), iz(hd - 2.0), 'Read the reservations ledger', 'notice');
    } else if (archetype === 'lab') {
      var labMat = new THREE.MeshStandardMaterial({ color: 0x3c5960, roughness: 0.32, metalness: 0.72 });
      for (k = -1; k <= 1; k++) {
        this.addPropBox(room, 3.7, 1.0, 0.9, ix(k * 4.1), 0.5, iz(-hd + 2.2), labMat, true);
        for (var tube = 0; tube < 3; tube++) this.addPropCylinder(room, 0.14, 0.9, ix(k * 4.1 - 0.75 + tube * 0.75), 1.45, iz(-hd + 1.9), lit, false);
      }
      this.addPropCylinder(room, 0.85, 2.5, ix(hw - 2.0), 1.25, iz(2.0), lit, true);
      this.addHotspot(room, ix(hw - 2.0), iz(2.0), 'Read the specimen label', 'display');
      this.addHotspot(room, ix(-hw + 2.4), iz(-hd + 2.4), 'Access the lab terminal', 'cameras');
    } else if (archetype === 'warehouse') {
      for (k = -1; k <= 1; k++) {
        this.addPropBox(room, 1.0, 3.8, hd * 1.35, ix(k * 6.0), 1.9, iz(1.8), metal, true);
        for (n = 0; n < 3; n++) this.addPropBox(room, 1.25, 0.13, hd * 1.18, ix(k * 6.0), 0.8 + n * 1.2, iz(1.8), lit, false);
      }
      this.addHotspot(room, ix(hw - 2.0), iz(-hd + 2.0), 'Scan the pallet barcode', 'manifest');
      this.addHotspot(room, ix(-hw + 2.0), iz(hd - 2.0), 'Open the cold-storage door', 'cooler');
    } else if (archetype === 'dojo') {
      var matFloor = new THREE.MeshStandardMaterial({ color: 0x385b52, roughness: 0.92 });
      this.addPropBox(room, hw * 1.35, 0.12, hd * 0.95, ox, 0.08, oz + 0.8, matFloor, false);
      for (k = -1; k <= 1; k++) this.addPropCylinder(room, 0.33, 2.0, ix(k * 3.7), 1.0, iz(-hd + 1.1), soft, true);
      for (k = 0; k < 4; k++) this.addPropBox(room, 1.3, 0.7, 0.8, ix(-hw + 1.6 + k * 1.8), 0.35, iz(hd - 1.4), metal, true);
      this.addHotspot(room, ox, oz - hd + 2.2, 'Start a sparring round', 'stage');
      this.addHotspot(room, ox, oz + hd - 1.6, 'Read the dojo rules', 'notice');
    } else {
      // Studio and penthouse share a lounge spine, but their silhouettes are
      // deliberately different: ring lights/photo backdrops versus bar/sofas.
      if (archetype === 'studio') {
        this.addPropBox(room, hw * 1.25, 2.5, 0.14, ox, 1.25, oz - hd + 0.28, soft, false);
        for (k = -1; k <= 1; k += 2) {
          var ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.10, 8, 18), lit);
          ring.position.set(ix(k * 3.1), 1.55, iz(-hd + 1.0)); ring.rotation.y = Math.PI / 2; g.add(ring); room.props.push(ring);
        }
        this.addHotspot(room, ox, oz - hd + 1.6, 'Step onto the photo set', 'stage');
        this.addHotspot(room, ix(hw - 2.0), iz(hd - 1.6), 'Review the contact sheet', 'display');
      } else {
        this.addPropBox(room, 5.8, 1.0, 0.9, ix(-hw + 3.5), 0.5, iz(-hd + 1.6), brass, true);
        for (k = -1; k <= 1; k += 2) this.addPropBox(room, 3.3, 0.85, 1.0, ix(k * 3.3), 0.42, iz(1.9), soft, true);
        this.addPropCylinder(room, 0.5, 0.7, ix(hw - 1.4), 0.35, iz(hd - 1.5), lit, true);
        this.addHotspot(room, ix(-hw + 3.5), iz(-hd + 2.4), 'Mix a drink at the penthouse bar', 'kitchen');
        this.addHotspot(room, ix(hw - 1.4), iz(hd - 1.5), 'Look out over Sunset Bay', 'art');
      }
    }
    this.addRoomSign(room, archetype.toUpperCase() + ' // ' + String(room.index + 1).padStart(3, '0'),
      '#' + new THREE.Color(t.color).getHexString(), '#0f141d', ox, room.h - 1.55, oz + hd - 0.22, 0, Math.min(7.8, hw * 1.3));
  };

  // Shared upstairs dressing: every extra level has a reason to exist.
  Interiors.prototype.furnishLevels = function (room) {
    if (room.levels < 2) return;
    var t = room.type, ox = room.x, oz = room.z, hw = room.hw, hd = room.hd;
    var g = room.group, levelH = room.levelHeight;
    var mat = new THREE.MeshStandardMaterial({
      color: t.id === 'bank' ? 0x6b6258 : (t.id === 'hotel' ? 0x8c6f7a : 0x7f8588),
      roughness: 0.82
    });
    for (var lv = 1; lv < room.levels; lv++) {
      var y = lv * levelH;
      var panel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.55),
        new THREE.MeshBasicMaterial({ color: t.color, transparent: true, opacity: 0.72 }));
      panel.position.set(ox - hw + 2.2, y + 0.05, oz + hd - 5.4);
      g.add(panel);
      if (t.id === 'hotel') {
        for (var h = -1; h <= 1; h += 2) {
          var bed = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.55, 1.7), mat);
          bed.position.set(ox + h * 4.2, y + 0.3, oz - 1.0 + (lv % 2) * 2.4);
          g.add(bed);
          this.world.addBox(bed.position.x - 1.65, bed.position.z - 0.85,
            bed.position.x + 1.65, bed.position.z + 0.85, y, y + 0.55, 'prop');
        }
      } else if (t.id === 'office') {
        for (var d = -1; d <= 1; d++) {
          var desk = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.75, 1.3), mat);
          desk.position.set(ox - 4.7 + d * 4.7, y + 0.38, oz + 1.8);
          g.add(desk);
          this.world.addBox(desk.position.x - 1.8, desk.position.z - 0.65,
            desk.position.x + 1.8, desk.position.z + 0.65, y, y + 0.75, 'prop');
        }
      } else if (t.id === 'clinic') {
        var exam = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 1.5), mat);
        exam.position.set(ox, y + 0.35, oz + 1.0 + (lv % 2) * 2.2);
        g.add(exam);
        this.world.addBox(exam.position.x - 1.6, exam.position.z - 0.75,
          exam.position.x + 1.6, exam.position.z + 0.75, y, y + 0.7, 'prop');
      } else if (t.id === 'bank') {
        var vault = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.6, 0.65), mat);
        vault.position.set(ox + hw - 2.0, y + 1.3, oz - hd + 1.2);
        g.add(vault);
        this.world.addBox(vault.position.x - 2.3, vault.position.z - 0.33,
          vault.position.x + 2.3, vault.position.z + 0.33, y, y + 2.6, 'prop');
      } else {
        var sofa = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.7, 1.2), mat);
        sofa.position.set(ox + 1.2, y + 0.35, oz + 1.4);
        g.add(sofa);
        this.world.addBox(sofa.position.x - 2.2, sofa.position.z - 0.6,
          sofa.position.x + 2.2, sofa.position.z + 0.6, y, y + 0.7, 'prop');
      }
    }
  };

  // ---------------------------------------------------------------- detail --
  // The rooms are deliberately authored as little set pieces rather than a
  // box plus a counter. These helpers keep the detail pass cheap (primitive
  // meshes, shared materials, and only a few collision boxes) while giving
  // every venue a strong silhouette and a reason to explore it.
  var SIGN_TEXTURES = Object.create(null);
  function signTexture(text, fg, bg) {
    var key = text + '|' + fg + '|' + bg;
    if (SIGN_TEXTURES[key]) return SIGN_TEXTURES[key];
    var c = SB.Tex.canvas(512, 128), ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = fg; ctx.lineWidth = 5; ctx.strokeRect(8, 8, 496, 112);
    ctx.font = 'bold 44px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = fg;
    ctx.fillText(text, 256, 66);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    SIGN_TEXTURES[key] = tex;
    return tex;
  }

  Interiors.prototype.addPropBox = function (room, w, h, d, x, y, z, mat, solid) {
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    room.group.add(mesh); room.props.push(mesh);
    if (solid) this.world.addBox(x - w / 2, z - d / 2, x + w / 2, z + d / 2,
      y - h / 2, y + h / 2, 'prop');
    return mesh;
  };

  Interiors.prototype.addPropCylinder = function (room, r, h, x, y, z, mat, solid) {
    var mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, h, 12), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    room.group.add(mesh); room.props.push(mesh);
    if (solid) this.world.addBox(x - r, z - r, x + r, z + r, y - h / 2, y + h / 2, 'prop');
    return mesh;
  };

  Interiors.prototype.addHotspot = function (room, x, z, label, kind, y) {
    room.hotspots.push({ x: x, z: z, y: y || 0.02, label: label, kind: kind });
  };

  Interiors.prototype.addRoomSign = function (room, text, color, bg, x, y, z, rotY, w) {
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(w || 4.8, (w || 4.8) * 0.25),
      new THREE.MeshBasicMaterial({ map: signTexture(text, color, bg), transparent: true, side: THREE.DoubleSide }));
    mesh.position.set(x, y, z); mesh.rotation.y = rotY || 0;
    room.group.add(mesh); room.props.push(mesh);
    return mesh;
  };

  Interiors.prototype.furnishArchitecture = function (room) {
    var t = room.type, ox = room.x, oz = room.z, hw = room.hw, hd = room.hd;
    var g = room.group, levelH = room.levelHeight, style = room.index % 4;
    var trim = new THREE.MeshStandardMaterial({ color: 0x292d35, roughness: 0.7, metalness: 0.25 });
    var accent = new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.45, metalness: 0.15 });
    var glow = new THREE.MeshBasicMaterial({ color: t.color, transparent: true, opacity: 0.9 });
    var dark = new THREE.MeshStandardMaterial({ color: 0x131820, roughness: 0.88 });
    var brass = new THREE.MeshStandardMaterial({ color: 0xd8a943, roughness: 0.34, metalness: 0.72 });

    // Strong architectural rhythm: columns, ceiling beams, and a back-wall
    // identity sign make the room read before the player reaches the props.
    var colX = hw > 8 ? hw - 2.1 : hw - 1.7;
    for (var c = -1; c <= 1; c += 2) {
      this.addPropBox(room, 0.34, room.h - 0.15, 0.34, ox + c * colX, (room.h - 0.15) / 2, oz - hd + 1.1, trim, false);
    }
    for (var beam = -1; beam <= 1; beam += 2) {
      this.addPropBox(room, hw * 1.72, 0.18, 0.34, ox, room.h - 0.25, oz + beam * hd * 0.43, trim, false);
    }
    this.addRoomSign(room, t.id.toUpperCase(), '#' + new THREE.Color(t.color).getHexString(), '#12161d',
      ox, room.h - 0.85, oz - hd + 0.22, Math.PI, Math.min(7.2, hw * 1.25));

    // A floor inlay gives the player visual landmarks for navigation and makes
    // the upper levels feel like distinct floors instead of repeated slabs.
    var inlay = new THREE.Mesh(new THREE.PlaneGeometry(hw * 1.55, 1.25), glow);
    inlay.rotation.x = -Math.PI / 2;
    inlay.position.set(ox + (style - 1.5) * 1.4, 0.035, oz + hd - 3.25);
    g.add(inlay); room.props.push(inlay);

    if (t.id === 'store') {
      var cool = new THREE.MeshStandardMaterial({ color: 0x273943, roughness: 0.34, metalness: 0.3, emissive: 0x0b2930, emissiveIntensity: 0.6 });
      this.addPropBox(room, 2.2, 2.35, 3.6, ox + hw - 1.5, 1.18, oz + 1.3, cool, true);
      for (var si = -1; si <= 1; si++) this.addPropBox(room, 0.95, 0.08, 0.55, ox + hw - 1.5, 0.7 + si * 0.48, oz - 0.15, glow, false);
      this.addHotspot(room, ox + hw - 1.5, oz + 1.3, 'Check the cold case', 'cooler');
      this.addHotspot(room, ox - hw + 2.0, oz + 2.1, 'Read the handwritten specials', 'notice');
    } else if (t.id === 'gunshop') {
      var rack = new THREE.MeshStandardMaterial({ color: 0x242b35, roughness: 0.45, metalness: 0.68 });
      for (var gi = -1; gi <= 1; gi++) {
        this.addPropBox(room, 0.22, 2.5, 4.9, ox + gi * 4.0, 1.45, oz + 1.1, rack, true);
        for (var gj = 0; gj < 4; gj++) this.addPropBox(room, 0.7, 0.09, 0.08, ox + gi * 4.0, 0.65 + gj * 0.52, oz - 1.35, brass, false);
      }
      this.addRoomSign(room, 'LIVE RANGE', '#ffcf66', '#26120f', ox + hw - 2.2, 2.8, oz - hd + 0.28, Math.PI, 3.2);
      this.addHotspot(room, ox + hw - 2.2, oz - hd + 1.6, 'Inspect the locked cases', 'gunlocker');
      this.addHotspot(room, ox - hw + 2.4, oz + 2.4, 'Try the firing range', 'range');
    } else if (t.id === 'diner') {
      var kitchen = new THREE.MeshStandardMaterial({ color: 0x53616a, roughness: 0.58, metalness: 0.48 });
      this.addPropBox(room, 4.8, 2.2, 3.8, ox + hw - 3.0, 1.1, oz + 1.2, kitchen, true);
      for (var ki = 0; ki < 3; ki++) this.addPropCylinder(room, 0.3, 1.0, ox + hw - 4.4 + ki * 1.3, 0.5, oz - 0.2, brass, true);
      var jukebox = this.addPropCylinder(room, 0.62, 1.75, ox - hw + 2.0, 0.88, oz - hd + 1.3, glow, true);
      jukebox.scale.z = 0.5;
      this.addHotspot(room, ox - hw + 2.0, oz - hd + 2.1, 'Play the jukebox', 'jukebox');
      this.addHotspot(room, ox + hw - 3.0, oz + 1.2, 'Peek into the kitchen', 'kitchen');
    } else if (t.id === 'club') {
      var stage = new THREE.MeshStandardMaterial({ color: 0x1b1428, roughness: 0.38, metalness: 0.35 });
      this.addPropBox(room, 6.8, 0.72, 2.5, ox, 0.36, oz - hd + 2.5, stage, true);
      this.addPropBox(room, 3.2, 1.15, 0.8, ox, 1.0, oz - hd + 3.0, dark, true);
      for (var li = -1; li <= 1; li++) this.addPropCylinder(room, 0.12, 3.2, ox + li * 2.25, 1.6, oz - hd + 1.35, glow, false);
      var disco = this.addPropCylinder(room, 0.62, 0.62, ox, room.h - 0.72, oz + 1.0, brass, false);
      disco.rotation.x = Math.PI / 2;
      this.addRoomSign(room, 'VIP', '#ef7bff', '#23102b', ox + hw - 2.5, 2.2, oz + hd - 0.25, 0, 2.2);
      this.addHotspot(room, ox, oz - hd + 2.5, 'Take the stage', 'stage');
      this.addHotspot(room, ox + hw - 2.5, oz + hd - 1.8, 'Enter the VIP booth', 'vip');
    } else if (t.id === 'safehouse') {
      var wood = new THREE.MeshStandardMaterial({ color: 0x543b2a, roughness: 0.86 });
      this.addPropBox(room, 4.5, 0.12, 2.3, ox - hw + 3.1, 2.0, oz - hd + 0.55, wood, false);
      for (var wi = -1; wi <= 1; wi++) this.addPropBox(room, 0.16, 1.2, 1.0, ox - hw + 1.2 + wi * 1.25, 1.4, oz - hd + 0.85, brass, false);
      var kitchenMat = new THREE.MeshStandardMaterial({ color: 0x78806e, roughness: 0.72 });
      this.addPropBox(room, 4.0, 1.0, 1.0, ox + hw - 2.8, 0.5, oz - hd + 1.3, kitchenMat, true);
      this.addHotspot(room, ox + hw - 2.8, oz - hd + 2.0, 'Open the kitchen stash', 'stash');
      this.addHotspot(room, ox - hw + 3.1, oz - hd + 1.5, 'Inspect the wall map', 'wallmap');
    } else if (t.id === 'warehouse') {
      var steel = new THREE.MeshStandardMaterial({ color: 0x39424a, roughness: 0.56, metalness: 0.75 });
      for (var si2 = -1; si2 <= 1; si2++) {
        this.addPropBox(room, 1.0, 4.2, 10.5, ox + si2 * 7.0, 2.1, oz + 2.0, steel, true);
        for (var sl = 0; sl < 3; sl++) this.addPropBox(room, 1.3, 0.12, 9.3, ox + si2 * 7.0, 0.9 + sl * 1.25, oz + 2.0, brass, false);
      }
      var forklift = this.addPropBox(room, 1.7, 1.3, 2.6, ox + hw - 3.0, 0.65, oz - hd + 3.1, brass, true);
      this.addPropBox(room, 0.12, 2.4, 0.12, forklift.position.x - 0.55, 1.85, forklift.position.z - 1.0, steel, false);
      this.addPropBox(room, 0.12, 2.4, 0.12, forklift.position.x + 0.55, 1.85, forklift.position.z - 1.0, steel, false);
      this.addHotspot(room, ox + hw - 3.0, oz - hd + 3.1, 'Start the forklift', 'forklift');
      this.addHotspot(room, ox - hw + 2.0, oz + hd - 2.0, 'Read the cargo manifest', 'manifest');
    } else if (t.id === 'bank') {
      var marble = new THREE.MeshStandardMaterial({ color: 0xb7b0a3, roughness: 0.34, metalness: 0.16 });
      for (var bi = -1; bi <= 1; bi++) this.addPropCylinder(room, 0.16, 1.0, ox - 4.5 + bi * 4.5, 0.5, oz - hd + 4.1, brass, false);
      this.addPropBox(room, 7.0, 0.16, 0.65, ox, 0.92, oz - hd + 4.1, marble, false);
      this.addRoomSign(room, 'SECURITY', '#f6d579', '#252019', ox - hw + 3.2, 2.65, oz + hd - 0.25, 0, 3.8);
      this.addHotspot(room, ox - hw + 3.2, oz + hd - 1.7, 'Check the security monitors', 'cameras');
      this.addHotspot(room, ox - hw + 2.1, oz - hd + 4.1, 'Use the ATM', 'atm');
    } else if (t.id === 'hotel') {
      var lift = new THREE.MeshStandardMaterial({ color: 0x53606a, roughness: 0.28, metalness: 0.7 });
      this.addPropBox(room, 2.8, 3.0, 1.2, ox - hw + 2.0, 1.5, oz + hd - 1.0, lift, true);
      this.addRoomSign(room, 'ELEVATOR', '#d9f3ff', '#162632', ox - hw + 2.0, 2.2, oz + hd - 0.35, 0, 2.9);
      var plant = new THREE.MeshStandardMaterial({ color: 0x2e8b57, roughness: 0.92 });
      for (var pi = -1; pi <= 1; pi++) this.addPropCylinder(room, 0.38, 0.5, ox + pi * 3.1, 0.25, oz + 3.0, plant, true);
      this.addHotspot(room, ox - hw + 2.0, oz + hd - 2.0, 'Call the elevator', 'elevator');
      this.addHotspot(room, ox, oz + 3.0, 'Admire the lobby art', 'art');
    } else if (t.id === 'office') {
      var glass = new THREE.MeshStandardMaterial({ color: 0x4fa1bd, transparent: true, opacity: 0.28, roughness: 0.12, metalness: 0.35 });
      this.addPropBox(room, 7.0, 2.4, 0.14, ox, 1.2, oz + hd - 2.0, glass, false);
      this.addRoomSign(room, 'BOARDROOM', '#9eeeff', '#10232c', ox, 2.35, oz + hd - 1.88, 0, 4.4);
      var screen = this.addPropBox(room, 3.8, 2.0, 0.12, ox, 1.9, oz - hd + 0.3, dark, false);
      screen.material = new THREE.MeshStandardMaterial({ color: 0x101b24, emissive: 0x1d7187, emissiveIntensity: 1.25, roughness: 0.25 });
      for (var si3 = -1; si3 <= 1; si3++) this.addPropBox(room, 0.08, 2.8, 0.08, ox + si3 * 1.5, 1.4, oz - hd + 0.1, glow, false);
      this.addHotspot(room, ox, oz + hd - 2.0, 'Enter the boardroom', 'boardroom');
      this.addHotspot(room, ox, oz - hd + 1.5, 'Wake the wall display', 'display');
    } else if (t.id === 'clinic') {
      var med = new THREE.MeshStandardMaterial({ color: 0xe8f3ef, roughness: 0.28, metalness: 0.15 });
      this.addPropBox(room, 4.4, 2.4, 2.0, ox + hw - 2.7, 1.2, oz + hd - 2.0, med, true);
      for (var xi = -1; xi <= 1; xi++) this.addPropBox(room, 0.7, 1.2, 0.45, ox + hw - 4.2 + xi * 1.4, 1.15, oz + hd - 0.65, glow, false);
      this.addRoomSign(room, 'TRIAGE', '#d8ffff', '#164048', ox + hw - 2.7, 2.35, oz + hd - 0.85, 0, 3.1);
      this.addHotspot(room, ox + hw - 2.7, oz + hd - 1.0, 'Open the medicine cabinet', 'medicine');
      this.addHotspot(room, ox - hw + 2.3, oz + hd - 2.0, 'Check the triage board', 'triage');
    }

    // Give each upper floor its own landing marker and one small “discovery”
    // interaction. This makes climbing worthwhile even when the main service
    // counter is downstairs.
    for (var lv = 1; lv < room.levels; lv++) {
      var fy = lv * levelH;
      var landing = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.7), glow);
      landing.rotation.x = -Math.PI / 2;
      landing.position.set(ox - hw + 2.2, fy + 0.045, oz + hd - 5.3);
      g.add(landing); room.props.push(landing);
      this.addHotspot(room, ox - hw + 2.2, oz + hd - 5.3, 'Explore level ' + (lv + 1), 'level', fy + 0.05);
    }
  };

  // ---------------------------------------------------------------- doors --
  // Attach each interior instance to a real building face, matched by
  // whether it needs a lit storefront and which district suits it. Picking
  // randomly from the whole eligible pool (rather than nearest-to-a-fixed-
  // point) is what spreads dozens of doors across the entire city instead of
  // clustering them.
  Interiors.prototype.placeDoors = function () {
    var city = this.game.city;
    if (!city) return;

    var doorMat = new THREE.MeshStandardMaterial({
      color: 0x2a2f38, roughness: 0.5, metalness: 0.3,
      emissive: 0x000000
    });
    var glowMat = new THREE.MeshBasicMaterial({
      color: 0xffd36e, transparent: true, opacity: 0.55, side: THREE.DoubleSide
    });

    var used = Object.create(null);
    var pool = [];
    var self = this;

    function addDoor(room, b) {
      var t = room.type;
      // Buildings face the street they were set back from, so the entrance
      // goes on the frontage - the face at -hd in the building's own frame.
      // Picking the nearest axis-aligned side instead, as this used to, puts
      // half the doors round the back on any street that is not a compass line.
      var s = Math.sin(b.yaw), c = Math.cos(b.yaw);
      var nx = s, nz = -c;                         // outward from the frontage
      var dx = b.cx + s * b.hd;
      var dz = b.cz - c * b.hd;
      var face = { nx: nx, nz: nz };
      var baseY = b.baseY || 0;

      var group = new THREE.Group();
      var door = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.5, 0.18), doorMat);
      door.position.set(dx + nx * 0.12, baseY + 1.42, dz + nz * 0.12);
      door.rotation.y = -b.yaw;
      group.add(door);

      var glow = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.55), glowMat);
      glow.position.set(dx + nx * 0.30, baseY + 3.05, dz + nz * 0.30);
      glow.rotation.y = -b.yaw;
      group.add(glow);

      var pad = new THREE.Mesh(
        new THREE.CircleGeometry(1.5, 20),
        new THREE.MeshBasicMaterial({
          color: t.color, transparent: true, opacity: 0.30,
          depthWrite: false, blending: THREE.AdditiveBlending
        }));
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(dx + face.nx * 1.6, baseY + 0.21, dz + face.nz * 1.6);
      pad.renderOrder = 3;
      group.add(pad);

      self.scene.add(group);
      var entry = {
        room: room,
        x: dx + face.nx * 1.5,
        z: dz + face.nz * 1.5,
        yaw: Math.atan2(-face.nz, -face.nx),
        group: group, pad: pad, glow: glow,
        name: room.name
      };
      self.doors.push(entry);
      // A room can be reached from several buildings, but its primary door
      // remains stable for debug spawning and return-point bookkeeping.
      if (!room.door) room.door = entry;
    }

    for (var r = 0; r < this.rooms.length; r++) {
      var room = this.rooms[r];
      var t = room.type;

      pool.length = 0;
      var i;
      for (i = 0; i < city.buildings.length; i++) {
        var b = city.buildings[i];
        if (used[b.id]) continue;
        if (t.needsShop && !b.hasShop) continue;
        if (t.districts && t.districts.indexOf(b.district) < 0) continue;
        pool.push(b);
      }
      if (!pool.length) {
        // relax the district preference before giving up on this instance
        for (i = 0; i < city.buildings.length; i++) {
          var b2 = city.buildings[i];
          if (used[b2.id]) continue;
          if (t.needsShop && !b2.hasShop) continue;
          pool.push(b2);
        }
      }
      if (!pool.length) continue;
      var best = pool[this.rng.int(0, pool.length - 1)];
      used[best.id] = true;
      addDoor(room, best);
    }

    // Every remaining building gets its own generated room object. There is
    // intentionally no shared fallback here: the footprint, archetype, seed,
    // signage, props, and discoveries all belong to this one address.
    var roomCols = Math.max(1, Math.ceil(Math.sqrt(city.buildings.length)));
    for (i = 0; i < city.buildings.length; i++) {
      var extra = city.buildings[i];
      if (used[extra.id]) continue;
      var generated = this.generatedType(extra, i);
      var uniqueRoom = this.buildRoom(generated, this.generatedName(extra, i), this.rooms.length, roomCols);
      // hidden until entered, like every other room
      if (uniqueRoom.group) uniqueRoom.group.visible = false;
      this.rooms.push(uniqueRoom);
      used[extra.id] = true;
      addDoor(uniqueRoom, extra);
    }
  };

  // -------------------------------------------------------- pay 'n' spray --
  // Drive in dirty, drive out clean. The classic escape valve for a chase.
  Interiors.prototype.buildSpray = function () {
    // put it on the surface lot nearest the east side of midtown
    var L = this.L;
    var blk = null, bd = 1e18;
    for (var i = 0; i < L.blocks.length; i++) {
      var b = L.blocks[i];
      if (b.kind !== 'lot') continue;
      var d = M.dist2(b.cx, b.cz, 232, -96);
      if (d < bd) { bd = d; blk = b; }
    }
    if (!blk) blk = L.blocks[0];
    blk.kind = 'spray';
    var cx = blk.cx, cz = blk.cz;
    var w = 14, d = 10;

    var qb = new QB();
    // three walls and a roof, open toward -z
    qb.box(cx - w / 2, 0.2, cz - d / 2, cx - w / 2 + 0.5, 5.0, cz + d / 2, 4, 4, 4, {});
    qb.box(cx + w / 2 - 0.5, 0.2, cz - d / 2, cx + w / 2, 5.0, cz + d / 2, 4, 4, 4, {});
    qb.box(cx - w / 2, 0.2, cz + d / 2 - 0.5, cx + w / 2, 5.0, cz + d / 2, 4, 4, 4, {});
    qb.box(cx - w / 2, 4.6, cz - d / 2, cx + w / 2, 5.0, cz + d / 2, 4, 4, 4, {});
    this.world.addBox(cx - w / 2, cz - d / 2, cx - w / 2 + 0.5, cz + d / 2, 0, 5, 'building');
    this.world.addBox(cx + w / 2 - 0.5, cz - d / 2, cx + w / 2, cz + d / 2, 0, 5, 'building');
    this.world.addBox(cx - w / 2, cz + d / 2 - 0.5, cx + w / 2, cz + d / 2, 0, 5, 'building');

    var mesh = qb.mesh(new THREE.MeshStandardMaterial({ color: 0xc9bda6, roughness: 0.85 }), true, true);
    this.scene.add(mesh);

    var signCanvas = SB.Tex.canvas(512, 128);
    var ctx = signCanvas.getContext('2d');
    ctx.fillStyle = '#12161c'; ctx.fillRect(0, 0, 512, 128);
    ctx.font = 'bold 64px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd76b';
    ctx.fillText('PAY N SPRAY', 256, 66);
    var signTex = new THREE.CanvasTexture(signCanvas);
    signTex.colorSpace = THREE.SRGBColorSpace;
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, w * 0.2),
      new THREE.MeshStandardMaterial({
        map: signTex, emissiveMap: signTex, emissive: 0xffffff, emissiveIntensity: 0.6
      }));
    sign.position.set(cx, 5.6, cz - d / 2 + 0.1);
    sign.rotation.y = Math.PI;
    this.scene.add(sign);

    this.spray = {
      x: cx, z: cz, hw: w / 2 - 1.2, hd: d / 2 - 1.0,
      cooldown: 0, price: 220
    };
  };

  // ---------------------------------------------------------------- state --
  Interiors.prototype.nearestDoor = function (x, z, maxDist) {
    var best = null, bd = maxDist * maxDist;
    for (var i = 0; i < this.doors.length; i++) {
      var d = this.doors[i];
      var dd = M.dist2(d.x, d.z, x, z);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  };

  Interiors.prototype.nearestHotspot = function (room, x, z, y, maxDist) {
    if (!room || !room.hotspots) return null;
    var best = null, bd = maxDist * maxDist;
    for (var i = 0; i < room.hotspots.length; i++) {
      var h = room.hotspots[i];
      if (Math.abs((h.y || 0) - y) > 1.35) continue;
      var dd = M.dist2(h.x, h.z, x, z);
      if (dd < bd) { bd = dd; best = h; }
    }
    return best;
  };

  Interiors.prototype.activateHotspot = function (spot) {
    var g = this.game, p = g.player, text = '';
    switch (spot.kind) {
      case 'cooler': text = 'Cold case checked. Someone left a note in the ice.'; break;
      case 'notice': text = '“No cameras after midnight.” The handwriting is fresh.'; break;
      case 'gunlocker': text = 'The cases are locked. The range waiver is signed.'; break;
      case 'range': text = 'Range hot. Your next shot has a cleaner sight picture.'; if (g.combat) g.combat.recoil = 0; break;
      case 'jukebox': text = 'The jukebox kicks on: neon soul, volume eleven.'; break;
      case 'kitchen': text = 'Kitchen pass: the cook waves you behind the line.'; break;
      case 'stage': text = 'The stage lights snap on. Every eye in the room turns.'; break;
      case 'vip': text = 'VIP booth unlocked for the night.'; break;
      case 'stash':
        if (!this.current.stashTaken) { this.current.stashTaken = true; p.money += 240; text = 'Emergency stash found: +$240'; }
        else text = 'The hidden drawer is empty.';
        break;
      case 'wallmap': text = 'A hand-drawn route marks a tunnel under the old freeway.'; break;
      case 'forklift': text = 'Forklift battery is dead. The cargo manifest is still useful.'; break;
      case 'manifest': text = 'Manifest: three crates are not on the books.'; break;
      case 'cameras': text = 'Camera loop: 18 seconds. The vault is exposed.'; break;
      case 'atm': text = 'ATM status: offline. The vault is the only way in.'; break;
      case 'elevator': text = 'Elevator unlocked. Upper floors are open.'; break;
      case 'art': text = 'The lobby painting is a map of the bay at low tide.'; break;
      case 'boardroom': text = 'Boardroom projector: “Project Undertow — confidential.”'; break;
      case 'display': text = 'Wall display online. A storm system is moving in from offshore.'; break;
      case 'medicine':
        if (p.health < p.maxHealth) { p.health = Math.min(p.maxHealth, p.health + 18); text = 'First-aid kit used: health restored.'; }
        else text = 'The cabinet is stocked, but you do not need it.';
        break;
      case 'triage': text = 'Triage board: all rooms clear. Someone circled your name.'; break;
      case 'level': text = 'Level ' + Math.round((spot.y || 0) / this.current.levelHeight + 1) + ' explored.'; break;
      default: text = 'You found something worth remembering.';
    }
    if (text) g.bus.emit('toast', { text: text });
  };

  Interiors.prototype.enter = function (door) {
    this.pending = { kind: 'in', door: door };
    this.fadeDir = 1;
  };

  Interiors.prototype.leave = function () {
    this.pending = { kind: 'out' };
    this.fadeDir = 1;
  };

  Interiors.prototype.applyPending = function () {
    var p = this.game.player;
    var pd = this.pending;
    this.pending = null;
    if (!pd) return;
    if (pd.kind === 'in') {
      var room = pd.door.room;
      this.returnPoint = { x: pd.door.x, z: pd.door.z, yaw: pd.door.yaw + Math.PI };
      this.current = room;
      if (room.group) room.group.visible = true;
      p.pos.set(room.spawn.x, 0.02, room.spawn.z);
      p.vel.set(0, 0, 0);
      p.yaw = -Math.PI / 2;
      p.camYaw = -Math.PI / 2;
      this.setWorldVisible(false);
      if (this.game.post) this.game.post.resetHistory();
      this.lamp.position.set(room.x, room.h - 0.4, room.z);
      this.lamp.intensity = room.type.dark ? 12 : 42;
      this.lamp.color.setHex(room.type.dark ? 0xb060ff : 0xffe9c4);
      this.game.bus.emit('interiorEntered', room);
    } else {
      var rp = this.returnPoint || { x: 0, z: 0, yaw: 0 };
      if (this.current && this.current.group) this.current.group.visible = false;
      this.current = null;
      p.pos.set(rp.x, 0.4, rp.z);
      var s = this.world.surfaceAt(rp.x, rp.z, 30, 40);
      p.pos.y = s.y;
      p.vel.set(0, 0, 0);
      p.yaw = rp.yaw;
      p.camYaw = rp.yaw;
      this.setWorldVisible(true);
      if (this.game.post) this.game.post.resetHistory();
      this.lamp.intensity = 0;
      this.game.bus.emit('interiorLeft', {});
    }
  };

  Interiors.prototype.setWorldVisible = function (on) {
    var g = this.game;
    if (g.city) g.city.root.visible = on;
    if (g.props) g.props.root.visible = on;
    g.sky.water.visible = on;
    g.worldHidden = !on;
    // freeze the street population while you are inside
    if (g.traffic) g.traffic.density = on ? 1 : 0;
    if (g.peds) g.peds.density = on ? 1 : 0;
  };

  Interiors.prototype.fixed = function (dt) {
    var g = this.game, p = g.player;
    if (!p) return;

    // fade in/out around the teleport
    if (this.fadeDir !== 0) {
      this.fade += this.fadeDir * dt * 3.4;
      if (this.fade >= 1) {
        this.fade = 1;
        this.applyPending();
        this.fadeDir = -1;
      } else if (this.fade <= 0) {
        this.fade = 0;
        this.fadeDir = 0;
      }
      return;
    }

    // A menu is open: do not let E fall through and immediately reopen it.
    if (g.uiBlocking) { this.prompt = null; return; }

    if (p.mode !== 'foot' || p.dead) { this.prompt = null; }
    else if (this.current) {
      var d = M.dist(p.pos.x, p.pos.z, this.current.exit.x, this.current.exit.z);
      if (d < 2.2) {
        this.prompt = { text: 'Leave', key: 'E' };
        if (g.input.actHit('interact')) this.leave();
      } else if (this.current.counter &&
        M.dist(p.pos.x, p.pos.z, this.current.counter.x, this.current.counter.z) < 2.2) {
        this.prompt = { text: this.serviceLabel(), key: 'E' };
        if (g.input.actHit('interact')) {
          if (this.current.service === 'bank') this.robBank(this.current);
          else g.bus.emit('openService', this.current);
        }
      } else {
        var hotspot = this.nearestHotspot(this.current, p.pos.x, p.pos.z, p.pos.y, 2.1);
        this.prompt = hotspot ? { text: hotspot.label, key: 'E' } : null;
        if (hotspot && g.input.actHit('interact')) this.activateHotspot(hotspot);
      }
    } else {
      var door = this.nearestDoor(p.pos.x, p.pos.z, 2.6);
      if (door) {
        this.prompt = { text: 'Enter ' + door.name, key: 'E' };
        if (g.input.actHit('interact')) this.enter(door);
      } else {
        this.prompt = null;
      }
    }

    this.updateSpray(dt);
  };

  Interiors.prototype.serviceLabel = function () {
    switch (this.current.service) {
      case 'store': return 'Shop';
      case 'gunshop': return 'Buy weapons';
      case 'diner': return 'Order food';
      case 'club': return 'Buy a drink';
      case 'safehouse': return 'Rest';
      case 'warehouse': return 'Look around';
      case 'bank': return this.current && this.current.robbed ? 'Vault is empty' : 'Rob the bank';
      case 'hotel': return 'Check in';
      case 'office': return 'Use reception';
      case 'clinic': return 'See the doctor';
    }
    return 'Use';
  };

  Interiors.prototype.robBank = function (room) {
    var g = this.game, p = g.player;
    if (!room || room.robbed) {
      g.bus.emit('toast', { text: 'The vault is empty' });
      return;
    }
    room.robbed = true;
    p.money += room.loot;
    if (g.police) {
      // A bank alarm is loud enough to bring a serious response, even if the
      // teller had no line of sight to the street.
      g.police.addHeat(4.2);
    }
    if (room.vault) {
      room.vault.material.emissive.setHex(0x551010);
      room.vault.material.emissiveIntensity = 1.2;
      room.vault.rotation.z = 0.7;
    }
    g.bus.emit('toast', { text: 'Vault hit: +' + SB.formatMoney(room.loot) + '  ALARM!', accent: '#8fe08f' });
    if (g.progress) {
      g.progress.stats.robberies++;
      g.progress.stats.earned += room.loot;
      g.progress.award(SB.Progress.AWARD.robbery, null);
    }
    if (g.audio) g.audio.blip('wanted');
  };

  Interiors.prototype.updateSpray = function (dt) {
    var sp = this.spray;
    if (!sp) return;
    if (sp.cooldown > 0) sp.cooldown -= dt;
    var p = this.game.player;
    if (p.mode !== 'car' || !p.vehicle) return;
    var v = p.vehicle;
    if (Math.abs(v.pos.x - sp.x) > sp.hw || Math.abs(v.pos.z - sp.z) > sp.hd) return;
    if (v.speed() > 3) return;
    if (sp.cooldown > 0) return;
    // only charge you when there is something to fix
    var wanted = this.game.police ? this.game.police.stars : 0;
    if (wanted === 0 && v.health >= v.maxHealth * 0.995) {
      this.game.bus.emit('toast', { text: 'Nothing to fix' });
      sp.cooldown = 5;
      return;
    }
    if (p.money < sp.price) {
      this.game.bus.emit('toast', { text: 'Pay n Spray needs ' + SB.formatMoney(sp.price) });
      sp.cooldown = 4;
      return;
    }
    p.money -= sp.price;
    v.health = v.maxHealth;
    v.destroyed = false;
    v.smoking = false;
    v.burning = 0;
    v.setColor(SB.PAINTS[Math.floor(Math.random() * SB.PAINTS.length)]);
    sp.cooldown = 8;
    if (this.game.police) this.game.police.clearWanted();
    this.game.bus.emit('toast', { text: 'Resprayed. Heat off. -' + SB.formatMoney(sp.price) });
    if (this.game.audio) this.game.audio.blip('cash');
  };

  Interiors.prototype.render = function (dt) {
    // club floor pulses
    if (this.current && this.current.tiles) {
      var t = performance.now() / 1000;
      for (var i = 0; i < this.current.tiles.length; i++) {
        var tile = this.current.tiles[i];
        var h = (Math.sin(t * 2.2 + i * 0.7) * 0.5 + 0.5);
        tile.material.color.setHSL((t * 0.08 + i * 0.02) % 1, 0.85, 0.18 + h * 0.42);
      }
      this.lamp.color.setHSL((t * 0.12) % 1, 0.7, 0.55);
    }
    var lamps = this.game.sky.lampFactor();
    var now = performance.now();
    for (i = 0; i < this.doors.length; i++) {
      var d = this.doors[i];
      d.glow.material.opacity = 0.25 + lamps * 0.5;
      d.pad.material.opacity = 0.18 + Math.sin(now / 520 + i) * 0.06 + lamps * 0.14;
    }
  };

  SB.Interiors = Interiors;

})(window.SB = window.SB || {});
