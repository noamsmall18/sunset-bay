// 11-traffic.js - the vehicle manager and the traffic AI.
//
// Traffic cars run the same physics as the player's car; only the inputs are
// different. That costs a little more than kinematic dummies, but it means a
// side-swipe behaves identically whoever is driving, and a spun-out taxi keeps
// sliding the way it should.
(function (SB) {
  'use strict';

  var M = SB.M, Roads = SB.Roads;

  var TRAFFIC_TYPES = ['sedan', 'sedan', 'compact', 'compact', 'hatchback', 'suv', 'taxi', 'van', 'muscle', 'sports', 'supercar', 'rally', 'pickup', 'armored', 'truck'];
  var TRAFFIC_WEIGHT = [0.16, 0.10, 0.12, 0.08, 0.10, 0.10, 0.07, 0.06, 0.05, 0.04, 0.035, 0.035, 0.025, 0.01, 0.025];

  var MAX_TRAFFIC = 46;
  var MAX_PARKED = 40;
  var SPAWN_MIN = 55, SPAWN_MAX = 205, DESPAWN = 290;

  function isRoadVehicle(v) {
    return v && v.spec && Number.isFinite(v.spec.wid) &&
      Number.isFinite(v.spec.len) && Number.isFinite(v.spec.mass);
  }

  function pickType(rng) {
    var r = rng();
    var acc = 0;
    for (var i = 0; i < TRAFFIC_TYPES.length; i++) {
      acc += TRAFFIC_WEIGHT[i];
      if (r <= acc) return TRAFFIC_TYPES[i];
    }
    return 'sedan';
  }

  function Traffic(game) {
    this.game = game;
    this.world = game.world;
    this.L = game.layout;
    this.scene = game.scene;
    this.rng = M.rng(9091);

    this.active = [];        // AI-driven traffic
    this.parked = [];        // dormant, stealable
    this.loose = [];         // player-abandoned or knocked-about cars
    this.pool = Object.create(null);
    this.grid = new SB.Grid(20);
    this._q = [];
    this._stamp = 1;
    this.spawnTimer = 0;
    this.parkTimer = 0;
    this._pt = { x: 0, z: 0 };
    this._dir = { x: 0, z: 0 };
    this.density = 1;
    this.maxCars = SB.Q.settings.traffic;
    this.maxParked = SB.Q.settings.parked;
  }

  // ------------------------------------------------------------- pooling ---
  Traffic.prototype.acquire = function (type) {
    var list = this.pool[type] || (this.pool[type] = []);
    var v;
    if (list.length) {
      v = list.pop();
      v.group.visible = true;
    } else {
      v = new SB.Vehicle(type, this.world, {});
      v.addToScene(this.scene);
    }
    v.health = v.maxHealth;
    v.destroyed = false;
    v.burning = 0;
    v.smoking = false;
    v.exploded = false;
    v.sirenOn = false;
    v.driver = null;
    v.isPlayer = false;
    v.reverse = false;
    v.abilityT = 0;
    v.abilityCooldown = 0;
    v.ramActive = false;
    v.gear = 1;
    v.u = v.v = v.vy = v.yawRate = 0;
    v.skid = 0;
    v.setColor(SB.PAINTS[this.rng.int(0, SB.PAINTS.length - 1)]);
    return v;
  };

  Traffic.prototype.recycle = function (v) {
    // A pooled car must come back straight. This also returns its private
    // damaged geometry so the pool does not accumulate one body clone per
    // car that was ever hit.
    if (v.releaseDamage) v.releaseDamage();
    v.group.visible = false;
    v.pos.set(0, -500, 0);
    v.ai = null;
    (this.pool[v.key] || (this.pool[v.key] = [])).push(v);
  };

  // Quality changes can happen after the population has already spawned.
  // Trim only disposable traffic so switching to Low takes effect now, while
  // loose/player-owned cars remain part of the simulation.
  Traffic.prototype.applyBudget = function () {
    while (this.active.length > this.maxCars) this.recycle(this.active.pop());
    while (this.parked.length > this.maxParked) {
      var v = this.parked.pop();
      if (v.spot) v.spot.taken = false;
      this.recycle(v);
    }
  };

  // ------------------------------------------------------------- spawning --
  Traffic.prototype.spawnParked = function (type, x, z, yaw, color) {
    var v = this.acquire(type);
    if (color !== undefined) v.setColor(color);
    v.placeAt(x, z, yaw);
    v.dormant = true;
    v.parkedSpot = null;
    this.parked.push(v);
    return v;
  };

  Traffic.prototype.spawnTrafficCar = function (px, pz) {
    var spot = Roads.randomLanePoint(this.L, this.rng, px, pz, SPAWN_MIN, SPAWN_MAX, this._pt);
    // never drop a car on top of another one
    if (this.occupied(spot.x, spot.z, 7)) return null;
    var v = this.acquire(pickType(this.rng));
    Roads.laneDir(this.L, spot.edge, spot.dir, this._dir);
    v.placeAt(spot.x, spot.z, Math.atan2(this._dir.z, this._dir.x));
    v.dormant = false;
    v.ai = {
      edge: spot.edge, dir: spot.dir, lane: spot.lane,
      t: 0.5,
      cruise: this.rng.range(11, 17) * (spot.edge.avenue ? 1.16 : 0.92),
      patience: this.rng.range(0.6, 1.5),
      panic: 0, stuck: 0, honk: 0,
      changeCd: this.rng.range(3, 12)
    };
    // start it already moving so traffic does not appear from a standstill
    v.u = v.ai.cruise * this.rng.range(0.55, 1.0);
    this.active.push(v);
    return v;
  };

  Traffic.prototype.occupied = function (x, z, r) {
    var list = this.grid.queryPoint(x, z, r, this._q, this._stamp++);
    for (var i = 0; i < list.length; i++) {
      if (M.dist2(list[i].pos.x, list[i].pos.z, x, z) < r * r) return true;
    }
    return false;
  };

  Traffic.prototype.allVehicles = function () {
    // Order matters for "nearest car" checks: parked first so a parked car at
    // the kerb wins over traffic sliding past.
    var out = this.parked.concat(this.loose, this.active);
    if (this.game.police) out = out.concat(this.game.police.cars);
    return out;
  };

  Traffic.prototype.releaseToPlayer = function (v) {
    var i = this.active.indexOf(v);
    if (i >= 0) { this.active.splice(i, 1); v.ai = null; }
    i = this.parked.indexOf(v);
    if (i >= 0) {
      this.parked.splice(i, 1);
      if (v.spot) v.spot.taken = false;
      v.spot = null;
      v.dormant = false;
    }
    if (this.loose.indexOf(v) < 0) this.loose.push(v);
  };

  Traffic.prototype.ejectDriver = function (v) {
    if (v.aiPed && this.game.peds) this.game.peds.spawnFleeingFrom(v);
    v.ai = null;
    var i = this.active.indexOf(v);
    if (i >= 0) this.active.splice(i, 1);
  };

  // ---------------------------------------------------------------- step ---
  Traffic.prototype.fixed = function (dt) {
    var p = this.game.player;
    var px = p ? p.pos.x : 0, pz = p ? p.pos.z : 0;

    this.rebuildGrid();

    // -- population management
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.30;
      if (this.active.length < this.maxCars * this.density) this.spawnTrafficCar(px, pz);
    }
    this.parkTimer -= dt;
    if (this.parkTimer <= 0) {
      this.parkTimer = 0.5;
      this.manageParked(px, pz);
    }

    var i, v;
    // -- AI traffic
    for (i = this.active.length - 1; i >= 0; i--) {
      v = this.active[i];
      if (M.dist2(v.pos.x, v.pos.z, px, pz) > DESPAWN * DESPAWN) {
        this.active.splice(i, 1);
        this.recycle(v);
        continue;
      }
      this.driveAI(v, dt, px, pz);
      v.step(dt, v._in);
      if (v.exploded) { this.blowUp(v); this.active.splice(i, 1); this.recycle(v); }
    }

    // -- loose cars keep simulating so they roll to a stop believably
    for (i = this.loose.length - 1; i >= 0; i--) {
      v = this.loose[i];
      if (v === (p && p.vehicle)) continue;
      if (M.dist2(v.pos.x, v.pos.z, px, pz) > (DESPAWN + 120) * (DESPAWN + 120)) {
        this.loose.splice(i, 1); this.recycle(v); continue;
      }
      var still = Math.abs(v.u) < 0.12 && Math.abs(v.v) < 0.12 && Math.abs(v.vy) < 0.05 && !v.burning;
      if (!still) v.step(dt, { throttle: 0, brake: 0.08, steer: 0, handbrake: 0 });
      if (v.exploded) { this.blowUp(v); this.loose.splice(i, 1); this.recycle(v); }
    }

    // -- parked cars only wake when something disturbs them
    for (i = this.parked.length - 1; i >= 0; i--) {
      v = this.parked[i];
      if (!v.dormant) {
        v.step(dt, { throttle: 0, brake: 0.3, steer: 0, handbrake: 0 });
        if (Math.abs(v.u) < 0.1 && Math.abs(v.v) < 0.1 && !v.burning) v.dormant = true;
      }
      if (v.exploded) { this.blowUp(v); this.parked.splice(i, 1); this.recycle(v); }
    }

    this.resolveCarCollisions(dt);
  };

  Traffic.prototype.rebuildGrid = function () {
    this.grid.map.clear();
    // This broadphase is shared by traffic, pedestrians, and car-vs-car
    // collisions. Aircraft and boats have different dimensions and motion
    // fields, so putting one in the road grid makes resolveCarCollisions()
    // read undefined car values and poison every nearby position with NaN.
    var all = this.parked.concat(this.loose, this.active);
    if (this.game.police) all = all.concat(this.game.police.cars);
    all = all.filter(isRoadVehicle);
    var pv = this.game.player && this.game.player.vehicle;
    if (isRoadVehicle(pv) && all.indexOf(pv) < 0) all.push(pv);
    for (var i = 0; i < all.length; i++) {
      var v = all[i];
      v.__idx = i;
      var r = v.spec.len * 0.6;
      this.grid.insert(v, v.pos.x - r, v.pos.z - r, v.pos.x + r, v.pos.z + r);
    }
    this._all = all;
  };

  // ------------------------------------------------------------ parked -----
  Traffic.prototype.manageParked = function (px, pz) {
    var spots = this.game.props ? this.game.props.parkSpots : null;
    if (!spots || !spots.length) return;
    // cull the far ones
    for (var i = this.parked.length - 1; i >= 0; i--) {
      var v = this.parked[i];
      if (M.dist2(v.pos.x, v.pos.z, px, pz) > DESPAWN * DESPAWN) {
        if (v.spot) v.spot.taken = false;
        this.parked.splice(i, 1);
        this.recycle(v);
      }
    }
    var budget = 3;
    while (this.parked.length < this.maxParked && budget-- > 0) {
      var s = spots[this.rng.int(0, spots.length - 1)];
      if (s.taken) continue;
      var d2 = M.dist2(s.x, s.z, px, pz);
      if (d2 < 26 * 26 || d2 > (SPAWN_MAX + 40) * (SPAWN_MAX + 40)) continue;
      if (this.occupied(s.x, s.z, 4.5)) continue;
      var car = this.spawnParked(pickType(this.rng), s.x, s.z,
        s.yaw + (this.rng.chance(0.5) ? Math.PI : 0) + this.rng.range(-0.04, 0.04));
      car.spot = s;
      s.taken = true;
    }
  };

  // -------------------------------------------------------------- AI -------
  var _tgt = { x: 0, z: 0 }, _d = { x: 0, z: 0 };

  Traffic.prototype.driveAI = function (v, dt, px, pz) {
    var ai = v.ai;
    var L = this.L;
    if (!v._in) v._in = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    var input = v._in;

    if (v.destroyed) {
      input.throttle = 0; input.brake = 1; input.steer = 0; input.handbrake = 1;
      return;
    }

    var e = ai.edge;
    var from = ai.dir > 0 ? L.nodes[e.a] : L.nodes[e.b];
    var to = ai.dir > 0 ? L.nodes[e.b] : L.nodes[e.a];

    // progress along the current edge, measured by projection
    var ex = to.x - from.x, ez = to.z - from.z;
    var elen = Math.hypot(ex, ez) || 1;
    var t = ((v.pos.x - from.x) * ex + (v.pos.z - from.z) * ez) / (elen * elen);
    ai.t = t;

    // arrive at the far node: choose the next edge
    if (t >= 0.985) {
      this.chooseNextEdge(v, to);
      e = ai.edge;
      from = ai.dir > 0 ? L.nodes[e.a] : L.nodes[e.b];
      to = ai.dir > 0 ? L.nodes[e.b] : L.nodes[e.a];
      ex = to.x - from.x; ez = to.z - from.z;
      elen = Math.hypot(ex, ez) || 1;
      t = 0;
    }

    // aim at a point down the lane, further ahead the faster we go
    var speed = Math.max(0, v.u);
    var lookahead = M.clamp(5.5 + speed * 0.62, 6, 26);
    var lookT = M.clamp(t + lookahead / elen, 0, 1.35);
    if (lookT <= 1) {
      Roads.lanePoint(L, e, ai.dir, ai.lane, lookT, _tgt);
    } else {
      // look past the junction onto the next edge so corners are taken smoothly
      var nxt = ai.nextEdge;
      if (nxt) {
        Roads.lanePoint(L, nxt.edge, nxt.dir, nxt.lane, M.clamp((lookT - 1) * elen / Math.max(nxt.edge.len, 1), 0, 0.9), _tgt);
      } else {
        Roads.lanePoint(L, e, ai.dir, ai.lane, 1, _tgt);
      }
    }

    // steering: angle between heading and the target
    var wantYaw = Math.atan2(_tgt.z - v.pos.z, _tgt.x - v.pos.x);
    var err = M.angleDelta(v.yaw, wantYaw);
    input.steer = M.clamp(err * 1.9, -1, 1);

    // ---- desired speed
    var target = ai.cruise;
    // slow for the corner we are about to take
    if (lookT > 0.92 && ai.nextEdge && ai.nextEdge.turn) {
      target = Math.min(target, ai.nextEdge.turn === 'straight' ? ai.cruise : 7.5);
    }
    // slow for a big steering angle (we are already mid corner)
    target *= M.lerp(1, 0.52, M.clamp(Math.abs(err) / 0.8, 0, 1));

    // ---- traffic light at the node ahead
    var distToNode = (1 - t) * elen;
    if (to.hasLight && distToNode < 45) {
      var green = Roads.lightGreen(to.light, e.axis);
      var amber = to.light && to.light.amber;
      if (!green || (amber && distToNode > 9)) {
        var stopAt = Math.max(0, distToNode - (to.axisHalf || 9));
        target = Math.min(target, stopAt < 2 ? 0 : Math.sqrt(Math.max(0, stopAt) * 2 * 4.5));
      }
    }

    // ---- car ahead
    var gap = this.gapAhead(v, 34);
    if (gap.dist < 34) {
      var safe = 5.0 + speed * 0.62;
      if (gap.dist < safe) {
        target = Math.min(target, Math.max(0, gap.speed * 0.9 - (safe - gap.dist) * 2.2));
      } else {
        target = Math.min(target, gap.speed + (gap.dist - safe) * 0.55);
      }
      if (gap.dist < 7 && speed < 1.2) {
        ai.honk += dt;
        if (ai.honk > ai.patience + 1.4) {
          ai.honk = -this.rng.range(2, 6);
          if (this.game.audio) this.game.audio.horn(v);
        }
      }
    }

    // ---- react to the player driving like a maniac
    var pv = this.game.player && this.game.player.vehicle;
    if (isRoadVehicle(pv)) {
      var dpx = pv.pos.x - v.pos.x, dpz = pv.pos.z - v.pos.z;
      var pd = Math.hypot(dpx, dpz);
      if (pd < 22) {
        var ahead = (dpx * Math.cos(v.yaw) + dpz * Math.sin(v.yaw)) / Math.max(pd, 0.01);
        var closing = -(pv.u * Math.cos(pv.yaw) - v.u * Math.cos(v.yaw)) * dpx
          - (pv.u * Math.sin(pv.yaw) - v.u * Math.sin(v.yaw)) * dpz;
        if (ahead > 0.25 && closing > 0 && pv.speed() > 9) {
          ai.panic = 1;
        }
      }
    }
    if (ai.panic > 0) {
      ai.panic -= dt * 0.6;
      if (!ai.flee) target *= 0.35;
    }

    // ---- unstick: nudged onto a kerb or wedged against a wall
    if (speed < 0.7 && target > 2) {
      ai.stuck += dt;
      if (ai.stuck > 3.5) {
        input.throttle = 0; input.brake = 0; input.steer = -input.steer;
        v.reverse = true;
        input.throttle = 0.6;
        if (ai.stuck > 5.4) { ai.stuck = 0; v.reverse = false; }
        return;
      }
    } else { ai.stuck = 0; v.reverse = false; }

    // ---- throttle / brake from the speed error
    var errV = target - speed;
    if (errV > 0.4) {
      input.throttle = M.clamp(errV * 0.30, 0, 1);
      input.brake = 0;
    } else if (errV < -0.6) {
      input.throttle = 0;
      input.brake = M.clamp(-errV * 0.34, 0, 1);
    } else {
      input.throttle = M.clamp(errV * 0.2 + 0.06, 0, 0.35);
      input.brake = 0;
    }
    input.handbrake = 0;
  };

  Traffic.prototype.chooseNextEdge = function (v, node) {
    var ai = v.ai, L = this.L;
    var options = [];
    for (var i = 0; i < node.edges.length; i++) {
      var eid = node.edges[i];
      var e = L.edges[eid];
      if (e === ai.edge) continue;
      var other = Roads.otherNode(e, node.id);
      var dir = e.a === node.id ? 1 : -1;
      // straight on is the axis we are already travelling
      var turn = e.axis === ai.edge.axis ? 'straight' : 'turn';
      options.push({ edge: e, dir: dir, lane: 0, turn: turn, other: other });
    }
    if (!options.length) {
      // dead end: turn around
      ai.dir = -ai.dir;
      ai.nextEdge = null;
      return;
    }
    // prefer going straight; the grid then reads as through-traffic
    var pick = null;
    if (ai.flee) {
      // A runner takes whichever exit opens the most distance on the player.
      // It is a one-junction lookahead, not a plan, which is exactly what an
      // evading driver looks like: mostly away, occasionally into a corner.
      var pl = this.game.player;
      var best = -1;
      for (var oi = 0; oi < options.length; oi++) {
        var on = L.nodes[options[oi].other];
        var score = pl ? M.dist(on.x, on.z, pl.pos.x, pl.pos.z) : this.rng();
        score *= 0.75 + this.rng() * 0.5;
        if (options[oi].turn === 'straight') score *= 1.12;
        if (score > best) { best = score; pick = options[oi]; }
      }
    }
    if (!pick) {
      var straight = options.filter(function (o) { return o.turn === 'straight'; });
      if (straight.length && this.rng.chance(0.62)) pick = straight[this.rng.int(0, straight.length - 1)];
      else pick = options[this.rng.int(0, options.length - 1)];
    }

    pick.lane = pick.edge.lanes > 1 ? this.rng.int(0, pick.edge.lanes - 1) : 0;
    ai.edge = pick.edge;
    ai.dir = pick.dir;
    ai.lane = pick.lane;
    ai.nextEdge = null;
    // pre-pick the following edge so the lookahead can round the corner
    var nodeAfter = L.nodes[Roads.otherNode(pick.edge, node.id)];
    if (nodeAfter) {
      for (i = 0; i < nodeAfter.edges.length; i++) {
        var e2 = L.edges[nodeAfter.edges[i]];
        if (e2 === pick.edge) continue;
        if (e2.axis === pick.edge.axis) {
          ai.nextEdge = { edge: e2, dir: e2.a === nodeAfter.id ? 1 : -1, lane: pick.lane, turn: 'straight' };
          break;
        }
      }
    }
  };

  // Distance and speed of the nearest car in front, along our heading.
  var _gap = { dist: 999, speed: 99, car: null };
  Traffic.prototype.gapAhead = function (v, maxDist) {
    _gap.dist = 999; _gap.speed = 99; _gap.car = null;
    var cx = Math.cos(v.yaw), cz = Math.sin(v.yaw);
    var list = this.grid.queryPoint(v.pos.x + cx * maxDist * 0.5, v.pos.z + cz * maxDist * 0.5,
      maxDist * 0.6 + 6, this._q, this._stamp++);
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === v) continue;
      var dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
      var along = dx * cx + dz * cz;
      if (along <= 0.5 || along > maxDist) continue;
      var lat = Math.abs(-dx * cz + dz * cx);
      if (lat > 2.1 + along * 0.045) continue;
      var d = along - (v.spec.len + o.spec.len) * 0.5;
      if (d < _gap.dist) {
        _gap.dist = Math.max(0, d);
        _gap.speed = Math.max(0, o.u * (Math.cos(o.yaw) * cx + Math.sin(o.yaw) * cz));
        _gap.car = o;
      }
    }
    return _gap;
  };

  // ------------------------------------------------- car versus car --------
  // Two-circle overlap with an impulse exchange. Enough to make pile-ups
  // behave, without a full rigid body solver.
  Traffic.prototype.resolveCarCollisions = function (dt) {
    var all = this._all;
    if (!all) return;
    for (var i = 0; i < all.length; i++) {
      var a = all[i];
      var ra = a.spec.wid * 0.52, la = a.spec.len * 0.29;
      var list = this.grid.queryPoint(a.pos.x, a.pos.z, a.spec.len * 0.7 + 3, this._q, this._stamp++);
      for (var j = 0; j < list.length; j++) {
        var b = list[j];
        // each pair is resolved exactly once
        if (b.__idx <= a.__idx) continue;
        var rb = b.spec.wid * 0.52, lb = b.spec.len * 0.29;
        var ca = Math.cos(a.yaw), sa = Math.sin(a.yaw);
        var cb = Math.cos(b.yaw), sb = Math.sin(b.yaw);
        for (var ai2 = -1; ai2 <= 1; ai2 += 2) {
          for (var bi = -1; bi <= 1; bi += 2) {
            var ax = a.pos.x + ca * la * ai2, az = a.pos.z + sa * la * ai2;
            var bx = b.pos.x + cb * lb * bi, bz = b.pos.z + sb * lb * bi;
            var dx = bx - ax, dz = bz - az;
            var d2 = dx * dx + dz * dz;
            var rr = ra + rb;
            if (d2 >= rr * rr || d2 < 1e-8) continue;
            var d = Math.sqrt(d2);
            var nx = dx / d, nz = dz / d;
            var pen = rr - d;

            var ma = a.spec.mass, mb = b.spec.mass;
            var total = ma + mb;
            var pushA = pen * (mb / total), pushB = pen * (ma / total);
            // the player's car never gets shoved off its own line as easily
            if (a.isPlayer) { pushA *= 0.35; pushB += pen * 0.35 * (mb / total); }
            if (b.isPlayer) { pushB *= 0.35; pushA += pen * 0.35 * (ma / total); }
            a.pos.x -= nx * pushA; a.pos.z -= nz * pushA;
            b.pos.x += nx * pushB; b.pos.z += nz * pushB;

            // relative velocity along the contact normal
            var avx = a.u * ca - a.v * sa, avz = a.u * sa + a.v * ca;
            var bvx = b.u * cb - b.v * sb, bvz = b.u * sb + b.v * cb;
            var rvx = bvx - avx, rvz = bvz - avz;
            var vn = rvx * nx + rvz * nz;
            if (vn > 0) continue;              // already separating
            var e = 0.18;
            var jimp = -(1 + e) * vn / (1 / ma + 1 / mb);
            avx -= jimp * nx / ma; avz -= jimp * nz / ma;
            bvx += jimp * nx / mb; bvz += jimp * nz / mb;
            a.u = avx * ca + avz * sa; a.v = -avx * sa + avz * ca;
            b.u = bvx * cb + bvz * sb; b.v = -bvx * sb + bvz * cb;

            // spin from an off-centre hit
            a.yawRate += (-nx * sa + nz * ca) * ai2 * pen * 3.2;
            b.yawRate -= (-nx * sb + nz * cb) * bi * pen * 3.2;

            var impact = -vn;
            if (impact > 2.2) {
              var dmg = impact * impact * 0.55;
              a.damage(dmg * (mb / total) * 2, 'car');
              b.damage(dmg * (ma / total) * 2, 'car');
              // Heavy units can turn a clean hit into a real gameplay event:
              // the ram plate is a short-lived impact charge, while the
              // armored unit's detonator makes the struck vehicle explode.
              var charged = a.ramActive || b.ramActive;
              if (charged && impact > 4) {
                var attacker = a.ramActive ? a : b;
                var target = attacker === a ? b : a;
                target.damage(target.maxHealth + 1, attacker.spec.ability === 'detonator' ? 'impact-charge' : 'ram');
                if (!target.isPlayer) target.exploded = true;
                attacker.ramActive = false;
                attacker.abilityT = 0;
                if (this.game.fx) this.game.fx.explosion(target.pos.x, target.pos.y + 0.4, target.pos.z,
                  attacker.spec.ability === 'detonator' ? 0.78 : 0.42);
                if (this.game.audio) this.game.audio.explosion(target.pos.x, target.pos.y, target.pos.z);
              }
              if (a.dormant) a.dormant = false;
              if (b.dormant) b.dormant = false;
              if (a.ai) a.ai.panic = 1.5;
              if (b.ai) b.ai.panic = 1.5;
              this.onCrash(a, b, impact, (ax + bx) / 2, (az + bz) / 2);
            }
          }
        }
      }
    }
  };

  Traffic.prototype.onCrash = function (a, b, impact, x, z) {
    var g = this.game;
    if (g.fx && impact > 3) {
      for (var i = 0; i < Math.min(9, impact); i++) {
        g.fx.spark(x, 0.7, z, (Math.random() - 0.5) * 7, Math.random() * 5, (Math.random() - 0.5) * 7);
      }
    }
    if (g.audio) g.audio.crash(x, 0.8, z, M.clamp(impact / 16, 0.2, 1));
    var playerInvolved = a.isPlayer || b.isPlayer;
    if (playerInvolved && impact > 5) {
      var p = g.player;
      p.shake = Math.min(1.2, p.shake + impact * 0.035);
      p.takeDamage(Math.max(0, (impact - 8) * 1.6), 'crash');
      if (g.police && impact > 9) g.police.reportCrime('reckless', 0.35);
    }
  };

  Traffic.prototype.blowUp = function (v) {
    if (this.game.fx) this.game.fx.explosion(v.pos.x, v.pos.y, v.pos.z, 1.2);
    if (this.game.audio) this.game.audio.explosion(v.pos.x, v.pos.y, v.pos.z);
    if (v.spot) v.spot.taken = false;
    // chain reaction: nearby cars take a hit too
    var list = this.grid.queryPoint(v.pos.x, v.pos.z, 9, this._q, this._stamp++);
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (o === v) continue;
      var d = M.dist(o.pos.x, o.pos.z, v.pos.x, v.pos.z);
      if (d < 9) o.damage((9 - d) * 90, 'blast');
    }
    if (this.game.player) {
      var pd = M.dist(this.game.player.pos.x, this.game.player.pos.z, v.pos.x, v.pos.z);
      if (pd < 9) this.game.player.takeDamage((9 - pd) * 11, 'blast');
    }
    if (this.game.peds) this.game.peds.scare(v.pos.x, v.pos.z, 40);
  };

  // Player on foot being hit by a moving car.
  Traffic.prototype.checkPedestrianHit = function (player, dt) {
    var list = this.grid.queryPoint(player.pos.x, player.pos.z, 4, this._q, this._stamp++);
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      var sp = v.speed();
      if (sp < 2.4) continue;
      var dx = player.pos.x - v.pos.x, dz = player.pos.z - v.pos.z;
      var ca = Math.cos(v.yaw), sa = Math.sin(v.yaw);
      var along = dx * ca + dz * sa, lat = -dx * sa + dz * ca;
      if (Math.abs(along) > v.spec.len * 0.5 + 0.4 || Math.abs(lat) > v.spec.wid * 0.5 + 0.4) continue;
      if (player.pos.y > v.pos.y + 1.6) continue;
      player.takeDamage(sp * 3.4, 'vehicle');
      player.vel.x += ca * sp * 0.75;
      player.vel.z += sa * sp * 0.75;
      player.vel.y = Math.max(player.vel.y, 3.4);
      player.grounded = false;
      if (this.game.fx) this.game.fx.impact(player.pos.x, player.pos.y + 0.9, player.pos.z, 0, 1, 0, 'flesh');
      break;
    }
  };

  // Used by missions to hand the player a specific car.
  Traffic.prototype.spawnMissionCar = function (type, x, z, yaw, color) {
    var v = this.spawnParked(type, x, z, yaw, color);
    v.mission = true;
    return v;
  };

  // A car that runs. It joins the ordinary traffic AI - same lanes, same
  // signals, same collision handling - with the evasion flag set and a cruise
  // speed well above the flow, so chasing one means real traffic weaving
  // rather than a scripted rail.
  Traffic.prototype.spawnRunner = function (type, x, z, opts) {
    opts = opts || {};
    var spot = Roads.randomLanePoint(this.L, this.rng, x, z, 0, 40, this._pt);
    var v = this.acquire(type || 'sports');
    Roads.laneDir(this.L, spot.edge, spot.dir, this._dir);
    v.placeAt(spot.x, spot.z, Math.atan2(this._dir.z, this._dir.x));
    v.dormant = false;
    v.mission = true;
    if (opts.color !== undefined && v.setColor) v.setColor(opts.color);
    v.ai = {
      edge: spot.edge, dir: spot.dir, lane: spot.lane, t: 0.5,
      cruise: opts.cruise || 24,
      patience: 2.6, panic: 0, stuck: 0, honk: 0, changeCd: 99,
      flee: true
    };
    v.u = v.ai.cruise * 0.6;
    this.active.push(v);
    return v;
  };

  Traffic.prototype.render = function (dt, lamps) {
    var i;
    for (i = 0; i < this.active.length; i++) this.updateCarVisual(this.active[i], dt, lamps);
    for (i = 0; i < this.loose.length; i++) this.updateCarVisual(this.loose[i], dt, lamps);
    for (i = 0; i < this.parked.length; i++) this.updateCarVisual(this.parked[i], dt, lamps);
  };

  Traffic.prototype.updateCarVisual = function (v, dt, lamps) {
    if (v.isPlayer) return;                 // the player module drives that one
    v.updateVisual(dt, lamps);
    this.carEffects(v, dt);
  };

  // Shared by every car including the player's: rubber, smoke, fire.
  Traffic.prototype.carEffects = function (v, dt) {
    var fx = this.game.fx;
    if (!fx) return;
    var cam = this.game.camera;
    var near = M.dist2(v.pos.x, v.pos.z, cam.position.x, cam.position.z) < 110 * 110;
    if (!near) return;

    if (v.skid > 0.16 && v.grounded) {
      var ca = Math.cos(v.yaw), sa = Math.sin(v.yaw);
      for (var w = 2; w < 4; w++) {
        var wh = v.wheels[w];
        var wx = v.pos.x + wh.x * ca - wh.z * sa;
        var wz = v.pos.z + wh.x * sa + wh.z * ca;
        fx.skids.stamp(v.__id + ':' + w, wx, wh.groundY, wz, ca, sa,
          v.spec.wid * 0.09 + 0.07, M.clamp(v.skid * 0.85, 0, 0.8));
      }
      fx.tireSmoke(v.pos.x - ca * v.spec.len * 0.3, v.wheels[2].groundY,
        v.pos.z - sa * v.spec.len * 0.3, v.u * ca, v.u * sa, v.skid);
    }
    if (v.smoking && !v.destroyed && Math.random() < 0.35) {
      fx.smoke(v.pos.x + Math.cos(v.yaw) * v.spec.len * 0.42, v.pos.y + 0.7,
        v.pos.z + Math.sin(v.yaw) * v.spec.len * 0.42,
        (Math.random() - 0.5) * 0.7, 1.6, (Math.random() - 0.5) * 0.7, 0.4, 1.4, 0x5a5a5a, 0.4);
    }
    if (v.burning > 0) {
      fx.smoke(v.pos.x, v.pos.y + 0.9, v.pos.z,
        (Math.random() - 0.5) * 1.4, 3.0, (Math.random() - 0.5) * 1.4, 0.7, 1.6, 0x2b2724, 0.7);
      if (Math.random() < 0.6) {
        fx.sparkSet.emit(v.pos.x + (Math.random() - 0.5), v.pos.y + 0.7, v.pos.z + (Math.random() - 0.5),
          (Math.random() - 0.5) * 2, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 2,
          0.6, 0.4, 0.4, 0xff7a1e, 1, 1.2, -2);
      }
    }
  };

  SB.Traffic = Traffic;

  // Stable per-vehicle id used as a key for skid trails.
  var nextId = 1;
  var origPlace = SB.Vehicle.prototype.placeAt;
  SB.Vehicle.prototype.placeAt = function (x, z, yaw) {
    if (!this.__id) this.__id = 'v' + (nextId++);
    return origPlace.call(this, x, z, yaw);
  };

})(window.SB = window.SB || {});
