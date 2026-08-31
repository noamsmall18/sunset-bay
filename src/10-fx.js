// 10-fx.js - particles, tyre marks, tracers, explosions and world markers.
// Everything is preallocated into ring buffers: no allocation happens during
// play, which keeps the frame time flat when the city gets busy.
(function (SB) {
  'use strict';

  var M = SB.M;

  var PART_VERT = [
    'attribute float aSize;',
    'attribute float aAlpha;',
    'attribute vec3 aColor;',
    'varying float vAlpha;',
    'varying vec3 vColor;',
    'void main(){',
    '  vAlpha = aAlpha; vColor = aColor;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = aSize * 300.0 / max(-mv.z, 0.1);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var PART_FRAG = [
    'uniform sampler2D uMap;',
    'varying float vAlpha;',
    'varying vec3 vColor;',
    'void main(){',
    '  vec4 t = texture2D(uMap, gl_PointCoord);',
    '  if (t.a * vAlpha < 0.004) discard;',
    '  gl_FragColor = vec4(vColor, t.a * vAlpha);',
    '}'
  ].join('\n');

  function ParticleSet(scene, count, texture, blending) {
    this.count = count;
    this.head = 0;
    var geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.color = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.grow = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.grav = new Float32Array(count);
    for (var i = 0; i < count; i++) { this.pos[i * 3 + 1] = -9999; }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    var mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture } },
      vertexShader: PART_VERT,
      fragmentShader: PART_FRAG,
      transparent: true,
      depthWrite: false,
      blending: blending
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.geo = geo;
    scene.add(this.points);
    this._c = new THREE.Color();
  }

  ParticleSet.prototype.emit = function (x, y, z, vx, vy, vz, size, grow, life, color, alpha, drag, grav) {
    var i = this.head;
    this.head = (this.head + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.size[i] = size;
    this.grow[i] = grow;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.alpha[i] = alpha === undefined ? 1 : alpha;
    this.drag[i] = drag === undefined ? 1.2 : drag;
    this.grav[i] = grav === undefined ? 0 : grav;
    this._c.set(color);
    this.color[i * 3] = this._c.r; this.color[i * 3 + 1] = this._c.g; this.color[i * 3 + 2] = this._c.b;
    this.dirty = true;
  };

  ParticleSet.prototype.update = function (dt) {
    var any = false;
    for (var i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      var t = this.life[i] / this.maxLife[i];
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.pos[i * 3 + 1] = -9999;
        continue;
      }
      var d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = M.clamp(t < 0.25 ? t / 0.25 : 1, 0, 1) * (this.baseAlpha || 1) * M.clamp(t * 1.4, 0, 1);
    }
    if (any || this.dirty) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.dirty = false;
    }
  };

  // --------------------------------------------------------- tyre marks ----
  function SkidMarks(scene, count) {
    this.count = count;
    this.head = 0;
    var geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(count * 4 * 3);
    this.alpha = new Float32Array(count * 4);
    var idx = new Uint32Array(count * 6);
    for (var i = 0; i < count; i++) {
      var b = i * 4;
      idx[i * 6] = b; idx[i * 6 + 1] = b + 1; idx[i * 6 + 2] = b + 2;
      idx[i * 6 + 3] = b; idx[i * 6 + 4] = b + 2; idx[i * 6 + 5] = b + 3;
    }
    for (i = 0; i < this.pos.length; i += 3) this.pos[i + 1] = -9999;
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    var mat = new THREE.ShaderMaterial({
      vertexShader: [
        'attribute float aAlpha;',
        'varying float vA;',
        'void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }'
      ].join('\n'),
      fragmentShader: [
        'varying float vA;',
        'void main(){ if (vA < 0.01) discard; gl_FragColor = vec4(0.03,0.03,0.035, vA); }'
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.geo = geo;
    this.last = Object.create(null);
  }

  // Lay a quad from the previous sample of this wheel to the current one.
  SkidMarks.prototype.stamp = function (key, x, y, z, dirX, dirZ, halfW, alpha) {
    var prev = this.last[key];
    if (!prev) {
      this.last[key] = { x: x, y: y, z: z };
      return;
    }
    var dx = x - prev.x, dz = z - prev.z;
    var d = Math.hypot(dx, dz);
    if (d < 0.28) return;
    if (d > 6) { prev.x = x; prev.y = y; prev.z = z; return; }
    var px = -dz / d * halfW, pz = dx / d * halfW;
    var i = this.head;
    this.head = (this.head + 1) % this.count;
    var b = i * 12;
    var p = this.pos;
    p[b] = prev.x - px; p[b + 1] = prev.y + 0.015; p[b + 2] = prev.z - pz;
    p[b + 3] = prev.x + px; p[b + 4] = prev.y + 0.015; p[b + 5] = prev.z + pz;
    p[b + 6] = x + px; p[b + 7] = y + 0.015; p[b + 8] = z + pz;
    p[b + 9] = x - px; p[b + 10] = y + 0.015; p[b + 11] = z - pz;
    var a = i * 4;
    for (var k = 0; k < 4; k++) this.alpha[a + k] = alpha;
    prev.x = x; prev.y = y; prev.z = z;
    this.dirty = true;
  };

  SkidMarks.prototype.fade = function (dt) {
    // marks age out slowly so the city does not fill up with rubber
    var any = this.dirty;
    for (var i = 0; i < this.alpha.length; i += 4) {
      if (this.alpha[i] > 0) {
        var v = Math.max(0, this.alpha[i] - dt * 0.010);
        this.alpha[i] = this.alpha[i + 1] = this.alpha[i + 2] = this.alpha[i + 3] = v;
        any = true;
      }
    }
    if (any) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
      this.dirty = false;
    }
  };

  // ------------------------------------------------------------ tracers ----
  function Tracers(scene, count) {
    this.count = count;
    this.head = 0;
    this.life = new Float32Array(count);
    var geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(count * 2 * 3);
    this.alpha = new Float32Array(count * 2);
    for (var i = 0; i < this.pos.length; i += 3) this.pos[i + 1] = -9999;
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    var mat = new THREE.ShaderMaterial({
      vertexShader: 'attribute float aAlpha; varying float vA; void main(){ vA=aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ if(vA<0.02) discard; gl_FragColor = vec4(1.0,0.86,0.5,vA); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 7;
    scene.add(this.lines);
    this.geo = geo;
  }

  Tracers.prototype.add = function (x0, y0, z0, x1, y1, z1) {
    var i = this.head;
    this.head = (this.head + 1) % this.count;
    var b = i * 6;
    this.pos[b] = x0; this.pos[b + 1] = y0; this.pos[b + 2] = z0;
    this.pos[b + 3] = x1; this.pos[b + 4] = y1; this.pos[b + 5] = z1;
    this.alpha[i * 2] = 0.0; this.alpha[i * 2 + 1] = 0.9;
    this.life[i] = 0.07;
    this.dirty = true;
  };

  Tracers.prototype.update = function (dt) {
    var any = this.dirty;
    for (var i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      var a = Math.max(0, this.life[i] / 0.07);
      this.alpha[i * 2] = 0;
      this.alpha[i * 2 + 1] = a * 0.9;
      any = true;
    }
    if (any) { this.geo.attributes.aAlpha.needsUpdate = true; this.geo.attributes.position.needsUpdate = true; this.dirty = false; }
  };

  // ---------------------------------------------------------------- Fx -----
  function Fx(game) {
    this.game = game;
    var scene = game.scene;
    var q = SB.Q.settings;
    var pf = q.particles;
    this.smokeSet = new ParticleSet(scene, Math.round(900 * pf), SB.Tex.smoke(), THREE.NormalBlending);
    this.sparkSet = new ParticleSet(scene, Math.round(700 * pf), SB.Tex.blobHard(), THREE.AdditiveBlending);
    this.dustSet = new ParticleSet(scene, Math.round(500 * pf), SB.Tex.blob(), THREE.NormalBlending);
    this.skids = new SkidMarks(scene, q.skidMarks);
    this.tracers = new Tracers(scene, 200);
    this.flashes = [];
    for (var i = 0; i < 8; i++) {
      var m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: SB.Tex.blobHard(), color: 0xffd27a, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0
        }));
      m.visible = false;
      m.renderOrder = 8;
      scene.add(m);
      this.flashes.push({ mesh: m, life: 0 });
    }
    this.flashHead = 0;
    this._v = new THREE.Vector3();
  }

  Fx.prototype.smoke = function (x, y, z, vx, vy, vz, size, life, color, alpha) {
    this.smokeSet.emit(x, y, z, vx, vy, vz, size, size * 1.6, life,
      color === undefined ? 0x9a9a9a : color, alpha === undefined ? 0.5 : alpha, 0.8, -1.1);
  };

  Fx.prototype.spark = function (x, y, z, vx, vy, vz, color) {
    this.sparkSet.emit(x, y, z, vx, vy, vz, 0.13, -0.08, 0.25 + Math.random() * 0.3,
      color === undefined ? 0xffc060 : color, 1, 1.4, 13);
  };

  Fx.prototype.dust = function (x, y, z, vx, vy, vz, size, life, color) {
    this.dustSet.emit(x, y, z, vx, vy, vz, size, size * 2.2, life,
      color === undefined ? 0xbcae94 : color, 0.42, 1.6, 1.5);
  };

  Fx.prototype.tireSmoke = function (x, y, z, vx, vz, amount) {
    if (amount < 0.12) return;
    if (Math.random() > amount * 0.85) return;
    this.smokeSet.emit(
      x + (Math.random() - 0.5) * 0.5, y + 0.1, z + (Math.random() - 0.5) * 0.5,
      vx * 0.12 + (Math.random() - 0.5) * 1.2, 0.7 + Math.random() * 1.0, vz * 0.12 + (Math.random() - 0.5) * 1.2,
      0.5, 2.6, 0.9 + Math.random() * 0.6, 0xd8d4cc, 0.34, 1.1, -0.7);
  };

  Fx.prototype.muzzle = function (x, y, z, dx, dy, dz, scale) {
    scale = scale || 1;
    var f = this.flashes[this.flashHead];
    this.flashHead = (this.flashHead + 1) % this.flashes.length;
    f.mesh.position.set(x + dx * 0.3, y + dy * 0.3, z + dz * 0.3);
    f.mesh.scale.setScalar(1.5 * scale);
    f.mesh.visible = true;
    f.mesh.material.opacity = 1;
    f.life = 0.055;
    for (var i = 0; i < 4; i++) {
      this.spark(x, y, z,
        dx * 9 + (Math.random() - 0.5) * 5,
        dy * 9 + (Math.random() - 0.5) * 5,
        dz * 9 + (Math.random() - 0.5) * 5, 0xffd28a);
    }
  };

  Fx.prototype.impact = function (x, y, z, nx, ny, nz, kind) {
    var n = kind === 'flesh' ? 5 : 9;
    for (var i = 0; i < n; i++) {
      var sx = nx * 3 + (Math.random() - 0.5) * 4;
      var sy = ny * 3 + Math.random() * 3;
      var sz = nz * 3 + (Math.random() - 0.5) * 4;
      if (kind === 'flesh') this.dust(x, y, z, sx * 0.3, sy * 0.3, sz * 0.3, 0.12, 0.35, 0x6b2f2f);
      else this.spark(x, y, z, sx, sy, sz, kind === 'metal' ? 0xfff0c0 : 0xd8cbb0);
    }
    if (kind !== 'flesh') {
      this.dust(x + nx * 0.1, y + ny * 0.1, z + nz * 0.1, nx, ny + 0.5, nz, 0.22, 0.5, 0xa89f90);
    }
  };

  Fx.prototype.explosion = function (x, y, z, scale) {
    scale = scale || 1;
    var i;
    for (i = 0; i < 26 * scale; i++) {
      var a = Math.random() * M.TAU, e = Math.random() * 1.4;
      var sp = 6 + Math.random() * 16 * scale;
      this.smokeSet.emit(x, y + 0.4, z,
        Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp * 0.8, Math.sin(a) * Math.cos(e) * sp,
        1.1 * scale, 3.2 * scale, 1.6 + Math.random() * 1.6, 0x2a2622, 0.75, 1.0, -1.6);
    }
    for (i = 0; i < 22 * scale; i++) {
      var a2 = Math.random() * M.TAU, e2 = Math.random() * 1.2;
      var sp2 = 10 + Math.random() * 22 * scale;
      this.sparkSet.emit(x, y + 0.4, z,
        Math.cos(a2) * sp2, Math.sin(e2) * sp2, Math.sin(a2) * sp2,
        0.7 * scale, -0.5, 0.35 + Math.random() * 0.45,
        Math.random() < 0.5 ? 0xffb43a : 0xff6a1e, 1, 1.6, 6);
    }
    var f = this.flashes[this.flashHead];
    this.flashHead = (this.flashHead + 1) % this.flashes.length;
    f.mesh.position.set(x, y + 1, z);
    f.mesh.scale.setScalar(11 * scale);
    f.mesh.visible = true;
    f.mesh.material.opacity = 1;
    f.mesh.material.color.setHex(0xffa030);
    f.life = 0.22;
    if (this.game.player) {
      var d = M.dist(x, z, this.game.player.pos.x, this.game.player.pos.z);
      this.game.player.shake = Math.min(1.4, this.game.player.shake + M.clamp(1 - d / 45, 0, 1) * 1.1);
    }
  };

  Fx.prototype.render = function (dt) {
    this.smokeSet.update(dt);
    this.sparkSet.update(dt);
    this.dustSet.update(dt);
    this.skids.fade(dt);
    this.tracers.update(dt);
    var cam = this.game.camera;
    for (var i = 0; i < this.flashes.length; i++) {
      var f = this.flashes[i];
      if (f.life <= 0) { if (f.mesh.visible) { f.mesh.visible = false; } continue; }
      f.life -= dt;
      f.mesh.material.opacity = Math.max(0, f.life / 0.06) * 0.9;
      if (f.mesh.scale.x > 4) f.mesh.material.opacity = Math.max(0, f.life / 0.22);
      f.mesh.quaternion.copy(cam.quaternion);
      if (f.life <= 0) f.mesh.visible = false;
    }
  };

  SB.Fx = Fx;

})(window.SB = window.SB || {});
