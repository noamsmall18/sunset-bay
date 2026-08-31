// 29-weather.js - the live weather director.
//
// Weather is a gameplay system, not only a post-process: it owns precipitation,
// surface buildup, puddles, snowplows, storm lighting, and the shared condition
// values consumed by the world, player, and vehicle physics.
(function (SB) {
  'use strict';

  var M = SB.M, Roads = SB.Roads;
  var MODES = ['sun', 'rain', 'snow', 'night'];
  var LABELS = { sun: 'SUN', rain: 'RAIN', snow: 'SNOW', night: 'NIGHT' };

  function Weather(game) {
    this.game = game;
    this.scene = game.scene;
    this.world = game.world;
    this.layout = game.layout;
    this.sky = game.sky;
    this.mode = 'sun';
    this.previous = 'sun';
    this.transition = 1;
    this.time = 0;
    this.snowAmount = 0;
    this.wind = { x: 4.5, z: -2.0 };
    this.lightningTimer = 7;
    this.lightning = 0;
    this.rng = M.rng(0x57EA7);
    this.root = new THREE.Group();
    this.root.name = 'live-weather';
    this.scene.add(this.root);

    this.world.weatherState = 'sun';
    this.world.snowAmount = 0;
    this.buildPuddles();
    this.buildSnow();
    this.buildPlows();
    this.precip = makePrecipitation(this.scene);
    this.clouds = makeStormClouds(this.scene);
    this.stormLight = new THREE.PointLight(0x9fc8ff, 0, 180, 2);
    this.scene.add(this.stormLight);
    this.sky.setWeather('sun');
  }

  Weather.prototype.setMode = function (mode, instant) {
    if (MODES.indexOf(mode) < 0) mode = 'sun';
    if (mode === this.mode && !instant) return;
    this.previous = this.mode;
    this.mode = mode;
    this.transition = instant ? 1 : 0;
    this.sky.setWeather(mode);
    this.world.weatherState = mode;
    if (!instant) {
      var text = mode === 'rain' ? 'Rain front moving in — roads are slick' :
        mode === 'snow' ? 'Snow squall — deep drifts are forming' :
          mode === 'night' ? 'Nightfall — city lights coming alive' : 'Sun breaking through';
      this.game.bus.emit('toast', { text: text });
    }
    this.game.bus.emit('weatherChanged', { mode: mode, label: LABELS[mode] });
  };

  Weather.prototype.cycle = function () {
    var i = MODES.indexOf(this.mode);
    this.setMode(MODES[(i + 1) % MODES.length]);
  };

  Weather.prototype.label = function () { return LABELS[this.mode]; };

  Weather.prototype.grip = function () {
    if (this.mode === 'rain') return Math.round((1 - this.sky.wetness * 0.20) * 100);
    if (this.mode === 'snow') return Math.round((1 - this.snowAmount * 0.57) * 100);
    return 100;
  };

  Weather.prototype.fixed = function (dt) {
    this.time += dt;
    this.transition = M.damp(this.transition, 1, 2.6, dt);
    this.snowAmount = M.damp(this.snowAmount, this.mode === 'snow' ? 1 : 0,
      this.mode === 'snow' ? 0.22 : 0.055, dt);
    this.world.weatherState = this.mode;
    this.world.snowAmount = this.snowAmount;
    this.world.wetness = this.sky.wetness;

    // A front builds wind as it arrives, which drives both the snow drift and
    // the precipitation direction. Snow slowly melts instead of vanishing.
    var storm = this.mode === 'rain' ? this.sky.rain : this.snowAmount;
    var windTargetX = this.mode === 'snow' ? 7.5 : 4.5;
    var windTargetZ = this.mode === 'snow' ? -4.0 : -2.0;
    this.wind.x = M.damp(this.wind.x, windTargetX * storm, 0.45, dt);
    this.wind.z = M.damp(this.wind.z, windTargetZ * storm, 0.45, dt);

    if (this.mode === 'rain' && this.sky.rain > 0.48) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 9 + this.rng() * 16;
        this.lightning = 1;
        var px = this.game.player ? this.game.player.pos.x : 0;
        var pz = this.game.player ? this.game.player.pos.z : 0;
        this.stormLight.position.set(px + this.rng.range(-34, 34), 26, pz + this.rng.range(-34, 34));
        this.game.bus.emit('toast', { text: 'Lightning — stay sharp' });
      }
    } else {
      this.lightningTimer = Math.min(this.lightningTimer, 3);
    }
    this.lightning = Math.max(0, this.lightning - dt * 4.8);
  };

  Weather.prototype.render = function (dt) {
    var cam = this.game.camera;
    var rain = this.sky.rain;
    var snow = this.snowAmount;
    var storm = Math.max(rain, snow);
    this.precip.update(dt, cam, rain, snow, this.wind, this.time);

    var puddleAlpha = M.clamp(this.sky.wetness * 0.72, 0, 0.72);
    this.puddleMat.opacity = puddleAlpha;
    this.puddleRoot.visible = puddleAlpha > 0.006;
    for (var i = 0; i < this.puddles.length; i++) {
      var p = this.puddles[i];
      p.mesh.material.opacity = puddleAlpha * p.cover;
      for (var ri = 0; ri < p.rings.length; ri++) {
        var ring = p.rings[ri];
        ring.visible = puddleAlpha > 0.06;
        var pulse = (this.time * (1.5 + ri * 0.23) + p.phase + ri * 1.9) % 1;
        ring.scale.setScalar(0.35 + pulse * 0.75);
        ring.material.opacity = puddleAlpha * (1 - pulse) * 0.55;
      }
    }

    this.snowMat.opacity = M.clamp(snow * 0.95, 0, 0.95);
    this.snowRoot.visible = snow > 0.006;
    for (i = 0; i < this.snowPatches.length; i++) {
      var patch = this.snowPatches[i];
      patch.mesh.scale.set(patch.baseScaleX * (0.72 + snow * 0.28),
        patch.baseScaleZ * (0.72 + snow * 0.28), 1);
      patch.mesh.position.y = patch.y + 0.018 + snow * 0.035;
    }

    this.plowRoot.visible = snow > 0.08;
    for (i = 0; i < this.plows.length; i++) {
      var plow = this.plows[i];
      plow.beacon.material.emissiveIntensity = 1.5 + Math.sin(this.time * 8 + i) * 0.8;
      if (!this.plowRoot.visible) continue;
      plow.t += dt * plow.speed / Math.max(12, plow.edge.len) * plow.dir;
      if (plow.t > 1) { plow.t = 1; plow.dir = -1; }
      if (plow.t < 0) { plow.t = 0; plow.dir = 1; }
      var pos = Roads.lanePoint(this.layout, plow.edge, plow.dir, 0, plow.t, this._lanePoint || (this._lanePoint = {}));
      var travel = Roads.laneDir(this.layout, plow.edge, plow.dir, this._laneDir || (this._laneDir = {}));
      var sy = this.world.surfaceAt(pos.x, pos.z, 12, 20).y;
      plow.group.position.set(pos.x, sy + 0.04, pos.z);
      plow.group.rotation.y = Math.atan2(travel.z, travel.x);
    }

    this.clouds.position.set(cam.position.x + this.wind.x * 0.08, 33, cam.position.z + this.wind.z * 0.08);
    this.clouds.visible = storm > 0.16;
    this.clouds.children[0].rotation.y += dt * 0.008;
    this.clouds.children[1].rotation.y -= dt * 0.006;
    this.stormLight.intensity = this.lightning * 22;
    this.stormLight.position.y = 26 + Math.sin(this.time * 2.5) * 4;
  };

  Weather.prototype.buildPuddles = function () {
    this.puddleRoot = new THREE.Group();
    this.puddleRoot.name = 'rain-puddles';
    this.root.add(this.puddleRoot);
    this.puddleMat = new THREE.MeshStandardMaterial({
      color: 0x173b59, roughness: 0.035, metalness: 0.56,
      transparent: true, opacity: 0, depthWrite: false
    });
    var geo = new THREE.CircleGeometry(1, 22);
    var ringGeo = new THREE.RingGeometry(0.20, 0.27, 18);
    var ringMat = new THREE.MeshBasicMaterial({ color: 0x8dd7e9, transparent: true,
      opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    this.puddles = [];
    for (var i = 0; i < this.layout.edges.length; i += 2) {
      var edge = this.layout.edges[i];
      var point = Roads.lanePoint(this.layout, edge, 1, 0, 0.27 + (i % 5) * 0.11, {});
      var y = this.world.surfaceAt(point.x, point.z, 10, 20).y + 0.019;
      var mesh = new THREE.Mesh(geo, this.puddleMat);
      mesh.rotation.x = -Math.PI / 2;
      var sx = 1.7 + (i % 4) * 0.55, sz = 0.7 + (i % 3) * 0.28;
      mesh.scale.set(sx, sz, 1);
      mesh.position.set(point.x, y, point.z);
      mesh.renderOrder = 0;
      this.puddleRoot.add(mesh);
      var rings = [];
      for (var r = 0; r < 2; r++) {
        var ring = new THREE.Mesh(ringGeo, ringMat.clone());
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(point.x, y + 0.006, point.z);
        ring.visible = false;
        this.puddleRoot.add(ring);
        rings.push(ring);
      }
      this.puddles.push({ mesh: mesh, rings: rings, phase: i * 0.37, cover: 0.58 + (i % 4) * 0.09 });
    }
  };

  Weather.prototype.buildSnow = function () {
    this.snowRoot = new THREE.Group();
    this.snowRoot.name = 'snow-accumulation';
    this.root.add(this.snowRoot);
    this.snowMat = new THREE.MeshStandardMaterial({
      color: 0xf2f7ff, roughness: 0.9, metalness: 0,
      transparent: true, opacity: 0, depthWrite: true
    });
    var geo = new THREE.CircleGeometry(1, 18);
    this.snowPatches = [];
    this.world.snowZones = [];
    for (var i = 0; i < this.layout.blocks.length; i++) {
      var b = this.layout.blocks[i];
      if (b.kind !== 'park' && b.kind !== 'lot' && b.kind !== 'plaza') continue;
      if ((i % 3) === 1 && b.kind !== 'park') continue;
      var rx = Math.min(15, Math.max(4.2, b.w * 0.34));
      var rz = Math.min(15, Math.max(4.2, b.d * 0.34));
      this.addSnowPatch(geo, b.cx + (i % 2 ? 2 : -2), b.cz + (i % 3 - 1) * 2,
        rx, rz, 0.20 + (i % 4) * 0.035);
    }
    // A few wind-packed drifts sit directly on road shoulders, where a car
    // can actually bog down instead of seeing snow only on decorative lots.
    for (i = 1; i < this.layout.edges.length; i += 9) {
      var edge = this.layout.edges[i];
      var point = Roads.lanePoint(this.layout, edge, 1, 0, 0.68, {});
      this.addSnowPatch(geo, point.x, point.z, 3.2, 2.4, 0.17);
    }
  };

  Weather.prototype.addSnowPatch = function (geo, x, z, rx, rz, depth) {
    var y = this.world.surfaceAt(x, z, 10, 20).y;
    var mesh = new THREE.Mesh(geo, this.snowMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.02, z);
    mesh.scale.set(rx, rz, 1);
    mesh.rotation.z = this.rng.range(-Math.PI, Math.PI);
    mesh.renderOrder = 0;
    this.snowRoot.add(mesh);
    this.snowPatches.push({ mesh: mesh, y: y, baseScaleX: rx, baseScaleZ: rz });
    this.world.snowZones.push({ x: x, z: z, rx: rx, rz: rz, depth: depth });
  };

  Weather.prototype.buildPlows = function () {
    this.plowRoot = new THREE.Group();
    this.plowRoot.name = 'snowplow-convoy';
    this.root.add(this.plowRoot);
    this.plows = [];
    var choices = [4, 31, 68];
    for (var i = 0; i < choices.length; i++) {
      var edge = this.layout.edges[choices[i] % this.layout.edges.length];
      var group = makeSnowplow(i);
      this.plowRoot.add(group);
      this.plows.push({ group: group, edge: edge, t: i * 0.29, dir: i % 2 ? -1 : 1,
        speed: 9 + i * 1.6, beacon: group.children[3] });
    }
  };

  function makeSnowplow(index) {
    var g = new THREE.Group();
    var orange = new THREE.MeshStandardMaterial({ color: index % 2 ? 0xe89b35 : 0xd86635,
      roughness: 0.52, metalness: 0.15 });
    var dark = new THREE.MeshStandardMaterial({ color: 0x252a30, roughness: 0.82, metalness: 0.3 });
    var bladeMat = new THREE.MeshStandardMaterial({ color: 0xb8c2ca, roughness: 0.3, metalness: 0.76 });
    var body = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.85, 2.1), orange);
    body.position.y = 0.86;
    g.add(body);
    var cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.1, 1.8), dark);
    cab.position.set(-0.65, 1.72, 0);
    g.add(cab);
    var blade = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.9, 3.45), bladeMat);
    blade.position.set(2.3, 0.48, 0);
    blade.rotation.y = index % 2 ? -0.16 : 0.16;
    g.add(blade);
    var beacon = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 6),
      new THREE.MeshStandardMaterial({ color: 0xffc24b, emissive: 0xff7a13, emissiveIntensity: 1.5 }));
    beacon.position.set(-0.65, 2.38, 0);
    g.add(beacon);
    for (var i = 0; i < 4; i++) {
      var wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.20, 10), dark);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(i < 2 ? -1.35 : 1.25, 0.35, i % 2 ? 0.88 : -0.88);
      g.add(wheel);
    }
    g.scale.setScalar(0.88);
    return g;
  }

  function makeStormClouds(scene) {
    var root = new THREE.Group();
    root.name = 'storm-cloud-deck';
    var mat = new THREE.MeshStandardMaterial({ color: 0x202c3a, roughness: 1,
      transparent: true, opacity: 0.78, depthWrite: false });
    var forms = [
      [0, 0, 1.0, 1.0], [-17, 2, 0.72, 0.84], [18, -3, 0.82, 0.68]
    ];
    for (var i = 0; i < forms.length; i++) {
      var m = new THREE.Mesh(new THREE.SphereGeometry(13, 16, 8), mat);
      m.position.set(forms[i][0], forms[i][1], forms[i][2] * 2);
      m.scale.set(1.9 * forms[i][2], 0.42 * forms[i][3], 0.75);
      root.add(m);
    }
    root.visible = false;
    scene.add(root);
    return root;
  }

  function makePrecipitation(scene) {
    var q = SB.Q.settings;
    var count = q.tier === 'high' ? 2400 : (q.tier === 'medium' ? 1700 : 950);
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(count * 3);
    var speed = new Float32Array(count);
    var phase = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 92;
      pos[i * 3 + 1] = Math.random() * 44;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 92;
      speed[i] = 0.7 + Math.random() * 1.4;
      phase[i] = Math.random() * M.TAU;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({ color: 0xdcecff, size: 0.34,
      transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
    var points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 5;
    scene.add(points);
    return {
      points: points,
      update: function (dt, camera, rain, snow, wind, time) {
        var amount = Math.max(rain, snow);
        points.visible = amount > 0.018;
        mat.opacity = M.clamp(amount * 0.46, 0, 0.58);
        points.position.set(camera.position.x, 0, camera.position.z);
        // Clear weather is the common path. Do not walk an invisible particle
        // buffer every frame when there is no rain or snow to draw.
        if (!points.visible) return;
        mat.color.set(snow > rain ? 0xf4f8ff : 0xa9c9df);
        mat.size = snow > rain ? 0.62 : 0.34;
        var p = geo.attributes.position.array;
        for (var i = 0; i < count; i++) {
          var b = i * 3;
          var fall = (snow > rain ? 2.0 : 31.0) * speed[i];
          p[b] += wind.x * dt + Math.sin(time * 0.8 + phase[i]) * (snow > rain ? 0.09 : 0.015);
          p[b + 1] -= fall * dt;
          p[b + 2] += wind.z * dt + Math.cos(time * 0.7 + phase[i]) * (snow > rain ? 0.08 : 0.01);
          if (p[b + 1] < -7) {
            p[b] = (Math.random() - 0.5) * 92;
            p[b + 1] = 33 + Math.random() * 12;
            p[b + 2] = (Math.random() - 0.5) * 92;
          }
        }
        geo.attributes.position.needsUpdate = true;
      }
    };
  }

  SB.Weather = Weather;
  SB.WeatherModes = MODES;
})(window.SB = window.SB || {});
