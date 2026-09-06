// 21-audio.js - every sound is synthesised with WebAudio at runtime: engines,
// tyres, gunfire, sirens, impacts, city ambience and the radio. No audio files,
// so the build stays a single self-contained page.
(function (SB) {
  'use strict';

  var M = SB.M;

  function Audio() {
    this.ready = false;
    this.ctx = null;
    this.enabled = true;
    this.muffled = false;
    this.radioOn = true;
    this.station = 0;
    this._noiseBuf = null;
    this.sirens = [];
    this.engines = [];
    this.lastGun = 0;
  }

  Audio.prototype.resume = function () {
    if (this.ready) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    var ctx = this.ctx = new AC();
    this.ready = true;

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.ratio.value = 7;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.20;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    // low pass used to duck everything when paused or indoors
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 1.0;
    this.sfxBus.connect(this.muffle);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.30;
    this.musicBus.connect(this.muffle);

    this.buildNoise();
    this.buildEngine();
    this.buildAmbience();
    this.startRadio();
  };

  Audio.prototype.setMuffled = function (on) {
    if (!this.ready) return;
    this.muffled = on;
    this.muffle.frequency.setTargetAtTime(on ? 420 : 20000, this.ctx.currentTime, 0.08);
    this.master.gain.setTargetAtTime(on ? 0.30 : 0.85, this.ctx.currentTime, 0.08);
  };

  Audio.prototype.buildNoise = function () {
    var ctx = this.ctx;
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuf = buf;
  };

  Audio.prototype.noiseSource = function (loop) {
    var s = this.ctx.createBufferSource();
    s.buffer = this._noiseBuf;
    s.loop = !!loop;
    return s;
  };

  // -------------------------------------------------------------- engine ---
  // One synth for the player's car: two detuned saws for the firing order plus
  // filtered noise for intake, all driven from engine rpm.
  Audio.prototype.buildEngine = function () {
    var ctx = this.ctx;
    var g = this.engineGain = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.sfxBus);

    var lp = this.engineLP = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 1.2;
    lp.connect(g);

    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
    this.osc3 = ctx.createOscillator(); this.osc3.type = 'sawtooth';
    var g1 = ctx.createGain(); g1.gain.value = 0.5;
    var g2 = ctx.createGain(); g2.gain.value = 0.22;
    var g3 = ctx.createGain(); g3.gain.value = 0.28;
    this.osc1.connect(g1); g1.connect(lp);
    this.osc2.connect(g2); g2.connect(lp);
    this.osc3.connect(g3); g3.connect(lp);
    this.osc1.frequency.value = 60;
    this.osc2.frequency.value = 30;
    this.osc3.frequency.value = 90;
    this.osc1.start(); this.osc2.start(); this.osc3.start();

    // intake / exhaust noise
    var n = this.noiseSource(true);
    var nf = this.engineNoiseFilter = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = 340;
    nf.Q.value = 0.8;
    var ng = this.engineNoiseGain = ctx.createGain();
    ng.gain.value = 0;
    n.connect(nf); nf.connect(ng); ng.connect(g);
    n.start();

    // tyre scrub
    var tn = this.noiseSource(true);
    var tf = this.tyreFilter = ctx.createBiquadFilter();
    tf.type = 'bandpass';
    tf.frequency.value = 1500;
    tf.Q.value = 3.5;
    var tg = this.tyreGain = ctx.createGain();
    tg.gain.value = 0;
    tn.connect(tf); tf.connect(tg); tg.connect(this.sfxBus);
    tn.start();

    // wind
    var wn = this.noiseSource(true);
    var wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 700;
    var wg = this.windGain = ctx.createGain();
    wg.gain.value = 0;
    wn.connect(wf); wf.connect(wg); wg.connect(this.sfxBus);
    wn.start();
  };

  Audio.prototype.buildAmbience = function () {
    var ctx = this.ctx;
    var n = this.noiseSource(true);
    var f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    var g = this.ambGain = ctx.createGain();
    g.gain.value = 0.05;
    n.connect(f); f.connect(g); g.connect(this.sfxBus);
    n.start();
  };

  // ---------------------------------------------------------------- sfx ----
  // Positional gain and pan, computed against the camera.
  Audio.prototype.place = function (x, y, z, refDist) {
    var g = SB._game || window.GAME;
    if (!g || !g.camera) return { gain: 0.5, pan: 0 };
    var cam = g.camera;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) ||
        !cam.position || !Number.isFinite(cam.position.x) ||
        !Number.isFinite(cam.position.y) || !Number.isFinite(cam.position.z)) {
      return { gain: 0, pan: 0 };
    }
    var dx = x - cam.position.x, dy = y - cam.position.y, dz = z - cam.position.z;
    var d = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(d)) return { gain: 0, pan: 0 };
    var gain = M.clamp((refDist || 26) / Math.max(d, 1.2), 0, 1);
    gain *= gain;
    // pan by the component along the camera's right vector
    var e = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    var pan = M.clamp((dx * e.x + dy * e.y + dz * e.z) / Math.max(d, 1), -1, 1);
    return { gain: gain, pan: pan };
  };

  Audio.prototype.voice = function (x, y, z, refDist) {
    var ctx = this.ctx;
    var p = this.place(x, y, z, refDist);
    // AudioParam values cannot be NaN or Infinity. Keep this boundary safe
    // even if a future caller hands us a malformed or mid-despawn object.
    if (!Number.isFinite(p.gain) || !Number.isFinite(p.pan) || p.gain < 0.008) return null;
    var g = ctx.createGain();
    g.gain.value = p.gain;
    var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = p.pan; g.connect(pan); pan.connect(this.sfxBus); }
    else g.connect(this.sfxBus);
    return g;
  };

  Audio.prototype.gunshot = function (w, x, y, z) {
    if (!this.ready || !this.enabled) return;
    var t = this.ctx.currentTime;
    if (t - this.lastGun < 0.012) return;
    this.lastGun = t;
    var out = this.voice(x, y, z, 40);
    if (!out) return;
    var ctx = this.ctx;

    var cfg = {
      pistol: { f: 1400, q: 1.2, dur: 0.16, vol: 0.55, low: 150 },
      smg: { f: 1800, q: 1.6, dur: 0.11, vol: 0.42, low: 190 },
      shotgun: { f: 800, q: 0.8, dur: 0.34, vol: 0.85, low: 90 },
      rifle: { f: 1600, q: 1.4, dur: 0.22, vol: 0.72, low: 120 }
    }[w.sound || w.id] || { f: 1400, q: 1.2, dur: 0.16, vol: 0.5, low: 150 };

    var n = this.noiseSource(false);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = cfg.f; bp.Q.value = cfg.q;
    var env = ctx.createGain();
    env.gain.setValueAtTime(cfg.vol, t);
    env.gain.exponentialRampToValueAtTime(0.0008, t + cfg.dur);
    n.connect(bp); bp.connect(env); env.connect(out);
    n.start(t); n.stop(t + cfg.dur + 0.02);

    // body thump
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(cfg.low, t);
    o.frequency.exponentialRampToValueAtTime(40, t + cfg.dur * 0.8);
    var og = ctx.createGain();
    og.gain.setValueAtTime(cfg.vol * 0.7, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + cfg.dur * 0.9);
    o.connect(og); og.connect(out);
    o.start(t); o.stop(t + cfg.dur + 0.02);

    // tail slapback off the buildings
    var tail = this.noiseSource(false);
    var tf = ctx.createBiquadFilter();
    tf.type = 'lowpass'; tf.frequency.value = 900;
    var tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.linearRampToValueAtTime(cfg.vol * 0.18, t + 0.05);
    tg.gain.exponentialRampToValueAtTime(0.0005, t + 0.55);
    tail.connect(tf); tf.connect(tg); tg.connect(out);
    tail.start(t + 0.03); tail.stop(t + 0.6);
  };

  Audio.prototype.explosion = function (x, y, z) {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var out = this.voice(x, y, z, 90);
    if (!out) return;
    var n = this.noiseSource(false);
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1.4);
    var env = ctx.createGain();
    env.gain.setValueAtTime(1.0, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    n.connect(lp); lp.connect(env); env.connect(out);
    n.start(t); n.stop(t + 1.7);

    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
    var og = ctx.createGain();
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    o.connect(og); og.connect(out);
    o.start(t); o.stop(t + 1.1);
  };

  Audio.prototype.crash = function (x, y, z, force) {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var out = this.voice(x, y, z, 45);
    if (!out) return;
    var n = this.noiseSource(false);
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700 + Math.random() * 900;
    bp.Q.value = 0.7;
    var env = ctx.createGain();
    env.gain.setValueAtTime(0.75 * force, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.28 + force * 0.3);
    n.connect(bp); bp.connect(env); env.connect(out);
    n.start(t); n.stop(t + 0.7);
    // metal ring
    for (var i = 0; i < 3; i++) {
      var o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 300 + Math.random() * 1600;
      var og = ctx.createGain();
      og.gain.setValueAtTime(0.10 * force, t);
      og.gain.exponentialRampToValueAtTime(0.0005, t + 0.25 + Math.random() * 0.3);
      o.connect(og); og.connect(out);
      o.start(t); o.stop(t + 0.6);
    }
  };

  Audio.prototype.thud = function (x, y, z) {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var out = this.voice(x, y, z, 24);
    if (!out) return;
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.16);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 0.25);
  };

  Audio.prototype.horn = function (v) {
    if (!this.ready || !this.enabled) return;
    if (v.__hornT && this.ctx.currentTime - v.__hornT < 0.5) return;
    v.__hornT = this.ctx.currentTime;
    var ctx = this.ctx, t = ctx.currentTime;
    var out = this.voice(v.pos.x, v.pos.y + 0.8, v.pos.z, 40);
    if (!out) return;
    var dur = 0.45;
    var base = v.spec.mass > 2500 ? 190 : 330;
    for (var i = 0; i < 2; i++) {
      var o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = base * (i ? 1.26 : 1);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.02);
      g.gain.setValueAtTime(0.14, t + dur - 0.06);
      g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + dur + 0.02);
    }
  };

  Audio.prototype.blip = function (kind) {
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx, t = ctx.currentTime;
    var cfg = {
      objective: [880, 0.10, 'sine', 0.16],
      mission: [520, 0.20, 'triangle', 0.20],
      success: [660, 0.30, 'triangle', 0.22],
      fail: [200, 0.40, 'sawtooth', 0.16],
      cash: [1180, 0.10, 'sine', 0.18],
      wanted: [300, 0.26, 'square', 0.14],
      door: [420, 0.07, 'sine', 0.10],
      reload: [260, 0.09, 'square', 0.09],
      dry: [1500, 0.04, 'square', 0.07],
      swing: [180, 0.09, 'triangle', 0.10],
      // Short, high and quiet: a hit confirmation has to be audible under
      // automatic fire without becoming the loudest thing in the mix.
      hitmark: [1760, 0.045, 'square', 0.055],
      rank: [523, 0.42, 'triangle', 0.20]
    }[kind] || [600, 0.1, 'sine', 0.12];

    var o = ctx.createOscillator();
    o.type = cfg[2];
    o.frequency.setValueAtTime(cfg[0], t);
    if (kind === 'rank') {
      o.frequency.setValueAtTime(cfg[0], t);
      o.frequency.setValueAtTime(cfg[0] * 1.26, t + cfg[1] * 0.30);
      o.frequency.setValueAtTime(cfg[0] * 1.5, t + cfg[1] * 0.58);
      o.frequency.setValueAtTime(cfg[0] * 2, t + cfg[1] * 0.80);
    } else if (kind === 'success' || kind === 'cash') {
      o.frequency.setValueAtTime(cfg[0], t);
      o.frequency.setValueAtTime(cfg[0] * 1.5, t + cfg[1] * 0.45);
    } else if (kind === 'fail') {
      o.frequency.exponentialRampToValueAtTime(cfg[0] * 0.5, t + cfg[1]);
    }
    var g = ctx.createGain();
    g.gain.setValueAtTime(cfg[3], t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + cfg[1]);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + cfg[1] + 0.02);
  };

  // -------------------------------------------------------------- sirens ---
  Audio.prototype.startSiren = function (v) {
    if (!this.ready || !this.enabled) return;
    if (v.__siren) return;
    var ctx = this.ctx;
    var o = ctx.createOscillator();
    o.type = 'sawtooth';
    var lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.75;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = 240;
    lfo.connect(lfoGain);
    lfoGain.connect(o.frequency);
    o.frequency.value = 760;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 1.2;
    var g = ctx.createGain();
    g.gain.value = 0;
    var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o.connect(bp); bp.connect(g);
    if (pan) { g.connect(pan); pan.connect(this.sfxBus); } else g.connect(this.sfxBus);
    o.start(); lfo.start();
    v.__siren = { osc: o, lfo: lfo, gain: g, pan: pan };
    this.sirens.push(v);
  };

  Audio.prototype.stopSiren = function (v) {
    if (!v.__siren) return;
    try { v.__siren.osc.stop(); v.__siren.lfo.stop(); } catch (e) { }
    v.__siren = null;
    var i = this.sirens.indexOf(v);
    if (i >= 0) this.sirens.splice(i, 1);
  };

  // ------------------------------------------------------------- radio -----
  // A short generative loop so the car has something on the stereo. Two
  // stations, scheduled a bar at a time.
  var SCALES = [
    [0, 3, 5, 7, 10],       // minor pentatonic
    [0, 2, 4, 7, 9]         // major pentatonic
  ];

  Audio.prototype.startRadio = function () {
    var self = this;
    this.nextBar = this.ctx.currentTime + 0.2;
    this.bar = 0;
    this.radioTimer = setInterval(function () { self.scheduleRadio(); }, 120);
  };

  Audio.prototype.scheduleRadio = function () {
    if (!this.ready) return;
    var ctx = this.ctx;
    if (!this.radioOn) { this.nextBar = Math.max(this.nextBar, ctx.currentTime + 0.1); return; }
    while (this.nextBar < ctx.currentTime + 0.6) {
      this.playBar(this.nextBar);
      this.nextBar += 2.0;
      this.bar++;
    }
  };

  Audio.prototype.playBar = function (t0) {
    var ctx = this.ctx;
    var station = this.station;
    var root = station === 0 ? 55 : 65.4;       // A1 / C2
    var scale = SCALES[station % 2];
    var beat = 0.5;
    var i;

    // bass
    var prog = [0, 0, 5, 3];
    var degree = prog[this.bar % prog.length];
    for (i = 0; i < 4; i++) {
      var o = ctx.createOscillator();
      o.type = station === 0 ? 'sawtooth' : 'triangle';
      var f = root * Math.pow(2, (scale[degree % scale.length] + (i === 3 ? 12 : 0)) / 12);
      o.frequency.value = f;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(420, t0 + i * beat);
      lp.frequency.exponentialRampToValueAtTime(160, t0 + i * beat + 0.4);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0 + i * beat);
      g.gain.linearRampToValueAtTime(0.24, t0 + i * beat + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + i * beat + 0.42);
      o.connect(lp); lp.connect(g); g.connect(this.musicBus);
      o.start(t0 + i * beat); o.stop(t0 + i * beat + 0.5);
    }

    // arpeggio
    for (i = 0; i < 8; i++) {
      var oo = ctx.createOscillator();
      oo.type = station === 0 ? 'square' : 'sawtooth';
      var deg = scale[(i + degree) % scale.length];
      var oct = 2 + ((i % 4 === 3) ? 1 : 0);
      oo.frequency.value = root * Math.pow(2, deg / 12 + oct);
      var gg = ctx.createGain();
      var tt = t0 + i * (beat / 2);
      gg.gain.setValueAtTime(0.0001, tt);
      gg.gain.linearRampToValueAtTime(0.055, tt + 0.01);
      gg.gain.exponentialRampToValueAtTime(0.0006, tt + 0.20);
      var bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400 + Math.sin(this.bar + i) * 500;
      bp.Q.value = 2.5;
      oo.connect(bp); bp.connect(gg); gg.connect(this.musicBus);
      oo.start(tt); oo.stop(tt + 0.24);
    }

    // drums
    for (i = 0; i < 4; i++) {
      var kt = t0 + i * beat;
      var k = ctx.createOscillator();
      k.type = 'sine';
      k.frequency.setValueAtTime(140, kt);
      k.frequency.exponentialRampToValueAtTime(45, kt + 0.11);
      var kg = ctx.createGain();
      kg.gain.setValueAtTime(0.5, kt);
      kg.gain.exponentialRampToValueAtTime(0.001, kt + 0.15);
      k.connect(kg); kg.connect(this.musicBus);
      k.start(kt); k.stop(kt + 0.18);

      // hats on the offbeat
      var ht = kt + beat / 2;
      var n = this.noiseSource(false);
      var hf = ctx.createBiquadFilter();
      hf.type = 'highpass'; hf.frequency.value = 7000;
      var hg = ctx.createGain();
      hg.gain.setValueAtTime(0.07, ht);
      hg.gain.exponentialRampToValueAtTime(0.0004, ht + 0.05);
      n.connect(hf); hf.connect(hg); hg.connect(this.musicBus);
      n.start(ht); n.stop(ht + 0.07);

      if (i === 2) {
        var s = this.noiseSource(false);
        var sf = ctx.createBiquadFilter();
        sf.type = 'bandpass'; sf.frequency.value = 1900; sf.Q.value = 0.9;
        var sg = ctx.createGain();
        sg.gain.setValueAtTime(0.24, kt);
        sg.gain.exponentialRampToValueAtTime(0.0006, kt + 0.16);
        s.connect(sf); sf.connect(sg); sg.connect(this.musicBus);
        s.start(kt); s.stop(kt + 0.2);
      }
    }
  };

  Audio.prototype.toggleRadio = function () {
    this.radioOn = !this.radioOn;
    return this.radioOn;
  };
  Audio.prototype.nextStation = function () {
    this.station = (this.station + 1) % 2;
    return this.station;
  };

  // -------------------------------------------------------------- frame ----
  Audio.prototype.render = function (dt, game) {
    SB._game = game;
    if (!this.ready || !this.enabled) return;
    var ctx = this.ctx;
    var t = ctx.currentTime;
    var p = game.player;

    // engine follows whatever the player is driving/flying; the shared synth
    // just needs the normalized values below. Keep the fallback guards here:
    // WebAudio rejects NaN immediately, so a newly added craft must degrade to
    // a sensible engine note instead of taking down the whole render loop.
    var v = p && p.vehicle;
    var inCraft = v && (p.mode === 'car' || p.mode === 'boat' || p.mode === 'plane' || p.mode === 'heli');
    if (inCraft) {
      var redline = Number.isFinite(v.spec.redline) && v.spec.redline > 0 ? v.spec.redline : 6000;
      var rpm = Number.isFinite(v.rpm) ? v.rpm : redline * 0.2;
      var throttle = Number.isFinite(v.throttle) ? M.clamp(v.throttle, 0, 1) : 0;
      var skid = Number.isFinite(v.skid) ? M.clamp(v.skid, 0, 2) : 0;
      var craftSpeed = typeof v.speed === 'function' && Number.isFinite(v.speed()) ? v.speed() : 0;
      var rpmN = M.clamp(rpm / redline, 0.12, 1.12);
      var base = 26 + rpmN * 104;
      this.osc1.frequency.setTargetAtTime(base, t, 0.035);
      this.osc2.frequency.setTargetAtTime(base * 0.5, t, 0.035);
      this.osc3.frequency.setTargetAtTime(base * 1.5, t, 0.035);
      this.engineLP.frequency.setTargetAtTime(360 + rpmN * 2400 + throttle * 900, t, 0.05);
      var load = 0.10 + throttle * 0.24 + rpmN * 0.10;
      this.engineGain.gain.setTargetAtTime(this.muffled ? load * 0.3 : load, t, 0.06);
      this.engineNoiseFilter.frequency.setTargetAtTime(260 + rpmN * 900, t, 0.06);
      this.engineNoiseGain.gain.setTargetAtTime(0.05 + throttle * 0.14, t, 0.06);
      this.tyreGain.gain.setTargetAtTime(skid * 0.20, t, 0.04);
      this.tyreFilter.frequency.setTargetAtTime(1100 + skid * 1600, t, 0.05);
      this.windGain.gain.setTargetAtTime(M.clamp(craftSpeed / 70, 0, 1) * 0.09, t, 0.1);
      this.ambGain.gain.setTargetAtTime(0.02, t, 0.4);
    } else {
      this.engineGain.gain.setTargetAtTime(0, t, 0.12);
      this.engineNoiseGain.gain.setTargetAtTime(0, t, 0.12);
      this.tyreGain.gain.setTargetAtTime(0, t, 0.1);
      this.windGain.gain.setTargetAtTime(0, t, 0.2);
      this.ambGain.gain.setTargetAtTime(game.worldHidden ? 0.012 : 0.05, t, 0.4);
    }

    // music only plays in something with a stereo, like a real radio
    var wantMusic = (p && (p.mode === 'car' || p.mode === 'boat') && this.radioOn) ? 0.26 : 0.0;
    this.musicBus.gain.setTargetAtTime(wantMusic, t, 0.25);

    // sirens track their cars
    for (var i = this.sirens.length - 1; i >= 0; i--) {
      var car = this.sirens[i];
      if (!car.__siren) { this.sirens.splice(i, 1); continue; }
      if (!car.sirenOn || car.destroyed || !car.group.visible) {
        car.__siren.gain.gain.setTargetAtTime(0, t, 0.15);
        continue;
      }
      var pl = this.place(car.pos.x, car.pos.y + 1, car.pos.z, 55);
      car.__siren.gain.gain.setTargetAtTime(pl.gain * 0.16, t, 0.08);
      if (car.__siren.pan) car.__siren.pan.pan.setTargetAtTime(pl.pan, t, 0.08);
    }
  };

  SB.Audio = Audio;

})(window.SB = window.SB || {});
