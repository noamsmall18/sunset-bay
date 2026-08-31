// 18-hud.js - the whole interface on one 2D canvas over the WebGL view:
// radar, stars, vitals, weapon, mission text, prompts, shop menus and the
// full-screen map.
(function (SB) {
  'use strict';

  var M = SB.M, Roads = SB.Roads;

  var GOLD = '#f2c14e';
  var INK = '#f4f1ea';
  var DIM = 'rgba(244,241,234,0.55)';

  // Condensed face for the HUD: numerals stay narrow in the corners and read
  // fast at a glance. Falls back cleanly if the webfont has not landed yet.
  var UI = '"Barlow Condensed", "Helvetica Neue", Arial, sans-serif';
  var DISPLAY = '"Archivo Black", "Helvetica Neue", Arial, sans-serif';
  function f(weight, size, face) { return weight + ' ' + size + 'px ' + (face || UI); }
  function inCraft(p) { return !!(p && p.mode !== 'foot' && p.mode !== 'boatInterior' && p.vehicle); }

  // Read the safe-area insets the shell exposes as custom properties, so the
  // HUD clears notches and home indicators on a phone.
  function safeArea() {
    var cs = getComputedStyle(document.documentElement);
    function v(n) { var x = parseFloat(cs.getPropertyValue(n)); return isFinite(x) ? x : 0; }
    return { top: v('--sa-top'), right: v('--sa-right'), bottom: v('--sa-bottom'), left: v('--sa-left') };
  }

  function HUD(game) {
    this.game = game;
    this.canvas = document.getElementById('hud');
    this.ctx = this.canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.mapOpen = false;
    this.mapZoom = 1;
    this.destination = null;
    this.navigation = { points: [], waypoint: 1, total: 0, remaining: 0, turn: 'NO ROUTE' };
    this.mapSurface = new Image();
    this.bigMapFrame = null;
    this.toasts = [];
    this.title = null;
    this.titleT = 0;
    this.shop = null;
    this.shopIndex = 0;
    this.flash = 0;
    this.hurtFlash = 0;
    this.resize();

    var self = this;
    this.mapSurface.onload = function () { if (self.mapOpen) self.draw(0); };
    this.mapSurface.src = 'assets/sunset-bay-map-surface.png';
    var bus = game.bus;
    bus.on('missionStart', function (m) {
      self.setTitle(m.name, m.brief);
    });
    bus.on('missionComplete', function (m) { self.setTitle('Mission passed', m.name); });
    bus.on('missionFailed', function (m) { self.setTitle('Mission failed', m.name); });
    bus.on('wantedUp', function (n) { self.flash = 1; });
    bus.on('playerHurt', function (e) { self.hurtFlash = Math.min(1, self.hurtFlash + e.amount * 0.02); });
    bus.on('busted', function (e) { self.setTitle('Busted', 'Fine ' + SB.formatMoney(e.fine)); });
    bus.on('playerDied', function () { self.setTitle('Wasted', ''); });
    bus.on('toast', function (t) { self.toast(t.text); });
    bus.on('weaponPickup', function (w) { self.toast('Acquired: ' + w.name); });
    bus.on('openService', function (room) { self.openShop(room); });
    bus.on('interiorEntered', function (room) { self.toast(room.name); });

    window.addEventListener('keydown', function (e) {
      if (!game.started) return;
      if (e.code === 'KeyM' && !self.shop) {
        self.setMapOpen(!self.mapOpen);
        e.preventDefault();
      }
      if (self.shop) self.shopKey(e);
    });
    this.canvas.addEventListener('click', function (e) {
      if (self.mapOpen) self.mapTap(e.clientX, e.clientY);
    });
  }

  HUD.prototype.resize = function () {
    var w = window.innerWidth, h = window.innerHeight;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.w = w; this.h = h;
    // One scale factor for the whole HUD, driven by the short edge: a phone in
    // landscape is ~390px tall and cannot carry desktop-sized furniture.
    this.s = M.clamp(Math.min(w, h) / 760, 0.62, 1.12);
    this.sa = safeArea();
    this.touchMode = !!this.game.isTouch;
    // height reserved for the touch utility row along the top right
    this.utilH = this.touchMode ? M.clamp(Math.min(w, h) * 0.098, 40, 58) + 20 : 0;
  };

  // Font string at the current HUD scale.
  HUD.prototype.font = function (weight, size, face) {
    return f(weight, Math.round(size * (this.s || 1)), face);
  };

  HUD.prototype.toast = function (text) {
    this.toasts.push({ text: text, life: 3.4 });
    if (this.toasts.length > 4) this.toasts.shift();
  };

  HUD.prototype.setTitle = function (main, sub) {
    this.title = { main: main, sub: sub || '' };
    this.titleT = 4.2;
  };

  // ------------------------------------------------------------- drawing --
  HUD.prototype.draw = function (dt) {
    var ctx = this.ctx;
    var g = this.game;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    this.flash = Math.max(0, this.flash - dt * 1.6);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.9);
    this.titleT = Math.max(0, this.titleT - dt);

    if (!g.started) return;

    this.updateNavigation(dt);

    if (this.hurtFlash > 0.01) {
      var grd = ctx.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.25,
        this.w / 2, this.h / 2, this.h * 0.75);
      grd.addColorStop(0, 'rgba(180,20,20,0)');
      grd.addColorStop(1, 'rgba(180,20,20,' + (this.hurtFlash * 0.5).toFixed(3) + ')');
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    this.drawRadar(dt);
    this.drawVitals();
    this.drawWeather();
    this.drawWeapon();
    this.drawMission(dt);
    this.drawPrompt();
    this.drawPerformance();
    if (inCraft(g.player)) this.drawSpeedo();
    this.drawCrosshair();
    this.drawToasts(dt);
    this.drawTitle();
    if (this.mapOpen) this.drawBigMap();
    if (this.shop) this.drawShop();
    this.drawFade();
  };

  HUD.prototype.setMapOpen = function (open) {
    this.mapOpen = !!open;
    this.game.uiBlocking = this.mapOpen || !!this.shop;
    this.canvas.style.pointerEvents = this.mapOpen ? 'auto' : 'none';
  };

  function colorHex(value) {
    return '#' + ('000000' + (value >>> 0).toString(16)).slice(-6);
  }

  HUD.prototype.missionPlace = function () {
    var ms = this.game.missions;
    if (!ms) return null;
    var st = ms.active && ms.active.stages[ms.stage];
    var x, z, name;
    if (st && st.x !== undefined) {
      x = st.x; z = st.z; name = st.text || 'Mission objective';
    } else if (st && st.type === 'stealTarget' && ms.targetCar) {
      x = ms.targetCar.pos.x; z = ms.targetCar.pos.z; name = st.text || 'Target vehicle';
    } else if (!ms.active && ms.current()) {
      x = ms.current().giver.x; z = ms.current().giver.z; name = 'Next job';
    }
    return x === undefined ? null : { id: 'mission', name: name, x: x, z: z, color: 0xffc83c, icon: '★', kind: 'mission', priority: 0 };
  };

  // The map is a navigation instrument, not a census of every simulated
  // entity. Keep this list deliberately small and stable: jobs, transit hubs,
  // and the handful of authored city anchors are what a player can actually
  // use to orient themselves.
  HUD.prototype.mapPlaces = function () {
    var g = this.game, places = [], L = g.layout;
    var mission = this.missionPlace();
    if (mission) places.push(mission);
    if (g.transport) {
      for (var i = 0; i < g.transport.landmarks.length; i++) {
        var lm = g.transport.landmarks[i];
        places.push({ id: 'transport-' + lm.id, name: lm.name, x: lm.x, z: lm.z,
          color: lm.color, icon: lm.kind === 'airport' ? '✦' : (lm.kind === 'helipad' ? 'H' : '⚓'),
          kind: lm.kind, priority: 2 });
      }
    }
    var authored = [
      { id: 'garage', name: 'Car park', block: L.landmarks && L.landmarks.garage, color: 0xf2c14e, icon: 'P' },
      { id: 'stadium', name: 'Stadium', block: L.landmarks && L.landmarks.stadium, color: 0xff7a66, icon: '◆' },
      { id: 'park', name: 'Central park', block: L.landmarks && L.landmarks.park, color: 0x66e07a, icon: '✚' }
    ];
    for (i = 0; i < authored.length; i++) {
      if (!authored[i].block) continue;
      places.push({ id: authored[i].id, name: authored[i].name,
        x: authored[i].block.cx, z: authored[i].block.cz,
        color: authored[i].color, icon: authored[i].icon, kind: 'landmark', priority: 3 });
    }
    if (g.interiors && g.interiors.spray) {
      places.push({ id: 'spray', name: "Pay 'n' Spray", x: g.interiors.spray.x, z: g.interiors.spray.z,
        color: 0xb18cff, icon: '↻', kind: 'service', priority: 3 });
    }
    if (this.destination && this.destination.kind === 'waypoint') places.push(this.destination);
    if (this.destination && this.destination.id === 'mission' && mission) this.destination = mission;
    return places;
  };

  HUD.prototype.placeById = function (id) {
    var places = this.mapPlaces();
    for (var i = 0; i < places.length; i++) if (places[i].id === id) return places[i];
    return null;
  };

  HUD.prototype.setDestination = function (place) {
    if (!place) return;
    this.destination = { id: place.id, name: place.name, x: place.x, z: place.z,
      color: place.color, icon: place.icon, kind: place.kind };
    this.rebuildRoute();
    this.toast('Route set: ' + place.name);
  };

  HUD.prototype.rebuildRoute = function () {
    var g = this.game, p = g.player, target = this.destination;
    if (!p || !target || !g.layout || !Roads) {
      this.navigation.points = [];
      return;
    }
    var L = g.layout, start = Roads.nearestNode(L, p.pos.x, p.pos.z);
    var finish = Roads.nearestNode(L, target.x, target.z);
    var points = [{ x: p.pos.x, z: p.pos.z }];
    if (M.dist(p.pos.x, p.pos.z, start.x, start.z) > 4) points.push({ x: start.x, z: start.z });
    var nodeId = start.id, guard = 0;
    while (nodeId !== finish.id && guard++ < L.nodes.length + 2) {
      var next = Roads.routeStep(L, nodeId, finish.id);
      if (next === nodeId) break;
      var n = L.nodes[next];
      points.push({ x: n.x, z: n.z });
      nodeId = next;
    }
    if (M.dist(points[points.length - 1].x, points[points.length - 1].z, target.x, target.z) > 1) {
      points.push({ x: target.x, z: target.z });
    }
    var total = 0;
    for (var i = 1; i < points.length; i++) total += M.dist(points[i - 1].x, points[i - 1].z, points[i].x, points[i].z);
    this.navigation.points = points;
    this.navigation.waypoint = Math.min(1, Math.max(0, points.length - 1));
    this.navigation.total = total;
    this.navigation.remaining = total;
    this.navigation.key = target.id + ':' + target.x.toFixed(1) + ':' + target.z.toFixed(1);
  };

  HUD.prototype.updateNavigation = function (dt) {
    var g = this.game, p = g.player;
    if (!p) return;
    var mission = this.missionPlace();
    if (!this.destination && mission) this.destination = mission;
    if (this.destination && this.destination.id === 'mission' && mission) {
      this.destination.x = mission.x; this.destination.z = mission.z; this.destination.name = mission.name;
    }
    var target = this.destination;
    if (!target) { this.navigation.points = []; return; }
    var key = target.id + ':' + target.x.toFixed(1) + ':' + target.z.toFixed(1);
    // The route geometry is stable while the player follows it. Rebuilding a
    // full graph path every few frames makes the HUD compete with the game
    // renderer; refresh only when the destination or route is actually new.
    if (key !== this.navigation.key || !this.navigation.points.length) {
      this.rebuildRoute();
    }
    var nav = this.navigation, pts = nav.points;
    if (!pts.length) return;
    while (nav.waypoint < pts.length - 1 && M.dist(p.pos.x, p.pos.z, pts[nav.waypoint].x, pts[nav.waypoint].z) < (nav.waypoint === pts.length - 1 ? 9 : 12)) nav.waypoint++;
    var nextDistance = M.dist(p.pos.x, p.pos.z, (pts[nav.waypoint] || target).x, (pts[nav.waypoint] || target).z);
    var remaining = nextDistance;
    for (var i = nav.waypoint; i < pts.length - 1; i++) remaining += M.dist(pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z);
    nav.remaining = remaining;
    var next = pts[nav.waypoint] || target;
    var desired = Math.atan2(next.z - p.pos.z, next.x - p.pos.x);
    var heading = inCraft(p) ? p.vehicle.yaw : p.yaw;
    var delta = M.wrapAngle(desired - heading);
    var abs = Math.abs(delta);
    nav.turn = remaining < 10 ? 'ARRIVE' : abs < 0.34 ? 'FOLLOW ROAD' : (delta > 0 ? 'TURN RIGHT' : 'TURN LEFT');
    nav.delta = delta;
    nav.heading = heading;
  };

  HUD.prototype.drawPerformance = function () {
    var q = SB.Q, g = this.game;
    if (!q || !q.showStats || !q.status) return;
    var s = q.status(g), ctx = this.ctx;
    var text = s.fps + ' FPS / ' + s.target + ' TARGET  ' + q.label();
    var x = this.w - 18 * this.s, y = this.touchMode
      ? this.sa.top + this.utilH + 18 * this.s : this.sa.top + 20 * this.s;
    ctx.save();
    ctx.font = this.font(600, 12);
    ctx.textAlign = 'right';
    var good = s.displayLimited ? true : s.fps >= s.target - 8;
    ctx.fillStyle = good ? 'rgba(143,224,143,.90)' : 'rgba(255,174,110,.95)';
    ctx.fillText(text, x, y);
    ctx.restore();
  };

  HUD.prototype.drawWeather = function () {
    var g = this.game, ctx = this.ctx;
    if (!g.weather) return;
    var w = g.weather;
    var x = this.w - 24 * this.s - this.sa.right;
    var y = 76 * this.s + this.utilH + this.sa.top;
    var accent = w.mode === 'rain' ? '#8ed8f2' : (w.mode === 'snow' ? '#f4f8ff' : GOLD);
    ctx.textAlign = 'right';
    ctx.font = this.font(700, 14);
    ctx.fillStyle = accent;
    ctx.fillText(w.label(), x, y);
    ctx.font = this.font(500, 12);
    ctx.fillStyle = DIM;
    var effect = w.mode === 'rain' ? 'GRIP ' + w.grip() + '%  ·  PUDDLES' :
      w.mode === 'snow' ? 'GRIP ' + w.grip() + '%  ·  DRIFTS' :
        w.mode === 'night' ? 'CITY LIGHTS  ·  T' : 'CLEAR  ·  T';
    ctx.fillText(effect, x, y + 15 * this.s);
  };

  // ---------------------------------------------------------------- radar --
  HUD.prototype.drawRadar = function (dt) {
    var g = this.game, ctx = this.ctx;
    var p = g.player;
    if (!p) return;
    var R = M.clamp(Math.min(this.w, this.h) * 0.135, 54, 100);
    var pad = 22 * this.s;
    var cx, cy;
    if (this.touchMode) {
      cx = this.sa.left + pad + R;
      cy = this.sa.top + pad + R;
    } else {
      cx = 26 + R;
      cy = this.h - 26 - R;
    }
    var range = p.mode === 'plane' ? 360 : (p.mode === 'heli' ? 260 : (p.mode === 'boat' ? 200 : (p.mode === 'car' ? 165 : 110)));

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, M.TAU);
    ctx.clip();
    var yaw = inCraft(p) ? p.vehicle.yaw : p.yaw;
    ctx.fillStyle = '#10141b';
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    if (this.mapSurface.complete && this.mapSurface.naturalWidth) {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.translate(cx, cy);
      ctx.rotate(yaw - Math.PI / 2);
      ctx.drawImage(this.mapSurface, -R, -R, R * 2, R * 2);
      ctx.restore();
    }

    var s = R / range;
    var L = g.layout;

    function tx(wx, wz, out) {
      var dx = wx - p.pos.x, dz = wz - p.pos.z;
      // World +x is the player's forward direction at yaw 0. Project onto
      // screen-right and screen-up explicitly so the player icon and map
      // agree at every heading. The old matrix inverted both axes.
      out[0] = cx + (-dx * Math.sin(yaw) + dz * Math.cos(yaw)) * s;
      out[1] = cy - ( dx * Math.cos(yaw) + dz * Math.sin(yaw)) * s;
    }
    var a = [0, 0], b = [0, 0];

    // ocean
    ctx.save();
    ctx.fillStyle = '#16324a';
    ctx.beginPath();
    var corners = [[L.beachX - 900, -3000], [L.beachX, -3000], [L.beachX, 3000], [L.beachX - 900, 3000]];
    for (var ci = 0; ci < 4; ci++) {
      tx(corners[ci][0], corners[ci][1], a);
      if (ci === 0) ctx.moveTo(a[0], a[1]); else ctx.lineTo(a[0], a[1]);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // parks - blocks are arbitrary polygons now, so draw the outline itself;
    // its bounding box would cover half the surrounding streets
    ctx.fillStyle = '#1d3a24';
    for (var bi = 0; bi < L.blocks.length; bi++) {
      var blk = L.blocks[bi];
      if (blk.kind !== 'park') continue;
      if (M.dist2(blk.cx, blk.cz, p.pos.x, p.pos.z) > (range + 90) * (range + 90)) continue;
      var poly = blk.kerbPoly || blk.poly;
      ctx.beginPath();
      for (var pv = 0; pv < poly.length; pv++) {
        tx(poly[pv].x, poly[pv].z, a);
        if (pv === 0) ctx.moveTo(a[0], a[1]); else ctx.lineTo(a[0], a[1]);
      }
      ctx.closePath(); ctx.fill();
    }

    // roads
    ctx.strokeStyle = '#39414d';
    ctx.lineCap = 'round';
    for (var ei = 0; ei < L.edges.length; ei++) {
      var e = L.edges[ei];
      var n0 = L.nodes[e.a], n1 = L.nodes[e.b];
      if (M.dist2((n0.x + n1.x) / 2, (n0.z + n1.z) / 2, p.pos.x, p.pos.z) >
        (range + 110) * (range + 110)) continue;
      ctx.lineWidth = Math.max(1.4, e.width * s);
      tx(n0.x, n0.z, a); tx(n1.x, n1.z, b);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }

    // One bright route spine replaces the old cloud of dots.
    // Keep the radar's route renderer as a local helper call. This avoids a
    // fragile instance-property lookup if another HUD overlay or an older
    // saved page has attached a non-function `drawRoute` value to the HUD.
    drawRoute(this, ctx, tx, cx, cy, R, 1.9, 'rgba(255,205,87,0.95)');

    // Only objectives and major authored places survive at radar scale.
    if (g.missions) {
      for (var i = 0; i < g.missions.blips.length; i++) {
        var bl = g.missions.blips[i];
        if (bl.kind !== 'mission' && bl.kind !== 'objective' && bl.kind !== 'side') continue;
        this.blip(ctx, tx, a, bl.x, bl.z, bl.color, bl.small ? 3 : 5, cx, cy, R);
      }
    }
    var places = this.mapPlaces();
    for (i = 0; i < places.length; i++) {
      if (places[i].id === 'mission' && g.missions && g.missions.active) continue;
      this.drawRadarPlace(ctx, tx, a, places[i], cx, cy, R);
    }
    // Police becomes a single alert state rather than a swarm of blue noise.
    if (g.police && g.police.stars > 0 && !g.police.seen) {
      tx(g.police.lastSeenX, g.police.lastSeenZ, a);
      var rr = (18 + g.police.searchTimer * 5) * s;
      ctx.strokeStyle = 'rgba(61,125,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(a[0], a[1], rr, 0, M.TAU); ctx.stroke();
    }
    ctx.restore();

    // player arrow
    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowColor = 'rgba(242,193,78,0.9)';
    ctx.shadowBlur = 9;
    ctx.fillStyle = '#fff8dc';
    ctx.beginPath();
    ctx.moveTo(0, -10); ctx.lineTo(6, 7); ctx.lineTo(0, 4); ctx.lineTo(-6, 7);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    // bezel
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, M.TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(cx, cy, R + 3, 0, M.TAU); ctx.stroke();

    // compass north
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(yaw - Math.PI / 2);
    ctx.fillStyle = GOLD;
    ctx.font = this.font(700, 13);
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, -R + 12);
    ctx.restore();
    this.drawNavigationCard(cx, cy, R);
  };

  function drawRoute(hud, ctx, tx, cx, cy, R, width, color) {
    var points = hud.navigation && hud.navigation.points;
    if (!points || points.length < 2) return;
    var a = [0, 0];
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(5,8,12,0.72)'; ctx.lineWidth = width + 4;
    tx(points[0].x, points[0].z, a);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]);
    for (var i = 1; i < points.length; i++) { tx(points[i].x, points[i].z, a); ctx.lineTo(a[0], a[1]); }
    ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = width;
    tx(points[0].x, points[0].z, a);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]);
    for (i = 1; i < points.length; i++) { tx(points[i].x, points[i].z, a); ctx.lineTo(a[0], a[1]); }
    ctx.stroke();
    ctx.restore();
  }

  HUD.prototype.drawRoute = function (ctx, tx, cx, cy, R, width, color) {
    drawRoute(this, ctx, tx, cx, cy, R, width, color);
  };

  HUD.prototype.drawRadarPlace = function (ctx, tx, a, place, cx, cy, R) {
    tx(place.x, place.z, a);
    var dx = a[0] - cx, dy = a[1] - cy, d = Math.hypot(dx, dy);
    var size = place.id === (this.destination && this.destination.id) ? 7 : 4;
    if (d > R - size - 2) {
      var k = (R - size - 2) / (d || 1);
      a[0] = cx + dx * k; a[1] = cy + dy * k;
    }
    ctx.save(); ctx.translate(a[0], a[1]);
    ctx.fillStyle = colorHex(place.color); ctx.strokeStyle = 'rgba(5,8,12,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size, 0); ctx.lineTo(0, size); ctx.lineTo(-size, 0); ctx.closePath();
    ctx.fill(); ctx.stroke();
    if (size > 5) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, size + 4, 0, M.TAU); ctx.stroke();
    }
    ctx.restore();
  };

  HUD.prototype.drawNavigationCard = function (cx, cy, R) {
    var ctx = this.ctx, nav = this.navigation, target = this.destination;
    if (!target || !nav.points.length) return;
    var w = Math.min(206 * this.s, this.w - (cx + R + 26));
    if (w < 132) return;
    var x = cx + R + 13, y = cy - R + 2, h = 68 * this.s;
    ctx.save();
    ctx.fillStyle = 'rgba(7,11,17,0.78)'; this.roundRect(ctx, x, y, w, h, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(242,193,78,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'left'; ctx.fillStyle = GOLD; ctx.font = this.font(700, 10); ctx.fillText('NAVIGATION', x + 11, y + 16);
    ctx.fillStyle = INK; ctx.font = this.font(700, 16); ctx.fillText(nav.turn, x + 11, y + 37);
    ctx.fillStyle = DIM; ctx.font = this.font(600, 11);
    var targetName = target.name.toUpperCase();
    var distance = '  ·  ' + Math.max(0, Math.round(nav.remaining)) + 'M';
    while (targetName.length > 8 && ctx.measureText(targetName + distance).width > w - 22) targetName = targetName.slice(0, -1);
    ctx.fillText(targetName + distance, x + 11, y + 55);
    ctx.restore();
  };

  HUD.prototype.blip = function (ctx, tx, a, x, z, color, size, cx, cy, R) {
    tx(x, z, a);
    var dx = a[0] - cx, dy = a[1] - cy;
    var d = Math.hypot(dx, dy);
    var edge = false;
    if (d > R - size) {
      // clamp to the rim so off-radar objectives still point the way
      var k = (R - size - 1) / d;
      a[0] = cx + dx * k; a[1] = cy + dy * k;
      edge = true;
    }
    ctx.fillStyle = '#' + ('000000' + color.toString(16)).slice(-6);
    ctx.beginPath();
    ctx.arc(a[0], a[1], size, 0, M.TAU);
    ctx.fill();
    if (edge) {
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };

  // --------------------------------------------------------------- vitals --
  HUD.prototype.drawVitals = function () {
    var g = this.game, ctx = this.ctx, p = g.player;
    if (!p) return;
    var x = this.w - 24 - this.sa.right;
    var y = 30 * this.s + this.utilH + this.sa.top;

    // money
    ctx.textAlign = 'right';
    ctx.font = this.font(700, 32);
    ctx.fillStyle = '#8fe08f';
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 6;
    ctx.fillText(SB.formatMoney(p.money), x, y);
    ctx.shadowBlur = 0;

    // stars
    if (g.police && g.police.stars > 0) {
      y += 26;
      ctx.save();
      for (var i = 0; i < 5; i++) {
        var on = i < g.police.stars;
        var blink = (!g.police.seen && on) ? (0.45 + Math.sin(performance.now() / 180) * 0.35) : 1;
        ctx.globalAlpha = on ? blink : 0.16;
        this.star(ctx, x - 14 * this.s - i * 26 * this.s, y, 10 * this.s, on ? GOLD : '#ffffff');
      }
      ctx.restore();
      y += 16;
    }

    // health / armour bars
    y += 18;
    var bw = 176 * this.s, bh = 9 * this.s;
    this.bar(ctx, x - bw, y, bw, bh, p.health / p.maxHealth,
      p.health > 30 ? '#5fd67a' : '#e0553f', 'rgba(0,0,0,0.45)');
    if (p.armor > 0) {
      y += bh + 5;
      this.bar(ctx, x - bw, y, bw, bh, p.armor / 100, '#6fb6e8', 'rgba(0,0,0,0.45)');
    }
    if (p.stamina < 0.999) {
      y += bh + 5;
      this.bar(ctx, x - bw, y, bw, 4, p.stamina, 'rgba(242,193,78,0.85)', 'rgba(0,0,0,0.35)');
    }

    // clock
    y += 26;
    ctx.font = this.font(600, 15);
    ctx.fillStyle = DIM;
    var hr = Math.floor(g.sky.hour), mi = Math.floor((g.sky.hour % 1) * 60);
    ctx.fillText((hr < 10 ? '0' : '') + hr + ':' + (mi < 10 ? '0' : '') + mi, x, y);
  };

  HUD.prototype.bar = function (ctx, x, y, w, h, frac, fill, back) {
    ctx.fillStyle = back;
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w * M.clamp(frac, 0, 1), h);
  };

  HUD.prototype.star = function (ctx, cx, cy, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var ang = -Math.PI / 2 + i * Math.PI / 5;
      var rad = i % 2 === 0 ? r : r * 0.45;
      var px = cx + Math.cos(ang) * rad, py = cy + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  };

  // --------------------------------------------------------------- weapon --
  HUD.prototype.drawWeapon = function () {
    var g = this.game, ctx = this.ctx;
    if (!g.combat || !g.player || g.player.mode !== 'foot') return;
    var w = g.combat.weapon();
    var x, y;
    if (this.touchMode) {
      x = this.w * 0.5 - 116 * this.s;
      y = this.h - this.sa.bottom - 18;
    } else {
      x = this.w - 24;
      y = this.h - 34;
    }
    ctx.textAlign = 'right';
    ctx.font = this.font(600, 16);
    ctx.fillStyle = DIM;
    ctx.fillText(w.name, x, y - 22 * this.s);
    ctx.font = this.font(700, 29);
    ctx.fillStyle = INK;
    if (w.melee) {
      ctx.fillText('--', x, y);
    } else if (g.combat.reloading > 0) {
      ctx.fillStyle = GOLD;
      ctx.fillText('RELOAD', x, y);
    } else {
      ctx.fillText(g.combat.clip[w.id] + ' / ' + g.combat.ammo[w.id], x, y);
    }
  };

  // -------------------------------------------------------------- mission --
  HUD.prototype.drawMission = function (dt) {
    var g = this.game, ctx = this.ctx;
    if (!g.missions) return;
    var ms = g.missions;
    var x = 26, y = 34;
    if (this.touchMode) {
      var R = M.clamp(Math.min(this.w, this.h) * 0.135, 54, 100);
      x = this.sa.left + 22 * this.s;
      y = this.sa.top + 22 * this.s + R * 2 + 26 * this.s;
    }

    if (ms.active) {
      ctx.textAlign = 'left';
      ctx.font = this.font(700, 15);
      ctx.fillStyle = GOLD;
      ctx.fillText(ms.active.name.toUpperCase(), x, y);
      var text = ms.stageText();
      if (text) {
        ctx.font = this.font(600, 21);
        ctx.fillStyle = INK;
        ctx.shadowColor = 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = 5;
        ctx.fillText(text, x, y + 24);
        ctx.shadowBlur = 0;
      }
      if (ms.active.time) {
        ctx.font = this.font(700, 26);
        ctx.fillStyle = ms.timer < 15 ? '#e0553f' : INK;
        ctx.fillText(SB.formatTime(ms.timer), x, y + 52);
      }
    } else if (ms.resultTimer <= 0) {
      var m = ms.current();
      ctx.textAlign = 'left';
      ctx.font = this.font(600, 15);
      ctx.fillStyle = DIM;
      if (m) {
        ctx.fillText('NEXT JOB - ' + m.name.toUpperCase(), x, y);
        ctx.fillText('Head to the yellow marker', x, y + 18);
      } else {
        ctx.fillText('ALL JOBS DONE - THE CITY IS YOURS', x, y);
      }
    }

    if (ms.resultTimer > 0 && ms.result) {
      var alpha = M.clamp(ms.resultTimer / 0.8, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.textAlign = 'left';
      ctx.font = this.font(700, 18);
      ctx.fillStyle = ms.result.ok ? '#8fe08f' : '#e0553f';
      var label = ms.result.ok
        ? (ms.result.minor ? ms.result.name : 'MISSION PASSED')
        : 'MISSION FAILED';
      ctx.fillText(label, x, y + (ms.active ? 78 : 44));
      if (ms.result.ok && ms.result.reward) {
        ctx.fillStyle = '#8fe08f';
        ctx.font = this.font(700, 25);
        ctx.fillText('+' + SB.formatMoney(ms.result.reward), x, y + (ms.active ? 102 : 68));
      } else if (!ms.result.ok) {
        ctx.fillStyle = DIM;
        ctx.font = this.font(600, 16);
        ctx.fillText(ms.result.why, x, y + 68);
      }
      ctx.globalAlpha = 1;
    }
  };

  // --------------------------------------------------------------- prompt --
  HUD.prototype.drawPrompt = function () {
    var g = this.game, ctx = this.ctx;
    var p = g.player;
    if (!p || p.dead) return;
    var text = null, key = null;
    if (g.interiors && g.interiors.prompt) {
      text = g.interiors.prompt.text; key = g.interiors.prompt.key;
    } else if (g.rooftops && g.rooftops.prompt) {
      text = g.rooftops.prompt; key = 'E';
    } else if (p.boatInteriorPrompt) {
      text = p.boatInteriorPrompt.text; key = p.boatInteriorPrompt.key;
    } else if (p.mode === 'foot' && p.nearVehicle) {
      text = 'Enter ' + p.nearVehicle.name; key = 'F';
    } else if (inCraft(p)) {
      text = null;
    }
    if (!text) return;
    ctx.textAlign = 'center';
    ctx.font = this.font(600, 18);
    var y = this.h * (this.touchMode ? 0.63 : 0.72);
    var label = text;
    var wpx = ctx.measureText(label).width + 74;
    ctx.fillStyle = 'rgba(10,13,18,0.78)';
    this.roundRect(ctx, this.w / 2 - wpx / 2, y - 20, wpx, 34, 5);
    ctx.fill();
    ctx.fillStyle = GOLD;
    ctx.font = this.font(700, 17);
    ctx.fillText('[' + key + ']', this.w / 2 - wpx / 2 + 26, y + 3);
    ctx.fillStyle = INK;
    ctx.font = this.font(600, 18);
    ctx.textAlign = 'left';
    ctx.fillText(label, this.w / 2 - wpx / 2 + 48, y + 3);
  };

  // ------------------------------------------------------------- speedo ----
  HUD.prototype.drawSpeedo = function () {
    var g = this.game, ctx = this.ctx;
    var v = g.player.vehicle;
    if (!v) return;
    var R = 62 * this.s;
    var cx, cy;
    if (this.touchMode) {
      cx = this.w * 0.5;
      cy = this.h - this.sa.bottom - R - 18;
    } else {
      cx = this.w - 108;
      cy = this.h - 96;
    }
    var kph = v.speedKph();
    var topMps = v.spec.topHint || v.spec.topSpeed || v.spec.maxSpeed || 45;
    var top = topMps * 3.6;

    ctx.save();
    ctx.lineCap = 'round';
    // arc track
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 7 * this.s;
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI * 0.78, Math.PI * 2.22);
    ctx.stroke();
    // speed
    var frac = M.clamp(kph / top, 0, 1.08);
    var grad = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
    grad.addColorStop(0, '#6fd0ff');
    grad.addColorStop(0.6, '#f2c14e');
    grad.addColorStop(1, '#e0553f');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 7 * this.s;
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI * 0.78, Math.PI * 0.78 + (Math.PI * 1.44) * frac);
    ctx.stroke();

    // rev bar
    var rev = M.clamp(v.rpm / (v.spec.redline || 6000), 0, 1.05);
    ctx.strokeStyle = rev > 0.92 ? '#e0553f' : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 3 * this.s;
    ctx.beginPath();
    ctx.arc(cx, cy, R - 9 * this.s, Math.PI * 0.78, Math.PI * 0.78 + (Math.PI * 1.44) * rev);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = INK;
    ctx.font = this.font(700, 36);
    ctx.fillText(Math.round(kph), cx, cy + 6 * this.s);
    ctx.font = this.font(600, 13);
    ctx.fillStyle = DIM;
    ctx.fillText('KM/H', cx, cy + 22 * this.s);
    ctx.font = this.font(700, 16);
    ctx.fillStyle = GOLD;
    var status;
    if (v.craftType === 'plane') status = v.grounded ? 'TAXI' : 'FLIGHT';
    else if (v.craftType === 'heli') status = 'ALT ' + Math.max(0, Math.round(v.altitude || 0)) + 'M';
    else if (v.craftType === 'boat') status = v.reverse ? 'REV' : 'MARINE';
    else status = v.reverse ? 'R' : v.gear;
    ctx.fillText(status, cx, cy + 42 * this.s);

    if (v.craftType === 'car' && v.ability) {
      var ready = v.abilityCooldown <= 0 && !v.destroyed;
      ctx.font = this.font(700, 11);
      ctx.fillStyle = ready ? '#5de2dc' : 'rgba(244,241,234,0.45)';
      ctx.fillText(ready ? (v.abilityLabel + '  [V]') : 'ABILITY RECHARGING', cx, cy + 57 * this.s);
    }

    // damage
    if (v.health < v.maxHealth) {
      this.bar(ctx, cx - 44 * this.s, cy + 52 * this.s, 88 * this.s, 5 * this.s, v.health / v.maxHealth,
        v.health > v.maxHealth * 0.3 ? '#c9a227' : '#e0553f', 'rgba(0,0,0,0.4)');
    }
    ctx.restore();
  };

  // ----------------------------------------------------------- crosshair ---
  HUD.prototype.drawCrosshair = function () {
    var g = this.game, ctx = this.ctx;
    var p = g.player;
    if (!p || p.mode !== 'foot' || p.dead) return;
    if (!g.combat) return;
    var w = g.combat.weapon();
    if (w.melee) return;
    var cx = this.w / 2, cy = this.h / 2;
    var spread = g.combat.currentSpread();
    var r = 6 + spread * 900;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    for (var i = 0; i < 4; i++) {
      var ang = i * Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
      ctx.lineTo(cx + Math.cos(ang) * (r + 7), cy + Math.sin(ang) * (r + 7));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
  };

  // -------------------------------------------------------------- toasts ---
  HUD.prototype.drawToasts = function (dt) {
    var ctx = this.ctx;
    var y = this.h * 0.30;
    ctx.textAlign = 'center';
    for (var i = this.toasts.length - 1; i >= 0; i--) {
      var t = this.toasts[i];
      t.life -= dt;
      if (t.life <= 0) { this.toasts.splice(i, 1); continue; }
      ctx.globalAlpha = M.clamp(t.life, 0, 1);
      ctx.font = this.font(600, 18);
      ctx.fillStyle = 'rgba(8,10,14,0.75)';
      var w = ctx.measureText(t.text).width + 30;
      this.roundRect(ctx, this.w / 2 - w / 2, y - 17, w, 28, 4);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.fillText(t.text, this.w / 2, y + 3);
      y -= 34;
      ctx.globalAlpha = 1;
    }
  };

  HUD.prototype.drawTitle = function () {
    if (this.titleT <= 0 || !this.title) return;
    var ctx = this.ctx;
    var t = this.titleT;
    var a = M.clamp(t > 3.6 ? (4.2 - t) / 0.6 : Math.min(1, t / 0.9), 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    var cy = this.h * 0.34;
    ctx.font = this.font(400, 52, DISPLAY);
    ctx.fillStyle = INK;
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 18;
    ctx.fillText(this.title.main, this.w / 2, cy);
    if (this.title.sub) {
      ctx.font = this.font(500, 19);
      ctx.fillStyle = 'rgba(244,241,234,0.75)';
      wrapText(ctx, this.title.sub, this.w / 2, cy + 34, Math.min(680, this.w * 0.8), 22);
    }
    ctx.restore();
  };

  function wrapText(ctx, text, cx, y, maxW, lh) {
    var words = text.split(' ');
    var line = '';
    var lines = [];
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = words[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    for (i = 0; i < lines.length; i++) ctx.fillText(lines[i], cx, y + i * lh);
  }

  // ------------------------------------------------------------- big map ---
  HUD.prototype.drawBigMap = function () {
    var g = this.game, ctx = this.ctx;
    var L = g.layout, p = g.player;
    ctx.fillStyle = 'rgba(5,8,13,0.96)';
    ctx.fillRect(0, 0, this.w, this.h);

    var pad = Math.max(42, 58 * this.s);
    var mapBounds = L.playBounds || {
      minX: L.bounds.minX - 220, maxX: L.bounds.maxX + 60,
      minZ: L.bounds.minZ - 60, maxZ: L.bounds.maxZ + 60
    };
    var wx0 = mapBounds.minX, wx1 = mapBounds.maxX;
    var wz0 = mapBounds.minZ, wz1 = mapBounds.maxZ;
    var sx = (this.w - pad * 2) / (wx1 - wx0);
    var sz = (this.h - pad * 2) / (wz1 - wz0);
    var s = Math.min(sx, sz);
    var offX = (this.w - (wx1 - wx0) * s) / 2;
    var offZ = (this.h - (wz1 - wz0) * s) / 2;
    function T(x, z, out) { out[0] = offX + (x - wx0) * s; out[1] = offZ + (z - wz0) * s; }
    var a = [0, 0], b = [0, 0];
    this.bigMapFrame = { wx0: wx0, wx1: wx1, wz0: wz0, wz1: wz1, s: s, offX: offX, offZ: offZ, places: [] };

    // Generated texture gives the map a real cartographic surface; geometry
    // below it remains the source of truth for this game's streets.
    ctx.fillStyle = '#111a25'; ctx.fillRect(offX, offZ, (wx1 - wx0) * s, (wz1 - wz0) * s);
    if (this.mapSurface.complete && this.mapSurface.naturalWidth) {
      ctx.save(); ctx.globalAlpha = 0.20;
      ctx.drawImage(this.mapSurface, offX, offZ, (wx1 - wx0) * s, (wz1 - wz0) * s);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(6,18,29,0.46)';
    T(wx0, wz0, a); T(L.beachX, wz1, b);
    ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    ctx.fillStyle = 'rgba(192,143,74,0.24)';
    T(L.beachX, wz0, a); T(L.beachX + 34, wz1, b);
    ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);

    var i;
    // District masses make the city legible without painting individual
    // doors, cars, pedestrians, or simulated entities.
    for (i = 0; i < L.blocks.length; i++) {
      var blk = L.blocks[i];
      var poly = blk.kerbPoly || blk.poly;
      ctx.fillStyle = blk.kind === 'park' ? 'rgba(74,150,104,0.42)' : 'rgba(146,160,178,0.26)';
      ctx.beginPath();
      for (var pv = 0; pv < poly.length; pv++) {
        T(poly[pv].x, poly[pv].z, a);
        if (pv === 0) ctx.moveTo(a[0], a[1]); else ctx.lineTo(a[0], a[1]);
      }
      ctx.closePath(); ctx.fill();
    }

    // Main road network, with avenues brighter than local streets.
    for (i = 0; i < L.edges.length; i++) {
      var e = L.edges[i];
      var n0 = L.nodes[e.a], n1 = L.nodes[e.b];
      ctx.strokeStyle = e.avenue ? 'rgba(229,191,105,0.34)' : 'rgba(178,191,190,0.18)';
      ctx.lineWidth = Math.max(e.avenue ? 1.8 : 0.75, e.width * s * (e.avenue ? 0.28 : 0.14));
      T(n0.x, n0.z, a); T(n1.x, n1.z, b);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }

    // The freeway and the railway are how you actually cross this city, so
    // they get their own weight on the map rather than blending into the
    // street network.
    ctx.lineCap = 'round';
    for (i = 0; i < L.edges.length; i++) {
      var fe = L.edges[i];
      if (!fe.elevated) continue;
      var f0 = L.nodes[fe.a], f1 = L.nodes[fe.b];
      ctx.strokeStyle = fe.kind === 'freeway' ? 'rgba(255,158,64,0.95)' : 'rgba(255,158,64,0.55)';
      ctx.lineWidth = fe.kind === 'freeway' ? 3.8 : 2.0;
      T(f0.x, f0.z, a); T(f1.x, f1.z, b);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    if (L.rail) {
      ctx.strokeStyle = 'rgba(150,205,232,0.75)';
      ctx.lineWidth = 1.9;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      var rp = L.rail.pts;
      for (i = 0; i < rp.length; i++) {
        T(rp[i].x, rp[i].z, a);
        if (i === 0) ctx.moveTo(a[0], a[1]); else ctx.lineTo(a[0], a[1]);
      }
      ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(190,225,245,0.95)';
      for (i = 0; i < L.rail.stations.length; i++) {
        T(L.rail.stations[i].x, L.rail.stations[i].z, a);
        ctx.beginPath(); ctx.arc(a[0], a[1], 3.0, 0, Math.PI * 2); ctx.fill();
      }
    }

    this.drawRoute(ctx, T, 0, 0, 0, 4.0, 'rgba(255,210,92,0.96)');

    // Major destinations only. Each marker doubles as a hit target on the
    // open map, so route selection is direct and discoverable.
    var places = this.mapPlaces();
    ctx.textAlign = 'left';
    for (i = 0; i < places.length; i++) {
      var place = places[i];
      T(place.x, place.z, a);
      var selected = this.destination && this.destination.id === place.id;
      ctx.save(); ctx.translate(a[0], a[1]);
      ctx.fillStyle = colorHex(place.color); ctx.strokeStyle = selected ? '#fff8dc' : 'rgba(5,8,12,0.9)';
      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(9, 0); ctx.lineTo(0, 9); ctx.lineTo(-9, 0); ctx.closePath();
      ctx.fill(); ctx.stroke();
      if (selected) { ctx.strokeStyle = 'rgba(255,220,100,0.55)'; ctx.beginPath(); ctx.arc(0, 0, 16, 0, M.TAU); ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle = selected ? '#fff8dc' : 'rgba(244,241,234,0.74)';
      ctx.font = this.font(selected ? 700 : 600, selected ? 13 : 11);
      ctx.fillText(place.name.toUpperCase(), a[0] + 13, a[1] + 4);
      this.bigMapFrame.places.push({ x: a[0], y: a[1], r: 22, place: place });
    }

    // player
    T(p.pos.x, p.pos.z, a);
    ctx.save();
    ctx.translate(a[0], a[1]);
    ctx.rotate((inCraft(p) ? p.vehicle.yaw : p.yaw) + Math.PI / 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(255,255,255,0.8)'; ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();

    // Map chrome: title, legend, selected destination and the action hint.
    ctx.fillStyle = 'rgba(5,8,13,0.88)';
    ctx.fillRect(0, 0, this.w, Math.max(54, 62 * this.s));
    ctx.textAlign = 'left'; ctx.fillStyle = GOLD; ctx.font = this.font(700, 12);
    ctx.fillText('SUNSET BAY / NAVIGATION', 24, 24 * this.s + this.sa.top);
    ctx.fillStyle = INK; ctx.font = this.font(700, 23, DISPLAY);
    ctx.fillText(this.destination ? this.destination.name.toUpperCase() : 'CHOOSE A DESTINATION', 24, 50 * this.s + this.sa.top);
    ctx.textAlign = 'right'; ctx.fillStyle = DIM; ctx.font = this.font(600, 12);
    ctx.fillText(this.touchMode ? 'TAP A LANDMARK OR THE MAP TO ROUTE  ·  MAP TO CLOSE' : 'CLICK A LANDMARK OR THE MAP TO ROUTE  ·  M TO CLOSE',
      this.w - 24, 32 * this.s + this.sa.top);
    if (this.destination && this.navigation.points.length) {
      ctx.fillStyle = GOLD; ctx.font = this.font(700, 13);
      ctx.fillText(this.navigation.turn + '  ·  ' + Math.round(this.navigation.remaining) + 'M', this.w - 24, 51 * this.s + this.sa.top);
    }
    ctx.textAlign = 'center'; ctx.fillStyle = DIM; ctx.font = this.font(600, 13);
    ctx.fillText('ROUTE LINE = YOUR NEXT TURN  ·  COLOURED DIAMONDS = MAIN CITY PLACES', this.w / 2, this.h - 22 - this.sa.bottom);
  };

  HUD.prototype.mapTap = function (px, py) {
    if (!this.mapOpen || !this.bigMapFrame) return false;
    var hit = this.bigMapFrame.places || [];
    for (var i = 0; i < hit.length; i++) {
      if (Math.hypot(px - hit[i].x, py - hit[i].y) <= hit[i].r) {
        this.setDestination(hit[i].place);
        return true;
      }
    }
    var f = this.bigMapFrame;
    var wx = f.wx0 + (px - f.offX) / f.s;
    var wz = f.wz0 + (py - f.offZ) / f.s;
    if (wx >= f.wx0 && wx <= f.wx1 && wz >= f.wz0 && wz <= f.wz1) {
      this.setDestination({ id: 'custom', name: 'Dropped waypoint', x: wx, z: wz, color: 0xffd34d, icon: '•', kind: 'waypoint' });
      return true;
    }
    return false;
  };

  // ---------------------------------------------------------------- shop ---
  var SHOP_MENUS = {
    store: [
      { name: 'Snack', price: 12, act: 'health', amount: 25 },
      { name: 'Six-pack of water', price: 30, act: 'health', amount: 55 },
      { name: 'Body armour', price: 600, act: 'armor', amount: 100 }
    ],
    gunshop: [
      { name: 'M9 Pistol', price: 450, act: 'weapon', id: 'pistol', ammo: 45 },
      { name: 'Vector SMG', price: 1800, act: 'weapon', id: 'smg', ammo: 90 },
      { name: 'Coastguard 12g', price: 2600, act: 'weapon', id: 'shotgun', ammo: 24 },
      { name: 'AR Carbine', price: 5200, act: 'weapon', id: 'rifle', ammo: 90 },
      { name: 'Ammo for current gun', price: 240, act: 'ammo' },
      { name: 'Body armour', price: 600, act: 'armor', amount: 100 }
    ],
    diner: [
      { name: 'Coffee', price: 6, act: 'health', amount: 12 },
      { name: 'Crab roll', price: 18, act: 'health', amount: 45 },
      { name: 'The full plate', price: 42, act: 'health', amount: 100 }
    ],
    club: [
      { name: 'Drink', price: 20, act: 'health', amount: 15 },
      { name: 'Bottle service', price: 400, act: 'health', amount: 100 }
    ],
    safehouse: [
      { name: 'Sleep until morning', price: 0, act: 'sleep', hour: 7.5 },
      { name: 'Sleep until night', price: 0, act: 'sleep', hour: 21.0 },
      { name: 'Patch yourself up', price: 0, act: 'health', amount: 100 }
    ],
    warehouse: [
      { name: 'Nothing here right now', price: 0, act: 'none' }
    ],
    hotel: [
      { name: 'Room for the night', price: 120, act: 'sleep', hour: 7.5 },
      { name: 'Penthouse breakfast', price: 35, act: 'health', amount: 100 }
    ],
    office: [
      { name: 'Review a contract', price: 0, act: 'none' }
    ],
    clinic: [
      { name: 'Full medical check', price: 140, act: 'health', amount: 100 },
      { name: 'Trauma armour fitting', price: 850, act: 'armor', amount: 100 }
    ]
  };

  HUD.prototype.openShop = function (room) {
    this.shop = { room: room, items: SHOP_MENUS[room.service] || [] };
    this.shopIndex = 0;
    this.game.uiBlocking = true;
  };

  HUD.prototype.closeShop = function () {
    this.shop = null;
    this.game.uiBlocking = false;
  };

  HUD.prototype.shopKey = function (e) {
    var s = this.shop;
    if (!s) return;
    if (e.code === 'Escape' || e.code === 'KeyE' || e.code === 'KeyF') {
      e.preventDefault();
      this.closeShop();
      return;
    }
    if (e.code === 'KeyW' || e.code === 'ArrowUp') {
      this.shopIndex = (this.shopIndex - 1 + s.items.length) % s.items.length;
      e.preventDefault();
    } else if (e.code === 'KeyS' || e.code === 'ArrowDown') {
      this.shopIndex = (this.shopIndex + 1) % s.items.length;
      e.preventDefault();
    } else if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      this.buy(s.items[this.shopIndex]);
    }
  };

  HUD.prototype.buy = function (item) {
    var g = this.game, p = g.player;
    if (!item || item.act === 'none') return;
    if (p.money < item.price) { this.toast('Not enough money'); return; }
    var done = false;
    if (item.act === 'health') {
      if (p.health >= p.maxHealth) { this.toast('You are already fine'); return; }
      p.heal(item.amount); done = true;
    } else if (item.act === 'armor') {
      if (p.armor >= 100) { this.toast('Already armoured'); return; }
      p.armor = 100; done = true;
    } else if (item.act === 'weapon') {
      g.combat.give(item.id, item.ammo); done = true;
    } else if (item.act === 'ammo') {
      var w = g.combat.weapon();
      if (w.melee) { this.toast('Pick a gun first'); return; }
      g.combat.give(w.id, w.clip * 3); done = true;
    } else if (item.act === 'sleep') {
      g.sky.setHour(item.hour);
      p.heal(100);
      this.toast('Rested');
      done = true;
    }
    if (done) {
      p.money -= item.price;
      if (g.audio) g.audio.blip('cash');
    }
  };

  HUD.prototype.drawShop = function () {
    var ctx = this.ctx, s = this.shop;
    var w = Math.min(420 * this.s, this.w - 40), rowH = 40 * this.s;
    var h = Math.min(96 * this.s + s.items.length * rowH, this.h - 24);
    var x = this.w / 2 - w / 2, y = this.h / 2 - h / 2;
    this.shopPanel = { x: x, y: y, w: w, h: h };
    this.shopRects = [];

    ctx.fillStyle = 'rgba(4,6,10,0.72)';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = 'rgba(14,18,25,0.97)';
    this.roundRect(ctx, x, y, w, h, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = GOLD;
    ctx.font = this.font(700, 15);
    ctx.fillText(s.room.name.toUpperCase(), x + 24 * this.s, y + 32 * this.s);
    ctx.fillStyle = DIM;
    ctx.font = this.font(600, 15);
    ctx.textAlign = 'right';
    ctx.fillText(SB.formatMoney(this.game.player.money), x + w - 24 * this.s, y + 32 * this.s);

    for (var i = 0; i < s.items.length; i++) {
      var it = s.items[i];
      var ry = y + 56 * this.s + i * rowH;
      this.shopRects.push({ x: x + 12, y: ry, w: w - 24, h: rowH - 6, index: i });
      var sel = i === this.shopIndex;
      if (sel) {
        ctx.fillStyle = 'rgba(242,193,78,0.14)';
        ctx.fillRect(x + 12, ry, w - 24, rowH - 6);
        ctx.fillStyle = GOLD;
        ctx.fillRect(x + 12, ry, 3, rowH - 6);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = sel ? INK : 'rgba(244,241,234,0.72)';
      ctx.font = this.font(600, 18);
      ctx.fillText(it.name, x + 28 * this.s, ry + 23 * this.s);
      ctx.textAlign = 'right';
      ctx.fillStyle = it.price > this.game.player.money ? '#e0553f' : '#8fe08f';
      ctx.font = this.font(600, 17);
      ctx.fillText(it.price ? SB.formatMoney(it.price) : 'free', x + w - 28 * this.s, ry + 23 * this.s);
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = DIM;
    ctx.font = this.font(600, 14);
    ctx.fillText(this.touchMode
      ? 'Tap an item to buy   -   tap outside to leave'
      : 'W / S to choose   -   Enter to buy   -   E to leave',
      this.w / 2, y + h - 18 * this.s);
  };

  // Which shop row is under a tap? -1 for a tap outside the panel, which the
  // caller treats as "leave".
  HUD.prototype.shopHitTest = function (px, py) {
    if (!this.shop || !this.shopRects) return -1;
    for (var i = 0; i < this.shopRects.length; i++) {
      var r = this.shopRects[i];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r.index;
    }
    return -1;
  };

  HUD.prototype.tapIsInsideShop = function (px, py) {
    var p = this.shopPanel;
    if (!this.shop || !p) return false;
    return px >= p.x && px <= p.x + p.w && py >= p.y && py <= p.y + p.h;
  };

  HUD.prototype.roundRect = function (ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  HUD.prototype.drawFade = function () {
    var g = this.game;
    var a = 0;
    if (g.interiors) a = Math.max(a, g.interiors.fade);
    if (g.player && g.player.dead) a = Math.max(a, M.clamp(1 - g.player.respawnTimer / 2.2, 0, 0.85));
    if (a <= 0.001) return;
    this.ctx.fillStyle = 'rgba(0,0,0,' + a.toFixed(3) + ')';
    this.ctx.fillRect(0, 0, this.w, this.h);
  };

  SB.HUD = HUD;

})(window.SB = window.SB || {});
