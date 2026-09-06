// 13-peds.js - pedestrians. They walk block perimeters, cross at corners,
// react to gunfire and traffic, and get run over if you drive like that.
(function (SB) {
  'use strict';

  var M = SB.M, Roads = SB.Roads;

  var MAX_PEDS = 44;
  var SPAWN_MIN = 26, SPAWN_MAX = 120, DESPAWN = 185;
  var WALK = 1.25, HURRY = 2.1, FLEE = 5.0;

  function Peds(game) {
    this.game = game;
    this.world = game.world;
    this.L = game.layout;
    this.scene = game.scene;
    this.rng = M.rng(0x5EED);
    this.list = [];
    this.pool = [];
    this.corpses = [];
    this.spawnTimer = 0;
    this.grid = new SB.Grid(14);
    this._q = [];
    this._stamp = 1;
    this.density = 1;     // interior gate: 0 while indoors
    this.rhythm = 1;      // time-of-day multiplier, owned by SB.Rhythm
    this.maxPeds = SB.Q.settings.peds;
  }

  Peds.prototype.acquire = function () {
    var p;
    if (this.pool.length) {
      p = this.pool.pop();
      p.char.root.visible = true;
      p.char.state = 'idle';
      p.char.deathT = 0;
      p.char.root.rotation.set(0, 0, 0);
      p.char.shadow.material.opacity = 0.35;
    } else {
      var rng = this.rng;
      p = {
        char: new SB.Character({ rng: function () { return rng(); } }),
        x: 0, y: 0, z: 0, yaw: 0, speed: 0, vy: 0
      };
      this.scene.add(p.char.root);
    }
    p.health = 100;
    p.dead = false;
    p.state = 'walk';
    p.flee = 0;
    p.wait = 0;
    p.crossT = 0;
    p.speedWant = WALK * this.rng.range(0.78, 1.30);
    return p;
  };

  Peds.prototype.recycle = function (p) {
    p.char.root.visible = false;
    p.x = 0; p.z = 0; p.y = -500;
    this.pool.push(p);
  };

  // Apply a lower population budget immediately when the player changes
  // graphics quality, rather than waiting for normal distance despawning.
  Peds.prototype.applyBudget = function () {
    while (this.list.length > this.maxPeds) this.recycle(this.list.pop());
  };

  // ------------------------------------------------------------- spawning --
  Peds.prototype.spawn = function (px, pz) {
    // pick a block whose perimeter is at a sensible distance from the player
    for (var tries = 0; tries < 24; tries++) {
      var blk = this.L.blocks[this.rng.int(0, this.L.blocks.length - 1)];
      var loop = Roads.sidewalkLoop(blk, 2.2);
      if (!loop || loop.length < 3) continue;
      var idx = this.rng.int(0, loop.length - 1);
      var t = this.rng();
      var a = loop[idx], b = loop[(idx + 1) % loop.length];
      var x = M.lerp(a.x, b.x, t), z = M.lerp(a.z, b.z, t);
      var d = M.dist(x, z, px, pz);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
      var p = this.acquire();
      p.block = blk;
      p.loop = loop;
      p.seg = idx;
      p.t = t;
      p.dirSign = this.rng.chance(0.5) ? 1 : -1;
      p.x = x; p.z = z;
      var srf = this.world.surfaceAt(x, z, 30, 40);
      p.y = srf.y;
      p.yaw = Math.atan2(b.z - a.z, b.x - a.x) * p.dirSign;
      this.list.push(p);
      return p;
    }
    return null;
  };

  Peds.prototype.spawnFleeingFrom = function (v) {
    var p = this.acquire();
    var pt = new THREE.Vector3();
    v.doorPoint(1, pt);
    p.x = pt.x; p.z = pt.z;
    var srf = this.world.surfaceAt(p.x, p.z, 30, 40);
    p.y = srf.y;
    p.block = this.nearestBlock(p.x, p.z);
    p.loop = Roads.sidewalkLoop(p.block, 2.2);
    if (!p.loop || p.loop.length < 3) p.loop = [{ x: p.x, z: p.z }, { x: p.x + 1, z: p.z }, { x: p.x, z: p.z + 1 }];
    p.seg = 0; p.t = 0; p.dirSign = 1;
    p.state = 'flee';
    p.flee = 7;
    p.fleeX = v.pos.x; p.fleeZ = v.pos.z;
    this.list.push(p);
    return p;
  };

  // Retire the furthest pedestrian when the hour calls for fewer of them.
  // Only ones well out of view, so nobody blinks out in front of you.
  Peds.prototype.trimFurthest = function (px, pz) {
    var worst = -1, wd = -1;
    for (var i = 0; i < this.list.length; i++) {
      var p = this.list[i];
      if (p.dead) continue;
      var d = M.dist2(p.x, p.z, px, pz);
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst < 0 || wd < 70 * 70) return;
    this.recycle(this.list.splice(worst, 1)[0]);
  };

  Peds.prototype.nearestBlock = function (x, z) {
    var best = this.L.blocks[0], bd = 1e18;
    for (var i = 0; i < this.L.blocks.length; i++) {
      var b = this.L.blocks[i];
      var d = M.dist2(b.cx, b.cz, x, z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  };

  // ---------------------------------------------------------------- step ---
  Peds.prototype.fixed = function (dt) {
    var g = this.game;
    var px = g.player ? g.player.pos.x : 0, pz = g.player ? g.player.pos.z : 0;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.22;
      var want = this.maxPeds * this.density * this.rhythm;
      if (this.list.length < want) {
        this.spawn(px, pz);
      } else if (this.list.length > want + 4) {
        this.trimFurthest(px, pz);
      }
    }

    this.grid.map.clear();
    var i, p;
    for (i = 0; i < this.list.length; i++) {
      p = this.list[i];
      this.grid.insert(p, p.x - 0.4, p.z - 0.4, p.x + 0.4, p.z + 0.4);
    }

    for (i = this.list.length - 1; i >= 0; i--) {
      p = this.list[i];
      if (p.dead) {
        p.deadTime += dt;
        if (p.deadTime > 22) {
          this.list.splice(i, 1);
          this.recycle(p);
        }
        continue;
      }
      if (M.dist2(p.x, p.z, px, pz) > DESPAWN * DESPAWN) {
        this.list.splice(i, 1);
        this.recycle(p);
        continue;
      }
      this.stepPed(p, dt, px, pz);
    }
  };

  Peds.prototype.stepPed = function (p, dt, px, pz) {
    var want = p.speedWant;
    var tx, tz;

    if (p.state === 'flee') {
      p.flee -= dt;
      if (p.flee <= 0) { p.state = 'walk'; }
      want = FLEE;
      var dx = p.x - p.fleeX, dz = p.z - p.fleeZ;
      var d = Math.hypot(dx, dz) || 1;
      tx = p.x + dx / d * 12;
      tz = p.z + dz / d * 12;
    } else if (p.state === 'cross') {
      tx = p.crossX; tz = p.crossZ;
      want = HURRY;
      if (M.dist2(p.x, p.z, tx, tz) < 1.6) {
        p.state = 'walk';
        p.block = p.crossBlock;
        p.loop = Roads.sidewalkLoop(p.block, 2.2);
        p.seg = p.crossSeg;
        p.t = p.crossT2;
      }
    } else if (p.state === 'wait') {
      p.wait -= dt;
      want = 0;
      tx = p.x; tz = p.z;
      if (p.wait <= 0) p.state = 'walk';
    } else {
      // walk the block perimeter
      var nSeg = p.loop.length;
      var a = p.loop[p.seg % nSeg], b = p.loop[(p.seg + 1) % nSeg];
      var segLen = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      p.t += (p.dirSign > 0 ? 1 : -1) * (want * dt) / segLen;
      if (p.t >= 1) {
        p.t = 0;
        p.seg = (p.seg + 1) % nSeg;
        this.maybeCross(p);
      } else if (p.t <= 0) {
        p.t = 1;
        p.seg = (p.seg + nSeg - 1) % nSeg;
        this.maybeCross(p);
      }
      a = p.loop[p.seg % nSeg]; b = p.loop[(p.seg + 1) % nSeg];
      tx = M.lerp(a.x, b.x, M.clamp(p.t, 0, 1));
      tz = M.lerp(a.z, b.z, M.clamp(p.t, 0, 1));
      // small chance of stopping to look at something
      if (this.rng() < dt * 0.05) { p.state = 'wait'; p.wait = this.rng.range(1, 4); }
    }

    // steer toward the target
    var ddx = tx - p.x, ddz = tz - p.z;
    var dd = Math.hypot(ddx, ddz);
    if (dd > 0.02) {
      var ux = ddx / dd, uz = ddz / dd;
      // separate from other pedestrians so crowds do not merge into one body
      var list = this.grid.queryPoint(p.x, p.z, 1.3, this._q, this._stamp++);
      var sx = 0, sz = 0;
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (o === p || o.dead) continue;
        var ox = p.x - o.x, oz = p.z - o.z;
        var od = Math.hypot(ox, oz);
        if (od > 1e-3 && od < 1.05) { sx += ox / od * (1.05 - od); sz += oz / od * (1.05 - od); }
      }
      ux += sx * 1.7; uz += sz * 1.7;
      var ul = Math.hypot(ux, uz) || 1;
      ux /= ul; uz /= ul;

      var step = Math.min(want, dd / Math.max(dt, 1e-4)) * dt;
      p.x += ux * step;
      p.z += uz * step;
      p.speed = step / dt;
      p.yaw = M.dampAngle(p.yaw, Math.atan2(uz, ux), 9, dt);
    } else {
      p.speed = M.damp(p.speed, 0, 8, dt);
    }

    // stay out of solid geometry
    var out = {};
    if (this.world.resolveCircle(p.x, p.z, 0.32, p.y + 0.2, p.y + 1.6, out)) {
      p.x = out.x; p.z = out.z;
    }
    var srf = this.world.surfaceAt(p.x, p.z, p.y + 0.6, 0.8);
    p.y = M.damp(p.y, srf.y, 18, dt);

    // dodge the player's car
    var pv = this.game.player && this.game.player.vehicle;
    if (pv && p.state !== 'flee') {
      var vd = M.dist(pv.pos.x, pv.pos.z, p.x, p.z);
      if (vd < 12 && pv.speed() > 5) {
        p.state = 'flee';
        p.flee = 2.6;
        p.fleeX = pv.pos.x; p.fleeZ = pv.pos.z;
      }
    }
    this.checkRunOver(p);
  };

  // At a corner, sometimes step off the kerb and cross to the block opposite.
  // With the grid gone there is no "block to the north" to index for, so the
  // pedestrian picks from the neighbours the layout recorded and walks to the
  // nearest point on that block's pavement - which works the same on a curved
  // street as it did on a straight one.
  Peds.prototype.maybeCross = function (p) {
    if (!this.rng.chance(0.30)) return;
    var blk = p.block;
    if (!blk || !blk.neighbors || !blk.neighbors.length) return;
    var target = blk.neighbors[this.rng.int(0, blk.neighbors.length - 1)];
    if (!target || target === blk) return;
    // only cross a street, never trek across half the district
    if (M.dist2(target.cx, target.cz, p.x, p.z) > 130 * 130) return;

    var tl = Roads.sidewalkLoop(target, 2.2);
    if (!tl || tl.length < 3) return;
    var best = 0, bd = 1e18;
    for (var k = 0; k < tl.length; k++) {
      var dd = M.dist2(tl[k].x, tl[k].z, p.x, p.z);
      if (dd < bd) { bd = dd; best = k; }
    }
    if (bd > 90 * 90) return;
    p.state = 'cross';
    p.crossX = tl[best].x;
    p.crossZ = tl[best].z;
    p.crossBlock = target;
    p.crossSeg = best;
    p.crossT2 = 0.02;
  };

  // ------------------------------------------------------------- damage ----
  Peds.prototype.checkRunOver = function (p) {
    var tr = this.game.traffic;
    if (!tr || !tr.grid) return;
    var list = tr.grid.queryPoint(p.x, p.z, 3.4, tr._q, tr._stamp++);
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      var sp = v.speed();
      if (sp < 2.2) continue;
      var dx = p.x - v.pos.x, dz = p.z - v.pos.z;
      var ca = Math.cos(v.yaw), sa = Math.sin(v.yaw);
      var along = dx * ca + dz * sa, lat = -dx * sa + dz * ca;
      if (Math.abs(along) > v.spec.len * 0.5 + 0.3 || Math.abs(lat) > v.spec.wid * 0.5 + 0.3) continue;
      this.kill(p, v.isPlayer ? 'player-vehicle' : 'vehicle', ca * sp, sa * sp);
      if (v.isPlayer && this.game.police) this.game.police.reportCrime('kill', 1);
      if (this.game.audio) this.game.audio.thud(p.x, p.y + 1, p.z);
      return;
    }
  };

  Peds.prototype.hurt = function (p, amount, source, dirX, dirZ) {
    if (p.dead) return;
    p.health -= amount;
    if (p.health <= 0) {
      this.kill(p, source, dirX, dirZ);
    } else {
      p.state = 'flee';
      p.flee = 9;
      p.fleeX = p.x - (dirX || 0) * 10;
      p.fleeZ = p.z - (dirZ || 0) * 10;
      this.scare(p.x, p.z, 26);
    }
  };

  Peds.prototype.kill = function (p, source, dirX, dirZ) {
    if (p.dead) return;
    p.dead = true;
    p.deadTime = 0;
    p.char.die();
    p.speed = 0;
    if (dirX !== undefined) {
      p.x += (dirX || 0) * 0.10;
      p.z += (dirZ || 0) * 0.10;
    }
    if (this.game.fx) this.game.fx.impact(p.x, p.y + 1.0, p.z, 0, 1, 0, 'flesh');
    this.scare(p.x, p.z, 34);
    this.game.bus.emit('pedKilled', { ped: p, source: source });
  };

  // Everyone within `radius` runs.
  Peds.prototype.scare = function (x, z, radius) {
    for (var i = 0; i < this.list.length; i++) {
      var p = this.list[i];
      if (p.dead) continue;
      if (M.dist2(p.x, p.z, x, z) > radius * radius) continue;
      p.state = 'flee';
      p.flee = Math.max(p.flee, 5 + Math.random() * 5);
      p.fleeX = x; p.fleeZ = z;
    }
  };

  // The nearest living pedestrian to a point, for aim assist and missions.
  Peds.prototype.nearest = function (x, z, maxDist) {
    var best = null, bd = maxDist * maxDist;
    for (var i = 0; i < this.list.length; i++) {
      var p = this.list[i];
      if (p.dead) continue;
      var d = M.dist2(p.x, p.z, x, z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };

  Peds.prototype.render = function (dt) {
    for (var i = 0; i < this.list.length; i++) {
      var p = this.list[i];
      p.char.setPos(p.x, p.y, p.z, p.yaw);
      p.char.animate(dt, p.dead ? 0 : p.speed, { lean: p.state === 'flee' ? 0.12 : 0 });
    }
  };

  SB.Peds = Peds;

})(window.SB = window.SB || {});
