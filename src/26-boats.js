// 26-boats.js - boats: hull geometry, buoyancy and planing physics, wake.
//
// There are no wheels here, so the model is simpler than the car: thrust
// along the heading, quadratic drag calibrated to the spec's top speed, a
// rudder whose authority scales with forward speed (a stationary boat barely
// turns, which is what makes low-speed manoeuvring feel like a boat and not
// a car), and a vertical position that chases the animated water surface
// rather than being simulated as a rigid body. Reuses SB.Hull for the hull
// shell and Vehicle's shared glass/trim materials so the visual language
// matches the cars.
(function (SB) {
  'use strict';

  var M = SB.M, Hull = SB.Hull, QB = SB.QB;
  var G = 9.81;

  var BOAT_SPECS = SB.BoatSpecs = {
    jetski: {
      name: 'Riptide Jet Ski', typeLabel: 'JET SKI', style: 'jetski',
      mass: 270, len: 3.35, wid: 1.08, draft: 0.18,
      power: 15000, topSpeed: 25, turnRate: 2.75, bodyH: 0.72, deckY: 0.42,
      cabin: false, seats: 1
    },
    speedboat: {
      name: 'Viper 28 Speedboat', typeLabel: 'SPEEDBOAT', style: 'speedboat',
      mass: 980, len: 7.2, wid: 2.48, draft: 0.42,
      power: 38000, topSpeed: 23, turnRate: 1.95, bodyH: 1.12, deckY: 0.72,
      cabin: false, seats: 5
    },
    yacht: {
      name: 'Azure 52 Yacht', typeLabel: 'YACHT', style: 'yacht',
      mass: 5200, len: 15.5, wid: 4.5, draft: 1.05,
      power: 92000, topSpeed: 14.5, turnRate: 0.66, bodyH: 2.15, deckY: 1.22,
      cabin: true, seats: 8, interior: true
    },
    fishingboat: {
      name: 'Northstar Fishing Boat', typeLabel: 'FISHING BOAT', style: 'fishing',
      mass: 1450, len: 8.8, wid: 2.9, draft: 0.52,
      power: 30000, topSpeed: 16.5, turnRate: 1.25, bodyH: 1.28, deckY: 0.82,
      cabin: false, seats: 4
    },
    sailboat: {
      name: 'Windward Sailboat', typeLabel: 'SAILBOAT', style: 'sailboat',
      mass: 1250, len: 8.4, wid: 2.65, draft: 0.70,
      power: 14500, topSpeed: 10.5, turnRate: 1.05, bodyH: 1.3, deckY: 0.86,
      cabin: false, seats: 4
    },
    dinghy: {
      name: 'Harbor Dinghy', typeLabel: 'DINGHY', style: 'dinghy',
      mass: 430, len: 4.7, wid: 1.75, draft: 0.25,
      power: 10500, topSpeed: 13, turnRate: 2.1, bodyH: 0.72, deckY: 0.48,
      cabin: false, seats: 3
    },
    catamaran: {
      name: 'Twinwake Catamaran', typeLabel: 'CATAMARAN', style: 'catamaran',
      mass: 1750, len: 10.6, wid: 3.55, draft: 0.56,
      power: 38000, topSpeed: 18.5, turnRate: 1.05, bodyH: 1.38, deckY: 0.92,
      cabin: false, seats: 8
    },
    patrol: {
      name: 'Harbor Sentinel', typeLabel: 'PATROL BOAT', style: 'patrol',
      mass: 2100, len: 9.4, wid: 2.85, draft: 0.48,
      power: 52000, topSpeed: 24, turnRate: 1.65, bodyH: 1.42, deckY: 0.90,
      cabin: false, seats: 6
    }
  };
  // Keep the old constructor names valid for saved/debug URLs from the first
  // marina pass. They intentionally point at the new authored boats.
  BOAT_SPECS.skiff = BOAT_SPECS.speedboat;
  BOAT_SPECS.cruiser = BOAT_SPECS.yacht;
  for (var _k in BOAT_SPECS) {
    var _s = BOAT_SPECS[_k];
    _s.dragCoef = _s.power / (_s.topSpeed * _s.topSpeed);
    _s.redline = 5200;                 // for the shared engine-audio sim only
  }

  // -------------------------------------------------------------- meshes ---
  var geoCache = Object.create(null);

  function hullGeometry(key) {
    if (geoCache[key]) return geoCache[key];
    var s = BOAT_SPECS[key];
    var L = s.len, HW = s.wid / 2;
    var hull = new QB(), deck = new QB(), glass = new QB(), trim = new QB(), extra = new QB();

    var keel = -s.draft, deckY = s.deckY;
    var f = L / 2, r = -L / 2;

    // Bow to stern: a sharp entry that fills out to a flat, near-vertical
    // transom, which is what makes a planing hull read correctly at speed.
    var st = [
      Hull.station(f, 0.05, -0.02, 0.06, 0.02),
      Hull.station(f - L * 0.10, HW * 0.30, keel * 0.35, deckY * 0.55, 0.05),
      Hull.station(f - L * 0.28, HW * 0.74, keel * 0.75, deckY * 0.85, 0.10),
      Hull.station(f - L * 0.50, HW * 0.99, keel, deckY, 0.12),
      Hull.station(r + L * 0.10, HW, keel, deckY, 0.10),
      Hull.station(r, HW * 0.97, keel * 0.94, deckY * 0.99, 0.08)
    ];
    Hull.loft(hull, st);

    // deck cap, flush with the top of the hull tube
    deck.plane(r + L * 0.06, -HW * 0.92, f - L * 0.08, HW * 0.92, deckY - 0.02, 3);

    // console + windshield. The jet ski uses a standing console and bars;
    // every other open boat gets a helm that is readable from the dock.
    var consoleX = s.cabin ? f - L * 0.18 : f - L * 0.36;
    if (s.style === 'jetski') {
      trim.box(consoleX - 0.24, deckY, -0.27, consoleX + 0.30, deckY + 0.78, 0.27, 1, 1, 1, {});
      trim.box(consoleX - 0.48, deckY + 0.74, -0.06, consoleX + 0.48, deckY + 0.84, 0.06, 1, 1, 1, {});
      trim.box(consoleX - 0.30, deckY + 0.28, -0.04, consoleX - 0.22, deckY + 0.79, 0.04, 1, 1, 1, {});
    } else {
      trim.box(consoleX - 0.5, deckY, -HW * 0.55, consoleX + 0.5, deckY + 0.95, HW * 0.55, 2, 2, 2, {});
      glass.box(consoleX + 0.5, deckY + 0.55, -HW * 0.5, consoleX + 0.58, deckY + 1.05, HW * 0.5, 2, 2, 2, { skipTop: true, bottom: false });
      // wheel
      trim.box(consoleX - 0.1, deckY + 0.55, -0.06, consoleX + 0.02, deckY + 0.85, 0.06, 1, 1, 1, {});
    }

    if (s.cabin) {
      // low cabin amidships with a wraparound windscreen
      var cabX0 = r + L * 0.12, cabX1 = consoleX - 0.6;
      hull.box(cabX0, deckY, -HW * 0.86, cabX1, deckY + 1.35, HW * 0.86, 3, 2, 3, { skipTop: false });
      glass.box(cabX1 - 0.06, deckY + 0.35, -HW * 0.80, cabX1 + 0.02, deckY + 1.30, HW * 0.80, 2, 2, 2, {});
      // flybridge rail on the cabin roof
      trim.box(cabX0 + 0.3, deckY + 1.35, -HW * 0.7, cabX1 - 0.3, deckY + 1.42, HW * 0.7, 3, 3, 3, {});
      // radar arch
      extra.box(cabX0 + 0.15, deckY + 1.42, -0.08, cabX0 + 0.30, deckY + 2.3, 0.08, 1, 1, 1, {});
      extra.box(cabX0 + 0.15, deckY + 2.2, -0.55, cabX0 + 0.30, deckY + 2.3, 0.55, 1, 1, 1, {});
    } else if (s.style === 'jetski') {
      // The long saddle makes the silhouette read as a personal watercraft,
      // while the open nose leaves room for a second visual trim line.
      hull.box(r + L * 0.14, deckY, -HW * 0.58, consoleX - 0.28, deckY + 0.26, HW * 0.58, 2, 2, 2, {});
      trim.box(f - L * 0.38, deckY + 0.02, -HW * 0.72, f - L * 0.16, deckY + 0.10, HW * 0.72, 2, 2, 2, {});
    } else {
      // bow rail and a single bench seat aft
      trim.box(f - L * 0.62, deckY + 0.65, -HW * 0.42, f - L * 0.20, deckY + 0.72, HW * 0.42, 2, 2, 2, {});
      hull.box(r + L * 0.18, deckY, -HW * 0.6, r + L * 0.32, deckY + 0.5, HW * 0.6, 2, 2, 2, {});
      if (s.style === 'fishing') {
        // Cabinless wheelhouse, aft storage bins, and a raised rod rack.
        glass.box(consoleX - 0.55, deckY + 0.42, -HW * 0.58, consoleX + 0.46, deckY + 1.28, HW * 0.58, 2, 2, 2, {});
        hull.box(r + L * 0.12, deckY, -HW * 0.72, r + L * 0.42, deckY + 0.34, HW * 0.72, 2, 2, 2, {});
        extra.box(r + L * 0.20, deckY + 0.34, -HW * 0.72, r + L * 0.24, deckY + 1.55, HW * 0.72, 1, 1, 1, {});
      } else if (s.style === 'sailboat') {
        // Mast and boom are deliberately chunky enough to read at map scale.
        extra.box(f - L * 0.38, deckY, -0.08, f - L * 0.30, deckY + 4.8, 0.08, 1, 1, 1, {});
        extra.box(f - L * 0.38, deckY + 3.15, -0.08, f + L * 0.16, deckY + 3.25, 0.08, 1, 1, 1, {});
      } else if (s.style === 'catamaran') {
        // Twin slender demi-hulls with a raised bridge deck make the
        // catamaran silhouette unmistakable from the marina walkways.
        hull.box(r + 0.35, deckY - 0.14, -HW * 0.72, f - 0.25, deckY + 0.10, -HW * 0.38, 2, 2, 2, {});
        hull.box(r + 0.35, deckY - 0.14, HW * 0.38, f - 0.25, deckY + 0.10, HW * 0.72, 2, 2, 2, {});
        trim.box(r + L * 0.16, deckY + 0.05, -HW * 0.38, f - L * 0.10, deckY + 0.18, HW * 0.38, 2, 2, 2, {});
        extra.box(f - L * 0.26, deckY + 0.18, -0.06, f - L * 0.20, deckY + 1.65, 0.06, 1, 1, 1, {});
      } else if (s.style === 'patrol') {
        // Patrol craft get a swept cabin, grab rails and a visible radar mast.
        glass.box(consoleX - 0.64, deckY + 0.28, -HW * 0.66, consoleX + 0.48, deckY + 1.36, HW * 0.66, 2, 2, 2, {});
        trim.box(consoleX - 0.76, deckY + 1.32, -HW * 0.73, consoleX + 0.55, deckY + 1.42, HW * 0.73, 2, 2, 2, {});
        extra.box(consoleX - 0.25, deckY + 1.38, -0.05, consoleX - 0.18, deckY + 2.24, 0.05, 1, 1, 1, {});
        extra.box(consoleX - 0.52, deckY + 2.12, -0.05, consoleX + 0.10, deckY + 2.19, 0.05, 1, 1, 1, {});
      }
    }

    // outboard / sterndrive at the transom
    trim.box(r - 0.32, keel * 0.4, -0.30, r + 0.05, deckY * 0.55, 0.30, 1, 1, 1, {});
    extra.box(r - 0.30, deckY * 0.55, -0.34, r + 0.10, deckY * 0.55 + 0.32, 0.34, 1, 1, 1, {});

    // small windscreen rake line + cleats omitted for budget; a bow flag pole
    extra.box(f - 0.05, deckY, -0.03, f - 0.02, deckY + 0.9, 0.03, 1, 1, 1, {});

    var merged = Hull.mergeGroups([
      { qb: hull, name: 'paint' },
      { qb: deck, name: 'deck' },
      { qb: glass, name: 'glass' },
      { qb: trim, name: 'trim' },
      { qb: extra, name: 'extra' }
    ]);
    merged.deckY = deckY;
    merged.interior = s.interior ? {
      // Local coordinates. This is the compact lower salon/helm cabin under
      // the yacht's flybridge, not a teleport to a separate hidden building.
      x0: -L * 0.34, x1: L * 0.25, z0: -HW * 0.82, z1: HW * 0.82,
      floorY: deckY + 0.04, height: 2.25,
      spawnX: L * 0.12, spawnZ: 0, exitX: L * 0.25 - 0.65, exitZ: HW * 0.76
    } : null;
    return (geoCache[key] = merged);
  }

  var sharedMats = null;
  function materials() {
    if (sharedMats) return sharedMats;
    var vm = SB.vehicleMaterials ? SB.vehicleMaterials() : null;
    sharedMats = {
      glass: (vm && vm.glass) || new THREE.MeshStandardMaterial({ color: 0x1c2530, roughness: 0.06, metalness: 0.9 }),
      trim: (vm && vm.trim) || new THREE.MeshStandardMaterial({ color: 0x1e2126, roughness: 0.55, metalness: 0.4 }),
      deck: new THREE.MeshStandardMaterial({ color: 0xcdbf9c, roughness: 0.75 }),
      extra: new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.5, metalness: 0.4 })
    };
    return sharedMats;
  }

  // -------------------------------------------------------------- class ----
  function Boat(key, world, opts) {
    opts = opts || {};
    var s = BOAT_SPECS[key];
    this.key = key;
    this.spec = s;
    this.world = world;
    this.name = s.name;
    this.craftType = 'boat';

    this.pos = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.u = 0; this.v = 0; this.yawRate = 0;
    this.pitch = 0; this.roll = 0;
    this.throttle = 0; this.brake = 0; this.steer = 0; this.reverse = false;
    this.rpm = 800;                     // fed to the shared engine-audio sim
    this.skid = 0;                      // read by the audio sim; boats never skid
    this.wake = 0;

    this.health = 500; this.maxHealth = 500;
    this.destroyed = false; this.burning = 0; this.smoking = false; this.exploded = false;
    this.aground = false;
    this.locked = false;
    this.lastImpact = 0;
    this.driver = null; this.isPlayer = false;

    // A boat's length is along its heading, so using the full hull length as
    // a circular collision radius made side-by-side berthing impossible. A
    // width-based footprint keeps piers clear while the hull still resolves
    // against them and other craft.
    this.collisionRadius = Math.max(1.1, s.wid * 0.56);

    this.color = opts.color !== undefined ? opts.color : SB.PAINTS[Math.floor(Math.random() * SB.PAINTS.length)];
    this.buildMesh();
  }

  Boat.prototype.buildMesh = function () {
    var mats = materials();
    var hg = hullGeometry(this.key);
    this.paintMat = SB.finishMaterial({
      color: this.color, roughness: 0.25, metalness: 0.30,
      clearcoat: 0.56, clearcoatRoughness: 0.18, reflectivity: 0.72
    });
    this.deckY = hg.deckY;

    var slotMats = [];
    for (var i = 0; i < hg.slots.length; i++) {
      var n = hg.slots[i];
      slotMats.push(n === 'paint' ? this.paintMat : n === 'deck' ? mats.deck :
        n === 'glass' ? mats.glass : n === 'trim' ? mats.trim : mats.extra);
    }
    this.group = new THREE.Group();
    this.body = new THREE.Mesh(hg.geometry, slotMats);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.group.add(this.body);

    // Fine trim pass: a waterline rub rail, deck accents, and physical rails
    // give every hull a believable scale at the dock and while underway.
    var detail = new THREE.Group();
    detail.name = 'boat-finish-details';
    var rubMat = new THREE.MeshStandardMaterial({ color: 0xd3d6d3, roughness: 0.28, metalness: 0.62 });
    var darkMat = new THREE.MeshStandardMaterial({ color: 0x171d21, roughness: 0.48, metalness: 0.66 });
    var rubGeo = new THREE.BoxGeometry(this.spec.len * 0.72, 0.055, 0.035);
    for (var rs = -1; rs <= 1; rs += 2) {
      var rub = new THREE.Mesh(rubGeo, rubMat);
      rub.position.set(-this.spec.len * 0.04, -this.spec.draft * 0.30, rs * this.spec.wid * 0.49);
      detail.add(rub);
    }
    var deckStripe = new THREE.Mesh(
      new THREE.BoxGeometry(this.spec.len * 0.34, 0.028, Math.max(0.07, this.spec.wid * 0.075)),
      new THREE.MeshStandardMaterial({ color: 0xf0c15b, roughness: 0.38, metalness: 0.28 }));
    deckStripe.position.set(this.spec.len * 0.12, this.deckY + 0.012, 0);
    detail.add(deckStripe);
    // Small stern hardware and a transom cap make the propulsion end read as
    // a real boat rather than a single extruded hull.
    var sternCap = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.26, this.spec.wid * 0.66), darkMat);
    sternCap.position.set(-this.spec.len * 0.51, this.deckY * 0.52, 0);
    detail.add(sternCap);
    if (this.spec.style === 'yacht') {
      var railMat = new THREE.MeshStandardMaterial({ color: 0xb8b6ac, roughness: 0.26, metalness: 0.8 });
      for (var rx = -this.spec.len * 0.28; rx <= this.spec.len * 0.36; rx += 1.55) {
        for (var rside = -1; rside <= 1; rside += 2) {
          var post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.48, 8), railMat);
          post.position.set(rx, this.deckY + 0.24, rside * this.spec.wid * 0.47);
          detail.add(post);
        }
      }
      for (var railSide = -1; railSide <= 1; railSide += 2) {
        var rail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, this.spec.len * 0.64, 8), railMat);
        rail.rotation.z = Math.PI / 2;
        rail.position.set(this.spec.len * 0.04, this.deckY + 0.48, railSide * this.spec.wid * 0.47);
        detail.add(rail);
      }
    } else if (this.spec.style === 'jetski') {
      var handle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.72, 8), darkMat);
      handle.rotation.x = Math.PI / 2;
      handle.position.set(this.spec.len * 0.10, this.deckY + 0.78, 0);
      detail.add(handle);
      var consoleGlow = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.04),
        new THREE.MeshStandardMaterial({ color: 0x123841, emissive: 0x2cd6dc, emissiveIntensity: 1.3 }));
      consoleGlow.position.set(this.spec.len * 0.10, this.deckY + 0.62, -0.23);
      detail.add(consoleGlow);
    } else if (this.spec.style === 'sailboat') {
      var sailShape = new THREE.Shape();
      sailShape.moveTo(0, 0.08);
      sailShape.lineTo(0, 3.15);
      sailShape.lineTo(-1.82, 0.22);
      sailShape.lineTo(0, 0.08);
      var sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape),
        new THREE.MeshStandardMaterial({ color: 0xf2ead7, roughness: 0.9, side: THREE.DoubleSide }));
      sail.position.set(this.spec.len * 0.02, this.deckY + 0.12, 0.02);
      sail.castShadow = true;
      detail.add(sail);
    } else if (this.spec.style === 'fishing') {
      var rodMat = new THREE.MeshStandardMaterial({ color: 0x243b43, roughness: 0.45, metalness: 0.38 });
      var rod = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 2.35, 7), rodMat);
      rod.position.set(-this.spec.len * 0.12, this.deckY + 1.48, this.spec.wid * 0.37);
      rod.rotation.z = -0.18;
      detail.add(rod);
    } else if (this.spec.style === 'catamaran') {
      var catRail = new THREE.MeshStandardMaterial({ color: 0xbfc4c3, roughness: 0.25, metalness: 0.82 });
      for (var catSide = -1; catSide <= 1; catSide += 2) {
        var catPost = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.60, 8), catRail);
        catPost.position.set(-this.spec.len * 0.18, this.deckY + 0.30, catSide * this.spec.wid * 0.43);
        detail.add(catPost);
        var catTop = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, this.spec.len * 0.50, 8), catRail);
        catTop.rotation.z = Math.PI / 2;
        catTop.position.set(-this.spec.len * 0.04, this.deckY + 0.60, catSide * this.spec.wid * 0.43);
        detail.add(catTop);
      }
    } else if (this.spec.style === 'patrol') {
      var beaconMat = new THREE.MeshStandardMaterial({ color: 0x15202a, emissive: 0x3d8fff, emissiveIntensity: 1.5, roughness: 0.30, metalness: 0.62 });
      var beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 12), beaconMat);
      beacon.position.set(this.spec.len * 0.04, this.deckY + 1.52, 0);
      detail.add(beacon);
      var guardMat = new THREE.MeshStandardMaterial({ color: 0xc3c6c1, roughness: 0.22, metalness: 0.88 });
      var guard = new THREE.Mesh(new THREE.TorusGeometry(this.spec.wid * 0.42, 0.035, 6, 18, Math.PI), guardMat);
      guard.rotation.x = Math.PI / 2;
      guard.position.set(this.spec.len * 0.27, this.deckY + 0.16, 0);
      detail.add(guard);
    }
    this.group.add(detail);

    this.hasInterior = !!hg.interior;
    this.interior = hg.interior;
    if (this.hasInterior) this.buildInterior();

    // running lights: red port, green starboard, white stern
    var lampGeo = new THREE.SphereGeometry(0.05, 6, 5);
    this.portLight = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({ color: 0x400008, emissive: 0xff2030, emissiveIntensity: 0 }));
    this.stbdLight = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({ color: 0x003008, emissive: 0x20ff60, emissiveIntensity: 0 }));
    this.portLight.position.set(this.spec.len * 0.30, this.deckY + 0.5, -this.spec.wid * 0.5);
    this.stbdLight.position.set(this.spec.len * 0.30, this.deckY + 0.5, this.spec.wid * 0.5);
    this.group.add(this.portLight, this.stbdLight);
  };

  Boat.prototype.addToScene = function (scene) {
    scene.add(this.group);
    if (this.interiorGroup) scene.add(this.interiorGroup);
    return this;
  };
  Boat.prototype.removeFromScene = function (scene) {
    scene.remove(this.group);
    if (this.interiorGroup) scene.remove(this.interiorGroup);
  };
  Boat.prototype.setColor = function (hex) { this.color = hex; this.paintMat.color.setHex(hex); };

  Boat.prototype.placeAt = function (x, z, yaw) {
    this.pos.set(x, 0, z);
    this.yaw = yaw || 0;
    this.u = this.v = this.yawRate = 0;
    this.pos.y = this.world.waterSurfaceHeight(x, z, 0) - this.spec.draft * 0.4;
    this.syncMesh();
    return this;
  };

  Boat.prototype.speed = function () { return Math.hypot(this.u, this.v); };
  Boat.prototype.speedKph = function () { return this.speed() * 3.6; };
  Boat.prototype.limitDynamics = function () {
    var maxSpeed = Math.max(4, this.spec.topSpeed * 1.08);
    if (!Number.isFinite(this.u)) this.u = 0;
    if (!Number.isFinite(this.v)) this.v = 0;
    if (!Number.isFinite(this.yawRate)) this.yawRate = 0;
    var mag = Math.hypot(this.u, this.v);
    if (mag > maxSpeed) { var k = maxSpeed / mag; this.u *= k; this.v *= k; }
    this.yawRate = M.clamp(this.yawRate, -2.4, 2.4);
  };
  Boat.prototype.forward = function (out) { out.x = Math.cos(this.yaw); out.z = Math.sin(this.yaw); out.y = 0; return out; };

  Boat.prototype.localToWorld = function (lx, lz, out) {
    var c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    out.x = this.pos.x + lx * c - lz * s;
    out.z = this.pos.z + lx * s + lz * c;
    return out;
  };

  Boat.prototype.worldToLocal = function (x, z, out) {
    var c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    var dx = x - this.pos.x, dz = z - this.pos.z;
    out.x = dx * c + dz * s;
    out.z = -dx * s + dz * c;
    return out;
  };

  Boat.prototype.resolveInteriorPlayer = function (x, z, radius, out) {
    if (!this.interior) { out.x = x; out.z = z; return out; }
    var local = out.local || (out.local = { x: 0, z: 0 });
    this.worldToLocal(x, z, local);
    local.x = M.clamp(local.x, this.interior.x0 + radius, this.interior.x1 - radius);
    local.z = M.clamp(local.z, this.interior.z0 + radius, this.interior.z1 - radius);
    this.localToWorld(local.x, local.z, out);
    return out;
  };

  Boat.prototype.buildInterior = function () {
    var i = this.interior, g = new THREE.Group();
    g.name = 'yacht-walkable-interior';
    var w = i.x1 - i.x0, d = i.z1 - i.z0;
    var floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d),
      new THREE.MeshStandardMaterial({ color: 0x76533b, roughness: 0.72, metalness: 0.08 }));
    floor.position.set((i.x0 + i.x1) * 0.5, i.floorY, (i.z0 + i.z1) * 0.5);
    floor.receiveShadow = true; g.add(floor);
    var wallMat = new THREE.MeshStandardMaterial({ color: 0xe9dfcf, roughness: 0.78, side: THREE.DoubleSide });
    var trimMat = new THREE.MeshStandardMaterial({ color: 0x25313a, roughness: 0.38, metalness: 0.55 });
    var brassMat = new THREE.MeshStandardMaterial({ color: 0xb98a4a, roughness: 0.26, metalness: 0.78 });
    var windowMat = new THREE.MeshStandardMaterial({ color: 0x153b50, roughness: 0.08, metalness: 0.65, transparent: true, opacity: 0.78 });
    var leatherMat = new THREE.MeshStandardMaterial({ color: 0x315a58, roughness: 0.88 });
    var creamMat = new THREE.MeshStandardMaterial({ color: 0xcbb38d, roughness: 0.86 });
    var darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x35251e, roughness: 0.56 });
    var glowMat = new THREE.MeshStandardMaterial({ color: 0x57411f, emissive: 0xffc66e, emissiveIntensity: 1.8, roughness: 0.35 });
    function wall(x, y, z, w0, h0, d0, material) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w0, h0, d0), material || wallMat);
      m.position.set(x, y + h0 * 0.5, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
    }
    function detail(x, y, z, w0, h0, d0, material) {
      return wall(x, y, z, w0, h0, d0, material);
    }
    function cylinder(x, y, z, radius, height, material, segments) {
      var m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments || 12), material);
      m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
    }
    wall(i.x0, i.floorY + 0.02, (i.z0 + i.z1) * 0.5, 0.12, i.height, d, wallMat);
    wall(i.x1, i.floorY + 0.02, i.z0, 0.12, i.height, d, wallMat);
    wall((i.x0 + i.x1) * 0.5, i.floorY + 0.02, i.z0, w, i.height, 0.12, wallMat);
    // A low aft bulkhead keeps the room legible while leaving the companionway
    // open. The dark cap and brass rail make the threshold readable.
    wall((i.x0 + i.x1) * 0.5, i.floorY + 0.02, i.z1, w, 0.92, 0.12, wallMat);
    wall((i.x0 + i.x1) * 0.5, i.floorY + 1.42, i.z1, w, 0.10, 0.12, trimMat);
    for (var side = -1; side <= 1; side += 2) {
      var zSide = side < 0 ? i.z0 + 0.08 : i.z1 - 0.08;
      var win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.34, 0.52, 0.04), windowMat);
      win.position.set((i.x0 + i.x1) * 0.5 - 0.12, i.floorY + 1.45, zSide);
      g.add(win);
      detail((i.x0 + i.x1) * 0.5 - 0.12, i.floorY + 1.18, zSide, w * 0.36, 0.035, 0.08, brassMat);
      detail((i.x0 + i.x1) * 0.5 - 0.12, i.floorY + 1.72, zSide, w * 0.36, 0.035, 0.08, brassMat);
    }

    // A rug anchors the salon, with a compact coffee table at its centre.
    detail(-0.72, i.floorY + 0.065, 0.02, 4.6, 0.018, 1.12, new THREE.MeshStandardMaterial({ color: 0x273f46, roughness: 0.96 }));
    detail(-0.48, i.floorY + 0.18, 0.02, 1.12, 0.23, 0.56, darkWoodMat);
    cylinder(-0.48, i.floorY + 0.07, 0.02, 0.28, 0.05, brassMat, 16);

    // Port-side sofa and starboard berth, both low enough to walk around.
    detail(-1.86, i.floorY + 0.18, i.z0 + 0.57, 2.85, 0.46, 0.92, leatherMat);
    detail(-1.86, i.floorY + 0.64, i.z0 + 0.20, 2.85, 0.68, 0.16, leatherMat);
    detail(-1.38, i.floorY + 0.15, i.z1 - 0.58, 2.55, 0.30, 0.88, creamMat);
    detail(-1.38, i.floorY + 0.48, i.z1 - 0.82, 2.55, 0.36, 0.12, darkWoodMat);
    detail(-2.28, i.floorY + 0.58, i.z1 - 0.58, 0.46, 0.12, 0.70, creamMat);

    // Galley cabinetry, sink, induction top and overhead lockers.
    detail(i.x0 + 1.08, i.floorY + 0.12, i.z1 - 0.34, 1.52, 0.74, 0.45, darkWoodMat);
    detail(i.x0 + 1.08, i.floorY + 0.86, i.z1 - 0.34, 1.52, 0.08, 0.45, brassMat);
    detail(i.x0 + 1.08, i.floorY + 1.22, i.z1 - 0.34, 1.52, 0.42, 0.30, trimMat);
    detail(i.x0 + 1.08, i.floorY + 1.43, i.z1 - 0.17, 1.16, 0.035, 0.03, glowMat);

    // Helm console with instrument stack, wheel, throttle and captain's seat.
    var helmX = i.x1 - 0.82;
    detail(helmX, i.floorY + 0.08, -0.36, 0.86, 0.88, 0.86, trimMat);
    detail(helmX - 0.03, i.floorY + 0.86, -0.36, 0.82, 0.07, 0.82, brassMat);
    detail(helmX + 0.01, i.floorY + 1.02, -0.36, 0.62, 0.34, 0.05, windowMat);
    detail(helmX - 0.04, i.floorY + 1.08, -0.36, 0.26, 0.045, 0.02, glowMat);
    var wheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.045, 8, 18), brassMat);
    wheel.position.set(helmX - 0.27, i.floorY + 0.72, -0.84);
    wheel.rotation.x = Math.PI / 2; g.add(wheel);
    detail(helmX + 0.22, i.floorY + 0.82, -0.82, 0.12, 0.22, 0.08, brassMat);
    detail(helmX - 0.16, i.floorY + 0.15, -0.84, 0.58, 0.38, 0.58, leatherMat);

    // Brass handrail and a lit overhead rhythm give the cabin a finished,
    // yacht-like scale without blocking the walkable centre aisle.
    detail(i.x1 - 0.78, i.floorY + 1.28, 0.62, 0.08, 0.08, 1.75, brassMat);
    for (var li = -1.6; li <= 1.5; li += 1.55) {
      var puck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.035, 12), glowMat);
      puck.position.set(li, i.floorY + 2.02, 0.02);
      g.add(puck);
    }
    var lamp = new THREE.PointLight(0xffd59a, 2.8, 11, 1.6);
    lamp.position.set(i.x0 + 2.55, i.floorY + 1.72, 0); g.add(lamp);
    var lamp2 = new THREE.PointLight(0x79c8d8, 0.8, 7, 2.0);
    lamp2.position.set(i.x1 - 1.0, i.floorY + 1.25, 0); g.add(lamp2);
    this.interiorGroup = g;
    g.visible = false;
  };

  Boat.prototype.showInterior = function (on) {
    if (!this.hasInterior) return;
    this.interiorActive = !!on;
    this.group.visible = !on;
    this.interiorGroup.visible = !!on;
    this.syncMesh();
  };

  Boat.prototype.doorPoint = function (side, out) {
    var cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    var lz = side * (this.spec.wid * 0.5 + 0.6);
    out.x = this.pos.x - lz * sinY;
    out.z = this.pos.z + lz * cosY;
    out.y = this.pos.y;
    return out;
  };

  Boat.prototype.step = function (dt, input) {
    var s = this.spec;
    if (input) {
      this.throttle = Number.isFinite(input.throttle) ? M.clamp(input.throttle, 0, 1) : 0;
      this.brake = Number.isFinite(input.brake) ? M.clamp(input.brake, 0, 1) : 0;
      this.steer = M.clamp(input.steer || 0, -1, 1);
      if (input.handbrake > 0.5) { this.throttle = 0; this.brake = 1; }
    }
    if (this.destroyed) { this.throttle = 0; this.brake = 1; }
    this.limitDynamics();

    var speed = Math.abs(this.u);
    var thrust = this.throttle * s.power * (this.reverse ? -0.4 : 1);
    if (this.brake > 0.01 && !this.reverse) thrust -= this.brake * s.power * 0.7;

    // quadratic hull drag, heavier when aground in the shallows
    var drag = -M.sign(this.u) * s.dragCoef * this.u * this.u * (this.aground ? 3.2 : 1);
    var lateralDrag = -this.v * (this.aground ? 14 : 5.5);

    // rudder authority scales with speed: near-stationary, the boat barely turns
    var rudderAuth = M.clamp(Math.abs(this.u) / 3.5, 0, 1) * M.sign(this.u || 1);
    var yawTorque = this.steer * s.turnRate * rudderAuth * (this.aground ? 0.3 : 1);
    this.yawRate = M.damp(this.yawRate, yawTorque, 6, dt);
    this.v += -this.yawRate * this.u * 0.22 * dt;

    var ax = (thrust + drag) / s.mass;
    var ay = lateralDrag / s.mass;
    this.u += ax * dt;
    this.v += ay * dt;
    this.limitDynamics();
    if (Math.abs(this.u) < 0.04 && this.throttle < 0.01 && this.brake > 0) this.u = 0;

    this.yaw = M.wrapAngle(this.yaw + this.yawRate * dt);
    var cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    var vx = this.u * cosY - this.v * sinY;
    var vz = this.u * sinY + this.v * cosY;

    // proposed new position, then resolved against solids (piers, other hulls)
    var nx = this.pos.x + vx * dt, nz = this.pos.z + vz * dt;
    var out = {};
    var hits = this.world.resolveCircle(nx, nz, this.collisionRadius, 0, 3, out);
    if (hits) {
      nx = out.x; nz = out.z;
      var vn = vx * out.nx + vz * out.nz;
      if (vn < 0) {
        var impact = -vn;
        vx -= (1 + 0.3) * vn * out.nx; vz -= (1 + 0.3) * vn * out.nz;
        this.u = vx * cosY + vz * sinY; this.v = -vx * sinY + vz * cosY;
        if (impact > 2 && performance.now() - this.lastImpact > 150) {
          this.lastImpact = performance.now();
          this.damage(impact * impact * 0.6);
        }
      }
    }
    this.limitDynamics();
    this.pos.x = nx; this.pos.z = nz;

    // water follow + grounding
    var waterY = this.world.waterSurfaceHeight(this.pos.x, this.pos.z, this.world.time || 0);
    var seabed = this.world.baseHeight(this.pos.x, this.pos.z);
    var planeLift = M.clamp(speed / s.topSpeed, 0, 1);
    var draft = s.draft * (1 - planeLift * 0.55);
    var restY = Math.max(waterY - draft, seabed + 0.05);
    this.aground = (seabed + 0.05) > (waterY - draft - 0.02) && this.pos.x > this.world.beachX - 40;
    this.pos.y = M.damp(this.pos.y, restY, 8, dt);
    if (this.aground && speed > 0.5) this.damage(speed * dt * 6);

    // trim: bow rises coming onto the plane, flattens out at full speed; bank
    // into turns like a hull heeling under helm
    var hump = Math.sin(M.clamp(speed / 11, 0, 1) * Math.PI) * 0.10;
    this.pitch = M.damp(this.pitch, hump, 5, dt);
    this.roll = M.damp(this.roll, M.clamp(this.yawRate * speed * 0.05, -0.22, 0.22), 5, dt);

    this.wake = M.clamp(speed / s.topSpeed, 0, 1);

    if (this.burning > 0) {
      this.burning += dt;
      this.health -= dt * 40;
      if (this.health <= -300) this.exploded = true;
    }
  };

  Boat.prototype.damage = function (amount) {
    if (this.destroyed) return;
    this.health -= amount;
    if (this.health < this.maxHealth * 0.3) this.smoking = true;
    if (this.health <= 0) { this.destroyed = true; this.burning = 0.001; }
  };

  Boat.prototype.syncMesh = function () {
    this.group.position.copy(this.pos);
    // Boat meshes are authored bow-first along local +X, so -yaw maps that
    // axis to the same world-space heading used by the physics model.
    this.group.rotation.set(0, -this.yaw, 0);
    if (this.interiorGroup) {
      this.interiorGroup.position.copy(this.pos);
      this.interiorGroup.rotation.set(0, -this.yaw, 0);
    }
    this.body.rotation.set(this.roll, 0, this.pitch);
    // slowly settle and list once destroyed, like a swamped hull
    if (this.destroyed) {
      this.body.rotation.z += Math.min(0.3, this.burning * 0.05);
      this.group.position.y -= Math.min(0.5, this.burning * 0.08);
    }
  };

  Boat.prototype.updateVisual = function (dt, lamps) {
    this.syncMesh();
    this.portLight.material.emissiveIntensity = this.destroyed ? 0 : lamps * 2.2;
    this.stbdLight.material.emissiveIntensity = this.destroyed ? 0 : lamps * 2.2;
    // audio sim reads rpm/spec.redline generically; map it from throttle+load
    this.rpm = M.lerp(this.rpm, 850 + this.throttle * 4200 + Math.abs(this.u) * 30, dt * 4);
  };

  SB.Boat = Boat;

  // -------------------------------------------------------------- manager --
  // No AI: boats exist to be found and driven. The manager just owns the pool
  // and steps whichever ones are not currently idle.
  function Boats(game) {
    this.game = game;
    this.list = [];
  }
  Boats.prototype.spawn = function (key, x, z, yaw, color) {
    var b = new SB.Boat(key, this.game.world, { color: color });
    b.addToScene(this.game.scene);
    b.placeAt(x, z, yaw);
    this.list.push(b);
    return b;
  };
  Boats.prototype.fixed = function (dt) {
    for (var i = this.list.length - 1; i >= 0; i--) {
      var b = this.list[i];
      var sane = isFinite(b.pos.x) && isFinite(b.pos.y) && isFinite(b.pos.z) && isFinite(b.yaw);
      if (!sane) { b.pos.set(0, 1, 0); b.yaw = 0; b.destroyed = true; b.exploded = true; b.burning = b.burning || 3; }
      if (b.isPlayer) continue;                 // player.driveStep already stepped it
      if (!sane || b.exploded) { this.despawn(b, i); continue; }
      var idle = Math.abs(b.u) < 0.05 && Math.abs(b.v) < 0.05 && !b.burning;
      if (!idle) b.step(dt, { throttle: 0, brake: 0.3, steer: 0, handbrake: 0 });
      else b.syncMesh();
    }
  };

  // Matches Aircraft.despawn: explode in place, then drop it - there is no
  // pool for boats to return to.
  Boats.prototype.despawn = function (b, index) {
    var g = this.game;
    if (g.fx) g.fx.explosion(b.pos.x, b.pos.y, b.pos.z, 1.0);
    if (g.audio) g.audio.explosion(b.pos.x, b.pos.y, b.pos.z);
    b.removeFromScene(g.scene);
    this.list.splice(index, 1);
  };
  Boats.prototype.render = function (dt, lamps) {
    var g = this.game;
    for (var i = 0; i < this.list.length; i++) {
      var b = this.list[i];
      if (b.isPlayer && !b.interiorActive) continue;
      b.updateVisual(dt, lamps);
    }
    if (g.fx) this.emitWakes(dt);
  };
  Boats.prototype.emitWakes = function (dt) {
    var g = this.game, fx = g.fx;
    var cam = g.camera;
    for (var i = 0; i < this.list.length; i++) {
      var b = this.list[i];
      if (b.wake < 0.08) continue;
      if (M.dist2(b.pos.x, b.pos.z, cam.position.x, cam.position.z) > 140 * 140) continue;
      if (Math.random() > b.wake * 0.9) continue;
      var cosY = Math.cos(b.yaw), sinY = Math.sin(b.yaw);
      var bx = b.pos.x - cosY * b.spec.len * 0.46, bz = b.pos.z - sinY * b.spec.len * 0.46;
      for (var s = -1; s <= 1; s += 2) {
        fx.dust(
          bx - sinY * s * b.spec.wid * 0.3, b.pos.y + 0.05, bz + cosY * s * b.spec.wid * 0.3,
          -cosY * 2 - sinY * s * 1.4, 0.6, -sinY * 2 + cosY * s * 1.4,
          0.6 * b.wake, 1.2, 0xe8f0f2);
      }
    }
  };
  SB.Boats = Boats;

})(window.SB = window.SB || {});
