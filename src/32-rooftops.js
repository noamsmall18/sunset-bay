// 32-rooftops.js - the tops of the towers, and the lift that gets you there.
//
// A skyline is only scenery until you can stand on it. Every building tall
// enough gets a lift you can call from the street, a roof you can walk out
// onto, and a share of them get a marked helipad with landing lights - so the
// helicopter has somewhere to go and the tallest buildings become destinations
// rather than obstacles.
(function (SB) {
  'use strict';

  var M = SB.M, QB = SB.QB;

  var MIN_LIFT_HEIGHT = 26;     // shorter than this and the stairs would do
  var PAD_MIN_HALF = 5.6;       // a roof narrower than this cannot take a pad

  function Rooftops(game) {
    this.game = game;
    this.scene = game.scene;
    this.world = game.world;
    this.city = game.city;

    this.root = new THREE.Group();
    this.root.name = 'rooftops';
    this.scene.add(this.root);

    this.lifts = [];
    this.pads = [];
    this.prompt = null;
    this.travel = 0;
    this.pending = null;

    this.build();
  }

  Rooftops.prototype.build = function () {
    var rng = M.rng(0x0FF1CE);
    var b, i;
    var padQB = new QB(), markQB = new QB(), gearQB = new QB();
    var lightGeo = new THREE.SphereGeometry(0.16, 6, 5);
    var lightMat = new THREE.MeshBasicMaterial({ color: 0xff4d3d });
    this.lightMat = lightMat;
    var lightPos = [];

    // Rank by height: the pads belong on the towers you can actually pick out
    // of the skyline, not scattered at random.
    var tall = [];
    for (i = 0; i < this.city.buildings.length; i++) {
      b = this.city.buildings[i];
      if (b.lift) tall.push(b);
    }
    tall.sort(function (p, q) { return (q.topY - q.baseY) - (p.topY - p.baseY); });

    var padBudget = Math.min(22, Math.max(6, Math.round(tall.length * 0.10)));
    for (i = 0; i < tall.length; i++) {
      b = tall[i];
      this.lifts.push({
        building: b,
        x: b.lift.x, z: b.lift.z, yaw: b.lift.yaw,
        roofY: b.lift.roofY, baseY: b.lift.baseY,
        // Off to one side of the frontage, not the middle: the building's own
        // entrance is at the centre of that face, and a lift call button on
        // top of a door means E only ever opens the door.
        callX: b.cx + Math.sin(b.yaw) * (b.hd + 1.6) + Math.cos(b.yaw) * (b.hw * 0.66),
        callZ: b.cz - Math.cos(b.yaw) * (b.hd + 1.6) + Math.sin(b.yaw) * (b.hw * 0.66)
      });

      if (this.pads.length < padBudget && b.topHw > PAD_MIN_HALF && b.topHd > PAD_MIN_HALF) {
        this.helipad(padQB, markQB, gearQB, lightPos, b, rng);
      }
    }

    var padMat = new THREE.MeshStandardMaterial({
      map: SB.Tex.asphalt(), color: 0x33383e, roughness: 0.95
    });
    var markMat = new THREE.MeshStandardMaterial({
      color: 0xfff6d8, roughness: 0.55,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
    });
    var gearMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.4 });

    this.add(padQB.mesh(padMat, false, true));
    this.add(markQB.mesh(markMat, false, false));
    this.add(gearQB.mesh(gearMat, true, true));

    if (lightPos.length) {
      var lights = SB.instances(lightGeo, lightMat, lightPos, function (o, p) {
        o.position.set(p.x, p.y, p.z);
      }, false, false);
      if (lights) { lights.name = 'padlights'; this.root.add(lights); this.padLights = lights; }
    }

    // A lift call point needs to be findable, so mark it on the pavement.
    var callQB = new QB();
    for (i = 0; i < this.lifts.length; i++) {
      var lf = this.lifts[i];
      var y = this.world.surfaceAt(lf.callX, lf.callZ, lf.baseY + 6, 8).y;
      callQB.obox(lf.callX, y + 0.02, lf.callZ, 1.1, 1.1, y + 0.05, lf.yaw, 1, 1, 1, { skipSides: true });
    }
    this.add(callQB.mesh(new THREE.MeshStandardMaterial({
      color: 0xf2c14e, roughness: 0.55,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
    }), false, false));
  };

  // A marked pad: deck, circle, H, perimeter lights and a windsock mast.
  Rooftops.prototype.helipad = function (pad, mark, gear, lightPos, b, rng) {
    var r = Math.min(b.topHw, b.topHd) * 0.90;
    var y = b.topY + 0.06;
    var cx = b.cx, cz = b.cz;
    var yaw = b.yaw;
    var SEG = 20, k;

    for (k = 0; k < SEG; k++) {
      var a0 = (k / SEG) * M.TAU, a1 = ((k + 1) / SEG) * M.TAU;
      pad.tri(cx, y, cz,
        cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r,
        cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r,
        0.5, 0.5, 0, 0, 1, 0);
    }

    // circle and H, drawn in the building's own frame so they sit square
    var c = Math.cos(yaw), s = Math.sin(yaw);
    function bar(lx, lz, lw, ld) {
      mark.obox(cx + c * lx - s * lz, y + 0.01, cz + s * lx + c * lz,
        lw, ld, y + 0.04, yaw, 1, 1, 1, { skipSides: true });
    }
    var hs = r * 0.34;
    bar(-hs * 0.72, 0, hs * 0.16, hs);          // left upright
    bar(hs * 0.72, 0, hs * 0.16, hs);           // right upright
    bar(0, 0, hs * 0.72, hs * 0.16);            // crossbar
    // painted ring
    var RS = 28;
    for (k = 0; k < RS; k++) {
      var t0 = (k / RS) * M.TAU, t1 = ((k + 1) / RS) * M.TAU;
      var ri = r * 0.86, ro = r * 0.93;
      mark.quad(
        cx + Math.cos(t0) * ri, y + 0.01, cz + Math.sin(t0) * ri,
        cx + Math.cos(t1) * ri, y + 0.01, cz + Math.sin(t1) * ri,
        cx + Math.cos(t1) * ro, y + 0.01, cz + Math.sin(t1) * ro,
        cx + Math.cos(t0) * ro, y + 0.01, cz + Math.sin(t0) * ro, 0, 0, 1, 1);
    }

    // perimeter lights and a windsock
    for (k = 0; k < 8; k++) {
      var a = (k / 8) * M.TAU;
      lightPos.push({ x: cx + Math.cos(a) * r * 0.97, y: y + 0.22, z: cz + Math.sin(a) * r * 0.97 });
    }
    var mx = cx + c * (r * 0.85), mz = cz + s * (r * 0.85);
    gear.obox(mx, y, mz, 0.11, 0.11, y + 3.0, yaw, 1, 1, 1, {});
    gear.obox(mx + c * 0.7, y + 2.4, mz + s * 0.7, 0.7, 0.22, y + 2.9, yaw, 1, 1, 1, {});

    // the pad itself is walkable and landable
    this.world.addStrip(cx - c * r, cz - s * r, cx + c * r, cz + s * r, r, y, y, 'concrete');

    this.pads.push({ building: b, x: cx, z: cz, y: y, r: r, name: 'Rooftop pad' });
    if (this.game.transport && this.game.transport.helipads) {
      this.game.transport.helipads.push({ x: cx, y: y, z: cz, r: r, rooftop: true });
    }
  };

  Rooftops.prototype.add = function (mesh) {
    if (!mesh.geometry.attributes.position ||
      mesh.geometry.attributes.position.count === 0) return;
    mesh.matrixAutoUpdate = false;
    this.root.add(mesh);
  };

  // ---------------------------------------------------------- the lift ----
  // Call it from the pavement, ride it to the roof, ride it back down. The
  // travel itself is a short fade, because a real lift shaft would be a lot of
  // geometry for a journey nobody wants to spend fifteen seconds inside.
  Rooftops.prototype.nearest = function (p) {
    var best = null, bd = 3.2 * 3.2;
    var i, d;
    for (i = 0; i < this.lifts.length; i++) {
      var lf = this.lifts[i];
      // street call point
      if (Math.abs(p.y - lf.baseY) < 6) {
        d = M.dist2(lf.callX, lf.callZ, p.x, p.z);
        if (d < bd) { bd = d; best = { lift: lf, dir: 'up' }; }
      }
      // the lift head on the roof
      if (Math.abs(p.y - lf.roofY) < 6) {
        d = M.dist2(lf.x, lf.z, p.x, p.z);
        if (d < 4.6 * 4.6 && d < bd + 12) { bd = d; best = { lift: lf, dir: 'down' }; }
      }
    }
    return best;
  };

  Rooftops.prototype.fixed = function (dt) {
    var g = this.game, p = g.player;
    if (!p) return;

    if (this.travel > 0) {
      this.travel -= dt;
      if (this.travel <= 0 && this.pending) {
        var t = this.pending;
        this.pending = null;
        p.pos.set(t.x, t.y, t.z);
        p.vel.set(0, 0, 0);
        if (g.post) g.post.resetHistory();
        g.bus.emit('toast', { text: t.text });
      }
      return;
    }

    this.prompt = null;
    if (p.mode !== 'foot' || p.dead || g.uiBlocking) return;
    if (g.interiors && g.interiors.current) return;
    // standing in a doorway: the door is the nearer intent, leave it alone
    if (g.interiors && g.interiors.prompt) return;

    var hit = this.nearest(p.pos);
    if (!hit) return;
    this.prompt = hit.dir === 'up' ? 'Take the lift to the roof' : 'Take the lift down';

    if (g.input.actHit('interact')) {
      var lf = hit.lift;
      this.travel = 0.55;
      if (hit.dir === 'up') {
        // step out of the lift head onto the roof, not inside it
        var c = Math.cos(lf.yaw), s = Math.sin(lf.yaw);
        this.pending = {
          x: lf.x - (-s) * 4.2, y: lf.roofY + 0.1, z: lf.z - c * 4.2,
          text: 'Roof - ' + Math.round(lf.roofY) + 'm up'
        };
      } else {
        this.pending = { x: lf.callX, y: lf.baseY + 0.1, z: lf.callZ, text: 'Ground floor' };
      }
      if (g.audio) g.audio.blip('door');
    }
  };

  Rooftops.prototype.render = function (dt, lamps) {
    if (this.lightMat) {
      // pad lights pulse, and come up properly after dark
      var t = performance.now() / 1000;
      var k = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.2));
      this.lightMat.color.setRGB(1, 0.30 * k, 0.24 * k);
    }
  };

  SB.Rooftops = Rooftops;

})(window.SB = window.SB || {});
