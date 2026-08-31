// 27-aircraft.js - fixed-wing planes and helicopters.
//
// Both fly an arcade model: velocities chase a target the same way the
// player's on-foot movement and camera already do (M.damp toward a desired
// value) rather than integrating forces. That keeps them controllable and
// impossible to get into an unrecoverable spin, while still asking for real
// piloting - planes stall if you fly too slow, helicopters auto-hover but
// still have to be flown into a landing.
//
// world.surfaceAt() is reused unchanged as "the height of whatever is
// directly below" for ground contact, so a plane lands correctly whether
// that surface is the runway, a rooftop, or a city street - the last two
// just come with a harder landing.
(function (SB) {
  'use strict';

  var M = SB.M, Hull = SB.Hull, QB = SB.QB;

  // ============================================================= specs ====
  var PLANE_SPECS = SB.PlaneSpecs = {
    skyhawk: {
      name: 'Skyhawk 172', kind: 'prop', mass: 1100, len: 8.3, wingspan: 11.0, fusR: 0.58,
      maxSpeed: 62, cruiseSpeed: 40, stallSpeed: 15, climbFactor: 0.62,
      pitchRate: 1.05, rollRate: 2.1, yawFromRoll: 0.62, gearH: 0.62,
      redline: 2700, seats: 4, topHint: 62, cruiseThrottle: 0.62,
      throttleResponse: 1.8, pitchResponse: 4.5, rollResponse: 4.8,
      pitchStability: 0.78, rollStability: 1.05, maxBank: 1.15
    },
    twinprop: {
      name: 'Twinprop 340', kind: 'prop', mass: 2300, len: 14.2, wingspan: 16.8, fusR: 0.92,
      maxSpeed: 98, cruiseSpeed: 64, stallSpeed: 25, climbFactor: 0.70,
      pitchRate: 0.88, rollRate: 1.55, yawFromRoll: 0.50, gearH: 0.78,
      redline: 2500, seats: 8, topHint: 98, cruiseThrottle: 0.58, engineCount: 2,
      throttleResponse: 1.55, pitchResponse: 4.0, rollResponse: 4.2,
      pitchStability: 0.72, rollStability: 0.92, maxBank: 1.05
    },
    boeing747: {
      name: 'Boeing 747', kind: 'airliner', mass: 183000, len: 70.7, wingspan: 64.4, fusR: 4.25,
      maxSpeed: 250, cruiseSpeed: 205, stallSpeed: 72, climbFactor: 0.78,
      pitchRate: 0.42, rollRate: 0.62, yawFromRoll: 0.22, gearH: 3.15,
      redline: 2200, seats: 12, topHint: 250, cruiseThrottle: 0.70, engineCount: 4,
      throttleResponse: 0.72, pitchResponse: 2.2, rollResponse: 2.4,
      pitchStability: 0.42, rollStability: 0.50, maxBank: 0.72
    },
    fighter: {
      name: 'F-35 Viper', kind: 'fighter', mass: 16000, len: 15.7, wingspan: 10.7, fusR: 1.02,
      maxSpeed: 330, cruiseSpeed: 185, stallSpeed: 48, climbFactor: 0.92,
      pitchRate: 2.30, rollRate: 4.10, yawFromRoll: 0.88, gearH: 0.82,
      redline: 8200, seats: 1, topHint: 330, cruiseThrottle: 0.52, engineCount: 1,
      throttleResponse: 2.6, pitchResponse: 6.5, rollResponse: 7.2,
      pitchStability: 0.95, rollStability: 1.35, maxBank: 1.30
    },
    seaplane: {
      name: 'Mariner Amphibian', kind: 'prop', mass: 1850, len: 11.8, wingspan: 15.4, fusR: 0.78,
      maxSpeed: 86, cruiseSpeed: 58, stallSpeed: 22, climbFactor: 0.66,
      pitchRate: 0.92, rollRate: 1.65, yawFromRoll: 0.54, gearH: 0.70,
      redline: 2550, seats: 6, topHint: 86, cruiseThrottle: 0.60, engineCount: 1,
      throttleResponse: 1.65, pitchResponse: 4.2, rollResponse: 4.4,
      pitchStability: 0.70, rollStability: 0.90, maxBank: 1.02, floats: true
    },
    stealth: {
      name: 'Nightfall Stealth Jet', kind: 'fighter', mass: 14200, len: 17.8, wingspan: 12.4, fusR: 0.94,
      maxSpeed: 360, cruiseSpeed: 220, stallSpeed: 52, climbFactor: 1.0,
      pitchRate: 2.05, rollRate: 3.65, yawFromRoll: 0.82, gearH: 0.86,
      redline: 7800, seats: 1, topHint: 360, cruiseThrottle: 0.48, engineCount: 1,
      throttleResponse: 2.3, pitchResponse: 6.0, rollResponse: 6.6,
      pitchStability: 0.88, rollStability: 1.22, maxBank: 1.24, stealth: true
    }
  };

  var HELI_SPECS = SB.HeliSpecs = {
    chopper: {
      name: 'Coastline Chopper', mass: 1600, cabinLen: 3.6, cabinW: 1.95, cabinH: 1.85,
      tailLen: 5.0, rotorR: 5.3, tailRotorR: 0.85, maxSpeed: 32, climbSpeed: 8.5,
      maxYawRate: 2.0, gearH: 0.55, redline: 4800, seats: 4
    }
  };

  // ===================================================== shared materials =
  var sharedMats = null;
  function craftMats() {
    if (sharedMats) return sharedMats;
    var vm = SB.vehicleMaterials ? SB.vehicleMaterials() : null;
    sharedMats = {
      glass: (vm && vm.glass) || new THREE.MeshStandardMaterial({ color: 0x1c2530, roughness: 0.06, metalness: 0.9 }),
      trim: (vm && vm.trim) || new THREE.MeshStandardMaterial({ color: 0x1e2126, roughness: 0.55, metalness: 0.4 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.75 }),
      blade: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.55 }),
      blur: new THREE.MeshBasicMaterial({
        color: 0x0c0d10, transparent: true, opacity: 0.28,
        side: THREE.DoubleSide, depthWrite: false
      })
    };
    return sharedMats;
  }

  // ===================================================== helicopter mesh ==
  // Shared by the player-flyable helicopter and the police pursuit chopper,
  // so both get the same level of detail: a lofted cabin, a glass canopy, a
  // tapering tail boom, skids, and a two-blade main and tail rotor with a
  // blur disc that fades in as the blades spin up.
  var heliGeoCache = null;
  function heliBodyGeometry() {
    if (heliGeoCache) return heliGeoCache;
    var s = HELI_SPECS.chopper;
    var hw = s.cabinW / 2;
    var cabin = new QB(), boom = new QB();

    var st = [
      Hull.station(s.cabinLen * 0.52, 0.10, 0.10, 0.30, 0.08),
      Hull.station(s.cabinLen * 0.30, hw * 0.88, -0.05, s.cabinH * 0.92, 0.16),
      Hull.station(-s.cabinLen * 0.05, hw, -0.10, s.cabinH, 0.18),
      Hull.station(-s.cabinLen * 0.45, hw * 0.72, -0.06, s.cabinH * 0.74, 0.14),
      Hull.station(-s.cabinLen * 0.50, 0.30, 0.05, 0.55, 0.10)
    ];
    Hull.loft(cabin, st);

    // tail boom tapering to the fin
    var bt = [
      Hull.station(-s.cabinLen * 0.48, 0.30, 0.10, 0.46, 0.10),
      Hull.station(-s.cabinLen * 0.48 - s.tailLen * 0.7, 0.16, 0.18, 0.40, 0.06),
      Hull.station(-s.cabinLen * 0.48 - s.tailLen, 0.08, 0.20, 0.34, 0.04)
    ];
    Hull.loft(boom, bt);

    var merged = Hull.mergeGroups([{ qb: cabin, name: 'cabin' }, { qb: boom, name: 'boom' }]);
    return (heliGeoCache = merged);
  }

  // Builds a full helicopter group. opts: { color, police, glassTint }
  SB.buildHelicopter = function (opts) {
    opts = opts || {};
    var s = HELI_SPECS.chopper;
    var mats = craftMats();
    var hg = heliBodyGeometry();

    var paintMat = SB.finishMaterial({
      color: opts.color === undefined ? 0xe8e4da : opts.color,
      roughness: 0.28, metalness: 0.38, clearcoat: 0.42,
      clearcoatRoughness: 0.16, reflectivity: 0.72
    });
    var slotMats = [];
    for (var i = 0; i < hg.slots.length; i++) slotMats.push(paintMat);

    var g = new THREE.Group();
    var body = new THREE.Mesh(hg.geometry, slotMats);
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);

    // glass canopy: a rounded bubble over the front of the cabin
    var glassGeo = new THREE.SphereGeometry(s.cabinW * 0.62, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);
    var glass = new THREE.Mesh(glassGeo, mats.glass);
    glass.position.set(s.cabinLen * 0.14, s.cabinH * 0.42, 0);
    glass.rotation.x = Math.PI;
    glass.scale.set(1.15, 0.85, 1.0);
    g.add(glass);

    // Window mullions, door seams, and a roof antenna give the cabin a
    // finished search-and-rescue silhouette at close range.
    var frameMat = new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.32, metalness: 0.7 });
    for (var frameSide = -1; frameSide <= 1; frameSide += 2) {
      var frame = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.86, 0.055), frameMat);
      frame.position.set(-s.cabinLen * 0.10, s.cabinH * 0.50, frameSide * s.cabinW * 0.53);
      g.add(frame);
      var sill = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.055, 0.055), frameMat);
      sill.position.set(s.cabinLen * 0.02, s.cabinH * 0.23, frameSide * s.cabinW * 0.53);
      g.add(sill);
    }
    var antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.42, 6), frameMat);
    antenna.position.set(-s.cabinLen * 0.18, s.cabinH + 0.18, 0);
    g.add(antenna);

    // skids
    var skidMat = mats.trim;
    for (var side = -1; side <= 1; side += 2) {
      var skid = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, s.cabinLen * 0.95, 6), skidMat);
      skid.rotation.z = Math.PI / 2;
      skid.position.set(-s.cabinLen * 0.05, -s.gearH, side * s.cabinW * 0.42);
      g.add(skid);
      for (var leg = -1; leg <= 1; leg += 2) {
        var strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, s.gearH + 0.2, 5), skidMat);
        strut.rotation.z = 0.28 * -leg;
        strut.position.set(leg * s.cabinLen * 0.22, -s.gearH * 0.5, side * s.cabinW * 0.42);
        g.add(strut);
      }
    }

    // main rotor: mast, hub, four blades, blur disc
    var rotor = new THREE.Group();
    rotor.position.set(0, s.cabinH + 0.35, 0);
    var mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.35, 8), mats.metal);
    mast.position.y = -0.17;
    rotor.add(mast);
    var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.14, 8), mats.metal);
    rotor.add(hub);
    var blades = new THREE.Group();
    for (var b = 0; b < 4; b++) {
      var blade = new THREE.Mesh(new THREE.BoxGeometry(s.rotorR * 2, 0.035, 0.30), mats.blade);
      blade.rotation.y = b * Math.PI / 2;
      blades.add(blade);
    }
    rotor.add(blades);
    var blur = new THREE.Mesh(new THREE.CircleGeometry(s.rotorR, 28), mats.blur.clone());
    blur.rotation.x = -Math.PI / 2;
    blur.visible = false;
    rotor.add(blur);
    g.add(rotor);

    // tail rotor, vertical, at the end of the boom
    var tailX = -s.cabinLen * 0.48 - s.tailLen;
    var tailRotor = new THREE.Group();
    tailRotor.position.set(tailX + 0.15, 0.55, s.cabinW * 0.18);
    var tHub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 6), mats.metal);
    tHub.rotation.z = Math.PI / 2;
    tailRotor.add(tHub);
    var tBlades = new THREE.Group();
    for (b = 0; b < 3; b++) {
      var tb = new THREE.Mesh(new THREE.BoxGeometry(0.03, s.tailRotorR * 2, 0.13), mats.blade);
      tb.rotation.x = b * Math.PI * 2 / 3;
      tBlades.add(tb);
    }
    tailRotor.add(tBlades);
    var tBlur = new THREE.Mesh(new THREE.CircleGeometry(s.tailRotorR, 16), mats.blur.clone());
    tBlur.rotation.y = Math.PI / 2;
    tBlur.visible = false;
    tailRotor.add(tBlur);
    g.add(tailRotor);
    // fin
    var fin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.06), paintMat);
    fin.position.set(tailX + 0.35, 0.55, 0);
    g.add(fin);

    // nav / anti-collision lights
    var lampGeo = new THREE.SphereGeometry(0.05, 6, 5);
    var portLight = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({ color: 0x400008, emissive: 0xff2030, emissiveIntensity: 0 }));
    var stbdLight = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({ color: 0x003008, emissive: 0x20ff60, emissiveIntensity: 0 }));
    portLight.position.set(s.cabinLen * 0.1, s.cabinH * 0.3, -s.cabinW * 0.55);
    stbdLight.position.set(s.cabinLen * 0.1, s.cabinH * 0.3, s.cabinW * 0.55);
    g.add(portLight, stbdLight);
    var beacon = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2200, emissiveIntensity: 0 }));
    beacon.position.set(0, s.cabinH + 0.05, 0);
    g.add(beacon);
    var searchlight = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a2e32, emissive: 0xffe4a1, emissiveIntensity: 0.1, roughness: 0.28, metalness: 0.75 }));
    searchlight.position.set(s.cabinLen * 0.40, s.cabinH * 0.36, 0);
    g.add(searchlight);

    // Door handles and an exhaust cap add the small manufactured cues that
    // make the cabin feel assembled rather than like one lofted primitive.
    var hardware = new THREE.MeshStandardMaterial({ color: 0x9ca4a8, roughness: 0.24, metalness: 0.86 });
    for (var handleSide = -1; handleSide <= 1; handleSide += 2) {
      var doorHandle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.035, 0.035), hardware);
      doorHandle.position.set(-s.cabinLen * 0.02, s.cabinH * 0.34, handleSide * s.cabinW * 0.56);
      g.add(doorHandle);
    }
    var exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.32, 8), hardware);
    exhaust.rotation.z = Math.PI / 2;
    exhaust.position.set(-s.cabinLen * 0.28, s.cabinH * 0.96, 0);
    g.add(exhaust);

    var result = {
      group: g, paintMat: paintMat, rotor: rotor, blades: blades, blur: blur,
      tailRotor: tailRotor, tBlades: tBlades, tBlur: tBlur,
      portLight: portLight, stbdLight: stbdLight, beacon: beacon, searchlight: searchlight,
      spec: s, spin: 0
    };

    if (opts.police) {
      var barMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5 });
      var bar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, 0.34), barMat);
      bar.position.set(0.2, s.cabinH * 0.98, 0);
      g.add(bar);
      var cone = new THREE.Mesh(
        new THREE.ConeGeometry(9, 60, 14, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xfff2cc, transparent: true, opacity: 0.10,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        }));
      cone.position.y = -30;
      g.add(cone);
      result.cone = cone;
    }
    return result;
  };

  // Advance rotor spin + blur cross-fade. Call every rendered frame.
  SB.stepHeliRotor = function (mesh, dt, spinning) {
    var targetSpin = spinning ? 1 : 0;
    mesh.spin = M.damp(mesh.spin, targetSpin, spinning ? 2.5 : 1.2, dt);
    var rate = mesh.spin * 46;
    mesh.rotor.rotation.y += rate * dt;
    mesh.tailRotor.rotation.x += rate * 2.1 * dt;
    var showBlur = mesh.spin > 0.55;
    mesh.blades.visible = !showBlur;
    mesh.blur.visible = showBlur;
    mesh.blur.material.opacity = 0.28 * M.clamp((mesh.spin - 0.55) / 0.45, 0, 1);
    mesh.tBlades.visible = !showBlur;
    mesh.tBlur.visible = showBlur;
    mesh.tBlur.material.opacity = mesh.blur.material.opacity;
  };

  // ============================================================ plane ====
  var planeGeoCache = Object.create(null);
  function planeGeometry(key) {
    if (planeGeoCache[key]) return planeGeoCache[key];
    var s = PLANE_SPECS[key];
    var L = s.len, f = L / 2, r = -L / 2;
    var nose = L * (s.kind === 'airliner' ? 0.14 : 0.18);
    var cockpit = L * (s.kind === 'airliner' ? 0.27 : 0.31);
    var mid = L * (s.kind === 'airliner' ? 0.48 : 0.54);
    var tail = L * (s.kind === 'airliner' ? 0.23 : 0.20);
    var fuse = new QB(), glass = new QB(), trim = new QB();

    var st = [
      Hull.station(f, 0.05, -0.03, 0.10, 0.03),
      Hull.station(f - nose, s.fusR * 0.62, -s.fusR * 0.48, s.fusR * 0.72, 0.10),
      Hull.station(f - cockpit, s.fusR * 0.95, -s.fusR * 0.59, s.fusR, 0.14),
      Hull.station(f - mid, s.fusR * 0.82, -s.fusR * 0.52, s.fusR * 0.90, 0.13),
      Hull.station(r + tail, s.fusR * 0.46, -s.fusR * 0.34, s.fusR * 0.58, 0.09),
      Hull.station(r + L * 0.05, s.fusR * 0.20, -s.fusR * 0.14, s.fusR * 0.30, 0.05),
      Hull.station(r, 0.04, -0.02, 0.06, 0.02)
    ];
    Hull.loft(fuse, st);

    // canopy glass over the cockpit
    if (s.kind !== 'airliner') {
      glass.box(f - L * 0.29, s.fusR * 0.54, -s.fusR * 0.52,
        f - L * 0.12, s.fusR * 0.98, s.fusR * 0.52, 2, 2, 2, { skipTop: false });
    } else {
      // A wide dark window band makes the 747 read as a passenger jet even
      // when it is far enough away that the individual windows are tiny.
      glass.box(f - L * 0.30, s.fusR * 0.42, -s.fusR * 0.94,
        r + L * 0.22, s.fusR * 0.74, s.fusR * 0.94, 8, 2, 2, { skipTop: false });
    }

    // High wing for the prop aircraft, swept low wing for the jets.
    var wingY = s.kind === 'airliner' ? s.fusR * 0.55 : (s.kind === 'fighter' ? s.fusR * 0.06 : s.fusR * 0.96);
    var chord = L * (s.kind === 'airliner' ? 0.15 : (s.kind === 'fighter' ? 0.25 : 0.16));
    var half = s.wingspan / 2;
    var wingStart = f - L * (s.kind === 'fighter' ? 0.43 : 0.48);
    var wingEnd = wingStart + chord;
    trim.box(wingStart, wingY, -half, wingEnd, wingY + (s.kind === 'fighter' ? 0.20 : 0.14), half, 5, 5, 5, {});
    if (s.kind === 'prop') {
      // struts
      for (var side = -1; side <= 1; side += 2) {
        trim.box(wingStart + chord * 0.18, 0.10, side * half * 0.42 - 0.04,
          wingStart + chord * 0.27, wingY, side * half * 0.42 + 0.04, 1, 1, 1, {});
      }
    }

    // tailplane + fin
    trim.box(r + L * 0.08, s.fusR * 0.48, -s.wingspan * (s.kind === 'fighter' ? 0.16 : 0.19),
      r + L * 0.20, s.fusR * 0.60, s.wingspan * (s.kind === 'fighter' ? 0.16 : 0.19), 3, 3, 3, {});
    trim.box(r + L * 0.06, s.fusR * 0.30, -0.05,
      r + L * 0.22, s.fusR * (s.kind === 'fighter' ? 1.55 : 1.65), 0.05, 3, 3, 3, {});
    if (s.kind === 'fighter') {
      // Twin canted tails are the visual signature of the fighter variant.
      for (side = -1; side <= 1; side += 2) {
        trim.box(r + L * 0.02, s.fusR * 0.66, side * s.fusR * 0.25 - 0.05,
          r + L * 0.16, s.fusR * 1.72, side * s.fusR * 0.25 + 0.05, 2, 2, 2, {});
      }
    }

    var merged = Hull.mergeGroups([
      { qb: fuse, name: 'paint' }, { qb: glass, name: 'glass' }, { qb: trim, name: 'trim' }
    ]);
    return (planeGeoCache[key] = merged);
  }

  SB.buildPlane = function (key, opts) {
    opts = opts || {};
    var s = PLANE_SPECS[key];
    var mats = craftMats();
    var pg = planeGeometry(key);
    // Mirror the constants planeGeometry() used internally; that function's
    // locals are not in scope here, so wing/nav-light placement is recomputed
    // from the spec rather than reaching into the geometry builder.
    var f = s.len / 2, r = -s.len / 2, half = s.wingspan / 2;
    var wingY = s.kind === 'airliner' ? s.fusR * 0.55 : (s.kind === 'fighter' ? s.fusR * 0.06 : s.fusR * 0.96);
    var chord = s.len * (s.kind === 'airliner' ? 0.15 : (s.kind === 'fighter' ? 0.25 : 0.16));
    var wingStart = f - s.len * (s.kind === 'fighter' ? 0.43 : 0.48);
    var paintMat = SB.finishMaterial({
      color: opts.color === undefined ? 0xf2efe6 : opts.color,
      roughness: s.stealth ? 0.34 : 0.22, metalness: s.stealth ? 0.42 : 0.22,
      clearcoat: s.stealth ? 0.18 : 0.46, clearcoatRoughness: 0.18,
      reflectivity: 0.70
    });
    var slotMats = [];
    for (var i = 0; i < pg.slots.length; i++) {
      var n = pg.slots[i];
      slotMats.push(n === 'paint' ? paintMat : n === 'glass' ? mats.glass : mats.trim);
    }
    var g = new THREE.Group();
    var body = new THREE.Mesh(pg.geometry, slotMats);
    body.castShadow = true; body.receiveShadow = true;
    g.add(body);

    // Panel lines and fasteners sit above the cached shell so every livery
    // gets the same manufactured scale. They are deliberately restrained on
    // the widebody to avoid turning the airliner into a forest of draw calls.
    var panelMat = new THREE.MeshStandardMaterial({ color: s.stealth ? 0x202a34 : 0x69737c, roughness: 0.36, metalness: 0.72 });
    var panel = new THREE.Mesh(new THREE.BoxGeometry(s.len * 0.34, 0.018, 0.018), panelMat);
    panel.position.set(-s.len * 0.13, s.fusR * 0.76, s.fusR * 0.86);
    g.add(panel);
    var panel2 = panel.clone(); panel2.position.z = -s.fusR * 0.86; g.add(panel2);
    if (s.kind !== 'airliner') {
      var canopyFrame = new THREE.Mesh(new THREE.TorusGeometry(s.fusR * 0.55, 0.025, 6, 16, Math.PI), panelMat);
      canopyFrame.rotation.z = Math.PI / 2;
      canopyFrame.position.set(s.len * 0.18, s.fusR * 0.48, 0);
      g.add(canopyFrame);
    }

    // stripe accent along the fuselage side
    var stripe = new THREE.Mesh(new THREE.BoxGeometry(s.len * 0.55, 0.10, 0.02),
      new THREE.MeshStandardMaterial({ color: opts.stripe === undefined ? 0xc23a2e : opts.stripe, roughness: 0.4 }));
    stripe.position.set(-s.len * 0.04, s.fusR * 0.30, s.fusR * 0.83);
    g.add(stripe);
    var stripe2 = stripe.clone();
    stripe2.position.z = -s.fusR * 0.83;
    g.add(stripe2);

    // fixed gear. The airliner uses a simple multi-wheel main bogie so its
    // scale reads correctly beside the smaller single-wheel aircraft.
    var gearMat = mats.trim;
    var wheelRadius = s.kind === 'airliner' ? 0.72 : (s.kind === 'fighter' ? 0.28 : 0.24);
    var wheelGeo = SB.geo('planeWheel:' + key, function () {
      var geo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelRadius * 0.58, 12);
      geo.rotateX(Math.PI / 2);
      return geo;
    });
    var wheelMat = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.9 });
    function gearLeg(x, z) {
      var leg = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius * 0.16, wheelRadius * 0.20, s.gearH, 6), gearMat);
      leg.position.set(x, -s.gearH * 0.5 + wheelRadius * 0.42, z);
      g.add(leg);
      var wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(x, -s.gearH + wheelRadius, z);
      g.add(wheel);
    }
    if (s.kind === 'airliner') {
      gearLeg(s.len * 0.31, 0);
      gearLeg(-s.len * 0.12, -s.wingspan * 0.17);
      gearLeg(-s.len * 0.12, s.wingspan * 0.17);
      gearLeg(-s.len * 0.01, -s.wingspan * 0.17);
      gearLeg(-s.len * 0.01, s.wingspan * 0.17);
    } else {
      gearLeg(s.len * 0.28, 0);
      gearLeg(-s.len * 0.06, s.kind === 'fighter' ? -0.72 : -1.7);
      gearLeg(-s.len * 0.06, s.kind === 'fighter' ? 0.72 : 1.7);
    }

    var propBlades = null, propBlur = null;
    if (s.kind === 'prop') {
      // propeller at the nose
      var propGroup = new THREE.Group();
      propGroup.position.set(s.len / 2 + 0.06, 0.03, 0);
      var spinner = new THREE.Mesh(new THREE.ConeGeometry(s.fusR * 0.24, s.fusR * 0.48, 10), mats.metal);
      spinner.rotation.z = -Math.PI / 2;
      propGroup.add(spinner);
      propBlades = new THREE.Group();
      for (var b = 0; b < 2; b++) {
        var blade = new THREE.Mesh(new THREE.BoxGeometry(s.fusR * 0.09, s.fusR * 1.45, s.fusR * 0.24), mats.blade);
        blade.rotation.x = b * Math.PI / 2;
        propBlades.add(blade);
      }
      propGroup.add(propBlades);
      propBlur = new THREE.Mesh(new THREE.CircleGeometry(s.fusR * 0.74, 20), mats.blur.clone());
      propBlur.rotation.y = Math.PI / 2;
      propBlur.visible = false;
      propGroup.add(propBlur);
      g.add(propGroup);
      if (s.floats) {
        var floatMat = new THREE.MeshStandardMaterial({ color: 0xb0b6bb, roughness: 0.28, metalness: 0.74 });
        for (var fs = -1; fs <= 1; fs += 2) {
          var float = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, s.len * 0.56, 3, 10), floatMat);
          float.rotation.z = Math.PI / 2;
          float.position.set(-s.len * 0.02, -s.gearH * 0.74, fs * s.wingspan * 0.26);
          g.add(float);
          var floatStrut = new THREE.Mesh(new THREE.BoxGeometry(0.08, s.gearH * 0.75, 0.08), mats.trim);
          floatStrut.position.set(-s.len * 0.04, -s.gearH * 0.35, fs * s.wingspan * 0.26);
          g.add(floatStrut);
        }
      }
    } else {
      // Jet nacelles make the silhouettes and engine count distinct without
      // adding an expensive texture or an external model dependency.
      var engineMat = new THREE.MeshStandardMaterial({ color: 0x30353b, roughness: 0.28, metalness: 0.78 });
      var engineGlowMat = new THREE.MeshStandardMaterial({ color: 0x281719, emissive: 0xff5c2e, emissiveIntensity: 0.65, roughness: 0.32, metalness: 0.42 });
      function jetEngine(x, z, radius, length) {
        var eg = new THREE.Group();
        eg.position.set(x, wingY - radius * 0.75, z);
        var nacelle = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.84, length, 12), engineMat);
        nacelle.rotation.z = Math.PI / 2;
        eg.add(nacelle);
        var nozzle = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.58, radius * 0.58, radius * 0.28, 12), engineGlowMat);
        nozzle.rotation.z = Math.PI / 2;
        nozzle.position.x = -length * 0.50;
        eg.add(nozzle);
        g.add(eg);
      }
      if (s.kind === 'airliner') {
        var side;
        for (side = -1; side <= 1; side += 2) {
          jetEngine(wingStart + chord * 0.56, side * s.wingspan * 0.20, s.fusR * 0.28, s.len * 0.13);
          jetEngine(wingStart + chord * 0.50, side * s.wingspan * 0.36, s.fusR * 0.24, s.len * 0.12);
        }
      } else {
        jetEngine(-s.len * 0.36, 0, s.fusR * 0.38, s.len * 0.22);
        var intake = new THREE.Mesh(new THREE.TorusGeometry(s.fusR * 0.42, s.fusR * 0.08, 8, 16), engineMat);
        intake.rotation.y = Math.PI / 2;
        intake.position.set(s.len * 0.33, s.fusR * 0.08, 0);
        g.add(intake);
      }
    }

    // The widebody gets individually readable cabin windows and the jets get
    // small winglets. These are intentionally separate from the cached hull
    // so each paint variant can keep its own glass and trim materials.
    if (s.kind === 'airliner') {
      var airWindowMat = new THREE.MeshStandardMaterial({
        color: 0x101c28, roughness: 0.10, metalness: 0.7,
        emissive: 0x07131d, emissiveIntensity: 0.25
      });
      for (var wi = 0; wi < 22; wi++) {
        var wx = r + s.len * 0.10 + wi * s.len * 0.032;
        for (var ws = -1; ws <= 1; ws += 2) {
          var aw = new THREE.Mesh(new THREE.BoxGeometry(s.len * 0.018, s.fusR * 0.10, 0.035), airWindowMat);
          aw.position.set(wx, s.fusR * 0.60, ws * s.fusR * 0.965);
          g.add(aw);
        }
      }
    }
    if (s.kind !== 'airliner') {
      var wingletMat = new THREE.MeshStandardMaterial({ color: 0x2b3037, roughness: 0.34, metalness: 0.66 });
      for (var wingSide = -1; wingSide <= 1; wingSide += 2) {
        var winglet = new THREE.Mesh(new THREE.BoxGeometry(0.16, s.kind === 'fighter' ? 0.75 : 0.38, 0.07), wingletMat);
        winglet.position.set(wingStart + chord * 0.72, wingY + (s.kind === 'fighter' ? 0.36 : 0.18), wingSide * half);
        winglet.rotation.z = wingSide * (s.kind === 'fighter' ? 0.18 : 0.28);
        g.add(winglet);
      }
    }
    if (s.stealth) {
      var chineMat = new THREE.MeshStandardMaterial({ color: 0x303b46, roughness: 0.28, metalness: 0.72 });
      for (var cs = -1; cs <= 1; cs += 2) {
        var chine = new THREE.Mesh(new THREE.BoxGeometry(s.len * 0.25, 0.06, 0.06), chineMat);
        chine.position.set(s.len * 0.14, -s.fusR * 0.08, cs * s.fusR * 0.50);
        chine.rotation.y = cs * 0.24;
        g.add(chine);
      }
    }

    // nav lights
    var lampGeo = new THREE.SphereGeometry(0.045, 6, 5);
    var portLight = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({ color: 0x400008, emissive: 0xff2030, emissiveIntensity: 0 }));
    var stbdLight = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({ color: 0x003008, emissive: 0x20ff60, emissiveIntensity: 0 }));
    portLight.position.set(wingStart + chord * 0.52, wingY, -half + 0.15);
    stbdLight.position.set(wingStart + chord * 0.52, wingY, half - 0.15);
    g.add(portLight, stbdLight);
    var strobe = new THREE.Mesh(lampGeo, new THREE.MeshStandardMaterial({ color: 0x303030, emissive: 0xffffff, emissiveIntensity: 0 }));
    strobe.position.set(r + s.len * 0.13, s.fusR * 0.9, 0);
    g.add(strobe);
    var landingLight = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.07, s.fusR * 0.11), 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xffe8b0, emissive: 0xffc15d, emissiveIntensity: 0.15, roughness: 0.22, metalness: 0.48 }));
    landingLight.position.set(s.len * 0.43, -s.fusR * 0.10, 0);
    g.add(landingLight);

    return {
      group: g, paintMat: paintMat, propBlades: propBlades, propBlur: propBlur,
      portLight: portLight, stbdLight: stbdLight, strobe: strobe, landingLight: landingLight,
      spin: 0
    };
  };

  SB.stepPropRotor = function (mesh, dt, spinning) {
    var target = spinning ? 1 : 0;
    mesh.spin = M.damp(mesh.spin, target, spinning ? 3 : 1.5, dt);
    mesh.propBlades.parent.rotation.x += mesh.spin * 70 * dt;
    var show = mesh.spin > 0.5;
    mesh.propBlades.visible = !show;
    mesh.propBlur.visible = show;
    mesh.propBlur.material.opacity = 0.3 * M.clamp((mesh.spin - 0.5) / 0.5, 0, 1);
  };

  // ====================================================== Plane class ====
  function Plane(key, world, opts) {
    opts = opts || {};
    var s = PLANE_SPECS[key];
    this.key = key; this.spec = s; this.world = world; this.name = s.name;
    this.craftType = 'plane';

    this.pos = new THREE.Vector3(0, 0, 0);
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.airspeed = 0;
    this.verticalSpeed = 0;
    this.yawRate = 0; this.pitchRate = 0; this.rollRate = 0;
    this.throttle = s.cruiseThrottle === undefined ? 0.62 : s.cruiseThrottle;
    this.grounded = true;
    this.altitude = 0;
    this.stalling = false;
    this.rpm = 900; this.skid = 0;
    this.gear = 1; this.reverse = false;   // dummy fields so shared HUD/audio code never sees undefined
    this.flightInput = { pitch: 0, roll: 0 };
    this.ignoreWorldBounds = true;

    this.health = 260; this.maxHealth = 260;
    this.destroyed = false; this.burning = 0; this.smoking = false; this.exploded = false;
    this.locked = false; this.lastImpact = 0;
    this.driver = null; this.isPlayer = false;

    this.color = opts.color;
    this.mesh = SB.buildPlane(key, opts);
    this.group = this.mesh.group;
  }

  Plane.prototype.addToScene = function (scene) { scene.add(this.group); return this; };
  Plane.prototype.removeFromScene = function (scene) { scene.remove(this.group); };
  Plane.prototype.setColor = function (hex) { this.color = hex; this.mesh.paintMat.color.setHex(hex); };
  Plane.prototype.speed = function () { return this.airspeed; };
  Plane.prototype.speedKph = function () { return this.airspeed * 3.6; };
  Plane.prototype.forward = function (out) {
    var cp = Math.cos(this.pitch);
    out.x = Math.cos(this.yaw) * cp; out.y = Math.sin(this.pitch); out.z = Math.sin(this.yaw) * cp;
    return out;
  };
  Plane.prototype.doorPoint = function (side, out) {
    var cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    var lx = -this.spec.len * 0.10, lz = side * 1.9;
    out.x = this.pos.x + lx * cosY - lz * sinY;
    out.z = this.pos.z + lx * sinY + lz * cosY;
    out.y = this.pos.y;
    return out;
  };

  Plane.prototype.placeAt = function (x, z, yaw) {
    this.pos.set(x, 0, z);
    this.yaw = yaw || 0; this.pitch = 0; this.roll = 0;
    this.airspeed = 0; this.yawRate = this.pitchRate = this.rollRate = 0;
    this.verticalSpeed = 0;
    this.flightInput.pitch = this.flightInput.roll = 0;
    this.grounded = true;
    var srf = this.world.surfaceAt(x, z, 50, 60);
    this.pos.y = srf.y + this.spec.gearH;
    this.syncMesh();
    return this;
  };

  // input.flight === true for real piloting; otherwise this is the generic
  // idle placeholder used while dead or mid enter/exit, and the plane just
  // glides/rolls to a safe stop under its own drag.
  Plane.prototype.step = function (dt, input) {
    var s = this.spec;
    var piloting = !!(input && input.flight) && !this.destroyed;

    var pitchIn = piloting && Number.isFinite(input.pitch) ? M.clamp(input.pitch, -1, 1) : 0;
    var rollIn = piloting && Number.isFinite(input.roll) ? M.clamp(input.roll, -1, 1) : 0;
    var boost = piloting && input.boost;
    var brakeIn = piloting && input.airbrake;

    // Smooth the actual control targets inside the aircraft, rather than
    // letting keyboard edge transitions or thumbstick noise directly change
    // angular rates. This keeps the plane responsive without making it twitch.
    var controlResponse = this.grounded ? 9.5 : 7.0;
    this.flightInput.pitch = M.damp(this.flightInput.pitch, pitchIn, controlResponse, dt);
    this.flightInput.roll = M.damp(this.flightInput.roll, rollIn, controlResponse, dt);
    pitchIn = this.flightInput.pitch;
    rollIn = this.flightInput.roll;

    if (this.destroyed) { this.throttle = M.damp(this.throttle, 0, 1, dt); }
    else {
      var cruiseThrottle = s.cruiseThrottle === undefined ? 0.62 : s.cruiseThrottle;
      var wantThrottle = this.grounded && !piloting ? 0 :
        (brakeIn ? (s.airbrakeThrottle || 0.12) :
          (boost ? (s.boostThrottle || 1.0) : cruiseThrottle));
      this.throttle = M.damp(this.throttle, wantThrottle, s.throttleResponse || 1.8, dt);
    }

    if (this.grounded) {
      // On the ground: roll input steers the nosewheel instead of banking.
      var steerAuth = M.clamp(this.airspeed / 6, 0.15, 1);
      this.yawRate = M.damp(this.yawRate, rollIn * 0.9 * steerAuth, 6, dt);
      this.roll = M.damp(this.roll, 0, 6, dt);
      this.pitchRate = 0;
      var rotate = piloting && pitchIn < -0.3 && this.airspeed > s.stallSpeed * 0.92;
      this.pitch = M.damp(this.pitch, rotate ? 0.12 : 0, 3, dt);
    } else {
      var speedRatio = M.clamp(this.airspeed / Math.max(s.cruiseSpeed, s.stallSpeed + 1), 0, 1.25);
      var bankAuthority = 0.35 + speedRatio * 0.65;
      var maxBank = s.maxBank || 1.15;
      var targetRollRate = rollIn * s.rollRate * bankAuthority - this.roll * (s.rollStability || 1.0);
      this.rollRate = M.damp(this.rollRate, targetRollRate, s.rollResponse || 4.5, dt);
      this.roll = M.clamp(this.roll + this.rollRate * dt, -maxBank, maxBank);

      // A small stability term recentres the nose when the stick is released,
      // while the pilot can still hold a deliberate climb or dive.
      var targetPitchRate = -pitchIn * s.pitchRate - this.pitch * (s.pitchStability || 0.7);
      this.pitchRate = M.damp(this.pitchRate, targetPitchRate, s.pitchResponse || 4, dt);
      this.pitch = M.clamp(this.pitch + this.pitchRate * dt, -0.82, 0.82);

      // Coordinated turn: bank produces a smooth yaw rate, with less authority
      // near the stall so the aircraft does not snap around while slow.
      var turnAuthority = 0.25 + M.clamp(speedRatio, 0, 1) * 0.75;
      // Keep right-stick/right-key steering consistent with boats and
      // helicopters: positive input turns toward positive world Z when the
      // craft is facing +X. The old negative sign made the plane turn the
      // opposite way from every other controllable craft.
      var targetYawRate = this.roll * s.yawFromRoll * turnAuthority;
      this.yawRate = M.damp(this.yawRate, targetYawRate, s.yawResponse || 3.2, dt);
    }
    this.yaw = M.wrapAngle(this.yaw + this.yawRate * dt);

    // stall: too slow to fly, the nose drops and lift falls off
    this.stalling = !this.grounded && this.airspeed < s.stallSpeed * 0.94;
    if (this.stalling) this.pitch = M.damp(this.pitch, -0.30, 1.5, dt);

    var targetSpeed = s.stallSpeed * 0.4 + this.throttle * (s.maxSpeed - s.stallSpeed * 0.4);
    targetSpeed -= Math.max(0, Math.sin(this.pitch)) * 14;   // climbing costs speed
    targetSpeed += Math.max(0, -Math.sin(this.pitch)) * 10;  // diving gains it
    this.airspeed = M.damp(this.airspeed, Math.max(0, targetSpeed), 1.8, dt);
    if (this.grounded) {
      // Airbrake remains meaningful after touchdown. Before this branch was
      // added, the landing input was overridden by the taxi target and a
      // plane could touch down but never decelerate on the runway.
      var taxiTarget = brakeIn ? 0 : this.throttle * s.maxSpeed * 0.55;
      this.airspeed = M.damp(this.airspeed, taxiTarget, brakeIn ? 4.8 : 2.2, dt);
    }

    var cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    // Climb comes from the same sin(pitch)*speed formula whether grounded or
    // not: while taxiing, pitch sits at 0 so climb is naturally 0, and once
    // "rotate" lifts the nose (see above) this is what actually gets the
    // aircraft off the ground - forcing climb to 0 whenever grounded would
    // make takeoff physically impossible no matter how much the nose is
    // raised, which is exactly the bug this replaced.
    var climb = Math.sin(this.pitch) * this.airspeed - (this.stalling ? 3 : 0);
    // A small, stable flare near an authored runway makes touchdown depend on
    // pilot attitude and sink rate rather than a one-frame positional snap.
    // It only operates in the final approach window and never creates lift at
    // altitude, so a missed approach remains fully pilot-controlled.
    var approachSrf = this.world.surfaceAt(this.pos.x, this.pos.z, this.pos.y + 8, 8);
    var approachZone = this.world.landingZoneAt(this.pos.x, this.pos.z, 'plane');
    var approachAlt = this.pos.y - approachSrf.y - s.gearH;
    if (!this.grounded && approachZone && approachAlt > 0 && approachAlt < 7 && climb < 0.6 &&
        Math.abs(this.roll) < 0.42) {
      // Once the aircraft is inside the runway's flare gate, keep a modest
      // positive sink even if the pilot has already neutralised the stick;
      // otherwise a level approach can float forever a few metres above the
      // deck. The pilot still controls speed, bank, and whether they enter the
      // gate at all.
      climb = Math.min(climb, -1.8);
      this.pitch = M.damp(this.pitch, 0.055, 2.8, dt);
    }
    var groundSpeed = this.airspeed * Math.cos(this.pitch);
    var nx = this.pos.x + cosY * groundSpeed * dt;
    var nz = this.pos.z + sinY * groundSpeed * dt;
    var ny = this.pos.y + climb * dt;

    // building / obstacle collision, horizontal only
    var out = {};
    // The outer map board is for ground movement only. Aircraft retain solid
    // building/prop collisions, but can fly beyond the authored city bounds.
    var hits = this.world.resolveCircle(nx, nz, s.wingspan * 0.48,
      this.pos.y - 1, this.pos.y + 1.6, out, 'boundary');
    if (hits) {
      nx = out.x; nz = out.z;
      var impact = groundSpeed;
      if (impact > 6 && performance.now() - this.lastImpact > 200) {
        this.lastImpact = performance.now();
        this.damage(impact * impact * 0.9);
        this.airspeed *= 0.35;
      }
    }
    var previousY = this.pos.y;
    this.pos.x = nx; this.pos.z = nz; this.pos.y = ny;

    // ground contact: whatever surface is directly below, runway or not
    var srf = this.world.surfaceAt(this.pos.x, this.pos.z, this.pos.y + 3, 5);
    var floor = srf.y + s.gearH;
    var zone = this.world.landingZoneAt(this.pos.x, this.pos.z, 'plane');
    var wasGrounded = this.grounded;
    // Rotation is a real state transition, not just a visual nose-up pose.
    // Give the aircraft a small clearance hop once it has enough airspeed and
    // held back-pressure; otherwise ground contact immediately seats it back
    // onto the runway on every frame of the takeoff roll.
    var rotatingForLiftoff = wasGrounded && piloting && pitchIn < -0.3 &&
      this.pitch > 0.055 && this.airspeed > s.stallSpeed * 0.92 && climb > 0.2;
    if (rotatingForLiftoff && this.pos.y <= floor + 0.42) {
      // Clear the gear by a visible margin. A tiny hop can fall back into the
      // contact band on the next fixed step and make a real rotation look
      // like a failed takeoff.
      this.pos.y = floor + 0.50;
      this.grounded = false;
      this.verticalSpeed = climb;
    } else if (this.pos.y <= floor) {
      var sinkRate = Math.max(0, (previousY - this.pos.y) / Math.max(dt, 0.001));
      // Do not punish a fast, level rollout as if it were a vertical crash.
      // Horizontal energy is handled by the runway roll model; vertical
      // energy is what should decide whether the landing is hard.
      var verticalImpact = Math.max(0, sinkRate - (zone ? 5.5 : 3.5));
      this.pos.y = floor;
      if (!wasGrounded) {
        var hardness = verticalImpact + Math.max(0, Math.abs(this.roll) - 0.30) * 14;
        if (hardness > 0.5) this.damage(hardness * hardness * 2.2);
        this.pitch = zone ? 0.018 : 0;
        this.roll = 0;
      }
      this.grounded = true;
      this.verticalSpeed = 0;
    } else if (this.pos.y > floor + 0.4) {
      this.grounded = false;
      this.verticalSpeed = climb;
    }
    this.altitude = this.pos.y - srf.y;

    if (this.burning > 0) {
      this.burning += dt;
      this.health -= dt * 50;
      if (this.health <= -300) this.exploded = true;
    }
  };

  Plane.prototype.damage = function (amount) {
    if (this.destroyed) return;
    this.health -= amount;
    if (this.health < this.maxHealth * 0.35) this.smoking = true;
    if (this.health <= 0) { this.destroyed = true; this.burning = 0.001; }
  };

  // Pitch (about the rest-frame nose axis, world Z) and roll (about the
  // rest-frame longitudinal axis, world X) are composed before yaw (world Y)
  // is applied outermost - the quaternion equivalent of the parent/child
  // rotation split the car body uses, so yaw always faces the right way
  // without disturbing the pitch/roll relationship.
  Plane.prototype.syncMesh = function () {
    this._applyAttitude();
  };

  Plane.prototype._applyAttitude = function () {
    var q = this._q || (this._q = new THREE.Quaternion());
    var qYaw = this._qy || (this._qy = new THREE.Quaternion());
    var qPitch = this._qp || (this._qp = new THREE.Quaternion());
    var qRoll = this._qr || (this._qr = new THREE.Quaternion());
    // Every controllable craft is authored nose-first along local +X. A
    // -yaw rotation maps that axis directly to physics forward (cos yaw,
    // sin yaw); the old +PI/2 offset made aircraft appear to travel sideways.
    qYaw.setFromAxisAngle(_upY, -this.yaw);
    qPitch.setFromAxisAngle(_axisZ, this.pitch);
    qRoll.setFromAxisAngle(_axisX, this.roll);
    q.copy(qYaw).multiply(qRoll).multiply(qPitch);
    this.group.quaternion.copy(q);
    this.group.position.copy(this.pos);
  };

  Plane.prototype.updateVisual = function (dt, lamps) {
    this.syncMesh();
    var flying = !this.destroyed && this.throttle > 0.05;
    if (this.mesh.propBlades) SB.stepPropRotor(this.mesh, dt, flying);
    this.mesh.portLight.material.emissiveIntensity = this.destroyed ? 0 : lamps * 2.0;
    this.mesh.stbdLight.material.emissiveIntensity = this.destroyed ? 0 : lamps * 2.0;
    var t = performance.now() / 1000;
    this.mesh.strobe.material.emissiveIntensity = this.destroyed ? 0 : (Math.sin(t * 9) > 0.94 ? 3.5 : 0);
    if (this.mesh.landingLight) {
      this.mesh.landingLight.material.emissiveIntensity = this.destroyed ? 0 : (lamps * 1.8 + (flying ? 0.45 : 0.12));
    }
    this.rpm = M.lerp(this.rpm, 800 + this.throttle * Math.max(400, (this.spec.redline - 800) * 0.96), dt * 3);
  };

  // ==================================================== Helicopter class ==
  function Helicopter(key, world, opts) {
    opts = opts || {};
    var s = HELI_SPECS[key];
    this.key = key; this.spec = s; this.world = world; this.name = s.name;
    this.craftType = 'heli';

    this.pos = new THREE.Vector3(0, 0, 0);
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.yawRate = 0; this.vy = 0; this.forwardSpeed = 0; this.strafeSpeed = 0;
    this.verticalSpeed = 0;
    this.grounded = true;
    this.altitude = 0;
    this.rpm = 900; this.skid = 0; this.throttle = 0;
    this.gear = 1; this.reverse = false;
    this.ignoreWorldBounds = true;

    this.health = 320; this.maxHealth = 320;
    this.destroyed = false; this.burning = 0; this.smoking = false; this.exploded = false;
    this.locked = false; this.lastImpact = 0;
    this.driver = null; this.isPlayer = false;

    this.color = opts.color;
    this.mesh = SB.buildHelicopter(opts);
    this.group = this.mesh.group;
  }

  Helicopter.prototype.addToScene = function (scene) { scene.add(this.group); return this; };
  Helicopter.prototype.removeFromScene = function (scene) { scene.remove(this.group); };
  Helicopter.prototype.setColor = function (hex) { this.color = hex; this.mesh.paintMat.color.setHex(hex); };
  Helicopter.prototype.speed = function () { return Math.hypot(this.forwardSpeed, this.strafeSpeed, this.vy); };
  Helicopter.prototype.speedKph = function () { return this.speed() * 3.6; };
  Helicopter.prototype.forward = function (out) { out.x = Math.cos(this.yaw); out.z = Math.sin(this.yaw); out.y = 0; return out; };
  Helicopter.prototype.doorPoint = function (side, out) {
    var cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    var lz = side * (this.spec.cabinW * 0.5 + 0.7);
    out.x = this.pos.x - lz * sinY;
    out.z = this.pos.z + lz * cosY;
    out.y = this.pos.y;
    return out;
  };

  Helicopter.prototype.placeAt = function (x, z, yaw) {
    this.pos.set(x, 0, z);
    this.yaw = yaw || 0; this.pitch = 0; this.roll = 0;
    this.yawRate = this.vy = this.forwardSpeed = this.strafeSpeed = 0;
    this.verticalSpeed = 0;
    this.grounded = true;
    var srf = this.world.surfaceAt(x, z, 50, 60);
    this.pos.y = srf.y + this.spec.gearH;
    this.syncMesh();
    return this;
  };

  // input.flight === true for real piloting; the generic idle placeholder
  // (dead / mid enter-exit) settles the aircraft toward the ground under a
  // gentle auto-descent.
  Helicopter.prototype.step = function (dt, input) {
    var s = this.spec;
    var piloting = !!(input && input.flight) && !this.destroyed;

    var yawIn = piloting ? input.yaw : 0;
    var fwdIn = piloting ? input.pitch : 0;
    var ascend = piloting && input.ascend;
    var descend = piloting && input.descend;

    this.throttle = piloting ? 1 : 0.3;

    var targetVy;
    if (this.destroyed) targetVy = -6;
    else if (ascend) targetVy = s.climbSpeed;
    else if (descend) targetVy = -s.climbSpeed * 0.7;
    else targetVy = 0;
    // Collective control is deliberately strong in open air, then softened
    // close to the deck so the last few metres are a controllable flare. This
    // gives the pilot a real landing sequence instead of a hard snap or a
    // bounce that can never settle.
    var preSrf = this.world.surfaceAt(this.pos.x, this.pos.z, this.pos.y + 8, 8);
    var preZone = this.world.landingZoneAt(this.pos.x, this.pos.z, 'heli');
    var preAlt = this.pos.y - preSrf.y - s.gearH;
    if (!this.grounded && preZone && preAlt > 0 && preAlt < 5.5) {
      targetVy = Math.max(targetVy, -2.0);
      if (!ascend && !descend) targetVy = Math.min(targetVy, 0.8);
    }
    this.vy = M.damp(this.vy, targetVy, 3.2, dt);

    var targetYawRate = piloting ? yawIn * s.maxYawRate : 0;
    this.yawRate = M.damp(this.yawRate, targetYawRate, 4, dt);
    this.yaw = M.wrapAngle(this.yaw + this.yawRate * dt);

    var targetForward = piloting ? fwdIn * s.maxSpeed : 0;
    this.forwardSpeed = M.damp(this.forwardSpeed, targetForward, 2.0, dt);

    this.pitch = M.damp(this.pitch, M.clamp(-this.forwardSpeed / s.maxSpeed, -1, 1) * 0.24, 4, dt);
    this.roll = M.damp(this.roll, M.clamp(-this.yawRate / s.maxYawRate, -1, 1) * 0.20, 4, dt);

    var cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    var nx = this.pos.x + cosY * this.forwardSpeed * dt;
    var nz = this.pos.z + sinY * this.forwardSpeed * dt;
    var ny = this.pos.y + this.vy * dt;

    var out = {};
    // Helicopters share the aircraft free-flight boundary rule.
    var hits = this.world.resolveCircle(nx, nz, s.rotorR * 0.55,
      this.pos.y - 1, this.pos.y + 2, out, 'boundary');
    if (hits) {
      nx = out.x; nz = out.z;
      var impact = Math.abs(this.forwardSpeed);
      if (impact > 5 && performance.now() - this.lastImpact > 200) {
        this.lastImpact = performance.now();
        this.damage(impact * impact * 1.1);
        this.forwardSpeed *= 0.2;
      }
    }
    var previousY = this.pos.y;
    this.pos.x = nx; this.pos.z = nz; this.pos.y = ny;

    var srf = this.world.surfaceAt(this.pos.x, this.pos.z, this.pos.y + 3, 5);
    var floor = srf.y + s.gearH;
    var zone = this.world.landingZoneAt(this.pos.x, this.pos.z, 'heli');
    var wasGrounded = this.grounded;
    if (this.pos.y <= floor) {
      var sinkRate = Math.max(0, (previousY - this.pos.y) / Math.max(dt, 0.001));
      this.pos.y = floor;
      if (!wasGrounded && sinkRate > (zone ? 3.6 : 3.0)) {
        var hard = sinkRate - (zone ? 3.6 : 3.0);
        this.damage(hard * hard * 3.2);
      }
      this.grounded = true;
      this.vy = Math.max(this.vy, 0);
      this.verticalSpeed = 0;
    } else if (this.pos.y > floor + 0.3) {
      this.grounded = false;
      this.verticalSpeed = this.vy;
    }
    this.altitude = this.pos.y - srf.y;

    if (this.burning > 0) {
      this.burning += dt;
      this.health -= dt * 45;
      if (this.health <= -300) this.exploded = true;
    }
  };

  Helicopter.prototype.damage = function (amount) {
    if (this.destroyed) return;
    this.health -= amount;
    if (this.health < this.maxHealth * 0.35) this.smoking = true;
    if (this.health <= 0) { this.destroyed = true; this.burning = 0.001; }
  };

  Helicopter.prototype.syncMesh = function () {
    var qYaw = this._qy || (this._qy = new THREE.Quaternion());
    var qPitch = this._qp || (this._qp = new THREE.Quaternion());
    var qRoll = this._qr || (this._qr = new THREE.Quaternion());
    var q = this._q || (this._q = new THREE.Quaternion());
    // Keep the visible nose on the same local +X axis used by forward() and
    // the movement integrator, so forward flight never looks sideways.
    qYaw.setFromAxisAngle(_upY, -this.yaw);
    qPitch.setFromAxisAngle(_axisZ, this.pitch);
    qRoll.setFromAxisAngle(_axisX, this.roll);
    q.copy(qYaw).multiply(qRoll).multiply(qPitch);
    this.group.quaternion.copy(q);
    this.group.position.copy(this.pos);
  };

  Helicopter.prototype.updateVisual = function (dt, lamps) {
    this.syncMesh();
    var running = !this.destroyed && (this.throttle > 0.05);
    SB.stepHeliRotor(this.mesh, dt, running);
    this.mesh.portLight.material.emissiveIntensity = this.destroyed ? 0 : lamps * 2.2;
    this.mesh.stbdLight.material.emissiveIntensity = this.destroyed ? 0 : lamps * 2.2;
    var t = performance.now() / 1000;
    this.mesh.beacon.material.emissiveIntensity = this.destroyed ? 0 : (Math.sin(t * 3.3) > 0.4 ? 2.5 : 0);
    this.rpm = M.lerp(this.rpm, 1200 + this.throttle * 3600, dt * 4);
  };

  var _upY = new THREE.Vector3(0, 1, 0);
  var _axisX = new THREE.Vector3(1, 0, 0);
  var _axisZ = new THREE.Vector3(0, 0, 1);

  // ============================================================ manager ===
  // No AI: aircraft exist to be found and flown, plus a couple that patrol a
  // lazy fixed circuit purely for atmosphere.
  function Aircraft(game) {
    this.game = game;
    this.planes = [];
    this.helis = [];
    this.ambient = [];
  }
  Aircraft.prototype.spawnPlane = function (key, x, z, yaw, color, stripe) {
    var p = new SB.Plane(key, this.game.world, { color: color, stripe: stripe });
    p.addToScene(this.game.scene);
    p.placeAt(x, z, yaw);
    this.planes.push(p);
    return p;
  };
  Aircraft.prototype.spawnHeli = function (key, x, z, yaw, color) {
    var h = new SB.Helicopter(key, this.game.world, { color: color });
    h.addToScene(this.game.scene);
    h.placeAt(x, z, yaw);
    this.helis.push(h);
    return h;
  };
  // A lazy background plane, high overhead, that loops the map for
  // atmosphere. Never enterable, never collides with anything.
  Aircraft.prototype.spawnAmbientPlane = function (radius, height, speed, phase) {
    this.ambient.push({ radius: radius, height: height, speed: speed, angle: phase || 0, mesh: null });
  };
  Aircraft.prototype.list = function () {
    return this.planes.concat(this.helis);
  };

  // Any craft that goes non-finite (which should never happen, but craft
  // physics runs unattended for a whole play session and one uncaught corner
  // case would otherwise poison that object forever) is force-destroyed here
  // rather than silently propagating NaN into rendering and collision code.
  function sanityCheck(c) {
    if (isFinite(c.pos.x) && isFinite(c.pos.y) && isFinite(c.pos.z) && isFinite(c.yaw)) return true;
    // Land it (rather than leaving it stuck at height) and set it burning: if
    // this is the player's own craft, that guarantees the existing
    // destroyed+burning damage path in flightStep/heliStep runs them through
    // the normal death and respawn flow instead of a permanent soft-lock.
    c.pos.set(0, 1, 0);
    c.yaw = 0;
    c.destroyed = true;
    c.exploded = true;
    c.burning = c.burning || 3;
    return false;
  }

  Aircraft.prototype.fixed = function (dt) {
    var i, c;
    for (i = this.planes.length - 1; i >= 0; i--) {
      c = this.planes[i];
      var wasSane = sanityCheck(c);
      // A craft the player is currently aboard is never removed out from
      // under them - Player.flightStep already reacts to .destroyed - it is
      // only despawned once they are no longer in it.
      if (c.isPlayer) continue;
      if (!wasSane || c.exploded) { this.despawn(c, 'plane', i); continue; }
      if (Math.abs(c.speed()) > 0.05 || !c.grounded) c.step(dt, null); else c.syncMesh();
    }
    for (i = this.helis.length - 1; i >= 0; i--) {
      c = this.helis[i];
      var wasSane2 = sanityCheck(c);
      if (c.isPlayer) continue;
      if (!wasSane2 || c.exploded) { this.despawn(c, 'heli', i); continue; }
      if (c.speed() > 0.05 || !c.grounded) c.step(dt, null); else c.syncMesh();
    }
  };

  // Explode in place (matching how Traffic blows up a car), then drop it from
  // the pool entirely - there is no craft pooling to return it to, and a
  // fixed-size world only ever has a handful of these in play at once.
  Aircraft.prototype.despawn = function (c, kind, index) {
    var g = this.game;
    if (g.fx) g.fx.explosion(c.pos.x, c.pos.y, c.pos.z, kind === 'heli' ? 1.4 : 1.1);
    if (g.audio) g.audio.explosion(c.pos.x, c.pos.y, c.pos.z);
    c.removeFromScene(g.scene);
    if (kind === 'plane') this.planes.splice(index, 1); else this.helis.splice(index, 1);
  };

  Aircraft.prototype.render = function (dt, lamps) {
    var i;
    for (i = 0; i < this.planes.length; i++) if (!this.planes[i].isPlayer) this.planes[i].updateVisual(dt, lamps);
    for (i = 0; i < this.helis.length; i++) if (!this.helis[i].isPlayer) this.helis[i].updateVisual(dt, lamps);

    for (i = 0; i < this.ambient.length; i++) {
      var a = this.ambient[i];
      a.angle += (a.speed / a.radius) * dt;
      if (!a.mesh) {
        a.mesh = SB.buildPlane('skyhawk', { color: 0xd8d8dc, stripe: 0x3f5f8a });
        a.mesh.group.scale.setScalar(1);
        this.game.scene.add(a.mesh.group);
      }
      var x = Math.cos(a.angle) * a.radius, z = Math.sin(a.angle) * a.radius;
      var yaw = a.angle + Math.PI / 2;
      a.mesh.group.position.set(x, a.height, z);
      a.mesh.group.rotation.set(0, -yaw + Math.PI / 2, 0);
      SB.stepPropRotor(a.mesh, dt, true);
    }
  };

  SB.Plane = Plane;
  SB.Helicopter = Helicopter;
  SB.Aircraft = Aircraft;

})(window.SB = window.SB || {});
