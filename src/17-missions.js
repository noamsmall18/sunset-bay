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
    p.takeDamage(p.mode === 'car' ? 4 : 11, 'gun', e.x, e.z);
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
    },

    // The chain used to end here, which left the back half of the map - the
    // water, the airport, the freeway - with no authored reason to go there.
    // These six push the story out into the systems the city already had.
    {
      id: 'glasswork', name: 'Glasswork',
      giver: { x: 232, z: 68 },
      brief: 'A crate of gallery glass, across town, in one piece. Every scratch comes out of your end.',
      reward: 5200, time: 210,
      stages: [
        { type: 'car', text: 'Get a vehicle' },
        { type: 'goto', x: 232, z: 68, r: 10, text: 'Load the crate' },
        { type: 'cargo', x: -262, z: -178, r: 10, fragility: 0.14, text: 'Deliver it intact' }
      ]
    },
    {
      id: 'runaway', name: 'Runaway',
      giver: { x: 62, z: -96 },
      brief: 'One of ours took a car and a lot of money that was not his. Bring the car back. He can walk.',
      reward: 7400,
      stages: [
        { type: 'car', text: 'Get behind the wheel' },
        { type: 'chase', key: 'sports', x: 148, z: -96, cruise: 25, seconds: 120, color: 0x9b1f2f,
          text: 'Run him off the road' },
        { type: 'drive', x: 62, z: -96, r: 10, text: 'Report back to Marco' }
      ]
    },
    {
      id: 'harbour-light', name: 'Harbour Light',
      giver: { x: -430, z: 238 },
      brief: 'A drop is floating off the point. Take a boat, pick it up, and come back before the coastguard notices.',
      reward: 8600, time: 240,
      stages: [
        { type: 'boat', text: 'Get on the water' },
        { type: 'sail', x: -640, z: 150, r: 18, text: 'Reach the drop' },
        { type: 'pickup', x: -640, z: 150, r: 16, text: 'Haul it aboard' },
        { type: 'sail', x: -430, z: 250, r: 20, text: 'Back to the marina' }
      ]
    },
    {
      id: 'last-flight', name: 'Last Flight Out',
      giver: { x: 318, z: -262 },
      brief: 'There is a plane at the field with your name on the manifest. Get it in the air and put it down at the far strip.',
      reward: 9800,
      stages: [
        { type: 'goto', x: 318, z: -262, r: 14, text: 'Get to the airfield' },
        { type: 'fly', text: 'Get airborne' },
        { type: 'flyTo', x: -260, z: -300, r: 60, text: 'Fly to the north marker' },
        { type: 'flyTo', x: 318, z: -262, r: 55, text: 'Bring it back to the field' }
      ]
    },
    {
      id: 'the-siege', name: 'The Siege',
      giver: { x: -186, z: 322 },
      brief: 'They know where the lockup is. Get there first and hold it. Three crews, back to back.',
      reward: 12000,
      stages: [
        { type: 'goto', x: -186, z: 322, r: 12, text: 'Get to the lockup' },
        { type: 'wave', tag: 'siege', spread: 17, health: 100, waves: [3, 4, 5],
          text: 'Hold the lockup' },
        { type: 'wait', seconds: 2, text: 'Catch your breath' }
      ]
    },
    {
      id: 'sunset-run', name: 'Sunset Run',
      giver: { x: -344, z: -14 },
      brief: 'Last one. Everything you have taken, in one car, out of the city. They will all be looking.',
      reward: 26000,
      stages: [
        { type: 'car', text: 'Get the car' },
        { type: 'goto', x: -104, z: -96, r: 11, text: 'Collect the last package' },
        { type: 'heat', stars: 5, text: 'Every unit in Sunset Bay' },
        { type: 'cargo', x: 318, z: 322, r: 12, fragility: 0.06, text: 'Get it to the airfield gate' },
        { type: 'escape', text: 'Lose them for good' }
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
    this.contract = null;
    this.contractTimer = 30;
    this.contractLife = 0;
    this.contractSeq = 1;
    this.stunts = 0;
    this.contractsDone = 0;
    this.runner = null;
    this.runnerTimer = 0;
    this.runnerStopped = 0;
    this.cargo = 100;
    this.cargoHealth = -1;
    this.cargoVehicle = null;
    this.waveIndex = 0;
    this.waveTimer = 0;
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
      if (this.contract) this.addBlip(this.contract.giver.x, this.contract.giver.z, 0x66e07a, 5, 'contract');
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
      } else if (this.contract && !p.dead &&
        M.dist(p.pos.x, p.pos.z, this.contract.giver.x, this.contract.giver.z) < reach + 2) {
        var c = this.contract;
        this.contract = null;
        this.begin(c);
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
    } else if (st.type === 'chase' && g.traffic) {
      this.runner = g.traffic.spawnRunner(st.key || 'sports', st.x, st.z,
        { cruise: st.cruise || 24, color: st.color });
      this.runnerTimer = st.seconds || 90;
    } else if (st.type === 'cargo') {
      // Cargo is an integrity value the player can lose by driving badly.
      // It only exists while the stage is live, so nothing else has to know
      // about it.
      this.cargo = 100;
      this.cargoHealth = -1;
      this.cargoVehicle = null;
    } else if (st.type === 'wave') {
      this.waveIndex = 0;
      this.waveTimer = 0;
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

      case 'chase': {
        var run = this.runner;
        if (!run) return true;
        this.runnerTimer -= dt;
        // Keep the objective marker on the car rather than on a fixed point.
        if (this.blips.length && this.blips[0].marker) {
          this.blips[0].x = run.pos.x;
          this.blips[0].z = run.pos.z;
          this.blips[0].marker.position.set(run.pos.x, run.pos.y + 0.05, run.pos.z);
        }
        if (run.destroyed) {
          this.clearRunner();
          return true;
        }
        // Ramming it to a stop counts as well as shooting it out: at walking
        // pace with the player right on top of it, the driver gives up.
        if (run.speed && run.speed() < 2.2 && M.dist(p.pos.x, p.pos.z, run.pos.x, run.pos.z) < 11) {
          this.runnerStopped = (this.runnerStopped || 0) + dt;
          if (this.runnerStopped > 1.6) { this.clearRunner(); return true; }
        } else {
          this.runnerStopped = 0;
        }
        if (this.runnerTimer <= 0) { this.clearRunner(); this.fail('The runner got away'); return false; }
        if (M.dist(p.pos.x, p.pos.z, run.pos.x, run.pos.z) > (st.loseAt || 340)) {
          this.clearRunner(); this.fail('Lost the runner'); return false;
        }
        return false;
      }

      case 'cargo': {
        if (p.mode !== 'car' || !p.vehicle) { this.cargoHealth = -1; return false; }
        var veh = p.vehicle;
        // Cargo integrity tracks the car's own damage model rather than a
        // second collision system: whatever hurts the car hurts the load.
        if (this.cargoHealth < 0 || this.cargoVehicle !== veh) {
          this.cargoVehicle = veh;
          this.cargoHealth = veh.health;
        }
        var lost = this.cargoHealth - veh.health;
        if (lost > 0) {
          this.cargoHealth = veh.health;
          var before = this.cargo;
          this.cargo -= lost * (st.fragility || 0.12);
          if (Math.floor(before / 20) !== Math.floor(this.cargo / 20) && this.game.hud) {
            this.game.hud.toast('Cargo at ' + Math.max(0, Math.round(this.cargo)) + '%', '#e0553f');
          }
        }
        if (this.cargo <= 0) { this.fail('The cargo did not survive'); return false; }
        return M.dist(p.pos.x, p.pos.z, st.x, st.z) < (st.r || 9);
      }

      case 'wave': {
        var waves = st.waves || [];
        if (this.waveIndex >= waves.length) return this.enemies.aliveCount(st.tag) === 0;
        if (this.enemies.aliveCount(st.tag) === 0) {
          this.waveTimer -= dt;
          if (this.waveTimer <= 0) {
            var n = waves[this.waveIndex++];
            for (var wi = 0; wi < n; wi++) {
              var wa = (wi / n) * M.TAU + this.rng() * 0.7;
              var rr = (st.spread || 16) * (0.6 + this.rng() * 0.6);
              this.enemies.spawn(this.ambushX + Math.cos(wa) * rr,
                this.ambushZ + Math.sin(wa) * rr, { tag: st.tag, health: st.health || 95 });
            }
            this.waveTimer = 2.6;
            if (this.game.hud && this.waveIndex < waves.length) {
              this.game.hud.toast('Wave ' + this.waveIndex + ' of ' + waves.length, '#e0553f');
            }
          }
        }
        return false;
      }

      case 'boat':
        return p.mode === 'boat';
      case 'fly':
        return p.mode === 'plane' || p.mode === 'heli';
      case 'sail':
        if (p.mode !== 'boat') return false;
        return M.dist(p.pos.x, p.pos.z, st.x, st.z) < (st.r || 14);
      case 'flyTo':
        if (p.mode !== 'plane' && p.mode !== 'heli') return false;
        return M.dist(p.pos.x, p.pos.z, st.x, st.z) < (st.r || 30);
      case 'wait':
        return this.stageTimer >= (st.seconds || 3);
    }
    return true;
  };

  Missions.prototype.clearRunner = function () {
    var t = this.game.traffic;
    if (this.runner && t) {
      // recycle() only returns the body to the pool; the caller owns removing
      // it from the live list, or the AI keeps driving a hidden car.
      var i = t.active.indexOf(this.runner);
      if (i >= 0) t.active.splice(i, 1);
      i = t.loose.indexOf(this.runner);
      if (i >= 0) t.loose.splice(i, 1);
      if (!this.game.player || this.game.player.vehicle !== this.runner) t.recycle(this.runner);
    }
    this.runner = null;
    this.runnerStopped = 0;
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
    } else if (st.type === 'chase') {
      t += ' (' + Math.ceil(Math.max(0, this.runnerTimer || 0)) + 's)';
    } else if (st.type === 'cargo') {
      t += ' (cargo ' + Math.max(0, Math.round(this.cargo || 0)) + '%)';
    } else if (st.type === 'wave') {
      var total = (st.waves || []).length;
      t += ' (wave ' + Math.min(total, Math.max(1, this.waveIndex || 1)) + '/' + total +
        ', ' + this.enemies.aliveCount(st.tag) + ' left)';
    }
    return t;
  };

  Missions.prototype.complete = function () {
    var m = this.active;
    this.clearRunner();
    this.active = null;
    this.state = 'idle';
    this.enemies.clear();
    if (m.contract) {
      this.contractsDone++;
      this.contractTimer = 12;
    } else {
      this.completed.push(m.id);
      this.index = Math.min(CHAIN.length, this.index + 1);
    }
    this.game.player.money += m.reward;
    this.resultTimer = 4.2;
    this.result = { ok: true, name: m.name, reward: m.reward, minor: !!m.contract };
    this.refreshBlips();
    if (m.contract && this.game.progress) {
      this.game.progress.stats.sideJobs++;
      this.game.progress.award(SB.Progress.AWARD.sideJob, null);
      this.game.progress.stats.earned += m.reward;
    }
    this.game.bus.emit('missionComplete', m);
    if (this.game.audio) this.game.audio.blip('success');
  };

  Missions.prototype.fail = function (why) {
    if (!this.active) return;
    var m = this.active;
    this.clearRunner();
    this.active = null;
    this.state = 'idle';
    this.enemies.clear();
    this.resultTimer = 4.2;
    this.result = { ok: false, name: m.name, why: why };
    if (m.contract) this.contractTimer = 18;
    this.refreshBlips();
    this.game.bus.emit('missionFailed', m);
    if (this.game.audio) this.game.audio.blip('fail');
  };

  Missions.prototype.abandonIfFar = function () { };

  // ------------------------------------------------------- contracts -------
  // The story chain is finite. Contracts are not: a generator builds a real
  // mission - same stage types, same runner, same failure states - out of
  // whatever the map actually contains, and keeps one on offer at all times.
  // This is what the sandbox does with you once the chain is done.

  var CONTRACT_TYPES = [
    {
      id: 'courier', name: 'Courier run', weight: 3, minRank: 1, base: 340,
      build: function (ms, r) {
        var stages = [{ type: 'car', text: 'Get a vehicle' }];
        var drops = 1 + Math.floor(r() * 3);
        for (var i = 0; i < drops; i++) {
          var pt = ms.roadPoint(120, 460);
          stages.push({ type: 'drive', x: pt.x, z: pt.z, r: 9,
            text: 'Drop ' + (i + 1) + ' of ' + drops });
        }
        return { stages: stages, time: 70 + drops * 55, per: drops };
      }
    },
    {
      id: 'repo', name: 'Repossession', weight: 2, minRank: 1, base: 700,
      build: function (ms, r) {
        var car = ms.roadPoint(90, 380);
        var yard = ms.roadPoint(160, 520);
        var keys = ['sedan', 'sports', 'muscle', 'suv', 'compact', 'hatchback', 'pickup', 'van'];
        return {
          stages: [
            { type: 'spawnCar', key: keys[Math.floor(r() * keys.length)], x: car.x, z: car.z,
              color: 0x2b4d86, text: 'Find the vehicle' },
            { type: 'stealTarget', heat: 2, text: 'Take it' },
            { type: 'drive', x: yard.x, z: yard.z, r: 10, keepCar: true, text: 'Deliver it to the yard' }
          ], time: 210
        };
      }
    },
    {
      id: 'sweep', name: 'Clear the corner', weight: 2, minRank: 2, base: 900,
      build: function (ms, r) {
        var at = ms.roadPoint(120, 430);
        var n = 3 + Math.floor(r() * 3);
        return {
          stages: [
            { type: 'goto', x: at.x, z: at.z, r: 14, text: 'Get to the corner' },
            { type: 'ambush', count: n, tag: 'sweep', spread: 11, text: 'Clear them out' }
          ], per: n
        };
      }
    },
    {
      id: 'runner', name: 'Runner', weight: 2, minRank: 2, base: 1100,
      build: function (ms, r) {
        var at = ms.roadPoint(80, 300);
        var back = ms.roadPoint(120, 400);
        return {
          stages: [
            { type: 'car', text: 'Get behind the wheel' },
            { type: 'chase', key: r() < 0.5 ? 'sports' : 'muscle', x: at.x, z: at.z,
              cruise: 22 + r() * 6, seconds: 105, text: 'Stop the runner' },
            { type: 'drive', x: back.x, z: back.z, r: 10, text: 'Drop the car off' }
          ]
        };
      }
    },
    {
      id: 'freight', name: 'Fragile freight', weight: 2, minRank: 3, base: 1250,
      build: function (ms, r) {
        var to = ms.roadPoint(220, 560);
        return {
          stages: [
            { type: 'car', text: 'Get a vehicle' },
            { type: 'cargo', x: to.x, z: to.z, r: 10, fragility: 0.10 + r() * 0.08,
              text: 'Deliver it in one piece' }
          ], time: 200
        };
      }
    },
    {
      id: 'hold', name: 'Hold the line', weight: 1, minRank: 5, unlock: 'heavyJobs', base: 2200,
      build: function (ms, r) {
        var at = ms.roadPoint(140, 420);
        var waves = [3, 4, 5 + Math.floor(r() * 2)];
        return {
          stages: [
            { type: 'goto', x: at.x, z: at.z, r: 13, text: 'Get into position' },
            { type: 'wave', tag: 'hold', spread: 16, health: 100, waves: waves, text: 'Hold it' }
          ], per: waves.length
        };
      }
    },
    {
      id: 'harbour', name: 'Harbour drop', weight: 1, minRank: 3, base: 1600,
      build: function (ms, r) {
        var m = ms.marina();
        if (!m) return null;
        var far = { x: m.x - 90 - r() * 130, z: m.z + (r() - 0.5) * 240 };
        return {
          stages: [
            { type: 'boat', text: 'Get on the water' },
            { type: 'sail', x: far.x, z: far.z, r: 20, text: 'Reach the drop' },
            { type: 'pickup', x: far.x, z: far.z, r: 18, text: 'Haul it aboard' },
            { type: 'sail', x: m.x, z: m.z, r: 24, text: 'Back to the marina' }
          ], time: 260, giver: { x: m.x, z: m.z }
        };
      }
    },
    {
      id: 'airlift', name: 'Airlift', weight: 1, minRank: 7, unlock: 'airJobs', base: 3000,
      build: function (ms, r) {
        var a = ms.airfield();
        if (!a) return null;
        var far = { x: a.x + (r() - 0.5) * 700, z: a.z + 260 + r() * 300 };
        return {
          stages: [
            { type: 'fly', text: 'Get airborne' },
            { type: 'flyTo', x: far.x, z: far.z, r: 65, text: 'Reach the drop zone' },
            { type: 'flyTo', x: a.x, z: a.z, r: 60, text: 'Return to the field' }
          ], giver: { x: a.x, z: a.z }
        };
      }
    }
  ];
  Missions.CONTRACT_TYPES = CONTRACT_TYPES;

  // A road point at a sensible distance from the player, so a contract never
  // asks you to drive to the spot you are already parked on.
  Missions.prototype.roadPoint = function (minD, maxD) {
    var p = this.game.player;
    var out = { x: 0, z: 0 };
    var spot = Roads.randomLanePoint(this.L, this.rng, p ? p.pos.x : 0, p ? p.pos.z : 0,
      minD, maxD, out);
    return { x: spot.x, z: spot.z };
  };

  Missions.prototype.marina = function () {
    var t = this.game.transport;
    if (!t || !t.landmarks) return null;
    var list = t.landmarks.filter(function (l) { return l.kind === 'marina'; });
    return list.length ? list[Math.floor(this.rng() * list.length)] : null;
  };

  Missions.prototype.airfield = function () {
    var t = this.game.transport;
    if (!t || !t.landmarks) return null;
    var list = t.landmarks.filter(function (l) { return l.kind === 'airport'; });
    return list.length ? list[0] : null;
  };

  Missions.prototype.rank = function () {
    return this.game.progress ? this.game.progress.rank : 1;
  };

  Missions.prototype.makeContract = function () {
    var rank = this.rank(), prog = this.game.progress;
    var pool = [];
    for (var i = 0; i < CONTRACT_TYPES.length; i++) {
      var t = CONTRACT_TYPES[i];
      if (rank < t.minRank) continue;
      if (t.unlock && prog && !prog.has(t.unlock)) continue;
      for (var w = 0; w < t.weight; w++) pool.push(t);
    }
    if (!pool.length) pool.push(CONTRACT_TYPES[0]);
    var self = this;
    var rnd = function () { return self.rng(); };
    // A type whose anchors do not exist in this world (no marina, no
    // airfield) returns null; fall back rather than offering a broken job.
    for (var attempt = 0; attempt < 6; attempt++) {
      var type = pool[Math.floor(this.rng() * pool.length)];
      var spec = type.build(this, rnd);
      if (!spec) continue;
      var giver = spec.giver || this.roadPoint(40, 200);
      // Length adds to the fee but does not multiply it: a five-drop courier
      // run is worth more than a two-drop one, not two and a half times more,
      // or the board out-earns the story chain by rank four.
      var length = 1 + ((spec.per || 1) - 1) * 0.45;
      var scale = 1 + (rank - 1) * 0.16;
      var reward = Math.round((type.base * length * scale) / 10) * 10;
      return {
        id: 'contract-' + type.id + '-' + (this.contractSeq++),
        contract: true,
        kind: type.id,
        name: type.name,
        giver: { x: giver.x, z: giver.z },
        brief: 'Contract work, ' + SB.formatMoney(reward) + '. No questions.',
        reward: reward,
        time: spec.time || 0,
        stages: spec.stages
      };
    }
    return null;
  };

  Missions.prototype.offerSide = function (dt) {
    // Contracts open up at rank 2 so the first minutes stay pointed at the
    // story; before that the board is simply not there yet.
    var prog = this.game.progress;
    if (prog && !prog.has('jobBoard')) { this.contract = null; return; }
    if (this.contract) {
      // An ignored contract goes stale and is replaced, so the board is never
      // one job you already decided not to take.
      this.contractLife -= dt;
      if (this.contractLife <= 0) { this.contract = null; this.contractTimer = 6; this.refreshBlips(); }
      return;
    }
    this.contractTimer -= dt;
    if (this.contractTimer > 0) return;
    this.contractTimer = 20;
    var c = this.makeContract();
    if (!c) return;
    this.contract = c;
    this.contractLife = 240;
    this.refreshBlips();
    if (this.game.hud) this.game.hud.toast('Contract available: ' + c.name, '#66e07a');
  };

  // ------------------------------------------------------ legacy shim ------
  // Nothing calls completeSide any more - a contract is a real mission and
  // finishes through complete(). Kept as a no-op so an older save or a stray
  // call cannot throw.
  Missions.prototype.completeSide = function () { };

  // ------------------------------------------------------ stunt tracking ---
  Missions.prototype.checkStunt = function (v) {
    if (!v || v.airTime < 0.75) return;
    var payout = Math.floor(v.airTime * 340 + v.speed() * 12);
    this.game.player.money += payout;
    this.stunts++;
    if (this.game.progress) {
      this.game.progress.stats.stunts++;
      this.game.progress.stats.earned += payout;
      this.game.progress.award(SB.Progress.AWARD.stunt, null);
    }
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
