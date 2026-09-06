// 34-save.js - persistence.
//
// Everything the city itself is made of is deterministic from a fixed seed, so
// a save does not have to store a world - only what the player did to it.
// That keeps a save under a couple of kilobytes and means a save written by an
// older build still loads into a newer city.
(function (SB) {
  'use strict';

  var M = SB.M;

  var KEY = 'sunsetbay.save.v1';
  var VERSION = 1;

  var Save = SB.Save = {
    KEY: KEY,
    VERSION: VERSION,
    available: false,
    lastError: null
  };

  // Private browsing, a blocked-cookies setting and a full quota all throw
  // from different calls, so every access is guarded and the game carries on
  // without saving rather than failing to start.
  function store() {
    try {
      var ls = window.localStorage;
      ls.setItem('sunsetbay.probe', '1');
      ls.removeItem('sunsetbay.probe');
      return ls;
    } catch (e) {
      Save.lastError = e;
      return null;
    }
  }

  Save.available = !!store();

  Save.read = function () {
    var ls = store();
    if (!ls) return null;
    try {
      var raw = ls.getItem(KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || data.version !== VERSION) return null;
      return data;
    } catch (e) {
      Save.lastError = e;
      return null;
    }
  };

  Save.has = function () { return !!Save.read(); };

  Save.clear = function () {
    var ls = store();
    if (!ls) return;
    try { ls.removeItem(KEY); } catch (e) { Save.lastError = e; }
  };

  // A one-line description of a save, for the title card.
  Save.summary = function (data) {
    data = data || Save.read();
    if (!data) return null;
    var mins = Math.round((data.progress && data.progress.stats &&
      data.progress.stats.playSeconds || 0) / 60);
    var rank = SB.Progress ? SB.Progress.rankFor(data.progress ? data.progress.xp || 0 : 0) : null;
    return {
      money: data.player ? data.player.money : 0,
      missions: data.missions ? (data.missions.index || 0) : 0,
      rank: rank ? rank.rank : 1,
      rankName: rank ? rank.name : 'Drifter',
      minutes: mins,
      when: data.savedAt || 0
    };
  };

  Save.capture = function (game) {
    var p = game.player, c = game.combat, ms = game.missions;
    if (!p) return null;
    return {
      version: VERSION,
      savedAt: Date.now(),
      player: {
        money: Math.round(p.money),
        health: Math.round(p.health),
        maxHealth: Math.round(p.maxHealth),
        armor: Math.round(p.armor),
        // Position is only restored on foot: re-creating whatever vehicle you
        // happened to be sitting in, on a bridge, mid-air, is not worth the
        // fragility. You wake up standing next to where you stopped.
        x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2), yaw: +p.yaw.toFixed(3)
      },
      combat: c ? { owned: c.owned, ammo: c.ammo, clip: c.clip, index: c.index } : null,
      missions: ms ? {
        index: ms.index,
        completed: ms.completed.slice(0),
        stunts: ms.stunts,
        contracts: ms.contractsDone || 0
      } : null,
      world: {
        hour: game.sky ? +game.sky.hour.toFixed(3) : 9,
        weather: game.weather ? game.weather.mode : 'sun'
      },
      progress: game.progress ? game.progress.serialize() : null,
      garage: game.garage ? game.garage.serialize() : null
    };
  };

  Save.write = function (game) {
    var ls = store();
    if (!ls) return false;
    var data = Save.capture(game);
    if (!data) return false;
    try {
      ls.setItem(KEY, JSON.stringify(data));
      Save.lastError = null;
      return true;
    } catch (e) {
      Save.lastError = e;
      return false;
    }
  };

  // Applying a save is deliberately tolerant: a field that is missing, out of
  // range or from a build that no longer has that weapon is skipped rather
  // than aborting the load.
  Save.apply = function (game, data) {
    data = data || Save.read();
    if (!data) return false;
    var p = game.player, c = game.combat, ms = game.missions;

    if (p && data.player) {
      var d = data.player;
      if (isFinite(d.maxHealth) && d.maxHealth > 0) p.maxHealth = M.clamp(d.maxHealth, 1, 1000);
      if (isFinite(d.health)) p.health = M.clamp(d.health, 1, p.maxHealth);
      if (isFinite(d.armor)) p.armor = M.clamp(d.armor, 0, 100);
      if (isFinite(d.money)) p.money = M.clamp(d.money, 0, 1e9);
      if (isFinite(d.x) && isFinite(d.z)) {
        var srf = game.world.surfaceAt(d.x, d.z, 60, 80);
        p.pos.set(d.x, srf.y + 0.05, d.z);
        p.vel.set(0, 0, 0);
        if (isFinite(d.yaw)) p.yaw = d.yaw;
      }
    }

    if (c && data.combat) {
      var list = SB.WEAPONS || [];
      for (var i = 0; i < list.length; i++) {
        var id = list[i].id;
        if (data.combat.owned && data.combat.owned[id]) c.owned[id] = true;
        if (data.combat.ammo && isFinite(data.combat.ammo[id])) {
          c.ammo[id] = M.clamp(data.combat.ammo[id], 0, list[i].ammoMax || 0);
        }
        if (data.combat.clip && isFinite(data.combat.clip[id])) {
          c.clip[id] = M.clamp(data.combat.clip[id], 0, list[i].clip || 0);
        }
      }
      c.owned.fist = true;
      var want = data.combat.index;
      if (isFinite(want) && list[want] && c.owned[list[want].id]) c.equip(want);
    }

    if (ms && data.missions) {
      ms.index = M.clamp(data.missions.index | 0, 0, (SB.Missions.CHAIN || []).length);
      ms.completed = Array.isArray(data.missions.completed) ? data.missions.completed.slice(0) : [];
      ms.stunts = data.missions.stunts | 0;
      ms.contractsDone = data.missions.contracts | 0;
      ms.refreshBlips();
    }

    if (data.world) {
      if (game.sky && isFinite(data.world.hour)) game.sky.hour = M.clamp(data.world.hour, 0, 24);
      if (game.weather && data.world.weather) game.weather.setMode(data.world.weather, true);
    }

    if (game.progress && data.progress) game.progress.restore(data.progress);
    if (game.garage && data.garage) game.garage.restore(data.garage);
    game.bus.emit('gameLoaded', data);
    return true;
  };

  // ------------------------------------------------------------ autosave ---
  // Autosave is time-based with an event nudge: important moments write
  // immediately, and otherwise the game checkpoints on a slow timer so a
  // crashed tab costs at most half a minute of play.
  var AUTOSAVE_PERIOD = 30;

  Save.attach = function (game) {
    var timer = AUTOSAVE_PERIOD;
    var dirty = false;
    var suppress = 0;

    function flush(reason) {
      if (!Save.available) return;
      if (Save.write(game)) {
        game.bus.emit('gameSaved', { reason: reason });
      }
      dirty = false;
      timer = AUTOSAVE_PERIOD;
    }

    Save.flush = flush;

    ['missionComplete', 'missionFailed', 'weaponPickup', 'busted', 'rankUp']
      .forEach(function (ev) { game.bus.on(ev, function () { dirty = true; }); });
    // Death is the one moment worth a guaranteed write: losing the last
    // thirty seconds of a run because you died is exactly the wrong penalty.
    game.bus.on('playerRespawned', function () { flush('respawn'); });
    game.bus.on('missionComplete', function () { flush('mission'); });

    game.bus.on('shopPurchase', function () { dirty = true; });

    Save.tick = function (dt) {
      if (!Save.available) return;
      timer -= dt;
      suppress -= dt;
      if (timer <= 0) { flush('auto'); }
      else if (dirty && suppress <= 0) { suppress = 4; flush('event'); }
    };

    // A tab closing is the last chance to keep the run.
    window.addEventListener('beforeunload', function () {
      if (game.started && Save.available) Save.write(game);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && game.started && Save.available) Save.write(game);
    });
  };

})(window.SB = window.SB || {});
