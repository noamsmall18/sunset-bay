// Permanent model-specific tuning; each driven car gets its own spec copy.
//
// Named SB.TuneShop rather than SB.Garage, which is what the incoming patch
// called it. 35-garage.js already owns SB.Garage - the bay on the car park
// deck where you store and retrieve cars - and this file sorts after it, so
// the original name would have silently replaced that module for every caller
// that reaches it through `game.garage`: Game.fixed (which calls a fixed()
// this object does not have), SB.Save's serialize, and four places in the HUD.
// The two are different features. This one is the mechanic's shop reached from
// a City Life conversation: upgrades and paint that stick to the MODEL, so
// every car of that type you drive afterwards carries them.
(function (SB) {
  'use strict';
  var PARTS = { engine: ['Engine tune', 700, 8], brakes: ['Brake kit', 500, 10], tires: ['Sport tires', 600, 5] };
  var PAINTS = [['Lagoon', 0x218f98], ['Coral', 0xe76f61], ['Pearl', 0xe7e2d7], ['Midnight', 0x252b43], ['Sunburst', 0xe8b64d]];
  function Garage(game) {
    this.game = game; this.models = {}; this.lastCar = null; this.lastGeneration = 0;
    var self = this;
    game.bus.on('vehicleEntered', function (v) {
      if (!v || v.craftType !== 'car') return;
      self.lastCar = v; self.lastGeneration = v.generation || 0; self.apply(v);
    });
  }
  Garage.prototype.build = function (key) { return this.models[key] || { engine: 0, brakes: 0, tires: 0 }; };
  Garage.prototype.apply = function (car) {
    var stock = SB.VehicleSpecs[car.key]; if (!stock || car.craftType !== 'car') return false;
    var b = this.build(car.key), spec = Object.assign({}, stock);
    spec.gears = stock.gears.slice(); spec.torque *= 1 + b.engine * .08;
    spec.brake *= 1 + b.brakes * .10; spec.muF *= 1 + b.tires * .05; spec.muR *= 1 + b.tires * .05;
    car.spec = spec;
    if (b.paint !== undefined) car.setColor(b.paint);
    return true;
  };
  Garage.prototype.car = function () {
    var g = this.game, p = g.player;
    if (p.dead || g.interiors.current || g.interiors.fadeDir) return null;
    var v = p.vehicle || this.lastCar;
    if (!v || v.craftType !== 'car' || v.destroyed || v.exploded || !v.group.visible) return null;
    if (!p.vehicle && ((v.generation || 0) !== this.lastGeneration ||
      SB.M.dist2(p.pos.x, p.pos.z, v.pos.x, v.pos.z) > 18 * 18 || Math.abs(p.pos.y - v.pos.y) > 4)) return null;
    return v;
  };
  Garage.prototype.ready = function (v) {
    return !!v && this.car() === v && v.speed() < .5 && !(this.game.activities && this.game.activities.active);
  };
  Garage.prototype.save = function () { if (this.game.saveGame) this.game.saveGame.save(); };
  Garage.prototype.buy = function (part) {
    var v = this.car(), p = this.game.player, info = PARTS[part];
    if (!this.ready(v)) return 'Park your car, finish any driving challenge, and stay beside it.';
    if (!info) return 'Choose a listed upgrade.';
    var b = Object.assign({}, this.build(v.key)), level = b[part], trust = this.game.cityLife.reputation;
    if (level >= 3) return 'This part is already at level 3.';
    var needed = [0, 10, 25][level], cost = info[1] * (level + 1);
    if (trust < needed) return 'Level ' + (level + 1) + ' needs ' + needed + ' local trust. Help businesses to unlock it.';
    if (p.money < cost) return 'You need $' + cost + ' for this upgrade.';
    b[part]++; this.models[v.key] = b; p.money -= cost; this.apply(v); this.save();
    return info[0] + ' installed. Every ' + v.name + ' you drive now uses this build.';
  };
  Garage.prototype.repairCost = function (v) { return Math.ceil(90 + Math.max(0, v.maxHealth - v.health) * .3); };
  Garage.prototype.repair = function () {
    var v = this.car(), p = this.game.player;
    if (!this.ready(v)) return 'Stop in a driveable car before requesting repairs.';
    if (v.health >= v.maxHealth && !v.burning && !v.smoking) return 'Your car is already in good condition.';
    var cost = this.repairCost(v); if (p.money < cost) return 'Repairs cost $' + cost + '.';
    p.money -= cost; v.health = v.maxHealth; v.burning = 0; v.smoking = false; this.save();
    return 'Body and engine repaired. Ready for another run.';
  };
  Garage.prototype.paint = function (color) {
    var v = this.car(), p = this.game.player;
    if (!this.ready(v) || !PAINTS.some(function (c) { return c[1] === color; })) return 'Park your car before choosing a finish.';
    if (this.build(v.key).paint === color) return 'That finish is already installed.';
    if (p.money < 150) return 'A new finish costs $150.';
    var b = Object.assign({}, this.build(v.key)); b.paint = color; this.models[v.key] = b;
    p.money -= 150; this.apply(v); this.save(); return 'Fresh paint applied and saved for this model.';
  };
  Garage.prototype.menu = function (notice) {
    var self = this, g = this.game, v = this.car(), life = g.cityLife;
    if (!v) { life.show('Bay Garage', 'Get into a road car, park, then open GO / Explore → Garage. You can also step out and stay within 18 metres.\n\nUpgrades and paint are saved for each model, so they return when you drive another car of the same type.', []); return; }
    var b = this.build(v.key), text = (notice ? notice + '\n\n' : '') + v.name + ' · Condition ' + Math.round(v.health / v.maxHealth * 100) + '%\nEngine +' + b.engine * 8 + '% torque · Brakes +' + b.brakes * 10 + '% · Grip +' + b.tires * 5 + '%\nBalance: $' + Math.floor(g.player.money) + '\n\nLevel 2 needs 10 local trust; level 3 needs 25. Upgrades apply to this model whenever you drive it.';
    var choices = Object.keys(PARTS).map(function (part) {
      var info = PARTS[part], level = b[part];
      return [info[0] + ' · ' + level + '/3' + (level < 3 ? ' → $' + info[1] * (level + 1) : ' · Complete'), function () { self.menu(self.buy(part)); }];
    });
    choices.push(['Repair · $' + this.repairCost(v), function () { self.menu(self.repair()); }]);
    choices.push(['Paint shop · $150', function () {
      life.show('Choose a finish', 'Finish saved for ' + v.name + '. Each change costs $150.', PAINTS.map(function (c) {
        return [c[0], function () { self.menu(self.paint(c[1])); }];
      }).concat([['Return to garage', function () { self.menu(); }]]));
    }]);
    life.show('Bay Garage', text, choices);
  };
  Garage.prototype.snapshot = function () { return this.models; };
  Garage.prototype.restore = function (data) {
    this.models = {}; if (!data || typeof data !== 'object') return;
    var self = this;
    Object.keys(SB.VehicleSpecs).forEach(function (key) {
      var raw = data[key]; if (!raw || typeof raw !== 'object') return;
      var b = { engine: 0, brakes: 0, tires: 0 };
      Object.keys(PARTS).forEach(function (p) { if (Number.isInteger(raw[p])) b[p] = SB.M.clamp(raw[p], 0, 3); });
      if (PAINTS.some(function (c) { return c[1] === raw.paint; })) b.paint = raw.paint;
      self.models[key] = b;
    });
    if (this.game.player.vehicle) this.apply(this.game.player.vehicle);
  };
  SB.TuneShop = Garage;
})(window.SB = window.SB || {});
