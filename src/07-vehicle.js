// 07-vehicle.js - vehicle bodies and the driving model.
//
// The handling is a bicycle model with four raycast wheels bolted on:
// suspension and the ground normal come from the wheels, while grip comes from
// per-axle slip angles fed through a simplified Pacejka curve with load
// transfer. That combination is what makes the cars understeer when you are
// greedy with the throttle and step out when you provoke them.
(function (SB) {
  'use strict';

  var M = SB.M;
  var G = 9.81;

  // ------------------------------------------------------------- specs -----
  // mass kg, power in engine torque Nm, dims in metres.
  var SPECS = SB.VehicleSpecs = {
    sedan: {
      name: 'Vulcan Ridgeline', mass: 1480, len: 4.62, wid: 1.83, wheelbase: 2.72,
      cgFront: 1.28, cgH: 0.54, wheelR: 0.33, track: 1.56,
      torque: 300, redline: 6400, gears: [3.30, 2.05, 1.42, 1.05, 0.84, 0.70], final: 3.65,
      brake: 13500, maxSteer: 0.60, muF: 1.28, muR: 1.30, drag: 0.42, topHint: 52,
      bodyH: 0.80, roofH: 0.74, seats: 4, mass2: 0, cls: 'sedan'
    },
    sports: {
      name: 'Corsaro GT', mass: 1290, len: 4.42, wid: 1.92, wheelbase: 2.60,
      cgFront: 1.42, cgH: 0.42, wheelR: 0.335, track: 1.66,
      torque: 520, redline: 7600, gears: [3.15, 2.10, 1.55, 1.20, 0.98, 0.80], final: 3.90,
      brake: 17500, maxSteer: 0.58, muF: 1.52, muR: 1.50, drag: 0.34, topHint: 74,
      bodyH: 0.66, roofH: 0.56, seats: 2, cls: 'sports', low: true
    },
    muscle: {
      name: 'Redline Brawler', mass: 1690, len: 4.95, wid: 1.95, wheelbase: 2.86,
      cgFront: 1.20, cgH: 0.52, wheelR: 0.35, track: 1.64,
      torque: 610, redline: 6000, gears: [2.95, 1.85, 1.32, 1.00, 0.82], final: 3.55,
      brake: 14000, maxSteer: 0.55, muF: 1.30, muR: 1.16, drag: 0.48, topHint: 66,
      bodyH: 0.78, roofH: 0.66, seats: 2, cls: 'muscle'
    },
    suv: {
      name: 'Sierra Highlander', mass: 2120, len: 4.90, wid: 1.98, wheelbase: 2.90,
      cgFront: 1.36, cgH: 0.74, wheelR: 0.38, track: 1.68,
      torque: 400, redline: 5800, gears: [3.50, 2.20, 1.50, 1.10, 0.88, 0.72], final: 3.80,
      brake: 14500, maxSteer: 0.56, muF: 1.16, muR: 1.18, drag: 0.62, topHint: 50,
      bodyH: 1.02, roofH: 0.92, seats: 5, cls: 'suv', tall: true
    },
    van: {
      name: 'Meridian Courier', mass: 2450, len: 5.35, wid: 2.02, wheelbase: 3.20,
      cgFront: 1.30, cgH: 0.86, wheelR: 0.37, track: 1.70,
      torque: 360, redline: 5000, gears: [3.80, 2.30, 1.55, 1.10, 0.85], final: 4.10,
      brake: 13000, maxSteer: 0.52, muF: 1.06, muR: 1.10, drag: 0.86, topHint: 42,
      bodyH: 1.35, roofH: 1.05, seats: 2, cls: 'van', boxy: true
    },
    taxi: {
      name: 'Bay Cab', mass: 1520, len: 4.70, wid: 1.85, wheelbase: 2.76,
      cgFront: 1.30, cgH: 0.56, wheelR: 0.33, track: 1.58,
      torque: 290, redline: 6000, gears: [3.30, 2.05, 1.42, 1.05, 0.84], final: 3.70,
      brake: 13000, maxSteer: 0.60, muF: 1.24, muR: 1.26, drag: 0.46, topHint: 48,
      bodyH: 0.82, roofH: 0.76, seats: 4, cls: 'taxi', taxiSign: true
    },
    police: {
      name: 'SBPD Interceptor', mass: 1620, len: 4.88, wid: 1.92, wheelbase: 2.84,
      cgFront: 1.34, cgH: 0.50, wheelR: 0.34, track: 1.62,
      torque: 470, redline: 6800, gears: [3.20, 2.05, 1.48, 1.12, 0.90, 0.74], final: 3.75,
      brake: 16500, maxSteer: 0.60, muF: 1.44, muR: 1.44, drag: 0.42, topHint: 68,
      bodyH: 0.80, roofH: 0.72, seats: 4, cls: 'police', police: true
    },
    truck: {
      name: 'Dockside Hauler', mass: 3400, len: 6.20, wid: 2.20, wheelbase: 3.70,
      cgFront: 1.60, cgH: 0.95, wheelR: 0.45, track: 1.86,
      torque: 700, redline: 4200, gears: [4.20, 2.60, 1.70, 1.20, 0.90], final: 4.40,
      brake: 16000, maxSteer: 0.48, muF: 1.02, muR: 1.06, drag: 1.10, topHint: 38,
      bodyH: 1.20, roofH: 1.00, seats: 2, cls: 'truck', boxy: true, flatbed: true
    },
    compact: {
      name: 'Kestrel Mini', mass: 1080, len: 3.85, wid: 1.72, wheelbase: 2.42,
      cgFront: 1.05, cgH: 0.50, wheelR: 0.30, track: 1.48,
      torque: 190, redline: 6600, gears: [3.60, 2.10, 1.45, 1.05, 0.85], final: 3.90,
      brake: 11000, maxSteer: 0.64, muF: 1.22, muR: 1.20, drag: 0.40, topHint: 44,
      bodyH: 0.80, roofH: 0.80, seats: 4, cls: 'compact', boxy: true
    },
    hatchback: {
      name: 'Neon Hatch RS', mass: 1260, len: 4.18, wid: 1.79, wheelbase: 2.58,
      cgFront: 1.20, cgH: 0.50, wheelR: 0.32, track: 1.54,
      torque: 285, redline: 6900, gears: [3.42, 2.12, 1.48, 1.12, 0.90, 0.74], final: 3.88,
      brake: 13800, maxSteer: 0.62, muF: 1.34, muR: 1.30, drag: 0.39, topHint: 58,
      bodyH: 0.76, roofH: 0.74, seats: 5, cls: 'hatchback', low: true, hatch: true,
      ability: 'nitro', abilityLabel: 'NITRO', abilityDuration: 2.8, abilityCooldown: 7
    },
    supercar: {
      name: 'Apex R10', mass: 1420, len: 4.63, wid: 2.02, wheelbase: 2.70,
      cgFront: 1.48, cgH: 0.36, wheelR: 0.34, track: 1.74,
      torque: 760, redline: 8400, gears: [3.05, 2.05, 1.52, 1.18, 0.94, 0.76, 0.62], final: 4.08,
      brake: 21000, maxSteer: 0.54, muF: 1.72, muR: 1.68, drag: 0.29, topHint: 92,
      bodyH: 0.56, roofH: 0.48, seats: 2, cls: 'supercar', low: true, rearWing: true,
      ability: 'nitro', abilityLabel: 'OVERDRIVE', abilityDuration: 3.2, abilityCooldown: 8
    },
    rally: {
      name: 'Gravel Fox Rally', mass: 1380, len: 4.36, wid: 1.84, wheelbase: 2.62,
      cgFront: 1.22, cgH: 0.55, wheelR: 0.36, track: 1.60,
      torque: 430, redline: 7200, gears: [3.40, 2.15, 1.52, 1.16, 0.91, 0.73], final: 4.12,
      brake: 14500, maxSteer: 0.63, muF: 1.38, muR: 1.38, drag: 0.44, topHint: 64,
      bodyH: 0.78, roofH: 0.72, seats: 4, cls: 'rally', low: true, rearWing: true,
      ability: 'nitro', abilityLabel: 'DUST BOOST', abilityDuration: 2.4, abilityCooldown: 6
    },
    pickup: {
      name: 'Ironclad Pickup', mass: 2350, len: 5.55, wid: 2.04, wheelbase: 3.28,
      cgFront: 1.44, cgH: 0.82, wheelR: 0.42, track: 1.76,
      torque: 560, redline: 5600, gears: [3.70, 2.28, 1.55, 1.12, 0.88, 0.70], final: 3.94,
      brake: 15500, maxSteer: 0.53, muF: 1.10, muR: 1.18, drag: 0.72, topHint: 51,
      bodyH: 1.03, roofH: 0.88, seats: 5, cls: 'pickup', tall: true, boxy: true, flatbed: true,
      ability: 'ram', abilityLabel: 'RAM PLATE', abilityDuration: 3.0, abilityCooldown: 8
    },
    armored: {
      name: 'Bastion Armored Unit', mass: 3650, len: 5.30, wid: 2.14, wheelbase: 3.12,
      cgFront: 1.42, cgH: 0.78, wheelR: 0.40, track: 1.82,
      torque: 650, redline: 5200, gears: [3.80, 2.35, 1.60, 1.16, 0.90], final: 4.05,
      brake: 17500, maxSteer: 0.50, muF: 1.18, muR: 1.22, drag: 0.78, topHint: 48,
      bodyH: 1.26, roofH: 0.96, seats: 6, cls: 'armored', tall: true, boxy: true,
      armor: true, ability: 'detonator', abilityLabel: 'IMPACT CHARGE', abilityDuration: 4.0, abilityCooldown: 10
    },
    // Not in TRAFFIC_TYPES: an engine only ever appears because the fire
    // service sent one, or because you took one off the forecourt. It carries
    // no `ability` - the deck gun is held rather than triggered, so the fire
    // module reads the key itself instead of going through the one-shot
    // ability path.
    fire: {
      name: 'SBFD Engine 12', mass: 8600, len: 7.30, wid: 2.42, wheelbase: 4.20,
      cgFront: 1.95, cgH: 1.06, wheelR: 0.52, track: 2.00,
      torque: 1900, redline: 3400, gears: [4.60, 2.80, 1.82, 1.26, 0.94], final: 4.60,
      brake: 30000, maxSteer: 0.46, muF: 1.06, muR: 1.10, drag: 1.24, topHint: 40,
      bodyH: 1.52, roofH: 1.02, seats: 3, cls: 'fire', boxy: true, tall: true,
      emergency: true
    }
  };

  var PAINTS = [
    0xb8bcc2, 0x24262b, 0x8f1f24, 0x1d3f77, 0xd8d4cc, 0x2f5d3a, 0xc47a20,
    0x6d7078, 0x3c3f45, 0xa4a8ad, 0x123a52, 0x7d2233, 0xe0dcd2, 0x455055
  ];

  // ------------------------------------------------------ body geometry ----
  // Cars are lofted from cross-section "stations" down their length. Each
  // station is a rounded rectangle; consecutive stations are skinned with
  // quads. It costs very little and reads far better than stacked boxes.
  // Cross-section lofting now lives in SB.Hull (04-geom.js) so boats and
  // aircraft can share it; keep the short local names the rest of this file
  // already uses.
  var station = SB.Hull.station, ring = SB.Hull.ring;
  var loft = SB.Hull.loft, capRing = SB.Hull.capRing;
  var mergeGroups = SB.Hull.mergeGroups;

  var geoCache = Object.create(null);

  function carGeometry(key) {
    if (geoCache[key]) return geoCache[key];
    var s = SPECS[key];
    var L = s.len, HW = s.wid / 2;
    var paint = new SB.QB(), glass = new SB.QB(), trim = new SB.QB();
    var head = new SB.QB(), tail = new SB.QB(), extra = new SB.QB();

    var groundY = 0;                    // body local origin sits at wheel centre height
    var sillY = s.low ? 0.12 : (s.tall ? 0.24 : 0.16);
    var beltY = sillY + s.bodyH;        // top of the lower body
    var noseDrop = s.boxy ? 0.06 : 0.16;
    var f = L / 2, r = -L / 2;

    // ---- lower body loft, nose (+x) to tail (-x)
    var st = [];
    if (s.boxy) {
      st.push(station(f, HW * 0.90, sillY + 0.06, beltY - 0.02, 0.10));
      st.push(station(f - 0.28, HW * 0.99, sillY, beltY, 0.12));
      st.push(station(f - L * 0.32, HW, sillY, beltY + 0.02, 0.12));
      st.push(station(r + L * 0.30, HW, sillY, beltY + 0.02, 0.12));
      st.push(station(r + 0.24, HW * 0.99, sillY, beltY, 0.12));
      st.push(station(r, HW * 0.92, sillY + 0.05, beltY - 0.02, 0.10));
    } else {
      st.push(station(f, HW * 0.74, sillY + 0.14, beltY - noseDrop, 0.10));
      st.push(station(f - 0.22, HW * 0.92, sillY + 0.04, beltY - noseDrop * 0.55, 0.14));
      st.push(station(f - 0.75, HW * 1.00, sillY - 0.01, beltY - noseDrop * 0.18, 0.16));
      st.push(station(f - L * 0.42, HW * 1.00, sillY - 0.02, beltY, 0.17));
      st.push(station(r + L * 0.36, HW * 1.00, sillY - 0.02, beltY, 0.17));
      st.push(station(r + 0.80, HW * 0.98, sillY - 0.01, beltY - 0.02, 0.16));
      st.push(station(r + 0.26, HW * 0.90, sillY + 0.05, beltY - noseDrop * 0.4, 0.13));
      st.push(station(r, HW * 0.74, sillY + 0.14, beltY - noseDrop * 0.7, 0.10));
    }
    loft(paint, st);

    // ---- greenhouse
    var roofTop = beltY + s.roofH;
    var cabFront = s.cls === 'van' || s.cls === 'truck' ? f - L * 0.30 : f - L * 0.24;
    var cabRear = s.seats <= 2 ? r + L * 0.24 : r + L * 0.13;
    var gs = [];
    if (s.boxy) {
      gs.push(station(cabFront, HW * 0.86, beltY - 0.02, roofTop - 0.04, 0.10));
      gs.push(station(cabFront - 0.18, HW * 0.93, beltY - 0.02, roofTop, 0.12));
      gs.push(station(cabRear + 0.18, HW * 0.93, beltY - 0.02, roofTop, 0.12));
      gs.push(station(cabRear, HW * 0.88, beltY - 0.02, roofTop - 0.03, 0.10));
    } else {
      gs.push(station(cabFront, HW * 0.70, beltY - 0.04, beltY + s.roofH * 0.30, 0.08));
      gs.push(station(cabFront - 0.42, HW * 0.86, beltY - 0.04, roofTop - 0.04, 0.14));
      gs.push(station(cabFront - 0.85, HW * 0.90, beltY - 0.04, roofTop, 0.16));
      gs.push(station(cabRear + 0.55, HW * 0.90, beltY - 0.04, roofTop, 0.16));
      gs.push(station(cabRear + 0.10, HW * 0.84, beltY - 0.04, roofTop - 0.10, 0.14));
      gs.push(station(cabRear, HW * 0.70, beltY - 0.04, beltY + s.roofH * 0.42, 0.08));
    }
    loft(glass, gs);

    // roof panel in body colour, so the greenhouse reads as glass + painted roof
    var rf = s.boxy ? 0.90 : 0.80;
    paint.box(cabRear + L * 0.06, roofTop - 0.03, -HW * rf * 0.86,
      cabFront - L * 0.10, roofTop + 0.015, HW * rf * 0.86, 1, 1, 1, {});

    // ---- wheel arches: dark inner liners so the wheels sit in something
    var wb = s.wheelbase, aF = s.cgFront, aR = wb - aF;
    var axleF = aF + (0), axleR = -aR;
    // NOTE: body origin is at the CG; front axle sits at +cgFront.
    [axleF, axleR].forEach(function (ax) {
      [-1, 1].forEach(function (side) {
        var zc = side * (s.track / 2);
        trim.box(ax - s.wheelR * 1.12, sillY - 0.16, zc - 0.16,
          ax + s.wheelR * 1.12, sillY + s.wheelR * 0.95, zc + 0.16, 1, 1, 1, { skipTop: true, bottom: false });
      });
    });

    // ---- bumpers, sills, grille
    trim.box(f - 0.06, sillY - 0.06, -HW * 0.86, f + 0.03, sillY + 0.30, HW * 0.86, 1, 1, 1, {});
    trim.box(r - 0.03, sillY - 0.06, -HW * 0.86, r + 0.06, sillY + 0.30, HW * 0.86, 1, 1, 1, {});
    trim.box(r + L * 0.22, sillY - 0.12, -HW * 1.01, f - L * 0.22, sillY + 0.06, -HW * 0.90, 1, 1, 1, {});
    trim.box(r + L * 0.22, sillY - 0.12, HW * 0.90, f - L * 0.22, sillY + 0.06, HW * 1.01, 1, 1, 1, {});

    // ---- lamps, set into the bodywork rather than stuck on the front
    var lampY = beltY - noseDrop - 0.06;
    [-1, 1].forEach(function (side) {
      var zc = side * HW * 0.63;
      head.box(f - 0.16, lampY, zc - HW * 0.17, f - 0.015, lampY + 0.14, zc + HW * 0.17, 1, 1, 1, {});
      tail.box(r + 0.015, lampY + 0.05, zc - HW * 0.19, r + 0.16, lampY + 0.19, zc + HW * 0.19, 1, 1, 1, {});
    });
    // grille and rear valance
    trim.box(f - 0.14, lampY - 0.14, -HW * 0.42, f - 0.02, lampY + 0.10, HW * 0.42, 1, 1, 1, {});
    trim.box(r + 0.02, lampY - 0.10, -HW * 0.40, r + 0.14, lampY + 0.10, HW * 0.40, 1, 1, 1, {});

    // ---- per-class extras
    if (s.cls === 'sports') {
      // ducktail spoiler
      paint.box(r + 0.20, beltY + 0.02, -HW * 0.80, r + 0.62, beltY + 0.12, HW * 0.80, 1, 1, 1, {});
    }
    if (s.cls === 'muscle') {
      paint.box(f - L * 0.30, beltY, -HW * 0.30, f - L * 0.10, beltY + 0.10, HW * 0.30, 1, 1, 1, {});  // hood scoop
      trim.box(r + 0.10, beltY + 0.06, -HW * 0.86, r + 0.34, beltY + 0.30, HW * 0.86, 1, 1, 1, {});    // wing
    }
    if (s.hatch) {
      // A short roof spoiler and lower diffuser give the hatch a distinct
      // compact performance silhouette instead of reusing the sedan profile.
      paint.box(r + 0.04, roofTop - 0.03, -HW * 0.76, r + 0.42, roofTop + 0.10, HW * 0.76, 1, 1, 1, {});
      trim.box(r - 0.02, sillY - 0.09, -HW * 0.82, r + 0.26, sillY + 0.06, HW * 0.82, 1, 1, 1, {});
    }
    if (s.rearWing) {
      trim.box(r + 0.10, beltY + 0.03, -HW * 0.78, r + 0.24, beltY + 0.58, -HW * 0.70, 1, 1, 1, {});
      trim.box(r + 0.10, beltY + 0.03, HW * 0.70, r + 0.24, beltY + 0.58, HW * 0.78, 1, 1, 1, {});
      paint.box(r - 0.02, beltY + 0.55, -HW * 0.90, r + 0.38, beltY + 0.67, HW * 0.90, 1, 1, 1, {});
    }
    if (s.armor) {
      // Armored geometry is built from visible plates and corner guards so
      // the heavier handling has a matching visual read at street level.
      trim.box(f - 0.16, sillY + 0.04, -HW * 1.02, f + 0.18, sillY + 0.38, -HW * 0.90, 1, 1, 1, {});
      trim.box(f - 0.16, sillY + 0.04, HW * 0.90, f + 0.18, sillY + 0.38, HW * 1.02, 1, 1, 1, {});
      trim.box(r - 0.16, beltY - 0.02, -HW * 1.02, r + 0.16, beltY + 0.34, -HW * 0.90, 1, 1, 1, {});
      trim.box(r - 0.16, beltY - 0.02, HW * 0.90, r + 0.16, beltY + 0.34, HW * 1.02, 1, 1, 1, {});
    }
    if (s.flatbed) {
      // open cargo bed with side walls
      var bx0 = r + 0.25, bx1 = cabRear - 0.1;
      trim.box(bx0, beltY, -HW * 0.98, bx1, beltY + 0.55, -HW * 0.82, 1, 1, 1, {});
      trim.box(bx0, beltY, HW * 0.82, bx1, beltY + 0.55, HW * 0.98, 1, 1, 1, {});
      trim.box(bx0, beltY, -HW * 0.98, bx0 + 0.16, beltY + 0.55, HW * 0.98, 1, 1, 1, {});
    }
    if (s.taxiSign) {
      extra.box(-0.25, roofTop + 0.015, -0.34, 0.35, roofTop + 0.24, 0.34, 1, 1, 1, {});
    }
    if (s.police) {
      // light bar handled separately so the two halves can flash independently
      trim.box(-0.34, roofTop + 0.01, -HW * 0.62, 0.30, roofTop + 0.07, HW * 0.62, 1, 1, 1, {});
    }
    // mirrors
    [-1, 1].forEach(function (side) {
      var zc = side * (HW + 0.07);
      trim.box(cabFront - 0.34, beltY + 0.04, zc - 0.05, cabFront - 0.14, beltY + 0.18, zc + 0.05, 1, 1, 1, {});
    });

    var merged = mergeGroups([
      { qb: paint, name: 'paint' },
      { qb: glass, name: 'glass' },
      { qb: trim, name: 'trim' },
      { qb: head, name: 'head' },
      { qb: tail, name: 'tail' },
      { qb: extra, name: 'extra' }
    ]);
    merged.beltY = beltY;
    merged.roofTop = roofTop;
    merged.sillY = sillY;
    return (geoCache[key] = merged);
  }

  // Shared wheel geometry: tyre + rim face.
  function wheelGeometry(r, width) {
    var key = 'wheel' + r.toFixed(2) + '_' + width.toFixed(2);
    return SB.geo(key, function () {
      var tyre = new THREE.CylinderGeometry(r, r, width, 18, 1, false);
      tyre.rotateX(Math.PI / 2);
      var rim = new THREE.CylinderGeometry(r * 0.62, r * 0.62, width * 1.02, 12);
      rim.rotateX(Math.PI / 2);
      var geos = [tyre, rim];
      // merge by hand: two groups
      var pos = [], nor = [], uvs = [], idx = [], base = 0;
      var g = new THREE.BufferGeometry();
      var starts = [];
      for (var gi = 0; gi < geos.length; gi++) {
        var src = geos[gi].toNonIndexed();
        var sp = src.attributes.position.array, sn = src.attributes.normal.array;
        var su = src.attributes.uv ? src.attributes.uv.array : null;
        starts.push({ start: idx.length, count: sp.length / 3 });
        for (var i = 0; i < sp.length; i++) pos.push(sp[i]);
        for (i = 0; i < sn.length; i++) nor.push(sn[i]);
        for (i = 0; i < sp.length / 3; i++) {
          uvs.push(su ? su[i * 2] : 0, su ? su[i * 2 + 1] : 0);
          idx.push(base + i);
        }
        base += sp.length / 3;
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      g.addGroup(starts[0].start, starts[0].count, 0);
      g.addGroup(starts[1].start, starts[1].count, 1);
      g.computeBoundingSphere();
      return g;
    });
  }

  var sharedMats = null;
  function materials() {
    if (sharedMats) return sharedMats;
    sharedMats = {
      // Tagged so a damaged car can find and clone its own glass without
      // having to know which material slot index it landed in.
      glass: Object.assign(
        new THREE.MeshStandardMaterial({ color: 0x1c2530, roughness: 0.04, metalness: 0.92 }),
        { userData: { glass: true } }),
      trim: new THREE.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.62, metalness: 0.35 }),
      tyre: new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.95 }),
      rim: new THREE.MeshStandardMaterial({ color: 0xb6bcc4, roughness: 0.28, metalness: 0.85 }),
      extra: new THREE.MeshStandardMaterial({ color: 0xf0c33a, roughness: 0.5, emissive: 0x201800 })
    };
    return sharedMats;
  }

  // ------------------------------------------------------------ Vehicle ----
  function Vehicle(key, world, opts) {
    opts = opts || {};
    var s = SPECS[key];
    this.key = key;
    this.spec = s;
    this.world = world;
    this.name = s.name;
    this.craftType = 'car';

    // state
    this.pos = new THREE.Vector3(0, s.wheelR, 0);
    this.yaw = 0;
    this.u = 0;          // longitudinal velocity, body frame (m/s)
    this.v = 0;          // lateral velocity, body frame
    this.vy = 0;         // vertical velocity
    this.yawRate = 0;
    this.pitch = 0; this.roll = 0;
    this.grounded = true;
    this.airTime = 0;

    // drivetrain
    this.gear = 1;
    this.rpm = 900;
    this.shiftTimer = 0;
    this.throttle = 0; this.brake = 0; this.steer = 0; this.handbrake = 0;
    this.reverse = false;
    this.engineOn = true;

    // condition
    this.health = 1000;
    this.maxHealth = 1000;
    this.destroyed = false;
    this.burning = 0;
    this.slipF = 0; this.slipR = 0; this.skid = 0;
    this.lastImpact = 0;
    this.odo = 0;

    this.color = opts.color !== undefined ? opts.color : PAINTS[Math.floor(Math.random() * PAINTS.length)];
    this.isPolice = !!s.police;
    this.sirenOn = false;
    this.locked = false;
    this.ability = s.ability || null;
    this.abilityLabel = s.abilityLabel || '';
    this.abilityT = 0;
    this.abilityCooldown = 0;
    this.ramActive = false;

    this.buildMesh(opts);

    // derived physics constants
    this.aF = s.cgFront;
    this.aR = s.wheelbase - s.cgFront;
    this.Izz = s.mass * (s.len * s.len + s.wid * s.wid) / 12 * 0.85;
    this.wheelR = s.wheelR;
    this.maxGear = s.gears.length;

    // wheel contact scratch
    this.wheels = [
      { x: this.aF, z: -s.track / 2, comp: 0.5, groundY: 0, contact: true, steerable: true, surfKind: 'asphalt' },
      { x: this.aF, z: s.track / 2, comp: 0.5, groundY: 0, contact: true, steerable: true, surfKind: 'asphalt' },
      { x: -this.aR, z: -s.track / 2, comp: 0.5, groundY: 0, contact: true, steerable: false, surfKind: 'asphalt' },
      { x: -this.aR, z: s.track / 2, comp: 0.5, groundY: 0, contact: true, steerable: false, surfKind: 'asphalt' }
    ];
    this.rideHeight = s.wheelR;
    this.springLen = 0.30;
  }

  Vehicle.prototype.buildMesh = function (opts) {
    var s = this.spec;
    var mats = materials();
    var cg = carGeometry(this.key);
    this.paintMat = SB.finishMaterial({
      color: this.color, roughness: 0.19, metalness: 0.62,
      clearcoat: 0.72, clearcoatRoughness: 0.14, reflectivity: 0.78
    });
    this.headMat = new THREE.MeshStandardMaterial({
      color: 0xd6dbe0, emissive: 0xfff0d0, emissiveIntensity: 0.0,
      roughness: 0.12, metalness: 0.5
    });
    this.tailMat = new THREE.MeshStandardMaterial({
      color: 0x6a1216, emissive: 0xff2a18, emissiveIntensity: 0.0, roughness: 0.3
    });
    var slotMats = [];
    for (var i = 0; i < cg.slots.length; i++) {
      var n = cg.slots[i];
      slotMats.push(
        n === 'paint' ? this.paintMat :
          n === 'glass' ? mats.glass :
            n === 'trim' ? mats.trim :
              n === 'head' ? this.headMat :
                n === 'tail' ? this.tailMat : mats.extra);
    }

    this.group = new THREE.Group();
    // Kept so a damaged car can hand back its private clone and go back to
    // sharing the class geometry when it is recycled.
    this._sharedGeo = cg.geometry;
    this._sharedMats = slotMats.slice(0);
    this.body = new THREE.Mesh(cg.geometry, slotMats);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.group.add(this.body);
    this.beltY = cg.beltY;
    this.roofTop = cg.roofTop;

    // wheels
    var wg = wheelGeometry(s.wheelR, s.wid * 0.13 + 0.10);
    this.wheelMeshes = [];
    for (i = 0; i < 4; i++) {
      var w = new THREE.Mesh(wg, [mats.tyre, mats.rim]);
      w.castShadow = true;
      this.group.add(w);
      this.wheelMeshes.push(w);
    }

    // Close-up mechanical detail: brake discs, calipers, exhaust tips and a
    // narrow beltline highlight sell the car as a manufactured object rather
    // than a single coloured shell. These are shared low-poly parts, so the
    // traffic budget remains predictable.
    var detail = new THREE.Group();
    detail.name = 'vehicle-mechanical-details';
    var discMat = new THREE.MeshStandardMaterial({ color: 0x5f666c, roughness: 0.30, metalness: 0.88 });
    var caliperMat = new THREE.MeshStandardMaterial({ color: s.armor ? 0xd2a23a : 0x9c2028, roughness: 0.35, metalness: 0.62 });
    for (var axle = 0; axle < 2; axle++) {
      var axleX = axle === 0 ? this.spec.cgFront : -(this.spec.wheelbase - this.spec.cgFront);
      for (var wheelSide = -1; wheelSide <= 1; wheelSide += 2) {
        var disc = new THREE.Mesh(new THREE.CylinderGeometry(s.wheelR * 0.55, s.wheelR * 0.55, 0.035, 14), discMat);
        disc.rotation.x = Math.PI / 2;
        disc.position.set(axleX, 0, wheelSide * (s.track / 2 + 0.012));
        detail.add(disc);
        var caliper = new THREE.Mesh(new THREE.BoxGeometry(s.wheelR * 0.16, s.wheelR * 0.42, 0.06), caliperMat);
        caliper.position.set(axleX + s.wheelR * 0.18, 0.02, wheelSide * (s.track / 2 + 0.035));
        detail.add(caliper);
      }
    }
    var exhaustMat = new THREE.MeshStandardMaterial({ color: 0x949ba0, roughness: 0.24, metalness: 0.92 });
    for (var ex = -1; ex <= 1; ex += 2) {
      var tip = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.22, 10), exhaustMat);
      tip.rotation.z = Math.PI / 2;
      tip.position.set(-s.len * 0.53, s.sillY ? s.sillY : 0.13, ex * s.wid * 0.30);
      detail.add(tip);
    }
    var beltMat = new THREE.MeshStandardMaterial({ color: 0x777f86, roughness: 0.22, metalness: 0.72 });
    var belt = new THREE.Mesh(new THREE.BoxGeometry(s.len * 0.60, 0.018, 0.018), beltMat);
    belt.position.set(-s.len * 0.02, cg.beltY - 0.03, s.wid * 0.505);
    detail.add(belt);
    var belt2 = belt.clone(); belt2.position.z = -s.wid * 0.505; detail.add(belt2);
    this.group.add(detail);

    this.abilityCore = null;
    if (s.ability) {
      var abilityMat = new THREE.MeshStandardMaterial({
        color: s.ability === 'detonator' ? 0xb32f2f : (s.ability === 'ram' ? 0xd29a32 : 0x2ad6df),
        emissive: s.ability === 'detonator' ? 0xff2a18 : (s.ability === 'ram' ? 0xffaa20 : 0x29eaff),
        emissiveIntensity: 0.35, roughness: 0.24, metalness: 0.68
      });
      this.abilityCore = new THREE.Mesh(new THREE.SphereGeometry(0.10, 10, 8), abilityMat);
      this.abilityCore.position.set(s.len * 0.25, cg.beltY + 0.08, 0);
      this.group.add(this.abilityCore);
    }

    // police light bar
    if (this.isPolice) {
      var barGeo = new THREE.BoxGeometry(0.30, 0.10, 0.34);
      this.lightRed = new THREE.Mesh(barGeo, new THREE.MeshStandardMaterial({
        color: 0x400008, emissive: 0xff0018, emissiveIntensity: 0
      }));
      this.lightBlue = new THREE.Mesh(barGeo, new THREE.MeshStandardMaterial({
        color: 0x000c40, emissive: 0x1840ff, emissiveIntensity: 0
      }));
      this.lightRed.position.set(-0.02, cg.roofTop + 0.10, -s.wid * 0.24);
      this.lightBlue.position.set(-0.02, cg.roofTop + 0.10, s.wid * 0.24);
      this.group.add(this.lightRed, this.lightBlue);
    }

    // cheap contact shadow that works even where the sun shadow map does not
    var shadowMat = new THREE.MeshBasicMaterial({
      map: SB.Tex.blob(), transparent: true, opacity: 0.42, depthWrite: false,
      color: 0x000000, blending: THREE.NormalBlending
    });
    var sg = new THREE.PlaneGeometry(s.len * 1.25, s.wid * 1.7);
    sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, shadowMat);
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);

    // headlight beam pools, faded in at night
    this.beam = null;
    if (!opts || !opts.noBeam) {
      var bg = new THREE.PlaneGeometry(16, 9);
      bg.rotateX(-Math.PI / 2);
      bg.translate(9.5, 0, 0);
      this.beam = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({
        map: SB.Tex.blob(), color: 0xfff0cc, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      this.beam.renderOrder = 2;
      this.group.add(this.beam);
    }
  };

  Vehicle.prototype.addToScene = function (scene) { scene.add(this.group); return this; };
  Vehicle.prototype.removeFromScene = function (scene) { scene.remove(this.group); };

  Vehicle.prototype.setColor = function (hex) {
    this.color = hex;
    this.paintMat.color.setHex(hex);
  };

  Vehicle.prototype.placeAt = function (x, z, yaw) {
    this.pos.set(x, this.spec.wheelR + 0.02, z);
    this.yaw = yaw || 0;
    this.u = this.v = this.vy = this.yawRate = 0;
    var srf = this.world.surfaceAt(x, z, 50, 60);
    this.pos.y = srf.y + this.spec.wheelR + 0.02;
    this.syncMesh();
    return this;
  };

  Vehicle.prototype.speed = function () { return Math.hypot(this.u, this.v); };
  Vehicle.prototype.speedKph = function () { return this.speed() * 3.6; };

  Vehicle.prototype.activateAbility = function () {
    var s = this.spec;
    if (!this.ability || this.destroyed || this.abilityCooldown > 0) return false;
    this.abilityT = s.abilityDuration || 2.5;
    this.abilityCooldown = s.abilityCooldown || 7;
    this.ramActive = this.ability === 'ram' || this.ability === 'detonator';
    return true;
  };

  // Keep numerical blow-ups and collision impulses from turning a car into a
  // permanently accelerating pinwheel. The cap is deliberately just above
  // each vehicle's authored top speed so downhill momentum still feels real.
  Vehicle.prototype.limitDynamics = function () {
    var abilitySpeed = this.abilityT > 0 && this.ability === 'nitro' ? 1.24 : 1;
    var maxSpeed = Math.max(8, (this.spec.topHint || 50) * 1.08 * abilitySpeed);
    if (!Number.isFinite(this.u)) this.u = 0;
    if (!Number.isFinite(this.v)) this.v = 0;
    if (!Number.isFinite(this.yawRate)) this.yawRate = 0;
    var mag = Math.hypot(this.u, this.v);
    if (mag > maxSpeed) {
      var k = maxSpeed / mag;
      this.u *= k; this.v *= k;
    }
    // A collision or a fully loaded tire model can briefly inject more yaw
    // than a car can physically sustain. Keep normal low-speed rotation
    // unchanged, but progressively limit rotational energy at speed so one
    // bad frame cannot become an endless pinwheel.
    var speed = Math.abs(this.u);
    var highSpeed = speed > 14
      ? M.clamp((speed - 14) / 24, 0, 1) : 0;
    var yawCap = M.lerp(3.8, 1.20, highSpeed);
    this.yawRate = M.clamp(this.yawRate, -yawCap, yawCap);
  };

  // Engine torque curve, normalised then scaled by the spec's peak torque.
  Vehicle.prototype.torqueAt = function (rpm) {
    var s = this.spec;
    var t = M.clamp(rpm / s.redline, 0, 1.15);
    // rises fast off idle, plateaus, falls past the power peak
    var curve = t < 0.18 ? M.lerp(0.42, 0.86, t / 0.18)
      : t < 0.62 ? M.lerp(0.86, 1.0, (t - 0.18) / 0.44)
        : t < 0.90 ? M.lerp(1.0, 0.92, (t - 0.62) / 0.28)
          : M.lerp(0.92, 0.52, M.clamp((t - 0.90) / 0.25, 0, 1));
    return s.torque * curve;
  };

  // Simplified Pacejka lateral force: peak near ~7 degrees of slip then decays.
  function tireForce(slip, load, mu) {
    var B = 9.2, C = 1.55, E = 0.96;
    var bs = B * slip;
    var y = C * Math.atan(bs - E * (bs - Math.atan(bs)));
    return -Math.sin(y) * load * mu;
  }

  var _srf = null;
  var _res = { x: 0, z: 0, nx: 0, nz: 0, hits: 0, pen: 0, hitBox: null };

  Vehicle.prototype.step = function (dt, input) {
    var s = this.spec;
    if (input) {
      this.throttle = Number.isFinite(input.throttle) ? M.clamp(input.throttle, 0, 1) : 0;
      this.brake = Number.isFinite(input.brake) ? M.clamp(input.brake, 0, 1) : 0;
      this.handbrake = Number.isFinite(input.handbrake) ? M.clamp(input.handbrake, 0, 1) : 0;
      this.steerTarget = Number.isFinite(input.steer) ? M.clamp(input.steer, -1, 1) : 0;
      if (input.abilityHit) this.activateAbility();
    }
    if (this.abilityCooldown > 0) this.abilityCooldown = Math.max(0, this.abilityCooldown - dt);
    if (this.abilityT > 0) {
      this.abilityT = Math.max(0, this.abilityT - dt);
      if (this.abilityT <= 0) this.ramActive = false;
    }
    this.limitDynamics();
    if (this.destroyed) { this.throttle = 0; this.brake = 1; }

    var speed = Math.abs(this.u);

    // ---- steering: slower and reduced at speed, like a real rack
    var maxSteer = s.maxSteer * (0.30 + 0.70 / (1 + speed * speed / 380));
    var steerRate = 3.6 + 4.0 / (1 + speed * 0.12);
    var want = M.clamp(this.steerTarget || 0, -1, 1) * maxSteer;
    this.steer = M.approach(this.steer, want, steerRate * dt);
    this.steer = M.clamp(this.steer, -maxSteer, maxSteer);

    // ---- wheels: raycast for suspension and the supporting surface
    var cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    var groundCount = 0, avgY = 0, avgNX = 0, avgNZ = 0;
    var wheelYs = [0, 0, 0, 0];
    for (var i = 0; i < 4; i++) {
      var w = this.wheels[i];
      var wx = this.pos.x + w.x * cosY - w.z * sinY;
      var wz = this.pos.z + w.x * sinY + w.z * cosY;
      var srf = this.world.surfaceAt(wx, wz, this.pos.y + 0.6, 1.4);
      wheelYs[i] = srf.y;
      w.groundY = srf.y;
      w.surfKind = srf.kind;
      var target = srf.y + s.wheelR;
      var delta = target - this.pos.y;
      w.contact = delta > -this.springLen;
      if (w.contact) {
        groundCount++;
        avgY += srf.y;
        avgNX += srf.nx; avgNZ += srf.nz;
      }
      w.comp = M.clamp(delta / this.springLen + 0.5, 0, 1);
    }
    this.grounded = groundCount > 0;
    if (this.grounded) { avgY /= groundCount; avgNX /= groundCount; avgNZ /= groundCount; }

    // ---- vertical: spring toward the supporting height, gravity when free
    if (this.grounded) {
      var restY = avgY + s.wheelR;
      var dy = restY - this.pos.y;
      // critically damped spring so it settles fast without bouncing
      var k = 260, c = 26;
      this.vy += (dy * k - this.vy * c) * dt;
      this.vy = M.clamp(this.vy, -30, 30);
      this.airTime = 0;
      if (dy > 0.02 && this.vy < 0) this.vy = 0;
    } else {
      this.vy -= G * dt;
      this.airTime += dt;
    }
    this.pos.y += this.vy * dt;

    // Never sink through the highest wheel contact.
    var highest = Math.max(wheelYs[0], wheelYs[1], wheelYs[2], wheelYs[3]);
    if (this.pos.y < highest + s.wheelR - 0.02) {
      this.pos.y = highest + s.wheelR - 0.02;
      if (this.vy < 0) {
        // landing: convert some vertical energy into a chassis jolt
        if (this.vy < -7) this.onLand(-this.vy);
        this.vy *= -0.12;
      }
    }

    // ---- drivetrain
    var driveForce = 0;
    var wheelOmega = this.u / s.wheelR;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;

    if (this.reverse) {
      this.rpm = M.clamp(Math.abs(wheelOmega) * 3.2 * s.final * 9.5493, 800, s.redline * 0.7);
      driveForce = -this.throttle * this.torqueAt(this.rpm) * 3.2 * s.final * 0.85 / s.wheelR;
    } else {
      var gr = s.gears[this.gear - 1];
      this.rpm = M.clamp(wheelOmega * gr * s.final * 9.5493, 850, s.redline * 1.05);
      if (this.shiftTimer <= 0) {
        if (this.rpm > s.redline * 0.94 && this.gear < this.maxGear) { this.gear++; this.shiftTimer = 0.22; this.shifted = true; }
        else if (this.rpm < s.redline * 0.34 && this.gear > 1) { this.gear--; this.shiftTimer = 0.18; }
      }
      var thr = this.shiftTimer > 0 ? this.throttle * 0.15 : this.throttle;
      if (this.destroyed || !this.engineOn) thr = 0;
      var abilityMul = this.abilityT > 0 && this.ability === 'nitro' ? 1.82 : 1;
      driveForce = thr * this.torqueAt(this.rpm) * gr * s.final * 0.86 * abilityMul / s.wheelR;
      // launch help: without this a stopped car in first is torque-starved
      if (speed < 3) driveForce *= M.lerp(1.55, 1.0, speed / 3);
    }

    // ---- braking
    var brakeForce = 0;
    if (this.brake > 0) {
      brakeForce = this.brake * s.brake;
      if (Math.abs(this.u) < 0.6) brakeForce = 0;
    }

    // ---- load transfer
    var W = s.mass * G;
    var staticF = W * this.aR / s.wheelbase;
    var staticR = W * this.aF / s.wheelbase;
    var longAcc = this._lastAx || 0;
    var transfer = s.mass * longAcc * s.cgH / s.wheelbase;
    var Fzf = Math.max(120, staticF - transfer);
    var Fzr = Math.max(120, staticR + transfer);
    if (!this.grounded) { Fzf = Fzr = 0; }

    // ---- slip angles
    var uSafe = Math.max(Math.abs(this.u), 1.2) * M.sign(this.u || 1);
    var slipF = Math.atan((this.v + this.yawRate * this.aF) / Math.abs(uSafe)) - this.steer * M.sign(uSafe);
    var slipR = Math.atan((this.v - this.yawRate * this.aR) / Math.abs(uSafe));
    this.slipF = slipF; this.slipR = slipR;

    var muF = s.muF, muR = s.muR;
    var snowRollExtra = 0;
    var surfMu = 1.0;
    if (this.wheels[0].surfKind === 'grass' || this.wheels[0].surfKind === 'sand') surfMu = 0.62;
    if (this.world.wetness) surfMu *= M.lerp(1, 0.80, this.world.wetness);
    var snowWheels = 0;
    for (var swi = 0; swi < this.wheels.length; swi++) {
      if (this.wheels[swi].surfKind === 'snow') snowWheels++;
    }
    var snowGrip = snowWheels / this.wheels.length;
    if (snowGrip > 0) {
      // Fresh snow has a soft, low-friction contact patch. Momentum survives,
      // but acceleration and cornering fall away until the driver claws out.
      surfMu *= M.lerp(1, 0.43, snowGrip);
      var snowDepth = this.world.snowDepthAt(this.pos.x, this.pos.z);
      var snowDrag = M.clamp(snowDepth * 4.5, 0, 0.78) * snowGrip;
      driveForce *= 1 - snowDrag;
      snowRollExtra = (18 + snowDepth * 34) * snowGrip;
      if (snowDepth > 0.16 && Math.abs(this.u) < 4.0 && this.throttle > 0.2) {
        // A buried axle repeatedly loads and unloads instead of launching.
        driveForce *= 0.28;
        this.stuckT = (this.stuckT || 0) + dt;
      } else {
        this.stuckT = Math.max(0, (this.stuckT || 0) - dt * 0.5);
      }
    } else {
      this.stuckT = Math.max(0, (this.stuckT || 0) - dt);
    }
    muF *= surfMu; muR *= surfMu;
    if (this.handbrake > 0.1) muR *= M.lerp(1, 0.42, this.handbrake);

    var Fyf = tireForce(slipF, Fzf, muF);
    var Fyr = tireForce(slipR, Fzr, muR);

    // ---- longitudinal forces with a friction circle on the rear axle
    var Fx = driveForce - brakeForce * M.sign(this.u) - this.handbrake * 9000 * M.sign(this.u);
    var maxRearLong = Fzr * muR;
    var used = Math.abs(Fyr) / Math.max(1, maxRearLong);
    var avail = Math.sqrt(Math.max(0, 1 - used * used)) * maxRearLong;
    if (Math.abs(Fx) > avail * 1.9) Fx = M.sign(Fx) * avail * 1.9;

    // drag and rolling resistance
    var drag = -s.drag * 0.5 * 1.2 * this.u * Math.abs(this.u);
    var roll = -this.u * 9.0;
    if (snowRollExtra > 0) roll -= this.u * snowRollExtra;
    if (!this.grounded) { Fx = 0; Fyf = 0; Fyr = 0; roll = 0; }

    // ---- slope: gravity pulls you back down a ramp
    var slopeFx = 0;
    if (this.grounded) {
      slopeFx = -(avgNX * cosY + avgNZ * sinY) * s.mass * G * 1.6;
    }

    var Fxt = Fx + drag + roll + slopeFx;
    var Fyt = Fyf * Math.cos(this.steer) + Fyr;

    var ax = Fxt / s.mass + this.v * this.yawRate;
    var ay = Fyt / s.mass - this.u * this.yawRate;
    this._lastAx = ax;

    this.u += ax * dt;
    this.v += ay * dt;
    this.limitDynamics();

    var torque = this.aF * Fyf * Math.cos(this.steer) - this.aR * Fyr;
    this.yawRate += (torque / this.Izz) * dt;
    // yaw damping keeps low-speed spins from feeling like ice
    this.yawRate *= Math.exp(-dt * (this.grounded ? 1.05 : 0.45));

    // High-speed cornering should settle into a controlled turn instead of
    // amplifying lateral velocity until the car spins repeatedly. This guard
    // is deliberately inactive for handbrake drifts and at ordinary speeds,
    // preserving the existing steering feel everywhere else.
    var currentSpeed = Math.abs(this.u);
    if (this.grounded && !this.handbrake && currentSpeed > 18) {
      var lateralRatio = Math.abs(this.v) / Math.max(currentSpeed, 1);
      var slideRisk = M.clamp((lateralRatio - 0.22) / 0.38, 0, 1);
      if (slideRisk > 0) {
        var kinematicYaw = (this.u / Math.max(s.wheelbase, 0.1)) * Math.tan(this.steer) * 0.72;
        var recoveryRate = 2.8 + slideRisk * 5.2;
        this.yawRate = M.damp(this.yawRate, kinematicYaw, recoveryRate, dt);
        this.v = M.damp(this.v, this.steer * this.u * 0.10, 2.5 + slideRisk * 5.0, dt);
      }
    }
    this.limitDynamics();

    if (Math.abs(this.u) < 0.06 && this.throttle < 0.02 && this.brake > 0) { this.u = 0; }
    if (Math.abs(this.v) < 0.02) this.v = 0;

    // ---- integrate position in world space
    this.yaw = M.wrapAngle(this.yaw + this.yawRate * dt);
    cosY = Math.cos(this.yaw); sinY = Math.sin(this.yaw);
    var vx = this.u * cosY - this.v * sinY;
    var vz = this.u * sinY + this.v * cosY;
    this.pos.x += vx * dt;
    this.pos.z += vz * dt;
    this.odo += Math.abs(this.u) * dt;

    // ---- collide with the world using two body circles
    this.collideWorld(vx, vz, dt);
    this.limitDynamics();

    // ---- chassis attitude from suspension compression
    var compF = (this.wheels[0].comp + this.wheels[1].comp) / 2;
    var compR = (this.wheels[2].comp + this.wheels[3].comp) / 2;
    var compL = (this.wheels[0].comp + this.wheels[2].comp) / 2;
    var compRt = (this.wheels[1].comp + this.wheels[3].comp) / 2;
    var targetPitch = M.clamp((compF - compR) * 0.55 + this._lastAx * 0.010, -0.16, 0.16);
    var targetRoll = M.clamp((compRt - compL) * 0.5 + (ay) * 0.014, -0.20, 0.20);
    if (!this.grounded) {
      targetPitch = M.clamp(-this.vy * 0.012, -0.25, 0.25);
    }
    this.pitch = M.damp(this.pitch, targetPitch, 9, dt);
    this.roll = M.damp(this.roll, targetRoll, 9, dt);

    // ---- skid metric drives tyre marks, smoke and sound
    var slipAmt = Math.max(Math.abs(slipF), Math.abs(slipR));
    var wheelSpin = 0;
    if (this.grounded && Math.abs(driveForce) > 0.1) {
      wheelSpin = M.clamp((Math.abs(Fx) / Math.max(1, avail)) - 0.85, 0, 1);
    }
    var target = 0;
    if (this.grounded && speed > 2.5) {
      target = M.clamp((slipAmt - 0.16) * 3.2, 0, 1) + wheelSpin * 0.8 + this.handbrake * 0.5;
      if (this.brake > 0.7 && speed > 8) target += 0.35;
    }
    this.skid = M.damp(this.skid, M.clamp(target, 0, 1), 14, dt);

    if (this.burning > 0) {
      this.burning += dt;
      this.health -= dt * 55;
      if (this.health <= -400) this.exploded = true;
    }
    return this;
  };

  Vehicle.prototype.onLand = function (impactSpeed) {
    this.damage(impactSpeed * 6, 'land');
    if (this.onLandCb) this.onLandCb(impactSpeed);
  };

  Vehicle.prototype.collideWorld = function (vx, vz, dt) {
    var s = this.spec;
    var cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    var r = s.wid * 0.52;
    var offs = [s.len * 0.29, -s.len * 0.29];
    var totalHits = 0, nx = 0, nz = 0, deepest = 0;
    for (var i = 0; i < offs.length; i++) {
      var px = this.pos.x + cosY * offs[i];
      var pz = this.pos.z + sinY * offs[i];
      var hits = this.world.resolveCircle(px, pz, r, this.pos.y - 0.3, this.pos.y + s.bodyH + 0.5, _res);
      if (hits) {
        var dx = _res.x - px, dz = _res.z - pz;
        this.pos.x += dx; this.pos.z += dz;
        nx += _res.nx; nz += _res.nz;
        totalHits += hits;
        if (_res.pen > deepest) deepest = _res.pen;
        // hitting near one end also rotates the car, which is what makes
        // clipping a wall feel like clipping a wall
        var lever = offs[i] > 0 ? 1 : -1;
        var side = (-_res.nx * sinY + _res.nz * cosY);
        this.yawRate += -side * lever * Math.min(_res.pen, 0.5) * 6.0;
      }
    }
    if (totalHits) {
      var l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      var vn = vx * nx + vz * nz;
      if (vn < 0) {
        var e = 0.22;
        var nvx = vx - (1 + e) * vn * nx;
        var nvz = vz - (1 + e) * vn * nz;
        // convert back to body frame with a chunk of energy lost
        this.u = (nvx * cosY + nvz * sinY) * 0.72;
        this.v = (-nvx * sinY + nvz * cosY) * 0.72;
        var impact = -vn;
        if (impact > 3 && performance.now() - this.lastImpact > 120) {
          this.lastImpact = performance.now();
          // Dent the panel that actually touched: the contact normal points
          // away from the obstacle, so step back along it from the centre.
          this.damage(impact * impact * 1.1, 'world', nx, nz,
            this.pos.x - nx * this.spec.len * 0.36,
            this.pos.y + 0.32,
            this.pos.z - nz * this.spec.len * 0.36);
        }
      }
      this.yawRate *= 0.55;
      this.yawRate = M.clamp(this.yawRate, -3.8, 3.8);
    }
    this.contactNormal = totalHits ? { x: nx, z: nz } : null;
    return totalHits;
  };

  // ------------------------------------------------------ visual damage ----
  // Cars tracked health and burned, but never actually looked hit. These
  // deform the body where it was struck.
  //
  // carGeometry() is cached per vehicle CLASS, so denting it directly would
  // dent every sedan in the city at once. The geometry is therefore cloned
  // the first time a given car is damaged and not before: most cars in a
  // session are never touched, and paying a clone for all of them up front
  // would cost far more than the effect is worth.
  var MAX_DENTS = 14;

  Vehicle.prototype.ownBodyGeometry = function () {
    if (this._ownGeo) return this.body.geometry;
    var src = this.body.geometry;
    var clone = src.clone();
    this.body.geometry = clone;
    this._ownGeo = true;
    // Keep the pristine positions so the panel can be beaten back out when
    // the car is repaired, rather than accumulating forever.
    this._pristine = new Float32Array(clone.attributes.position.array);
    this._dents = 0;
    return clone;
  };

  // Push the panel in around a world-space impact. `strength` is metres of
  // maximum displacement at the centre of the dent.
  Vehicle.prototype.dentAt = function (wx, wy, wz, strength) {
    if (!(strength > 0.004) || this.exploded) return;
    if (this._dents >= MAX_DENTS) return;
    var geo = this.ownBodyGeometry();
    var pos = geo.attributes.position;
    var arr = pos.array;

    // World -> body local. The body is yawed by -yaw about its own origin and
    // the group carries the position, so undo both.
    var dx = wx - this.pos.x, dy = wy - this.pos.y, dz = wz - this.pos.z;
    var ca = Math.cos(this.yaw), sa = Math.sin(this.yaw);
    var lx = dx * ca + dz * sa;
    var lz = -dx * sa + dz * ca;
    var ly = dy;

    var radius = M.clamp(0.52 + strength * 2.6, 0.52, 1.7);
    var r2 = radius * radius;
    var moved = 0;
    for (var i = 0; i < arr.length; i += 3) {
      var vx = arr[i], vy = arr[i + 1], vz = arr[i + 2];
      var ex = vx - lx, ey = vy - ly, ez = vz - lz;
      var d2 = ex * ex + ey * ey + ez * ez;
      if (d2 > r2) continue;
      var fall = 1 - Math.sqrt(d2) / radius;
      fall = fall * fall * (3 - 2 * fall);           // smoothstep
      var push = strength * fall;
      // Pull the surface toward the impact centre: that reads as a dent
      // rather than as a lump pushed straight through the panel.
      var len = Math.sqrt(d2) || 1;
      arr[i] = vx - (ex / len) * push;
      arr[i + 1] = vy - (ey / len) * push * 0.75;
      arr[i + 2] = vz - (ez / len) * push;
      moved++;
    }
    if (!moved) return;
    this._dents++;
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  };

  // Glass crazes and then goes out. One material per damaged car, cloned on
  // demand for the same reason the geometry is.
  Vehicle.prototype.updateGlassDamage = function () {
    var frac = M.clamp(this.health / this.maxHealth, 0, 1);
    var want = frac < 0.30 ? 2 : (frac < 0.62 ? 1 : 0);
    if (want === (this._glassState || 0)) return;
    this._glassState = want;
    var mats = this.body.material;
    if (!Array.isArray(mats)) return;
    for (var i = 0; i < mats.length; i++) {
      if (!mats[i] || !mats[i].userData || !mats[i].userData.glass) continue;
      if (!this._ownGlass) {
        mats[i] = mats[i].clone();
        mats[i].userData = { glass: true };
        this._ownGlass = true;
      }
      // The base glass is opaque dark-and-mirrored rather than transparent, so
      // the damage states are expressed in roughness and metalness - which
      // this material actually responds to - not in opacity, which it does
      // not use at all.
      var m = mats[i];
      if (want === 0) {
        m.roughness = 0.04; m.metalness = 0.92; m.color.setHex(0x1c2530);
      } else if (want === 1) {
        // crazed: frosted white. Against glass this dark, "slightly less
        // dark" is invisible; spidered safety glass going pale is both
        // truthful and the only version you can actually see at speed.
        m.roughness = 0.78; m.metalness = 0.25; m.color.setHex(0x474e55);
      } else {
        // blown out: a dark empty hole where the glass was
        m.roughness = 0.94; m.metalness = 0.04; m.color.setHex(0x0b0d11);
      }
      m.needsUpdate = true;
    }
    this.body.material = mats;
  };

  // Hand back the private geometry and materials. Called when a car is
  // recycled into the pool: without this, every car that is ever damaged
  // keeps its own copy of the body for the rest of the session.
  Vehicle.prototype.releaseDamage = function () {
    if (this._ownGeo) {
      var mine = this.body.geometry;
      this.body.geometry = this._sharedGeo;
      if (mine && mine.dispose) mine.dispose();
      this._ownGeo = false;
      this._pristine = null;
      this._dents = 0;
    }
    if (this._ownGlass) {
      var mats = this.body.material;
      if (Array.isArray(mats)) {
        for (var i = 0; i < mats.length; i++) {
          if (mats[i] && mats[i].userData && mats[i].userData.glass) {
            if (mats[i].dispose) mats[i].dispose();
            mats[i] = this._sharedMats[i];
          }
        }
        this.body.material = mats;
      }
      this._ownGlass = false;
    }
    this._glassState = 0;
  };

  // Put every panel back. Used by the respray and by the garage.
  Vehicle.prototype.repairBody = function () {
    if (this._ownGeo && this._pristine) {
      var pos = this.body.geometry.attributes.position;
      pos.array.set(this._pristine);
      pos.needsUpdate = true;
      this.body.geometry.computeVertexNormals();
      this.body.geometry.computeBoundingSphere();
      this._dents = 0;
    }
    this._glassState = -1;
    this.updateGlassDamage();
  };

  Vehicle.prototype.damage = function (amount, source, nx, nz, px, py, pz) {
    if (this.destroyed) return;
    this.health -= amount;
    // Where it was hit: a caller that knows the point passes it, otherwise
    // fall back to the contact normal projected onto the body.
    if (px === undefined && nx !== undefined) {
      px = this.pos.x - nx * this.spec.len * 0.34;
      py = this.pos.y + 0.3;
      pz = this.pos.z - nz * this.spec.len * 0.34;
    }
    if (px !== undefined) {
      this.dentAt(px, py === undefined ? this.pos.y + 0.3 : py, pz,
        M.clamp(amount * 0.0022, 0, 0.30));
    }
    this.updateGlassDamage();
    if (this.onDamage) this.onDamage(amount, source, nx, nz);
    if (this.health <= 0) {
      this.destroyed = true;
      this.burning = 0.001;
      if (this.onDestroyed) this.onDestroyed();
    } else if (this.health < this.maxHealth * 0.28 && !this.smoking) {
      this.smoking = true;
    }
  };

  // Push the mesh to match the simulation.
  Vehicle.prototype.syncMesh = function () {
    var s = this.spec;
    this.group.position.copy(this.pos);
    // Body local +x is forward. A Y rotation of -yaw maps local +x onto the
    // world heading (cos yaw, sin yaw).
    this.group.rotation.set(0, -this.yaw, 0);
    // pitch about the lateral axis, roll about the forward axis, both local
    this.body.rotation.set(this.roll, 0, this.pitch);

    for (var i = 0; i < 4; i++) {
      var w = this.wheels[i], mesh = this.wheelMeshes[i];
      var lift = (w.comp - 0.5) * this.springLen;
      mesh.position.set(w.x, M.clamp(w.groundY - this.pos.y + s.wheelR, -0.34, 0.20), w.z);
      mesh.rotation.set(0, 0, 0);
      mesh.rotation.y = w.steerable ? this.steer : 0;
      mesh.rotation.z = this.wheelSpin || 0;
      mesh.rotation.order = 'YZX';
    }
    if (this.shadow) {
      this.shadow.position.set(0, (this.wheels[0].groundY - this.pos.y) + 0.06, 0);
    }
  };

  Vehicle.prototype.updateVisual = function (dt, lampFactor) {
    this.wheelSpin = (this.wheelSpin || 0) - (this.u / this.spec.wheelR) * dt;
    if (this.wheelSpin > 1e5 || this.wheelSpin < -1e5) this.wheelSpin = 0;
    this.syncMesh();

    if (this.abilityCore) {
      var active = this.abilityT > 0;
      this.abilityCore.visible = !this.destroyed;
      this.abilityCore.material.emissiveIntensity = active ? 3.2 : 0.35;
      this.abilityCore.scale.setScalar(active ? 1.0 + Math.sin(performance.now() * 0.018) * 0.16 : 0.78);
    }

    var lamps = lampFactor === undefined ? 0 : lampFactor;
    this.headMat.emissiveIntensity = this.destroyed ? 0 : lamps * 1.6;
    this.tailMat.emissiveIntensity = this.destroyed ? 0 : (this.brake > 0.05 ? 2.4 : lamps * 0.85);
    if (this.beam) {
      this.beam.material.opacity = this.destroyed ? 0 : lamps * 0.30;
      this.beam.position.y = -(this.pos.y - this.wheels[0].groundY) + 0.05;
      this.beam.visible = lamps > 0.05;
    }
    if (this.shadow) this.shadow.material.opacity = M.lerp(0.42, 0.16, lamps);

    if (this.isPolice && this.lightRed) {
      if (this.sirenOn) {
        var t = performance.now() / 1000;
        var ph = (t * 3.4) % 1;
        this.lightRed.material.emissiveIntensity = ph < 0.28 ? 4.5 : (ph < 0.36 ? 2.0 : 0);
        this.lightBlue.material.emissiveIntensity = (ph > 0.5 && ph < 0.78) ? 4.5 : (ph > 0.78 && ph < 0.86 ? 2.0 : 0);
      } else {
        this.lightRed.material.emissiveIntensity = 0;
        this.lightBlue.material.emissiveIntensity = 0;
      }
    }
  };

  // World position of a seat / door, used for entering and exiting.
  Vehicle.prototype.doorPoint = function (side, out) {
    var s = this.spec;
    var cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
    var lx = s.len * 0.06, lz = side * (s.wid * 0.5 + 0.55);
    out.x = this.pos.x + lx * cosY - lz * sinY;
    out.z = this.pos.z + lx * sinY + lz * cosY;
    out.y = this.pos.y;
    return out;
  };

  Vehicle.prototype.forward = function (out) {
    out.x = Math.cos(this.yaw); out.z = Math.sin(this.yaw); out.y = 0;
    return out;
  };

  SB.Vehicle = Vehicle;
  SB.carGeometry = carGeometry;
  SB.vehicleMaterials = materials;
  SB.PAINTS = PAINTS;

})(window.SB = window.SB || {});
