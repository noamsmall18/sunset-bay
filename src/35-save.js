// Versioned, device-local progress. Active missions/races restart at their
// beginning after reload; the player returns to the safe starting location.
(function (SB) {
  'use strict';
  var KEY = 'sunsetbay.progress.v1';
  function finite(value, low, high, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(low, Math.min(high, value)) : fallback;
  }
  function SaveGame(game) {
    this.game = game; this.timer = 0; this.lastSaved = 0; this.failed = false;
    var self = this;
    ['missionComplete', 'playerRespawned', 'busted'].forEach(function (event) {
      game.bus.on(event, function () { self.save(); });
    });
    window.addEventListener('pagehide', function () { self.save(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) self.save(); });
  }
  // This file no longer stores money, armour, mission progress or weapons.
  // SB.Save (34-save.js) already owns all four, and two systems writing the
  // same fields to two different keys meant whichever restored last won.
  // What remains here is what only this expansion knows about: race records,
  // discoveries, speed-trap bests, looted rooms, deliveries and city life.
  SaveGame.prototype.snapshot = function () {
    var g = this.game, a = g.activities;
    var rooms = [];
    if (g.interiors) g.interiors.rooms.forEach(function (r) {
      if (r.robbed || r.stashTaken) rooms.push({ index: r.index, robbed: !!r.robbed, stashTaken: !!r.stashTaken });
    });
    // The patch's version of this line re-adds money, armour, mission index,
    // completed missions and the weapon loadout. All five belong to SB.Save
    // (34-save.js) under a different key, and two systems writing the same
    // fields to two keys is the collision that was resolved when the coastal
    // expansion landed: whichever restored last won, and the two halves could
    // come from different points in time. The three new subsystems are taken;
    // the shared fields stay where they already live. (The patch's line also
    // reads a `c` that only exists in its own base file, so keeping it would
    // have thrown a ReferenceError on every save.)
    return {
      version: 1, savedAt: Date.now(),
      neighbors: g.neighbors ? g.neighbors.snapshot() : null,
      pastimes: g.pastimes ? g.pastimes.snapshot() : null,
      tuneShop: g.tuneShop ? g.tuneShop.snapshot() : null,
      deliveries: g.deliveries ? g.deliveries.snapshot() : null,
      life: g.cityLife ? g.cityLife.snapshot() : null,
      records: a ? a.records : {}, discoveries: a ? a.discoveries : {},
      trapRecords: a ? a.trapRecords : {}, rooms: rooms
    };
  };
  SaveGame.prototype.save = function () {
    if (this.game.dev || !this.game.player) return false;
    try {
      var data = this.snapshot(); localStorage.setItem(KEY, JSON.stringify(data));
      this.lastSaved = data.savedAt; this.failed = false; this.timer = 0; return true;
    } catch (err) { this.failed = true; return false; }
  };
  SaveGame.prototype.restore = function () {
    if (this.game.dev) return false;
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw || raw.length > 200000) return false;
      var data = JSON.parse(raw), g = this.game;
      if (!data || data.version !== 1) return false;
      var a = g.activities;
      if (a) {
        a.courses.forEach(function (course) {
          var record = data.records && data.records[course.id];
          if (record && finite(record.time, 0, 100000, -1) > 0 && ['GOLD', 'SILVER', 'BRONZE', 'FINISHER'].indexOf(record.medal) >= 0) {
            a.records[course.id] = { time: Math.min(100000, record.time), medal: record.medal };
          }
        });
        if (g.coast) g.coast.landmarks.forEach(function (lm) {
          if (data.discoveries && data.discoveries[lm.id] === true) a.discoveries[lm.id] = true;
        });
        a.traps.forEach(function (trap) { a.trapRecords[trap.id] = finite(data.trapRecords && data.trapRecords[trap.id], 0, 1000, 0); });
      }
      if (Array.isArray(data.rooms) && g.interiors) data.rooms.slice(0, g.interiors.rooms.length).forEach(function (entry) {
        if (!entry || !Number.isInteger(entry.index)) return;
        var room = g.interiors.rooms[entry.index];
        if (room) { room.robbed = entry.robbed === true; room.stashTaken = entry.stashTaken === true; }
      });
      if (g.cityLife) g.cityLife.restore(data.life);
      if (g.deliveries) g.deliveries.restore(data.deliveries);
      if (g.pastimes) g.pastimes.restore(data.pastimes);
      if (g.tuneShop) g.tuneShop.restore(data.tuneShop);
      if (g.neighbors) g.neighbors.restore(data.neighbors);
      this.lastSaved = finite(data.savedAt, 0, Date.now(), 0);
      return true;
    } catch (err) { this.failed = true; return false; }
  };
  // Starting a new game has to drop this file as well, or a fresh run
  // inherits the previous one's race records and looted rooms.
  SaveGame.prototype.clear = function () {
    try { localStorage.removeItem(KEY); this.lastSaved = 0; } catch (err) { this.failed = true; }
  };

  SaveGame.prototype.fixed = function (dt) {
    this.timer += dt;
    if (this.timer >= 30) { this.timer = 0; this.save(); }
  };
  SB.SaveGame = SaveGame;
})(window.SB = window.SB || {});
