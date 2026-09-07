// Repeatable, location-based courier work. No new world geometry or NPC pool.
(function (SB) {
  'use strict';
  function Deliveries(game) {
    this.game = game; this.active = null; this.completed = 0; this.earned = 0; this.cooldown = 0;
    this.uiTimer = 0; this.lastText = ''; this.panel = null;
    var self = this;
    ['busted', 'playerRespawned'].forEach(function (event) { game.bus.on(event, function () { self.cancel('Delivery cancelled. The dispatch office recovered the package.'); }); });
  }
  Deliveries.prototype.offer = function () {
    var g = this.game, origin = g.interiors.current, point = g.player.pos;
    if (origin) { var source = g.interiors.doors.find(function (d) { return d.room === origin; }); if (source) point = source; }
    var doors = g.interiors.doors.filter(function (d) {
      var distance = SB.M.dist(point.x, point.z, d.x, d.z);
      return d.room !== origin && distance > 180 && distance < 1200;
    });
    if (!doors.length) return null;
    var door = doors[(this.completed * 17 + (origin ? origin.index : 0)) % doors.length];
    var distance = SB.M.dist(point.x, point.z, door.x, door.z);
    var parcels = { clinic: 'sealed medical supplies', diner: 'fresh ingredients', hotel: 'a guest’s lost luggage', club: 'replacement audio equipment', warehouse: 'a signed shipping manifest' };
    return { door: door, cargo: parcels[door.room.service] || 'a tracked document pouch',
      reward: Math.round(160 + distance * .55), limit: Math.ceil(100 + distance / 5), elapsed: 0 };
  };
  Deliveries.prototype.track = function () {
    if (!this.active) return;
    var d = this.active.door;
    this.game.hud.setDestination({ id: 'courier', name: 'Delivery · ' + d.name, x: d.x, z: d.z, color: '#78dfaa', icon: '▣', kind: 'waypoint' });
  };
  Deliveries.prototype.accept = function (offer) {
    if (this.active || this.cooldown > 0 || !offer || !this.game.interiors.doors.includes(offer.door)) return false;
    if (this.game.activities && this.game.activities.active) return false;
    this.active = { door: offer.door, cargo: offer.cargo, reward: offer.reward, limit: offer.limit, elapsed: 0 };
    this.track(); return true;
  };
  Deliveries.prototype.clearRoute = function () {
    var h = this.game.hud;
    if (h.destination && h.destination.id === 'courier') { h.destination = null; if (h.navigation) h.navigation.points = []; }
  };
  Deliveries.prototype.cancel = function (reason) {
    if (!this.active) return false;
    this.active = null; this.cooldown = 8; this.clearRoute();
    if (reason) this.game.hud.toast(reason); return true;
  };
  Deliveries.prototype.canHandoff = function () {
    var g = this.game, a = this.active, p = g.player;
    if (!a || p.dead || p.mode !== 'foot' || g.interiors.fadeDir) return false;
    if (g.interiors.current === a.door.room) return true;
    return !g.interiors.current && SB.M.dist(p.pos.x, p.pos.z, a.door.x, a.door.z) < 3 && Math.abs(p.pos.y - (a.door.building ? a.door.building.baseY || 0 : a.door.y || 0)) < 4;
  };
  Deliveries.prototype.handoff = function () {
    if (!this.canHandoff()) return false;
    var a = this.active, bonus = a.elapsed < a.limit * .65 ? Math.round(a.reward * .25) : 0;
    var pay = a.reward + bonus;
    this.active = null; this.completed++; this.earned += pay; this.cooldown = 15; this.clearRoute();
    this.game.player.money += pay;
    if (this.game.cityLife) this.game.cityLife.reputation = Math.min(100, this.game.cityLife.reputation + 3);
    this.game.hud.toast('Delivered · +$' + pay + (bonus ? ' including a $' + bonus + ' early bonus' : '') + ' · Local trust +3');
    if (this.game.saveGame) this.game.saveGame.save(); return true;
  };
  Deliveries.prototype.menu = function () {
    var self = this, life = this.game.cityLife;
    if (this.active) {
      var a = this.active;
      life.show('Courier dispatch', 'Deliver ' + a.cargo + ' to ' + a.door.name + '.\n' + Math.ceil(a.limit-a.elapsed) + ' seconds remaining. Stop on foot at the entrance and use the interaction button.', [
        ['Track package destination', function () { self.track(); life.close(); }],
        ['Cancel delivery', function () { self.cancel('Delivery cancelled.'); life.close(); }]
      ]); return;
    }
    var offer = this.offer();
    if (!offer || this.cooldown > 0 || (this.game.activities && this.game.activities.active)) {
      life.show('Courier dispatch', 'Dispatch is unavailable during a race or briefly after a delivery. Try again shortly.', []); return;
    }
    life.show('Courier contract', 'Take ' + offer.cargo + ' to ' + offer.door.name + '.\nPayment: $' + offer.reward + ' · Time: ' + offer.limit + ' seconds.\nArrive within 65% of the time limit for a 25% bonus. The package is collected now; deliver on foot at the marked entrance. Active contracts do not survive a reload.', [
      ['Accept delivery', function () { if (self.accept(offer)) life.close(); }]
    ]);
  };
  Deliveries.prototype.fixed = function (dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!this.active) return;
    if (this.game.player.dead) { this.cancel('Delivery cancelled.'); return; }
    this.active.elapsed += dt;
    if (this.active.elapsed >= this.active.limit) this.cancel('Delivery expired. Find a courier for another contract.');
  };
  Deliveries.prototype.render = function (dt) {
    this.uiTimer -= dt; if (this.uiTimer > 0) return; this.uiTimer = .2;
    if (!this.panel) {
      this.panel = document.createElement('div'); this.panel.className = 'delivery-status';
      this.panel.setAttribute('role', 'status'); document.body.appendChild(this.panel);
      var style = document.createElement('style');
      style.textContent = '.delivery-status{position:fixed;top:110px;left:50%;transform:translateX(-50%);max-width:72vw;padding:9px 14px;border:1px solid #579e82;border-radius:12px;background:#0b211fed;color:#c9ffdf;text-align:center;font:600 12px/1.4 system-ui;pointer-events:none;z-index:12}.delivery-status[hidden]{display:none}@media(max-height:500px){.delivery-status{top:65px;font-size:11px;max-width:45vw}}';
      document.head.appendChild(style);
    }
    this.panel.hidden = !this.active || this.game.paused || !this.game.started;
    if (!this.active) return;
    var a = this.active, text = 'COURIER · ' + a.door.name + ' · ' + Math.ceil(a.limit-a.elapsed) + 's · $' + a.reward;
    if (this.lastText !== text) { this.panel.textContent = text; this.lastText = text; }
  };
  Deliveries.prototype.snapshot = function () { return { completed: this.completed, earned: this.earned }; };
  Deliveries.prototype.restore = function (data) {
    if (!data) return;
    this.completed = Number.isInteger(data.completed) ? SB.M.clamp(data.completed,0,100000) : 0;
    this.earned = Number.isFinite(data.earned) ? SB.M.clamp(data.earned,0,1e9) : 0;
  };
  SB.Deliveries = Deliveries;
})(window.SB = window.SB || {});
