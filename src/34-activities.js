// Road-graph time trials, speed cameras and scenic discoveries.
(function (SB) {
  'use strict';
  var M = SB.M;
  var COURSE_BRIEFS = [
    { id: 'coast-run', name: 'Coastline Run', detail: 'Sweep along the western waterfront.', color: 0x45d6d0,
      anchors: [[-950, 360], [-940, 50], [-900, -360]], reward: 1800 },
    { id: 'city-lights', name: 'City Lights', detail: 'Technical turns through the downtown streets.', color: 0xffbc66,
      anchors: [[-120, 120], [160, 210], [260, -150], [-120, -130]], reward: 2400 },
    { id: 'hill-climb', name: 'Summit Chase', detail: 'Climb into the hills and hold your line.', color: 0xc198fa,
      anchors: [[380, 200], [650, 350], [860, 660]], reward: 2800 },
    { id: 'grand-tour', name: 'The Grand Tour', detail: 'A cross-city endurance sprint.', color: 0x80dc83,
      anchors: [[-900, 400], [-300, 280], [300, 300], [680, -180], [250, -700]], reward: 4200 }
  ];

  // BFS reconstructs actual connected roads. Never draw checkpoints through
  // buildings by interpolating a straight line between the authored anchors.
  // Race courses are laid out along the road graph, so they want the same
  // router the navigation line uses. This was a hop-count breadth-first
  // search, which minimises junctions rather than driving distance and will
  // happily send a course down four hundred metres of freeway to save a
  // turn. Roads.findPath is one cached Dijkstra from the destination,
  // weighted by travel time with junction and ramp penalties.
  function roadPath(L, from, to) {
    // findPath returns null when the graph does not connect the two; this
    // function's callers expect an empty array.
    return SB.Roads.findPath(L, from, to) || [];
  }

  function buildCourse(L, brief) {
    var ids = [];
    for (var i = 1; i < brief.anchors.length; i++) {
      var a = SB.Roads.nearestNode(L, brief.anchors[i - 1][0], brief.anchors[i - 1][1]);
      var b = SB.Roads.nearestNode(L, brief.anchors[i][0], brief.anchors[i][1]);
      var path = roadPath(L, a.id, b.id);
      if (!path.length) return null;
      ids = ids.concat(i === 1 ? path : path.slice(1));
    }
    var checkpoints = [], length = 0;
    for (i = 0; i < ids.length; i++) {
      var n = L.nodes[ids[i]], previous = i ? L.nodes[ids[i - 1]] : null;
      if (previous) length += M.dist(n.x, n.z, previous.x, previous.z);
      var last = checkpoints[checkpoints.length - 1];
      if (!last || i === ids.length - 1 || M.dist(last.x, last.z, n.x, n.z) >= 35) {
        checkpoints.push({ x: n.x, y: n.y || 0, z: n.z });
      }
    }
    if (checkpoints.length < 3) return null;
    return { id: brief.id, name: brief.name, detail: brief.detail, color: brief.color,
      checkpoints: checkpoints, length: length, reward: brief.reward,
      gold: length / 18 + checkpoints.length * 0.9,
      silver: length / 13 + checkpoints.length * 1.1,
      bronze: length / 9 + checkpoints.length * 1.3 };
  }

  function sweptDistance(a, b, point) {
    var dx = b.x - a.x, dz = b.z - a.z, dd = dx * dx + dz * dz;
    var t = dd ? M.clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / dd, 0, 1) : 0;
    return Math.hypot(a.x + dx * t - point.x, a.z + dz * t - point.z);
  }

  function Activities(game) {
    this.game = game;
    this.courses = COURSE_BRIEFS.map(function (brief) { return buildCourse(game.layout, brief); }).filter(Boolean);
    this.records = Object.create(null);
    this.discoveries = Object.create(null);
    this.trapRecords = Object.create(null);
    this.traps = [];
    this.active = null;
    this.prompt = null;
    this.lastPos = game.player.pos.clone();
    this.open = false;
    this.elapsed = 0;
    this.marker = new THREE.Group();
    this.marker.name = 'time-trial-checkpoint';
    this.marker.visible = false; game.scene.add(this.marker);
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0x47e3d4, transparent: true, opacity: 0.72, depthWrite: false });
    var ring = new THREE.Mesh(new THREE.TorusGeometry(10, 0.16, 6, 48), this.markerMat);
    ring.rotation.x = -Math.PI / 2; this.marker.add(ring);
    var beams = new SB.QB();
    [-10, 10].forEach(function (x) { beams.box(x - 0.10, 0, -0.10, x + 0.10, 5, 0.10, 1, 1, 1, {}); });
    this.marker.add(beams.mesh(this.markerMat, false, false));
    this.buildTraps();
    this.wirePanel();
    var self = this;
    game.bus.on('playerDied', function () { self.cancel('Run ended. Try again when you are ready.'); });
    game.bus.on('busted', function () { self.cancel('Run ended. Try again when you are ready.'); });
    game.bus.on('missionStart', function () { self.cancel('Time trial stopped for the story mission.'); });
  }

  Activities.prototype.buildTraps = function () {
    var g = this.game, q = new SB.QB();
    var anchors = [[-720, 150], [120, 340], [700, -100], [480, 720], [-220, -720]];
    for (var i = 0; i < anchors.length; i++) {
      var n = SB.Roads.nearestNode(g.layout, anchors[i][0], anchors[i][1]);
      var e = g.layout.edges[n.edges[0]], other = g.layout.nodes[SB.Roads.otherNode(e, n.id)];
      var x = (n.x + other.x) / 2, z = (n.z + other.z) / 2, y = (n.y + other.y) / 2;
      var dx = other.x - n.x, dz = other.z - n.z, len = Math.hypot(dx, dz) || 1;
      var sx = x - dz / len * (e.width / 2 + 2), sz = z + dx / len * (e.width / 2 + 2);
      this.traps.push({ id: 'camera-' + i, name: 'Speed zone ' + (i + 1), x: x, y: y, z: z, cooldown: 0 });
      q.box(sx - 0.1, y, sz - 0.1, sx + 0.1, y + 4, sz + 0.1, 1, 1, 1, {});
      q.box(sx - 0.45, y + 3.6, sz - 0.3, sx + 0.45, y + 4.4, sz + 0.3, 1, 1, 1, {});
    }
    this.trapMesh = q.mesh(new THREE.MeshStandardMaterial({ color: 0xf2be63, roughness: 0.6 }), false, true);
    g.scene.add(this.trapMesh);
  };

  Activities.prototype.places = function () {
    var places = this.game.coast ? this.game.coast.landmarks.slice() : [];
    for (var i = 0; i < this.courses.length; i++) {
      var c = this.courses[i], p = c.checkpoints[0];
      places.push({ id: c.id, name: c.name, x: p.x, z: p.z, color: c.color, icon: '◆', kind: 'race', priority: 2 });
    }
    return places;
  };

  Activities.prototype.select = function (course) {
    var g = this.game;
    if (g.deliveries && g.deliveries.active) { g.hud.toast('Finish or cancel your delivery before entering a race.'); return; }
    if (g.neighbors && g.neighbors.active) { g.hud.toast('Finish or cancel your guided walk before entering a race.'); return; }
    if (g.missions.active) { g.hud.toast('Finish the story mission before starting a time trial.'); return; }
    this.active = { course: course, state: 'travel', checkpoint: 0, time: 0, countdown: 3 };
    this.setCheckpoint(0);
    this.toggle(false);
    g.hud.toast('Drive to the start in a car. Stop inside the ring to begin.');
  };

  Activities.prototype.setCheckpoint = function (index) {
    var c = this.active.course, p = c.checkpoints[index];
    this.marker.position.set(p.x, p.y + 0.25, p.z);
    this.markerMat.color.setHex(c.color); this.marker.visible = true;
    var hud = this.game.hud;
    hud.destination = { id: 'race-checkpoint', name: index ? c.name + ' · Checkpoint ' + index : c.name + ' · Start',
      x: p.x, z: p.z, color: c.color, icon: '◆', kind: 'waypoint' };
    hud.rebuildRoute();
  };

  Activities.prototype.cancel = function (message) {
    if (!this.active) return;
    this.active = null; this.marker.visible = false;
    var hud = this.game.hud;
    if (hud.destination && hud.destination.id === 'race-checkpoint') { hud.destination = null; hud.navigation.points = []; }
    if (message) hud.toast(message);
  };

  Activities.prototype.finish = function () {
    var run = this.active, c = run.course, g = this.game;
    var medal = run.time <= c.gold ? 'GOLD' : run.time <= c.silver ? 'SILVER' : run.time <= c.bronze ? 'BRONZE' : 'FINISHER';
    var old = this.records[c.id], best = !old || run.time < old.time;
    var payout = Math.round(c.reward * (medal === 'GOLD' ? 1 : medal === 'SILVER' ? 0.75 : medal === 'BRONZE' ? 0.5 : 0.25));
    if (old) payout = Math.round(payout * 0.35);
    if (best) this.records[c.id] = { time: run.time, medal: medal };
    g.player.money += payout;
    g.hud.setTitle(medal + ' · ' + c.name, run.time.toFixed(1) + 's' + (best ? ' · PERSONAL BEST' : '') + ' · +' + SB.formatMoney(payout));
    this.cancel();
    if (g.audio) g.audio.blip('success');
    if (g.saveGame) g.saveGame.save();
  };

  Activities.prototype.fixed = function (dt) {
    var g = this.game, p = g.player;
    this.elapsed += dt;
    this.prompt = null;
    var coast = g.coast;
    if (coast && p.mode === 'foot' && !p.dead && !g.worldHidden && !g.uiBlocking) {
      var lookout = coast.lookout, target = lookout.inside ? lookout.top : lookout.entry;
      if (M.dist(p.pos.x, p.pos.z, target.x, target.z) < 3 && Math.abs(p.pos.y - target.y) < 3) {
        this.prompt = lookout.inside ? 'Return to the boardwalk' : 'Ride the lighthouse lift';
        if (g.input.actHit('interact') && !(g.interiors && g.interiors.prompt)) {
          var destination = lookout.inside ? lookout.entry : lookout.top;
          p.pos.set(destination.x, destination.y, destination.z); p.vel.set(0, 0, 0);
          p.camYaw = Math.PI; p.camPitch = -0.12; p.camPos.copy(p.pos).add(new THREE.Vector3(6, 3, 0));
          lookout.inside = !lookout.inside;
          if (g.post) g.post.resetHistory();
        }
      }
      if (lookout.inside && (p.pos.y < lookout.top.y - 5 || M.dist(p.pos.x, p.pos.z, lookout.top.x, lookout.top.z) > 18)) lookout.inside = false;
    }
    if (coast && !p.dead && !g.worldHidden) {
      for (var i = 0; i < coast.landmarks.length; i++) {
        var lm = coast.landmarks[i];
        if (!this.discoveries[lm.id] && M.dist(p.pos.x, p.pos.z, lm.x, lm.z) < 18 && p.pos.y < 45) {
          this.discoveries[lm.id] = true; p.money += 300;
          g.hud.setTitle('DISCOVERED', lm.name + ' · +$300');
          if (g.saveGame) g.saveGame.save();
        }
      }
    }
    var driving = p.mode === 'car' && p.vehicle && !p.dead;
    for (i = 0; i < this.traps.length; i++) {
      var trap = this.traps[i]; trap.cooldown = Math.max(0, trap.cooldown - dt);
      if (!driving || trap.cooldown || Math.abs(p.pos.y - trap.y) > 5) continue;
      if (sweptDistance(this.lastPos, p.pos, trap) < 13) {
        trap.cooldown = 15;
        var speed = Math.round(p.vehicle.speed() * 3.6), bestSpeed = this.trapRecords[trap.id] || 0;
        if (speed >= 50) {
          if (speed > bestSpeed) {
            this.trapRecords[trap.id] = speed; p.money += 150;
            g.hud.toast(trap.name + ': ' + speed + ' km/h · NEW BEST · +$150');
            if (g.saveGame) g.saveGame.save();
          } else g.hud.toast(trap.name + ': ' + speed + ' km/h · best ' + bestSpeed);
        }
      }
    }
    var run = this.active;
    if (run) {
      var checkpoint = run.course.checkpoints[run.checkpoint];
      if (run.state === 'travel') {
        if (driving && M.dist(p.pos.x, p.pos.z, checkpoint.x, checkpoint.z) < 11 &&
            Math.abs(p.pos.y - checkpoint.y) < 5 && p.vehicle.speed() < 1.5) run.state = 'countdown';
      } else if (run.state === 'countdown') {
        if (!driving || M.dist(p.pos.x, p.pos.z, checkpoint.x, checkpoint.z) > 13) {
          run.state = 'travel'; run.countdown = 3;
        } else {
          run.countdown -= dt;
          if (run.countdown <= 0) { run.state = 'racing'; run.checkpoint = 1; this.setCheckpoint(1); g.hud.toast('GO! Follow the checkpoint rings.'); }
        }
      } else {
        run.time += dt;
        if (!driving) this.cancel('Run stopped. Stay in a car during a time trial.');
        else if (run.time > run.course.bronze * 2) this.cancel('Time limit reached. Select the route to retry.');
        else if (Math.abs(p.pos.y - checkpoint.y) < 6 && sweptDistance(this.lastPos, p.pos, checkpoint) < 13) {
          run.checkpoint++;
          if (run.checkpoint >= run.course.checkpoints.length) this.finish();
          else { this.setCheckpoint(run.checkpoint); if (g.audio) g.audio.blip('objective'); }
        }
      }
    }
    this.lastPos.copy(p.pos);
  };

  Activities.prototype.wirePanel = function () {
    var self = this, g = this.game;
    this.button = document.getElementById('exploreButton');
    this.panel = document.getElementById('explorePanel');
    this.cards = document.getElementById('activityCards');
    this.status = document.getElementById('activityStatus');
    this.button.addEventListener('click', function (e) { e.stopPropagation(); self.toggle(); });
    document.getElementById('exploreClose').addEventListener('click', function (e) { e.stopPropagation(); self.toggle(false); });
    document.getElementById('cancelRun').addEventListener('click', function () { self.cancel('Route cancelled.'); self.refreshPanel(); });
    document.getElementById('saveProgress').addEventListener('click', function () {
      var ok = g.saveGame && g.saveGame.save(); g.hud.toast(ok ? 'Progress saved on this device.' : 'Saving is unavailable in this browser.');
      self.refreshPanel();
    });
    this.panel.querySelectorAll('[data-hour]').forEach(function (button) {
      button.addEventListener('click', function () {
        g.sky.setHour(Number(button.dataset.hour));
        if (g.weather) g.weather.setMode('sun', true);
        if (g.post) g.post.resetHistory();
      });
    });
    window.addEventListener('keydown', function (e) {
      if (!g.started || (g.uiBlocking && !self.open)) return;
      if (e.code === 'Tab') { e.preventDefault(); if (!e.repeat) self.toggle(); }
      if (e.code === 'Escape' && self.open) { e.preventDefault(); self.toggle(false); }
    });
    this.panel.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      e.stopPropagation();
      var buttons = Array.from(self.panel.querySelectorAll('button:not([disabled])'));
      var first = buttons[0], last = buttons[buttons.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  };

  Activities.prototype.toggle = function (value, suppressLock) {
    var g = this.game;
    var next = value === undefined ? !this.open : !!value;
    if (next && !this.open && (g.uiBlocking || g.hud.shop || g.hud.mapOpen)) return;
    if (next === this.open) return;
    this.open = next;
    this.panel.hidden = !next;
    if (next) {
      this.wasPaused = g.paused; g.uiBlocking = true; g.setPaused(true);
      if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
      if (g.touch) g.touch.releaseAll();
      this.refreshPanel(); document.getElementById('exploreClose').focus();
    } else {
      g.uiBlocking = false;
      if (!this.wasPaused) { g.setPaused(false); if (!suppressLock) g.input.requestLock(); }
      this.button.focus();
    }
  };

  Activities.prototype.refreshPanel = function () {
    var self = this;
    this.cards.replaceChildren();
    function card(title, detail, label, action, accent) {
      var item = document.createElement('article'); item.className = 'activity-card';
      item.style.setProperty('--accent', accent || '#4bd6d0');
      var heading = document.createElement('h3'); heading.textContent = title;
      var p = document.createElement('p'); p.textContent = detail;
      var button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.addEventListener('click', action); item.append(heading, p, button); self.cards.appendChild(item);
    }
    if (this.game.cityLife) {
      var life = this.game.cityLife, chapter = SB.CityLifeStory[life.chapter];
      card(chapter ? 'Undertow · ' + chapter[1] : 'Undertow · Case closed',
        chapter ? chapter[2] : 'The investigation is complete. Local work remains available throughout the city.',
        'Open investigation journal', function () {
          self.toggle(false, true); life.journal();
        }, '#f4c271');
    }
    if (this.game.deliveries) {
      var dispatch = this.game.deliveries;
      card('Courier dispatch', dispatch.active ? 'Deliver ' + dispatch.active.cargo + ' to ' + dispatch.active.door.name :
        'Travel between real businesses. Earn cash, early-delivery bonuses and local trust. Completed: ' + dispatch.completed,
        dispatch.active ? 'Manage delivery' : 'Find a delivery', function () { self.toggle(false, true); dispatch.menu(); }, '#78dfaa');
    }
    if (this.game.pastimes) card('After hours', 'Hands-on orders, memory sequences, timing challenges and circuit puzzles. Beat your best, earn cash and complete local shifts.',
      this.game.interiors.current ? 'Play here' : 'Find an activity', function () { self.toggle(false, true); self.game.pastimes.menu(); }, '#acb5ff');
    // game.tuneShop, not game.garage: SB.Garage is the car park bay, which has
    // no menu() and would throw the moment this card was tapped.
    if (this.game.tuneShop) card('Bay Garage', 'Spend your earnings on permanent engine, brake and tire upgrades, repairs and five paint finishes. Park a car to begin.',
      'Open garage', function () { self.toggle(false, true); self.game.tuneShop.menu(); }, '#efae77');
    if (this.game.neighbors) card('Meet the neighbors', 'Help a tourist find a local business. Walk together for cash and trust. Completed walks: ' + this.game.neighbors.completed,
      this.game.neighbors.active ? 'Manage walk' : 'Meet someone', function () { self.toggle(false, true); self.game.neighbors.menu(); }, '#ffdca6');
    this.courses.forEach(function (c) {
      var record = self.records[c.id];
      var text = c.detail + ' ' + (c.length / 1000).toFixed(1) + ' km · Gold ' + Math.round(c.gold) + 's';
      text += record ? ' · Best ' + record.time.toFixed(1) + 's (' + record.medal + ')' : ' · Up to ' + SB.formatMoney(c.reward);
      card(c.name, text, 'Route to start', function () { self.select(c); }, '#' + c.color.toString(16).padStart(6, '0'));
    });
    if (this.game.coast) this.game.coast.landmarks.forEach(function (lm) {
      card(lm.name, self.discoveries[lm.id] ? 'Discovered · Return whenever you like.' : 'Explore a new waterfront destination · $300 discovery bonus.',
        'Set destination', function () { self.game.hud.setDestination(lm); self.toggle(false); });
    });
    document.getElementById('cancelRun').disabled = !this.active;
    var save = this.game.saveGame;
    document.getElementById('saveState').textContent = save && save.failed ? 'Saving unavailable. Check browser storage permissions.' : save && save.lastSaved ? 'Saved on this device · ' + new Date(save.lastSaved).toLocaleTimeString() : 'Progress saves on this device after rewards and every 30 seconds.';
  };

  Activities.prototype.render = function () {
    var g = this.game, run = this.active;
    this.button.hidden = !g.started || !!g.isTouch || this.open;
    this.trapMesh.visible = !g.worldHidden;
    this.marker.visible = !!run && !g.worldHidden;
    this.status.hidden = !run || this.open || g.hud.mapOpen || !!g.hud.shop || g.paused;
    if (!run) return;
    var text = run.state === 'travel' ? run.course.name + ' · Drive to the start and stop in the ring' :
      run.state === 'countdown' ? 'READY · ' + Math.max(1, Math.ceil(run.countdown)) :
      run.course.name + ' · ' + run.time.toFixed(1) + 's · ' + run.checkpoint + '/' + (run.course.checkpoints.length - 1);
    // Avoid layout/DOM churn when the displayed tenth of a second is unchanged.
    if (this.status.textContent !== text) this.status.textContent = text;
  };
  SB.ActivityRoutes = { roadPath: roadPath, buildCourse: buildCourse, sweptDistance: sweptDistance, briefs: COURSE_BRIEFS };
  SB.Activities = Activities;
})(window.SB = window.SB || {});
