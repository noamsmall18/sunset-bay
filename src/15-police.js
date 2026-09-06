// 15-police.js - the wanted system: heat, pursuit driving, cops on foot,
// roadblocks, the helicopter, and the search that lets you shake them.
(function (SB) {
  'use strict';

  var M = SB.M, Roads = SB.Roads;

  // cars, foot cops per car, and how hard they push, by star level
  var LEVELS = [
    { cars: 0, foot: 0, aggression: 0, heli: false, swat: false, spawnDist: 0 },
    { cars: 2, foot: 0, aggression: 0.35, heli: false, swat: false, spawnDist: 120 },
    { cars: 3, foot: 1, aggression: 0.55, heli: false, swat: false, spawnDist: 110 },
    { cars: 5, foot: 1, aggression: 0.75, heli: false, swat: false, spawnDist: 100, roadblocks: true },
    { cars: 6, foot: 2, aggression: 0.90, heli: true, swat: false, spawnDist: 95, roadblocks: true },
    { cars: 8, foot: 2, aggression: 1.00, heli: true, swat: true, spawnDist: 90, roadblocks: true }
  ];

  var CRIME_HEAT = {
    reckless: 0.16, assault: 0.45, gunfire: 0.40, kill: 1.05,
    shootCop: 1.15, killCop: 1.6, destroyCop: 1.3, theft: 0.30, ramCop: 0.5
  };

  function Police(game) {
    this.game = game;
    this.L = game.layout;
    this.world = game.world;
    this.scene = game.scene;
    this.rng = M.rng(5150);

    this.heat = 0;
    this.stars = 0;
    this.seen = false;
    this.searchTimer = 0;
    this.lastSeenX = 0;
    this.lastSeenZ = 0;
    this.cars = [];
    this.cops = [];
    this.spawnTimer = 0;
    this.roadblockTimer = 0;
    this.heli = null;
    this.copPool = [];
    this.busted = false;
    this.bustTimer = 0;
    this._v = new THREE.Vector3();
  }

  // --------------------------------------------------------------- heat ---
  Police.prototype.reportCrime = function (type, scale) {
    var w = (CRIME_HEAT[type] || 0.2) * (scale === undefined ? 1 : scale);
    // crimes nobody witnesses still count a little, but not much
    var witness = this.seen || this.anyoneWatching();
    this.addHeat(w * (witness ? 1 : 0.45));
  };

  Police.prototype.addHeat = function (w) {
    var before = this.stars;
    this.heat = M.clamp(this.heat + w, 0, 5.99);
    this.stars = Math.min(5, Math.floor(this.heat));
    if (this.stars > before) {
      this.game.bus.emit('wantedUp', this.stars);
      if (this.game.audio) this.game.audio.blip('wanted');
      this.searchTimer = 0;
    }
  };

  Police.prototype.anyoneWatching = function () {
    var g = this.game;
    if (!g.peds) return false;
    var p = g.player;
    for (var i = 0; i < g.peds.list.length; i++) {
      var ped = g.peds.list[i];
      if (ped.dead) continue;
      if (M.dist2(ped.x, ped.z, p.pos.x, p.pos.z) < 40 * 40) return true;
    }
    return false;
  };

  Police.prototype.clearWanted = function () {
    this.heat = 0;
    this.stars = 0;
    this.searchTimer = 0;
    this.despawnAll();
    this.game.bus.emit('wantedCleared', {});
  };

  Police.prototype.despawnAll = function () {
    var tr = this.game.traffic;
    for (var i = 0; i < this.cars.length; i++) {
      if (tr) tr.recycle(this.cars[i]); else this.cars[i].group.visible = false;
    }
    this.cars.length = 0;
    for (i = 0; i < this.cops.length; i++) this.recycleCop(this.cops[i]);
    this.cops.length = 0;
    if (this.heli) { this.heli.group.visible = false; this.heli.active = false; }
  };

  // --------------------------------------------------------------- step ---
  Police.prototype.fixed = function (dt) {
    var g = this.game, p = g.player;
    if (!p) return;
    var lvl = LEVELS[this.stars];

    this.updateVisibility(dt);

    // cooling off: the star drops once they lose you for long enough
    if (this.stars > 0) {
      if (this.seen) {
        this.searchTimer = 0;
      } else {
        this.searchTimer += dt;
        var need = 7 + this.stars * 3.5;
        if (this.searchTimer > need) {
          this.searchTimer = 0;
          this.heat = Math.max(0, Math.floor(this.heat) - 1 + 0.001);
          this.stars = Math.min(5, Math.floor(this.heat));
          this.game.bus.emit('wantedDown', this.stars);
          if (this.stars === 0) this.despawnAll();
        }
      }
    } else if (this.heat > 0) {
      this.heat = Math.max(0, this.heat - dt * 0.09);
    }

    // ---- population
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.stars > 0) {
      this.spawnTimer = 1.4;
      if (this.cars.length < lvl.cars) this.spawnCar(lvl);
    }
    if (this.stars >= 4 && lvl.heli) this.ensureHeli();
    else if (this.heli && this.heli.active) this.heli.active = false;

    if (lvl.roadblocks) {
      this.roadblockTimer -= dt;
      if (this.roadblockTimer <= 0) {
        this.roadblockTimer = 16;
        this.tryRoadblock();
      }
    }

    // ---- cars
    var i;
    for (i = this.cars.length - 1; i >= 0; i--) {
      var v = this.cars[i];
      if (v.exploded || (this.stars === 0)) {
        if (v.exploded) {
          if (g.traffic) g.traffic.blowUp(v);
          this.reportCrime('destroyCop', 1);
        }
        if (g.traffic) g.traffic.recycle(v); else v.group.visible = false;
        this.cars.splice(i, 1);
        continue;
      }
      if (M.dist2(v.pos.x, v.pos.z, p.pos.x, p.pos.z) > 340 * 340) {
        if (g.traffic) g.traffic.recycle(v);
        this.cars.splice(i, 1);
        continue;
      }
      this.drivePursuit(v, dt, lvl);
      v.step(dt, v._in);
    }

    // ---- foot cops
    for (i = this.cops.length - 1; i >= 0; i--) {
      var c = this.cops[i];
      if (c.dead) {
        c.deadTime += dt;
        if (c.deadTime > 25) { this.recycleCop(c); this.cops.splice(i, 1); }
        continue;
      }
      if (this.stars === 0 || M.dist2(c.x, c.z, p.pos.x, p.pos.z) > 260 * 260) {
        this.recycleCop(c);
        this.cops.splice(i, 1);
        continue;
      }
      this.stepCop(c, dt, lvl);
    }

    if (this.heli && this.heli.active) this.stepHeli(dt, lvl);

    // ---- busted: surrounded on foot with stars up
    this.checkBusted(dt);
  };

  Police.prototype.updateVisibility = function (dt) {
    var p = this.game.player;
    var px = p.pos.x, py = p.pos.y + 1.2, pz = p.pos.z;
    this.seen = false;
    var i;
    for (i = 0; i < this.cars.length; i++) {
      var v = this.cars[i];
      if (v.destroyed) continue;
      var d = M.dist(v.pos.x, v.pos.z, px, pz);
      if (d > 95) continue;
      if (!this.world.blocked(v.pos.x, v.pos.y + 1.1, v.pos.z, px, py, pz)) { this.seen = true; break; }
    }
    if (!this.seen) {
      for (i = 0; i < this.cops.length; i++) {
        var c = this.cops[i];
        if (c.dead) continue;
        if (M.dist(c.x, c.z, px, pz) > 70) continue;
        if (!this.world.blocked(c.x, c.y + 1.5, c.z, px, py, pz)) { this.seen = true; break; }
      }
    }
    if (!this.seen && this.heli && this.heli.active) {
      if (M.dist(this.heli.x, this.heli.z, px, pz) < 110) this.seen = true;
    }
    if (this.seen) { this.lastSeenX = px; this.lastSeenZ = pz; }
  };

  // ------------------------------------------------------------ spawning --
  Police.prototype.spawnCar = function (lvl) {
    var g = this.game, p = g.player;
    var tr = g.traffic;
    if (!tr) return;
    var pt = { x: 0, z: 0 };
    var spot = Roads.randomLanePoint(this.L, this.rng, p.pos.x, p.pos.z,
      lvl.spawnDist, lvl.spawnDist + 90, pt);
    if (tr.occupied(spot.x, spot.z, 7)) return;
    var v = tr.acquire('police');
    v.setColor(0xe8e8ea);
    var dir = { x: 0, z: 0 };
    Roads.laneDir(this.L, spot.edge, spot.dir, dir);
    v.placeAt(spot.x, spot.z, Math.atan2(dir.z, dir.x));
    v.sirenOn = true;
    v.isCop = true;
    v._in = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    v.pursuit = {
      edge: spot.edge, dir: spot.dir, lane: spot.lane,
      mode: 'route', targetNode: -1, reroute: 0, stuck: 0,
      exitTimer: this.rng.range(1.5, 4)
    };
    v.u = 14;
    this.cars.push(v);
    if (g.audio) g.audio.startSiren(v);
  };

  Police.prototype.tryRoadblock = function () {
    var g = this.game, p = g.player, tr = g.traffic;
    if (!tr || !p.vehicle) return;
    // place it on the road the player is heading toward
    var v = p.vehicle;
    var ahead = 95;
    var tx = v.pos.x + Math.cos(v.yaw) * ahead;
    var tz = v.pos.z + Math.sin(v.yaw) * ahead;
    var node = Roads.nearestNode(this.L, tx, tz);
    if (M.dist(node.x, node.z, p.pos.x, p.pos.z) < 55) return;
    if (this.cars.length >= LEVELS[this.stars].cars + 2) return;
    var across = Math.abs(Math.cos(v.yaw)) > 0.5 ? 'z' : 'x';
    for (var i = -1; i <= 1; i++) {
      var bx = node.x + (across === 'z' ? 0 : i * 4.4);
      var bz = node.z + (across === 'z' ? i * 4.4 : 0);
      if (tr.occupied(bx, bz, 4)) continue;
      var car = tr.acquire('police');
      car.setColor(0xe8e8ea);
      car.placeAt(bx, bz, across === 'z' ? Math.PI / 2 : 0);
      car.sirenOn = true;
      car.isCop = true;
      car._in = { throttle: 0, brake: 1, steer: 0, handbrake: 1 };
      car.pursuit = { mode: 'block', edge: null, dir: 1, lane: 0, reroute: 0, stuck: 0, exitTimer: 0.6 };
      this.cars.push(car);
    }
    this.game.bus.emit('roadblock', node);
  };

  // ------------------------------------------------------------- driving --
  var _tgt = { x: 0, z: 0 };

  Police.prototype.drivePursuit = function (v, dt, lvl) {
    var g = this.game, p = g.player;
    var pu = v.pursuit;
    var input = v._in;
    if (v.destroyed) {
      input.throttle = 0; input.brake = 1; input.steer = 0; input.handbrake = 1;
      if (pu.mode !== 'wreck') { pu.mode = 'wreck'; this.dropCops(v, 1); }
      return;
    }

    var px = p.pos.x, pz = p.pos.z;
    var dist = M.dist(v.pos.x, v.pos.z, px, pz);
    var los = !this.world.blocked(v.pos.x, v.pos.y + 1.1, v.pos.z, px, p.pos.y + 1.2, pz);

    if (pu.mode === 'block') {
      // sit still until the player is close, then join the chase
      if (dist < 34) { pu.mode = 'route'; input.handbrake = 0; }
      else {
        input.throttle = 0; input.brake = 1; input.handbrake = 1; input.steer = 0;
        if (pu.exitTimer > 0) { pu.exitTimer -= dt; if (pu.exitTimer <= 0) this.dropCops(v, 1); }
        return;
      }
    }

    // Close and visible: drive straight at the player with a lead.
    var direct = dist < 70 && los;
    if (direct) {
      var lead = p.vehicle ? M.clamp(dist / 22, 0, 1.4) : 0;
      _tgt.x = px + (p.vehicle ? p.vehicle.u * Math.cos(p.vehicle.yaw) * lead : 0);
      _tgt.z = pz + (p.vehicle ? p.vehicle.u * Math.sin(p.vehicle.yaw) * lead : 0);
      pu.mode = 'chase';
    } else {
      // Otherwise route over the road graph toward the player's nearest node.
      pu.reroute -= dt;
      if (pu.reroute <= 0 || pu.targetNode < 0) {
        pu.reroute = 0.9;
        var from = Roads.nearestNode(this.L, v.pos.x, v.pos.z);
        var to = Roads.nearestNode(this.L, this.seen ? px : this.lastSeenX,
          this.seen ? pz : this.lastSeenZ);
        pu.targetNode = Roads.routeStep(this.L, from.id, to.id);
        pu.mode = 'route';
      }
      var n = this.L.nodes[pu.targetNode];
      _tgt.x = n.x; _tgt.z = n.z;
      if (M.dist(v.pos.x, v.pos.z, n.x, n.z) < 12) pu.reroute = 0;
    }

    var err = M.angleDelta(v.yaw, Math.atan2(_tgt.z - v.pos.z, _tgt.x - v.pos.x));
    input.steer = M.clamp(err * 2.1, -1, 1);

    // avoid the car in front unless it is the target
    var speed = Math.max(0, v.u);
    var want = direct ? 30 * (0.6 + lvl.aggression * 0.6) : 22 + lvl.aggression * 8;
    if (p.vehicle) want = Math.max(want, p.vehicle.speed() * 1.18 + 4);
    want *= M.lerp(1, 0.55, M.clamp(Math.abs(err) / 0.9, 0, 1));

    if (g.traffic) {
      var gap = g.traffic.gapAhead(v, 26);
      if (gap.car && gap.car !== p.vehicle && gap.dist < 12) {
        want = Math.min(want, Math.max(3, gap.speed));
      }
    }
    // ram the player when close behind
    if (direct && dist < 9 && p.vehicle) want += 10;

    var errV = want - speed;
    if (errV > 0.5) { input.throttle = M.clamp(errV * 0.4, 0, 1); input.brake = 0; }
    else { input.throttle = 0; input.brake = M.clamp(-errV * 0.30, 0, 1); }

    // handbrake turn when badly misaligned at speed
    input.handbrake = (Math.abs(err) > 1.5 && speed > 16) ? 1 : 0;

    // unstick
    if (speed < 0.8 && want > 4) {
      pu.stuck += dt;
      if (pu.stuck > 2.4) {
        v.reverse = true; input.throttle = 0.8; input.brake = 0; input.steer = -input.steer;
        if (pu.stuck > 4.2) { pu.stuck = 0; v.reverse = false; }
        return;
      }
    } else { pu.stuck = 0; v.reverse = false; }

    // deploy officers when the player is on foot or pinned
    var playerOnFoot = p.mode === 'foot';
    if (pu.exitTimer > 0 && (playerOnFoot || (p.vehicle && p.vehicle.speed() < 3)) && dist < 26 && speed < 4) {
      pu.exitTimer -= dt;
      if (pu.exitTimer <= 0) this.dropCops(v, LEVELS[this.stars].foot || 1);
    }
  };

  // -------------------------------------------------------- foot officers --
  Police.prototype.acquireCop = function (swat) {
    var c;
    if (this.copPool.length) {
      c = this.copPool.pop();
      c.char.root.visible = true;
      c.char.state = 'idle';
      c.char.deathT = 0;
      c.char.root.rotation.set(0, 0, 0);
    } else {
      c = {
        char: new SB.Character({
          shirt: swat ? 0x23262b : 0x1e3357, pants: swat ? 0x1a1d21 : 0x1b2438,
          hat: swat ? 0x15181c : 0x16223a, vest: swat ? 0x2b2f36 : 0x24304a,
          skin: SB.CHAR_PALETTES.SKIN[Math.floor(Math.random() * SB.CHAR_PALETTES.SKIN.length)],
          scale: 1.02
        }),
        x: 0, y: 0, z: 0, yaw: 0, speed: 0
      };
      var gun = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.09, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.5, metalness: 0.6 }));
      gun.rotation.z = Math.PI / 2;
      c.char.setWeapon(gun);
      this.scene.add(c.char.root);
    }
    c.health = swat ? 150 : 100;
    c.dead = false;
    c.deadTime = 0;
    c.fireCd = this.rng.range(0.4, 1.4);
    c.burst = 0;
    c.state = 'advance';
    c.swat = !!swat;
    return c;
  };

  Police.prototype.recycleCop = function (c) {
    c.char.root.visible = false;
    c.x = 0; c.z = 0; c.y = -500;
    this.copPool.push(c);
  };

  Police.prototype.dropCops = function (v, n) {
    if (this.stars === 0) return;
    var swat = LEVELS[this.stars].swat;
    for (var i = 0; i < n; i++) {
      var c = this.acquireCop(swat);
      var pt = new THREE.Vector3();
      v.doorPoint(i % 2 === 0 ? 1 : -1, pt);
      c.x = pt.x; c.z = pt.z;
      var srf = this.world.surfaceAt(c.x, c.z, v.pos.y + 1, 1.6);
      c.y = srf.y;
      c.yaw = v.yaw;
      this.cops.push(c);
    }
    if (v.pursuit) v.pursuit.exitTimer = 0;
  };

  Police.prototype.stepCop = function (c, dt, lvl) {
    var g = this.game, p = g.player;
    var dx = p.pos.x - c.x, dz = p.pos.z - c.z;
    var dist = Math.hypot(dx, dz);
    var los = !this.world.blocked(c.x, c.y + 1.5, c.z, p.pos.x, p.pos.y + 1.2, p.pos.z);
    var ux = dist > 0.01 ? dx / dist : 1, uz = dist > 0.01 ? dz / dist : 0;

    // hold at a shooting distance; close in if they cannot see you
    var want = 0;
    var ideal = c.swat ? 11 : 15;
    if (!los || dist > ideal + 4) want = c.swat ? 4.6 : 4.0;
    else if (dist < ideal - 5) want = -2.2;

    if (want !== 0) {
      var sp = Math.abs(want) * dt * (want > 0 ? 1 : -1);
      c.x += ux * sp; c.z += uz * sp;
      c.speed = Math.abs(want);
    } else {
      c.speed = M.damp(c.speed, 0, 9, dt);
    }
    c.yaw = M.dampAngle(c.yaw, Math.atan2(uz, ux), 10, dt);

    var out = {};
    if (this.world.resolveCircle(c.x, c.z, 0.36, c.y + 0.25, c.y + 1.7, out)) {
      c.x = out.x; c.z = out.z;
    }
    var srf = this.world.surfaceAt(c.x, c.z, c.y + 0.7, 0.9);
    c.y = M.damp(c.y, srf.y, 16, dt);

    // shooting
    c.fireCd -= dt;
    if (los && dist < 42 && c.fireCd <= 0 && !p.dead) {
      if (c.burst <= 0) c.burst = c.swat ? 4 : 2;
      c.burst--;
      c.fireCd = c.burst > 0 ? 0.12 : this.rng.range(0.9, 2.0) * (2 - lvl.aggression);
      this.copShoot(c, p, lvl);
    }
  };

  Police.prototype.copShoot = function (c, p, lvl) {
    var g = this.game;
    var ex = c.x, ey = c.y + 1.45, ez = c.z;
    var tx = p.pos.x, ty = p.pos.y + 1.0, tz = p.pos.z;
    var spread = (c.swat ? 0.030 : 0.055) * (2 - lvl.aggression);
    var dx = tx - ex + (Math.random() - 0.5) * spread * 40;
    var dy = ty - ey + (Math.random() - 0.5) * spread * 20;
    var dz = tz - ez + (Math.random() - 0.5) * spread * 40;
    var len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;

    if (g.fx) {
      g.fx.muzzle(ex + dx * 0.4, ey, ez + dz * 0.4, dx, dy, dz, 0.8);
      var hit = this.world.raycast(ex, ey, ez, dx, dy, dz, 60);
      var hd = hit ? hit.dist : 60;
      g.fx.tracers.add(ex + dx * 0.5, ey, ez + dz * 0.5, ex + dx * hd, ey + dy * hd, ez + dz * hd);
    }
    if (g.audio) g.audio.gunshot({ id: 'pistol', sound: 'pistol' }, ex, ey, ez);

    // did it land? compare the fired ray against the player capsule
    var toX = p.pos.x - ex, toY = (p.pos.y + 0.95) - ey, toZ = p.pos.z - ez;
    var proj = toX * dx + toY * dy + toZ * dz;
    if (proj <= 0) return;
    var cx = ex + dx * proj, cy = ey + dy * proj, cz = ez + dz * proj;
    var miss = Math.hypot(cx - p.pos.x, cy - (p.pos.y + 0.95), cz - p.pos.z);
    var radius = p.mode === 'car' ? 1.1 : 0.5;
    if (miss > radius) return;
    if (this.world.blocked(ex, ey, ez, p.pos.x, p.pos.y + 1, p.pos.z)) return;

    if (p.mode === 'car' && p.vehicle) {
      p.vehicle.damage(c.swat ? 26 : 16, 'gun');
      p.takeDamage(c.swat ? 5 : 3, 'gun', c.x, c.z);
    } else {
      p.takeDamage(c.swat ? 15 : 10, 'gun', c.x, c.z);
    }
  };

  Police.prototype.nearestCop = function (x, z, maxDist) {
    var best = null, bd = maxDist * maxDist;
    for (var i = 0; i < this.cops.length; i++) {
      var c = this.cops[i];
      if (c.dead) continue;
      var d = M.dist2(c.x, c.z, x, z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };

  Police.prototype.hurtCop = function (c, amount, dirX, dirZ) {
    if (c.dead) return;
    c.health -= amount;
    if (c.health <= 0) {
      c.dead = true;
      c.deadTime = 0;
      c.char.die();
      this.reportCrime('killCop', 1);
      this.game.bus.emit('copKilled', c);
    }
  };

  // ---------------------------------------------------------- helicopter --
  Police.prototype.ensureHeli = function () {
    if (!this.heli) this.heli = this.buildHeli();
    if (!this.heli.active) {
      this.heli.active = true;
      this.heli.group.visible = true;
      var p = this.game.player;
      this.heli.x = p.pos.x + 120;
      this.heli.z = p.pos.z + 120;
      this.heli.y = 62;
      this.heli.angle = 0;
    }
  };

  // Full detail comes from the same builder the player-flyable helicopter
  // uses (27-aircraft.js), so the pursuit chopper is not a placeholder capsule.
  Police.prototype.buildHeli = function () {
    var mesh = SB.buildHelicopter({ color: 0x1c2c3a, police: true });
    mesh.group.visible = false;
    this.scene.add(mesh.group);
    mesh.x = 0; mesh.y = 60; mesh.z = 0; mesh.angle = 0; mesh.active = false; mesh.fireCd = 3;
    return mesh;
  };

  Police.prototype.stepHeli = function (dt, lvl) {
    var h = this.heli, p = this.game.player;
    var tx = this.seen ? p.pos.x : this.lastSeenX;
    var tz = this.seen ? p.pos.z : this.lastSeenZ;
    h.angle += dt * 0.38;
    var orbit = 34;
    var wantX = tx + Math.cos(h.angle) * orbit;
    var wantZ = tz + Math.sin(h.angle) * orbit;
    h.x = M.damp(h.x, wantX, 0.9, dt);
    h.z = M.damp(h.z, wantZ, 0.9, dt);
    h.y = M.damp(h.y, 56, 0.7, dt);
    h.group.position.set(h.x, h.y, h.z);
    var face = Math.atan2(wantZ - h.z, wantX - h.x);
    h.group.rotation.y = -face + Math.PI / 2;
    h.group.rotation.x = 0.10;
    SB.stepHeliRotor(h, dt, true);

    var night = this.game.sky.lampFactor();
    h.cone.visible = night > 0.15;
    h.cone.material.opacity = night * 0.13;

    // marksman fire at five stars
    if (this.stars >= 5 && this.seen) {
      h.fireCd -= dt;
      if (h.fireCd <= 0) {
        h.fireCd = 1.4;
        var fake = { x: h.x, y: h.y - 2, z: h.z, swat: true };
        this.copShoot(fake, p, lvl);
      }
    }
  };

  // --------------------------------------------------------------- busted --
  Police.prototype.checkBusted = function (dt) {
    var p = this.game.player;
    if (this.stars === 0 || p.dead || p.mode === 'car') { this.bustTimer = 0; return; }
    var close = 0;
    for (var i = 0; i < this.cops.length; i++) {
      var c = this.cops[i];
      if (!c.dead && M.dist2(c.x, c.z, p.pos.x, p.pos.z) < 3.6 * 3.6) close++;
    }
    if (close >= 1 && Math.hypot(p.vel.x, p.vel.z) < 1.2) {
      this.bustTimer += dt;
      if (this.bustTimer > 2.0) {
        this.bustTimer = 0;
        this.bust();
      }
    } else {
      this.bustTimer = Math.max(0, this.bustTimer - dt);
    }
  };

  Police.prototype.bust = function () {
    var p = this.game.player;
    var fine = Math.min(p.money, 250 + this.stars * 400);
    p.money -= fine;
    this.clearWanted();
    if (this.game.combat) {
      // confiscated
      this.game.combat.clip.pistol = 0;
      this.game.combat.clip.smg = 0;
      this.game.combat.clip.shotgun = 0;
      this.game.combat.clip.rifle = 0;
    }
    var station = this.game.policeStation || { x: 62, z: -178 };
    p.pos.set(station.x, 0.3, station.z);
    var s = this.world.surfaceAt(p.pos.x, p.pos.z, 40, 50);
    p.pos.y = s.y;
    p.vel.set(0, 0, 0);
    p.health = p.maxHealth;
    if (this.game.post) this.game.post.resetHistory();
    this.game.bus.emit('busted', { fine: fine });
  };

  // -------------------------------------------------------------- render --
  Police.prototype.render = function (dt, lamps) {
    var i;
    for (i = 0; i < this.cars.length; i++) {
      var v = this.cars[i];
      v.updateVisual(dt, lamps);
      if (this.game.traffic) this.game.traffic.carEffects(v, dt);
    }
    for (i = 0; i < this.cops.length; i++) {
      var c = this.cops[i];
      c.char.setPos(c.x, c.y, c.z, c.yaw);
      c.char.animate(dt, c.dead ? 0 : c.speed, { aim: c.dead ? 0 : 1 });
    }
  };

  SB.Police = Police;

})(window.SB = window.SB || {});
