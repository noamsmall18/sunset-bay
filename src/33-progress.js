// 33-progress.js - rank, respect and the running record of what you have
// actually done in the city.
//
// The sandbox already had money, but money only ever went one way and nothing
// in the world noticed how you earned it. Respect is the second currency: it
// comes from doing things, it never goes down, and it gates the parts of the
// city that should feel earned rather than bought.
(function (SB) {
  'use strict';

  var M = SB.M;

  // Rank thresholds. The curve is deliberately front-loaded: the first two
  // ranks arrive inside the opening few minutes so the system announces
  // itself, then it stretches out.
  var RANKS = [
    { rank: 1, xp: 0, name: 'Drifter' },
    { rank: 2, xp: 120, name: 'Runner' },
    { rank: 3, xp: 360, name: 'Wheelman' },
    { rank: 4, xp: 760, name: 'Fixer' },
    { rank: 5, xp: 1400, name: 'Operator' },
    { rank: 6, xp: 2400, name: 'Shot Caller' },
    { rank: 7, xp: 3900, name: 'Made' },
    { rank: 8, xp: 6000, name: 'Kingpin' },
    { rank: 9, xp: 9000, name: 'Untouchable' },
    { rank: 10, xp: 13500, name: 'Sunset Bay Legend' }
  ];

  // What each thing is worth. Kept in one table so the economy can be read
  // and tuned in one place rather than hunted through eight modules.
  var AWARD = {
    mission: 140,
    sideJob: 40,
    stunt: 25,
    escape: 60,
    copKilled: 12,
    enemyKilled: 8,
    robbery: 90,
    newVehicle: 15,
    district: 30,
    landmark: 20
  };

  function Progress(game) {
    this.game = game;
    this.xp = 0;
    this.rank = 1;
    this.stats = {
      missions: 0, sideJobs: 0, stunts: 0, escapes: 0, busted: 0, deaths: 0,
      copsDown: 0, enemiesDown: 0, robberies: 0, metresDriven: 0, metresFlown: 0,
      metresSailed: 0, metresWalked: 0, topSpeed: 0, earned: 0, spent: 0,
      vehiclesDriven: 0, interiors: 0, playSeconds: 0
    };
    // Sets of ids, kept as plain objects so they serialise straight to JSON.
    this.seenVehicles = {};
    this.seenDistricts = {};
    this.seenInteriors = {};
    this.unlocked = {};
    this._lastPos = null;
    this._toastQueue = [];

    var self = this;
    var bus = game.bus;
    bus.on('missionComplete', function (m) {
      self.stats.missions++;
      self.award(AWARD.mission, 'Job complete');
      if (m && m.reward) self.stats.earned += m.reward;
    });
    bus.on('copKilled', function () { self.stats.copsDown++; self.award(AWARD.copKilled); });
    bus.on('enemyKilled', function () { self.stats.enemiesDown++; self.award(AWARD.enemyKilled); });
    bus.on('busted', function () { self.stats.busted++; });
    bus.on('playerDied', function () { self.stats.deaths++; });
    bus.on('wantedCleared', function () { self.stats.escapes++; self.award(AWARD.escape, 'Lost them'); });
    bus.on('vehicleEntered', function (v) {
      var key = (v && (v.key || (v.spec && v.spec.key))) || null;
      if (key && !self.seenVehicles[key]) {
        self.seenVehicles[key] = 1;
        self.stats.vehiclesDriven++;
        self.award(AWARD.newVehicle, 'New vehicle: ' + ((v.spec && v.spec.name) || key));
      }
    });
    bus.on('interiorEntered', function (room) {
      var id = room && (room.id || room.name);
      if (id && !self.seenInteriors[id]) {
        self.seenInteriors[id] = 1;
        self.stats.interiors++;
        self.award(AWARD.landmark);
      }
    });
  }

  Progress.rankFor = function (xp) {
    var r = RANKS[0];
    for (var i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].xp) r = RANKS[i];
    return r;
  };

  Progress.prototype.rankInfo = function () { return Progress.rankFor(this.xp); };

  Progress.prototype.rankName = function () { return this.rankInfo().name; };

  // Fraction of the way to the next rank, and the xp still owed. The final
  // rank reports full so the bar does not sit permanently at 99%.
  Progress.prototype.rankProgress = function () {
    var here = this.rankInfo();
    var next = null;
    for (var i = 0; i < RANKS.length; i++) if (RANKS[i].xp > this.xp) { next = RANKS[i]; break; }
    if (!next) return { frac: 1, need: 0, next: null };
    return {
      frac: M.clamp((this.xp - here.xp) / (next.xp - here.xp), 0, 1),
      need: next.xp - this.xp,
      next: next
    };
  };

  Progress.prototype.award = function (amount, label) {
    if (!(amount > 0)) return;
    var before = this.rank;
    this.xp += amount;
    this.rank = this.rankInfo().rank;
    if (label && this.game.hud) this.game.hud.toast(label + '  +' + amount + ' RP', '#8fe0a8');
    if (this.rank > before) this.onRankUp();
  };

  Progress.prototype.onRankUp = function () {
    var info = this.rankInfo();
    var g = this.game;
    if (g.hud) {
      g.hud.setTitle('Rank ' + info.rank, info.name);
      g.hud.toast('Rank up: ' + info.name, '#ffd34d');
    }
    // A rank is worth something concrete, not just a word on a screen.
    var bonus = info.rank * 250;
    if (g.player) { g.player.money += bonus; this.stats.earned += bonus; }
    if (g.hud) g.hud.toast('Rank bonus ' + SB.formatMoney(bonus), '#8fe08f');
    if (g.audio) g.audio.blip('rank');
    var unlockedNow = this.refreshUnlocks();
    for (var i = 0; i < unlockedNow.length; i++) {
      if (g.hud) g.hud.toast('Unlocked: ' + unlockedNow[i].name, '#8ed8f2');
    }
    g.bus.emit('rankUp', info);
  };

  // Rank-gated content. Everything here is discoverable in the world anyway;
  // the gate is on the shortcut, not on the existence of the thing.
  var UNLOCKS = [
    { id: 'smgStock', rank: 2, name: 'SMGs in gun shops' },
    { id: 'jobBoard', rank: 2, name: 'Contract board' },
    { id: 'shotgunStock', rank: 3, name: 'Shotguns in gun shops' },
    { id: 'garage', rank: 3, name: 'Personal garage' },
    { id: 'rifleStock', rank: 5, name: 'Carbines in gun shops' },
    { id: 'heavyJobs', rank: 5, name: 'High-risk contracts' },
    { id: 'airJobs', rank: 7, name: 'Air contracts' }
  ];
  Progress.UNLOCKS = UNLOCKS;

  Progress.prototype.refreshUnlocks = function () {
    var gained = [];
    for (var i = 0; i < UNLOCKS.length; i++) {
      var u = UNLOCKS[i];
      if (this.rank >= u.rank && !this.unlocked[u.id]) {
        this.unlocked[u.id] = 1;
        gained.push(u);
      }
    }
    return gained;
  };

  Progress.prototype.has = function (id) { return !!this.unlocked[id]; };

  // Distance and time bookkeeping. Called from the fixed step so the numbers
  // are simulation-rate independent.
  Progress.prototype.fixed = function (dt) {
    var p = this.game.player;
    if (!p) return;
    this.stats.playSeconds += dt;
    var pos = p.pos;
    if (this._lastPos) {
      var d = M.dist(pos.x, pos.z, this._lastPos.x, this._lastPos.z);
      // A respawn or an interior warp is a teleport, not travel.
      if (d < 60) {
        if (p.mode === 'plane' || p.mode === 'heli') this.stats.metresFlown += d;
        else if (p.mode === 'boat') this.stats.metresSailed += d;
        else if (p.mode === 'car') this.stats.metresDriven += d;
        else this.stats.metresWalked += d;
      }
      this._lastPos.x = pos.x; this._lastPos.z = pos.z;
    } else {
      this._lastPos = { x: pos.x, z: pos.z };
    }
    // Vehicle.speed is a method, not a field. Reading it as a field yields a
    // function, Math.abs of which is NaN, and the top speed would sit at zero
    // for the whole run without ever looking broken.
    if (p.vehicle && typeof p.vehicle.speed === 'function') {
      var kph = Math.abs(p.vehicle.speed()) * 3.6;
      if (kph > this.stats.topSpeed && kph < 900) this.stats.topSpeed = kph;
    }
  };

  Progress.prototype.serialize = function () {
    return {
      xp: this.xp, rank: this.rank, stats: this.stats,
      seenVehicles: this.seenVehicles, seenDistricts: this.seenDistricts,
      seenInteriors: this.seenInteriors, unlocked: this.unlocked
    };
  };

  Progress.prototype.restore = function (d) {
    if (!d) return;
    this.xp = +d.xp || 0;
    for (var k in this.stats) if (d.stats && typeof d.stats[k] === 'number') this.stats[k] = d.stats[k];
    this.seenVehicles = d.seenVehicles || {};
    this.seenDistricts = d.seenDistricts || {};
    this.seenInteriors = d.seenInteriors || {};
    this.unlocked = d.unlocked || {};
    this.rank = this.rankInfo().rank;
    this.refreshUnlocks();
  };

  Progress.RANKS = RANKS;
  Progress.AWARD = AWARD;
  SB.Progress = Progress;

})(window.SB = window.SB || {});
