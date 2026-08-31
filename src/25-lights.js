// 25-lights.js - a small pool of real lights that follows the player at night.
//
// The city has hundreds of streetlamps and every one of them cannot be a real
// light. Instead a fixed pool of point lights is created once and reassigned
// each time you move to whichever lamps are nearest, with the far ones still
// covered by the cheap additive pools on the road.
//
// The pool size never changes at runtime. Three rebuilds every shader when the
// number of visible lights changes, so unused lights stay in the scene with
// zero intensity rather than being hidden.
(function (SB) {
  'use strict';

  var M = SB.M;

  function Lights(game) {
    this.game = game;
    this.scene = game.scene;
    this.points = [];
    this.spots = [];
    this.heads = [];
    this.refreshTimer = 0;
    this.enabled = 0;

    var q = SB.Q.settings;
    this.setBudget(q.lights || 0, !!q.headlightSpots);
    this.collectLamps();
  }

  // Precompute the world position of every lamp head once. The head hangs at
  // the end of the arm, out over the carriageway.
  Lights.prototype.collectLamps = function () {
    var city = this.game.city;
    this.heads.length = 0;
    if (!city || !city.props || !city.props.lamps) return;
    var list = city.props.lamps;
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var ax = it.arm[0], az = it.arm[1];
      var len = Math.hypot(ax, az) || 1;
      this.heads.push({
        x: it.x + (ax / len) * 3.55,
        y: 7.72,
        z: it.z + (az / len) * 3.55
      });
    }
  };

  Lights.prototype.setBudget = function (count, headlights) {
    count = count || 0;
    // grow the pool; never shrink it, so the shader light count stays fixed
    while (this.points.length < count) {
      var l = new THREE.PointLight(0xffd39a, 0, 34, 1.7);
      l.castShadow = false;
      this.scene.add(l);
      this.points.push(l);
    }
    for (var i = 0; i < this.points.length; i++) {
      if (i >= count) this.points[i].intensity = 0;
    }
    this.budget = Math.min(count, this.points.length);

    if (headlights && this.spots.length === 0) {
      for (var s = 0; s < 2; s++) {
        var sp = new THREE.SpotLight(0xfff2d4, 0, 55, 0.52, 0.55, 1.4);
        sp.castShadow = false;
        var target = new THREE.Object3D();
        this.scene.add(sp, target);
        sp.target = target;
        this.spots.push({ light: sp, target: target });
      }
    }
    if (!headlights) {
      for (i = 0; i < this.spots.length; i++) this.spots[i].light.intensity = 0;
    }
    this.useSpots = !!headlights;
  };

  Lights.prototype.update = function (dt, lamps) {
    var g = this.game;
    var cam = g.camera;

    // ---- streetlamps
    if (this.budget > 0) {
      this.refreshTimer -= dt;
      if (this.refreshTimer <= 0) {
        this.refreshTimer = 0.25;
        this.assignNearest(cam.position.x, cam.position.z);
      }
      var boost = lamps * lamps;             // stay dark until dusk really lands
      for (var i = 0; i < this.points.length; i++) {
        var l = this.points[i];
        if (i >= this.budget || !l.userData.head) { l.intensity = 0; continue; }
        var h = l.userData.head;
        var d = M.dist(h.x, h.z, cam.position.x, cam.position.z);
        // fade out toward the pool's range so swapping a lamp never pops
        var fade = 1 - M.clamp((d - 34) / 16, 0, 1);
        l.intensity = 26 * boost * fade;
      }
    }

    // ---- headlights
    if (this.useSpots) {
      var p = g.player;
      var v = p && p.vehicle;
      var on = v && !v.destroyed && lamps > 0.06;
      for (var s = 0; s < this.spots.length; s++) {
        var sp = this.spots[s];
        if (!on) { sp.light.intensity = 0; continue; }
        var side = s === 0 ? -1 : 1;
        var ca = Math.cos(v.yaw), sa = Math.sin(v.yaw);
        var lx = v.spec.len * 0.46, lz = side * v.spec.wid * 0.34;
        sp.light.position.set(
          v.pos.x + lx * ca - lz * sa,
          v.pos.y + v.beltY - v.spec.wheelR - 0.18,
          v.pos.z + lx * sa + lz * ca);
        sp.target.position.set(
          v.pos.x + ca * 26 - lz * sa,
          v.pos.y - 1.2,
          v.pos.z + sa * 26 + lz * ca);
        sp.target.updateMatrixWorld();
        sp.light.intensity = 130 * M.clamp(lamps * 1.4, 0, 1);
      }
    }
  };

  // Nearest lamps to the camera, chosen by partial selection rather than a
  // full sort: the pool is tiny and the candidate list is not.
  Lights.prototype.assignNearest = function (x, z) {
    var heads = this.heads;
    if (!heads.length) return;
    var n = this.budget;
    var best = this._best || (this._best = []);
    best.length = 0;
    for (var i = 0; i < heads.length; i++) {
      var h = heads[i];
      var d = M.dist2(h.x, h.z, x, z);
      if (d > 52 * 52) continue;
      if (best.length < n) {
        best.push({ d: d, h: h });
        if (best.length === n) best.sort(function (a, b) { return b.d - a.d; });
      } else if (d < best[0].d) {
        best[0] = { d: d, h: h };
        best.sort(function (a, b) { return b.d - a.d; });
      }
    }
    for (i = 0; i < this.points.length; i++) {
      var l = this.points[i];
      if (i < best.length) {
        l.userData.head = best[i].h;
        l.position.set(best[i].h.x, best[i].h.y, best[i].h.z);
      } else {
        l.userData.head = null;
      }
    }
  };

  SB.Lights = Lights;

})(window.SB = window.SB || {});
