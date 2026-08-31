// 00-core.js - namespace, math, RNG, input, fixed-step loop, tiny helpers.
(function (SB) {
  'use strict';

  // ---------------------------------------------------------------- math ----
  var M = SB.M = {};
  M.TAU = Math.PI * 2;
  M.DEG = Math.PI / 180;

  // Physical materials make paint, glass, and water read much closer to real
  // manufactured surfaces, but a few mobile/WebGL1 drivers reject their larger
  // shader variants. Keep the high-fidelity path on medium/high tiers and use
  // the compatible standard shader on the deliberately lightweight tier.
  SB.finishMaterial = function (params) {
    var lowTier = SB.Q && SB.Q.settings && SB.Q.settings.post === false;
    if (!lowTier) return new THREE.MeshPhysicalMaterial(params);
    // MeshStandardMaterial does not consume the physical-only finish fields;
    // strip them before construction so low mode stays warning-free as well
    // as cheaper to shade.
    var standardParams = {};
    for (var key in params) {
      if (key !== 'clearcoat' && key !== 'clearcoatRoughness' && key !== 'reflectivity') {
        standardParams[key] = params[key];
      }
    }
    return new THREE.MeshStandardMaterial(standardParams);
  };

  M.clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  M.lerp = function (a, b, t) { return a + (b - a) * t; };
  M.invLerp = function (a, b, v) { return b === a ? 0 : (v - a) / (b - a); };
  M.smoothstep = function (t) { t = M.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  M.sign = function (v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); };

  // Frame-rate independent exponential approach. `rate` = how fast, in 1/s.
  M.damp = function (a, b, rate, dt) { return M.lerp(a, b, 1 - Math.exp(-rate * dt)); };

  // Move `a` toward `b` by at most `maxDelta`.
  M.approach = function (a, b, maxDelta) {
    var d = b - a;
    if (Math.abs(d) <= maxDelta) return b;
    return a + M.sign(d) * maxDelta;
  };

  // Shortest signed angular difference b - a, wrapped to [-PI, PI].
  M.angleDelta = function (a, b) {
    var d = (b - a) % M.TAU;
    if (d > Math.PI) d -= M.TAU;
    if (d < -Math.PI) d += M.TAU;
    return d;
  };

  M.wrapAngle = function (a) {
    a = a % M.TAU;
    if (a > Math.PI) a -= M.TAU;
    if (a < -Math.PI) a += M.TAU;
    return a;
  };

  M.dampAngle = function (a, b, rate, dt) {
    return a + M.angleDelta(a, b) * (1 - Math.exp(-rate * dt));
  };

  M.dist2 = function (ax, az, bx, bz) {
    var dx = ax - bx, dz = az - bz;
    return dx * dx + dz * dz;
  };

  M.dist = function (ax, az, bx, bz) { return Math.sqrt(M.dist2(ax, az, bx, bz)); };

  // Deterministic RNG so the city is the same every load.
  M.rng = function (seed) {
    var s = seed >>> 0;
    var f = function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = function (lo, hi) { return lo + f() * (hi - lo); };
    f.int = function (lo, hi) { return Math.floor(f.range(lo, hi + 1)); };
    f.pick = function (arr) { return arr[Math.floor(f() * arr.length) % arr.length]; };
    f.chance = function (p) { return f() < p; };
    return f;
  };

  // Standard-normal-ish, cheap.
  M.gauss = function (rng) { return (rng() + rng() + rng() - 1.5) * 1.1547; };

  // ------------------------------------------------------------- spatial ----
  // Uniform hash grid over the XZ plane for broadphase queries.
  function Grid(cell) {
    this.cell = cell || 24;
    this.map = new Map();
  }
  Grid.prototype.key = function (cx, cz) { return cx * 73856093 ^ cz * 19349663; };
  Grid.prototype.insert = function (item, minX, minZ, maxX, maxZ) {
    var c = this.cell;
    var x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c);
    var z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
    for (var x = x0; x <= x1; x++) {
      for (var z = z0; z <= z1; z++) {
        var k = this.key(x, z);
        var list = this.map.get(k);
        if (!list) { list = []; this.map.set(k, list); }
        list.push(item);
      }
    }
  };
  // Collect unique items whose cells overlap the query box. Reuses `out`.
  Grid.prototype.query = function (minX, minZ, maxX, maxZ, out, stamp) {
    out.length = 0;
    var c = this.cell;
    var x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c);
    var z0 = Math.floor(minZ / c), z1 = Math.floor(maxZ / c);
    for (var x = x0; x <= x1; x++) {
      for (var z = z0; z <= z1; z++) {
        var list = this.map.get(this.key(x, z));
        if (!list) continue;
        for (var i = 0; i < list.length; i++) {
          var it = list[i];
          if (it._stamp === stamp) continue;
          it._stamp = stamp;
          out.push(it);
        }
      }
    }
    return out;
  };
  Grid.prototype.queryPoint = function (x, z, r, out, stamp) {
    return this.query(x - r, z - r, x + r, z + r, out, stamp);
  };
  SB.Grid = Grid;

  // --------------------------------------------------------------- input ----
  function Input(dom) {
    var self = this;
    this.keys = Object.create(null);
    this.pressed = Object.create(null);   // edge-triggered, cleared each frame
    this.mouse = { dx: 0, dy: 0, left: false, right: false, leftEdge: false, rightEdge: false, wheel: 0 };
    // Filled in by the touch layer; `enabled` stays false on desktop.
    this.touch = {
      enabled: false,
      move: { x: 0, y: 0 },
      look: { dx: 0, dy: 0 },
      held: Object.create(null),
      hit: Object.create(null),
      wheel: 0
    };
    this.locked = false;
    this.enabled = true;
    this.dom = dom;

    // Keys we own; stops the page from scrolling out from under the game.
    var swallow = {
      Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Tab: 1,
      KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, F1: 1, F2: 1
    };

    window.addEventListener('keydown', function (e) {
      if (!self.enabled) return;
      if (swallow[e.code]) e.preventDefault();
      if (e.repeat) return;
      self.keys[e.code] = true;
      self.pressed[e.code] = true;
    });
    window.addEventListener('keyup', function (e) {
      self.keys[e.code] = false;
    });
    window.addEventListener('blur', function () {
      // Dropping focus with keys held would otherwise stick the throttle on.
      self.keys = Object.create(null);
      self.mouse.left = self.mouse.right = false;
    });

    dom.addEventListener('mousedown', function (e) {
      if (!self.locked) return;
      if (e.button === 0) { self.mouse.left = true; self.mouse.leftEdge = true; }
      if (e.button === 2) { self.mouse.right = true; self.mouse.rightEdge = true; }
    });
    window.addEventListener('mouseup', function (e) {
      if (e.button === 0) self.mouse.left = false;
      if (e.button === 2) self.mouse.right = false;
    });
    dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('mousemove', function (e) {
      if (!self.locked) return;
      self.mouse.dx += e.movementX || 0;
      self.mouse.dy += e.movementY || 0;
    });
    dom.addEventListener('wheel', function (e) {
      if (!self.locked) return;
      e.preventDefault();
      self.mouse.wheel += e.deltaY;
    }, { passive: false });

    document.addEventListener('pointerlockchange', function () {
      self.locked = document.pointerLockElement === dom;
      if (self.onLockChange) self.onLockChange(self.locked);
    });
  }
  Input.prototype.requestLock = function () {
    if (this.touch.enabled) return;          // no pointer lock on a touch device
    if (!this.dom.requestPointerLock) return;
    try {
      var request = this.dom.requestPointerLock();
      // Browsers reject this promise when pointer lock is unavailable or the
      // request was not made from a trusted gesture. That is a normal fallback
      // on embedded browsers, not a game error.
      if (request && request.catch) request.catch(function () {});
    } catch (err) {
      // Keep the canvas usable when an older browser throws synchronously.
    }
  };
  Input.prototype.down = function (code) { return !!this.keys[code]; };
  Input.prototype.hit = function (code) { return !!this.pressed[code]; };
  Input.prototype.axis = function (negCode, posCode, negCode2, posCode2) {
    var v = 0;
    if (this.keys[negCode] || this.keys[negCode2]) v -= 1;
    if (this.keys[posCode] || this.keys[posCode2]) v += 1;
    return v;
  };

  // ------------------------------------------------------------- actions ---
  // Gameplay asks for named actions, never raw keys. That is what lets the
  // touch layer drive exactly the same code paths as the keyboard without the
  // player, combat or interior code knowing which one is in use.
  var KEYMAP = {
    jump: ['Space'], handbrake: ['Space'],
    sprint: ['ShiftLeft', 'ShiftRight'], boost: ['ShiftLeft', 'ShiftRight'],
    enter: ['KeyF'], interact: ['KeyE'], reload: ['KeyR'],
    horn: ['KeyH'], radio: ['KeyB'], station: ['KeyN'], map: ['KeyM'],
    descend: ['KeyC'],       // helicopter collective down; 'jump' doubles as ascend
    special: ['KeyV'],       // vehicle ability trigger
    weather: ['KeyT']        // live weather director: sun -> rain -> snow -> night
  };

  // Is the game receiving input at all? Pointer lock on desktop, touch
  // controls on a phone or tablet.
  Input.prototype.ready = function () {
    return this.locked || this.touch.enabled;
  };

  // Movement as an analogue vector: y forward, x right, each in [-1, 1].
  Input.prototype.moveAxis = function (out) {
    var x = 0, y = 0;
    if (this.locked) {
      y = this.axis('KeyS', 'KeyW', 'ArrowDown', 'ArrowUp');
      x = this.axis('KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight');
    }
    if (this.touch.enabled) { x += this.touch.move.x; y += this.touch.move.y; }
    out.x = M.clamp(x, -1, 1);
    out.y = M.clamp(y, -1, 1);
    return out;
  };

  // Throttle axis while driving. Touch uses dedicated pedals so the left
  // thumb can stay on the wheel.
  Input.prototype.driveAxis = function () {
    if (this.touch.enabled) {
      var v = 0;
      if (this.touch.held.gas) v += 1;
      if (this.touch.held.brake) v -= 1;
      if (v !== 0) return v;
    }
    if (!this.locked) return 0;
    return this.axis('KeyS', 'KeyW', 'ArrowDown', 'ArrowUp');
  };

  // Camera delta for this frame, in pixels.
  Input.prototype.lookDelta = function (out) {
    out.x = this.mouse.dx + this.touch.look.dx;
    out.y = this.mouse.dy + this.touch.look.dy;
    return out;
  };

  Input.prototype.act = function (name) {
    if (this.touch.enabled && this.touch.held[name]) return true;
    if (!this.locked) return false;
    if (name === 'fire') return this.mouse.left;
    if (name === 'aim') return this.mouse.right || !!this.keys.KeyQ;
    var codes = KEYMAP[name];
    if (!codes) return false;
    for (var i = 0; i < codes.length; i++) if (this.keys[codes[i]]) return true;
    return false;
  };

  Input.prototype.actHit = function (name) {
    if (this.touch.enabled && this.touch.hit[name]) return true;
    if (!this.locked) return false;
    if (name === 'fire') return this.mouse.leftEdge;
    var codes = KEYMAP[name];
    if (!codes) return false;
    for (var i = 0; i < codes.length; i++) if (this.pressed[codes[i]]) return true;
    return false;
  };

  // Called once at the end of every rendered frame.
  Input.prototype.endFrame = function () {
    this.pressed = Object.create(null);
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0;
    this.mouse.leftEdge = false; this.mouse.rightEdge = false;
    this.touch.look.dx = 0; this.touch.look.dy = 0;
    this.touch.hit = Object.create(null);
    this.touch.wheel = 0;
  };
  SB.Input = Input;

  // ----------------------------------------------------------- main loop ----
  // Fixed-timestep simulation with a render interpolation hook. Keeping the
  // physics step constant is what makes the car handling reproducible, and it
  // is what the dev harness drives directly.
  function Loop(step, onFixed, onRender) {
    this.step = step || 1 / 60;
    this.onFixed = onFixed;
    this.onRender = onRender;
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this.time = 0;
    this.frame = 0;
    this.maxSubSteps = 5;   // below this we slow down rather than spiral
    // Rendering is paced by the display, but the performance system uses a
    // 10ms budget so 100Hz+ displays have a clear target to aim for. A 60Hz
    // display remains capped by its refresh rate; no timer can manufacture
    // extra visible frames there.
    this.targetFps = 100;
    this.targetFrameMs = 1000 / this.targetFps;
    this.fps = 60;
    this.frameMs = 1000 / 60;
    this.renderMs = 0;
    this.refreshRate = 0;
    this._fpsAcc = 0;
    this._fpsCount = 0;
    this._refreshAcc = 0;
    this._refreshMin = 1 / 60;
    this._refreshSamples = 0;
  }
  Loop.prototype.start = function () {
    var self = this;
    this.running = true;
    this.last = performance.now() / 1000;
    function tick() {
      if (!self.running) return;
      requestAnimationFrame(tick);
      var now = performance.now() / 1000;
      var dt = now - self.last;
      self.last = now;
      if (dt > 0.25) dt = 0.25;       // tab was backgrounded; do not catch up
      self._fpsAcc += dt; self._fpsCount++;
      // The shortest recent rAF interval is a useful estimate of the panel's
      // refresh ceiling even when a heavy frame temporarily misses a v-sync.
      // Ignore long background-tab intervals so they cannot poison the meter.
      if (dt > 0 && dt < 0.04) {
        self._refreshMin = Math.min(self._refreshMin, dt);
        self._refreshSamples++;
      }
      self._refreshAcc += dt;
      if (self._fpsAcc > 0.5) {
        self.fps = self._fpsCount / self._fpsAcc;
        self.frameMs = 1000 / Math.max(1, self.fps);
        self._fpsAcc = 0; self._fpsCount = 0;
      }
      // Eight samples are enough to identify the display without making the
      // adaptive scaler spend its first few seconds chasing an impossible
      // 100 FPS target on a 60 Hz panel.
      if (self._refreshAcc > 0.5 && self._refreshSamples >= 8) {
        self.refreshRate = Math.round(1 / self._refreshMin);
        self._refreshAcc = 0;
        self._refreshMin = 1 / Math.max(60, self.refreshRate);
        self._refreshSamples = 0;
      }
      self.acc += dt;
      var steps = 0;
      while (self.acc >= self.step && steps < self.maxSubSteps) {
        self.onFixed(self.step, self.time);
        self.time += self.step;
        self.acc -= self.step;
        steps++;
        self.frame++;
      }
      if (steps === self.maxSubSteps) self.acc = 0;
      var renderStart = performance.now();
      self.onRender(dt, self.acc / self.step);
      self.renderMs = performance.now() - renderStart;
    }
    requestAnimationFrame(tick);
  };
  Loop.prototype.stop = function () { this.running = false; };
  SB.Loop = Loop;

  // -------------------------------------------------------------- misc -----
  SB.formatMoney = function (n) {
    var s = Math.floor(Math.abs(n)).toString();
    var out = '';
    while (s.length > 3) { out = ',' + s.slice(-3) + out; s = s.slice(0, -3); }
    return (n < 0 ? '-$' : '$') + s + out;
  };

  SB.formatTime = function (sec) {
    sec = Math.max(0, sec);
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  };

  // Simple event bus. Missions listen for world events without the world
  // knowing missions exist.
  function Bus() { this.map = Object.create(null); }
  Bus.prototype.on = function (name, fn) {
    (this.map[name] || (this.map[name] = [])).push(fn);
    return fn;
  };
  Bus.prototype.off = function (name, fn) {
    var l = this.map[name];
    if (!l) return;
    var i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  };
  Bus.prototype.emit = function (name, payload) {
    var l = this.map[name];
    if (!l) return;
    for (var i = 0; i < l.length; i++) l[i](payload);
  };
  SB.Bus = Bus;

  // Object pool: avoids per-frame allocation for bullets, particles, decals.
  function Pool(factory, reset) {
    this.factory = factory;
    this.reset = reset;
    this.free = [];
    this.live = [];
  }
  Pool.prototype.get = function () {
    var o = this.free.length ? this.free.pop() : this.factory();
    this.live.push(o);
    return o;
  };
  Pool.prototype.release = function (o) {
    var i = this.live.indexOf(o);
    if (i >= 0) this.live.splice(i, 1);
    if (this.reset) this.reset(o);
    this.free.push(o);
  };
  Pool.prototype.releaseAt = function (i) {
    var o = this.live[i];
    this.live.splice(i, 1);
    if (this.reset) this.reset(o);
    this.free.push(o);
  };
  SB.Pool = Pool;

})(window.SB = window.SB || {});
