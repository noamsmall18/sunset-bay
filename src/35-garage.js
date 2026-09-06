// 35-garage.js - the personal garage: a bay you can leave a car in, come back
// to, respray, and spend money making faster.
//
// The rank-3 "Personal garage" unlock previously granted nothing at all. This
// is what it grants. The bay sits on the ground deck of the multi-storey car
// park, which was already a drivable structure with nothing to do in it.
(function (SB) {
  'use strict';

  var M = SB.M;

  // Upgrade ladders. Each tier multiplies one field of the vehicle spec, so an
  // upgraded car is genuinely a different car to drive rather than a label.
  // Prices climb steeply: a fully built car should cost more than the story
  // chain pays out for a single job.
  var UPGRADES = {
    engine: {
      name: 'Engine', field: 'torque',
      tiers: [
        { name: 'Stock', mul: 1.00, price: 0 },
        { name: 'Stage 1', mul: 1.14, price: 2200 },
        { name: 'Stage 2', mul: 1.30, price: 6500 },
        { name: 'Stage 3', mul: 1.48, price: 15000 }
      ]
    },
    brakes: {
      name: 'Brakes', field: 'brake',
      tiers: [
        { name: 'Stock', mul: 1.00, price: 0 },
        { name: 'Sport', mul: 1.18, price: 1600 },
        { name: 'Race', mul: 1.38, price: 4800 }
      ]
    },
    tyres: {
      name: 'Tyres', field: 'grip',
      tiers: [
        { name: 'Stock', mul: 1.00, price: 0 },
        { name: 'Performance', mul: 1.08, price: 2400 },
        { name: 'Semi-slick', mul: 1.16, price: 7200 }
      ]
    }
  };
  var UPGRADE_ORDER = ['engine', 'brakes', 'tyres'];

  // Slot count grows with rank, so the garage keeps paying off.
  function slotsFor(rank) { return M.clamp(2 + Math.floor((rank - 3) / 2), 2, 6); }

  function Garage(game) {
    this.game = game;
    this.slots = [];        // { key, color, upgrades:{engine,brakes,tyres}, name }
    this.cooldown = 0;
    this.menu = null;
    this.pendingStore = null;
    this.prompt = null;
    this.bay = null;
    this.marker = null;
    this.build();
  }

  Garage.prototype.available = function () {
    var prog = this.game.progress;
    return !prog || prog.has('garage');
  };

  Garage.prototype.capacity = function () {
    return slotsFor(this.game.progress ? this.game.progress.rank : 3);
  };

  // The bay is a painted rectangle on the ground deck of the car park, next to
  // the entry ramp so you drive straight into it.
  Garage.prototype.build = function () {
    var P = this.game.props;
    var g = P && P.garage;
    if (!g) return;
    var cx = (g.x0 + g.x1) / 2;
    // Sit the bay toward the entry end but clear of the ramp corridor.
    var cz = g.z0 + (g.z1 - g.z0) * 0.26;
    var hw = 3.2, hd = 5.4;
    // decks[0] is the nominal ground level of the structure, but the ground
    // floor of the car park has no slab of its own - the structure only pours
    // decks 1..3, and you drive in onto the terrain. So the floor height is
    // the terrain height. A surfaceAt query is the wrong tool here: its
    // tolerance window happily returns the deck overhead instead.
    var floorY = this.game.world.baseHeight(cx, cz);
    this.bay = { x: cx, z: cz, hw: hw, hd: hd, y: floorY };

    var group = new THREE.Group();
    group.name = 'personal-garage';

    // The car park's ground floor is bare terrain, which here is grass. A
    // concrete pad under the bay stops your garage looking like a field with
    // lines painted on it.
    var pad = new THREE.Mesh(
      new THREE.BoxGeometry(hw * 2 + 2.4, 0.12, hd * 2 + 2.4),
      new THREE.MeshStandardMaterial({ color: 0x6f7378, roughness: 0.94 }));
    pad.position.set(cx, this.bay.y + 0.06, cz);
    pad.receiveShadow = true;
    group.add(pad);

    // Painted bay outline. Drawn as a thin slab just above the deck rather
    // than a decal, so it survives whatever the deck material is doing.
    var paint = new THREE.MeshStandardMaterial({
      color: 0xf2c14e, roughness: 0.7, transparent: true, opacity: 0.85
    });
    var lines = [
      [hw * 2, 0.16, 0, -hd],
      [hw * 2, 0.16, 0, hd],
      [0.16, hd * 2, -hw, 0],
      [0.16, hd * 2, hw, 0]
    ];
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      var bar = new THREE.Mesh(new THREE.BoxGeometry(L[0], 0.04, L[1]), paint);
      bar.position.set(cx + L[2], this.bay.y + 0.13, cz + L[3]);
      group.add(bar);
    }

    // A sign so the bay reads as a place rather than as road markings.
    var canvas = SB.Tex.canvas(512, 128);
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#12161c'; ctx.fillRect(0, 0, 512, 128);
    ctx.font = 'bold 58px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd76b';
    ctx.fillText('YOUR GARAGE', 256, 64);
    var tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.6),
      new THREE.MeshStandardMaterial({
        map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55,
        transparent: true
      }));
    sign.position.set(cx, this.bay.y + 2.6, cz - hd - 0.2);
    sign.rotation.y = Math.PI;
    group.add(sign);

    // A soft column of light marks it from across the deck.
    var beam = new THREE.Mesh(
      new THREE.CylinderGeometry(hw * 0.8, hw * 0.8, 3.2, 18, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffc83c, transparent: true, opacity: 0.055,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
      }));
    beam.position.set(cx, this.bay.y + 1.6, cz);
    group.add(beam);
    this.marker = beam;

    // The ground deck is an enclosed concrete box with three floors over it,
    // so nothing down here is lit by the sky. One real light makes the bay
    // read as a place rather than a shape in the dark.
    var lamp = new THREE.PointLight(0xffe9c4, 26, 22, 2);
    lamp.position.set(cx, this.bay.y + 3.4, cz);
    group.add(lamp);
    this.lamp = lamp;

    this.game.scene.add(group);
    this.root = group;
  };

  Garage.prototype.inBay = function (x, z) {
    var b = this.bay;
    if (!b) return false;
    return Math.abs(x - b.x) <= b.hw && Math.abs(z - b.z) <= b.hd;
  };

  // ----------------------------------------------------------- upgrades ----
  // Upgrades are applied to a per-vehicle COPY of the shared spec. Writing
  // them into SPECS[key] would silently upgrade every taxi in the city.
  Garage.prototype.applyUpgrades = function (v, up) {
    if (!v || !up) return;
    var base = SB.VehicleSpecs[v.key];
    if (!base) return;
    var spec = {};
    for (var k in base) spec[k] = base[k];
    for (var i = 0; i < UPGRADE_ORDER.length; i++) {
      var id = UPGRADE_ORDER[i];
      var lad = UPGRADES[id];
      var tier = lad.tiers[M.clamp(up[id] | 0, 0, lad.tiers.length - 1)];
      if (!tier || tier.mul === 1) continue;
      if (lad.field === 'grip') {
        spec.muF = base.muF * tier.mul;
        spec.muR = base.muR * tier.mul;
      } else {
        spec[lad.field] = base[lad.field] * tier.mul;
      }
    }
    v.spec = spec;
    v.upgrades = up;
  };

  Garage.prototype.upgradeCost = function (slot, id) {
    var lad = UPGRADES[id];
    var next = (slot.upgrades[id] | 0) + 1;
    if (next >= lad.tiers.length) return null;
    return { tier: next, price: lad.tiers[next].price, name: lad.tiers[next].name };
  };

  // ------------------------------------------------------------ storing ----
  Garage.prototype.store = function (v) {
    if (this.slots.length >= this.capacity()) {
      this.toast('Garage is full (' + this.capacity() + ' bays)');
      return false;
    }
    for (var i = 0; i < this.slots.length; i++) {
      if (this.slots[i].live === v) return false;
    }
    var entry = {
      key: v.key,
      name: (SB.VehicleSpecs[v.key] && SB.VehicleSpecs[v.key].name) || v.key,
      color: v.color !== undefined ? v.color : 0xb8bcc2,
      upgrades: v.upgrades || { engine: 0, brakes: 0, tyres: 0 },
      health: Math.round(v.health)
    };
    this.slots.push(entry);
    this.toast('Stored: ' + entry.name, '#8fe0a8');
    if (this.game.audio) this.game.audio.blip('door');
    return true;
  };

  Garage.prototype.retrieve = function (index) {
    var slot = this.slots[index];
    if (!slot) return null;
    var t = this.game.traffic;
    if (!t) return null;
    var b = this.bay;
    var v = t.spawnParked(slot.key, b.x, b.z, -Math.PI / 2, slot.color);
    if (!v) return null;
    // Vehicle.placeAt resolves its height with a surface query from 50 m up,
    // which finds the TOP-most surface. Under a three-deck car park that is
    // the roof, so a car fetched from the garage appeared on the roof instead
    // of in the bay. Put it on the bay floor explicitly; the per-wheel
    // suspension query is relative to the car's own height, so once it starts
    // on the ground floor it stays there.
    v.pos.y = b.y + (v.spec.wheelR || 0.33) + 0.02;
    v.vy = 0;
    v.syncMesh();
    // A retrieved car comes out repaired: the garage is also where the damage
    // you drove in with gets fixed.
    v.health = v.maxHealth;
    v.destroyed = false;
    v.smoking = false;
    v.burning = 0;
    if (v.repairBody) v.repairBody();
    this.applyUpgrades(v, slot.upgrades);
    this.slots.splice(index, 1);
    this.toast('Brought out: ' + slot.name, '#8fe0a8');
    if (this.game.audio) this.game.audio.blip('door');
    return v;
  };

  // Return a stored car's body to the pool. recycle() alone only pools it -
  // the caller owns removing it from whichever live list it is on, or the
  // car keeps being simulated as an invisible ghost sitting in the bay.
  Garage.prototype.recycleBody = function (v) {
    var t = this.game.traffic;
    if (!t || !v) return;
    var i = t.loose.indexOf(v);
    if (i >= 0) t.loose.splice(i, 1);
    i = t.parked.indexOf(v);
    if (i >= 0) t.parked.splice(i, 1);
    i = t.active.indexOf(v);
    if (i >= 0) t.active.splice(i, 1);
    if (v.spot) { v.spot.taken = false; v.spot = null; }
    t.recycle(v);
  };

  Garage.prototype.toast = function (text, accent) {
    if (this.game.hud) this.game.hud.toast(text, accent);
  };

  // --------------------------------------------------------------- step ----
  Garage.prototype.fixed = function (dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    var g = this.game, p = g.player;
    if (!p || !this.bay) return;

    // Finish a store that was waiting on the exit animation. If the exit was
    // refused (a wall in the doorway, say) the intent expires rather than
    // hanging around to fire at some unrelated later moment.
    if (this.pendingStore) {
      this.pendingStore.timeout -= dt;
      var pv = this.pendingStore.v;
      if (p.mode === 'foot' && p.vehicle !== pv) {
        this.pendingStore = null;
        if (this.store(pv)) this.recycleBody(pv);
      } else if (this.pendingStore.timeout <= 0) {
        this.pendingStore = null;
      }
    }

    var lit = this.available() && this.inBay(p.pos.x, p.pos.z);
    if (this.marker) this.marker.visible = this.available();

    if (!lit) { this.prompt = null; return; }
    if (!this.available()) return;

    if (p.mode === 'car' && p.vehicle) {
      // Drive in, stop, press the interact key to leave the car here.
      if (p.vehicle.speed() > 1.5) { this.prompt = null; return; }
      if (this.slots.length >= this.capacity()) {
        this.prompt = 'Garage full  ·  ' + this.capacity() + ' bays';
        return;
      }
      this.prompt = 'Store ' + (p.vehicle.name || 'vehicle');
      if (g.input.actHit('interact') && this.cooldown <= 0) {
        this.cooldown = 0.8;
        // Getting out is a 0.35 s animation, so the car cannot be recycled
        // here - the player is still sitting in it. Remember the intent and
        // finish the job once they are actually standing on the deck.
        this.pendingStore = { v: p.vehicle, timeout: 3 };
        p.beginExit();
      }
      return;
    }

    if (p.mode === 'foot') {
      this.prompt = this.slots.length
        ? 'Garage  ·  ' + this.slots.length + '/' + this.capacity() + ' stored'
        : 'Garage  ·  empty  ·  drive a car in to store it';
      if (g.input.actHit('interact') && this.cooldown <= 0 && this.slots.length) {
        this.cooldown = 0.5;
        if (g.hud) g.hud.openGarage(this);
      }
    }
  };

  // ------------------------------------------------------------- saving ----
  Garage.prototype.serialize = function () {
    var out = [];
    for (var i = 0; i < this.slots.length; i++) {
      var s = this.slots[i];
      out.push({ key: s.key, color: s.color, upgrades: s.upgrades });
    }
    return out;
  };

  Garage.prototype.restore = function (list) {
    this.slots.length = 0;
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length && i < 8; i++) {
      var s = list[i];
      if (!s || !SB.VehicleSpecs[s.key]) continue;   // a key this build no longer has
      var up = s.upgrades || {};
      this.slots.push({
        key: s.key,
        name: SB.VehicleSpecs[s.key].name || s.key,
        color: isFinite(s.color) ? s.color : 0xb8bcc2,
        upgrades: {
          engine: M.clamp(up.engine | 0, 0, UPGRADES.engine.tiers.length - 1),
          brakes: M.clamp(up.brakes | 0, 0, UPGRADES.brakes.tiers.length - 1),
          tyres: M.clamp(up.tyres | 0, 0, UPGRADES.tyres.tiers.length - 1)
        }
      });
    }
  };

  // Short readout of what a stored car has been given, for the menu list.
  Garage.tierSummary = function (slot) {
    var parts = [];
    for (var i = 0; i < UPGRADE_ORDER.length; i++) {
      var id = UPGRADE_ORDER[i];
      var lvl = slot.upgrades[id] | 0;
      if (lvl > 0) parts.push(UPGRADES[id].name[0] + lvl);
    }
    return parts.length ? parts.join(' ') : 'stock';
  };

  Garage.UPGRADES = UPGRADES;
  Garage.UPGRADE_ORDER = UPGRADE_ORDER;
  Garage.PAINT_NAMES = ['Silver', 'Graphite', 'Crimson', 'Navy', 'Bone', 'Forest',
    'Amber', 'Slate', 'Gunmetal', 'Platinum', 'Deep', 'Wine', 'Ivory', 'Steel'];
  SB.Garage = Garage;

})(window.SB = window.SB || {});
