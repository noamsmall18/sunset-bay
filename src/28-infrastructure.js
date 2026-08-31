// 28-infrastructure.js - the places that make the new craft usable.
//
// A real airport, a walkable marina, a second public boat berth, and three
// helipads turn boats and aircraft from constructor demos into things a player
// can discover, enter, operate, land, and return to.  Everything is generated
// from geometry and canvas textures, matching the asset-free rest of the game.
(function (SB) {
  'use strict';

  var M = SB.M, QB = SB.QB;

  function Transport(game) {
    this.game = game;
    this.scene = game.scene;
    this.world = game.world;
    this.layout = game.layout;
    this.root = new THREE.Group();
    this.root.name = 'transport-infrastructure';
    this.scene.add(this.root);

    this.landmarks = [];
    this.helipads = [];
    this.runwayLights = [];
    this.beaconMats = [];
    this.spawned = { boats: [], planes: [], helis: [] };

    this.buildAirport();
    this.buildMarina();
    this.buildHelipads();
    this.spawnCraft();
  }

  function mat(color, roughness, metalness) {
    return new THREE.MeshStandardMaterial({
      color: color,
      roughness: roughness === undefined ? 0.8 : roughness,
      metalness: metalness || 0
    });
  }

  function box(root, x, y, z, w, h, d, material, shadow) {
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y + h * 0.5, z);
    mesh.castShadow = shadow !== false;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }

  function cylinder(root, x, y, z, radius, height, material, segments, shadow) {
    var mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments || 8), material);
    mesh.position.set(x, y + height * 0.5, z);
    mesh.castShadow = shadow !== false;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }

  function beam(root, ax, ay, az, bx, by, bz, radius, material) {
    var a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz);
    var delta = new THREE.Vector3().subVectors(b, a);
    var mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 6), material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
    return mesh;
  }

  function bollard(root, x, y, z, material) {
    cylinder(root, x, y, z, 0.10, 0.42, material, 7);
    box(root, x, y + 0.35, z, 0.34, 0.08, 0.16, material, false);
  }

  function beacon(root, x, y, z, material, height) {
    cylinder(root, x, y, z, 0.06, height, material, 6);
    cylinder(root, x, y + height, z, 0.18, 0.20, material, 8);
  }

  function fenceLine(root, x0, z0, x1, z1, y, length, postMat, railMat) {
    var dx = x1 - x0, dz = z1 - z0;
    var span = Math.max(1, Math.hypot(dx, dz));
    var count = Math.floor(span / (length || 10));
    for (var i = 0; i <= count; i++) {
      var t = i / Math.max(1, count);
      cylinder(root, M.lerp(x0, x1, t), y, M.lerp(z0, z1, t), 0.07, 1.35, postMat, 6);
    }
    beam(root, x0, y + 1.08, z0, x1, y + 1.08, z1, 0.045, railMat);
    beam(root, x0, y + 0.48, z0, x1, y + 0.48, z1, 0.035, railMat);
  }

  function slab(root, world, x0, z0, x1, z1, y, material, kind) {
    box(root, (x0 + x1) * 0.5, y - 0.18, (z0 + z1) * 0.5,
      x1 - x0, 0.36, z1 - z0, material, false);
    world.addPlatform(x0, z0, x1, z1, y, kind || 'concrete');
  }

  function groundMark(root, x, z, w, d, color, y, opacity) {
    var material = new THREE.MeshBasicMaterial({
      color: color,
      transparent: opacity !== undefined,
      opacity: opacity === undefined ? 1 : opacity,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y || 0.17, z);
    mesh.renderOrder = 2;
    root.add(mesh);
    return mesh;
  }

  function signTexture(title, sub, accent) {
    var c = document.createElement('canvas');
    c.width = 768; c.height = 256;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#101720'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = accent; ctx.fillRect(0, 0, 22, c.height);
    ctx.fillRect(0, c.height - 18, c.width, 18);
    ctx.fillStyle = '#f4f1ea';
    ctx.font = '900 72px Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(title, c.width * 0.52, 96);
    ctx.fillStyle = '#aeb9c6';
    ctx.font = '600 31px Arial, sans-serif';
    ctx.fillText(sub, c.width * 0.52, 172);
    var texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }

  function addSign(root, x, y, z, yaw, w, title, sub, accent) {
    var group = new THREE.Group();
    var texture = signTexture(title, sub, accent);
    var face = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w / 3),
      new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap: texture,
        emissive: 0xffffff,
        emissiveIntensity: 0.25,
        roughness: 0.65,
        side: THREE.DoubleSide
      }));
    face.position.y = w / 6 + 2.2;
    group.add(face);
    var poleMat = mat(0x323941, 0.55, 0.55);
    box(group, -w * 0.32, 0, 0, 0.28, 2.4, 0.28, poleMat);
    box(group, w * 0.32, 0, 0, 0.28, 2.4, 0.28, poleMat);
    group.position.set(x, y, z);
    group.rotation.y = yaw;
    root.add(group);
    return group;
  }

  Transport.prototype.addLandmark = function (id, name, x, z, color, kind) {
    this.landmarks.push({ id: id, name: name, x: x, z: z, color: color, kind: kind });
  };

  // --------------------------------------------------------------- airport
  Transport.prototype.buildAirport = function () {
    var root = new THREE.Group();
    root.name = 'sunset-bay-airport';
    this.root.add(root);
    var world = this.world;
    var asphalt = mat(0x2c3137, 0.92, 0.04);
    var concrete = mat(0x777a78, 0.9);
    var airportTrim = mat(0x3e4a52, 0.62, 0.5);
    var white = 0xf1eee4, yellow = 0xe6bd38;

    // The runway sits immediately south of the street grid, close enough to
    // reach on foot but long and obstruction-free enough for a real takeoff.
    slab(root, world, -390, -552, 390, -518, 0.12, asphalt, 'asphalt');
    slab(root, world, -330, -505, 315, -489, 0.13, asphalt, 'asphalt');
    slab(root, world, -355, -515, -205, -463, 0.14, concrete, 'concrete');
    slab(root, world, -307, -489, -293, -424, 0.13, asphalt, 'asphalt');
    world.addLandingZone(-390, -552, 390, -518, 0.12, 'runway', { plane: true, heli: false, heading: 0 });
    world.addLandingZone(-330, -505, 315, -489, 0.13, 'apron', { plane: true, heli: false, heading: 0 });

    // Runway edge, centreline, threshold bars and aiming blocks.
    groundMark(root, 0, -550.8, 770, 0.55, white, 0.145);
    groundMark(root, 0, -519.2, 770, 0.55, white, 0.145);
    for (var x = -340; x <= 340; x += 28) groundMark(root, x, -535, 13, 0.65, white, 0.15);
    for (var side = -1; side <= 1; side += 2) {
      var tx = side * 358;
      for (var row = -4; row <= 4; row++) groundMark(root, tx, -535 + row * 3.1, 11, 0.8, white, 0.15);
      groundMark(root, side * 285, -528, 26, 2.3, white, 0.15);
      groundMark(root, side * 285, -542, 26, 2.3, white, 0.15);
    }
    groundMark(root, 0, -497, 620, 0.45, yellow, 0.16);
    groundMark(root, -300, -456, 0.45, 62, yellow, 0.16);
    // Taxiway centreline and hold-short bars make the airport readable from
    // the cockpit as a connected airfield instead of a single painted strip.
    for (x = -320; x <= 300; x += 24) groundMark(root, x, -497, 9, 0.32, yellow, 0.17);
    for (var hold = -1; hold <= 1; hold += 2) {
      groundMark(root, hold * 206, -513.5, 0.34, 8, yellow, 0.17);
      groundMark(root, hold * 206, -516.0, 0.34, 8, yellow, 0.17);
    }

    // Edge lights are small emissive lenses, not real lights, so the entire
    // runway remains cheap enough for mobile while still reading at night.
    var edgeMat = new THREE.MeshStandardMaterial({
      color: 0x89b8d8, emissive: 0x79c8ff, emissiveIntensity: 0.2,
      roughness: 0.25, metalness: 0.2
    });
    this.beaconMats.push(edgeMat);
    var lightGeo = new THREE.SphereGeometry(0.16, 7, 5);
    for (x = -380; x <= 380; x += 20) {
      for (side = -1; side <= 1; side += 2) {
        var lamp = new THREE.Mesh(lightGeo, edgeMat);
        lamp.position.set(x, 0.32, -535 + side * 16.1);
        root.add(lamp); this.runwayLights.push(lamp);
      }
    }

    // Two hangars, terminal, and a control tower give the field a readable
    // silhouette without placing anything near the active runway.
    var hangarMat = mat(0x8a9093, 0.72, 0.32);
    var hangarDark = mat(0x1a2026, 0.82, 0.15);
    box(root, -332, 0.14, -447, 43, 12, 28, hangarMat);
    box(root, -332, 1.0, -461.2, 33, 8.8, 0.5, hangarDark);
    world.addBox(-353.5, -461, -310.5, -433, 0, 12.2, 'building');
    box(root, -273, 0.14, -448, 41, 7, 24, mat(0x686f73, 0.78, 0.18));
    world.addBox(-293.5, -460, -252.5, -436, 0, 7.2, 'building');

    var towerMat = mat(0x69727a, 0.68, 0.3);
    var glass = new THREE.MeshStandardMaterial({ color: 0x253b4d, roughness: 0.12, metalness: 0.62 });
    var tower = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.2, 17, 10), towerMat);
    tower.position.set(-235, 8.6, -451); tower.castShadow = true; root.add(tower);
    var cab = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 4.4, 3.3, 8), glass);
    cab.position.set(-235, 18.1, -451); cab.castShadow = true; root.add(cab);
    world.addBox(-238.2, -454.2, -231.8, -447.8, 0, 19.6, 'building');

    // Passenger terminal: concourse glazing, roof plant and three gate
    // canopies face the apron. It is a full collision volume so the airport
    // has a convincing service side even when approached on foot.
    var terminalMat = mat(0x56616b, 0.66, 0.30);
    var terminalGlass = new THREE.MeshStandardMaterial({
      color: 0x7b9aa8, roughness: 0.12, metalness: 0.62,
      transparent: true, opacity: 0.78
    });
    box(root, -78, 0.15, -447, 98, 10.5, 25, terminalMat);
    world.addBox(-127, -459.5, -29, -434.5, 0, 10.7, 'building');
    box(root, -78, 7.6, -459.8, 93, 1.1, 1.2, terminalGlass, false);
    for (var gate = -1; gate <= 1; gate++) {
      var gx = -78 + gate * 29;
      box(root, gx, 2.2, -462.1, 18, 1.3, 5.2, terminalGlass, false);
      box(root, gx, 3.5, -464.0, 13, 0.18, 1.0, terminalGlass, false);
      groundMark(root, gx, -469.0, 10, 0.36, yellow, 0.17);
    }
    // Roof HVAC units and a baggage/service dock.
    for (var hv = -112; hv <= -44; hv += 17) box(root, hv, 10.7, -447, 7, 1.2, 4.0, hangarDark, false);
    box(root, -78, 0.16, -431.2, 78, 2.2, 6.0, hangarDark, false);
    for (var bay = -104; bay <= -52; bay += 13) {
      box(root, bay, 0.18, -428.0, 8, 1.6, 0.22, terminalGlass, false);
      groundMark(root, bay, -423.8, 8, 0.28, white, 0.17);
    }

    // Landside parking and a service road. The marked bays are deliberately
    // small details, but together they give the terminal an actual arrival
    // sequence from the city road to the apron.
    slab(root, world, -22, -469, 150, -421, 0.11, asphalt, 'asphalt');
    groundMark(root, 64, -466.2, 168, 0.45, yellow, 0.15);
    for (var parkX = 0; parkX < 8; parkX++) {
      var px = -8 + parkX * 19;
      groundMark(root, px, -447, 0.24, 33, white, 0.15);
      groundMark(root, px, -426, 0.24, 8, white, 0.15);
    }
    slab(root, world, -165, -418, 328, -407, 0.10, concrete, 'concrete');
    for (var curb = -145; curb <= 300; curb += 18) groundMark(root, curb, -412.5, 11, 0.24, yellow, 0.14);

    // General aviation maintenance row with open-looking hangar doors,
    // baggage carts, a tug and a rescue/fire station.
    for (var hang = 0; hang < 3; hang++) {
      var hx = -170 + hang * 52;
      box(root, hx, 0.15, -447, 43, 8.4, 24, hangarMat);
      world.addBox(hx - 21.5, -459, hx + 21.5, -435, 0, 8.6, 'building');
      box(root, hx, 0.9, -459.2, 31, 6.7, 0.28, hangarDark, false);
      for (var doorPanel = -2; doorPanel <= 2; doorPanel++) box(root, hx + doorPanel * 5.8, 1.0, -459.45, 0.12, 6.3, 0.12, terminalGlass, false);
    }
    box(root, -205, 0.16, -420, 26, 6.5, 19, mat(0xb34d3f, 0.72, 0.18));
    world.addBox(-218, -429.5, -192, -410.5, 0, 6.7, 'building');
    addSign(root, -205, 0.22, -410.2, 0, 16, 'ARFF 01', 'AIRPORT RESCUE / FIRE', '#e45b4f');
    box(root, -150, 0.16, -421.4, 10, 1.2, 5, mat(0xd7d2c4, 0.82), false);
    for (var cart = 0; cart < 4; cart++) box(root, -142 + cart * 6.4, 0.19, -421.4, 4.8, 0.7, 2.2, mat(0xc3a35a, 0.72), false);

    // Fuel farm and maintenance yard, kept outside the active runway but
    // connected to the taxiway by the marked service apron.
    var fuelMat = mat(0xc2c7c9, 0.36, 0.78);
    slab(root, world, 174, -476, 302, -430, 0.12, concrete, 'concrete');
    box(root, 188, 0.14, -449, 38, 7.2, 25, mat(0x6a747b, 0.7, 0.25));
    world.addBox(169, -461.5, 207, -436.5, 0, 7.4, 'building');
    addSign(root, 188, 0.2, -435.0, 0, 15, 'SB AIR CARGO', 'FREIGHT / MAINTENANCE', '#72b7ff');
    for (var tank = 0; tank < 3; tank++) {
      cylinder(root, 245 + tank * 15, 0.2, -452, 5.2, 7.4, fuelMat, 16);
      cylinder(root, 245 + tank * 15, 7.62, -452, 0.8, 0.18, mat(0xe6bd38, 0.55, 0.55), 10, false);
      beam(root, 245 + tank * 15, 7.75, -452, 245 + tank * 15, 9.2, -452, 0.08, airportTrim);
    }
    box(root, 248, 0.16, -435, 14, 2.6, 8, mat(0x39434b, 0.72, 0.35));
    for (var pump = 0; pump < 3; pump++) {
      box(root, 263 + pump * 10, 0.18, -471, 6, 1.8, 3.5, mat(0x3e5966, 0.55, 0.3), false);
      beam(root, 263 + pump * 10, 1.95, -469.2, 263 + pump * 10, 3.2, -469.2, 0.05, airportTrim);
    }

    // Windsock, perimeter fence and a service gate establish the edge of the
    // field while leaving both runway approaches open for landings.
    var fencePost = mat(0x4a5156, 0.65, 0.5);
    var fenceWire = mat(0x69747a, 0.58, 0.72);
    fenceLine(root, -385, -414, 315, -414, 0.12, 14, fencePost, fenceWire);
    fenceLine(root, -390, -414, -390, -480, 0.12, 12, fencePost, fenceWire);
    fenceLine(root, 315, -414, 315, -480, 0.12, 12, fencePost, fenceWire);
    cylinder(root, 322, 0.15, -468, 0.10, 8.5, fencePost, 7);
    beam(root, 322, 8.7, -468, 322, 8.7, -455, 0.045, fenceWire);
    var sock = new THREE.Mesh(new THREE.ConeGeometry(1.3, 6.0, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xe25f52, roughness: 0.78, side: THREE.DoubleSide }));
    sock.position.set(322, 8.0, -468); sock.rotation.z = Math.PI / 2; root.add(sock);

    addSign(root, -300, 0.2, -430, 0, 23,
      'SUNSET BAY AIRPORT', 'RUNWAY 09 / 27  -  GENERAL AVIATION', '#f2c14e');

    this.airport = {
      x: -300, z: -486,
      runway: { x0: -390, x1: 390, z: -535, width: 34 },
      planeSpawns: [
        { key: 'skyhawk', x: -315, z: -476, yaw: 0, color: 0xd3483f },
        { key: 'twinprop', x: -265, z: -498, yaw: 0, color: 0xf0eee7 },
        { key: 'seaplane', x: -70, z: -498, yaw: 0, color: 0xd9e0e2, stripe: 0x2d7d90 },
        { key: 'boeing747', x: -170, z: -535, yaw: 0, color: 0xe9edf2, stripe: 0x2f5f9d },
        { key: 'fighter', x: 115, z: -535, yaw: Math.PI, color: 0x566475, stripe: 0xc84b3e },
        { key: 'stealth', x: 200, z: -535, yaw: Math.PI, color: 0x252d37, stripe: 0x6c9ba7 }
      ]
    };
    this.addLandmark('airport', 'Sunset Bay Airport', -300, -486, 0x72b7ff, 'airport');
  };

  // ---------------------------------------------------------------- marina
  Transport.prototype.buildMarina = function () {
    var root = new THREE.Group();
    root.name = 'bayside-marina';
    this.root.add(root);
    var world = this.world;
    var wood = mat(0x8a7255, 0.94);
    var marinaConcrete = mat(0x777a78, 0.9);
    var trim = mat(0x4f5a60, 0.7, 0.38);
    var deckY = 1.15;

    // Main quay and seven finger piers. The clear water between fingers is
    // wide enough for the small craft and the yacht to turn out under their
    // own physics, while each berth remains reachable on foot.
    slab(root, world, -594, -300, -584, -48, deckY, wood, 'wood');
    var slips = [-276, -240, -204, -168, -132, -96, -60];
    for (var i = 0; i < slips.length; i++) {
      slab(root, world, -646, slips[i] - 3.4, -584, slips[i] + 3.4, deckY, wood, 'wood');
    }

    // A proper shore-side service yard gives the marina a landward backbone:
    // vehicle access, a dry-stack shed, chandlery, harbour office, and a boat
    // ramp all connect to the same walkable surface.
    var yard = mat(0x777d7c, 0.92, 0.08);
    var yardDark = mat(0x39464c, 0.78, 0.22);
    // The current city map has a much larger coastline than the original
    // transport pass. This enclosed basin keeps the marina at its authored
    // coordinates while giving the boats a real seabed, water volume, and
    // water surface instead of leaving them on city terrain.
    world.addWaterZone(-680, -330, -582, 86, -3.8, -1.4, 'marina-basin');
    world.addWaterZone(-520, 25, -466, 86, -3.0, -1.4, 'public-basin');
    var basinWater = new THREE.Mesh(
      new THREE.PlaneGeometry(98, 420, 14, 42),
      SB.finishMaterial({ color: 0x16435b, roughness: 0.16, metalness: 0.18,
        clearcoat: 0.72, clearcoatRoughness: 0.16, transparent: true, opacity: 0.92 }));
    basinWater.rotation.x = -Math.PI / 2;
    basinWater.position.set(-631, -1.4, -122);
    basinWater.receiveShadow = true;
    root.add(basinWater);
    var publicWater = basinWater.clone();
    publicWater.geometry = new THREE.PlaneGeometry(54, 62, 8, 10);
    publicWater.position.set(-493, -1.4, 55);
    root.add(publicWater);
    slab(root, world, -582, -312, -446, -110, 0.10, yard, 'concrete');
    groundMark(root, -514, -308, 126, 0.34, 0xf0d36d, 0.14);
    for (var yardStripe = -566; yardStripe <= -460; yardStripe += 18) {
      groundMark(root, yardStripe, -292, 0.22, 28, 0xd9ded8, 0.14);
    }
    box(root, -529, 0.10, -292, 55, 6.2, 23, yardDark);
    world.addBox(-556.5, -303.5, -501.5, -280.5, 0, 6.4, 'building');
    box(root, -529, 3.5, -304.8, 48, 2.5, 0.20, new THREE.MeshStandardMaterial({ color: 0x82a4ae, roughness: 0.15, metalness: 0.55, transparent: true, opacity: 0.78 }), false);
    addSign(root, -529, 0.18, -280.0, 0, 20, 'BAYSIDE WORKS', 'CHANDLERY / SERVICE / DRY STACK', '#53c6c8');
    // Dry-stack racks and wrapped boats behind the service shed.
    var rack = mat(0x8d979b, 0.62, 0.6);
    for (var shelf = 0; shelf < 3; shelf++) {
      var sy = 0.22 + shelf * 2.25;
      beam(root, -560, sy, -266, -498, sy, -266, 0.06, rack);
      for (var rackPost = -558; rackPost <= -500; rackPost += 14) cylinder(root, rackPost, 0.14, -266, 0.05, sy + 0.22, rack, 6);
    }
    var tarp = mat(0x667e88, 0.92, 0.02);
    for (var stored = 0; stored < 3; stored++) box(root, -550 + stored * 17, 0.28, -265.8, 12, 1.4, 4.2, tarp, false);

    // Harbour master / fuel dock with canopy, pumps, hose reels and a radio
    // mast. The service apron is also a safe pedestrian arrival point.
    box(root, -477, 0.10, -272, 28, 4.8, 17, mat(0x465c66, 0.70, 0.18));
    world.addBox(-491, -280.5, -463, -263.5, 0, 5, 'building');
    box(root, -477, 4.9, -272, 31, 0.24, 19, trim, false);
    var fuel = mat(0xc2b467, 0.48, 0.3);
    for (var fp = 0; fp < 2; fp++) {
      box(root, -489 + fp * 9, 0.16, -258.5, 5.5, 1.8, 3.2, fuel, false);
      beam(root, -489 + fp * 9, 2.0, -257.0, -489 + fp * 9, 3.7, -257.0, 0.05, trim);
    }
    addSign(root, -477, 0.18, -262.8, 0, 14, 'HARBOUR 01', 'FUEL / RADIO / HARBOR MASTER', '#f2c14e');
    cylinder(root, -456, 0.14, -262, 0.08, 10, trim, 7);
    beam(root, -456, 9.8, -262, -451, 9.8, -262, 0.04, trim);
    beam(root, -456, 8.9, -262, -452, 8.9, -262, 0.035, trim);

    // Travel lift and a concrete launch ramp make the waterfront functional
    // for maintenance, not just decorative berths.
    var liftMat = mat(0xd3a947, 0.58, 0.58);
    for (var liftX = -474; liftX <= -450; liftX += 22) {
      cylinder(root, liftX, 0.12, -192, 0.14, 8.0, liftMat, 8);
      box(root, liftX, 7.8, -192, 0.18, 0.18, 30, liftMat, false);
    }
    beam(root, -474, 6.8, -207, -450, 6.8, -207, 0.10, liftMat);
    beam(root, -474, 6.8, -177, -450, 6.8, -177, 0.10, liftMat);
    slab(root, world, -578, -118, -520, -92, 0.11, marinaConcrete, 'concrete');
    var rampMat = mat(0x6d7475, 0.88, 0.06);
    box(root, -549, 0.10, -101, 38, 0.16, 24, rampMat, false);
    for (var rampLine = -565; rampLine <= -533; rampLine += 8) groundMark(root, rampLine, -101, 0.30, 22, 0xd9ded8, 0.20);

    // Breakwater, shore bollards, safety ladders and utility clutter make the
    // water edge legible at low tide and at night.
    slab(root, world, -672, -320, -650, -100, 0.72, wood, 'wood');
    for (var bw = -308; bw <= -112; bw += 16) {
      bollard(root, -660, 0.72, bw, trim);
      box(root, -671.2, 0.74, bw, 0.20, 0.55, 3.2, mat(0x5b6670, 0.72, 0.34), false);
    }
    for (var lightZ = -296; lightZ <= -124; lightZ += 28) beacon(root, -589, deckY, lightZ, trim, 2.6);
    for (var cleatZ = -291; cleatZ <= -129; cleatZ += 18) bollard(root, -590, deckY, cleatZ, trim);
    for (var ladderZ = -286; ladderZ <= -134; ladderZ += 38) {
      beam(root, -645, -2.0, ladderZ, -645, 0.68, ladderZ, 0.06, trim);
      beam(root, -645, -2.0, ladderZ, -645, -2.0, ladderZ + 2.0, 0.05, trim);
    }

    // Continuous walkable access from the beach road down to the floating
    // quay. It has a level street landing, a shallow shore approach, and a
    // wide gangway; all three sections are registered as walkable surfaces,
    // so the player does not have to jump or be teleported onto the dock.
    var ramp = new QB();
    var landX = -492, quayX = -584, streetX = -450;
    // Lift the shore landing above the perturbed sand mesh. A linear ramp
    // from the beach depression to the street otherwise cuts through the
    // beach halfway along its run and visually disappears.
    var landY = world.baseHeight(landX, -224) + 0.42;
    ramp.quad(quayX, deckY, -229, quayX, deckY, -219,
      landX, landY, -219, landX, landY, -229, 0, 0, 8, 2);
    // Keep the visible face pointing up. The previous winding put this
    // shore-side section back-face down, so the collision ramp existed but
    // the rendered ramp disappeared from the approach.
    ramp.quad(streetX, 0.12, -216, streetX, 0.12, -232,
      landX, landY, -232, landX, landY, -216, 0, 0, 8, 2);
    root.add(ramp.mesh(wood, false, true));
    world.addRamp(quayX, -229, landX, -219, deckY, landY, 'x', 'wood');
    world.addRamp(landX, -232, streetX, -216, landY, 0.12, 'x', 'concrete');
    slab(root, world, streetX - 4, -233, streetX, -215, 0.12, wood, 'concrete');

    // Low handrails make the route read as a real marina gangway. They are
    // visual safety rails only; the open width below remains collision-free.
    var railXs = [-576, -552, -528, -504, -480, -462];
    for (i = 0; i < railXs.length; i++) {
      var rt = (railXs[i] - quayX) / (streetX - quayX);
      var ry = M.lerp(deckY, 0.12, rt);
      for (var rside = -1; rside <= 1; rside += 2) {
        box(root, railXs[i], ry, -224 + rside * 7.0, 0.16, 1.05, 0.16, trim);
      }
    }

    // Pilings, cleats, lamp posts, and a small harbour office.
    var pileGeo = new THREE.CylinderGeometry(0.26, 0.33, 8.5, 7);
    var pileMat = mat(0x594a38, 1);
    for (i = 0; i < slips.length; i++) {
      for (var px = -642; px <= -590; px += 13) {
        var pile = new THREE.Mesh(pileGeo, pileMat);
        pile.position.set(px, deckY - 4.1, slips[i]);
        pile.castShadow = true; root.add(pile);
        world.addBox(px - 0.28, slips[i] - 0.28, px + 0.28, slips[i] + 0.28,
          world.waterY - 5, deckY + 0.5, 'prop');
      }
    }
    for (i = -288; i <= -60; i += 22) {
      box(root, -589, deckY, i, 0.16, 3.6, 0.16, trim);
      box(root, -589, deckY + 3.42, i, 0.9, 0.16, 0.38, trim);
    }

    box(root, -485, world.baseHeight(-485, -244), -244, 20, 6.2, 15, mat(0x455866, 0.78, 0.12));
    world.addBox(-495, -251.5, -475, -236.5, world.baseHeight(-485, -244), 6, 'building');
    addSign(root, -492, world.baseHeight(-492, -224), -214, -Math.PI / 2, 18,
      'BAYSIDE MARINA', 'FUEL  -  BERTHS  -  WATER TAXI', '#53c6c8');

    this.marina = {
      x: -589, z: -224,
      boatSpawns: [
        // Boats sit in the water alongside the finger piers, not on their
        // centre lines. The near side remains within the player's 3.6 m
        // entry radius from the pier edge.
        { key: 'jetski', x: -620, z: -280.7, yaw: Math.PI, color: 0xe24a3b },
        { key: 'speedboat', x: -620, z: -245.3, yaw: Math.PI, color: 0x2c73b5 },
        { key: 'yacht', x: -620, z: -210.5, yaw: Math.PI, color: 0xf1eee4 },
        { key: 'fishingboat', x: -620, z: -173.7, yaw: Math.PI, color: 0xd29b43 },
        { key: 'sailboat', x: -620, z: -137.5, yaw: Math.PI, color: 0x5e8eaa },
        { key: 'catamaran', x: -622, z: -101.4, yaw: Math.PI, color: 0xe2e5dc },
        { key: 'patrol', x: -625, z: -66.5, yaw: Math.PI, color: 0x2b4d68 }
      ]
    };
    this.addLandmark('marina', 'Bayside Marina', -589, -224, 0x53d6d3, 'marina');

    // The existing public pier is the city's second marina berth.  A short
    // boarding float sits beside the unrailed shore end, so entering and
    // exiting the skiff always puts the player back onto a walkable surface.
    slab(root, world, -489, 48, -471, 51.2, 3.2, wood, 'wood');
    this.publicPier = { x: -480, z: 40, boat: { key: 'dinghy', x: -493, z: 52.4, yaw: 0, color: 0x3f79a7 } };
    this.addLandmark('pier-marina', 'Sunset Pier Marina', -480, 40, 0x53d6d3, 'marina');
  };

  // -------------------------------------------------------------- helipads
  Transport.prototype.addHelipad = function (x, z, y, r, name, surface) {
    var root = this.root;
    // Every pad is a registered deck, including the airport pad that sits
    // flush with its apron. That makes the visual H, collision surface, and
    // landing solver agree on the same physical target.
    slab(root, this.world, x - r, z - r, x + r, z + r, y,
      mat(0x62686a, 0.9), 'concrete');
    this.world.addLandingZone(x - r * 0.78, z - r * 0.78, x + r * 0.78, z + r * 0.78,
      y, 'helipad', { plane: false, heli: true });
    groundMark(root, x, z, r * 1.78, r * 1.78, 0x30373b, y + 0.025);

    var ring = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.61, r * 0.72, 40),
      new THREE.MeshBasicMaterial({ color: 0xf1eee4, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y + 0.04, z); ring.renderOrder = 3;
    root.add(ring);
    groundMark(root, x - r * 0.18, z, r * 0.13, r * 0.92, 0xf1eee4, y + 0.05);
    groundMark(root, x + r * 0.18, z, r * 0.13, r * 0.92, 0xf1eee4, y + 0.05);
    groundMark(root, x, z, r * 0.46, r * 0.13, 0xf1eee4, y + 0.055);

    var lampMat = new THREE.MeshStandardMaterial({
      color: 0x244d36, emissive: 0x43ff8d, emissiveIntensity: 0.2, roughness: 0.3
    });
    this.beaconMats.push(lampMat);
    for (var i = 0; i < 12; i++) {
      var a = i / 12 * Math.PI * 2;
      var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 4), lampMat);
      lamp.position.set(x + Math.cos(a) * r * 0.82, y + 0.18, z + Math.sin(a) * r * 0.82);
      root.add(lamp);
    }
    var pad = { name: name, x: x, z: z, y: y, r: r };
    this.helipads.push(pad);
    this.addLandmark('helipad-' + this.helipads.length, name, x, z, 0xff6f73, 'helipad');
    return pad;
  };

  Transport.prototype.buildHelipads = function () {
    // Airport apron pad.
    this.addHelipad(270, -497, 0.18, 11, 'Airport Helipad', false);

    // Coastguard pad: raised above the beach with a walkable access ramp.
    var x = -520, z = 286, y = 3.8, r = 11;
    this.addHelipad(x, z, y, r, 'Coastguard Helipad', true);
    var landX = -488, landY = this.world.baseHeight(-488, z) + 0.1;
    var ramp = new QB();
    ramp.quad(x + r, y, z - 4.4, landX, landY, z - 4.4,
      landX, landY, z + 4.4, x + r, y, z + 4.4, 0, 0, 4, 2);
    this.root.add(ramp.mesh(mat(0x6e7475, 0.92), false, true));
    this.world.addRamp(x + r, z - 4.4, landX, z + 4.4, y, landY, 'x', 'concrete');

    // Garage roof pad: reachable by the structure's existing drivable ramps.
    var garage = this.game.props && this.game.props.garage;
    if (garage) {
      var gx = garage.x0 + 13;
      var gz = (garage.z0 + garage.z1) * 0.5;
      var gy = garage.decks[garage.decks.length - 1] + 0.03;
      this.addHelipad(gx, gz, gy, 8.5, 'Downtown Rooftop Helipad', true);
    }
  };

  // --------------------------------------------------------------- spawns
  Transport.prototype.spawnCraft = function () {
    var i, s;
    if (this.game.boats) {
      for (i = 0; i < this.marina.boatSpawns.length; i++) {
        s = this.marina.boatSpawns[i];
        this.spawned.boats.push(this.game.boats.spawn(s.key, s.x, s.z, s.yaw, s.color));
      }
      s = this.publicPier.boat;
      this.spawned.boats.push(this.game.boats.spawn(s.key, s.x, s.z, s.yaw, s.color));
    }
    if (this.game.aircraft) {
      for (i = 0; i < this.airport.planeSpawns.length; i++) {
        s = this.airport.planeSpawns[i];
        this.spawned.planes.push(this.game.aircraft.spawnPlane(s.key, s.x, s.z, s.yaw, s.color, s.stripe));
      }
      for (i = 0; i < this.helipads.length; i++) {
        s = this.helipads[i];
        this.spawned.helis.push(this.game.aircraft.spawnHeli('chopper', s.x, s.z, 0,
          i === 0 ? 0xd7dce2 : (i === 1 ? 0xe3b43f : 0x3d698b)));
      }
      this.game.aircraft.spawnAmbientPlane(880, 145, 28, 0.7);
      this.game.aircraft.spawnAmbientPlane(1080, 190, 34, 3.8);
    }
  };

  Transport.prototype.render = function (dt, lamps) {
    for (var i = 0; i < this.beaconMats.length; i++) {
      this.beaconMats[i].emissiveIntensity = 0.18 + lamps * 2.6;
    }
  };

  SB.Transport = Transport;

})(window.SB = window.SB || {});
