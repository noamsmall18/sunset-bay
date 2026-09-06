// 12-player.js - the player: on-foot movement, vehicle entry/exit and the
// third person camera that serves both.
(function (SB) {
  'use strict';

  var M = SB.M;

  var WALK = 2.3, RUN = 6.1, AIM_WALK = 1.7, SPRINT_DRAIN = 0.16;

  var _mv = { x: 0, y: 0 };
  var _look = { x: 0, y: 0 };

  function Player(game) {
    this.game = game;
    this.world = game.world;
    this.scene = game.scene;

    this.pos = new THREE.Vector3(0, 0.2, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.grounded = true;
    this.swimming = false;
    this.swimT = 0;
    this.mode = 'foot';               // foot | car
    this.vehicle = null;
    this.enterTimer = 0;
    this.enterTarget = null;
    // Short lockout after getting in or out, so a double tap on a phone (or
    // two fixed steps inside one frame) cannot enter and immediately exit.
    this.enterCooldown = 0;

    this.health = 100;
    this.maxHealth = 100;
    this.armor = 0;
    this.money = 850;
    this.stamina = 1;
    this.slipTimer = 0;
    this.slipVX = 0;
    this.slipVZ = 0;
    this.dead = false;
    this.respawnTimer = 0;

    this.camYaw = 0;
    this.camPitch = -0.12;
    this.camDist = 4.6;
    this.camPos = new THREE.Vector3(0, 3, 8);
    this.camLook = new THREE.Vector3();
    this.freeLook = 0;
    this.aiming = false;
    this.aimAmount = 0;
    this.shake = 0;
    this.fov = 62;

    this.char = new SB.Character({
      shirt: 0x27313f, pants: 0x1e2229, skin: 0xe8bd93, hair: 0x241a12,
      beard: true, scale: 1.0
    });
    this.char.root.visible = true;
    this.scene.add(this.char.root);

    this.interiorId = null;         // set while inside a building
    this.nearVehicle = null;
    this.boatInteriorPrompt = null;
    this.prompt = null;
    this._tmp = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this.ownedCar = null;
  }

  Player.prototype.spawn = function (x, z, yaw) {
    var debugSpawn = false;
    if (x === undefined) {
      x = -14; z = 20; yaw = 0;
      // Focused spawn points make visual and interaction regression checks
      // repeatable without shipping a cheat menu into normal play.
      if (this.game.dev && (location.hash.indexOf('spawn=interior') >= 0 ||
          /spawn=(bank|club|hotel|office|clinic|unique)/.test(location.hash)) &&
          this.game.interiors && this.game.interiors.doors.length) {
        var door = this.game.interiors.doors[0];
        var requestedType = location.hash.match(/spawn=(bank|club|hotel|office|clinic|unique)/);
        if (requestedType) {
          for (var di = 0; di < this.game.interiors.doors.length; di++) {
            var candidate = this.game.interiors.doors[di];
            if (candidate.room && (requestedType[1] === 'unique'
              ? candidate.room.type.id === 'generated'
              : candidate.room.type.id === requestedType[1])) { door = candidate; break; }
          }
        }
        x = door.x; z = door.z; yaw = door.yaw;
        debugSpawn = true;
      } else if (this.game.dev && location.hash.indexOf('spawn=airport') >= 0) {
        x = -312; z = -476; yaw = Math.PI;
        debugSpawn = true;
      } else if (this.game.dev && location.hash.indexOf('spawn=marina') >= 0) {
        // Start at the street landing, not in the water. From here the new
        // gangway is a genuine walkable route to every berth.
        x = -448; z = -224; yaw = -Math.PI / 2;
        debugSpawn = true;
      } else if (this.game.dev && location.hash.indexOf('spawn=yacht') >= 0) {
        // Focused runtime probe: the yacht's port berth is on the walkable
        // finger pier, so the cabin flow can be tested without a teleport in
        // normal play.
        x = -620; z = -207.6; yaw = -Math.PI / 2;
        debugSpawn = true;
      } else if (this.game.dev && location.hash.indexOf('spawn=helipad') >= 0) {
        x = -520; z = 283.5; yaw = Math.PI / 2;
        debugSpawn = true;
      }
    }
    this.pos.set(x, 0.4, z);
    var s = this.world.surfaceAt(x, z, 40, 50);
    this.pos.y = s.y;
    this.yaw = yaw || 0;
    this.camYaw = this.yaw;
    this.vel.set(0, 0, 0);
    this.dead = false;
    this.health = this.maxHealth;
    this.char.state = 'idle';
    this.char.deathT = 0;
    this.char.root.rotation.z = 0;
    this.mode = 'foot';
    this.swimming = false;
    this.swimT = 0;
    this.vehicle = null;

    // A car of your own, parked where you start.
    if (!debugSpawn && !this.ownedCar && this.game.traffic) {
      this.ownedCar = this.game.traffic.spawnParked('sports', x + 6.5, z + 2.5, 0.0, 0x9c1f28);
    }
  };

  // ------------------------------------------------------------- update ----
  Player.prototype.fixed = function (dt) {
    var input = this.game.input;
    var g = this.game;
    if (this.enterCooldown > 0) this.enterCooldown -= dt;

    if (this.dead) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.doRespawn();
      if (this.vehicle) this.vehicle.step(dt, { throttle: 0, brake: 1, steer: 0, handbrake: 1 });
      return;
    }

    // entering / exiting animation window
    if (this.enterTimer > 0) {
      this.enterTimer -= dt;
      if (this.enterTimer <= 0) this.finishEnterExit();
      if (this.vehicle) this.vehicle.step(dt, { throttle: 0, brake: 0.6, steer: 0, handbrake: 0 });
      return;
    }

    if (this.mode === 'boatInterior') this.yachtInteriorStep(dt, input);
    else if (this.mode === 'car' || this.mode === 'boat') this.driveStep(dt, input);
    else if (this.mode === 'plane') this.flightStep(dt, input);
    else if (this.mode === 'heli') this.heliStep(dt, input);
    else if (this.mode === 'train') this.trainStep(dt, input);
    else if (this.swimming) this.swimStep(dt, input);
    else this.footStep(dt, input);
  };

  // ---------------------------------------------------------------- plane --
  Player.prototype.flightStep = function (dt, input) {
    var v = this.vehicle;
    if (!v) { this.mode = 'foot'; return; }
    var ready = input.ready() && !this.game.uiBlocking;
    var mv = ready ? input.moveAxis(_mv) : _mv;
    var pitch = ready ? mv.y : 0;
    var roll = ready ? mv.x : 0;
    var boost = ready && input.act('boost');
    var airbrake = ready && input.act('handbrake');

    v.step(dt, { flight: true, pitch: pitch, roll: roll, boost: boost, airbrake: airbrake });
    this.pos.copy(v.pos);
    this.yaw = v.yaw;

    if (v.destroyed && v.burning > 2.2) this.takeDamage(dt * 30, 'fire');
    if (ready && this.enterCooldown <= 0 && input.actHit('enter')) this.beginExit();
  };

  // ------------------------------------------------------------------ heli --
  Player.prototype.heliStep = function (dt, input) {
    var v = this.vehicle;
    if (!v) { this.mode = 'foot'; return; }
    var ready = input.ready() && !this.game.uiBlocking;
    var mv = ready ? input.moveAxis(_mv) : _mv;
    var pitch = ready ? mv.y : 0;
    var yaw = ready ? mv.x : 0;
    var ascend = ready && input.act('jump');
    var descend = ready && input.act('descend');

    v.step(dt, { flight: true, pitch: pitch, yaw: yaw, ascend: ascend, descend: descend });
    this.pos.copy(v.pos);
    this.yaw = v.yaw;

    if (v.destroyed && v.burning > 2.2) this.takeDamage(dt * 30, 'fire');
    if (ready && this.enterCooldown <= 0 && input.actHit('enter')) this.beginExit();
  };

  // ----------------------------------------------------------------- train --
  // A train has one axis of control, so the whole cab is a throttle and a
  // brake: forward opens the regulator, back applies the air.
  Player.prototype.trainStep = function (dt, input) {
    var v = this.vehicle;
    if (!v) { this.mode = 'foot'; return; }
    var ready = input.ready() && !this.game.uiBlocking;
    var drive = ready ? input.driveAxis() : 0;
    var throttle = Math.max(0, drive);
    var brake = Math.max(0, -drive) + (ready && input.act('handbrake') ? 1 : 0);

    v.step(dt, { throttle: throttle, brake: Math.min(1, brake) });
    this.pos.copy(v.pos);
    this.yaw = v.yaw;

    // Only let go when it has actually stopped - stepping off a moving train
    // would drop you through the viaduct.
    if (ready && this.enterCooldown <= 0 && input.actHit('enter') && v.speed() < 0.8) {
      this.beginExit();
    }
  };

  Player.prototype.footStep = function (dt, input) {
    var ready = input.ready() && !this.game.uiBlocking;
    var fwd = 0, side = 0;
    if (ready) {
      input.moveAxis(_mv);
      fwd = _mv.y; side = _mv.x;
    }
    // A thumbstick is analogue: how far you push decides how fast you walk.
    var mag = M.clamp(Math.hypot(fwd, side), 0, 1);
    this.aiming = ready && input.act('aim');

    var sprint = ready && input.act('sprint');
    if (sprint && (fwd !== 0 || side !== 0) && this.stamina > 0) {
      this.stamina = Math.max(0, this.stamina - dt * SPRINT_DRAIN);
    } else if (this.mode === 'boatInterior') {
      this.char.setPos(this.pos.x, this.pos.y, this.pos.z, this.yaw);
      this.char.animate(dt, Math.hypot(this.vel.x, this.vel.z), {
        aim: this.aiming ? 1 : 0,
        pitch: this.camPitch,
        recoil: this.game.combat ? this.game.combat.recoil : 0
      });
      this.char.root.visible = true;
      this.cameraForBoatInterior(dt, camera);
    } else {
      this.stamina = Math.min(1, this.stamina + dt * 0.20);
    }
    var canSprint = sprint && this.stamina > 0.02 && !this.aiming;
    var snowDepth = this.world.snowDepthAt(this.pos.x, this.pos.z);
    var snowSlow = M.clamp(snowDepth * 2.4, 0, 0.62);
    var maxSpeed = this.aiming ? AIM_WALK : (canSprint ? RUN : WALK);
    maxSpeed *= 1 - snowSlow;

    // direction in camera space
    var cy = this.camYaw;
    var dx = Math.cos(cy) * fwd + Math.cos(cy + Math.PI / 2) * side;
    var dz = Math.sin(cy) * fwd + Math.sin(cy + Math.PI / 2) * side;
    var len = Math.hypot(dx, dz);
    if (len > 1e-4) { dx /= len; dz /= len; } else { dx = dz = 0; }

    var targetVX = dx * maxSpeed * mag, targetVZ = dz * maxSpeed * mag;
    var slick = this.world.wetness > 0.2 ? this.world.wetness * 0.24 : 0;
    var accel = this.grounded ? 22 * (1 - slick * 0.45) * (1 - snowSlow * 0.45) : 5;
    this.vel.x = M.damp(this.vel.x, targetVX, accel, dt);
    this.vel.z = M.damp(this.vel.z, targetVZ, accel, dt);

    // Rain makes the player skid slightly when changing direction; deep snow
    // can trip the same way at a slower pace. It is brief and readable rather
    // than a random hard stun, so control returns immediately.
    if (this.grounded && len > 1e-4 && mag > 0.55 && (slick > 0.08 || snowDepth > 0.10)) {
      var turnLoad = Math.abs(this.vel.x * dz - this.vel.z * dx);
      if (turnLoad > (snowDepth > 0.10 ? 1.0 : 1.7) && this.slipTimer <= 0 && Math.random() < dt * (snowDepth > 0.10 ? 0.9 : 0.45)) {
        this.slipTimer = 0.32;
        this.slipVX = this.vel.x * 0.32 - dz * 0.75;
        this.slipVZ = this.vel.z * 0.32 + dx * 0.75;
        this.game.bus.emit('toast', { text: snowDepth > 0.10 ? 'Deep snow — footing is unstable' : 'Wet ground — you slipped' });
      }
    }
    if (this.slipTimer > 0) {
      this.slipTimer = Math.max(0, this.slipTimer - dt);
      this.vel.x += this.slipVX * dt * 4.0;
      this.vel.z += this.slipVZ * dt * 4.0;
      this.vel.x *= Math.exp(-dt * 3.2);
      this.vel.z *= Math.exp(-dt * 3.2);
    }

    // face movement, or face the camera while aiming
    if (this.aiming) {
      this.yaw = M.dampAngle(this.yaw, cy, 22, dt);
    } else if (len > 1e-4) {
      this.yaw = M.dampAngle(this.yaw, Math.atan2(dz, dx), 13, dt);
    }

    // gravity + jump
    var srf = this.world.surfaceAt(this.pos.x, this.pos.z, this.pos.y + 0.5, 0.75);
    var groundY = srf.y;
    if (this.grounded && ready && input.actHit('jump')) {
      this.vel.y = 5.15;
      this.grounded = false;
    }
    this.vel.y -= 19.6 * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= groundY + 0.001) {
      this.pos.y = groundY;
      if (this.vel.y < -12) this.takeDamage(Math.min(60, (-this.vel.y - 12) * 4.2), 'fall');
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.vel.y < -0.2) {
      this.grounded = false;
    }

    // move + collide
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    var out = {};
    var hits = this.world.resolveCircle(this.pos.x, this.pos.z, 0.36,
      this.pos.y + 0.25, this.pos.y + 1.7, out);
    if (hits) {
      this.pos.x = out.x; this.pos.z = out.z;
      // kill the velocity component pushing into the wall so you slide along it
      var vn = this.vel.x * out.nx + this.vel.z * out.nz;
      if (vn < 0) { this.vel.x -= vn * out.nx; this.vel.z -= vn * out.nz; }
    }
    this.clampToWorld();

    // being run over
    if (this.game.traffic) this.game.traffic.checkPedestrianHit(this, dt);

    this.findNearVehicle();
    if (ready && this.enterCooldown <= 0 && input.actHit('enter') && this.nearVehicle) {
      this.beginEnter(this.nearVehicle);
    }

    // The sloped beach transitions naturally into open water. Once the
    // player's feet are below the surface, switch to buoyant locomotion and
    // place their chest just under the wave crest so the camera and body read
    // as swimming rather than falling through the ocean.
    if (this.world.isWater(this.pos.x, this.pos.z, this.pos.y, this.game.time || 0)) {
      this.startSwimming();
    }
  };

  Player.prototype.startSwimming = function () {
    if (this.swimming) return;
    this.swimming = true;
    this.swimT = 0;
    this.grounded = false;
    this.vel.y = 0;
    var surface = this.world.waterSurfaceHeight(this.pos.x, this.pos.z, this.game.time || 0);
    this.pos.y = surface - 0.92;
    this.char.state = 'swim';
    this.game.bus.emit('toast', { text: 'Swimming — SPACE rises, C dives' });
  };

  Player.prototype.swimStep = function (dt, input) {
    var ready = input.ready() && !this.game.uiBlocking;
    var fwd = 0, side = 0;
    if (ready) { input.moveAxis(_mv); fwd = _mv.y; side = _mv.x; }
    var mag = M.clamp(Math.hypot(fwd, side), 0, 1);
    var sprint = ready && input.act('sprint');
    var maxSpeed = sprint ? 5.4 : 3.35;
    if (sprint && mag > 0 && this.stamina > 0) this.stamina = Math.max(0, this.stamina - dt * SPRINT_DRAIN * 0.55);
    else this.stamina = Math.min(1, this.stamina + dt * 0.13);

    var cy = this.camYaw;
    var dx = Math.cos(cy) * fwd + Math.cos(cy + Math.PI / 2) * side;
    var dz = Math.sin(cy) * fwd + Math.sin(cy + Math.PI / 2) * side;
    var len = Math.hypot(dx, dz);
    if (len > 1e-4) { dx /= len; dz /= len; } else { dx = dz = 0; }
    this.vel.x = M.damp(this.vel.x, dx * maxSpeed * mag, 5.5, dt);
    this.vel.z = M.damp(this.vel.z, dz * maxSpeed * mag, 5.5, dt);
    if (len > 1e-4) this.yaw = M.dampAngle(this.yaw, Math.atan2(dz, dx), 7, dt);

    var surface = this.world.waterSurfaceHeight(this.pos.x, this.pos.z, this.game.time || 0);
    var rise = ready && input.act('jump');
    var dive = ready && input.act('descend');
    var targetY = surface - (rise ? 0.20 : (dive ? 2.35 : 0.92));
    this.vel.y = M.damp(this.vel.y, (targetY - this.pos.y) * 3.8, 4.2, dt);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    this.swimT += dt;

    var out = {};
    var hits = this.world.resolveCircle(this.pos.x, this.pos.z, 0.34,
      this.pos.y + 0.1, this.pos.y + 1.45, out);
    if (hits) {
      this.pos.x = out.x; this.pos.z = out.z;
      var vn = this.vel.x * out.nx + this.vel.z * out.nz;
      if (vn < 0) { this.vel.x -= vn * out.nx; this.vel.z -= vn * out.nz; }
    }
    this.clampToWorld();

    var drySurface = this.world.surfaceAt(this.pos.x, this.pos.z, this.pos.y + 2, 3);
    var stillWater = this.world.isWater(this.pos.x, this.pos.z, this.pos.y, this.game.time || 0);
    if (!stillWater || (drySurface.y > surface - 0.12 && drySurface.y > this.pos.y + 0.7)) {
      this.swimming = false;
      this.pos.y = drySurface.y;
      this.vel.y = 0;
      this.grounded = true;
      this.char.state = 'idle';
      this.game.bus.emit('toast', { text: 'Back on dry land' });
      return;
    }
    // Keep a deep dive above the seabed while still allowing the dive control
    // to feel meaningful in the shallow water near the marina.
    var seabed = this.world.baseHeight(this.pos.x, this.pos.z);
    if (this.pos.y < seabed + 0.62) { this.pos.y = seabed + 0.62; this.vel.y = Math.max(0, this.vel.y); }
    this.grounded = false;
    this.char.state = 'swim';
  };

  Player.prototype.driveStep = function (dt, input) {
    var v = this.vehicle;
    if (!v) { this.mode = 'foot'; return; }
    var ready = input.ready() && !this.game.uiBlocking;
    var thr = 0, brk = 0;
    var fwd = ready ? input.driveAxis() : 0;
    var steer = 0;
    if (ready) { input.moveAxis(_mv); steer = _mv.x; }

    // W is forward, S is brake / reverse once stopped
    if (fwd > 0) {
      if (v.reverse && v.u > -0.4) v.reverse = false;
      if (v.reverse) brk = 1; else thr = 1;
    } else if (fwd < 0) {
      if (!v.reverse && v.u > 0.6) brk = 1;
      else { v.reverse = true; thr = 1; }
    } else {
      if (v.reverse && v.u > -0.3) v.reverse = false;
    }
    if (v.reverse && fwd > 0) { brk = 1; thr = 0; }

    var hand = (ready && input.act('handbrake')) ? 1 : 0;
    var abilityHit = ready && input.actHit('special');
    if (abilityHit && v.ability && v.activateAbility && v.activateAbility()) {
      this.game.bus.emit('toast', { text: v.abilityLabel + ' armed' });
    }
    v.step(dt, { throttle: thr, brake: brk, steer: steer, handbrake: hand, abilityHit: false });

    this.pos.copy(v.pos);
    this.yaw = v.yaw;

    if (v.destroyed && v.burning > 2.2) {
      this.takeDamage(dt * 30, 'fire');
    }

    this.boatInteriorPrompt = (v.craftType === 'boat' && v.hasInterior && v.speed() < 1.5)
      ? { text: 'Enter yacht cabin', key: 'E' } : null;
    if (ready && this.enterCooldown <= 0 && input.actHit('enter')) this.beginExit();
    if (ready && this.enterCooldown <= 0 && input.actHit('interact') &&
        v.craftType === 'boat' && v.hasInterior && v.speed() < 1.5) {
      this.enterYachtInterior(v);
      return;
    }
    if (input.actHit('horn') && this.game.audio) this.game.audio.horn(v);
    if (input.actHit('radio') && this.game.audio) {
      var on = this.game.audio.toggleRadio();
      this.game.bus.emit('toast', { text: on ? 'Radio on' : 'Radio off' });
    }
    if (input.actHit('station') && this.game.audio) {
      this.game.audio.nextStation();
      this.game.bus.emit('toast', { text: 'Station ' + (this.game.audio.station + 1) });
    }
  };

  // ------------------------------------------------------ yacht interior ----
  // The yacht cabin is attached to the boat, not a hidden city room. The
  // yacht is held stationary while the player walks its salon, so the local
  // collision bounds and the rendered cabin stay aligned.
  Player.prototype.enterYachtInterior = function (v) {
    if (!v || !v.hasInterior || v.destroyed || v.speed() > 1.5) return;
    var i = v.interior, p = new THREE.Vector3();
    v.localToWorld(i.spawnX, i.spawnZ, p);
    this.vehicle = v;
    v.u = v.v = v.yawRate = 0;
    v.throttle = 0; v.brake = 1;
    v.showInterior(true);
    this.mode = 'boatInterior';
    this.pos.set(p.x, v.pos.y + i.floorY + 0.08, p.z);
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.yaw = v.yaw;
    this.camYaw = v.yaw;
    this.char.state = 'idle';
    this.char.root.visible = true;
    this.boatInteriorPrompt = null;
    this.game.bus.emit('boatInteriorEntered', v);
  };

  Player.prototype.yachtInteriorStep = function (dt, input) {
    var v = this.vehicle;
    if (!v || !v.hasInterior || v.destroyed) {
      this.leaveYachtInterior();
      return;
    }
    var ready = input.ready() && !this.game.uiBlocking;
    var fwd = 0, side = 0;
    if (ready) { input.moveAxis(_mv); fwd = _mv.y; side = _mv.x; }
    var mag = M.clamp(Math.hypot(fwd, side), 0, 1);
    var sprint = ready && input.act('sprint');
    var maxSpeed = sprint ? RUN : WALK;
    var cy = this.camYaw;
    var dx = Math.cos(cy) * fwd + Math.cos(cy + Math.PI / 2) * side;
    var dz = Math.sin(cy) * fwd + Math.sin(cy + Math.PI / 2) * side;
    var len = Math.hypot(dx, dz);
    if (len > 1e-4) { dx /= len; dz /= len; } else { dx = dz = 0; }
    this.vel.x = M.damp(this.vel.x, dx * maxSpeed * mag, 18, dt);
    this.vel.z = M.damp(this.vel.z, dz * maxSpeed * mag, 18, dt);
    if (len > 1e-4) this.yaw = M.dampAngle(this.yaw, Math.atan2(dz, dx), 13, dt);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    var resolved = this._interiorResolve || (this._interiorResolve = {});
    v.resolveInteriorPlayer(this.pos.x, this.pos.z, 0.34, resolved);
    this.pos.x = resolved.x;
    this.pos.z = resolved.z;
    this.pos.y = v.pos.y + v.interior.floorY + 0.08;
    this.grounded = true;
    this.vel.y = 0;

    var exit = new THREE.Vector3();
    v.localToWorld(v.interior.exitX, v.interior.exitZ, exit);
    this.boatInteriorPrompt = M.dist2(this.pos.x, this.pos.z, exit.x, exit.z) < 2.0
      ? { text: 'Exit yacht cabin', key: 'E' } : null;
    if (ready && this.boatInteriorPrompt && input.actHit('interact')) this.leaveYachtInterior();
  };

  Player.prototype.leaveYachtInterior = function () {
    var v = this.vehicle;
    if (!v) { this.mode = 'foot'; return; }
    v.showInterior(false);
    this.mode = 'boat';
    this.char.root.visible = false;
    this.pos.copy(v.pos);
    this.yaw = v.yaw;
    this.camYaw = v.yaw;
    this.vel.set(0, 0, 0);
    this.enterCooldown = 0.4;
    this.boatInteriorPrompt = null;
    this.game.bus.emit('boatInteriorLeft', v);
  };

  // ---------------------------------------------------- enter / exit car ---
  Player.prototype.findNearVehicle = function () {
    var best = null, bd = 3.6 * 3.6;
    var g = this.game;
    var list = g.traffic ? g.traffic.allVehicles() : [];
    if (g.boats) list = list.concat(g.boats.list);
    if (g.aircraft) list = list.concat(g.aircraft.list());
    if (g.rail) list = list.concat(g.rail.list());
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      if (v === this.vehicle || v.locked || v.destroyed) continue;
      // Getting into a plane or heli mid-flight is not a thing; it has to be
      // on the ground (or, for a helicopter, low enough to be about to land).
      if (v.craftType === 'plane' && !v.grounded) continue;
      if (v.craftType === 'heli' && v.altitude > 2.5) continue;
      // you can only board a train that has stopped, and only at the cab
      if (v.craftType === 'train' && v.speed() > 1.2) continue;
      var d = M.dist2(v.pos.x, v.pos.z, this.pos.x, this.pos.z);
      if (d < bd) { bd = d; best = v; }
    }
    this.nearVehicle = best;
  };

  Player.prototype.beginEnter = function (v) {
    if (!v || this.mode !== 'foot') return;
    this.enterTarget = v;
    this.enterTimer = 0.45;
    this.enterMode = 'in';
    // eject whoever is driving
    if (v.driver && this.game.traffic) this.game.traffic.ejectDriver(v);
    if (this.game.audio) this.game.audio.blip('door');
    this.game.bus.emit('enterVehicle', v);
  };

  var _vehicleModes = { car: 1, boat: 1, boatInterior: 1, plane: 1, heli: 1, train: 1 };
  Player.prototype.beginExit = function () {
    if (this.mode === 'boatInterior') { this.leaveYachtInterior(); return; }
    if (!_vehicleModes[this.mode] || !this.vehicle) return;
    var v = this.vehicle;
    if (v.speed() > 9) return;                 // no jumping out at speed
    // Bailing out at altitude would otherwise teleport you straight to the
    // ground with no fall - block it above a couple of metres and let a
    // controlled landing be the only way out of the sky.
    if ((v.craftType === 'plane' || v.craftType === 'heli') && v.altitude > 3) {
      if (this.game.bus) this.game.bus.emit('toast', { text: 'Too high to get out' });
      return;
    }
    this.enterTimer = 0.35;
    this.enterMode = 'out';
    if (this.game.audio) this.game.audio.blip('door');
  };

  Player.prototype.finishEnterExit = function () {
    if (this.enterMode === 'in') {
      var v = this.enterTarget;
      // The car can be blown up or recycled during the half second the entry
      // animation is running; if it went away, just stay on foot.
      if (!v || v.exploded || !v.group.visible) {
        this.enterTarget = null;
        this.enterMode = null;
        this.mode = 'foot';
        return;
      }
      var self = this;
      this.vehicle = v;
      v.driver = this;
      v.isPlayer = true;
      this.mode = v.craftType || 'car';
      if (this.mode === 'car') {
        // a hard landing after real air time is a stunt jump
        v.onLandCb = function (impact) {
          if (self.game.missions) self.game.missions.checkStunt(v);
        };
        if (this.game.traffic) this.game.traffic.releaseToPlayer(v);
      }
      this.char.state = 'sit';
      this.char.root.visible = false;
      this.game.bus.emit('vehicleEntered', v);
    } else {
      var vv = this.vehicle;
      if (!vv) { this.mode = 'foot'; this.enterTarget = null; return; }
      var p = new THREE.Vector3();
      vv.doorPoint(-1, p);
      // do not drop the player inside a wall
      var out = {};
      this.world.resolveCircle(p.x, p.z, 0.4, p.y, p.y + 1.7, out);
      this.pos.set(out.hits ? out.x : p.x, vv.pos.y - (vv.spec.wheelR || 0) + 0.02, out.hits ? out.z : p.z);
      var srf = this.world.surfaceAt(this.pos.x, this.pos.z, this.pos.y + 1, 1.5);
      // Water has no walkable surface. Refuse to strand the player at sea;
      // dock and pier platforms are higher than the boat and pass this check.
      if (vv.craftType === 'boat' && srf.y < vv.pos.y + 0.45) {
        this.game.bus.emit('toast', { text: 'Return to a dock to get out' });
        this.enterTimer = 0;
        this.enterMode = null;
        return;
      }
      this.pos.y = srf.y;
      this.yaw = vv.yaw - Math.PI / 2;
      this.vel.set(0, 0, 0);
      this.mode = 'foot';
      this.char.state = 'idle';
      this.char.root.visible = true;
      vv.driver = null;
      vv.isPlayer = false;
      vv.throttle = 0; vv.brake = 1;
      this.vehicle = null;
      this.game.bus.emit('vehicleExited', vv);
    }
    this.enterTarget = null;
    this.enterCooldown = 0.4;
  };

  // ------------------------------------------------------------ damage -----
  // fromX/fromZ are optional and say where the damage came from, so the HUD
  // can point at it. Callers that have no meaningful origin (fire, a fall)
  // simply omit them and no indicator is drawn.
  Player.prototype.takeDamage = function (amount, source, fromX, fromZ) {
    if (this.dead) return;
    if (this.armor > 0) {
      var absorbed = Math.min(this.armor, amount * 0.72);
      this.armor -= absorbed;
      amount -= absorbed;
    }
    this.health -= amount;
    this.shake = Math.min(1, this.shake + amount * 0.010);
    this.game.bus.emit('playerHurt', {
      amount: amount, source: source,
      angle: (fromX === undefined || fromZ === undefined)
        ? null : Math.atan2(fromZ - this.pos.z, fromX - this.pos.x)
    });
    if (this.health <= 0) this.die(source);
  };

  Player.prototype.heal = function (n) {
    this.health = Math.min(this.maxHealth, this.health + n);
  };

  Player.prototype.die = function (source) {
    if (this.dead) return;
    this.dead = true;
    this.health = 0;
    this.respawnTimer = 3.2;
    this.char.root.visible = true;
    this.char.die();
    if (this.mode === 'boatInterior' && this.vehicle) this.vehicle.showInterior(false);
    if (_vehicleModes[this.mode] && this.vehicle) {
      var v = this.vehicle;
      var p = new THREE.Vector3();
      v.doorPoint(-1, p);
      this.pos.set(p.x, v.pos.y - (v.spec.wheelR || v.spec.gearH || 0), p.z);
      var srf = this.world.surfaceAt(this.pos.x, this.pos.z, this.pos.y + 4, 8);
      this.pos.y = srf.y;
      v.driver = null; v.isPlayer = false;
      this.vehicle = null;
      this.mode = 'foot';
    }
    this.game.bus.emit('playerDied', { source: source });
  };

  Player.prototype.doRespawn = function () {
    var hosp = this.game.hospital || { x: -104, z: -96 };
    this.money = Math.max(0, this.money - Math.min(500, Math.floor(this.money * 0.08)));
    this.spawnedOnce = true;
    this.dead = false;
    this.health = this.maxHealth;
    this.armor = 0;
    this.char.state = 'idle';
    this.char.deathT = 0;
    this.char.root.rotation.z = 0;
    if (this.vehicle && this.vehicle.interiorActive) this.vehicle.showInterior(false);
    if (this.vehicle) {
      this.vehicle.driver = null;
      this.vehicle.isPlayer = false;
    }
    this.vehicle = null;
    this.mode = 'foot';
    this.pos.set(hosp.x, 0.2, hosp.z);
    var s = this.world.surfaceAt(this.pos.x, this.pos.z, 40, 50);
    this.pos.y = s.y;
    this.vel.set(0, 0, 0);
    if (this.game.police) this.game.police.clearWanted();
    if (this.game.combat) this.game.combat.onRespawn();
    if (this.game.post) this.game.post.resetHistory();
    this.game.bus.emit('playerRespawned', {});
  };

  Player.prototype.clampToWorld = function () {
    // Air vehicles are intentionally free-flight: the city board is a
    // streaming backdrop, not a wall. Keep the ground-player safety clamp for
    // walking, while planes and helicopters can leave the authored map.
    if (this.mode === 'plane' || this.mode === 'heli') return;
    // Interiors live far outside the city bounds, so the clamp has to stand
    // down while you are inside one or it drags you straight back out.
    if (this.game.interiors && this.game.interiors.current) return;
    var B = this.game.layout.playBounds || this.game.layout.bounds;
    this.pos.x = M.clamp(this.pos.x, B.minX, B.maxX);
    this.pos.z = M.clamp(this.pos.z, B.minZ, B.maxZ);
    // drown-proofing: shove back ashore instead of sinking
    if (this.pos.y < -4.5) {
      this.pos.x = this.game.layout.beachX + 12;
      var s = this.world.surfaceAt(this.pos.x, this.pos.z, 40, 50);
      this.pos.y = s.y;
      this.vel.set(0, 0, 0);
      this.takeDamage(8, 'water');
    }
  };

  // ------------------------------------------------------------- render ----
  Player.prototype.render = function (dt, camera) {
    var input = this.game.input;
    if (this.game.sky && this.game.sky.setSwimmer) {
      this.game.sky.setSwimmer(this.pos.x, this.pos.z, this.swimming, this.swimT);
    }

    // --- look, from the mouse or from a drag on the right of the screen
    if (input.ready() && !this.game.uiBlocking && !this.game.paused) {
      var ld = input.lookDelta(_look);
      var sens = 0.0021 * (this.aiming ? 0.62 : 1);
      this.camYaw = M.wrapAngle(this.camYaw + ld.x * sens);
      this.camPitch = M.clamp(this.camPitch - ld.y * sens, -1.15, 0.95);
      if (Math.abs(ld.x) + Math.abs(ld.y) > 0.5) this.freeLook = 1.6;
    }
    this.freeLook = Math.max(0, this.freeLook - dt);

    var speed;
    if ((this.mode === 'car' || this.mode === 'boat') && this.vehicle) {
      var v = this.vehicle;
      v.updateVisual(dt, this.game.sky.lampFactor());
      // recentre behind the vehicle once you stop steering the camera
      if (this.freeLook <= 0) {
        var behind = v.yaw + (v.u < -0.5 ? Math.PI : 0);
        this.camYaw = M.dampAngle(this.camYaw, behind, 2.6, dt);
        this.camPitch = M.damp(this.camPitch, -0.14, 2.0, dt);
      }
      speed = v.speed();
      this.cameraForCar(dt, camera, v);
      this.char.root.visible = false;
    } else if ((this.mode === 'plane' || this.mode === 'heli') && this.vehicle) {
      var vc = this.vehicle;
      vc.updateVisual(dt, this.game.sky.lampFactor());
      if (this.freeLook <= 0) {
        this.camYaw = M.dampAngle(this.camYaw, vc.yaw, 2.0, dt);
        this.camPitch = M.damp(this.camPitch, -0.16, 1.6, dt);
      }
      speed = vc.speed();
      this.cameraForAircraft(dt, camera, vc);
      this.char.root.visible = false;
    } else {
      this.char.setPos(this.pos.x, this.pos.y, this.pos.z, this.yaw);
      this.char.animate(dt, Math.hypot(this.vel.x, this.vel.z), {
        aim: this.aiming ? 1 : 0,
        pitch: this.camPitch,
        recoil: this.game.combat ? this.game.combat.recoil : 0
      });
      this.char.root.visible = true;
      if (this.swimming) this.cameraForSwimming(dt, camera);
      else this.cameraForFoot(dt, camera);
    }

    this.aimAmount = M.damp(this.aimAmount, this.aiming ? 1 : 0, 12, dt);
    var targetFov;
    if (this.mode === 'car' || this.mode === 'boat') {
      targetFov = 62 + M.clamp((this.vehicle ? this.vehicle.speed() : 0) * 0.62, 0, 18);
    } else if (this.mode === 'plane' || this.mode === 'heli') {
      targetFov = 64 + M.clamp((this.vehicle ? this.vehicle.speed() : 0) * 0.35, 0, 16);
    } else {
      targetFov = this.swimming ? 66 : (this.aiming ? 46 : 62);
    }
    this.fov = M.damp(this.fov, targetFov, 6, dt);
    camera.fov = this.fov;
    camera.updateProjectionMatrix();

    this.shake = Math.max(0, this.shake - dt * 1.6);
    if (this.shake > 0.001) {
      var s = this.shake * 0.32;
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
      camera.position.z += (Math.random() - 0.5) * s;
    }
  };

  var _desired = new THREE.Vector3();
  var _target = new THREE.Vector3();

  Player.prototype.cameraForFoot = function (dt, camera) {
    var aim = this.aimAmount;
    var dist = M.lerp(4.5, 2.15, aim);
    var height = M.lerp(1.62, 1.55, aim);
    var side = M.lerp(0.35, 0.75, aim);

    _target.set(this.pos.x, this.pos.y + height, this.pos.z);
    var cp = Math.cos(this.camPitch);
    _desired.set(
      _target.x - Math.cos(this.camYaw) * cp * dist,
      _target.y - Math.sin(this.camPitch) * dist,
      _target.z - Math.sin(this.camYaw) * cp * dist);
    // shoulder offset
    var sx = Math.cos(this.camYaw + Math.PI / 2) * side;
    var sz = Math.sin(this.camYaw + Math.PI / 2) * side;
    _desired.x += sx; _desired.z += sz;
    _target.x += sx * 0.55; _target.z += sz * 0.55;

    this.placeCamera(camera, _target, _desired, dt, 16);
  };

  Player.prototype.cameraForSwimming = function (dt, camera) {
    var dist = 3.85;
    var height = 0.72;
    _target.set(this.pos.x, this.pos.y + height, this.pos.z);
    var cp = Math.cos(this.camPitch * 0.72);
    _desired.set(
      _target.x - Math.cos(this.camYaw) * cp * dist,
      _target.y - Math.sin(this.camPitch * 0.72) * dist,
      _target.z - Math.sin(this.camYaw) * cp * dist);
    this.placeCamera(camera, _target, _desired, dt, 8);
  };

  // Simpler chase cam for planes and helicopters: distance and height scale
  // with speed rather than with suspension travel, and - deliberately - the
  // camera stays upright in world space rather than banking with the
  // aircraft, which is what keeps a steep turn from being disorienting.
  Player.prototype.cameraForAircraft = function (dt, camera, v) {
    var sp = v.speed();
    var dist = 9 + (v.spec.len || v.spec.rotorR || 6) * 0.35 + M.clamp(sp * 0.05, 0, 10);
    var height = 3.2 + (v.spec.len || v.spec.rotorR || 6) * 0.12;

    _target.set(v.pos.x, v.pos.y + height * 0.35, v.pos.z);
    var cp = Math.cos(this.camPitch);
    _desired.set(
      _target.x - Math.cos(this.camYaw) * cp * dist,
      v.pos.y + height - Math.sin(this.camPitch) * dist,
      _target.z - Math.sin(this.camYaw) * cp * dist);

    this.placeCamera(camera, _target, _desired, dt, 7 + sp * 0.05);
  };

  Player.prototype.cameraForCar = function (dt, camera, v) {
    var sp = v.speed();
    var dist = 6.4 + v.spec.len * 0.30 + M.clamp(sp * 0.085, 0, 3.2);
    var height = 2.55 + v.spec.bodyH * 0.5 + M.clamp(sp * 0.012, 0, 0.7);

    _target.set(v.pos.x, v.pos.y + 1.05, v.pos.z);
    // look slightly ahead of the car so you can see where you are going
    var lead = M.clamp(v.u * 0.10, -3, 6);
    _target.x += Math.cos(v.yaw) * lead;
    _target.z += Math.sin(v.yaw) * lead;

    var cp = Math.cos(this.camPitch);
    _desired.set(
      _target.x - Math.cos(this.camYaw) * cp * dist,
      v.pos.y + height - Math.sin(this.camPitch) * dist,
      _target.z - Math.sin(this.camYaw) * cp * dist);

    this.placeCamera(camera, _target, _desired, dt, 11 + sp * 0.12);
  };

  // A yacht salon is compact, so the ordinary third-person foot camera would
  // sit outside the cabin and stare at its wall. Keep the shoulder camera
  // inside the room while preserving the same look controls and collision
  // smoothing as the rest of the game.
  Player.prototype.cameraForBoatInterior = function (dt, camera) {
    var dist = 0.92;
    var height = 1.30;
    _target.set(this.pos.x, this.pos.y + height, this.pos.z);
    var cp = Math.cos(this.camPitch);
    _desired.set(
      _target.x - Math.cos(this.camYaw) * cp * dist,
      _target.y - Math.sin(this.camPitch) * dist,
      _target.z - Math.sin(this.camYaw) * cp * dist);
    this.placeCamera(camera, _target, _desired, dt, 16);
  };

  // Smooth toward the desired position, then pull in if a building is in the
  // way so the camera never ends up inside geometry.
  Player.prototype.placeCamera = function (camera, target, desired, dt, rate) {
    this.camPos.x = M.damp(this.camPos.x, desired.x, rate, dt);
    this.camPos.y = M.damp(this.camPos.y, desired.y, rate, dt);
    this.camPos.z = M.damp(this.camPos.z, desired.z, rate, dt);

    var dx = this.camPos.x - target.x, dy = this.camPos.y - target.y, dz = this.camPos.z - target.z;
    var len = Math.hypot(dx, dy, dz);
    if (len > 0.05) {
      var hit = this.world.raycast(target.x, target.y, target.z, dx / len, dy / len, dz / len, len);
      if (hit) {
        var d = Math.max(0.9, hit.dist - 0.35);
        this.camPos.set(target.x + dx / len * d, target.y + dy / len * d, target.z + dz / len * d);
      }
    }
    // In a multi-floor interior, do not let a higher slab pull the camera
    // through the ceiling. Sample the player's current floor; the exterior
    // camera keeps its wider step-up tolerance for ramps and curbs.
    var inside = this.game.interiors && this.game.interiors.current;
    var camSurface = this.world.surfaceAt(this.camPos.x, this.camPos.z,
      inside ? this.pos.y + 0.6 : this.camPos.y + 2, inside ? 0.9 : 3);
    var minY = camSurface.y + 0.55;
    if (this.camPos.y < minY) this.camPos.y = minY;

    camera.position.copy(this.camPos);
    camera.lookAt(target);
    this.camLook.copy(target);
  };

  // Where bullets come from and go, used by the combat module.
  Player.prototype.aimRay = function (out) {
    var cam = this.game.camera;
    out.ox = cam.position.x; out.oy = cam.position.y; out.oz = cam.position.z;
    var d = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    out.dx = d.x; out.dy = d.y; out.dz = d.z;
    return out;
  };

  Player.prototype.eyePos = function (out) {
    out.set(this.pos.x, this.pos.y + 1.5, this.pos.z);
    return out;
  };

  SB.Player = Player;

})(window.SB = window.SB || {});
