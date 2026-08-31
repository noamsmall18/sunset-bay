// 23-quality.js - device detection and quality tiers.
//
// A phone GPU cannot be asked to draw what a desktop draws, so the whole
// engine reads its budget from here: resolution, shadows, bloom, how much
// traffic and how many people exist, and how far you can see. There is also a
// dynamic resolution scaler that gives back pixels when frames get expensive.
(function (SB) {
  'use strict';

  var M = SB.M;

  var TIERS = {
    low: {
      name: 'low',
      pixelRatio: 1.0, antialias: false,
      shadows: false, shadowSize: 0, shadowSpan: 80,
      // The full-screen post stack is the most expensive part of the low
      // preset. Direct rendering keeps gameplay responsive on weak GPUs.
      post: false, bloomWide: false,
      // screen-space effects all off: a phone GPU spends its whole budget on
      // the geometry pass already
      ao: false, ssr: false, shafts: false, motionBlur: false, fxaa: true,
      grain: 0.008, lights: 0, headlightSpots: false,
      normalMaps: false,
      traffic: 3, parked: 2, peds: 3,
      far: 1000, fogMul: 2.1, skyRadius: 1200,
      particles: 0.35, cullDistance: 240,
      skidMarks: 700, envRefresh: 8
    },
    medium: {
      name: 'medium',
      pixelRatio: 1.35, antialias: false,
      shadows: true, shadowSize: 1024, shadowSpan: 95,
      post: true, bloomWide: false,
      ao: true, aoSamples: 8, aoRadius: 1.4, aoAmount: 0.72,
      ssr: false, shafts: true, motionBlur: true, motionAmount: 0.42,
      fxaa: true, grain: 0.010, lights: 4, headlightSpots: false,
      normalMaps: true,
      traffic: 20, parked: 16, peds: 18,
      far: 2600, fogMul: 1.35, skyRadius: 1900,
      particles: 0.65, cullDistance: 620,
      skidMarks: 1400, envRefresh: 5
    },
    high: {
      name: 'high',
      // FXAA handles edges now, so the context never needs MSAA: the scene is
      // always rendered into a target the default framebuffer cannot antialias.
      // FXAA is doing the edge work, so rendering at full retina density buys
      // little and costs 40 per cent more pixels than 1.7 does.
      pixelRatio: 1.7, antialias: false,
      shadows: true, shadowSize: 2048, shadowSpan: 110,
      post: true, bloomWide: true,
      ao: true, aoSamples: 16, aoRadius: 1.7, aoAmount: 0.92,
      ssr: true, ssrSteps: 28, ssrAmount: 1.0,
      shafts: true, motionBlur: true, motionAmount: 0.60,
      fxaa: true, grain: 0.012, lights: 8, headlightSpots: true,
      normalMaps: true,
      traffic: 32, parked: 26, peds: 30,
      far: 4200, fogMul: 1.0, skyRadius: 2400,
      particles: 1.0, cullDistance: 1e9,
      skidMarks: 2200, envRefresh: 3
    }
  };

  function isTouchDevice() {
    return (('ontouchstart' in window) || (navigator.maxTouchPoints > 0)) &&
      window.matchMedia('(pointer: coarse)').matches;
  }

  // Screen size in CSS pixels, orientation independent.
  function shortEdge() {
    return Math.min(window.screen.width || window.innerWidth,
      window.screen.height || window.innerHeight);
  }

  function detect() {
    var touch = isTouchDevice();
    var edge = shortEdge();
    var cores = navigator.hardwareConcurrency || 4;
    var mem = navigator.deviceMemory || 4;

    if (!touch) {
      // Desktop still starts at a performance-safe budget. Auto can promote
      // to High after it has measured real headroom; starting High would make
      // a software-rendered or thermally constrained browser miss its first
      // frame budget before the scaler has any data to act on.
      return 'medium';
    }
    // Tablets have both the screen and the thermal headroom for medium.
    var tablet = edge >= 700;
    if (tablet) return (cores >= 6 && mem >= 4) ? 'medium' : 'low';
    // Phones: recent ones cope with medium, older ones do not.
    return (cores >= 6 && mem >= 4 && edge >= 390) ? 'medium' : 'low';
  }

  var Q = SB.Q = {
    mode: 'auto',
    tier: 'high',
    baseTier: 'high',
    settings: TIERS.high,
    touch: false,
    renderScale: 1,
    auto: true,
    targetFps: 100,
    showStats: false,
    _acc: 0, _bad: 0, _good: 0
  };

  Q.init = function () {
    // `#touch` forces the touch layer on for testing the mobile build from a
    // desktop browser; `#notouch` does the opposite.
    if (/(^|[#,&])touch/.test(location.hash)) Q.touch = true;
    else if (location.hash.indexOf('notouch') >= 0) Q.touch = false;
    else Q.touch = isTouchDevice();
    var forced = null;
    var m = /quality=(auto|low|medium|high)/.exec(location.hash);
    if (m) forced = m[1];
    if (!forced) {
      try {
        var saved = localStorage.getItem('sunsetbay.quality');
        if (saved && TIERS[saved]) forced = saved;
      } catch (e) { /* private mode; fall through to detection */ }
    }
    try {
      if (localStorage.getItem('sunsetbay.stats') === '1') Q.showStats = true;
    } catch (e) { /* private mode; use the default */ }
    Q.set(forced || 'auto', false);
    return Q;
  };

  Q.set = function (tier, persist) {
    if (tier !== 'auto' && !TIERS[tier]) return;
    Q.mode = tier === 'auto' ? 'auto' : 'manual';
    Q.auto = Q.mode === 'auto';
    Q.baseTier = Q.auto ? detect() : tier;
    Q.tier = Q.baseTier;
    Q.settings = TIERS[Q.tier];
    Q.renderScale = 1;
    Q._bad = Q._good = 0;
    if (persist !== false) {
      try { localStorage.setItem('sunsetbay.quality', Q.mode === 'auto' ? 'auto' : tier); } catch (e) { }
    }
  };

  Q.tiers = function () { return ['auto', 'low', 'medium', 'high']; };

  Q.label = function () {
    return Q.mode === 'auto' ? 'AUTO / ' + Q.tier.toUpperCase() : Q.tier.toUpperCase();
  };

  // Effective device pixel ratio after the tier cap and the dynamic scaler.
  Q.pixelRatio = function () {
    return Math.min(window.devicePixelRatio || 1, Q.settings.pixelRatio) * Q.renderScale;
  };

  // Push the current budget at a live game. Safe to call at any time.
  Q.apply = function (game) {
    var s = Q.settings;
    var r = game.renderer;
    r.setPixelRatio(Q.pixelRatio());
    r.shadowMap.enabled = s.shadows;
    if (game.sky) {
      game.sky.sun.castShadow = s.shadows;
      if (s.shadows && game.sky.sun.shadow.mapSize.width !== s.shadowSize) {
        game.sky.sun.shadow.mapSize.set(s.shadowSize, s.shadowSize);
        var cam = game.sky.sun.shadow.camera;
        cam.left = -s.shadowSpan; cam.right = s.shadowSpan;
        cam.top = s.shadowSpan; cam.bottom = -s.shadowSpan;
        cam.updateProjectionMatrix();
        if (game.sky.sun.shadow.map) {
          game.sky.sun.shadow.map.dispose();
          game.sky.sun.shadow.map = null;
        }
      }
      game.sky.envInterval = s.envRefresh;
    }
    game.camera.far = s.far;
    game.camera.updateProjectionMatrix();
    if (game.traffic) {
      game.traffic.maxCars = s.traffic;
      game.traffic.maxParked = s.parked;
      if (game.traffic.applyBudget) game.traffic.applyBudget();
    }
    if (game.peds) {
      game.peds.maxPeds = s.peds;
      if (game.peds.applyBudget) game.peds.applyBudget();
    }
    if (game.interiors && game.interiors.doors) {
      // Door markers are two separate additive meshes per address. They are
      // helpful on Medium/High, but hiding this decorative layer on Low saves
      // hundreds of draw calls without changing collision or interaction.
      var showDoors = Q.tier !== 'low';
      for (var di = 0; di < game.interiors.doors.length; di++) {
        game.interiors.doors[di].group.visible = showDoors;
      }
    }
    if (game.post) {
      // Low is intentionally a direct scene render. Medium and High retain
      // the post stack with only their unsupported stages switched off.
      game.post.enabled = s.post !== false;
      r.toneMapping = game.post.enabled ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = game.post.enabled ? 1 : 1.22;
      game.post.wide = !!s.bloomWide;
      game.post.useAO = !!s.ao;
      game.post.useSSR = !!s.ssr;
      game.post.useShafts = !!s.shafts;
      game.post.useMotion = !!s.motionBlur;
      game.post.aoAmount = s.aoAmount === undefined ? 0.85 : s.aoAmount;
      game.post.motionAmount = s.motionAmount === undefined ? 0.55 : s.motionAmount;
      game.post.grain = s.grain === undefined ? 0.012 : s.grain;
      game.post.setSize(window.innerWidth, window.innerHeight, Q.pixelRatio());
    }
    if (game.lights) game.lights.setBudget(s.lights, s.headlightSpots);
    game.cullDistance = s.cullDistance;
  };

  // Dynamic resolution: if frames get expensive, render fewer pixels before
  // sacrificing anything the player can see. The target is deliberately 100
  // FPS, but a display running at 60Hz is treated as display-limited rather
  // than pointlessly forcing the quality scaler to its floor.
  Q.autoTune = function (game, dt, fps) {
    if (!Q.auto || !game.started) return;
    Q._acc += dt;
    if (Q._acc < 0.5) return;
    Q._acc = 0;
    var ceiling = game.loop && game.loop.refreshRate;
    var target = ceiling && ceiling < Q.targetFps - 8
      ? ceiling : Q.targetFps;
    var miss = Math.max(5, target * 0.08);
    if (fps < target - miss) {
      Q._good = 0;
      var bad = ++Q._bad;
      if (bad >= 2 && Q.renderScale > 0.48) {
        Q._bad = 0;
        Q.renderScale = Math.max(0.46, Q.renderScale - 0.10);
        Q.applyScale(game);
      } else if (bad >= 3 && Q.tier !== 'low') {
        Q._bad = 0;
        var tiers = ['low', 'medium', 'high'];
        var next = Math.max(0, tiers.indexOf(Q.tier) - 1);
        Q.tier = tiers[next];
        Q.settings = TIERS[Q.tier];
        Q.renderScale = 0.82;
        Q.apply(game);
      }
    } else if (fps > target - 2) {
      Q._bad = 0;
      if (++Q._good >= 14 && Q.renderScale < 1) {
        Q._good = 0;
        Q.renderScale = Math.min(1, Q.renderScale + 0.10);
        Q.applyScale(game);
      } else if (Q.renderScale >= 0.9 && Q.tier !== Q.baseTier && ++Q._good >= 28) {
        Q._good = 0;
        var available = ['low', 'medium', 'high'];
        var upgrade = Math.min(available.indexOf(Q.baseTier), available.indexOf(Q.tier) + 1);
        Q.tier = available[upgrade];
        Q.settings = TIERS[Q.tier];
        Q.renderScale = 0.9;
        Q.apply(game);
      }
    } else {
      Q._bad = 0; Q._good = 0;
    }
  };

  Q.applyScale = function (game) {
    var pr = Q.pixelRatio();
    game.renderer.setPixelRatio(pr);
    game.renderer.setSize(window.innerWidth, window.innerHeight);
    if (game.post) game.post.setSize(window.innerWidth, window.innerHeight, pr);
    if (game.hud) game.hud.resize();
  };

  Q.status = function (game) {
    var loop = game && game.loop;
    var fps = loop && Number.isFinite(loop.fps) ? loop.fps : 0;
    var ceiling = loop && loop.refreshRate ? loop.refreshRate : 0;
    var displayLimited = ceiling > 0 && ceiling < Q.targetFps - 8;
    var info = game && game.renderer && game.renderer.info;
    return {
      fps: Math.round(fps),
      target: Q.targetFps,
      frameMs: loop && Number.isFinite(loop.frameMs) ? loop.frameMs : 0,
      renderMs: loop && Number.isFinite(loop.renderMs) ? loop.renderMs : 0,
      refreshRate: ceiling,
      displayLimited: displayLimited,
      quality: Q.label(),
      scale: Q.renderScale,
      drawCalls: info && info.render ? info.render.calls : 0,
      triangles: info && info.render ? info.render.triangles : 0
    };
  };

  SB.isTouchDevice = isTouchDevice;

})(window.SB = window.SB || {});
