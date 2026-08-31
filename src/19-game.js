// 19-game.js - bootstrap: renderer, scene, world assembly and the main loop.
(function (SB) {
  'use strict';

  var M = SB.M;

  function Game(container) {
    this.container = container;
    this.bus = new SB.Bus();
    this.dev = location.hash.indexOf('dev') >= 0;
    this.paused = false;
    this.time = 0;
    this.cullDistance = 1e9;
    this._postCtx = { night: 0, wet: 0, sunDir: null, sunColor: null, dt: 0.016 };
    // Decide the budget before anything is built with it.
    this.quality = SB.Q ? SB.Q.init() : null;
    this.isTouch = !!(this.quality && this.quality.touch);
  }

  // Staged so the loading bar can breathe between chunks of work.
  Game.prototype.steps = function () {
    var self = this;
    return [
      { label: 'Painting the city', fn: function () { self.stepRenderer(); } },
      { label: 'Laying out streets', fn: function () { self.stepLayout(); } },
      { label: 'Shaping the land', fn: function () { self.stepTerrain(); } },
      { label: 'Threading the freeway', fn: function () { self.stepFreeway(); } },
      { label: 'Raising buildings', fn: function () { self.stepCity(); } },
      { label: 'Planting palms', fn: function () { self.stepProps(); } },
      { label: 'Laying track', fn: function () { self.stepRail(); } },
      { label: 'Opening the roofs', fn: function () { self.stepRooftops(); } },
      { label: 'Furnishing interiors', fn: function () { self.stepInteriors(); } },
      { label: 'Waking the population', fn: function () { self.stepSystems(); } },
      { label: 'Warming up', fn: function () { self.stepFinish(); } }
    ];
  };

  Game.prototype.stepRenderer = function () {
    var self = this;
    var c = this.container;

    // ---------------------------------------------------------- renderer --
    var Q = SB.Q;
    var renderer = this.renderer = new THREE.WebGLRenderer({
      antialias: Q.settings.antialias,
      powerPreference: 'high-performance',
      stencil: false,
      // A phone browser will happily hand back a context it cannot feed.
      failIfMajorPerformanceCaveat: false
    });
    renderer.setPixelRatio(Q.pixelRatio());
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = Q.settings.shadows;
    renderer.shadowMap.type = Q.settings.shadowSize >= 1536
      ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Tone mapping is done by the post composite so the bloom threshold can
    // work on real HDR values; if post fails to build we turn it back on.
    renderer.toneMapping = THREE.NoToneMapping;
    c.appendChild(renderer.domElement);
    renderer.domElement.id = 'view';

    var scene = this.scene = new THREE.Scene();
    var camera = this.camera = new THREE.PerspectiveCamera(
      62, window.innerWidth / window.innerHeight, 0.35, Q.settings.far);
    camera.position.set(0, 12, 24);

    window.addEventListener('resize', function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(SB.Q.pixelRatio());
      renderer.setSize(window.innerWidth, window.innerHeight);
      if (self.post) self.post.setSize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
      if (self.hud) self.hud.resize();
      if (self.touch) self.touch.layout();
    });

    // ------------------------------------------------------------ input --
    var input = this.input = new SB.Input(renderer.domElement);
    renderer.domElement.addEventListener('click', function () {
      if (!input.locked && !self.uiBlocking && self.started) input.requestLock();
    });
  };

  Game.prototype.stepLayout = function () {
    this.layout = SB.Roads.build();
    this.world = new SB.World();
    this.world.beachX = this.layout.beachX;
    this.sky = new SB.Sky(this.scene, this.renderer);
    this.sky.world = this.world;
    this.sky.setHour(9.2);
  };

  Game.prototype.stepTerrain = function () {
    this.terrain = SB.buildTerrain(this.scene, this.world, this.layout);
    this.world.terrainMaterials = this.terrain.materials;
  };

  Game.prototype.stepFreeway = function () {
    if (SB.Freeway) this.freeway = new SB.Freeway(this);
  };

  Game.prototype.stepCity = function () {
    this.city = SB.buildCity(this.scene, this.world, this.layout);
    this.wetMats = [this.city.materials.asphalt, this.city.materials.concrete];
    // Where you wake up after a hospital trip or a night in the cells. Both
    // sit on pavement rather than in the middle of a junction.
    this.hospital = { x: -88, z: -80 };
    this.policeStation = { x: 78, z: -162 };
  };

  Game.prototype.stepProps = function () {
    if (SB.buildProps) this.props = SB.buildProps(this.scene, this.world, this.layout, this.city);
  };

  Game.prototype.stepRooftops = function () {
    if (SB.Rooftops) this.rooftops = new SB.Rooftops(this);
  };

  Game.prototype.stepRail = function () {
    if (SB.Rail) this.rail = new SB.Rail(this);
  };

  Game.prototype.stepInteriors = function () {
    if (SB.Interiors) this.interiors = new SB.Interiors(this);
  };

  Game.prototype.stepSystems = function () {
    if (SB.Audio) this.audio = new SB.Audio();
    if (SB.Lights) this.lights = new SB.Lights(this);
    if (SB.Fx) this.fx = new SB.Fx(this);
    if (SB.Weather) this.weather = new SB.Weather(this);
    if (this.weather && this.dev) {
      var requestedWeather = location.hash.match(/weather=(sun|rain|snow|night)/);
      if (requestedWeather) this.weather.setMode(requestedWeather[1], true);
    }
    if (SB.Traffic) this.traffic = new SB.Traffic(this);
    if (SB.Boats) this.boats = new SB.Boats(this);
    if (SB.Aircraft) this.aircraft = new SB.Aircraft(this);
    if (SB.Transport) this.transport = new SB.Transport(this);
    if (SB.Peds) this.peds = new SB.Peds(this);
    if (SB.Combat) this.combat = new SB.Combat(this);
    if (SB.Police) this.police = new SB.Police(this);
    if (SB.Player) this.player = new SB.Player(this);
    if (SB.Missions) this.missions = new SB.Missions(this);
    if (SB.HUD) this.hud = new SB.HUD(this);
    if (this.player) this.player.spawn();
  };

  Game.prototype.stepFinish = function () {
    var self = this;
    if (SB.Post) {
      try {
        this.post = new SB.Post(this.renderer, this.scene, this.camera);
      } catch (err) {
        console.warn('[post] unavailable, falling back to direct render', err);
        this.post = null;
      }
    }
    if (!this.post) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.22;
    }
    this.loop = new SB.Loop(1 / 60,
      function (dt, t) { self.fixed(dt, t); },
      function (dt, alpha) { self.render(dt, alpha); });
    if (SB.Touch && SB.Q.touch) this.touch = new SB.Touch(this);
    SB.Q.apply(this);
    if (this.dev) this.runSelfTest();
    // Render one frame now so the city is already there behind the title card.
    this.render(1 / 60, 0);
  };

  Game.prototype.setPaused = function (on) {
    this.paused = !!on;
    var el = document.getElementById('paused');
    if (el) el.classList.toggle('on', this.paused);
    if (this.audio) this.audio.setMuffled(this.paused);
    if (this.paused && this.touch) this.touch.releaseAll();
  };

  Game.prototype.togglePause = function () { this.setPaused(!this.paused); };

  Game.prototype.start = function () {
    this.started = true;
    this.loop.start();
    this.input.requestLock();
  };

  Game.prototype.fixed = function (dt, t) {
    if (this.paused) return;
    this.time = t;
    this.world.time = t;
    SB.Roads.updateLights(this.layout, t);
    if (this.weather && this.input.actHit('weather')) this.weather.cycle();
    if (this.weather) this.weather.fixed(dt);
    if (this.interiors) this.interiors.fixed(dt);
    if (this.player) this.player.fixed(dt);
    if (this.traffic) this.traffic.fixed(dt);
    if (this.boats) this.boats.fixed(dt);
    if (this.aircraft) this.aircraft.fixed(dt);
    if (this.rail) this.rail.step(dt);
    if (this.rooftops) this.rooftops.fixed(dt);
    if (this.peds) this.peds.fixed(dt);
    if (this.police) this.police.fixed(dt);
    if (this.combat) this.combat.fixed(dt);
    if (this.missions) this.missions.fixed(dt);
  };

  Game.prototype.render = function (dt, alpha) {
    SB._game = this;
    var cam = this.camera;
    if (this.player) this.player.render(dt, cam);
    this.sky.update(dt, cam, this.wetMats);
    this.world.wetness = this.sky.wetness;
    if (this.weather) this.weather.render(dt);
    var lamps = this.sky.lampFactor();
    if (this.props) this.props.update(dt, lamps, cam);
    if (this.lights) this.lights.update(dt, lamps);
    if (this.traffic) this.traffic.render(dt, lamps);
    if (this.boats) this.boats.render(dt, lamps);
    if (this.aircraft) this.aircraft.render(dt, lamps);
    if (this.transport) this.transport.render(dt, lamps);
    if (this.rooftops) this.rooftops.render(dt, lamps);
    if (this.peds) this.peds.render(dt);
    if (this.police) this.police.render(dt, lamps);
    if (this.combat) this.combat.render(dt);
    if (this.interiors) this.interiors.render(dt);
    if (this.missions) this.missions.render(dt);
    if (this.fx) this.fx.render(dt);
    if (this.audio) this.audio.render(dt, this);

    // city windows light up after dark
    for (var i = 0; i < this.city.emissiveTargets.length; i++) {
      var m = this.city.emissiveTargets[i];
      m.emissiveIntensity = m.userData.shop ? (0.20 + lamps * 0.75) : lamps * 0.90;
    }

    this.cullCity(cam);
    SB.Q.autoTune(this, dt, this.loop ? this.loop.fps : 60);
    if (this.touch) this.touch.render(dt);

    if (this.post && this.post.enabled) {
      // Keep the image stable at every speed. A speed-driven channel offset
      // is a poor fit for an aircraft sim: a bad velocity or a large delta can
      // turn a subtle effect into a full purple wash. The composite remains
      // available for bloom/grade, but chromatic aberration is intentionally
      // disabled for every vehicle and camera state.
      this.post.chroma = 0;
      this._postCtx.night = this.sky.night;
      this._postCtx.wet = this.sky.wetness;
      this._postCtx.sunDir = this.sky.uniforms.uSun.value;
      this._postCtx.sunColor = this.sky.uniforms.uSunColor.value;
      this._postCtx.dt = dt;
      this.post.render(this._postCtx);
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, cam);
    }
    if (this.hud) this.hud.draw(dt);
    this.input.endFrame();
  };

  // Hide static world chunks past the fog. Frustum culling already drops what
  // is behind you; this also drops long freeway and rail spans, which is where
  // a phone would otherwise pay for geometry that is too far to see.
  Game.prototype.cullCity = function (cam) {
    if (!this._cullLists) {
      this._cullLists = [];
      var groups = [this.city, this.freeway, this.rail];
      for (var gi = 0; gi < groups.length; gi++) {
        if (groups[gi] && groups[gi].cullables) this._cullLists.push(groups[gi].cullables);
      }
    }
    if (!this._cullLists.length) return;
    var d = this.cullDistance;
    if (d > 1e8) {
      if (this._wasCulling) {
        for (var li = 0; li < this._cullLists.length; li++) {
          var restore = this._cullLists[li];
          for (var j = 0; j < restore.length; j++) restore[j].mesh.visible = true;
        }
        this._wasCulling = false;
      }
      return;
    }
    this._wasCulling = true;
    var cx = cam.position.x, cz = cam.position.z;
    for (li = 0; li < this._cullLists.length; li++) {
      var list = this._cullLists[li];
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        c.mesh.visible = M.dist2(c.x, c.z, cx, cz) < (d + c.r) * (d + c.r);
      }
    }
  };

  // A headless-ish smoke test: step every system a few hundred times and make
  // sure nothing throws or goes non-finite. Runs on #dev before the loop.
  Game.prototype.runSelfTest = function () {
    var issues = [];
    var t0 = performance.now();
    function checkCraftHeading(craft, label) {
      // Boats, helicopters, and planes are all authored nose-first along
      // local +X. Compare the rendered nose against the physics forward
      // vector at a non-zero yaw so a 90-degree visual/physics mismatch is
      // caught even if the craft remains numerically stable.
      craft.yaw = 0.63;
      craft.pitch = 0;
      craft.roll = 0;
      craft.syncMesh();
      var visual = new THREE.Vector3(1, 0, 0).applyQuaternion(craft.group.quaternion).normalize();
      var physics = craft.forward(new THREE.Vector3()).normalize();
      if (visual.dot(physics) < 0.995) issues.push(label + ' visual/physics heading mismatch');
    }
    try {
      for (var i = 0; i < 600; i++) {
        this.fixed(1 / 60, i / 60);
        if (this.player && this.player.vehicle) {
          var v = this.player.vehicle;
          if (!isFinite(v.pos.x) || !isFinite(v.pos.y) || !isFinite(v.pos.z)) {
            issues.push('vehicle position went non-finite at step ' + i); break;
          }
          if (!isFinite(v.u) || !isFinite(v.yawRate)) {
            issues.push('vehicle velocity went non-finite at step ' + i); break;
          }
        }
        if (this.player && !isFinite(this.player.pos.x)) {
          issues.push('player position went non-finite at step ' + i); break;
        }
      }
      if (this.transport) {
        if (!this.boats || this.boats.list.length < 3) issues.push('transport spawned fewer than three boats');
        if (!this.aircraft || this.aircraft.planes.length < 4) issues.push('transport spawned fewer than four plane variants');
        if (!this.aircraft || this.aircraft.helis.length < 2) issues.push('transport spawned fewer than two helicopters');
        if (this.transport.landmarks.length < 6) issues.push('transport landmarks are incomplete');
      }
      var boundaryCount = 0;
      for (var bi0 = 0; bi0 < this.world.boxes.length; bi0++) {
        if (this.world.boxes[bi0].kind === 'boundary') boundaryCount++;
      }
      if (boundaryCount !== 4) issues.push('map boundary board is incomplete (' + boundaryCount + '/4)');
      if (this.interiors) {
        var names = Object.create(null);
        var multiLevel = 0, banks = 0, hotspotTotal = 0, generatedRooms = 0;
        var generatedArchetypes = Object.create(null);
        for (var ri = 0; ri < this.interiors.rooms.length; ri++) names[this.interiors.rooms[ri].name] = 1;
        for (ri = 0; ri < this.interiors.rooms.length; ri++) {
          if (this.interiors.rooms[ri].levels > 1) multiLevel++;
          if (this.interiors.rooms[ri].type.id === 'bank') banks++;
          if (this.interiors.rooms[ri].type.id === 'generated') {
            generatedRooms++;
            generatedArchetypes[this.interiors.rooms[ri].type.archetype] = 1;
          }
          hotspotTotal += (this.interiors.rooms[ri].hotspots || []).length;
          if ((this.interiors.rooms[ri].hotspots || []).length < 2) {
            issues.push('interior detail coverage is too low for ' + this.interiors.rooms[ri].name);
          }
        }
        if (this.interiors.rooms.length !== this.city.buildings.length) issues.push('every building must have a unique interior (' + this.interiors.rooms.length + '/' + this.city.buildings.length + ')');
        if (generatedRooms !== this.city.buildings.length - 61) issues.push('generated interior coverage is incomplete (' + generatedRooms + ')');
        if (Object.keys(generatedArchetypes).length < 10) issues.push('generated interior variety is too low (' + Object.keys(generatedArchetypes).length + ' archetypes)');
        if (multiLevel < 25) issues.push('multi-level interior coverage is too low (' + multiLevel + ')');
        if (banks !== 4) issues.push('expected four bank interiors, got ' + banks);
        if (hotspotTotal < this.interiors.rooms.length * 2) issues.push('interior hotspot coverage is too low (' + hotspotTotal + ')');
        if (this.interiors.doors.length !== this.city.buildings.length) {
          issues.push('not every city building has an interior door (' + this.interiors.doors.length + '/' + this.city.buildings.length + ')');
        }
        if (Object.keys(names).length !== this.interiors.rooms.length) issues.push('interior names are not unique');

        // Exercise the robbery contract with a disposable game shell so the
        // dev smoke test proves payout + alarm behavior without changing the
        // live player's wallet or wanted state.
        if (SB.Interiors) {
          var robberyProbe = { robbed: false, loot: 1234, vault: null };
          var probeGame = {
            player: { money: 100 },
            bus: { emit: function () {} },
            audio: null,
            police: {
              heat: 0, stars: 0,
              addHeat: function (amount) {
                this.heat += amount;
                this.stars = Math.floor(this.heat);
              }
            }
          };
          SB.Interiors.prototype.robBank.call({ game: probeGame }, robberyProbe);
          if (!robberyProbe.robbed || probeGame.player.money !== 1334 || probeGame.police.heat < 4.2) {
            issues.push('bank robbery payout/alarm probe failed');
          }
        }
      }

      // Water regression: open sea must classify as swimmable while the
      // beach-side landing remains dry, and the rendered surface must be
      // tessellated enough to carry the authored wave profile.
      if (!this.world.isWater(this.layout.beachX - 70, 0, -4, 0)) {
        issues.push('open-water swim volume probe failed');
      }
      if (this.world.isWater(this.layout.beachX + 2, 0, 0, 0)) {
        issues.push('shore landing incorrectly classified as water');
      }
      if (!this.sky.water.geometry.attributes.position.count || this.sky.water.geometry.attributes.position.count < 500) {
        issues.push('water surface mesh is not tessellated');
      }

      // Marina regression: the ramp must have upward-facing render normals,
      // and every spawned craft must be in open water with enough clearance
      // from its finger pier to be both enterable and immediately driveable.
      if (this.transport && this.transport.marina && this.transport.spawned.boats) {
        var marinaRoot = this.transport.root.getObjectByName('bayside-marina');
        var rampSeen = false, rampMinNy = 1;
        if (marinaRoot) marinaRoot.traverse(function (node) {
          var attr = node.geometry && node.geometry.attributes && node.geometry.attributes.position;
          var normals = node.geometry && node.geometry.attributes && node.geometry.attributes.normal;
          if (!node.isMesh || !attr || !normals || attr.count !== 8) return;
          rampSeen = true;
          for (var ri = 0; ri < normals.count; ri++) rampMinNy = Math.min(rampMinNy, normals.getY(ri));
        });
        if (!rampSeen || rampMinNy < 0.75) issues.push('marina ramp render-face probe failed (' + rampSeen + ', min ny ' + rampMinNy.toFixed(2) + ')');

        var fingerZ = [-276, -240, -204, -168, -132, -96, -60];
        for (var mbi = 0; mbi < fingerZ.length; mbi++) {
          var berth = this.transport.spawned.boats[mbi];
          if (!berth) { issues.push('marina boat spawn missing'); break; }
          var pierEdgeGap = Math.abs(berth.pos.z - fingerZ[mbi]) - 3.4;
          // Berths intentionally sit just outside the pier edge. A wide
          // surface query can see the dock beside the hull and misclassify a
          // valid boarding position as wood, so probe the hull centre only.
          var waterSurface = this.world.surfaceAt(berth.pos.x, berth.pos.z, 0, 0.2);
          if (waterSurface.kind === 'wood' || waterSurface.y > -1) issues.push(berth.key + ' spawned on dock');
          if (pierEdgeGap > 3.6 || pierEdgeGap <= berth.collisionRadius) {
            issues.push(berth.key + ' berth entry/clearance probe failed');
          }
          if (SB.Boat) {
            var berthProbe = new SB.Boat(berth.key, this.world, { color: 0xffffff });
            berthProbe.placeAt(berth.pos.x, berth.pos.z, berth.yaw);
            var berthX0 = berthProbe.pos.x, berthZ0 = berthProbe.pos.z;
            for (var bpi = 0; bpi < 120; bpi++) {
              berthProbe.step(1 / 60, { throttle: 1, brake: 0, steer: 0, handbrake: 0 });
            }
            if (!isFinite(berthProbe.pos.x) || !isFinite(berthProbe.pos.z) ||
                Math.hypot(berthProbe.pos.x - berthX0, berthProbe.pos.z - berthZ0) < 2) {
              issues.push(berth.key + ' spawned-berth drive probe failed');
            }
          }
        }
        if (SB.Player && this.transport.spawned.boats[2]) {
          var boardingProbe = Object.create(SB.Player.prototype);
          boardingProbe.mode = 'foot';
          boardingProbe.enterTarget = null;
          boardingProbe.enterTimer = 0;
          boardingProbe.enterMode = null;
          boardingProbe.game = { traffic: null, audio: null, bus: { emit: function () {} } };
          boardingProbe.char = { state: 'idle', root: { visible: true } };
          var boardingBoat = this.transport.spawned.boats[2];
          boardingProbe.beginEnter(boardingBoat);
          boardingProbe.enterTimer = 0;
          boardingProbe.finishEnterExit();
          if (boardingProbe.mode !== 'boat' || boardingProbe.vehicle !== boardingBoat ||
              boardingBoat.driver !== boardingProbe || !boardingBoat.isPlayer) {
            issues.push('boat boarding handoff probe failed');
          }
          boardingBoat.driver = null;
          boardingBoat.isPlayer = false;
        }
        var dinghy = null;
        for (var dbi = 0; dbi < this.transport.spawned.boats.length; dbi++) {
          if (this.transport.spawned.boats[dbi] && this.transport.spawned.boats[dbi].key === 'dinghy') {
            dinghy = this.transport.spawned.boats[dbi]; break;
          }
        }
        var floatZ = this.transport.publicPier && this.transport.publicPier.boat
          ? this.transport.publicPier.boat.z : 51.2;
        if (!dinghy || Math.abs(dinghy.pos.z - floatZ) > 3.6) issues.push('dinghy boarding float probe failed (' + (dinghy ? dinghy.pos.z.toFixed(2) : 'missing') + ')');
      }
      if (SB.Character) {
        // Exercise the swim-only pose so a missing rig reference cannot ship
        // unnoticed when the player first enters the water.
        var swimProbe = new SB.Character({ scale: 1, rng: function () { return 0.5; } });
        swimProbe.state = 'swim';
        swimProbe.animate(1 / 60, 1, {});
        if (!swimProbe.head || !swimProbe.head.rotation) issues.push('swim character pose probe failed');
        swimProbe.dispose();
      }

      if (SB.Vehicle) {
        var testCar = new SB.Vehicle('sports', this.world, { color: 0xffffff, noBeam: true });
        testCar.placeAt(0, 0, 0);
        for (var ci = 0; ci < 1800; ci++) {
          // Deliberately abusive steering/handbrake input: this is the
          // regression case that used to spin and accelerate without bound.
          testCar.step(1 / 60, { throttle: 1, brake: 0, steer: 1, handbrake: 1 });
          if (!isFinite(testCar.u) || !isFinite(testCar.v) || !isFinite(testCar.yawRate)) break;
        }
        var carLimit = testCar.spec.topHint * 1.08 + 0.05;
        if (!isFinite(testCar.u) || !isFinite(testCar.v) || testCar.speed() > carLimit || Math.abs(testCar.yawRate) > 3.81) {
          issues.push('vehicle spin/speed limit probe failed');
        }

        // High-speed steering regression: a clean flat world isolates the
        // tire model from traffic/building collisions. A deliberate full-lock
        // turn may slide, but it must settle instead of entering a repeated
        // spin loop.
        var fastCarWorld = new SB.World();
        var fastCar = new SB.Vehicle('sports', fastCarWorld, { color: 0xffffff, noBeam: true });
        fastCar.placeAt(0, 0, 0);
        fastCar.u = 52;
        var spinEpisodes = 0, wasSpinning = false, maxFastYaw = 0;
        for (var fci = 0; fci < 900; fci++) {
          fastCar.step(1 / 60, { throttle: 1, brake: 0, steer: 1, handbrake: 0 });
          var fastSpeed = Math.abs(fastCar.u);
          var spinning = fastSpeed > 18 &&
            Math.abs(fastCar.v) > fastSpeed * 0.70 && Math.abs(fastCar.yawRate) > 1.4;
          if (spinning && !wasSpinning) spinEpisodes++;
          wasSpinning = spinning;
          if (fastSpeed > 38) maxFastYaw = Math.max(maxFastYaw, Math.abs(fastCar.yawRate));
          if (!isFinite(fastCar.u) || !isFinite(fastCar.v) || !isFinite(fastCar.yawRate)) break;
        }
        if (!isFinite(fastCar.u) || !isFinite(fastCar.v) || !isFinite(fastCar.yawRate) ||
            spinEpisodes > 2 || maxFastYaw > 1.46) {
          issues.push('high-speed car spin recovery probe failed (' + spinEpisodes + ' episodes, yaw ' + maxFastYaw.toFixed(2) + ')');
        }

        var carKeys = Object.keys(SB.VehicleSpecs);
        for (var cki = 0; cki < carKeys.length; cki++) {
          var variantCar = new SB.Vehicle(carKeys[cki], new SB.World(), { color: 0xffffff, noBeam: true });
          variantCar.placeAt(0, 0, 0);
          if (!variantCar.group || !variantCar.body || !variantCar.wheelMeshes || variantCar.wheelMeshes.length !== 4) {
            issues.push('car variant mesh probe failed: ' + carKeys[cki]);
          }
          if (variantCar.spec.ability) {
            variantCar.activateAbility();
            if (variantCar.abilityT <= 0) issues.push('car ability probe failed: ' + carKeys[cki]);
          }
        }
      }

      // Exercise every new physics model independently. These craft never
      // enter the scene or a manager; they are disposable probes that prove
      // throttle, takeoff, climb, and finite-state behavior on every dev boot.
      if (SB.Boat) {
        var boatKeys = ['jetski', 'speedboat', 'yacht', 'fishingboat', 'sailboat', 'dinghy', 'catamaran', 'patrol'];
        for (var bki = 0; bki < boatKeys.length; bki++) {
          var testBoat = new SB.Boat(boatKeys[bki], this.world, { color: 0xffffff });
          testBoat.placeAt(this.layout.beachX - 190, bki * 5, Math.PI);
          var boatX0 = testBoat.pos.x;
          for (var bi = 0; bi < 240; bi++) testBoat.step(1 / 60, { throttle: 1, brake: 0, steer: bi > 120 ? 0.25 : 0, handbrake: 0 });
          if (!isFinite(testBoat.pos.x) || Math.abs(testBoat.pos.x - boatX0) < 5 || testBoat.speed() < 2) {
            issues.push(boatKeys[bki] + ' boat drive probe failed');
          }
        }
        var boatHeadingProbe = new SB.Boat('speedboat', this.world, { color: 0xffffff });
        checkCraftHeading(boatHeadingProbe, 'boat');
        var yachtProbe = new SB.Boat('yacht', this.world, { color: 0xffffff });
        if (!yachtProbe.hasInterior || !yachtProbe.interiorGroup || yachtProbe.interiorGroup.visible) {
          issues.push('yacht interior probe failed');
        }
        yachtProbe.showInterior(true);
        if (yachtProbe.group.visible || !yachtProbe.interiorGroup.visible) issues.push('yacht interior visibility probe failed');
        yachtProbe.showInterior(false);
      }
      if (SB.Plane && this.transport) {
        var planeHeadingProbe = new SB.Plane('skyhawk', this.world, { color: 0xffffff });
        checkCraftHeading(planeHeadingProbe, 'plane');
        var testPlane = new SB.Plane('skyhawk', this.world, { color: 0xffffff });
        testPlane.placeAt(-300, this.transport.airport.runway.z, 0);
        var tookOff = false;
        for (var pi = 0; pi < 540; pi++) {
          testPlane.step(1 / 60, {
            flight: true,
            pitch: pi > 170 && pi < 310 ? -1 : 0,
            roll: 0,
            boost: true,
            airbrake: false
          });
          if (!testPlane.grounded && testPlane.altitude > 4) tookOff = true;
        }
        if (!isFinite(testPlane.pos.y) || !tookOff || testPlane.speed() < 12) {
          issues.push('plane takeoff probe failed (tookOff=' + tookOff +
            ', grounded=' + testPlane.grounded + ', alt=' + testPlane.altitude.toFixed(2) +
            ', y=' + testPlane.pos.y.toFixed(2) + ', speed=' + testPlane.speed().toFixed(2) + ')');
        }

        // A separate approach probe starts above the runway at a real sink
        // angle and must settle onto the authored touchdown surface while the
        // airbrake reduces rollout speed. This catches the old one-frame snap
        // that looked like a landing but could not be controlled afterward.
        var landingPlane = new SB.Plane('skyhawk', this.world, { color: 0xffffff });
        landingPlane.placeAt(-120, this.transport.airport.runway.z, 0);
        landingPlane.pos.y += 7.0;
        landingPlane.grounded = false;
        landingPlane.pitch = -0.085;
        landingPlane.airspeed = 31;
        for (var li = 0; li < 240 && !landingPlane.grounded; li++) {
          landingPlane.step(1 / 60, { flight: true, pitch: 0, roll: 0, boost: false, airbrake: true });
        }
        if (!landingPlane.grounded || landingPlane.altitude < landingPlane.spec.gearH - 0.05 ||
            !isFinite(landingPlane.airspeed) || landingPlane.health <= 0) {
          issues.push('plane runway landing probe failed (grounded=' + landingPlane.grounded +
            ', alt=' + landingPlane.altitude.toFixed(2) + ', y=' + landingPlane.pos.y.toFixed(2) +
            ', speed=' + landingPlane.airspeed.toFixed(2) + ')');
        }

        // Build and fly every authored plane type so a new silhouette cannot
        // silently ship with a missing mesh, broken engine animation, or bad
        // scale in the flight model.
        var planeKeys = Object.keys(SB.PlaneSpecs);
        for (var vi = 0; vi < planeKeys.length; vi++) {
          var variant = new SB.Plane(planeKeys[vi], this.world, { color: 0xffffff });
          variant.placeAt(-300, this.transport.airport.runway.z, 0);
          for (var vj = 0; vj < 180; vj++) {
            variant.step(1 / 60, { flight: true, pitch: vj > 70 && vj < 130 ? -0.7 : 0, roll: 0, boost: true, airbrake: false });
          }
          if (!isFinite(variant.pos.x) || !isFinite(variant.pos.y) || !isFinite(variant.pos.z) ||
              !isFinite(variant.airspeed) || !variant.mesh.group) {
            issues.push('plane variant probe failed: ' + planeKeys[vi]);
          }
        }

        // Flight is intentionally not constrained by the ground player's
        // playBounds clamp. Start just inside the east edge and prove a plane
        // can cross it without being teleported or stopped.
        var B = this.layout.playBounds || this.layout.bounds;
        var freePlane = new SB.Plane('fighter', this.world, { color: 0xffffff });
        freePlane.placeAt(B.maxX - 4, 0, 0);
        freePlane.pos.y = 50;
        freePlane.grounded = false;
        freePlane.airspeed = 100;
        for (var fi = 0; fi < 120; fi++) {
          freePlane.step(1 / 60, { flight: true, pitch: 0, roll: 0, boost: true, airbrake: false });
        }
        if (!isFinite(freePlane.pos.x) || freePlane.pos.x <= B.maxX) issues.push('aircraft world-edge freedom probe failed');
      }
      if (SB.Helicopter && this.transport) {
        var hp = this.transport.helipads[0];
        var heliHeadingProbe = new SB.Helicopter('chopper', this.world, { color: 0xffffff });
        checkCraftHeading(heliHeadingProbe, 'helicopter');
        var testHeli = new SB.Helicopter('chopper', this.world, { color: 0xffffff });
        testHeli.placeAt(hp.x, hp.z, 0);
        var maxHeliAlt = 0;
        for (var hi = 0; hi < 180; hi++) {
          testHeli.step(1 / 60, {
            flight: true, pitch: hi > 100 ? 0.25 : 0, yaw: 0.1,
            ascend: hi < 130, descend: false
          });
          maxHeliAlt = Math.max(maxHeliAlt, testHeli.altitude || 0);
        }
        if (!isFinite(testHeli.pos.y) || maxHeliAlt < 3) {
          issues.push('helicopter climb probe failed (maxAlt=' + maxHeliAlt.toFixed(2) +
            ', y=' + testHeli.pos.y.toFixed(2) + ', grounded=' + testHeli.grounded + ')');
        }
        var landingHeli = new SB.Helicopter('chopper', this.world, { color: 0xffffff });
        landingHeli.placeAt(hp.x, hp.z, 0);
        landingHeli.pos.y += 5.5;
        landingHeli.grounded = false;
        for (var hli = 0; hli < 300 && !landingHeli.grounded; hli++) {
          landingHeli.step(1 / 60, { flight: true, pitch: 0, yaw: 0, ascend: false, descend: true });
        }
        if (!landingHeli.grounded || landingHeli.altitude < landingHeli.spec.gearH - 0.05 ||
            !isFinite(landingHeli.pos.y) || landingHeli.health <= 0) {
          issues.push('helicopter pad landing probe failed');
        }
      }
    } catch (err) {
      issues.push('threw: ' + (err && err.stack ? err.stack : err));
    }
    var ms = (performance.now() - t0).toFixed(0);
    if (issues.length) {
      console.error('[selftest] FAILED in ' + ms + 'ms\n' + issues.join('\n'));
    } else {
      console.log('[selftest] 600 fixed steps clean in ' + ms + 'ms ' +
        '(' + this.world.boxes.length + ' colliders, ' +
        this.city.buildings.length + ' buildings, ' + this.interiors.doors.length +
        ' building doors, ' + this.interiors.rooms.length + ' unique furnished interiors, ' +
        generatedRooms + ' generated variants, ' + hotspotTotal + ' interior hotspots, ' +
        'multi-level/bank/vehicle/car-stability/boat/plane/heli probes clean)');
    }
    this.selfTestIssues = issues;
  };

  SB.Game = Game;

  SB.boot = function (onProgress, onDone, onError) {
    var el = document.getElementById('app') || document.body;
    var game = window.GAME = new SB.Game(el);
    var steps = game.steps();
    var i = 0;
    function next() {
      if (i >= steps.length) { onDone(game); return; }
      var st = steps[i];
      onProgress(i / steps.length, st.label);
      // setTimeout rather than rAF: a backgrounded tab never fires rAF, and the
      // loader must still complete so the page is ready when you come back.
      setTimeout(function () {
        try {
          st.fn();
        } catch (err) {
          console.error('[boot] ' + st.label + ' failed', err);
          onError(err);
          return;
        }
        i++;
        next();
      }, 0);
    }
    next();
    return game;
  };

})(window.SB = window.SB || {});
