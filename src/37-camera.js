// 37-camera.js - view modes.
//
// The game had exactly one camera: a third-person follow rig. This adds a
// first-person view and a free photo camera, both layered on top of the
// existing rig rather than replacing it: the player module still positions
// the follow camera every frame, and this overrides it afterwards when a
// different mode is selected. That keeps every existing camera behaviour -
// the collision pull-in, the aim shoulder offset, the speed FOV - intact and
// untouched for the mode almost everyone plays in.
(function (SB) {
  'use strict';

  var M = SB.M;

  var MODES = ['follow', 'first'];

  function Camera(game) {
    this.game = game;
    this.mode = 'follow';
    this.photo = false;
    // Free-camera state, in world space.
    this.free = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 14, fov: 58 };
    this._wasHudVisible = true;
    this._tmp = new THREE.Vector3();
    this._look = { x: 0, y: 0 };
    this.bind();
  }

  Camera.prototype.bind = function () {
    var self = this;
    window.addEventListener('keydown', function (e) {
      var g = self.game;
      if (!g.started) return;
      // The map, the shops and the progress page own the keyboard while open.
      if (g.hud && (g.hud.shop || g.hud.mapOpen || g.hud.statsOpen)) return;
      if (e.code === 'KeyG') { e.preventDefault(); self.cycle(); }
      else if (e.code === 'KeyX') { e.preventDefault(); self.togglePhoto(); }
      else if (self.photo && e.code === 'Escape') { e.preventDefault(); self.togglePhoto(); }
    });
  };

  Camera.prototype.cycle = function () {
    if (this.photo) return;
    var i = MODES.indexOf(this.mode);
    this.setMode(MODES[(i + 1) % MODES.length]);
  };

  Camera.prototype.setMode = function (mode) {
    if (MODES.indexOf(mode) < 0) mode = 'follow';
    this.mode = mode;
    var g = this.game;
    // Restore the avatar immediately rather than waiting for the next render.
    // render() re-asserts this every frame anyway, but a mode change that is
    // read back before the next frame should already be consistent.
    if (mode !== 'first' && g.player && g.player.mode === 'foot' && !g.player.dead) {
      g.player.char.root.visible = true;
    }
    if (g.hud) {
      g.hud.toast(mode === 'first' ? 'First person' : 'Third person', '#8ed8f2');
    }
  };

  // Photo mode detaches the camera and stops the world so a shot can be
  // composed. The simulation is paused rather than left running because a
  // photo of a city that is still moving is a screenshot, not a photo.
  Camera.prototype.togglePhoto = function () {
    var g = this.game;
    this.photo = !this.photo;
    if (this.photo) {
      var cam = g.camera;
      this.free.x = cam.position.x;
      this.free.y = cam.position.y;
      this.free.z = cam.position.z;
      // Seed the free camera looking where the player camera was looking.
      var p = g.player;
      this.free.yaw = p ? p.camYaw : 0;
      this.free.pitch = p ? p.camPitch : 0;
      this.free.fov = 58;
      this._wasPaused = g.paused;
      this._wasBlocking = !!g.uiBlocking;
      g.setPaused(true);
      // uiBlocking keeps the player module from consuming the look delta, so
      // the free camera is the only thing reading the mouse.
      g.uiBlocking = true;
      if (g.hud) {
        this._wasHudVisible = g.hud.canvas.style.display !== 'none';
        g.hud.canvas.style.display = 'none';
      }
      this.hintEl().style.display = 'block';
    } else {
      // Restore whatever owned the UI before, rather than assuming nothing
      // did: forcing this to false would silently unblock a panel that was
      // open when photo mode was entered.
      g.uiBlocking = this._wasBlocking;
      if (g.hud && this._wasHudVisible) g.hud.canvas.style.display = '';
      this.hintEl().style.display = 'none';
      if (!this._wasPaused) g.setPaused(false);
    }
  };

  // Where the eyes are, for first person. On foot this tracks the character's
  // head; in a vehicle it is the driver's seat, pushed forward off the seat
  // back so the near plane does not clip through the dashboard.
  Camera.prototype.eyePoint = function (out) {
    var g = this.game, p = g.player;
    if (!p) return false;
    if (p.vehicle && (p.mode === 'car' || p.mode === 'boat' ||
                      p.mode === 'plane' || p.mode === 'heli')) {
      var v = p.vehicle;
      var ca = Math.cos(v.yaw), sa = Math.sin(v.yaw);
      var fwd = (v.spec.len || 4.4) * 0.06;
      var side = (v.spec.wid || 1.8) * 0.22;
      var up = (v.spec.bodyH || 0.8) * 0.62 + (v.spec.wheelR || 0.33) * 0.5;
      out.set(
        v.pos.x + ca * fwd - sa * side,
        v.pos.y + up + 0.34,
        v.pos.z + sa * fwd + ca * side);
      return true;
    }
    out.set(p.pos.x, p.pos.y + (p.swimming ? 1.15 : 1.62), p.pos.z);
    return true;
  };

  // Called from Game.render AFTER the player has positioned the follow
  // camera, so `follow` costs nothing and the other modes simply overwrite.
  Camera.prototype.render = function (dt, cam) {
    var g = this.game, p = g.player;
    if (this.photo) { this.stepFree(dt, cam); return; }
    if (this.mode !== 'first' || !p || p.dead) {
      if (p && p.mode === 'foot' && !p.dead) p.char.root.visible = true;
      return;
    }

    var eye = this._tmp;
    if (!this.eyePoint(eye)) return;
    cam.position.copy(eye);
    var yaw = p.camYaw, pitch = p.camPitch;
    cam.rotation.set(0, 0, 0);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = -yaw - Math.PI / 2;
    cam.rotation.x = pitch;
    // The player's own body would fill the frame from inside its own head.
    if (p.mode === 'foot') p.char.root.visible = false;
  };

  var FREE_KEYS = {
    forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    up: ['Space'], down: ['KeyC'],
    faster: ['ShiftLeft', 'ShiftRight'], slower: ['ControlLeft', 'ControlRight']
  };

  Camera.prototype.stepFree = function (dt, cam) {
    var g = this.game, input = g.input;
    var f = this.free;

    // Look. uiBlocking stops the player module from also reading this, so the
    // delta is consumed exactly once.
    if (input.locked || input.touch.enabled) {
      var ld = input.lookDelta(this._look);
      // Same sensitivity and inversion the player camera uses, so photo mode
      // does not feel like a different game.
      var sens = 0.0021 * (SB.Settings ? SB.Settings.lookScale() : 1);
      var invert = SB.Settings ? SB.Settings.lookInvertY() : 1;
      f.yaw = M.wrapAngle(f.yaw + ld.x * sens);
      f.pitch = M.clamp(f.pitch - ld.y * sens * invert, -1.5, 1.5);
    }

    function held(list) {
      for (var i = 0; i < list.length; i++) if (input.down(list[i])) return true;
      return false;
    }
    var boost = held(FREE_KEYS.faster) ? 4 : (held(FREE_KEYS.slower) ? 0.22 : 1);
    var step = f.speed * boost * dt;

    var cp = Math.cos(f.pitch);
    var fx = Math.cos(f.yaw) * cp, fy = Math.sin(f.pitch), fz = Math.sin(f.yaw) * cp;
    var rx = Math.cos(f.yaw + Math.PI / 2), rz = Math.sin(f.yaw + Math.PI / 2);

    if (held(FREE_KEYS.forward)) { f.x += fx * step; f.y += fy * step; f.z += fz * step; }
    if (held(FREE_KEYS.back)) { f.x -= fx * step; f.y -= fy * step; f.z -= fz * step; }
    if (held(FREE_KEYS.right)) { f.x += rx * step; f.z += rz * step; }
    if (held(FREE_KEYS.left)) { f.x -= rx * step; f.z -= rz * step; }
    if (held(FREE_KEYS.up)) f.y += step;
    if (held(FREE_KEYS.down)) f.y -= step;
    f.y = M.clamp(f.y, -30, 900);

    cam.position.set(f.x, f.y, f.z);
    cam.rotation.set(0, 0, 0);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = -f.yaw - Math.PI / 2;
    cam.rotation.x = f.pitch;
    if (cam.fov !== f.fov) { cam.fov = f.fov; cam.updateProjectionMatrix(); }
  };

  // A one-line overlay while photo mode is on. It is a DOM element rather
  // than HUD canvas text because the HUD canvas is exactly the thing photo
  // mode hides.
  Camera.prototype.hintEl = function () {
    if (this._hint) return this._hint;
    var el = document.createElement('div');
    el.id = 'photoHint';
    el.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'bottom:calc(18px + env(safe-area-inset-bottom,0px))',
      'text-align:center', 'pointer-events:none', 'z-index:25',
      'font:600 12px/1.4 "Helvetica Neue",Arial,sans-serif',
      'letter-spacing:.16em', 'text-transform:uppercase',
      'color:rgba(232,236,242,.72)', 'text-shadow:0 1px 6px rgba(0,0,0,.85)',
      'display:none'
    ].join(';');
    el.textContent = 'Photo mode  ·  WASD + mouse to fly  ·  Space / C up and down  ·  ' +
      'Shift faster, Ctrl slower  ·  X or Esc to exit';
    document.body.appendChild(el);
    this._hint = el;
    return el;
  };

  Camera.MODES = MODES;
  SB.CameraModes = Camera;

})(window.SB = window.SB || {});
