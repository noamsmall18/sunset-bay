// 24-touch.js - the touch control layer for phones and tablets.
//
// Nothing here talks to the player, the car or the guns directly: it writes
// named actions into `input.touch`, which is the same surface the keyboard
// feeds. That is why the whole game works on a phone without a single
// gameplay branch for "mobile".
//
// Layout is a left thumbstick and a right action cluster arranged on an arc,
// with the rest of the screen free for camera drags. The same vehicle cluster
// relabels itself for cars, boats, planes, and helicopters.
(function (SB) {
  'use strict';

  var M = SB.M;

  // Satellite buttons sit on an arc around the big one. Angles are measured
  // anticlockwise from "to the left of the thumb".
  var FOOT_BUTTONS = [
    { id: 'fire', act: 'fire', label: 'FIRE', main: true },
    { id: 'aim', act: 'aim', label: 'AIM', angle: 180, r: 1 },
    // The 135 button sits on a wider arc so the three satellites never crowd
    // each other on a 390px-tall phone screen.
    { id: 'jump', act: 'jump', label: 'JUMP', angle: 135, r: 1.58 },
    { id: 'action', act: 'enter', label: 'ENTER', angle: 90, r: 1 }
  ];

  var CAR_BUTTONS = [
    { id: 'gas', act: 'gas', label: 'GAS', main: true },
    { id: 'brake', act: 'brake', label: 'BRAKE', angle: 180, r: 1 },
    { id: 'handbrake', act: 'handbrake', label: 'HAND', angle: 135, r: 1.58 },
    { id: 'exit', act: 'enter', label: 'EXIT', angle: 90, r: 1 },
    // The cabin button is only shown for the yacht, keeping vehicle exit
    // separate and available on touch while the cabin prompt is active.
    { id: 'cabin', act: 'interact', label: 'CABIN', fixed: 'cabin', yachtOnly: true }
  ];

  // Small utilities along the top right.
  var UTILITY = [
    { id: 'map', act: 'map', label: 'MAP', tap: true },
    { id: 'weapon', act: 'weapon', label: 'GUN', tap: true, footOnly: true },
    { id: 'horn', act: 'horn', label: 'HORN', tap: true, carOnly: true },
    { id: 'weather', act: 'weather', label: 'WX', tap: true },
    { id: 'pause', act: 'pause', label: 'II', tap: true }
  ];

  // Pointer capture throws if the pointer is already gone (or if the id was
  // never real). Losing the handler to that exception would strand a control
  // in the pressed state, so every capture is guarded.
  function capture(node, id) {
    try { node.setPointerCapture(id); } catch (e) { /* pointer already ended */ }
  }
  function hasCapture(node, id) {
    try { return node.hasPointerCapture && node.hasPointerCapture(id); }
    catch (e) { return false; }
  }

  function el(cls, parent, text) {
    var d = document.createElement('div');
    d.className = cls;
    if (text !== undefined) d.textContent = text;
    (parent || document.body).appendChild(d);
    return d;
  }

  function Touch(game) {
    var self = this;
    this.game = game;
    this.input = game.input;
    this.input.touch.enabled = true;

    this.root = document.getElementById('touch');
    this.root.classList.add('on');

    // Camera drag layer, underneath everything else in the overlay.
    this.lookZone = el('t-look', this.root);
    this.stickZone = el('t-stickzone', this.root);
    this.stickBase = el('t-stick-base', this.stickZone);
    this.stickKnob = el('t-stick-knob', this.stickZone);

    this.cluster = el('t-cluster', this.root);
    this.utilityBar = el('t-utility', this.root);

    this.buttons = {};
    this.footEls = [];
    this.carEls = [];
    this.utilEls = [];

    var i, b;
    for (i = 0; i < FOOT_BUTTONS.length; i++) {
      b = FOOT_BUTTONS[i];
      this.footEls.push(this.makeButton(b, this.cluster, 't-foot'));
    }
    for (i = 0; i < CAR_BUTTONS.length; i++) {
      b = CAR_BUTTONS[i];
      this.carEls.push(this.makeButton(b, this.cluster, 't-car'));
    }
    for (i = 0; i < UTILITY.length; i++) {
      b = UTILITY[i];
      this.utilEls.push(this.makeButton(b, this.utilityBar, 't-util'));
    }

    this.stickId = -1;
    this.lookId = -1;
    this.stickOrigin = { x: 0, y: 0 };
    this.lookPrev = { x: 0, y: 0 };
    this.lookMoved = 0;

    this.bindStick();
    this.bindLook();

    this.mode = null;
    this.layout();

    window.addEventListener('orientationchange', function () {
      setTimeout(function () { self.layout(); }, 250);
    });
  }

  // ------------------------------------------------------------- buttons ---
  Touch.prototype.makeButton = function (spec, parent, kindClass) {
    var self = this;
    var cls = 't-btn ' + kindClass + (spec.main ? ' t-main' : ' t-' + (spec.size || 'med'));
    var d = el(cls, parent);
    var label = el('t-label', d, spec.label);
    d.dataset.act = spec.act;
    if (spec.footOnly) d.classList.add('t-foot-only');
    if (spec.carOnly) d.classList.add('t-car-only');
    if (spec.yachtOnly) d.classList.add('t-yacht-only');
    d.__spec = spec;
    d.__label = label;
    this.buttons[spec.id] = d;

    d.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      capture(d, e.pointerId);
      d.classList.add('t-down');
      self.press(d.__spec, true);
    });
    var release = function (e) {
      e.preventDefault();
      e.stopPropagation();
      d.classList.remove('t-down');
      self.press(d.__spec, false);
    };
    d.addEventListener('pointerup', release);
    d.addEventListener('pointercancel', release);
    d.addEventListener('pointerleave', function (e) {
      // Only release on leave if the pointer is genuinely gone; capture keeps
      // a sliding thumb attached to the button it started on.
      if (!hasCapture(d, e.pointerId)) {
        d.classList.remove('t-down');
        self.press(d.__spec, false);
      }
    });
    return d;
  };

  Touch.prototype.press = function (spec, down) {
    var t = this.input.touch;
    var act = spec.act;

    // Buttons that are one-shot commands rather than held states.
    if (act === 'pause') {
      if (down) this.game.togglePause();
      return;
    }
    if (act === 'map' || act === 'weapon' || act === 'horn' || act === 'weather') {
      if (down) {
        // Weather is fired immediately so a touch tap cannot also be consumed
        // by the desktop keyboard path in the next fixed step.
        if (act === 'weather') this.fireUtility(act);
        else { t.hit[act] = true; this.fireUtility(act); }
      }
      return;
    }
    // Aim is a toggle on touch: holding it would cost the thumb that fires.
    if (act === 'aim') {
      if (down) {
        t.held.aim = !t.held.aim;
        this.buttons.aim.classList.toggle('t-active', !!t.held.aim);
      }
      return;
    }
    if (down) t.hit[act] = true;
    t.held[act] = down;
  };

  Touch.prototype.fireUtility = function (act) {
    var g = this.game;
    if (act === 'map' && g.hud) {
      g.hud.setMapOpen(!g.hud.mapOpen);
    } else if (act === 'horn' && g.audio && g.player && g.player.vehicle) {
      g.audio.horn(g.player.vehicle);
    } else if (act === 'weather' && g.weather) {
      g.weather.cycle();
    }
    // 'weapon' is consumed by the combat module through input.touch.hit
  };

  // ---------------------------------------------------------- thumbstick ---
  Touch.prototype.bindStick = function () {
    var self = this;
    var zone = this.stickZone;

    zone.addEventListener('pointerdown', function (e) {
      if (self.stickId !== -1) return;
      if (self.game.uiBlocking || self.game.paused) return;
      e.preventDefault();
      capture(zone, e.pointerId);
      self.stickId = e.pointerId;
      self.stickOrigin.x = e.clientX;
      self.stickOrigin.y = e.clientY;
      self.showStick(e.clientX, e.clientY, 0, 0);
    });

    zone.addEventListener('pointermove', function (e) {
      if (e.pointerId !== self.stickId) return;
      e.preventDefault();
      var dx = e.clientX - self.stickOrigin.x;
      var dy = e.clientY - self.stickOrigin.y;
      var r = self.stickRadius;
      var len = Math.hypot(dx, dy);
      if (len > r) {
        // Drag the origin along so the stick never feels stuck at the rim.
        self.stickOrigin.x += dx * (1 - r / len);
        self.stickOrigin.y += dy * (1 - r / len);
        dx *= r / len; dy *= r / len;
        len = r;
      }
      var nx = dx / r, ny = dy / r;
      self.input.touch.move.x = nx;
      self.input.touch.move.y = -ny;               // screen y is inverted
      // full deflection means run
      self.input.touch.held.sprint = Math.hypot(nx, ny) > 0.85;
      self.showStick(self.stickOrigin.x, self.stickOrigin.y, dx, dy);
    });

    var end = function (e) {
      if (e.pointerId !== self.stickId) return;
      e.preventDefault();
      self.stickId = -1;
      self.input.touch.move.x = 0;
      self.input.touch.move.y = 0;
      self.input.touch.held.sprint = false;
      self.hideStick();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  };

  Touch.prototype.showStick = function (cx, cy, dx, dy) {
    var r = this.stickRadius;
    var b = this.stickBase, k = this.stickKnob;
    b.style.width = b.style.height = (r * 2) + 'px';
    b.style.left = (cx - r) + 'px';
    b.style.top = (cy - r) + 'px';
    b.style.opacity = '1';
    var kr = r * 0.44;
    k.style.width = k.style.height = (kr * 2) + 'px';
    k.style.left = (cx + dx - kr) + 'px';
    k.style.top = (cy + dy - kr) + 'px';
    k.style.opacity = '1';
  };

  Touch.prototype.hideStick = function () {
    this.stickBase.style.opacity = '0';
    this.stickKnob.style.opacity = '0';
  };

  // ---------------------------------------------------------- look drag ----
  Touch.prototype.bindLook = function () {
    var self = this;
    var zone = this.lookZone;

    zone.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      // A menu is up: this tap belongs to the menu, not the camera.
      if (self.handleMenuTap(e.clientX, e.clientY)) return;
      if (self.lookId !== -1) return;
      if (self.game.paused) return;
      capture(zone, e.pointerId);
      self.lookId = e.pointerId;
      self.lookPrev.x = e.clientX;
      self.lookPrev.y = e.clientY;
      self.lookMoved = 0;
    });

    zone.addEventListener('pointermove', function (e) {
      if (e.pointerId !== self.lookId) return;
      e.preventDefault();
      var dx = e.clientX - self.lookPrev.x;
      var dy = e.clientY - self.lookPrev.y;
      self.lookPrev.x = e.clientX;
      self.lookPrev.y = e.clientY;
      self.lookMoved += Math.abs(dx) + Math.abs(dy);
      // Touch drags cover far less distance than a mouse sweep, so they get
      // more degrees per pixel.
      self.input.touch.look.dx += dx * 1.85;
      self.input.touch.look.dy += dy * 1.85;
    });

    var end = function (e) {
      if (e.pointerId !== self.lookId) return;
      e.preventDefault();
      self.lookId = -1;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  };

  // Shop rows and the map are drawn on the HUD canvas, which takes no pointer
  // events, so taps on them are resolved here against the HUD's own hit test.
  Touch.prototype.handleMenuTap = function (px, py) {
    var g = this.game;
    var hud = g.hud;
    if (!hud) return false;
    if (hud.shop) {
      var idx = hud.shopHitTest(px, py);
      if (idx >= 0) {
        hud.shopIndex = idx;
        hud.buy(hud.shop.items[idx]);
      } else if (!hud.tapIsInsideShop(px, py)) {
        hud.closeShop();
      }
      return true;
    }
    if (hud.mapOpen) {
      if (hud.mapTap(px, py)) return true;
      hud.setMapOpen(false);
      return true;
    }
    return false;
  };

  // -------------------------------------------------------------- layout ---
  Touch.prototype.layout = function () {
    var w = window.innerWidth, h = window.innerHeight;
    var small = Math.min(w, h);
    var portrait = h > w;

    // Safe area, so nothing hides under a notch or the home indicator.
    var cs = getComputedStyle(document.documentElement);
    function inset(name) {
      var v = parseFloat(cs.getPropertyValue(name));
      return isFinite(v) ? v : 0;
    }
    var padR = 18 + inset('--sa-right');
    var padB = 18 + inset('--sa-bottom');
    var padT = 14 + inset('--sa-top');

    var big = M.clamp(small * 0.21, 72, 118);
    var med = big * 0.70;
    // 44px is the accessibility floor for a tap target; never go under it.
    var util = M.clamp(small * 0.098, 44, 58);
    this.stickRadius = M.clamp(small * 0.155, 54, 96);

    this.bigSize = big;
    var cx = w - padR - big / 2;
    var cy = h - padB - big / 2;
    var radius = big * 0.5 + med * 0.5 + M.clamp(small * 0.022, 10, 20);
    // The far satellite must still clear the top of the screen.
    var topReach = cy - radius * 1.58 - med / 2;
    if (topReach < padT + 4) radius = (cy - padT - 4 - med / 2) / 1.58;

    var all = this.footEls.concat(this.carEls);
    for (var i = 0; i < all.length; i++) {
      var d = all[i], spec = d.__spec;
      var size = spec.main ? big : med;
      var x = cx, y = cy;
      if (spec.fixed === 'cabin') {
        x = cx - big * 0.95;
        y = cy - big * 0.82;
      } else if (!spec.main) {
        // Angles are measured anticlockwise from straight up-screen-right, so
        // 180 sits to the left of the thumb and 90 directly above it.
        var a = spec.angle * Math.PI / 180;
        var rr = radius * (spec.r || 1);
        x = cx + Math.cos(a) * rr;
        y = cy - Math.sin(a) * rr;
      }
      d.style.width = d.style.height = size + 'px';
      d.style.left = (x - size / 2) + 'px';
      d.style.top = (y - size / 2) + 'px';
      d.style.fontSize = Math.round(size * (spec.main ? 0.155 : 0.175)) + 'px';
    }

    // Utility row, top right, laid out right to left. Only the buttons valid
    // for the current mode take up space.
    var inCar = this.mode === 'car';
    var p = this.game.player;
    var canHorn = !!(p && (p.mode === 'car' || p.mode === 'boat'));
    var ux = w - padR;
    for (i = 0; i < this.utilEls.length; i++) {
      var u = this.utilEls[i];
      var sp = u.__spec;
      var hidden = (sp.footOnly && inCar) || (sp.carOnly && !canHorn);
      u.style.display = hidden ? 'none' : '';
      if (hidden) continue;
      u.style.width = u.style.height = util + 'px';
      u.style.top = padT + 'px';
      u.style.left = (ux - util) + 'px';
      u.style.fontSize = Math.round(util * 0.26) + 'px';
      ux -= util + 8;
    }

    // The stick lives in the lower left; big enough that the thumb never
    // hunts for it, short enough that it does not swallow the radar.
    this.stickZone.style.width = Math.min(w * 0.46, this.stickRadius * 3.4) + 'px';
    this.stickZone.style.height = Math.min(h * 0.75, this.stickRadius * 3.6) + 'px';

    this.root.classList.toggle('t-portrait', portrait);
    var rotate = document.getElementById('rotate');
    if (rotate) rotate.classList.toggle('on', portrait);
  };

  // -------------------------------------------------------------- frame ----
  Touch.prototype.render = function (dt) {
    var g = this.game;
    var p = g.player;
    if (!p) return;
    var mode = p.mode === 'foot' ? 'foot' : 'car';
    if (mode !== this.mode) {
      this.releaseAll();
      this.mode = mode;
      this.root.classList.toggle('t-in-car', mode === 'car');
      this.layout();
    }

    // The three primary vehicle controls preserve the same physical layout
    // while changing semantics to match the craft under the player.
    var gas = this.buttons.gas, brake = this.buttons.brake, hand = this.buttons.handbrake;
    function setButton(button, act, label) {
      if (!button) return;
      button.__spec.act = act;
      button.dataset.act = act;
      button.__label.textContent = label;
    }
    if (p.mode === 'plane') {
      setButton(gas, 'boost', 'BOOST');
      setButton(brake, 'handbrake', 'AIRBRAKE');
      if (hand) hand.style.visibility = 'hidden';
    } else if (p.mode === 'heli') {
      setButton(gas, 'jump', 'ASCEND');
      setButton(brake, 'descend', 'DESCEND');
      if (hand) hand.style.visibility = 'hidden';
    } else if (p.mode === 'boat') {
      setButton(gas, 'gas', 'THROTTLE');
      setButton(brake, 'brake', 'REVERSE');
      setButton(hand, 'handbrake', 'BRAKE');
      if (hand) hand.style.visibility = '';
    } else {
      setButton(gas, 'gas', 'GAS');
      setButton(brake, 'brake', 'BRAKE');
      if (p.vehicle && p.vehicle.ability) {
        setButton(hand, 'special', p.vehicle.abilityLabel || 'ABILITY');
        hand.classList.add('t-hot');
      } else {
        setButton(hand, 'handbrake', 'HAND');
        hand.classList.remove('t-hot');
      }
      if (hand) hand.style.visibility = '';
    }

    var cabin = this.buttons.cabin;
    if (cabin) {
      var hasCabin = !!(p.vehicle && p.vehicle.hasInterior);
      cabin.style.display = hasCabin ? 'flex' : 'none';
      cabin.__spec.act = 'interact';
      cabin.dataset.act = 'interact';
      cabin.__label.textContent = p.mode === 'boatInterior' && p.boatInteriorPrompt ? 'EXIT' : 'CABIN';
      cabin.classList.toggle('t-hot', hasCabin && (p.mode === 'boat' || !!p.boatInteriorPrompt));
      cabin.classList.toggle('t-dim', !hasCabin || (p.mode === 'boatInterior' && !p.boatInteriorPrompt));
    }

    // The action button doubles as the door prompt when one is available.
    var actionBtn = this.buttons.action;
    if (actionBtn) {
      var prompt = (g.interiors && g.interiors.prompt) || p.boatInteriorPrompt;
      var spec = actionBtn.__spec;
      if (prompt) {
        spec.act = 'interact';
        actionBtn.__label.textContent = prompt.text.indexOf('Exit') === 0 ? 'EXIT' : 'ENTER';
        actionBtn.classList.add('t-hot');
      } else {
        spec.act = 'enter';
        actionBtn.__label.textContent = p.nearVehicle ? 'GET IN' : 'ENTER';
        actionBtn.classList.toggle('t-hot', !!p.nearVehicle);
      }
      actionBtn.classList.toggle('t-dim', !prompt && !p.nearVehicle);
    }
    var fire = this.buttons.fire;
    if (fire && g.combat) {
      fire.__label.textContent = g.combat.weapon().melee ? 'HIT' : 'FIRE';
    }
    // Dim the exit button at speed: bailing out of a moving car is refused.
    var exitBtn = this.buttons.exit;
    if (exitBtn && p.vehicle) {
      exitBtn.classList.toggle('t-dim', p.vehicle.speed() > 9);
    }
  };

  Touch.prototype.releaseAll = function () {
    var t = this.input.touch;
    t.move.x = t.move.y = 0;
    t.held = Object.create(null);
    this.stickId = -1;
    this.lookId = -1;
    this.hideStick();
    var all = this.footEls.concat(this.carEls, this.utilEls);
    for (var i = 0; i < all.length; i++) all[i].classList.remove('t-down');
  };

  SB.Touch = Touch;

})(window.SB = window.SB || {});
