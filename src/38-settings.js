// 38-settings.js - player settings, and the accessibility options the game
// shipped without.
//
// Until now the only thing a player could change was the graphics budget.
// There was no volume control of any kind - not a slider, not a mute - in a
// game with a synthesised soundtrack, engine noise and sirens, which leaves
// muting the whole browser tab as the only option. There was no way to change
// look sensitivity or invert the Y axis, both of which some people simply
// cannot play without. And camera shake, head bob and motion blur had no off
// switch, which for a motion-sensitive player is not a preference but the
// difference between playable and not.
//
// Everything here is stored per device and applied live.
(function (SB) {
  'use strict';

  var M = SB.M;
  var KEY = 'sunsetbay.settings.v1';

  // name: [default, min, max]. Booleans use 0/1 so one clamp covers everything
  // and a corrupted value can never arrive as a string.
  var DEFS = {
    volMaster: [0.85, 0, 1],
    volEffects: [1.00, 0, 1],
    volMusic: [0.30, 0, 1],
    muted: [0, 0, 1],
    lookSpeed: [1.00, 0.25, 3],
    invertY: [0, 0, 1],
    reduceMotion: [0, 0, 1],
    hudScale: [1.00, 0.75, 1.4]
  };

  var Settings = SB.Settings = {
    values: {},
    game: null
  };

  function storage() {
    try {
      var ls = window.localStorage;
      ls.setItem('sunsetbay.probe', '1');
      ls.removeItem('sunsetbay.probe');
      return ls;
    } catch (e) { return null; }
  }

  Settings.defaults = function () {
    var out = {};
    for (var k in DEFS) out[k] = DEFS[k][0];
    return out;
  };

  // Every read is clamped against the table rather than trusted, so a hand
  // edited or half-written localStorage entry cannot put the game into a
  // state with no audio and no way to discover why.
  Settings.sanitize = function (raw) {
    var out = Settings.defaults();
    if (!raw || typeof raw !== 'object') return out;
    for (var k in DEFS) {
      var v = raw[k];
      if (typeof v === 'boolean') v = v ? 1 : 0;
      if (typeof v !== 'number' || !isFinite(v)) continue;
      out[k] = M.clamp(v, DEFS[k][1], DEFS[k][2]);
    }
    return out;
  };

  Settings.load = function () {
    var ls = storage();
    var raw = null;
    if (ls) {
      try { raw = JSON.parse(ls.getItem(KEY) || 'null'); } catch (e) { raw = null; }
    }
    Settings.values = Settings.sanitize(raw);
    return Settings.values;
  };

  Settings.save = function () {
    var ls = storage();
    if (!ls) return false;
    try { ls.setItem(KEY, JSON.stringify(Settings.values)); return true; }
    catch (e) { return false; }
  };

  Settings.get = function (name) {
    if (!(name in DEFS)) return undefined;
    if (!(name in Settings.values)) Settings.load();
    return Settings.values[name];
  };

  Settings.set = function (name, value) {
    if (!(name in DEFS)) return;
    if (typeof value === 'boolean') value = value ? 1 : 0;
    if (typeof value !== 'number' || !isFinite(value)) return;
    Settings.values[name] = M.clamp(value, DEFS[name][1], DEFS[name][2]);
    Settings.apply();
    Settings.save();
  };

  Settings.reset = function () {
    Settings.values = Settings.defaults();
    Settings.apply();
    Settings.save();
  };

  // ------------------------------------------------------------- apply ----
  // Audio is the only setting with somewhere to push to; the rest are read
  // where they are used, so they take effect on the next frame without any
  // wiring.
  Settings.apply = function () {
    var g = Settings.game;
    var v = Settings.values;
    if (!g || !g.audio || !g.audio.ready) return;
    var a = g.audio;
    var master = v.muted ? 0 : v.volMaster;
    // setTargetAtTime rather than a straight assignment: stepping a gain
    // node discontinuously is audible as a click on every slider move.
    try {
      var t = a.ctx.currentTime;
      a.master.gain.setTargetAtTime(master, t, 0.02);
      a.sfxBus.gain.setTargetAtTime(v.volEffects, t, 0.02);
      a.musicBus.gain.setTargetAtTime(v.volMusic, t, 0.02);
    } catch (e) {
      a.master.gain.value = master;
      a.sfxBus.gain.value = v.volEffects;
      a.musicBus.gain.value = v.volMusic;
    }
  };

  Settings.attach = function (game) {
    Settings.game = game;
    Settings.load();
    Settings.apply();
  };

  // --------------------------------------------------- read-side helpers ---
  // Multiplier on the look delta. Kept as a function so the player and the
  // free camera cannot drift apart on what "sensitivity" means.
  Settings.lookScale = function () {
    return Settings.get('lookSpeed');
  };

  // +1 normally, -1 when the player inverts the vertical axis.
  Settings.lookInvertY = function () {
    return Settings.get('invertY') ? -1 : 1;
  };

  // 0 when the player has asked for reduced motion, 1 otherwise. Multiplied
  // into camera shake and head bob rather than branching at each site.
  Settings.motionScale = function () {
    return Settings.get('reduceMotion') ? 0 : 1;
  };

  Settings.hudScale = function () {
    return Settings.get('hudScale');
  };

  Settings.DEFS = DEFS;
  Settings.KEY = KEY;

})(window.SB = window.SB || {});
