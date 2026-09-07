// 39-fire.js - fire, and the people whose job it is to put it out.
//
// The city could be shot at, crashed into and blown up, and none of it left a
// mark that lasted more than a particle burst. A car that exploded made a
// noise and then sat there. Nothing in Sunset Bay could burn.
//
// This adds fire as a thing the world does rather than an effect the world
// plays: a fire has a position, a size, fuel to burn through and the ability
// to reach whatever is standing next to it. It hurts you if you stand in it,
// it spreads if you leave it, and it goes out either because it ran out of
// things to burn or because somebody put water on it.
//
// And because a city that burns needs somebody whose job that is, it adds the
// fire service: a station with an apparatus bay, engines that get dispatched
// to calls and drive there over the same road graph everything else uses, and
// a shift you can take yourself - take an engine off the forecourt, hold the
// deck gun on the fire, and get paid per call.
(function (SB) {
  'use strict';

  var M = SB.M;

  var MAX_FIRES = 18;
  var GROWTH = 0.30;          // intensity per second while it has fuel
  var SPREAD_CHECK = 2.2;     // seconds between spread attempts
  var SPREAD_RANGE = 26;
  var HOSE_RANGE = 30;
  var HOSE_POWER = 1.05;      // intensity removed per second, full pressure
  var AI_HOSE_POWER = 0.42;   // a crew works steadily, not heroically
  var ENGINE_COUNT = 2;
  var CALL_PAY = 420;         // per fire the player puts out on shift
  var AMBIENT_MIN = 260;      // seconds between fires nobody caused
  var AMBIENT_MAX = 540;
  var SHIFT_MIN = 26;         // on shift, calls come far more often
  var SHIFT_MAX = 70;

  // ------------------------------------------------------------- a fire ---
  function Fire(x, y, z, opts) {
    this.x = x; this.y = y; this.z = z;
    this.kind = opts.kind || 'building';
    this.r = opts.r || 6;
    this.maxR = opts.maxR || this.r;
    this.intensity = 0.14;
    this.fuel = opts.fuel === undefined ? 150 : opts.fuel;
    this.vehicle = opts.vehicle || null;
    this.building = opts.building || null;
    this.spreadTimer = SPREAD_CHECK;
    this.out = false;
    this.age = 0;
    this.reported = false;
    this.claimed = null;      // the engine that took the call
  }

  // ------------------------------------------------------------- system ---
  function Fires(game) {
    this.game = game;
    this.L = game.layout;
    this.world = game.world;
    this.rng = M.rng(0xF12E01);
    this.list = [];
    this.engines = [];
    this.station = null;
    this.shift = null;
    this.landmarks = [];
    this.stats = { started: 0, doused: 0, byPlayer: 0, spread: 0 };
    this.ambient = this.rng.range(AMBIENT_MIN, AMBIENT_MAX);
    this.hoseHeat = 0;
    this._tmp = new THREE.Vector3();

    this.buildStation();
    this.buildFlames();
    this.bind();
  }

  // --------------------------------------------------------- the station --
  // Built on the block the layout reserved for it. The bay doors face the
  // longest street frontage, and the forecourt in front of them is a real
  // surface with the engines parked on it, so "the engines come out of the
  // station" is a thing you can watch rather than a spawn.
  Fires.prototype.buildStation = function () {
    var g = this.game;
    var blk = this.L.landmarks && this.L.landmarks.firehouse;
    if (!blk) return;

    var root = new THREE.Group();
    root.name = 'fire-station';
    g.scene.add(root);
    this.root = root;

    var cx = blk.cx, cz = blk.cz;
    var y = this.world.baseHeight(cx, cz);
    // Face the doors at the nearest road, so the apron opens onto tarmac.
    var node = SB.Roads.nearestNode(this.L, cx, cz);
    var yaw = Math.atan2(node.z - cz, node.x - cx);
    var c = Math.cos(yaw), s = Math.sin(yaw);

    var HW = Math.min(19, Math.max(11, (blk.x1 - blk.x0) * 0.32));
    var HD = Math.min(15, Math.max(9, (blk.z1 - blk.z0) * 0.32));
    var H = 9.5;

    var brick = new SB.QB(), trim = new SB.QB(), door = new SB.QB(), apron = new SB.QB();
    // The house itself, pulled back from the street by the depth of the apron.
    var bx = cx - c * 4, bz = cz - s * 4;
    brick.obox(bx, y, bz, HW, HD, y + H, yaw, 4, 4, 4, {});
    trim.obox(bx, y + H, bz, HW + 0.7, HD + 0.7, y + H + 0.8, yaw, 4, 4, 4, {});
    g.world.addBox(bx - HW - 1, bz - HD - 1, bx + HW + 1, bz + HD + 1, y, y + H + 0.8, 'building');

    // Three bay doors on the street face, and the apron they open onto.
    var fx = bx + c * HD, fz = bz + s * HD;      // centre of the door wall
    var px = -s, pz = c;                          // along the wall
    for (var d = -1; d <= 1; d++) {
      var dx = fx + px * d * (HW * 0.58), dz = fz + pz * d * (HW * 0.58);
      door.obox(dx, y + 0.05, dz, HW * 0.25, 0.45, y + 5.2, yaw, 3, 3, 3, {});
    }
    var ax = cx + c * (HD + 7), az = cz + s * (HD + 7);
    apron.obox(ax, y + 0.02, az, HW, 8, y + 0.06, yaw, 6, 6, 6, {});
    g.world.addPlatform(ax - HW - 2, az - HW - 2, ax + HW + 2, az + HW + 2, y + 0.06, 'concrete');

    // A band of windows on the upper floor and a white string course, so the
    // house reads as a building rather than a red box with doors in it.
    var band = new SB.QB();
    for (var wq = -3; wq <= 3; wq++) {
      var wx2 = fx + px * wq * (HW * 0.26), wz2 = fz + pz * wq * (HW * 0.26);
      band.obox(wx2 + c * 0.06, y + 6.2, wz2 + s * 0.06, HW * 0.09, 0.12, y + 7.9, yaw, 2, 2, 2, {});
    }
    trim.obox(bx + c * 0.05, y + 5.55, bz + s * 0.05, HW + 0.1, HD + 0.1, y + 5.85, yaw, 4, 4, 4, {});

    root.add(brick.mesh(new THREE.MeshStandardMaterial({ color: 0x8e3a2c, roughness: 0.9 }), true, true));
    root.add(band.mesh(new THREE.MeshStandardMaterial({ color: 0x1b2632, roughness: 0.35,
      metalness: 0.2 }), false, false));
    root.add(trim.mesh(new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.8 }), true, true));
    root.add(door.mesh(new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 0.35, roughness: 0.5 }), true, true));
    root.add(apron.mesh(new THREE.MeshStandardMaterial({ color: 0x4d5158, roughness: 0.95 }), false, true));

    // The sign, and the lamp over the doors that stays on all night. A plane
    // with rotation.y = t has normal (sin t, 0, cos t), so facing it out along
    // the door wall's own direction (cos yaw, sin yaw) means t = pi/2 - yaw,
    // not yaw + pi/2 - which is the same angle mirrored, and hangs the sign
    // backwards over the forecourt.
    this.sign('SUNSET BAY FIRE  ·  STATION 12',
      fx + c * 0.55, y + 7.1, fz + s * 0.55, HW * 1.3, 0xffd08a, Math.PI / 2 - yaw);
    var lampMat = new THREE.MeshStandardMaterial({
      color: 0xffe0a8, emissive: 0xffb254, emissiveIntensity: 1.4, roughness: 0.4 });
    this.lampMat = lampMat;
    var lamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.5), lampMat);
    lamp.position.set(fx + c * 1.1, y + 6.0, fz + s * 1.1);
    lamp.rotation.y = yaw;
    root.add(lamp);

    this.station = {
      x: cx, z: cz, y: y, yaw: yaw, block: blk,
      apron: { x: ax, z: az, y: y + 0.06 },
      // Where engines sit when they are not out. Three bays, one spare bay
      // left empty so the player's engine has somewhere to come back to.
      bays: [
        { x: ax + px * (HW * 0.58), z: az + pz * (HW * 0.58), yaw: yaw },
        { x: ax, z: az, yaw: yaw },
        { x: ax - px * (HW * 0.58), z: az - pz * (HW * 0.58), yaw: yaw }
      ],
      // Standing here on foot is what starts and ends a shift.
      desk: { x: ax + c * 2, z: az + s * 2 }
    };
    this.landmarks.push({ id: 'firehouse', name: 'Fire Station 12',
      x: cx, z: cz, color: 0xff6a4a, icon: '▮', kind: 'service', priority: 2 });
  };

  Fires.prototype.sign = function (text, x, y, z, width, color, yaw) {
    var canvas = SB.Tex.canvas(512, 96), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#20120e'; ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 50, 490);
    var tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 96 / 512),
      new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff,
        emissiveIntensity: 0.8, roughness: 0.6, side: THREE.DoubleSide }));
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw || 0;
    this.root.add(mesh);
  };

  // ---------------------------------------------------------- the flames --
  // One instanced quad set for every flame in the city. Each fire owns a slice
  // of the instances; unused ones are scaled to nothing rather than removed,
  // so the buffer never changes size and there is no per-frame allocation.
  var PER_FIRE = 11;

  Fires.prototype.buildFlames = function () {
    var g = this.game;
    var geo = new THREE.PlaneGeometry(1, 1);
    // A hard-edged blob rather than the soft one used for shadows and glows:
    // additive blending plus a wide soft falloff reads as a lens flare in
    // daylight, which is how the first version of this looked - a pale wash
    // over the trees with no fire in it. Small, dense, hard-edged tongues
    // hold their colour against a bright sky.
    var mat = new THREE.MeshBasicMaterial({
      map: SB.Tex.blobHard(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, opacity: 1 });
    this.flames = new THREE.InstancedMesh(geo, mat, MAX_FIRES * PER_FIRE);
    this.flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.flames.frustumCulled = false;
    this.flames.renderOrder = 6;
    this.flames.count = 0;
    var col = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FIRES * PER_FIRE * 3), 3);
    this.flames.instanceColor = col;
    g.scene.add(this.flames);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._sc = new THREE.Vector3(1, 1, 1);
    this._pos = new THREE.Vector3();
    this._c = new THREE.Color();

    // Two lights, handed to whichever fires are nearest the camera. A light
    // per fire is what turns a burning street into a slideshow.
    this.lights = [];
    for (var i = 0; i < 2; i++) {
      var l = new THREE.PointLight(0xff7a2a, 0, 46, 2);
      l.visible = false;
      g.scene.add(l);
      this.lights.push(l);
    }
  };

  Fires.prototype.bind = function () {
    var self = this, g = this.game;
    // Standing on the apron takes or ends a shift.
    window.addEventListener('keydown', function (e) {
      if (e.code !== 'KeyN' || e.repeat) return;
      if (!g.started || g.paused || g.uiBlocking) return;
      if (!self.station || !g.player || g.player.mode !== 'foot') return;
      if (M.dist(g.player.pos.x, g.player.pos.z, self.station.desk.x, self.station.desk.z) > 16) return;
      e.preventDefault();
      if (self.shift) self.endShift('You stood down.'); else self.startShift();
    });
  };

  // ------------------------------------------------------------ ignition --
  // Everything that can start a fire comes through here, which is also where
  // the population cap and the "not on top of an existing fire" rule live.
  Fires.prototype.ignite = function (x, z, opts) {
    opts = opts || {};
    if (this.list.length >= MAX_FIRES) return null;
    var r = opts.r || 6;
    for (var i = 0; i < this.list.length; i++) {
      var f = this.list[i];
      if (M.dist(f.x, f.z, x, z) < Math.max(f.r, r) * 1.1) return null;
    }
    // Rain does not stop a fire starting, but snow and rain both make it a
    // much harder sell.
    var w = this.game.weather;
    if (w && !opts.forced) {
      if (w.mode === 'rain' && this.rng() < 0.45) return null;
      if (w.mode === 'snow' && this.rng() < 0.6) return null;
    }
    var y = opts.y === undefined ? this.world.baseHeight(x, z) : opts.y;
    var fire = new Fire(x, y, z, opts);
    this.list.push(fire);
    this.stats.started++;
    if (this.game.peds) this.game.peds.scare(x, z, 26);
    return fire;
  };

  // Somewhere worth setting alight: a building on a block, chosen away from
  // the player so a fire does not simply appear in front of you.
  Fires.prototype.pickBuilding = function (minDist) {
    var city = this.game.city, p = this.game.player;
    if (!city || !city.buildings.length) return null;
    for (var tries = 0; tries < 40; tries++) {
      var b = city.buildings[(this.rng() * city.buildings.length) | 0];
      if (!b || b.h < 5) continue;
      if (p && M.dist(b.cx, b.cz, p.pos.x, p.pos.z) < (minDist || 140)) continue;
      if (this.game.layout && SB.Islands && SB.Islands.near(b.cx, b.cz, 0)) continue;
      return b;
    }
    return null;
  };

  Fires.prototype.igniteBuilding = function (b, opts) {
    opts = opts || {};
    opts.kind = 'building';
    opts.building = b;
    opts.r = Math.min(11, Math.max(5, Math.min(b.hw, b.hd) * 0.8));
    opts.maxR = opts.r * 1.5;
    opts.fuel = 90 + this.rng() * 150;
    opts.y = b.baseY;
    // Fires start at the wall, not in the middle of a solid block, so the
    // flames are somewhere you can actually reach with a hose.
    var a = this.rng() * Math.PI * 2;
    var x = b.cx + Math.cos(a) * b.hw * 0.85;
    var z = b.cz + Math.sin(a) * b.hd * 0.85;
    return this.ignite(x, z, opts);
  };

  // ---------------------------------------------------------- simulation --
  Fires.prototype.fixed = function (dt) {
    var i, f;
    var p = this.game.player;

    // ambient calls
    this.ambient -= dt;
    if (this.ambient <= 0) {
      this.ambient = this.shift
        ? this.rng.range(SHIFT_MIN, SHIFT_MAX)
        : this.rng.range(AMBIENT_MIN, AMBIENT_MAX);
      var b = this.pickBuilding(this.shift ? 90 : 160);
      if (b) {
        var started = this.igniteBuilding(b);
        if (started && this.shift) this.dispatchToast(started);
      }
    }

    // burning vehicles are fires too, so an engine will come to a car fire
    this.adoptVehicleFires();

    for (i = this.list.length - 1; i >= 0; i--) {
      f = this.list[i];
      f.age += dt;

      if (f.vehicle) {
        // The fire follows the car until the car stops being a car.
        if (f.vehicle.exploded || !f.vehicle.group || !f.vehicle.group.visible) {
          f.vehicle = null;
        } else {
          f.x = f.vehicle.pos.x; f.z = f.vehicle.pos.z;
          f.y = f.vehicle.pos.y - f.vehicle.spec.wheelR;
        }
      }

      if (f.fuel > 0) {
        f.fuel -= dt;
        f.intensity = Math.min(1, f.intensity + GROWTH * dt * (0.4 + f.intensity));
      } else {
        // out of fuel: it dies down on its own
        f.intensity -= dt * 0.16;
      }

      // Weather is worth something: rain will not put a fire out but it
      // holds it back, which is what makes a storm the easy shift.
      var w = this.game.weather;
      if (w && w.mode === 'rain') f.intensity -= dt * 0.035;
      if (w && w.mode === 'snow') f.intensity -= dt * 0.055;

      if (f.intensity <= 0.02) {
        this.extinguish(f, i, false);
        continue;
      }

      // spread
      f.spreadTimer -= dt;
      if (f.spreadTimer <= 0) {
        f.spreadTimer = SPREAD_CHECK;
        if (f.intensity > 0.62 && f.fuel > 0) this.trySpread(f);
      }

      // the player, standing too close
      if (p && !p.dead) {
        var d = M.dist(p.pos.x, p.pos.z, f.x, f.z);
        var reach = f.r * (0.65 + f.intensity * 0.5);
        if (d < reach && Math.abs(p.pos.y - f.y) < 6) {
          p.takeDamage(dt * 26 * f.intensity * (1 - d / reach) * 2, 'fire');
        }
      }

      // cars parked in it catch light
      if (this.game.traffic && f.intensity > 0.5) {
        var near = this.game.traffic.grid.queryPoint(f.x, f.z, f.r + 2,
          this.game.traffic._q, this.game.traffic._stamp++);
        for (var k = 0; k < near.length; k++) {
          var v = near[k];
          if (v.burning > 0 || v.exploded) continue;
          if (M.dist(v.pos.x, v.pos.z, f.x, f.z) > f.r + 1.5) continue;
          v.damage(dt * 22, 'fire');
        }
      }
    }

    this.stepEngines(dt);
    this.stepPlayerHose(dt);
    this.stepShift(dt);
  };

  // A car set alight by anything - a crash, a gunfight, a grenade - becomes a
  // fire the service knows about, rather than a private particle effect.
  Fires.prototype.adoptVehicleFires = function () {
    var tr = this.game.traffic;
    if (!tr) return;
    var all = tr.allVehicles();
    for (var i = 0; i < all.length; i++) {
      var v = all[i];
      if (!(v.burning > 0) || v.exploded || v._fire) continue;
      var f = this.ignite(v.pos.x, v.pos.z, {
        kind: 'vehicle', vehicle: v, r: 3.6, maxR: 4.6, fuel: 26, forced: true
      });
      if (f) v._fire = f;
    }
  };

  // Spread has to be bounded twice over or it is not a hazard, it is the end
  // of the city: an unbounded per-fire chance is exponential, and the first
  // version of this took one building to the whole cap in seventy seconds.
  // A fire can start at most SPREAD_LIMIT others, the block only burns while
  // there are fewer than SPREAD_CEILING fires going, and each generation
  // carries less fuel than the one before it, so a blaze left alone burns a
  // street rather than a district.
  var SPREAD_LIMIT = 2;
  var SPREAD_CEILING = 7;

  Fires.prototype.trySpread = function (f) {
    var city = this.game.city;
    if (!city || this.list.length >= Math.min(MAX_FIRES, SPREAD_CEILING)) return;
    if ((f.spreads || 0) >= SPREAD_LIMIT) return;
    if ((f.generation || 0) >= 3) return;
    var w = this.game.weather;
    var chance = 0.055 * f.intensity;
    if (w && w.mode === 'rain') chance *= 0.35;
    if (w && w.mode === 'snow') chance *= 0.2;
    if (this.rng() > chance) return;
    // Nearest building that is not the one already alight.
    var best = null, bd = SPREAD_RANGE;
    for (var i = 0; i < city.buildings.length; i++) {
      var b = city.buildings[i];
      if (b === f.building) continue;
      var d = M.dist(b.cx, b.cz, f.x, f.z);
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) return;
    var made = this.igniteBuilding(best, { forced: true });
    if (made) {
      this.stats.spread++;
      f.spreads = (f.spreads || 0) + 1;
      made.generation = (f.generation || 0) + 1;
      made.fuel *= 0.6;
    }
  };

  Fires.prototype.extinguish = function (f, index, byWater) {
    if (index === undefined) index = this.list.indexOf(f);
    if (index < 0) return;
    this.list.splice(index, 1);
    f.out = true;
    if (f.vehicle) { f.vehicle._fire = null; if (byWater) f.vehicle.burning = 0; }
    if (f.claimed) f.claimed.call = null;
    this.stats.doused++;
    if (byWater) {
      this.stats.byPlayer++;
      if (this.shift) {
        this.shift.calls++;
        var pay = Math.round(CALL_PAY * (f.kind === 'building' ? 1.35 : 1));
        this.game.player.money += pay;
        if (this.game.progress) {
          this.game.progress.stats.earned += pay;
          this.game.progress.award(f.kind === 'building' ? 55 : 30, 'Fire out');
        }
        this.game.bus.emit('toast', {
          text: 'Fire out  ·  ' + SB.formatMoney(pay), color: '#ffb066' });
      } else {
        this.game.bus.emit('toast', { text: 'Fire out', color: '#ffb066' });
      }
    }
  };

  // Water on a fire, from anywhere: the player's deck gun and an engine crew
  // both come through here so they cannot drift apart on what water does.
  Fires.prototype.douse = function (x, y, z, dirX, dirZ, range, power, dt) {
    var hit = null;
    for (var i = this.list.length - 1; i >= 0; i--) {
      var f = this.list[i];
      var dx = f.x - x, dz = f.z - z;
      var d = Math.hypot(dx, dz);
      if (d > range + f.r) continue;
      if (Math.abs(f.y - y) > 14) continue;
      if (dirX !== null && d > 1) {
        // a hose is aimed, not sprayed in a circle
        var dot = (dx / d) * dirX + (dz / d) * dirZ;
        if (dot < 0.72) continue;
      }
      f.intensity -= power * dt;
      f.fuel -= power * dt * 26;      // water takes the heat out of the fuel
      hit = f;
      if (f.intensity <= 0.02) this.extinguish(f, i, true);
    }
    return hit;
  };

  // ------------------------------------------------------------- engines --
  Fires.prototype.ensureEngines = function () {
    var tr = this.game.traffic;
    if (!tr || !this.station) return;
    while (this.engines.length < ENGINE_COUNT) {
      var bay = this.station.bays[this.engines.length];
      if (tr.occupied(bay.x, bay.z, 5)) return;
      var v = tr.acquire('fire');
      if (!v) return;
      v.setColor(0xc0271c);
      v.placeAt(bay.x, bay.z, bay.yaw);
      v.isEngine = true;
      v._in = { throttle: 0, brake: 1, steer: 0, handbrake: 1 };
      this.dressEngine(v);
      this.engines.push({
        v: v, bay: bay, state: 'station', call: null,
        reroute: 0, targetNode: -1, stuck: 0, work: 0
      });
    }
  };

  // A ladder on the roof and a beacon at each corner, so an engine is an
  // engine from behind as well as in the mirror.
  Fires.prototype.dressEngine = function (v) {
    if (v._dressed) { v._dressed.visible = true; return; }
    var s = v.spec;
    var g = new THREE.Group();
    var rail = new THREE.MeshStandardMaterial({ color: 0xb9bec6, metalness: 0.6, roughness: 0.4 });
    var top = s.wheelR + s.bodyH + s.roofH + 0.06;
    var ladder = new THREE.Mesh(new THREE.BoxGeometry(s.len * 0.78, 0.16, 0.34), rail);
    ladder.position.set(-s.len * 0.04, top + 0.16, 0);
    g.add(ladder);
    for (var i = 0; i < 7; i++) {
      var rung = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.62), rail);
      rung.position.set(-s.len * 0.4 + i * (s.len * 0.72 / 6), top + 0.16, 0);
      g.add(rung);
    }
    var beaconMat = new THREE.MeshStandardMaterial({
      color: 0x5a0d0a, emissive: 0xff2a12, emissiveIntensity: 0 });
    v._beacons = [];
    for (var b = 0; b < 2; b++) {
      var lamp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.3), beaconMat.clone());
      lamp.position.set(s.len * 0.24, top + 0.1, (b ? 1 : -1) * s.wid * 0.36);
      g.add(lamp);
      v._beacons.push(lamp);
    }
    v.group.add(g);
    v._dressed = g;
  };

  // Where an engine actually stops. Not at the fire: a structure fire is at a
  // building wall, and an engine that drives at the wall grinds against it,
  // reverses, and comes back for as long as the fire burns - which is exactly
  // what the first version of this did. The engine stops on the road nearest
  // the fire and works from there, which is both what happens in reality and
  // the only place a seven-metre vehicle can get to.
  Fires.prototype.stagingPoint = function (f) {
    if (f.stage) return f.stage;
    var L = this.L;
    var best = null, bd = 1e18;
    var list = L.edgeGrid.queryPoint(f.x, f.z, 90, this._eq || (this._eq = []),
      (this._es = (this._es || 0) + 1));
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.elevated) continue;
      var a = L.nodes[e.a], b = L.nodes[e.b];
      var dx = b.x - a.x, dz = b.z - a.z;
      var len2 = dx * dx + dz * dz;
      if (len2 < 1e-6) continue;
      var t = M.clamp(((f.x - a.x) * dx + (f.z - a.z) * dz) / len2, 0, 1);
      var px = a.x + dx * t, pz = a.z + dz * t;
      var d = M.dist2(px, pz, f.x, f.z);
      if (d < bd) { bd = d; best = { x: px, z: pz }; }
    }
    if (!best) {
      var n = SB.Roads.nearestNode(L, f.x, f.z);
      best = { x: n.x, z: n.z };
    }
    f.stage = best;
    return best;
  };

  Fires.prototype.nearestCall = function (e) {
    var best = null, bd = 1e9;
    for (var i = 0; i < this.list.length; i++) {
      var f = this.list[i];
      if (f.claimed && f.claimed !== e) continue;
      if (f.kind === 'vehicle' && f.fuel < 6) continue;   // it will be out first
      var d = M.dist(f.x, f.z, e.v.pos.x, e.v.pos.z);
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  };

  // The engine bodies, for the traffic broadphase and for "what car am I
  // standing next to". Cached because it is asked for twice every step.
  Fires.prototype.vehicles = function () {
    if (this._veh && this._vehN === this.engines.length) return this._veh;
    this._veh = [];
    for (var i = 0; i < this.engines.length; i++) this._veh.push(this.engines[i].v);
    this._vehN = this.engines.length;
    return this._veh;
  };

  Fires.prototype.stepEngines = function (dt) {
    this.ensureEngines();
    for (var i = 0; i < this.engines.length; i++) {
      var e = this.engines[i];
      var v = e.v;
      // The player can take an engine. While they are in it, the crew is not.
      if (this.game.player && this.game.player.vehicle === v) {
        e.state = 'player';
        e.call = null;
        continue;
      }
      if (e.state === 'player') { e.state = 'station'; e._in = null; }
      if (v.destroyed) { e.state = 'wreck'; continue; }

      if (e.call && (e.call.out || this.list.indexOf(e.call) < 0)) e.call = null;

      if (!e.call) {
        var f = this.nearestCall(e);
        if (f) { e.call = f; f.claimed = e; e.state = 'enroute'; e.reroute = 0; }
        else if (e.state !== 'station') e.state = 'returning';
      }

      var target = e.call ? this.stagingPoint(e.call) : e.bay;
      var dist = M.dist(v.pos.x, v.pos.z, target.x, target.z);
      // Hysteresis: once it has stopped it stays stopped until the call is
      // over. Without it the engine creeps in and out of its own arrival
      // radius for as long as the fire burns.
      var arrived = e.call
        ? (e.state === 'onscene' ? dist < 20 : dist < 9)
        : dist < 6;

      if (arrived) {
        v._in.throttle = 0; v._in.brake = 1; v._in.steer = 0; v._in.handbrake = 1;
        v.step(dt, v._in);
        if (e.call) {
          e.state = 'onscene';
          e.work += dt;
          // Crew on the hose. Aimed from the engine at the fire, so parking
          // behind a building genuinely does not work.
          var dx = e.call.x - v.pos.x, dz = e.call.z - v.pos.z;
          var dl = Math.hypot(dx, dz) || 1;
          this.douse(v.pos.x, v.pos.y, v.pos.z, dx / dl, dz / dl,
            HOSE_RANGE, AI_HOSE_POWER, dt);
          if (this.game.fx && this.rng() < 0.55) {
            this.game.fx.smoke(
              v.pos.x + dx / dl * 3, v.pos.y + 1.9, v.pos.z + dz / dl * 3,
              dx / dl * 9, 1.1, dz / dl * 9, 0.7, 0.5, 0xdfefff, 0.35);
          }
        } else {
          e.state = 'station';
        }
        v.sirenOn = false;
        continue;
      }

      v.sirenOn = !!e.call;
      this.driveEngine(e, dt, target);
      // Nothing else steps these: they are not in the traffic lists and not
      // the player's car, so the fire service owns their physics the same way
      // the police own a pursuit car's.
      v.step(dt, v._in);
    }
  };

  var _tgt = { x: 0, z: 0 };

  // Route over the road graph, exactly as the police do. An engine that could
  // drive through buildings would arrive first every time and be worth
  // nothing to watch.
  Fires.prototype.driveEngine = function (e, dt, target) {
    var v = e.v, input = v._in;
    e.reroute -= dt;
    if (e.reroute <= 0 || e.targetNode < 0) {
      e.reroute = 1.1;
      var from = SB.Roads.nearestNode(this.L, v.pos.x, v.pos.z);
      var to = SB.Roads.nearestNode(this.L, target.x, target.z);
      var step = SB.Roads.routeStep(this.L, from.id, to.id);
      e.targetNode = step >= 0 ? step : to.id;
    }
    var n = this.L.nodes[e.targetNode];
    _tgt.x = n.x; _tgt.z = n.z;
    if (M.dist(v.pos.x, v.pos.z, n.x, n.z) < 13) e.reroute = 0;
    // Close in on the last stretch directly, or the engine circles a fire
    // that is thirty metres off the nearest junction.
    var straight = M.dist(v.pos.x, v.pos.z, target.x, target.z);
    if (straight < 42) { _tgt.x = target.x; _tgt.z = target.z; }

    var err = M.angleDelta(v.yaw, Math.atan2(_tgt.z - v.pos.z, _tgt.x - v.pos.x));
    input.steer = M.clamp(err * 1.7, -1, 1);
    input.handbrake = 0;

    var speed = Math.max(0, v.u);
    var want = e.call ? 24 : 15;
    want *= M.lerp(1, 0.45, M.clamp(Math.abs(err) / 0.9, 0, 1));
    if (straight < 60) want = Math.min(want, 8 + straight * 0.22);

    if (this.game.traffic) {
      var gap = this.game.traffic.gapAhead(v, 24);
      if (gap.car && gap.dist < 13) want = Math.min(want, Math.max(2, gap.speed));
    }
    var errV = want - speed;
    if (errV > 0.4) { input.throttle = M.clamp(errV * 0.35, 0, 1); input.brake = 0; }
    else { input.throttle = 0; input.brake = M.clamp(-errV * 0.28, 0, 1); }

    if (speed < 0.7 && want > 3) {
      e.stuck += dt;
      if (e.stuck > 2.6) {
        v.reverse = true; input.throttle = 0.7; input.brake = 0; input.steer = -input.steer;
        if (e.stuck > 4.4) { e.stuck = 0; v.reverse = false; }
        return;
      }
    } else { e.stuck = 0; v.reverse = false; }
  };

  // -------------------------------------------------------- the deck gun --
  // Held, not triggered: the fire engine carries no one-shot ability, so this
  // reads the key directly and sprays for as long as it is down.
  Fires.prototype.stepPlayerHose = function (dt) {
    var g = this.game, p = g.player;
    this.hosing = false;
    if (!p || !p.vehicle || !p.vehicle.spec || p.vehicle.spec.cls !== 'fire') return;
    if (g.paused || g.uiBlocking) return;
    if (!g.input.act('special')) { this.hoseHeat = Math.max(0, this.hoseHeat - dt); return; }

    this.hosing = true;
    this.hoseHeat = Math.min(1, this.hoseHeat + dt * 4);
    var v = p.vehicle;
    // The gun points where the camera points, which is the only aim a player
    // in a cab can reasonably be given.
    var yaw = p.camYaw;
    var dx = Math.cos(yaw), dz = Math.sin(yaw);
    var ox = v.pos.x + dx * 2.4, oz = v.pos.z + dz * 2.4;
    var oy = v.pos.y + v.spec.bodyH + 0.6;
    this.douse(ox, oy, oz, dx, dz, HOSE_RANGE, HOSE_POWER * this.hoseHeat, dt);

    if (g.fx) {
      for (var i = 0; i < 3; i++) {
        var spread = (this.rng() - 0.5) * 0.16;
        var sx = dx * Math.cos(spread) - dz * Math.sin(spread);
        var sz = dx * Math.sin(spread) + dz * Math.cos(spread);
        var sp = 22 + this.rng() * 10;
        g.fx.smoke(ox, oy, oz, sx * sp, 3.2 + this.rng() * 2, sz * sp,
          0.55, 0.62, 0xe8f4ff, 0.4);
      }
    }
  };

  // ------------------------------------------------------------- a shift --
  Fires.prototype.startShift = function () {
    if (this.shift) return;
    this.shift = { calls: 0, started: this.game.time || 0 };
    this.ambient = Math.min(this.ambient, 12);
    this.game.bus.emit('toast', {
      text: 'On shift. Take an engine - hold V for the deck gun.', color: '#ffb066' });
  };

  Fires.prototype.endShift = function (why) {
    if (!this.shift) return;
    var calls = this.shift.calls;
    this.shift = null;
    this.game.bus.emit('toast', {
      text: (why || 'Shift over.') + '  ' + calls + (calls === 1 ? ' call' : ' calls'),
      color: '#ffb066' });
  };

  Fires.prototype.stepShift = function (dt) {
    if (!this.shift) return;
    // Wrecking the engine ends the shift, which is the only real penalty the
    // job has and the reason to drive one carefully.
    var p = this.game.player;
    if (p && p.vehicle && p.vehicle.spec.cls === 'fire' && p.vehicle.destroyed) {
      this.endShift('You wrote off the engine.');
    }
  };

  Fires.prototype.dispatchToast = function (f) {
    var name = f.kind === 'vehicle' ? 'Vehicle fire' : 'Structure fire';
    this.game.bus.emit('toast', { text: 'Dispatch: ' + name, color: '#ff8a4a' });
  };

  // Places for the HUD: the station always, plus every fire currently burning
  // so you can see where the city is alight without being told.
  Fires.prototype.places = function () {
    var out = this.landmarks.slice();
    for (var i = 0; i < this.list.length; i++) {
      var f = this.list[i];
      out.push({ id: 'fire-' + i, name: f.kind === 'vehicle' ? 'Vehicle fire' : 'Fire',
        x: f.x, z: f.z, color: 0xff5a2a, icon: '▲', kind: 'fire', priority: 1 });
    }
    return out;
  };

  // ------------------------------------------------------------- visuals --
  Fires.prototype.render = function (dt) {
    var cam = this.game.camera;
    var camYaw = Math.atan2(
      cam.matrixWorld.elements[8], cam.matrixWorld.elements[10]);
    var n = 0;
    var t = (this.game.time || 0);
    var lightPick = [];

    for (var i = 0; i < this.list.length && n < MAX_FIRES * PER_FIRE; i++) {
      var f = this.list[i];
      var count = Math.max(2, Math.round(PER_FIRE * f.intensity));
      var height = f.r * (0.7 + f.intensity * 0.85);
      for (var k = 0; k < count; k++) {
        // Each tongue rides its own phase up the column, shrinking and
        // reddening as it goes, which is what makes a static instance set
        // read as something moving.
        var ph = ((t * (0.9 + (k % 3) * 0.22) + k * 0.37) % 1);
        var a = (k / count) * Math.PI * 2 + f.age * 0.6;
        var sway = Math.sin(t * 2.1 + k) * 0.35 * f.r * 0.3;
        var rr = f.r * 0.5 * (1 - ph * 0.55);
        this._pos.set(
          f.x + Math.cos(a) * rr + sway,
          f.y + 0.5 + ph * height,
          f.z + Math.sin(a) * rr);
        var size = f.r * (0.46 - ph * 0.17) * (0.55 + f.intensity * 0.75);
        this._e.set(0, camYaw, 0);
        this._q.setFromEuler(this._e);
        this._sc.set(size, size * 1.35, size);
        this._m.compose(this._pos, this._q, this._sc);
        this.flames.setMatrixAt(n, this._m);
        // white-hot at the base, deep orange at the top
        // Deep orange, not white: an additive quad whose green and blue are
        // anywhere near its red goes white the moment two of them overlap.
        // The whole colour fades out toward the tip as well, so the top of
        // the column dissolves into the smoke instead of ending in a row of
        // hard orange discs hanging over the rooftops.
        var fade = 1 - ph * 0.72;
        this._c.setRGB(
          fade,
          M.lerp(0.46, 0.13, ph) * fade,
          M.lerp(0.10, 0.01, ph) * fade);
        this.flames.setColorAt(n, this._c);
        n++;
      }
      // Smoke off the top: the part of a fire you can see from the other side
      // of the city, and in daylight the only part. Rate-limited on a timer
      // rather than rolled per frame, so it does not thin out on a fast
      // machine and choke the particle pool on a slow one.
      f.smokeT = (f.smokeT || 0) - dt;
      if (this.game.fx && f.smokeT <= 0) {
        f.smokeT = 0.09 / Math.max(0.2, f.intensity);
        this.game.fx.smoke(
          f.x + (this.rng() - 0.5) * f.r * 0.7, f.y + height * 0.85,
          f.z + (this.rng() - 0.5) * f.r * 0.7,
          (this.rng() - 0.5) * 2.0, 5.5 + f.intensity * 5, (this.rng() - 0.5) * 2.0,
          f.r * (1.1 + this.rng() * 0.8), 3.4 + this.rng() * 2.4,
          f.kind === 'building' ? 0x1b1916 : 0x2a2723, 0.78);
        // embers, which is what tells you a fire is alive rather than a decal
        if (this.game.fx.spark && this.rng() < 0.5 * f.intensity) {
          this.game.fx.spark(
            f.x + (this.rng() - 0.5) * f.r, f.y + f.r * 0.5, f.z + (this.rng() - 0.5) * f.r,
            (this.rng() - 0.5) * 4, 7 + this.rng() * 6, (this.rng() - 0.5) * 4, 0xffa348);
        }
      }
      lightPick.push(f);
    }
    this.flames.count = n;
    this.flames.instanceMatrix.needsUpdate = true;
    if (this.flames.instanceColor) this.flames.instanceColor.needsUpdate = true;
    // Additive light is how fire looks after dark and how a lens flare looks
    // at noon. Backing the contribution off in daylight is what keeps a
    // burning building orange at midday instead of a white smear; the point
    // light and the bloom carry it at night, where it is turned back up.
    var night = this.game.sky ? M.clamp(this.game.sky.night, 0, 1) : 1;
    this.flames.material.opacity = 0.34 + 0.66 * night;

    // Two lights, to the two nearest fires.
    var cx = cam.position.x, cz = cam.position.z;
    lightPick.sort(function (a, b) {
      return M.dist2(a.x, a.z, cx, cz) - M.dist2(b.x, b.z, cx, cz);
    });
    for (var li = 0; li < this.lights.length; li++) {
      var lf = lightPick[li];
      var lamp = this.lights[li];
      if (!lf || M.dist2(lf.x, lf.z, cx, cz) > 200 * 200) { lamp.visible = false; continue; }
      lamp.visible = true;
      lamp.position.set(lf.x, lf.y + lf.r * 0.7, lf.z);
      lamp.intensity = 3.5 * lf.intensity * (0.85 + Math.sin(t * 11 + li) * 0.15);
      lamp.distance = 26 + lf.r * 4;
    }

    // Engine beacons.
    for (var ei = 0; ei < this.engines.length; ei++) {
      var e = this.engines[ei];
      if (!e.v._beacons) continue;
      var on = (e.state === 'enroute' || e.state === 'onscene' ||
        (e.state === 'player' && this.game.player.vehicle === e.v));
      for (var bi = 0; bi < e.v._beacons.length; bi++) {
        e.v._beacons[bi].material.emissiveIntensity =
          on && (Math.sin(t * 9 + bi * Math.PI) > 0) ? 3.2 : 0;
      }
    }

    if (this.lampMat && this.game.sky) {
      this.lampMat.emissiveIntensity = 0.5 + this.game.sky.night * 1.8;
    }
  };

  Fires.prototype.serialize = function () {
    return { started: this.stats.started, doused: this.stats.doused,
      byPlayer: this.stats.byPlayer };
  };

  Fires.prototype.restore = function (d) {
    if (!d) return;
    this.stats.started = d.started | 0;
    this.stats.doused = d.doused | 0;
    this.stats.byPlayer = d.byPlayer | 0;
  };

  Fires.MAX_FIRES = MAX_FIRES;
  Fires.HOSE_RANGE = HOSE_RANGE;
  SB.Fires = Fires;

})(window.SB = window.SB || {});
