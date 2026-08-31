// 14-combat.js - weapons and hitscan. Shots are traced from the camera so what
// the crosshair covers is what you hit, then drawn from the muzzle so the
// tracer reads correctly in third person.
(function (SB) {
  'use strict';

  var M = SB.M;

  var WEAPONS = SB.WEAPONS = [
    {
      id: 'fist', name: 'Fists', melee: true, damage: 22, rate: 0.42,
      range: 1.9, ammoMax: 0, slot: 1
    },
    {
      id: 'pistol', name: 'M9 Pistol', damage: 28, rate: 0.19, auto: false,
      spread: 0.010, range: 140, clip: 15, ammoMax: 180, recoil: 0.75,
      price: 450, slot: 2, sound: 'pistol'
    },
    {
      id: 'smg', name: 'Vector SMG', damage: 17, rate: 0.078, auto: true,
      spread: 0.026, range: 110, clip: 30, ammoMax: 360, recoil: 0.46,
      price: 1800, slot: 3, sound: 'smg'
    },
    {
      id: 'shotgun', name: 'Coastguard 12g', damage: 13, pellets: 9, rate: 0.78, auto: false,
      spread: 0.070, range: 46, clip: 6, ammoMax: 72, recoil: 2.4,
      price: 2600, slot: 4, sound: 'shotgun'
    },
    {
      id: 'rifle', name: 'AR Carbine', damage: 33, rate: 0.098, auto: true,
      spread: 0.016, range: 190, clip: 30, ammoMax: 300, recoil: 0.85,
      price: 5200, slot: 5, sound: 'rifle'
    }
  ];

  function weaponMesh(id) {
    return SB.geo('wpn-' + id, function () {
      var parts = [];
      var T = THREE.Matrix4;
      function add(w, h, d, x, y, z) {
        parts.push({ geo: new THREE.BoxGeometry(w, h, d), matrix: new T().makeTranslation(x, y, z) });
      }
      if (id === 'pistol') {
        add(0.20, 0.09, 0.05, 0.07, 0.02, 0);      // slide
        add(0.07, 0.16, 0.05, -0.02, -0.09, 0);    // grip
      } else if (id === 'smg') {
        add(0.30, 0.10, 0.06, 0.10, 0.02, 0);
        add(0.07, 0.18, 0.05, 0.00, -0.10, 0);
        add(0.16, 0.05, 0.05, 0.30, 0.01, 0);
      } else if (id === 'shotgun') {
        add(0.60, 0.07, 0.06, 0.22, 0.02, 0);
        add(0.16, 0.09, 0.06, -0.10, -0.03, 0);
        add(0.07, 0.14, 0.05, -0.02, -0.08, 0);
      } else if (id === 'rifle') {
        add(0.46, 0.09, 0.06, 0.16, 0.02, 0);
        add(0.10, 0.16, 0.05, 0.00, -0.09, 0);
        add(0.18, 0.05, 0.05, 0.46, 0.02, 0);
        add(0.13, 0.06, 0.05, -0.16, 0.00, 0);
      } else {
        return null;
      }
      return SB.mergeGeos(parts);
    });
  }

  function Combat(game) {
    this.game = game;
    this.scene = game.scene;
    this.world = game.world;

    this.owned = { fist: true, pistol: true };
    this.ammo = { pistol: 60, smg: 0, shotgun: 0, rifle: 0 };
    this.clip = { pistol: 15, smg: 0, shotgun: 0, rifle: 0 };
    this.index = 1;
    this.cool = 0;
    this.reloading = 0;
    this.recoil = 0;
    this.spreadHeat = 0;
    this.wasFiring = false;
    this.meshMat = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.5, metalness: 0.6 });
    this._ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
    this._hit = new THREE.Vector3();
    this.equip(1);
  }

  Combat.prototype.weapon = function () { return WEAPONS[this.index]; };

  Combat.prototype.equip = function (i) {
    i = M.clamp(i, 0, WEAPONS.length - 1);
    var w = WEAPONS[i];
    if (!this.owned[w.id]) return false;
    this.index = i;
    this.reloading = 0;
    var g = weaponMesh(w.id);
    var p = this.game.player;
    if (p) {
      if (g) {
        var mesh = new THREE.Mesh(g, this.meshMat);
        mesh.castShadow = true;
        mesh.rotation.set(0, 0, Math.PI / 2);
        mesh.position.set(0, -0.05, 0);
        p.char.setWeapon(mesh);
      } else {
        p.char.setWeapon(null);
      }
    }
    this.game.bus.emit('weaponChanged', w);
    return true;
  };

  Combat.prototype.give = function (id, ammo) {
    for (var i = 0; i < WEAPONS.length; i++) {
      if (WEAPONS[i].id !== id) continue;
      var isNew = !this.owned[id];
      this.owned[id] = true;
      this.ammo[id] = Math.min(WEAPONS[i].ammoMax, (this.ammo[id] || 0) + (ammo || WEAPONS[i].clip * 3));
      if (isNew) this.clip[id] = WEAPONS[i].clip;
      this.game.bus.emit('weaponPickup', WEAPONS[i]);
      return true;
    }
    return false;
  };

  Combat.prototype.cycle = function (dir) {
    var i = this.index;
    for (var n = 0; n < WEAPONS.length; n++) {
      i = (i + dir + WEAPONS.length) % WEAPONS.length;
      if (this.owned[WEAPONS[i].id]) { this.equip(i); return; }
    }
  };

  Combat.prototype.onRespawn = function () {
    // you keep your guns but lose the loaded rounds, GTA style
    this.index = 1;
    this.equip(1);
  };

  Combat.prototype.fixed = function (dt) {
    var g = this.game;
    var p = g.player;
    var input = g.input;
    if (!p || p.dead) { this.wasFiring = false; return; }

    this.cool -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 7);
    this.spreadHeat = Math.max(0, this.spreadHeat - dt * 2.6);

    if (input.locked) {
      for (var k = 0; k < WEAPONS.length; k++) {
        if (input.hit('Digit' + WEAPONS[k].slot)) this.equip(k);
      }
      if (input.mouse.wheel) this.cycle(input.mouse.wheel > 0 ? 1 : -1);
    }
    if (input.actHit('reload') && !input.down('ShiftLeft')) this.reload();
    if (input.touch.enabled && input.touch.hit.weapon) this.cycle(1);

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) this.finishReload();
      this.wasFiring = false;
      return;
    }

    if (p.mode === 'car') { this.wasFiring = false; return; }

    var w = this.weapon();
    var firing = input.ready() && !g.uiBlocking && input.act('fire');
    var trigger = w.auto ? firing : (firing && !this.wasFiring);
    this.wasFiring = firing;

    if (trigger && this.cool <= 0) {
      if (w.melee) {
        this.melee();
      } else if ((this.clip[w.id] || 0) > 0) {
        this.shoot(w);
      } else if ((this.ammo[w.id] || 0) > 0) {
        this.reload();
      } else {
        this.cool = 0.35;
        if (g.audio) g.audio.blip('dry');
      }
    }
  };

  Combat.prototype.reload = function () {
    var w = this.weapon();
    if (w.melee) return;
    if (this.reloading > 0) return;
    if ((this.clip[w.id] || 0) >= w.clip) return;
    if ((this.ammo[w.id] || 0) <= 0) return;
    this.reloading = w.id === 'shotgun' ? 1.5 : 1.15;
    if (this.game.audio) this.game.audio.blip('reload');
  };

  Combat.prototype.finishReload = function () {
    var w = this.weapon();
    var need = w.clip - (this.clip[w.id] || 0);
    var take = Math.min(need, this.ammo[w.id] || 0);
    this.clip[w.id] = (this.clip[w.id] || 0) + take;
    this.ammo[w.id] -= take;
  };

  Combat.prototype.melee = function () {
    var g = this.game, p = g.player;
    var w = this.weapon();
    this.cool = w.rate;
    this.recoil = 1;
    var cx = Math.cos(p.yaw), cz = Math.sin(p.yaw);
    var hx = p.pos.x + cx * 1.0, hz = p.pos.z + cz * 1.0;
    if (g.audio) g.audio.blip('swing');

    var hit = false;
    if (g.peds) {
      var ped = g.peds.nearest(hx, hz, w.range);
      if (ped) {
        g.peds.hurt(ped, w.damage, 'melee', cx, cz);
        hit = true;
      }
    }
    if (g.police) {
      var cop = g.police.nearestCop(hx, hz, w.range);
      if (cop) { g.police.hurtCop(cop, w.damage, cx, cz); hit = true; }
    }
    if (g.missions) {
      var en2 = g.missions.enemies.nearest(hx, hz, w.range);
      if (en2) { g.missions.enemies.hurt(en2, w.damage, cx, cz); hit = true; }
    }
    if (hit) {
      if (g.audio) g.audio.thud(hx, p.pos.y + 1.1, hz);
      if (g.police) g.police.reportCrime('assault', 0.6);
      if (g.fx) g.fx.impact(hx, p.pos.y + 1.1, hz, cx, 0.3, cz, 'flesh');
    }
  };

  Combat.prototype.shoot = function (w) {
    var g = this.game, p = g.player;
    this.cool = w.rate;
    this.clip[w.id]--;
    this.recoil = 1;
    this.spreadHeat = Math.min(1.6, this.spreadHeat + 0.42);

    // camera kick, damped back by the player controller
    p.camPitch = M.clamp(p.camPitch + w.recoil * 0.014 * (1 + this.spreadHeat * 0.4), -1.15, 0.95);
    p.shake = Math.min(1, p.shake + w.recoil * 0.05);

    var eye = new THREE.Vector3();
    p.eyePos(eye);
    var cx = Math.cos(p.yaw), cz = Math.sin(p.yaw);
    var muzzle = {
      x: eye.x + cx * 0.55 + Math.cos(p.yaw + Math.PI / 2) * 0.18,
      y: eye.y - 0.10,
      z: eye.z + cz * 0.55 + Math.sin(p.yaw + Math.PI / 2) * 0.18
    };

    var pellets = w.pellets || 1;
    var baseSpread = w.spread * (p.aiming ? 0.45 : 1) * (1 + this.spreadHeat * 0.8);
    for (var i = 0; i < pellets; i++) {
      this.traceShot(w, muzzle, baseSpread);
    }

    if (g.fx) {
      var r = this._ray;
      g.fx.muzzle(muzzle.x, muzzle.y, muzzle.z, r.dx, r.dy, r.dz, w.id === 'shotgun' ? 1.6 : 1);
    }
    if (g.audio) g.audio.gunshot(w, p.pos.x, p.pos.y + 1.4, p.pos.z);
    if (g.peds) g.peds.scare(p.pos.x, p.pos.z, 34);
    if (g.police) g.police.reportCrime('gunfire', 0.55);
  };

  var _tmpDir = new THREE.Vector3();

  Combat.prototype.traceShot = function (w, muzzle, spread) {
    var g = this.game, p = g.player;
    var cam = g.camera;
    var r = this._ray;
    r.ox = cam.position.x; r.oy = cam.position.y; r.oz = cam.position.z;
    _tmpDir.set(0, 0, -1).applyQuaternion(cam.quaternion);
    r.dx = _tmpDir.x + (Math.random() - 0.5) * spread * 2;
    r.dy = _tmpDir.y + (Math.random() - 0.5) * spread * 2;
    r.dz = _tmpDir.z + (Math.random() - 0.5) * spread * 2;
    var l = Math.hypot(r.dx, r.dy, r.dz);
    r.dx /= l; r.dy /= l; r.dz /= l;

    var best = w.range, kind = null, victim = null, nx = 0, ny = 0, nz = 0;

    var worldHit = this.world.raycast(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, w.range);
    if (worldHit) {
      best = worldHit.dist;
      kind = 'world';
      nx = worldHit.nx; ny = worldHit.ny; nz = worldHit.nz;
    }

    // pedestrians and police, as upright capsules
    var t;
    if (g.peds) {
      for (var i = 0; i < g.peds.list.length; i++) {
        var ped = g.peds.list[i];
        if (ped.dead) continue;
        t = rayCapsule(r, ped.x, ped.y, ped.z, 0.40, 1.82);
        if (t > 0.4 && t < best) { best = t; kind = 'ped'; victim = ped; }
      }
    }
    if (g.police) {
      for (i = 0; i < g.police.cops.length; i++) {
        var cop = g.police.cops[i];
        if (cop.dead) continue;
        t = rayCapsule(r, cop.x, cop.y, cop.z, 0.42, 1.86);
        if (t > 0.4 && t < best) { best = t; kind = 'cop'; victim = cop; }
      }
    }
    if (g.missions) {
      var el = g.missions.enemies.list;
      for (i = 0; i < el.length; i++) {
        var en = el[i];
        if (en.dead) continue;
        t = rayCapsule(r, en.x, en.y, en.z, 0.42, 1.86);
        if (t > 0.4 && t < best) { best = t; kind = 'enemy'; victim = en; }
      }
    }
    // vehicles, as boxes in their own frame
    if (g.traffic) {
      var cars = g.traffic._all || [];
      for (i = 0; i < cars.length; i++) {
        var v = cars[i];
        if (v === p.vehicle) continue;
        t = rayCarBox(r, v);
        if (t > 0.4 && t < best) { best = t; kind = 'car'; victim = v; }
      }
    }

    var hx = r.ox + r.dx * best, hy = r.oy + r.dy * best, hz = r.oz + r.dz * best;
    if (g.fx) {
      g.fx.tracers.add(muzzle.x, muzzle.y, muzzle.z, hx, hy, hz);
    }

    if (kind === 'ped') {
      var head = hy > victim.y + 1.52;
      g.peds.hurt(victim, w.damage * (head ? 2.6 : 1), 'gun', r.dx, r.dz);
      if (g.fx) g.fx.impact(hx, hy, hz, -r.dx, -r.dy, -r.dz, 'flesh');
    } else if (kind === 'cop') {
      var head2 = hy > victim.y + 1.52;
      g.police.hurtCop(victim, w.damage * (head2 ? 2.6 : 1), r.dx, r.dz);
      if (g.fx) g.fx.impact(hx, hy, hz, -r.dx, -r.dy, -r.dz, 'flesh');
      g.police.reportCrime('shootCop', 1);
    } else if (kind === 'enemy') {
      var head3 = hy > victim.y + 1.52;
      g.missions.enemies.hurt(victim, w.damage * (head3 ? 2.6 : 1), r.dx, r.dz);
      if (g.fx) g.fx.impact(hx, hy, hz, -r.dx, -r.dy, -r.dz, 'flesh');
    } else if (kind === 'car') {
      victim.damage(w.damage * 1.5, 'gun');
      if (victim.dormant) victim.dormant = false;
      if (victim.ai) victim.ai.panic = 2;
      if (g.fx) g.fx.impact(hx, hy, hz, -r.dx, -r.dy, -r.dz, 'metal');
    } else if (kind === 'world') {
      if (g.fx) g.fx.impact(hx, hy, hz, nx, ny, nz, 'concrete');
    }
    return kind;
  };

  // Ray against an upright capsule approximated as a cylinder with caps.
  function rayCapsule(r, cx, cy, cz, radius, height) {
    var ox = r.ox - cx, oz = r.oz - cz;
    var a = r.dx * r.dx + r.dz * r.dz;
    if (a < 1e-9) return -1;
    var b = 2 * (ox * r.dx + oz * r.dz);
    var c = ox * ox + oz * oz - radius * radius;
    var disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    var sq = Math.sqrt(disc);
    var t = (-b - sq) / (2 * a);
    if (t < 0) t = (-b + sq) / (2 * a);
    if (t < 0) return -1;
    var y = r.oy + r.dy * t;
    if (y < cy - 0.05 || y > cy + height) return -1;
    return t;
  }

  // Ray against a vehicle's oriented bounding box.
  function rayCarBox(r, v) {
    var s = v.spec;
    var ca = Math.cos(v.yaw), sa = Math.sin(v.yaw);
    // transform the ray into the car's local frame
    var dx = r.ox - v.pos.x, dz = r.oz - v.pos.z;
    var ox = dx * ca + dz * sa, oz = -dx * sa + dz * ca;
    var oy = r.oy - (v.pos.y - s.wheelR);
    var ddx = r.dx * ca + r.dz * sa, ddz = -r.dx * sa + r.dz * ca;
    var ddy = r.dy;
    var hx = s.len * 0.5, hz = s.wid * 0.5;
    var y0 = 0.05, y1 = s.wheelR + s.bodyH + s.roofH * 0.8;
    var t0 = 0, t1 = 1e9;
    var arr = [
      [ox, ddx, -hx, hx], [oy, ddy, y0, y1], [oz, ddz, -hz, hz]
    ];
    for (var i = 0; i < 3; i++) {
      var o = arr[i][0], d = arr[i][1], lo = arr[i][2], hi = arr[i][3];
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) return -1;
        continue;
      }
      var inv = 1 / d;
      var ta = (lo - o) * inv, tb = (hi - o) * inv;
      if (ta > tb) { var tmp = ta; ta = tb; tb = tmp; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
    return t0 > 0 ? t0 : -1;
  }

  Combat.prototype.render = function (dt) { };

  // Current spread in radians, so the HUD can size the crosshair honestly.
  Combat.prototype.currentSpread = function () {
    var w = this.weapon();
    if (w.melee) return 0;
    var p = this.game.player;
    return w.spread * (p && p.aiming ? 0.45 : 1) * (1 + this.spreadHeat * 0.8);
  };

  SB.Combat = Combat;

})(window.SB = window.SB || {});
