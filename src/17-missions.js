// 17-missions.js - the job chain, the repeatable side work, and the small
// enemy AI that missions need. Stages are data; a generic runner ticks them.
(function (SB) {
  'use strict';

  var M = SB.M, Roads = SB.Roads;

  // ------------------------------------------------------------ markers ----
  function MarkerPool(scene) {
    this.scene = scene;
    this.free = [];
    this.live = [];
  }
  MarkerPool.prototype.get = function (color, radius) {
    var m;
    if (this.free.length) m = this.free.pop();
    else {
      var g = new THREE.Group();
      // Additive geometry is far brighter once the pipeline is HDR, so the
      // column is shorter and much fainter than it used to be.
      var cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(1, 1, 9, 22, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xffc83c, transparent: true, opacity: 0.10,
          side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
        }));
      cyl.position.y = 4.5;
      var ring = new THREE.Mesh(
        new THREE.RingGeometry(0.75, 1.0, 26),
        new THREE.MeshBasicMaterial({
          color: 0xffc83c, transparent: true, opacity: 0.5,
          side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
        }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.24;
      g.add(cyl, ring);
      g.userData = { cyl: cyl, ring: ring };
      this.scene.add(g);
      m = g;
    }
    m.visible = true;
    m.userData.cyl.material.color.setHex(color);
    m.userData.ring.material.color.setHex(color);
    m.scale.set(radius, 1, radius);
    this.live.push(m);
    return m;
  };
  MarkerPool.prototype.releaseAll = function () {
    for (var i = 0; i < this.live.length; i++) {
      this.live[i].visible = false;
      this.free.push(this.live[i]);
    }
    this.live.length = 0;
  };

  // ------------------------------------------------------------ enemies ----
  function Enemies(game) {
    this.game = game;
    this.list = [];
    this.pool = [];
    this.rng = M.rng(777);
  }
  Enemies.prototype.spawn = function (x, z, opts) {
    opts = opts || {};
    var e;
    if (this.pool.length) {
      e = this.pool.pop();
      e.char.root.visible = true;
      e.char.state = 'idle';
      e.char.deathT = 0;
      e.char.root.rotation.set(0, 0, 0);
    } else {
      e = {
        char: new SB.Character({
          shirt: 0x2a2c33, pants: 0x23262b, hat: 0x1b1d22,
          rng: this.rng, scale: 1.02
        }),
        x: 0, y: 0, z: 0, yaw: 0, speed: 0
      };
      var gun = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.10, 0.06),
        new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.5, metalness: 0.6 }));
      gun.rotation.z = Math.PI / 2;
      e.char.setWeapon(gun);
      this.game.scene.add(e.char.root);
    }
    e.x = x; e.z = z;
    var srf = this.game.world.surfaceAt(x, z, 30, 40);
    e.y = srf.y;
    e.health = opts.health || 90;
    e.dead = false;
    e.deadTime = 0;
    e.fireCd = this.rng.range(0.6, 2.0);
    e.aggro = false;
    e.homeX = x; e.homeZ = z;
    e.tag = opts.tag || null;
    this.list.push(e);
    return e;
  };
  Enemies.prototype.clear = function () {
    for (var i = 0; i < this.list.length; i++) this.recycle(this.list[i]);
    this.list.length = 0;
  };
  Enemies.prototype.recycle = function (e) {
    e.char.root.visible = false;
    e.y = -500;
    this.pool.push(e);
  };
  Enemies.prototype.aliveCount = function (tag) {
    var n = 0;
    for (var i = 0; i < this.list.length; i++) {
      if (!this.list[i].dead && (!tag || this.list[i].tag === tag)) n++;
    }
    return n;
  };
  Enemies.prototype.nearest = function (x, z, maxDist) {
    var best = null, bd = maxDist * maxDist;
    for (var i = 0; i < this.list.length; i++) {
      var e = this.list[i];
      if (e.dead) continue;
      var d = M.dist2(e.x, e.z, x, z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  };
  Enemies.prototype.hurt = function (e, amount, dx, dz) {
    if (e.dead) return;
    e.health -= amount;
    e.aggro = true;
    if (e.health <= 0) {
      e.dead = true;
      e.deadTime = 0;
      e.char.die();
      this.game.bus.emit('enemyKilled', e);
    }
  };
  Enemies.prototype.fixed = function (dt) {
    var g = this.game, p = g.player;
    for (var i = this.list.length - 1; i >= 0; i--) {
      var e = this.list[i];
      if (e.dead) {
        e.deadTime += dt;
        if (e.deadTime > 25) { this.recycle(e); this.list.splice(i, 1); }
        continue;
      }
      var dx = p.pos.x - e.x, dz = p.pos.z - e.z;
      var dist = Math.hypot(dx, dz);
      var los = !g.world.blocked(e.x, e.y + 1.5, e.z, p.pos.x, p.pos.y + 1.2, p.pos.z);
      if (!e.aggro && dist < 26 && los) e.aggro = true;
      if (!e.aggro) { e.speed = M.damp(e.speed, 0, 8, dt); continue; }

      var ux = dist > 0.01 ? dx / dist : 1, uz = dist > 0.01 ? dz / dist : 0;
      var want = (!los || dist > 18) ? 3.6 : (dist < 7 ? -1.8 : 0);
      if (want !== 0) {
        e.x += ux * want * dt; e.z += uz * want * dt;
        e.speed = Math.abs(want);
      } else e.speed = M.damp(e.speed, 0, 9, dt);
      e.yaw = M.dampAngle(e.yaw, Math.atan2(uz, ux), 9, dt);

      var out = {};
      if (g.world.resolveCircle(e.x, e.z, 0.36, e.y + 0.25, e.y + 1.7, out)) { e.x = out.x; e.z = out.z; }
      var srf = g.world.surfaceAt(e.x, e.z, e.y + 0.7, 0.9);
      e.y = M.damp(e.y, srf.y, 16, dt);

      e.fireCd -= dt;
      if (los && dist < 34 && e.fireCd <= 0 && !p.dead) {
        e.fireCd = this.rng.range(0.7, 1.6);
        this.shoot(e, p);
      }
    }
  };
  Enemies.prototype.shoot = function (e, p) {
    var g = this.game;
    var ex = e.x, ey = e.y + 1.45, ez = e.z;
    var spread = 0.06;
    var dx = p.pos.x - ex + (Math.random() - 0.5) * spread * 40;
    var dy = (p.pos.y + 1.0) - ey + (Math.random() - 0.5) * spread * 18;
    var dz = p.pos.z - ez + (Math.random() - 0.5) * spread * 40;
    var len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    if (g.fx) {
      g.fx.muzzle(ex + dx * 0.4, ey, ez + dz * 0.4, dx, dy, dz, 0.9);
      var hit = g.world.raycast(ex, ey, ez, dx, dy, dz, 60);
      var hd = hit ? hit.dist : 60;
      g.fx.tracers.add(ex + dx * 0.5, ey, ez + dz * 0.5, ex + dx * hd, ey + dy * hd, ez + dz * hd);
    }
    if (g.audio) g.audio.gunshot({ id: 'smg', sound: 'smg' }, ex, ey, ez);
    var toX = p.pos.x - ex, toY = (p.pos.y + 0.95) - ey, toZ = p.pos.z - ez;
    var proj = toX * dx + toY * dy + toZ * dz;
    if (proj <= 0) return;
    var cx = ex + dx * proj, cy = ey + dy * proj, cz = ez + dz * proj;
    var miss = Math.hypot(cx - p.pos.x, cy - (p.pos.y + 0.95), cz - p.pos.z);
    if (miss > (p.mode === 'car' ? 1.1 : 0.5)) return;
    if (g.world.blocked(ex, ey, ez, p.pos.x, p.pos.y + 1, p.pos.z)) return;
    p.takeDamage(p.mode === 'car' ? 4 : 11, 'gun');
  };
  Enemies.prototype.render = function (dt) {
    for (var i = 0; i < this.list.length; i++) {
      var e = this.list[i];
      e.char.setPos(e.x, e.y, e.z, e.yaw);
      e.char.animate(dt, e.dead ? 0 : e.speed, { aim: e.dead ? 0 : (e.aggro ? 1 : 0) });
    }
  };

  // ------------------------------------------------------ mission chain ----
  // Coordinates are chosen to sit on real roads and lots in the layout.
  var CHAIN = [
    {
      id: 'first-gear', name: 'First Gear',
      giver: { x: -104, z: 68 },
      brief: 'Marco left a car for you. Take it down to the docks before somebody else does.',
      reward: 900,
      stages: [
        { type: 'car', text: 'Get in a car' },
        { type: 'drive', x: 148, z: 322, r: 9, text: 'Drive to the docks' }
      ]
    },
    {
      id: 'cash-run', name: 'Cash Run',
      giver: { x: 62, z: 68 },
      brief: 'Three drops, one clock. Do not keep people waiting.',
      reward: 1600, time: 165,
      stages: [
        { type: 'car', text: 'Get a vehicle' },
        { type: 'drive', x: -186, z: -96, r: 8, text: 'Drop 1 of 3' },
        { type: 'drive', x: 232, z: -178, r: 8, text: 'Drop 2 of 3' },
        { type: 'drive', x: -20, z: 238, r: 8, text: 'Drop 3 of 3' }
      ]
    },
    {
      id: 'hot-property', name: 'Hot Property',
      giver: { x: -262, z: -14 },
      brief: 'There is a Corsaro sitting in a lot uptown. The owner will not miss it.',
      reward: 2400,
      stages: [
        { type: 'spawnCar', key: 'sports', x: 318, z: -14, color: 0x1f3f77, text: 'Find the Corsaro' },
        { type: 'stealTarget', text: 'Steal the Corsaro', heat: 2 },
        { type: 'drive', x: -186, z: 152, r: 10, text: 'Take it to the car park', keepCar: true }
      ]
    },
    {
      id: 'sunset-sprint', name: 'Sunset Sprint',
      giver: { x: -344, z: 152 },
      brief: 'Street race down the coast. Six gates. Do not be second.',
      reward: 3000, time: 135,
      stages: [
        { type: 'car', text: 'Get to a car' },
        { type: 'drive', x: -344, z: 68, r: 11, text: 'Gate 1 of 6' },
        { type: 'drive', x: -344, z: -96, r: 11, text: 'Gate 2 of 6' },
        { type: 'drive', x: -186, z: -178, r: 11, text: 'Gate 3 of 6' },
        { type: 'drive', x: 62, z: -178, r: 11, text: 'Gate 4 of 6' },
        { type: 'drive', x: 148, z: -14, r: 11, text: 'Gate 5 of 6' },
        { type: 'drive', x: -20, z: 68, r: 11, text: 'Gate 6 of 6' }
      ]
    },
    {
      id: 'collections', name: 'Collections',
      giver: { x: 148, z: 152 },
      brief: 'Two crews owe us money. Go and remind them.',
      reward: 3600,
      stages: [
        { type: 'goto', x: 232, z: 238, r: 14, text: 'Meet the first crew' },
        { type: 'ambush', count: 3, tag: 'crew1', spread: 9, text: 'Take them out' },
        { type: 'goto', x: -104, z: 238, r: 14, text: 'Find the second crew' },
        { type: 'ambush', count: 4, tag: 'crew2', spread: 11, text: 'Finish it' }
      ]
    },
    {
      id: 'pier-job', name: 'The Pier Job',
      giver: { x: -430, z: 68 },
      brief: 'A case is sitting on the pier with four guns around it. Bring me the case.',
      reward: 4800,
      stages: [
        { type: 'goto', x: -520, z: 40, r: 16, text: 'Get out to the pier' },
        { type: 'ambush', count: 4, tag: 'pier', spread: 14, text: 'Clear the pier' },
        { type: 'pickup', x: -560, z: 40, r: 3, text: 'Grab the case' },
        { type: 'goto', x: -430, z: 68, r: 10, text: 'Get back to Marco' }
      ]
    },
    {
      id: 'getaway', name: 'Getaway Driver',
      giver: { x: -20, z: -96 },
      brief: 'A crew is coming out hot in ninety seconds. You are the wheels. Lose the cops, then get to the lockup.',
      reward: 6500,
      stages: [
        { type: 'car', text: 'Get behind the wheel' },
        { type: 'heat', stars: 3, text: 'The job goes loud' },
        { type: 'survive', seconds: 45, text: 'Stay alive' },
        { type: 'escape', text: 'Lose the cops' },
        { type: 'drive', x: 318, z: 322, r: 10, text: 'Get to the lockup' }
      ]
    },
    {
      id: 'the-big-one', name: 'The Big One',
      giver: { x: -20, z: -14 },
      brief: 'Downtown vault. In, hold the floor, out, and gone. After this you can disappear.',
      reward: 15000,
      stages: [
        { type: 'goto', x: -104, z: -14, r: 12, text: 'Get to the vault' },
        { type: 'ambush', count: 5, tag: 'vault', spread: 13, text: 'Clear the floor' },
        { type: 'pickup', x: -104, z: -14, r: 4, text: 'Take the money' },
        { type: 'heat', stars: 4, text: 'Every unit in the city is coming' },
        { type: 'survive', seconds: 55, text: 'Hold them off' },
        { type: 'escape', text: 'Lose them' },
        { type: 'drive', x: -344, z: 322, r: 11, text: 'Get to the boat' }
      ]
    }
  ];

  function Missions(game) {
    this.game = game;
    this.L = game.layout;
    this.markers = new MarkerPool(game.scene);
    this.enemies = new Enemies(game);
    this.index = 0;
    this.active = null;
    this.stage = 0;
    this.timer = 0;
    this.state = 'idle';
    this.completed = [];
    this.toast = null;
    this.blips = [];
    this.failReason = '';
    this.resultTimer = 0;
    this.sideTimer = 30;
    this.side = null;
    this.stunts = 0;
    this.rng = M.rng(2024);

    var self = this;
    game.bus.on('playerDied', function () { if (self.active) self.fail('You died'); });
    game.bus.on('busted', function () { if (self.active) self.fail('Busted'); });
    game.bus.on('enemyKilled', function () { });
    this.refreshBlips();
  }

  Missions.prototype.current = function () { return CHAIN[this.index] || null; };

  Missions.prototype.refreshBlips = function () {
    this.blips.length = 0;
    this.markers.releaseAll();
    if (this.active) {
      var st = this.active.stages[this.stage];
      if (st && st.x !== undefined) {
        this.addBlip(st.x, st.z, 0xffc83c, st.r || 7, 'objective');
      }
      if (st && st.type === 'stealTarget' && this.targetCar) {
        this.addBlip(this.targetCar.pos.x, this.targetCar.pos.z, 0x4ad2ff, 4, 'objective');
      }
    } else {
      var m = this.current();
      if (m) this.addBlip(m.giver.x, m.giver.z, 0xffd34d, 4.5, 'mission');
      if (this.side) this.addBlip(this.side.x, this.side.z, 0x66e07a, 6, 'side');
    }
    if (this.game.interiors) {
      for (var i = 0; i < this.game.interiors.doors.length; i++) {
        var d = this.game.interiors.doors[i];
        this.blips.push({ x: d.x, z: d.z, color: d.room.type.color, kind: 'door', small: true });
      }
    }
  };

  Missions.prototype.addBlip = function (x, z, color, radius, kind) {
    var mk = this.markers.get(color, radius);
    var srf = this.game.world.surfaceAt(x, z, 40, 60);
    mk.position.set(x, srf.y + 0.02, z);
    this.blips.push({ x: x, z: z, color: color, kind: kind, marker: mk });
  };

  // ---------------------------------------------------------------- step ---
  Missions.prototype.fixed = function (dt) {
    var g = this.game, p = g.player;
    if (!p) return;
    this.enemies.fixed(dt);
    if (this.resultTimer > 0) this.resultTimer -= dt;

    if (!this.active) {
      this.offerSide(dt);
      var m = this.current();
      // You can take a job from the car as well as on foot; several of these
      // hand you straight back into a vehicle anyway.
      var reach = p.mode === 'car' ? 6.5 : 4.0;
      if (m && !p.dead && M.dist(p.pos.x, p.pos.z, m.giver.x, m.giver.z) < reach) {
        this.begin(m);
      } else if (this.side && M.dist(p.pos.x, p.pos.z, this.side.x, this.side.z) < this.side.r) {
        this.completeSide();
      }
      return;
    }

    // mission timer
    if (this.active.time) {
      this.timer -= dt;
      if (this.timer <= 0) { this.fail('Out of time'); return; }
    }

    var st = this.active.stages[this.stage];
    if (!st) { this.complete(); return; }
    if (this.runStage(st, dt)) {
      this.stage++;
      if (this.stage >= this.active.stages.length) this.complete();
      else {
        this.enterStage(this.active.stages[this.stage]);
        this.refreshBlips();
        if (g.audio) g.audio.blip('objective');
      }
    }
  };

  Missions.prototype.begin = function (m) {
    this.active = m;
    this.stage = 0;
    this.timer = m.time || 0;
    this.state = 'running';
    this.enemies.clear();
    this.targetCar = null;
    this.hasPickup = false;
    this.stageTimer = 0;
    this.enterStage(m.stages[0]);
    this.refreshBlips();
    this.game.bus.emit('missionStart', m);
    if (this.game.audio) this.game.audio.blip('mission');
  };

  Missions.prototype.enterStage = function (st) {
    var g = this.game;
    this.stageTimer = 0;
    if (!st) return;
    if (st.type === 'spawnCar' && g.traffic) {
      this.targetCar = g.traffic.spawnMissionCar(st.key, st.x, st.z, 0, st.color);
    } else if (st.type === 'ambush') {
      for (var i = 0; i < st.count; i++) {
        var a = (i / st.count) * M.TAU;
        var ex = this.ambushX + Math.cos(a) * st.spread * (0.5 + this.rng() * 0.6);
        var ez = this.ambushZ + Math.sin(a) * st.spread * (0.5 + this.rng() * 0.6);
        this.enemies.spawn(ex, ez, { tag: st.tag, health: 90 });
      }
    } else if (st.type === 'heat' && g.police) {
      g.police.heat = Math.max(g.police.heat, st.stars + 0.2);
      g.police.stars = Math.min(5, Math.floor(g.police.heat));
      g.bus.emit('wantedUp', g.police.stars);
    }
    if (st.x !== undefined) { this.ambushX = st.x; this.ambushZ = st.z; }
  };

  Missions.prototype.runStage = function (st, dt) {
    var g = this.game, p = g.player;
    this.stageTimer += dt;
    switch (st.type) {
      case 'car':
        return p.mode === 'car';
      case 'goto':
        return p.mode === 'foot'
          ? M.dist(p.pos.x, p.pos.z, st.x, st.z) < (st.r || 6)
          : M.dist(p.pos.x, p.pos.z, st.x, st.z) < (st.r || 6);
      case 'drive':
        if (p.mode !== 'car') return false;
        return M.dist(p.pos.x, p.pos.z, st.x, st.z) < (st.r || 8);
      case 'spawnCar':
        return true;
      case 'stealTarget':
        if (p.vehicle && p.vehicle === this.targetCar) {
          if (g.police && st.heat) {
            g.police.heat = Math.max(g.police.heat, st.heat + 0.15);
            g.police.stars = Math.min(5, Math.floor(g.police.heat));
          }
          return true;
        }
        // keep the blip glued to the car while it is the objective
        if (this.blips.length && this.targetCar && this.blips[0].marker) {
          this.blips[0].x = this.targetCar.pos.x;
          this.blips[0].z = this.targetCar.pos.z;
          this.blips[0].marker.position.set(this.targetCar.pos.x, 0.05, this.targetCar.pos.z);
        }
        return false;
      case 'ambush':
        return this.enemies.aliveCount(st.tag) === 0;
      case 'pickup':
        return M.dist(p.pos.x, p.pos.z, st.x, st.z) < (st.r || 3);
      case 'survive':
        return this.stageTimer >= st.seconds;
      case 'escape':
        return !g.police || g.police.stars === 0;
      case 'heat':
        return this.stageTimer > 0.4;
    }
    return true;
  };

  Missions.prototype.stageText = function () {
    if (!this.active) return null;
    var st = this.active.stages[this.stage];
    if (!st) return null;
    var t = st.text || '';
    if (st.type === 'ambush') {
      t += ' (' + this.enemies.aliveCount(st.tag) + ' left)';
    } else if (st.type === 'survive') {
      t += ' (' + Math.ceil(Math.max(0, st.seconds - this.stageTimer)) + 's)';
    } else if (st.type === 'escape' && this.game.police) {
      t += ' (' + this.game.police.stars + ' stars)';
    }
    return t;
  };

  Missions.prototype.complete = function () {
    var m = this.active;
    this.active = null;
    this.state = 'idle';
    this.enemies.clear();
    this.completed.push(m.id);
    this.index = Math.min(CHAIN.length, this.index + 1);
    this.game.player.money += m.reward;
    this.resultTimer = 4.2;
    this.result = { ok: true, name: m.name, reward: m.reward };
    this.refreshBlips();
    this.game.bus.emit('missionComplete', m);
    if (this.game.audio) this.game.audio.blip('success');
  };

  Missions.prototype.fail = function (why) {
    if (!this.active) return;
    var m = this.active;
    this.active = null;
    this.state = 'idle';
    this.enemies.clear();
    this.resultTimer = 4.2;
    this.result = { ok: false, name: m.name, why: why };
    this.refreshBlips();
    this.game.bus.emit('missionFailed', m);
    if (this.game.audio) this.game.audio.blip('fail');
  };

  Missions.prototype.abandonIfFar = function () { };

  // ------------------------------------------------------- side jobs -------
  // A rolling courier drop, always available between story missions.
  Missions.prototype.offerSide = function (dt) {
    if (this.side) return;
    this.sideTimer -= dt;
    if (this.sideTimer > 0) return;
    this.sideTimer = 25;
    var p = this.game.player;
    var pt = { x: 0, z: 0 };
    var spot = Roads.randomLanePoint(this.L, this.rng, p.pos.x, p.pos.z, 140, 420, pt);
    this.side = {
      x: spot.x, z: spot.z, r: 8,
      reward: 220 + Math.floor(this.rng() * 320),
      name: 'Courier drop'
    };
    this.refreshBlips();
  };

  Missions.prototype.completeSide = function () {
    var s = this.side;
    this.side = null;
    this.sideTimer = 40;
    this.game.player.money += s.reward;
    this.resultTimer = 2.6;
    this.result = { ok: true, name: s.name, reward: s.reward, minor: true };
    this.refreshBlips();
    if (this.game.audio) this.game.audio.blip('cash');
  };

  // ------------------------------------------------------ stunt tracking ---
  Missions.prototype.checkStunt = function (v) {
    if (!v || v.airTime < 0.75) return;
    var payout = Math.floor(v.airTime * 340 + v.speed() * 12);
    this.game.player.money += payout;
    this.stunts++;
    this.resultTimer = 2.4;
    this.result = { ok: true, name: 'Stunt jump', reward: payout, minor: true };
    if (this.game.audio) this.game.audio.blip('cash');
  };

  Missions.prototype.render = function (dt) {
    this.enemies.render(dt);
    var t = performance.now() / 1000;
    for (var i = 0; i < this.markers.live.length; i++) {
      var m = this.markers.live[i];
      m.rotation.y = t * 0.7;
      m.userData.ring.scale.setScalar(1 + Math.sin(t * 2.4) * 0.06);
    }
  };

  Missions.CHAIN = CHAIN;
  SB.Missions = Missions;
  SB.Enemies = Enemies;

})(window.SB = window.SB || {});
