// 31-rail.js - the railway, and a train you can actually drive.
//
// The line is a single loop threaded over the city: on embankment where there
// is room and on a viaduct where there is not, with six stations spaced around
// it. A train runs the loop on its own, stopping at each platform - and if you
// step aboard the cab, it hands you the throttle.
(function (SB) {
  'use strict';

  var M = SB.M, QB = SB.QB;

  var GAUGE = 1.52;           // rail centres
  var RAIL_H = 0.16;
  var SLEEPER_GAP = 2.4;
  var DECK_HW = 3.6;          // half width of the viaduct deck
  var CAR_LEN = 19.5;
  var CAR_HW = 1.62;
  var CAR_H = 3.5;
  var CARS = 4;

  // -------------------------------------------------------------- path ----
  // Arc-length parameterised loop, so the train advances in metres and the
  // carriages behind it sit a fixed distance back regardless of curvature.
  function Path(pts, loop) {
    this.pts = pts;
    this.loop = loop;
    this.cum = [0];
    var total = 0;
    for (var i = 1; i < pts.length; i++) {
      total += M.dist(pts[i - 1].x, pts[i - 1].z, pts[i].x, pts[i].z);
      this.cum.push(total);
    }
    if (loop) {
      total += M.dist(pts[pts.length - 1].x, pts[pts.length - 1].z, pts[0].x, pts[0].z);
      this.cum.push(total);
    }
    this.length = total;
  }

  Path.prototype.at = function (s, out) {
    var len = this.length;
    s = ((s % len) + len) % len;
    var cum = this.cum;
    // binary search for the segment holding s
    var lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) {
      var mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    var n = this.pts.length;
    var a = this.pts[lo % n], b = this.pts[(lo + 1) % n];
    var segLen = cum[lo + 1] - cum[lo];
    var t = segLen > 1e-6 ? (s - cum[lo]) / segLen : 0;
    out = out || {};
    out.x = M.lerp(a.x, b.x, t);
    out.y = M.lerp(a.y, b.y, t);
    out.z = M.lerp(a.z, b.z, t);
    out.yaw = Math.atan2(b.z - a.z, b.x - a.x);
    out.grade = segLen > 1e-6 ? (b.y - a.y) / segLen : 0;
    out.elevated = t < 0.5 ? !!a.elevated : !!b.elevated;
    return out;
  };

  // ------------------------------------------------------------- train ----
  function Train(rail, path) {
    this.rail = rail;
    this.path = path;
    this.craftType = 'train';
    this.s = 0;
    this.v = 0;
    this.throttle = 0;
    this.brake = 0;
    this.driver = null;
    this.locked = false;
    this.destroyed = false;
    this.dwell = 0;
    this.autopilot = true;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.cars = [];
    this.group = new THREE.Group();
    this.group.name = 'train';
    this._p = {};
    this.buildCars();
  }

  Train.prototype.speed = function () { return Math.abs(this.v); };

  // Where the player stands when they step off. Every other vehicle in the
  // game answers this, and the exit code asks for it by name.
  Train.prototype.spec = { wheelR: 0 };

  Train.prototype.doorPoint = function (side, out) {
    var c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    var world = this.rail && this.rail.world;
    var best = null, bestGap = -1e9;
    // Try both sides and step out onto whichever has a platform under it, so
    // you never get put down on the far rail or off the edge of a viaduct.
    for (var k = -1; k <= 1; k += 2) {
      var x = this.pos.x + (-s) * 4.0 * k;
      var z = this.pos.z + (c) * 4.0 * k;
      var y = this.pos.y;
      if (world) {
        var srf = world.surfaceAt(x, z, y + 1.5, 2.2);
        var gap = srf.y - (this.pos.y - 2.2);
        if (gap > bestGap) { bestGap = gap; best = { x: x, y: srf.y, z: z }; }
      } else if (!best) {
        best = { x: x, y: y, z: z };
      }
    }
    out.x = best.x; out.y = best.y; out.z = best.z;
    return out;
  };

  Train.prototype.buildCars = function () {
    var bodyMat = new THREE.MeshStandardMaterial({ color: 0xd8dbe0, roughness: 0.42, metalness: 0.35 });
    var skirtMat = new THREE.MeshStandardMaterial({ color: 0x2b3540, roughness: 0.7, metalness: 0.2 });
    var glassMat = new THREE.MeshStandardMaterial({
      color: 0x16232c, roughness: 0.14, metalness: 0.6,
      emissive: new THREE.Color(0x2a4658), emissiveIntensity: 0.25
    });
    var stripeMat = new THREE.MeshStandardMaterial({ color: 0xe8a33d, roughness: 0.5, metalness: 0.2 });
    this.materials = { body: bodyMat, glass: glassMat, stripe: stripeMat, skirt: skirtMat };

    for (var i = 0; i < CARS; i++) {
      var car = new THREE.Group();
      var qb = new QB();
      var half = CAR_LEN * 0.5 - 0.6;
      // body, with the nose raked on the leading car
      var nose = i === 0 ? 1.5 : 0.35;
      qb.quad(-half, 0.9, -CAR_HW, half - nose, 0.9, -CAR_HW,
        half - nose, 0.9 + CAR_H, -CAR_HW, -half, 0.9 + CAR_H, -CAR_HW, 0, 0, 6, 1);
      qb.quad(half - nose, 0.9, CAR_HW, -half, 0.9, CAR_HW,
        -half, 0.9 + CAR_H, CAR_HW, half - nose, 0.9 + CAR_H, CAR_HW, 0, 0, 6, 1);
      // raked nose / tail faces
      qb.quad(half - nose, 0.9, -CAR_HW, half, 0.9, 0, half, 0.9 + CAR_H * 0.72, 0,
        half - nose, 0.9 + CAR_H, -CAR_HW, 0, 0, 2, 1);
      qb.quad(half, 0.9, 0, half - nose, 0.9, CAR_HW, half - nose, 0.9 + CAR_H, CAR_HW,
        half, 0.9 + CAR_H * 0.72, 0, 0, 0, 2, 1);
      qb.quad(-half, 0.9, CAR_HW, -half, 0.9, -CAR_HW,
        -half, 0.9 + CAR_H, -CAR_HW, -half, 0.9 + CAR_H, CAR_HW, 0, 0, 2, 1);
      // roof
      qb.quad(-half, 0.9 + CAR_H, -CAR_HW, half - nose, 0.9 + CAR_H, -CAR_HW,
        half - nose, 0.9 + CAR_H, CAR_HW, -half, 0.9 + CAR_H, CAR_HW, 0, 0, 6, 1);
      car.add(qb.mesh(bodyMat, true, true));

      // window band and a colour stripe under it
      var wb = new QB();
      for (var side = -1; side <= 1; side += 2) {
        var zz = CAR_HW * side * 1.005;
        wb.quad(-half + 1.0, 2.15, zz, half - nose - 1.0, 2.15, zz,
          half - nose - 1.0, 3.35, zz, -half + 1.0, 3.35, zz, 0, 0, 8, 1);
      }
      if (i === 0) {
        wb.quad(half - nose, 2.2, -CAR_HW * 0.8, half - 0.15, 2.2, 0,
          half - 0.15, 3.25, 0, half - nose, 3.3, -CAR_HW * 0.8, 0, 0, 1, 1);
        wb.quad(half - 0.15, 2.2, 0, half - nose, 2.2, CAR_HW * 0.8,
          half - nose, 3.3, CAR_HW * 0.8, half - 0.15, 3.25, 0, 0, 0, 1, 1);
      }
      car.add(wb.mesh(glassMat, false, false));

      var st = new QB();
      for (side = -1; side <= 1; side += 2) {
        var z2 = CAR_HW * side * 1.01;
        st.quad(-half + 0.4, 1.62, z2, half - nose - 0.4, 1.62, z2,
          half - nose - 0.4, 1.96, z2, -half + 0.4, 1.96, z2, 0, 0, 8, 1);
      }
      car.add(st.mesh(stripeMat, false, false));

      // underframe and bogies
      var uf = new QB();
      uf.box(-half + 0.5, 0.30, -CAR_HW + 0.35, half - 0.5, 0.92, CAR_HW - 0.35, 3, 3, 3, {});
      for (var b2 = 0; b2 < 2; b2++) {
        var bx = (b2 === 0 ? -1 : 1) * (half - 3.6);
        uf.box(bx - 1.9, -0.05, -1.25, bx + 1.9, 0.62, 1.25, 2, 2, 2, {});
      }
      car.add(uf.mesh(skirtMat, true, false));

      car.matrixAutoUpdate = true;
      this.group.add(car);
      this.cars.push(car);
    }
  };

  // Physics is deliberately simple: rails remove every degree of freedom
  // except distance travelled, so all that is left is tractive effort against
  // drag, gravity on the grade, and a brake.
  Train.prototype.step = function (dt, cmd) {
    var throttle = cmd ? (cmd.throttle || 0) : 0;
    var brake = cmd ? (cmd.brake || 0) : 0;

    if (!cmd || cmd.auto) {
      // Run the timetable: hold at a platform, then accelerate to line speed
      // and start braking in time for the next one.
      var st = this.rail.nextStation(this.s);
      var gap = st.dist;
      if (this.dwell > 0) {
        this.dwell -= dt;
        throttle = 0; brake = 1;
      } else if (gap < this.stopDistance()) {
        throttle = 0; brake = 0.85;
        if (this.v < 0.6 && gap < 14) { this.dwell = 5.5; this.v = 0; }
      } else {
        throttle = this.v < 26 ? 1 : 0.25;
        brake = 0;
      }
    }

    var p = this.path.at(this.s, this._p);
    var accel = throttle * 1.35 - brake * 2.6;
    accel -= p.grade * 9.81;                      // gravity along the rail
    accel -= this.v * 0.018 + Math.sign(this.v) * 0.09;   // drag and rolling resistance
    this.v += accel * dt;
    if (this.v < 0) this.v = 0;                   // this one only goes forwards
    if (this.v > 34) this.v = 34;
    this.s += this.v * dt;

    // place the leading car, then trail the rest behind it along the path
    for (var i = 0; i < this.cars.length; i++) {
      var cp = this.path.at(this.s - i * (CAR_LEN + 1.1), this._p);
      var car = this.cars[i];
      car.position.set(cp.x, cp.y, cp.z);
      car.rotation.set(0, -cp.yaw, 0);
      // pitch the car along the grade so it does not float on a climb
      car.rotation.x = 0;
      car.rotation.z = -Math.atan(cp.grade);
      if (i === 0) {
        this.pos.set(cp.x, cp.y + 1.9, cp.z);
        this.yaw = cp.yaw;
      }
    }
  };

  // How much track it takes to stop from here, plus a margin.
  Train.prototype.stopDistance = function () {
    return (this.v * this.v) / (2 * 2.4) + 16;
  };

  Train.prototype.placeAt = function (s) {
    this.s = s; this.v = 0;
    this.step(0.0001, { throttle: 0, brake: 1 });
  };

  // --------------------------------------------------------------- rail ----
  function Rail(game) {
    this.game = game;
    this.scene = game.scene;
    this.world = game.world;
    this.layout = game.layout;
    this.field = game.world.heightField;

    this.root = new THREE.Group();
    this.root.name = 'rail';
    this.scene.add(this.root);
    this.cullables = [];

    var spec = game.layout.rail;
    this.path = new Path(spec.pts, spec.loop);
    this.stations = spec.stations;
    this.indexStations();

    this.buildTrack();
    this.buildStations();

    this.train = new Train(this, this.path);
    this.root.add(this.train.group);
    this.train.placeAt(this.stations[0].s + 4);
  }

  // Convert each station's path index into a distance along the line.
  Rail.prototype.indexStations = function () {
    for (var i = 0; i < this.stations.length; i++) {
      var st = this.stations[i];
      st.s = this.path.cum[Math.min(st.index, this.path.cum.length - 1)];
    }
    this.stations.sort(function (a, b) { return a.s - b.s; });
  };

  Rail.prototype.nextStation = function (s) {
    var len = this.path.length;
    s = ((s % len) + len) % len;
    var best = this.stations[0], bd = 1e18;
    for (var i = 0; i < this.stations.length; i++) {
      var d = this.stations[i].s - s;
      if (d < 0) d += len;
      if (d < bd) { bd = d; best = this.stations[i]; }
    }
    return { station: best, dist: bd };
  };

  Rail.prototype.buildTrack = function () {
    var ballast = new QB(), sleeper = new QB(), rail = new QB();
    var deck = new QB(), pier = new QB();
    var field = this.field;
    var p = {}, q = {};
    var total = this.path.length;
    var step = SLEEPER_GAP;
    var pierEvery = 34, sincePier = 0;

    for (var s = 0; s < total; s += step) {
      this.path.at(s, p);
      this.path.at(s + step, q);
      var ux = Math.cos(p.yaw), uz = Math.sin(p.yaw);
      var px = -uz, pz = ux;
      var ground = field.at(p.x, p.z);

      if (p.elevated && p.y - ground > 3.0) {
        // viaduct: a box girder carrying the track
        deck.quad(
          p.x + px * DECK_HW, p.y - 0.35, p.z + pz * DECK_HW,
          p.x - px * DECK_HW, p.y - 0.35, p.z - pz * DECK_HW,
          q.x - px * DECK_HW, q.y - 0.35, q.z - pz * DECK_HW,
          q.x + px * DECK_HW, q.y - 0.35, q.z + pz * DECK_HW, 0, 0, 2, 1);
        for (var side = -1; side <= 1; side += 2) {
          var ex = px * DECK_HW * side, ez = pz * DECK_HW * side;
          if (side < 0) {
            deck.quad(p.x + ex, p.y - 1.9, p.z + ez, q.x + ex, q.y - 1.9, q.z + ez,
              q.x + ex, q.y - 0.35, q.z + ez, p.x + ex, p.y - 0.35, p.z + ez, 0, 0, 1, 1);
          } else {
            deck.quad(q.x + ex, q.y - 1.9, q.z + ez, p.x + ex, p.y - 1.9, p.z + ez,
              p.x + ex, p.y - 0.35, p.z + ez, q.x + ex, q.y - 0.35, q.z + ez, 0, 0, 1, 1);
          }
        }
        deck.quad(
          p.x - px * DECK_HW, p.y - 1.9, p.z - pz * DECK_HW,
          p.x + px * DECK_HW, p.y - 1.9, p.z + pz * DECK_HW,
          q.x + px * DECK_HW, q.y - 1.9, q.z + pz * DECK_HW,
          q.x - px * DECK_HW, q.y - 1.9, q.z - pz * DECK_HW, 0, 0, 2, 1);

        sincePier += step;
        if (sincePier >= pierEvery) {
          sincePier = 0;
          pier.box(p.x - 1.5, ground - 1.0, p.z - 1.5, p.x + 1.5, p.y - 1.9, p.z + 1.5, 3, 3, 3, {});
          this.world.addOBB(p.x, p.z, 1.6, 1.6, p.yaw, ground - 1, p.y - 1.9, 'pier');
        }
        // the deck itself is solid, so you can land a helicopter on the viaduct
        this.world.addStrip(p.x, p.z, q.x, q.z, DECK_HW, p.y - 0.35, q.y - 0.35, 'concrete');
      } else {
        // embankment: a ballast shoulder sitting on the ground
        var bw = 3.1;
        ballast.quad(
          p.x + px * bw, p.y - 0.42, p.z + pz * bw,
          p.x - px * bw, p.y - 0.42, p.z - pz * bw,
          q.x - px * bw, q.y - 0.42, q.z - pz * bw,
          q.x + px * bw, q.y - 0.42, q.z + pz * bw, 0, 0, 2, 1);
        for (var sd = -1; sd <= 1; sd += 2) {
          var bx = px * bw * sd, bz = pz * bw * sd;
          var ox = px * (bw + 1.5) * sd, oz = pz * (bw + 1.5) * sd;
          if (sd < 0) {
            ballast.quad(p.x + ox, ground, p.z + oz, q.x + ox, ground, q.z + oz,
              q.x + bx, q.y - 0.42, q.z + bz, p.x + bx, p.y - 0.42, p.z + bz, 0, 0, 1, 1);
          } else {
            ballast.quad(q.x + ox, ground, q.z + oz, p.x + ox, ground, p.z + oz,
              p.x + bx, p.y - 0.42, p.z + bz, q.x + bx, q.y - 0.42, q.z + bz, 0, 0, 1, 1);
          }
        }
      }

      // sleeper
      sleeper.box(-1.3, 0, -0.14, 1.3, 0.16, 0.14, 1, 1, 1, {});
      var last = sleeper.pos.length / 3;
      rotateLast(sleeper, last, 24, p.x, p.y - 0.42, p.z, p.yaw);

      // the two rails, as continuous ribbons
      for (var r2 = -1; r2 <= 1; r2 += 2) {
        var rx = px * GAUGE * 0.5 * r2, rz = pz * GAUGE * 0.5 * r2;
        railSeg(rail, p.x + rx, p.y - 0.26, p.z + rz, q.x + rx, q.y - 0.26, q.z + rz, px, pz);
      }
    }

    var ballastMat = new THREE.MeshStandardMaterial({
      map: SB.Tex.asphalt(), color: 0x8b8378, roughness: 0.98
    });
    var sleeperMat = new THREE.MeshStandardMaterial({ color: 0x54483c, roughness: 0.95 });
    var railMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a6, roughness: 0.32, metalness: 0.85 });
    var deckMat = new THREE.MeshStandardMaterial({
      map: SB.Tex.sidewalk(), color: 0xada79c, roughness: 0.92
    });

    this.add(ballast.mesh(ballastMat, false, true));
    this.add(sleeper.mesh(sleeperMat, false, true));
    this.add(rail.mesh(railMat, false, false));
    this.add(deck.mesh(deckMat, true, true));
    this.add(pier.mesh(deckMat, true, true));
  };

  // A short length of rail head: a narrow ribbon with a visible web.
  function railSeg(qb, ax, ay, az, bx, by, bz, px, pz) {
    var w = 0.09;
    qb.quad(ax + px * w, ay + RAIL_H, az + pz * w, ax - px * w, ay + RAIL_H, az - pz * w,
      bx - px * w, by + RAIL_H, bz - pz * w, bx + px * w, by + RAIL_H, bz + pz * w, 0, 0, 1, 1);
    qb.quad(ax - px * w, ay, az - pz * w, ax - px * w, ay + RAIL_H, az - pz * w,
      bx - px * w, by + RAIL_H, bz - pz * w, bx - px * w, by, bz - pz * w, 0, 0, 1, 1);
    qb.quad(ax + px * w, ay + RAIL_H, az + pz * w, ax + px * w, ay, az + pz * w,
      bx + px * w, by, bz + pz * w, bx + px * w, by + RAIL_H, bz + pz * w, 0, 0, 1, 1);
  }

  // Rotate the vertices a builder just emitted into place. Cheaper than
  // building a transformed copy of the sleeper geometry every 2.4 metres.
  function rotateLast(qb, endVert, count, ox, oy, oz, yaw) {
    var c = Math.cos(yaw), s = Math.sin(yaw);
    var pos = qb.pos, nor = qb.nor;
    for (var v = endVert - count; v < endVert; v++) {
      var i = v * 3;
      var x = pos[i], y = pos[i + 1], z = pos[i + 2];
      pos[i] = ox + x * c - z * s;
      pos[i + 1] = oy + y;
      pos[i + 2] = oz + x * s + z * c;
      var nx = nor[i], nz = nor[i + 2];
      nor[i] = nx * c - nz * s;
      nor[i + 2] = nx * s + nz * c;
    }
  }

  Rail.prototype.buildStations = function () {
    var plat = new QB(), canopy = new QB(), col = new QB();
    var p = {};
    for (var i = 0; i < this.stations.length; i++) {
      var st = this.stations[i];
      this.path.at(st.s, p);
      st.x = p.x; st.y = p.y; st.z = p.z;
      var ux = Math.cos(p.yaw), uz = Math.sin(p.yaw);
      var px = -uz, pz = ux;
      var HALF = 34, PW = 5.0, PY = p.y - 0.42;

      for (var side = -1; side <= 1; side += 2) {
        var off = (GAUGE * 0.5 + 1.9 + PW * 0.5) * side;
        var cx = p.x + px * off, cz = p.z + pz * off;
        plat.obox(cx, PY, cz, HALF, PW * 0.5, PY + 1.05, p.yaw, 4, 4, 4, {});
        this.world.addPlatform(cx - HALF, cz - PW, cx + HALF, cz + PW, PY + 1.05, 'concrete');

        // canopy on columns down the platform
        canopy.obox(cx, PY + 4.3, cz, HALF * 0.82, PW * 0.55, PY + 4.55, p.yaw, 5, 5, 5, {});
        for (var k = -2; k <= 2; k++) {
          var lx = cx + ux * (HALF * 0.72) * (k / 2);
          var lz = cz + uz * (HALF * 0.72) * (k / 2);
          col.box(lx - 0.16, PY + 1.05, lz - 0.16, lx + 0.16, PY + 4.3, lz + 0.16, 1, 1, 1, {});
        }
      }

      // a stair down to street level for elevated stops
      var ground = this.field.at(p.x, p.z);
      if (PY - ground > 2.5) {
        var sx = p.x + px * (GAUGE * 0.5 + 1.9 + PW + 3.0);
        var sz = p.z + pz * (GAUGE * 0.5 + 1.9 + PW + 3.0);
        var steps = Math.ceil((PY + 1.05 - ground) / 0.42);
        for (var t2 = 0; t2 < steps; t2++) {
          var sy = ground + t2 * 0.42;
          var back = t2 * 0.55;
          var ex = sx + px * back, ez = sz + pz * back;
          plat.obox(ex, sy, ez, 3.0, 0.28, sy + 0.42, p.yaw, 2, 2, 2, {});
          this.world.addPlatform(ex - 3.2, ez - 0.5, ex + 3.2, ez + 0.5, sy + 0.42, 'concrete');
        }
      }
    }

    var platMat = new THREE.MeshStandardMaterial({
      map: SB.Tex.sidewalk(), color: 0xc3bdb1, roughness: 0.9
    });
    var canopyMat = new THREE.MeshStandardMaterial({ color: 0x3b4650, roughness: 0.6, metalness: 0.3 });
    var colMat = new THREE.MeshStandardMaterial({ color: 0x8f959b, roughness: 0.5, metalness: 0.5 });
    this.add(plat.mesh(platMat, true, true));
    this.add(canopy.mesh(canopyMat, true, true));
    this.add(col.mesh(colMat, true, true));
  };

  Rail.prototype.add = function (mesh) {
    if (!mesh.geometry.attributes.position ||
      mesh.geometry.attributes.position.count === 0) return;
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
    var bs = mesh.geometry.boundingSphere;
    if (bs) this.cullables.push({ mesh: mesh, x: bs.center.x, z: bs.center.z, r: bs.radius });
  };

  // The train runs itself unless the player has taken the cab.
  Rail.prototype.step = function (dt) {
    var t = this.train;
    if (t.driver) return;                    // the player is stepping it
    t.step(dt, { auto: true });
  };

  Rail.prototype.list = function () { return [this.train]; };

  SB.Rail = Rail;
  SB.Train = Train;

})(window.SB = window.SB || {});
