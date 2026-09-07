// Waterfront expansion. Static scenery is batched; repeated moving objects
// are instanced. All playable decks have matching collision surfaces.
(function (SB) {
  'use strict';
  var M = SB.M;
  function Coast(game) {
    this.game = game;
    this.root = new THREE.Group();
    this.root.name = 'coastal-expansion';
    game.scene.add(this.root);
    this.time = 0;
    this.chunks = [];
    this.landmarks = [];
    this.glows = [];
    this.buildBoardwalk();
    this.buildSkyline();
    this.buildBirds();
  }

  Coast.prototype.buildBoardwalk = function () {
    var g = this.game, world = g.world, shore = g.layout.beachX;
    var x = shore - 100, z = 405, y = 4.8;
    this.center = { x: x, z: z };
    this.boardwalk = new THREE.Group();
    this.root.add(this.boardwalk);
    var deck = new SB.QB(), metal = new SB.QB(), trim = new SB.QB();
    var warm = new SB.QB(), teal = new SB.QB();
    function box(q, cx, cy, cz, w, h, d) {
      q.box(cx - w / 2, cy, cz - d / 2, cx + w / 2, cy + h, cz + d / 2, 3, 3, 3, {});
    }
    // A new pier square and wide approach ramp; nothing replaces the old pier.
    box(deck, x, y - 0.65, z, 150, 0.65, 110);
    world.addPlatform(x - 75, z - 55, x + 75, z + 55, y, 'wood');
    box(deck, shore - 25, y - 0.65, z, 42, 0.65, 18);
    world.addPlatform(shore - 46, z - 9, shore - 4, z + 9, y, 'wood');
    var land = world.baseHeight(shore + 26, z) + 0.12;
    deck.quad(shore - 4, y, z - 9, shore - 4, y, z + 9,
      shore + 26, land, z + 9, shore + 26, land, z - 9, 0, 0, 6, 3);
    world.addRamp(shore - 4, z - 9, shore + 26, z + 9, y, land, 'x', 'wood');
    // Railings have one broad opening facing the approach.
    function rail(cx, cz, w, d) {
      box(metal, cx, y + 0.9, cz, w, 0.13, d);
      box(teal, cx, y + 1.05, cz, w, 0.06, d);
      world.addBox(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, y, y + 1.1, 'wall');
    }
    rail(x - 75, z, 0.25, 110);
    rail(x, z - 55, 150, 0.25); rail(x, z + 55, 150, 0.25);
    rail(x + 75, z - 32, 0.25, 46); rail(x + 75, z + 32, 0.25, 46);
    for (var px = x - 70; px <= x + 70; px += 14) {
      for (var side = -1; side <= 1; side += 2) {
        box(metal, px, -9, z + side * 50, 0.8, y + 9, 0.8);
        box(metal, px, y, z + side * 53, 0.14, 1.1, 0.14);
      }
      // Wood plank seams are one batch, not a material per board.
      for (var plank = 0; plank < 10; plank++) box(trim, px + plank * 1.4, y + 0.012, z, 0.025, 0.01, 108);
    }
    // Food stalls face the pedestrian square, leaving the drive lane clear.
    var colors = [0xf26845, 0x39b8b6, 0xe9b64f, 0x667aca];
    var booths = new SB.QB();
    for (var k = 0; k < 4; k++) {
      var bx = x + 32 - k * 15, bz = z - 37;
      booths.setColor(colors[k]); box(booths, bx, y, bz, 9, 3.4, 7);
      box(deck, bx, y + 2.2, bz + 4.2, 9, 0.18, 2.2);
      box(warm, bx, y + 3.5, bz + 4, 10, 0.14, 0.16);
      world.addBox(bx - 4.5, bz - 3.5, bx + 4.5, bz + 3.5, y, y + 3.4, 'building');
      this.sign(['BAY TACOS', 'SURF SUPPLY', 'GOLDEN SCOOPS', 'NIGHT MARKET'][k], bx, y + 4.2, bz + 3.7, 7, colors[k]);
    }
    this.boardwalk.add(booths.mesh(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.7 }), true, true));
    // Seating and pergolas, merged with the boardwalk trim.
    for (k = 0; k < 6; k++) {
      bx = x + 47; bz = z - 30 + k * 13;
      box(deck, bx, y + 0.55, bz, 3, 0.22, 1.2);
      box(deck, bx + 0.45, y + 0.77, bz, 0.18, 0.8, 1.2);
      box(metal, bx, y, bz - 0.4, 0.15, 0.6, 0.15);
      box(metal, bx, y, bz + 0.4, 0.15, 0.6, 0.15);
    }
    for (k = 0; k < 8; k++) {
      bx = x - 55 + k * 15;
      box(metal, bx, y, z - 12, 0.18, 6, 0.18);
      box(warm, bx, y + 5.8, z - 12, 0.7, 0.18, 0.7);
      if (k < 7) {
        for (var bulb = 0; bulb < 8; bulb++) {
          var u = bulb / 8;
          box(warm, bx + u * 15, y + 6 - Math.sin(u * Math.PI) * 1.3, z - 12, 0.12, 0.16, 0.12);
        }
      }
    }
    this.boardwalk.add(deck.mesh(new THREE.MeshStandardMaterial({ color: 0xb69a70, roughness: 0.8 }), false, true));
    this.boardwalk.add(metal.mesh(new THREE.MeshStandardMaterial({ color: 0x253a46, metalness: 0.65, roughness: 0.36 }), true, true));
    this.boardwalk.add(trim.mesh(new THREE.MeshStandardMaterial({ color: 0x71634f, roughness: 1 }), false, false));
    var goldMat = new THREE.MeshStandardMaterial({ color: 0xffcf81, emissive: 0xffae52, emissiveIntensity: 1.6, roughness: 0.4 });
    var tealMat = new THREE.MeshStandardMaterial({ color: 0x47d5d2, emissive: 0x26bab8, emissiveIntensity: 1.8 });
    this.glows.push(goldMat, tealMat);
    this.boardwalk.add(warm.mesh(goldMat, false, false), teal.mesh(tealMat, false, false));
    this.sign('SUNSET BOARDWALK', shore - 20, y + 6.5, z, 16, 0xffc56e, Math.PI / 2);
    this.buildWheel(x - 29, y, z + 16);
    this.buildLighthouse(x - 60, y, z + 41);
    this.landmarks.push({ id: 'boardwalk', name: 'Sunset Boardwalk', x: shore + 10, z: z,
      color: 0x49d9d0, icon: '◆', kind: 'landmark', priority: 2 });
    this.landmarks.push({ id: 'lighthouse', name: 'Lighthouse lookout', x: this.lookout.entry.x, z: this.lookout.entry.z,
      color: 0xffcb76, icon: '◆', kind: 'landmark', priority: 2 });
  };

  Coast.prototype.sign = function (text, x, y, z, width, color, yaw) {
    var canvas = SB.Tex.canvas(512, 96), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0e2029'; ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.font = 'bold 38px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 49, 488);
    var texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    var material = new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture,
      emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.5, side: THREE.DoubleSide });
    this.glows.push(material);
    var mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width * 96 / 512), material);
    mesh.position.set(x, y, z); mesh.rotation.y = yaw || 0;
    this.boardwalk.add(mesh);
  };

  Coast.prototype.buildWheel = function (x, y, z) {
    var radius = 18;
    var wheel = this.wheel = new THREE.Group();
    wheel.position.set(x, y + radius + 2.6, z); this.boardwalk.add(wheel);
    var mat = new THREE.MeshStandardMaterial({ color: 0xf0d9b4, metalness: 0.55, roughness: 0.3,
      emissive: 0xfaab67, emissiveIntensity: 0.4 });
    this.glows.push(mat);
    for (var s = -1; s <= 1; s += 2) {
      var ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.16, 6, 64), mat);
      ring.position.z = s * 1.25; wheel.add(ring);
    }
    var points = [], supports = new SB.QB();
    for (var i = 0; i < 16; i++) {
      var a = i * M.TAU / 16;
      points.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
    }
    wheel.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0xf4d8a8 })));
    var hub = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 4, 16), mat);
    hub.rotation.x = Math.PI / 2; wheel.add(hub);
    var cabinMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.3 });
    this.cabins = new THREE.InstancedMesh(new THREE.BoxGeometry(2.1, 2.2, 2.6), cabinMat, 16);
    this.cabins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cabins.frustumCulled = false;
    for (i = 0; i < 16; i++) this.cabins.setColorAt(i, new THREE.Color(i % 2 ? 0xf2b661 : 0x45babc));
    this.boardwalk.add(this.cabins);
    this.wheelOrigin = { x: x, y: y + radius + 2.6, z: z };
    for (s = -1; s <= 1; s += 2) {
      supports.box(x - 1, y, z + s * 5 - 0.65, x + 1, y + radius + 2.6, z + s * 5 + 0.65, 1, 1, 1, {});
      this.game.world.addBox(x - 1, z + s * 5 - 0.65, x + 1, z + s * 5 + 0.65, y, y + radius + 2.6, 'prop');
    }
    this.boardwalk.add(supports.mesh(new THREE.MeshStandardMaterial({ color: 0xeeeecc, roughness: 0.6 }), true, true));
    this._dummy = new THREE.Object3D();
  };

  Coast.prototype.buildLighthouse = function (x, y, z) {
    var tower = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 3.8, 25, 20),
      new THREE.MeshStandardMaterial({ color: 0xe5e2d8, roughness: 0.72 }));
    tower.position.set(x, y + 12.5, z); tower.castShadow = true; tower.receiveShadow = true;
    this.boardwalk.add(tower);
    for (var i = 0; i < 3; i++) {
      var band = new THREE.Mesh(new THREE.CylinderGeometry(3.4 - i * 0.25, 3.5 - i * 0.25, 2.5, 20),
        new THREE.MeshStandardMaterial({ color: 0xd25c45, roughness: 0.5 }));
      band.position.set(x, y + 6 + i * 7, z); this.boardwalk.add(band);
    }
    var top = new THREE.Mesh(new THREE.CylinderGeometry(5.3, 5.3, 0.5, 24),
      new THREE.MeshStandardMaterial({ color: 0x233845, metalness: 0.5, roughness: 0.3 }));
    top.position.set(x, y + 25, z); this.boardwalk.add(top);
    var lantern = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 3.5, 12),
      new THREE.MeshStandardMaterial({ color: 0xffdb93, emissive: 0xffcb79, emissiveIntensity: 2 }));
    lantern.position.set(x, y + 27, z); this.boardwalk.add(lantern); this.glows.push(lantern.material);
    var roof = new THREE.Mesh(new THREE.ConeGeometry(3, 2, 16), top.material);
    roof.position.set(x, y + 29.7, z); this.boardwalk.add(roof);
    this.game.world.addBox(x - 2.7, z - 2.7, x + 2.7, z + 2.7, y, y + 28.8, 'building');
    this.game.world.addPlatform(x - 3.8, z - 3.8, x + 3.8, z + 3.8, y + 25.25, 'metal');
    this.lookout = { entry: { x: x + 5.5, y: y, z: z }, top: { x: x + 3.5, y: y + 25.25, z: z }, inside: false };
    this.sign('LOOKOUT LIFT', x + 5.5, y + 2.4, z - 1.8, 4, 0xffc477);
    this.beacon = new THREE.Group(); this.beacon.position.set(x, y + 27, z);
    var beam = new THREE.Mesh(new THREE.ConeGeometry(12, 100, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffdfa0, transparent: true, opacity: 0.035,
        depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    beam.rotation.z = Math.PI / 2; beam.position.x = 50;
    this.beacon.add(beam); this.boardwalk.add(this.beacon);
  };

  Coast.prototype.buildSkyline = function () {
    var groups = Object.create(null), buildings = this.game.city.buildings;
    var colors = [0x38c6d0, 0xffb05a, 0xd970c5];
    for (var i = 0; i < buildings.length; i++) {
      var b = buildings[i];
      if (b.h < 30 || i % 3) continue;
      var gx = Math.floor(b.cx / 240), gz = Math.floor(b.cz / 240), color = i % 7 % 3;
      var key = gx + ':' + gz + ':' + color;
      var group = groups[key] || (groups[key] = { qb: new SB.QB(), x: gx * 240 + 120, z: gz * 240 + 120, color: color });
      var q = group.qb, hw = b.topHw || b.hw, hd = b.topHd || b.hd, yy = b.topY + 0.2;
      // Four narrow roof strips preserve roof access and landing pads.
      function rim(lx, lz, w, d) {
        var c = Math.cos(b.yaw), s = Math.sin(b.yaw);
        q.obox(b.cx + c * lx - s * lz, yy, b.cz + s * lx + c * lz, w, d, yy + 0.16, b.yaw, 1, 1, 1, {});
      }
      rim(0, -hd, hw, 0.09); rim(0, hd, hw, 0.09);
      rim(-hw, 0, 0.09, hd); rim(hw, 0, 0.09, hd);
    }
    this.skyline = new THREE.Group(); this.root.add(this.skyline);
    for (var id in groups) {
      var item = groups[id], material = new THREE.MeshStandardMaterial({ color: colors[item.color],
        emissive: colors[item.color], emissiveIntensity: 1.8, roughness: 0.4 });
      var mesh = item.qb.mesh(material, false, false);
      this.skyline.add(mesh); this.glows.push(material);
      this.chunks.push({ mesh: mesh, x: item.x, z: item.z });
    }
  };

  Coast.prototype.buildBirds = function () {
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0.45, -1.4, 0.1, -0.15, -0.3, 0, -0.3,
      0, 0, 0.45, 0.3, 0, -0.3, 1.4, 0.1, -0.15], 3));
    geometry.computeVertexNormals();
    this.birds = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ color: 0xd9e0df, side: THREE.DoubleSide }), 32);
    this.birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.birds.frustumCulled = false;
    this.root.add(this.birds);
  };

  Coast.prototype.render = function (dt, lamps) {
    this.time += dt;
    var g = this.game, camera = g.camera, low = SB.Q.tier === 'low';
    this.root.visible = !g.worldHidden;
    if (!this.root.visible) return;
    var distance = M.dist2(camera.position.x, camera.position.z, this.center.x, this.center.z);
    this.boardwalk.visible = distance < (low ? 500 * 500 : 1600 * 1600);
    this.skyline.visible = !low && lamps > 0.08;
    for (var i = 0; i < this.chunks.length; i++) {
      var c = this.chunks[i];
      c.mesh.visible = M.dist2(camera.position.x, camera.position.z, c.x, c.z) < (SB.Q.settings.cullDistance + 190) ** 2;
    }
    for (i = 0; i < this.glows.length; i++) this.glows[i].emissiveIntensity = 0.22 + lamps * 1.65;
    this.beacon.visible = !low && lamps > 0.35;
    this.beacon.rotation.y = this.time * 0.18;
    if (this.boardwalk.visible) {
      this.wheel.rotation.z = this.time * 0.065;
      var o = this.wheelOrigin, d = this._dummy;
      for (i = 0; i < 16; i++) {
        var a = i * M.TAU / 16 + this.wheel.rotation.z;
        d.position.set(o.x + Math.cos(a) * 18, o.y + Math.sin(a) * 18 - 0.8, o.z);
        d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix();
        this.cabins.setMatrixAt(i, d.matrix);
      }
      this.cabins.instanceMatrix.needsUpdate = true;
    }
    this.birds.visible = !low && !g.worldHidden && g.sky.rain < 0.5 && lamps < 0.7;
    if (this.birds.visible) {
      for (i = 0; i < 32; i++) {
        var t = this.time * (0.055 + i % 4 * 0.01) + i * 2.399;
        d = this._dummy;
        d.position.set(g.layout.beachX - 80 + Math.cos(t) * (40 + i * 5), 30 + i % 6 * 5 + Math.sin(t * 2) * 2,
          260 + Math.sin(t) * (65 + i * 6));
        d.rotation.set(0, -t, Math.sin(this.time * 3 + i) * 0.18);
        d.scale.setScalar(0.8); d.updateMatrix(); this.birds.setMatrixAt(i, d.matrix);
      }
      this.birds.instanceMatrix.needsUpdate = true;
    }
  };
  SB.Coast = Coast;
})(window.SB = window.SB || {});
