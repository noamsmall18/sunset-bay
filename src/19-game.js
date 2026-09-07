// 19-game.js - bootstrap: renderer, scene, world assembly and the main loop.
(function (SB) {
  'use strict';

  var M = SB.M;

  function Game(container) {
    this.container = container;
    this.bus = new SB.Bus();
    this.dev = location.hash.indexOf('dev') >= 0;
    this.paused = false;
    // Whether a full-screen panel owns the input. Initialised here so it is
    // always a boolean: code that saves and restores it should not have to
    // deal with undefined on the first read.
    this.uiBlocking = false;
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
      { label: 'Opening the waterfront', fn: function () { self.stepExpansion(); } },
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
    // Report the complete frame, including post passes, rather than only the
    // final full-screen triangle. Reset once at the start of render().
    renderer.info.autoReset = false;
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
    // The play area has to reach the islands, or the invisible wall stands
    // between the causeway and the key it crosses to.
    var westEdge = Math.min(this.layout.bounds.minX - 220,
      (this.layout.seaMinX === undefined ? this.layout.bounds.minX : this.layout.seaMinX) - 40);
    this.layout.playBounds = { minX: westEdge, maxX: this.layout.bounds.maxX + 60,
      minZ: this.layout.bounds.minZ - 60, maxZ: this.layout.bounds.maxZ + 60 };
    this.world = new SB.World();
    this.world.beachX = this.layout.beachX;
    this.sky = new SB.Sky(this.scene, this.renderer);
    this.sky.world = this.world;
    this.sky.setHour(17.6);
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
    // Attached right after the audio graph exists, so stored volumes are in
    // force before the first sound rather than after it.
    if (SB.Settings) SB.Settings.attach(this);
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
    if (SB.Progress) this.progress = new SB.Progress(this);
    if (SB.Garage) this.garage = new SB.Garage(this);
    if (SB.Rhythm) this.rhythm = new SB.Rhythm(this);
    if (SB.CameraModes) this.cameras = new SB.CameraModes(this);
    if (SB.HUD) this.hud = new SB.HUD(this);
    if (this.player) this.player.spawn();
    if (SB.Save) SB.Save.attach(this);
  };

  Game.prototype.stepExpansion = function () {
    // The islands go up before the waterfront so their helipad is registered
    // by the time anything goes looking for somewhere to land.
    if (SB.Islands && SB.Islands.Works) this.islands = new SB.Islands.Works(this);
    // The fire service needs the city (something to burn) and traffic (an
    // engine pool), so it goes up after both.
    if (SB.Fires) this.fires = new SB.Fires(this);
    if (SB.Coast) this.coast = new SB.Coast(this);
    if (SB.Activities) this.activities = new SB.Activities(this);
    if (SB.CityLife) this.cityLife = new SB.CityLife(this);
    if (SB.Deliveries) this.deliveries = new SB.Deliveries(this);
    if (SB.Pastimes) this.pastimes = new SB.Pastimes(this);
    // The patch calls this one SB.Garage too, and it loads after 35-garage.js,
    // so taking its line verbatim would overwrite the car park garage that
    // Game.fixed, SB.Save and the HUD all reach through `game.garage` - and
    // the replacement has no fixed(), so the first physics step would throw.
    // They are different features, not two versions of one, so the model
    // tuning shop keeps its own name and its own slot.
    if (SB.TuneShop) this.tuneShop = new SB.TuneShop(this);
    if (SB.Neighbors) this.neighbors = new SB.Neighbors(this);
    // Constructed but NOT restored here. Restoring during world build ignored
    // the title card: the player could pick "New game" and still start with
    // the previous run's progress, because this had already put it back.
    // 20-startup.js restores it only when Continue is chosen, so the patch's
    // `this.saveGame.restore()` on this line is deliberately not taken.
    if (SB.SaveGame) this.saveGame = new SB.SaveGame(this);
  };

  Game.prototype.stepFinish = function () {
    var self = this;
    if (SB.Post && SB.Q.settings.post) {
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
      function (dt, t) { return self.fixed(dt, t); },
      function (dt, alpha) { self.render(dt, alpha); });
    if (SB.Touch && SB.Q.touch) this.touch = new SB.Touch(this);
    SB.Q.apply(this);
    if (this.dev) this.runSelfTest();
    // Render one frame now so the city is already there behind the title card.
    this.render(1 / 60, 0);
  };

  Game.prototype.setPaused = function (on) {
    this.paused = !!on;
    if (this.paused && this.input) this.input.endTick();
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
    if (this.paused) { this.input.endTick(); return false; }
    this.time = t;
    this.world.time = t;
    SB.Roads.updateLights(this.layout, t);
    if (this.weather && this.input.actHit('weather')) this.weather.cycle();
    if (this.weather) this.weather.fixed(dt);
    if (this.deliveries) this.deliveries.fixed(dt);
    if (this.cityLife) this.cityLife.fixed(dt);
    if (this.interiors) this.interiors.fixed(dt);
    if (this.paused) { this.input.endTick(); return false; }
    if (this.player) this.player.fixed(dt);
    if (this.traffic) this.traffic.fixed(dt);
    if (this.boats) this.boats.fixed(dt);
    if (this.aircraft) this.aircraft.fixed(dt);
    if (this.rail) this.rail.step(dt);
    if (this.rooftops) this.rooftops.fixed(dt);
    if (this.peds) this.peds.fixed(dt);
    if (this.neighbors) this.neighbors.fixed(dt);
    if (this.police) this.police.fixed(dt);
    if (this.combat) this.combat.fixed(dt);
    if (this.missions) this.missions.fixed(dt);
    if (this.progress) this.progress.fixed(dt);
    if (this.garage) this.garage.fixed(dt);
    if (this.rhythm) this.rhythm.fixed(dt);
    if (this.activities) this.activities.fixed(dt);
    if (this.fires) this.fires.fixed(dt);
    if (this.saveGame) this.saveGame.fixed(dt);
    if (SB.Save && SB.Save.tick) SB.Save.tick(dt);
    this.input.endTick();
  };

  Game.prototype.render = function (dt, alpha) {
    // Dialogs animate in the DOM. Redraw their frozen 3D background at 8 Hz.
    // Use wall time so a paused simulation does not defeat this budget.
    var now = performance.now();
    if (this.paused && this.uiBlocking && this._modalFrameAt && now - this._modalFrameAt < 125) {
      this.input.endFrame(); return;
    }
    this._modalFrameAt = this.paused && this.uiBlocking ? now : 0;
    if (this.paused || !this.started) dt = 0;
    this.renderer.info.reset();
    SB._game = this;
    var cam = this.camera;
    if (this.player) this.player.render(dt, cam);
    // View modes layer on top of the follow rig the player just positioned,
    // so 'follow' costs nothing and everything downstream - the sky, the
    // culling, the post pipeline - sees one camera as it always did.
    if (this.cameras) this.cameras.render(dt, cam);
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
    if (this.neighbors) this.neighbors.render(dt);
    if (this.police) this.police.render(dt, lamps);
    if (this.combat) this.combat.render(dt);
    if (this.interiors) this.interiors.render(dt);
    if (this.missions) this.missions.render(dt);
    if (this.fx) this.fx.render(dt);
    if (this.audio) this.audio.render(dt, this);
    if (this.coast) this.coast.render(dt, lamps);
    if (this.islands) this.islands.render(dt);
    if (this.fires) this.fires.render(dt);
    if (this.activities) this.activities.render(dt);
    if (this.cityLife) this.cityLife.render(dt);
    if (this.deliveries) this.deliveries.render(dt);

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
        // Development-only exhaustive coverage; normal play builds on entry.
        for (var rbuild = 0; rbuild < this.interiors.rooms.length; rbuild++) {
          this.interiors.ensureRoom(this.interiors.rooms[rbuild]);
        }
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
      // ---- routing: the plan must be a real, optimal path ------------------
      // Two properties, both exact rather than heuristic. Every consecutive
      // pair on the path must be joined by an actual edge, and every node on
      // it must satisfy the Bellman condition - no neighbour offers a cheaper
      // way to the target - which is what makes the route genuinely shortest
      // by travel time and not merely connected.
      var Rd = SB.Roads, L = this.layout;
      var brokenLinks = 0, suboptimal = 0, routed = 0;
      for (var rt = 0; rt < 24; rt++) {
        var a0 = L.nodes[(rt * 197) % L.nodes.length];
        var b0 = L.nodes[(rt * 613 + 41) % L.nodes.length];
        var path = Rd.findPath(L, a0.id, b0.id);
        if (!path) continue;
        routed++;
        var field = Rd.routeField(L, b0.id);
        for (var pi2 = 0; pi2 < path.length; pi2++) {
          var na = L.nodes[path[pi2]];
          if (pi2 < path.length - 1) {
            var nb = L.nodes[path[pi2 + 1]];
            var linked = false, best = Infinity;
            for (var ei = 0; ei < na.edges.length; ei++) {
              var ee = L.edges[na.edges[ei]];
              var other = ee.a === na.id ? ee.b : ee.a;
              if (other === nb.id) linked = true;
              var via = field.cost[other] + Rd.edgeCost(ee);
              if (via < best) best = via;
            }
            if (!linked) { brokenLinks++; break; }
            // 1e-6 of slack for float accumulation, nothing more.
            if (field.cost[na.id] > best + 1e-6) { suboptimal++; break; }
          }
        }
      }
      if (routed < 12) issues.push('routing probe only found ' + routed + ' of 24 routes');
      if (brokenLinks) issues.push('routing returned ' + brokenLinks + ' paths with a non-existent hop');
      if (suboptimal) issues.push('routing returned ' + suboptimal + ' paths that are not cost-optimal');

      // ---- road network: one map, drawn once -------------------------------
      // Three properties that used to be false. The graph has to be a single
      // component, or a district is unreachable and anything spawned there is
      // stranded. Ground roads must not be buried under other ground roads -
      // two carriageways occupying the same tarmac is what made the map look
      // smeared, and it was true of 38% of the edges. And the blocks left
      // between the roads have to be real ground rather than slivers: the
      // isoperimetric ratio catches a long thin scrap that no pavement fits on.
      var seenN = new Uint8Array(L.nodes.length);
      var stackN = [0], reachedN = 1;
      seenN[0] = 1;
      while (stackN.length) {
        var curN = stackN.pop();
        var ndN = L.nodes[curN];
        for (var eN = 0; eN < ndN.edges.length; eN++) {
          var edN = L.edges[ndN.edges[eN]];
          var othN = edN.a === curN ? edN.b : edN.a;
          if (!seenN[othN]) { seenN[othN] = 1; reachedN++; stackN.push(othN); }
        }
      }
      if (reachedN !== L.nodes.length) {
        issues.push('road graph is in pieces: ' + reachedN + ' of ' + L.nodes.length + ' nodes reachable');
      }

      var buriedE = 0, groundE = 0, rq = [], rs = 1;
      for (var bi2 = 0; bi2 < L.edges.length; bi2++) {
        var EA = L.edges[bi2];
        if (EA.elevated) continue;
        groundE++;
        var ea0 = L.nodes[EA.a], eb0 = L.nodes[EA.b];
        var nearE = L.edgeGrid.query(
          Math.min(ea0.x, eb0.x) - 30, Math.min(ea0.z, eb0.z) - 30,
          Math.max(ea0.x, eb0.x) + 30, Math.max(ea0.z, eb0.z) + 30, rq, rs++);
        for (var nj = 0; nj < nearE.length; nj++) {
          var EB = nearE[nj];
          if (EB.id === EA.id || EB.elevated) continue;
          if (EA.a === EB.a || EA.a === EB.b || EA.b === EB.a || EA.b === EB.b) continue;
          var ec0 = L.nodes[EB.a], ed0 = L.nodes[EB.b];
          var cosE = Math.abs(Math.cos(
            Math.atan2(eb0.z - ea0.z, eb0.x - ea0.x) -
            Math.atan2(ed0.z - ec0.z, ed0.x - ec0.x)));
          if (cosE < 0.985) continue;
          var emx = (ea0.x + eb0.x) * 0.5, emz = (ea0.z + eb0.z) * 0.5;
          var edx = ed0.x - ec0.x, edz = ed0.z - ec0.z;
          var el2 = edx * edx + edz * edz;
          if (el2 < 1e-6) continue;
          var et = SB.M.clamp(((emx - ec0.x) * edx + (emz - ec0.z) * edz) / el2, 0, 1);
          if (SB.M.dist(ec0.x + edx * et, ec0.z + edz * et, emx, emz) <
              (EA.width + EB.width) * 0.5) { buriedE++; break; }
        }
      }
      if (groundE && buriedE / groundE > 0.20) {
        issues.push('road network: ' + Math.round(100 * buriedE / groundE) +
          '% of ground roads are buried under another road');
      }

      var sliverB = 0;
      for (var sb = 0; sb < L.blocks.length; sb++) {
        var spoly = L.blocks[sb].kerbPoly || L.blocks[sb].poly;
        if (!spoly || spoly.length < 3) continue;
        var s2 = 0, sper = 0;
        for (var sk = 0; sk < spoly.length; sk++) {
          var sp = spoly[sk], sq2 = spoly[(sk + 1) % spoly.length];
          s2 += sp.x * sq2.z - sq2.x * sp.z;
          sper += SB.M.dist(sp.x, sp.z, sq2.x, sq2.z);
        }
        var sarea = Math.abs(s2) * 0.5;
        if (sper > 0 && (4 * Math.PI * sarea) / (sper * sper) < 0.12) sliverB++;
      }
      if (L.blocks.length && sliverB / L.blocks.length > 0.14) {
        issues.push('road network: ' + Math.round(100 * sliverB / L.blocks.length) +
          '% of blocks are slivers');
      }

      // ---- islands: land, reachable, and pointed at by the missions --------
      // The offshore chain is authored, and authored coordinates rot. Three
      // checks, all of which would have caught a mistake I made writing them:
      // the islands have to be dry land where the height field agrees, the
      // causeway has to actually connect Pelican Key to the city road graph,
      // and every island mission stage has to land on the kind of surface it
      // asks for - drive and goto on ground, sail on water deep enough to
      // float a boat.
      if (SB.Islands && this.islands) {
        var isles = SB.Islands.LIST;
        for (var il = 0; il < isles.length; il++) {
          var isle = isles[il];
          var ih = this.world.baseHeight(isle.x, isle.z);
          if (ih < this.world.waterY + 2) {
            issues.push(isle.name + ' is underwater at its centre (' + ih.toFixed(1) + 'm)');
          }
          // and it has to be an island: sea all the way round it
          var wet = 0;
          for (var ia = 0; ia < 8; ia++) {
            var ang = (ia / 8) * Math.PI * 2;
            var ox = isle.x + Math.cos(ang) * isle.r * 1.34;
            var oz = isle.z + Math.sin(ang) * isle.r * 1.34;
            if (this.world.baseHeight(ox, oz) < this.world.waterY - 0.5) wet++;
          }
          if (wet < 7) issues.push(isle.name + ' is joined to something: only ' + wet + '/8 bearings are sea');
        }

        // Pelican Key drives: a road node on the key has to route to downtown.
        var keyIsle = SB.Islands.byId('pelican');
        var keyNode = Rd.nearestNode(L, keyIsle.x, keyIsle.z);
        var townNode = Rd.nearestNode(L, 0, 0);
        var keyPath = Rd.findPath(L, keyNode.id, townNode.id);
        if (!keyPath || keyPath.length < 2) {
          issues.push('Pelican Key is not reachable by road - the causeway did not weld');
        }

        var islandStages = { 'the-causeway': 1, 'gull-rock-light': 1, 'mercy-point': 1 };
        var chain = SB.Missions.CHAIN || [];
        for (var mi = 0; mi < chain.length; mi++) {
          if (!islandStages[chain[mi].id]) continue;
          var sts = chain[mi].stages;
          for (var si = 0; si < sts.length; si++) {
            var st2 = sts[si];
            if (st2.x === undefined) continue;
            var gh = this.world.baseHeight(st2.x, st2.z);
            if (st2.type === 'sail') {
              if (gh > this.world.waterY - 1.0) {
                issues.push(chain[mi].id + ' stage ' + si + ' asks you to sail onto dry land');
              }
            } else if (st2.type === 'drive' || st2.type === 'goto' || st2.type === 'pickup') {
              if (gh < this.world.waterY + 0.3) {
                issues.push(chain[mi].id + ' stage ' + si + ' points at open water');
              }
              if (st2.type === 'drive') {
                var dn = Rd.nearestNode(L, st2.x, st2.z);
                if (SB.M.dist(dn.x, dn.z, st2.x, st2.z) > (st2.r || 10) + 26) {
                  issues.push(chain[mi].id + ' stage ' + si + ' has no road within reach');
                }
              }
            }
          }
        }
      }

      // ---- fire: it burns, it spreads, and somebody comes ------------------
      // The fire service is the first system here that both simulates and
      // drives, so it gets probed on both halves. Every fire started by this
      // block is put out again before the probe returns - a self test that
      // leaves the city alight is worse than no self test.
      if (this.fires) {
        var FR = this.fires;
        var priorFires = FR.list.length;
        if (!FR.station) issues.push('fire station was not built');
        else {
          var stY = this.world.baseHeight(FR.station.apron.x, FR.station.apron.z);
          if (!isFinite(stY)) issues.push('fire station apron is not on the ground');
          if (FR.engines.length < 1) issues.push('fire service has no engines');
        }

        var probeB = FR.pickBuilding(0);
        var probeFire = probeB ? FR.igniteBuilding(probeB, { forced: true }) : null;
        if (!probeFire) issues.push('could not start a probe fire');
        else {
          // it grows
          var i0 = probeFire.intensity;
          for (var fs = 0; fs < 120; fs++) FR.fixed(1 / 60);
          if (probeFire.out || probeFire.intensity <= i0) {
            issues.push('a fire with fuel did not grow');
          }
          // the hose is aimed, not sprayed in a circle
          var fx0 = probeFire.x, fz0 = probeFire.z;
          var beforeI = probeFire.intensity;
          FR.douse(fx0 - 12, probeFire.y, fz0, -1, 0, 26, 1.0, 0.5);
          if (probeFire.intensity < beforeI - 1e-6) {
            issues.push('the hose puts out fires it is pointed away from');
          }
          FR.douse(fx0 - 12, probeFire.y, fz0, 1, 0, 26, 1.0, 0.5);
          if (probeFire.intensity >= beforeI) {
            issues.push('the hose does nothing to a fire it is pointed at');
          }
          // an engine takes the call and stages on a road
          var claimed = false;
          for (var fe = 0; fe < FR.engines.length; fe++) {
            if (FR.engines[fe].call) claimed = true;
          }
          if (!claimed) issues.push('no engine was dispatched to a fire');
          var stage = FR.stagingPoint(probeFire);
          if (SB.Roads.onRoad(this.layout, stage.x, stage.z) === false) {
            issues.push('an engine would stage off the road');
          }
        }

        // Spread is bounded. Filling the list to the ceiling must stop it
        // dead: unbounded spread is exponential, and the first version of
        // this took one building to the whole cap inside a minute.
        var filler = [];
        while (FR.list.length < 8) {
          var fb = FR.pickBuilding(0);
          if (!fb) break;
          var made = FR.igniteBuilding(fb, { forced: true });
          if (!made) break;
          filler.push(made);
        }
        if (FR.list.length >= 8) {
          var beforeN = FR.list.length;
          var hot = FR.list[0];
          hot.intensity = 1; hot.fuel = 200; hot.spreads = 0; hot.generation = 0;
          for (var sp = 0; sp < 40; sp++) FR.trySpread(hot);
          if (FR.list.length > beforeN) {
            issues.push('fire spread past its ceiling (' + FR.list.length + ' burning)');
          }
        }

        // Put the city out again.
        while (FR.list.length > priorFires) FR.extinguish(FR.list[FR.list.length - 1]);
        for (var ce = 0; ce < FR.engines.length; ce++) FR.engines[ce].call = null;
      }

      // ---- contracts: every generated job must be runnable -----------------
      if (this.missions && this.progress && SB.Missions.CONTRACT_TYPES) {
        var savedXp = this.progress.xp, savedUnlocked = this.progress.unlocked;
        this.progress.xp = 999999;
        this.progress.rank = this.progress.rankInfo().rank;
        this.progress.unlocked = {};
        this.progress.refreshUnlocks();
        var kinds = Object.create(null), madeCount = 0;
        for (var ci2 = 0; ci2 < 120; ci2++) {
          var con = this.missions.makeContract();
          if (!con) continue;
          madeCount++;
          kinds[con.kind] = 1;
          if (!(con.reward > 0) || !con.stages || !con.stages.length) {
            issues.push('contract ' + con.kind + ' generated with no reward or no stages');
            break;
          }
          for (var si2 = 0; si2 < con.stages.length; si2++) {
            var cs = con.stages[si2];
            if (cs.x !== undefined && (!isFinite(cs.x) || !isFinite(cs.z))) {
              issues.push('contract ' + con.kind + ' stage ' + cs.type + ' has a non-finite target');
              break;
            }
          }
        }
        var kindCount = Object.keys(kinds).length;
        if (kindCount < SB.Missions.CONTRACT_TYPES.length) {
          issues.push('contract generator produced only ' + kindCount + ' of ' +
            SB.Missions.CONTRACT_TYPES.length + ' job types in ' + madeCount + ' draws');
        }
        this.progress.xp = savedXp;
        this.progress.unlocked = savedUnlocked;
        this.progress.rank = this.progress.rankInfo().rank;
      }

      // ---- garage: store, upgrade, retrieve ---------------------------------
      // The retrieval bug this catches is specific and easy to reintroduce:
      // Vehicle.placeAt resolves its height from 50 m up, which under a
      // three-deck car park finds the ROOF, so a car fetched from the garage
      // materialised three floors above its bay.
      if (this.garage && this.garage.bay && this.traffic && this.progress) {
        var ga = this.garage;
        var keptXp = this.progress.xp, keptUnlocked = this.progress.unlocked;
        this.progress.xp = 999999;
        this.progress.rank = this.progress.rankInfo().rank;
        this.progress.unlocked = {};
        this.progress.refreshUnlocks();
        var keptSlots = ga.slots.slice(0);
        ga.slots.length = 0;

        var probeCar = this.traffic.spawnParked('sedan', ga.bay.x, ga.bay.z, 0, 0x1d3f77);
        var baseTorque = SB.VehicleSpecs.sedan.torque;
        if (!ga.store(probeCar)) {
          issues.push('garage refused to store a car into an empty garage');
        } else {
          ga.recycleBody(probeCar);
          ga.slots[0].upgrades.engine = 1;
          var back = ga.retrieve(0);
          if (!back) {
            issues.push('garage could not retrieve a stored car');
          } else {
            if (Math.abs(back.pos.y - ga.bay.y) > 1.5) {
              issues.push('garage returned a car at y=' + back.pos.y.toFixed(2) +
                ' but the bay floor is y=' + ga.bay.y.toFixed(2));
            }
            if (!(back.spec.torque > baseTorque)) {
              issues.push('garage upgrade did not reach the vehicle spec');
            }
            if (SB.VehicleSpecs.sedan.torque !== baseTorque) {
              issues.push('garage upgrade leaked into the shared vehicle spec');
            }
            ga.recycleBody(back);
          }
        }
        ga.slots.length = 0;
        for (var gs = 0; gs < keptSlots.length; gs++) ga.slots.push(keptSlots[gs]);
        this.progress.xp = keptXp;
        this.progress.unlocked = keptUnlocked;
        this.progress.rank = this.progress.rankInfo().rank;
      }

      // ---- damage: dents must be private to the car that took them ---------
      if (this.traffic) {
        var dmgA = this.traffic.spawnParked('sedan', 0, 0, 0, 0x8f1f24);
        var dmgB = this.traffic.spawnParked('sedan', 6, 0, 0, 0x1d3f77);
        if (dmgA.body.geometry !== dmgB.body.geometry) {
          issues.push('undamaged cars of one class do not share their geometry');
        }
        dmgA.damage(260, 'world', 1, 0, dmgA.pos.x + 1.6, dmgA.pos.y + 0.4, dmgA.pos.z);
        if (dmgA.body.geometry === dmgB.body.geometry) {
          issues.push('a damaged car dented the geometry shared by its whole class');
        }
        if (!dmgA._dents) issues.push('a hard impact left no dent');
        var pristineA = dmgA._pristine, liveA = dmgA.body.geometry.attributes.position.array;
        var bent = 0;
        for (var vi = 0; vi < liveA.length; vi++) {
          if (Math.abs(liveA[vi] - pristineA[vi]) > 1e-5) bent++;
        }
        if (!bent) issues.push('dent moved no vertices');
        dmgA.repairBody();
        var stillBent = 0;
        var afterA = dmgA.body.geometry.attributes.position.array;
        for (vi = 0; vi < afterA.length; vi++) {
          if (Math.abs(afterA[vi] - pristineA[vi]) > 1e-5) stillBent++;
        }
        if (stillBent) issues.push('repairBody left ' + stillBent + ' vertices bent');
        this.traffic.recycle(dmgA);
        if (dmgA.body.geometry !== dmgA._sharedGeo) {
          issues.push('a recycled car kept its private damaged geometry');
        }
        this.traffic.recycle(dmgB);
      }

      // ---- rhythm: the city has to actually change across the day ----------
      if (this.rhythm && this.traffic && this.peds) {
        var keptHour = this.sky.hour;
        var quiet = null, rush = null;
        this.sky.setHour(3); this.rhythm.apply(true);
        quiet = { t: this.rhythm.traffic, p: this.rhythm.peds, parked: this.traffic.maxParked };
        this.sky.setHour(8); this.rhythm.apply(true);
        rush = { t: this.rhythm.traffic, p: this.rhythm.peds, parked: this.traffic.maxParked };
        if (!(rush.t > quiet.t * 2)) issues.push('rhythm: rush hour is not busier than 3 a.m.');
        if (!(rush.p > quiet.p * 2)) issues.push('rhythm: no pedestrian difference across the day');
        // Parked cars run the other way round: full overnight, emptier by day.
        if (!(quiet.parked > rush.parked)) issues.push('rhythm: parked population does not invert');
        // The bias must reach the picker and actually change the mix.
        this.sky.setHour(2); this.rhythm.apply(true);
        var nightBias = this.traffic.typeBias;
        this.sky.setHour(12); this.rhythm.apply(true);
        var dayBias = this.traffic.typeBias;
        if (!nightBias || !(nightBias.taxi > 1)) issues.push('rhythm: no night taxi bias');
        if (nightBias === dayBias) issues.push('rhythm: the traffic mix never changes');
        this.sky.setHour(keptHour); this.rhythm.apply(true);
      }

      // ---- camera modes ----------------------------------------------------
      if (this.cameras && this.player) {
        var cams = this.cameras;
        var startMode = cams.mode;
        cams.setMode('first');
        cams.render(1 / 60, this.camera);
        if (this.player.mode === 'foot' && this.player.char.root.visible) {
          issues.push('first person still draws the player avatar');
        }
        var eye = new THREE.Vector3();
        cams.eyePoint(eye);
        if (Math.abs(eye.y - (this.player.pos.y + 1.62)) > 0.01) {
          issues.push('first person eye height is wrong on foot');
        }
        cams.setMode('follow');
        cams.render(1 / 60, this.camera);
        if (this.player.mode === 'foot' && !this.player.char.root.visible) {
          issues.push('returning to third person left the avatar hidden');
        }
        // Photo mode must restore everything it takes over.
        var pausedBefore = this.paused, blockBefore = this.uiBlocking;
        cams.togglePhoto();
        if (!this.paused) issues.push('photo mode did not stop the world');
        cams.togglePhoto();
        if (this.paused !== pausedBefore || this.uiBlocking !== blockBefore) {
          issues.push('leaving photo mode did not restore the paused/ui state');
        }
        cams.setMode(startMode);
      }

      // ---- settings: clamping, persistence and live audio ------------------
      // The game shipped with no volume control at all, so the risk worth
      // guarding is not "a slider looks wrong" but "a stored value silently
      // leaves the player with no audio and no way to see why".
      if (SB.Settings) {
        var St = SB.Settings;
        var keptSettings = JSON.parse(JSON.stringify(St.values));

        // Anything that is not a finite number in range must fall back to the
        // default rather than reaching a gain node.
        var junk = St.sanitize({
          volMaster: 'loud', volEffects: 99, volMusic: -5, muted: true,
          lookSpeed: NaN, hudScale: null, notASetting: 7
        });
        if (junk.volMaster !== St.DEFS.volMaster[0]) issues.push('settings: a non-numeric volume was not rejected');
        if (junk.volEffects !== 1) issues.push('settings: an out-of-range volume was not clamped');
        if (junk.volMusic !== 0) issues.push('settings: a negative volume was not clamped');
        if (junk.muted !== 1) issues.push('settings: a boolean was not coerced');
        if (junk.lookSpeed !== St.DEFS.lookSpeed[0]) issues.push('settings: NaN look speed was not rejected');
        if ('notASetting' in junk) issues.push('settings: an unknown key survived sanitising');

        // The read-side helpers are what the player, camera, HUD and post
        // pipeline actually consult.
        St.values.invertY = 1; St.values.reduceMotion = 1;
        St.values.lookSpeed = 2; St.values.hudScale = 1.25;
        if (St.lookInvertY() !== -1) issues.push('settings: invertY does not invert');
        if (St.motionScale() !== 0) issues.push('settings: reduceMotion does not zero motion');
        if (St.lookScale() !== 2) issues.push('settings: lookScale does not report the setting');
        if (St.hudScale() !== 1.25) issues.push('settings: hudScale does not report the setting');

        // Muting has to reach the master gain, not just the checkbox.
        if (this.audio && this.audio.ready) {
          St.values.muted = 1; St.values.volMaster = 0.8;
          St.apply();
          var target = this.audio.master.gain.value;
          // setTargetAtTime ramps, so read the scheduled target rather than
          // the instantaneous value where the browser exposes it.
          if (target > 0.85) issues.push('settings: mute did not move the master gain');
        }

        St.values = keptSettings;
        St.apply();
      }

      // ---- save: capture and re-apply must be lossless ---------------------
      if (SB.Save && this.player) {
        var snap = SB.Save.capture(this);
        if (!snap) {
          issues.push('save capture returned nothing');
        } else {
          var moneyWas = this.player.money;
          this.player.money = 1;
          if (this.progress) { var xpWas = this.progress.xp; this.progress.xp = 0; }
          SB.Save.apply(this, JSON.parse(JSON.stringify(snap)));
          if (this.player.money !== moneyWas) {
            issues.push('save round trip lost money (' + moneyWas + ' -> ' + this.player.money + ')');
          }
          if (this.progress && this.progress.xp !== xpWas) {
            issues.push('save round trip lost progress (' + xpWas + ' -> ' + this.progress.xp + ')');
          }
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
        'multi-level/bank/vehicle/car-stability/boat/plane/heli/routing/contract/' +
        'garage/damage/rhythm/camera/settings/save/road-network/island/fire probes clean)');
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
