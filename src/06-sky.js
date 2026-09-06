// 06-sky.js - sky dome, sun, the day/night cycle, weather and the ocean.
// The sky is one analytic shader: gradient, sun disc, drifting cloud fbm and
// stars, all driven from the same sun direction the scene lights use.
(function (SB) {
  'use strict';

  var M = SB.M;

  var SKY_VERT = [
    'varying vec3 vDir;',
    'void main() {',
    '  vDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}'
  ].join('\n');

  var SKY_FRAG = [
    'precision highp float;',
    'varying vec3 vDir;',
    'uniform vec3 uSun;',
    'uniform vec3 uZenith;',
    'uniform vec3 uHorizon;',
    'uniform vec3 uSunColor;',
    'uniform vec3 uGround;',
    'uniform float uTime;',
    'uniform float uNight;',
    'uniform float uCloud;',
    'uniform float uHaze;',

    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
    'float vnoise(vec2 p){',
    '  vec2 i = floor(p); vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0,0.0)), u.x),',
    '             mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);',
    '}',
    'float fbm(vec2 p){',
    '  float v = 0.0, a = 0.5;',
    '  for(int i = 0; i < 5; i++){ v += a * vnoise(p); p *= 2.03; a *= 0.5; }',
    '  return v;',
    '}',

    'void main(){',
    '  vec3 d = normalize(vDir);',
    '  float y = d.y;',
    '  float up = clamp(y, 0.0, 1.0);',
    // base gradient, tightened near the horizon so sunsets band nicely
    '  vec3 col = mix(uHorizon, uZenith, pow(up, 0.42));',
    '  float sd = max(dot(d, uSun), 0.0);',
    // broad scattering glow around the sun, strongest low on the horizon
    '  col += uSunColor * pow(sd, 6.0) * 0.30 * uHaze;',
    '  col += uSunColor * pow(sd, 40.0) * 0.55 * uHaze;',
    // sun disc
    '  float disc = smoothstep(0.9993, 0.99975, sd);',
    '  col += uSunColor * disc * 14.0;',
    // stars, fading in as the sun drops
    '  if (uNight > 0.01 && y > -0.02) {',
    '    vec2 sp = d.xz / max(abs(y) + 0.25, 0.05);',
    '    float st = hash(floor(sp * 420.0));',
    '    float tw = 0.55 + 0.45 * sin(uTime * 2.3 + st * 40.0);',
    '    float star = smoothstep(0.9975, 0.99985, st) * tw;',
    '    col += vec3(0.85, 0.9, 1.0) * star * uNight * 1.5 * smoothstep(0.0, 0.22, y);',
    '  }',
    // clouds: project the view ray onto a high plane so they sit flat
    '  if (y > 0.008) {',
    '    vec2 cp = d.xz / y;',
    '    vec2 uv = cp * 0.055 + vec2(uTime * 0.0055, uTime * 0.0022);',
    '    float n = fbm(uv);',
    '    n = n * 0.72 + fbm(uv * 2.7 + 11.0) * 0.28;',
    '    float cov = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.30, n);',
    '    float fade = smoothstep(0.0, 0.16, y);',
    '    float lit = 0.55 + 0.45 * pow(max(dot(d, uSun), 0.0), 3.0);',
    '    vec3 cloudCol = mix(vec3(0.30, 0.31, 0.36), vec3(1.0, 0.97, 0.93), lit);',
    '    cloudCol = mix(cloudCol * 0.35, cloudCol, 1.0 - uNight * 0.75);',
    '    cloudCol += uSunColor * pow(max(dot(d, uSun), 0.0), 12.0) * 0.5 * uHaze;',
    '    col = mix(col, cloudCol, cov * fade * 0.92);',
    '  } else {',
    '    col = mix(col, uGround, smoothstep(0.008, -0.12, y));',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  // Keyframes for the cycle. hour -> palette. Interpolated by hour.
  var KEYS = [
    { h: 0.0, zen: 0x05070f, hor: 0x0a1020, sun: 0x223055, amb: 0x0e1424, dir: 0x28314e, dirI: 0.10, ambI: 0.82, fog: 0x0a1020, fogD: 0.0030, night: 1.0, haze: 0.4 },
    { h: 5.0, zen: 0x0d1428, hor: 0x2a2438, sun: 0x54405c, amb: 0x1a2038, dir: 0x4a4260, dirI: 0.18, ambI: 0.72, fog: 0x2a2438, fogD: 0.0034, night: 0.92, haze: 0.6 },
    { h: 6.4, zen: 0x2e4a78, hor: 0xd08a5c, sun: 0xffa86a, amb: 0x4a5878, dir: 0xffb079, dirI: 1.70, ambI: 0.72, fog: 0xc98a66, fogD: 0.0028, night: 0.35, haze: 1.35 },
    { h: 8.0, zen: 0x3f79c4, hor: 0xa9c6e2, sun: 0xffe0b4, amb: 0x7d97b8, dir: 0xfff0d8, dirI: 3.10, ambI: 0.86, fog: 0xa9c6e2, fogD: 0.0016, night: 0.0, haze: 1.0 },
    { h: 12.5, zen: 0x2f6dd0, hor: 0xbcd6ee, sun: 0xfff6e2, amb: 0x8fa9c4, dir: 0xfffaf0, dirI: 3.55, ambI: 0.92, fog: 0xbcd6ee, fogD: 0.0012, night: 0.0, haze: 0.85 },
    { h: 17.0, zen: 0x3a72c0, hor: 0xd9c6a8, sun: 0xffe3ae, amb: 0x93a2b4, dir: 0xffe8c0, dirI: 3.15, ambI: 0.88, fog: 0xd3c3ab, fogD: 0.0015, night: 0.0, haze: 1.1 },
    { h: 19.2, zen: 0x264b86, hor: 0xf08b4a, sun: 0xff8a3c, amb: 0x6b5a6a, dir: 0xff9a52, dirI: 2.20, ambI: 0.74, fog: 0xe08a52, fogD: 0.0022, night: 0.10, haze: 1.6 },
    { h: 20.4, zen: 0x121e3c, hor: 0x7a3f52, sun: 0x8a3f52, amb: 0x2c2e48, dir: 0x6b4460, dirI: 0.55, ambI: 0.62, fog: 0x50314a, fogD: 0.0030, night: 0.62, haze: 1.2 },
    { h: 22.0, zen: 0x070a16, hor: 0x121a2e, sun: 0x2a3358, amb: 0x121828, dir: 0x2e3654, dirI: 0.12, ambI: 0.86, fog: 0x121a2e, fogD: 0.0032, night: 1.0, haze: 0.5 },
    { h: 24.0, zen: 0x05070f, hor: 0x0a1020, sun: 0x223055, amb: 0x0e1424, dir: 0x28314e, dirI: 0.10, ambI: 0.82, fog: 0x0a1020, fogD: 0.0030, night: 1.0, haze: 0.4 }
  ];

  function lerpKey(a, b, t, out) {
    function c(ka, kb, key) {
      var ca = new THREE.Color(ka[key]), cb = new THREE.Color(kb[key]);
      return ca.lerp(cb, t);
    }
    out.zen = c(a, b, 'zen'); out.hor = c(a, b, 'hor'); out.sun = c(a, b, 'sun');
    out.amb = c(a, b, 'amb'); out.dir = c(a, b, 'dir'); out.fog = c(a, b, 'fog');
    out.dirI = M.lerp(a.dirI, b.dirI, t);
    out.ambI = M.lerp(a.ambI, b.ambI, t);
    out.fogD = M.lerp(a.fogD, b.fogD, t);
    out.night = M.lerp(a.night, b.night, t);
    out.haze = M.lerp(a.haze, b.haze, t);
    return out;
  }

  function Sky(scene, renderer) {
    this.scene = scene;
    this.hour = 9.5;
    this.speed = 1 / 90;        // one in-game hour per 90 real seconds
    this.paused = false;
    this.night = 0;
    this.wetness = 0;
    this.rain = 0;
    this.targetRain = 0;
    this.snow = 0;
    this.weatherMode = 'sun';
    this.weatherManual = false;
    this.weatherNight = 0;
    this.weatherTimer = 90;
    this._k = {};

    this.uniforms = {
      uSun: { value: new THREE.Vector3(0.3, 0.6, 0.5) },
      uZenith: { value: new THREE.Color(0x2f6dd0) },
      uHorizon: { value: new THREE.Color(0xbcd6ee) },
      uSunColor: { value: new THREE.Color(0xfff6e2) },
      uGround: { value: new THREE.Color(0x5b5f63) },
      uTime: { value: 0 },
      uNight: { value: 0 },
      uCloud: { value: 0.42 },
      uHaze: { value: 1 }
    };

    // Radius must stay inside the camera far plane or the dome is clipped.
    var Q = SB.Q.settings;
    var geo = new THREE.SphereGeometry(Q.skyRadius, Q.skyRadius > 1500 ? 40 : 24,
      Q.skyRadius > 1500 ? 24 : 16);
    var mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    scene.add(this.mesh);

    // ---- lights ----
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
    this.sun.castShadow = Q.shadows;
    var S = Q.shadowSpan;
    this.sun.shadow.mapSize.set(Q.shadowSize || 512, Q.shadowSize || 512);
    this.sun.shadow.camera.left = -S;
    this.sun.shadow.camera.right = S;
    this.sun.shadow.camera.top = S;
    this.sun.shadow.camera.bottom = -S;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 700;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.35;
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sun, this.sunTarget);
    this.sun.target = this.sunTarget;
    this.shadowLead = Q.shadowSpan * 0.35;
    this._fwd = new THREE.Vector3();
    this._sf = new THREE.Vector3();
    this._sr = new THREE.Vector3();
    this._su = new THREE.Vector3();
    this._sc = new THREE.Vector3();
    this._up2 = new THREE.Vector3();

    this.hemi = new THREE.HemisphereLight(0x9fb8d6, 0x4a4438, 0.9);
    scene.add(this.hemi);

    // Bounce light: a warm, shadowless fill coming from roughly where the
    // ground would kick the sun back up. Without it every shadowed face is lit
    // only by blue skylight and the whole city reads cold and flat.
    this.bounce = new THREE.DirectionalLight(0xffd9a8, 0.0);
    this.bounce.castShadow = false;
    this.bounceTarget = new THREE.Object3D();
    scene.add(this.bounce, this.bounceTarget);
    this.bounce.target = this.bounceTarget;

    scene.fog = new THREE.FogExp2(0xbcd6ee, 0.0013);

    // ---- ocean ----
    // A tessellated surface gives the analytic ocean a real silhouette and
    // catches highlights as the camera moves. Low tier keeps the same shape
    // at a smaller vertex budget; gameplay still samples the exact same waves.
    var waterSegments = Q.tier === 'high' ? 64 : (Q.tier === 'medium' ? 44 : 28);
    var waterSize = Math.min(3600, Q.far * 1.4);
    var wgeo = new THREE.PlaneGeometry(waterSize, waterSize, waterSegments, waterSegments);
    wgeo.rotateX(-Math.PI / 2);
    this.waterNormal = SB.Tex.waterNormal();
    var wmat = new THREE.MeshStandardMaterial({
      color: 0x2e6ea0,
      roughness: 0.14,
      metalness: 0.42,
      normalMap: this.waterNormal,
      normalScale: new THREE.Vector2(0.72, 0.72),
      transparent: true,
      opacity: 0.91,
      side: THREE.DoubleSide,
      envMapIntensity: 1.35
    });
    this.waterMat = wmat;
    this.water = new THREE.Mesh(wgeo, wmat);
    this.water.position.set(-1500, -1.4, 0);
    this.water.receiveShadow = false;
    this.water.frustumCulled = false;
    this.water.userData.waveTimer = 0;
    scene.add(this.water);

    // Localized surface rings make swimming visibly interact with the ocean
    // instead of only moving an avatar through a blue plane.
    var rippleMat = new THREE.MeshBasicMaterial({
      color: 0xb8edf1, transparent: true, opacity: 0.34,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
    });
    this.swimRipple = new THREE.Mesh(new THREE.RingGeometry(0.30, 0.43, 28), rippleMat);
    this.swimRipple.rotation.x = -Math.PI / 2;
    this.swimRipple.visible = false;
    scene.add(this.swimRipple);
    this.swimRipple2 = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.72, 28), rippleMat.clone());
    this.swimRipple2.rotation.x = -Math.PI / 2;
    this.swimRipple2.visible = false;
    scene.add(this.swimRipple2);
    this.swimmer = { x: 0, z: 0, active: false, t: 0 };

    // ---- image based lighting ----
    // A tiny equirect painted from the current palette, run through PMREM.
    // Without it every glass pane and every car roof reflects nothing and
    // reads as flat black.
    this.envCanvas = SB.Tex.canvas(128, 64);
    this.envTex = new THREE.CanvasTexture(this.envCanvas);
    this.envTex.mapping = THREE.EquirectangularReflectionMapping;
    this.envTex.colorSpace = THREE.SRGBColorSpace;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
    this.envTimer = 0;
    this.envInterval = Q.envRefresh;
    this.envKey = '';
    this.updateEnv(true);

    // ---- rain ----
    this.rainSys = makeRain();
    scene.add(this.rainSys.points);
    this.rainSys.points.visible = false;
    // Set by SB.Weather when it takes over precipitation.
    this.precipOwned = false;
  }

  Sky.prototype.setHour = function (h) { this.hour = ((h % 24) + 24) % 24; };

  // The weather director calls this instead of mutating sky uniforms directly.
  // Keeping the transition here preserves the day/night cycle while allowing
  // a player-triggered blackout, rain front, or snow squall at any hour.
  Sky.prototype.setWeather = function (mode) {
    mode = mode === 'rain' || mode === 'snow' || mode === 'night' ? mode : 'sun';
    this.weatherMode = mode;
    this.weatherManual = true;
    this.targetRain = mode === 'rain' ? 1 : 0;
  };

  Sky.prototype.setSwimmer = function (x, z, active, t) {
    this.swimmer.x = x; this.swimmer.z = z;
    this.swimmer.active = !!active; this.swimmer.t = t || 0;
  };

  // Quantise the shadow camera to whole shadow-map texels. Without this the
  // map slides continuously as you walk and every shadow edge crawls and
  // shimmers, which is far more noticeable than the resolution itself.
  Sky.prototype.snapShadow = function (cx, cz, dir) {
    var cam = this.sun.shadow.camera;
    var span = cam.right;
    var texel = (span * 2) / this.sun.shadow.mapSize.width;

    var f = this._sf.set(-dir.x, -dir.y, -dir.z).normalize();
    var upRef = Math.abs(f.y) > 0.98 ? this._up2.set(0, 0, 1) : this._up2.set(0, 1, 0);
    var right = this._sr.crossVectors(upRef, f).normalize();
    var up = this._su.crossVectors(f, right).normalize();

    var c = this._sc.set(cx, 0, cz);
    var px = c.dot(right), py = c.dot(up), pz = c.dot(f);
    px = Math.round(px / texel) * texel;
    py = Math.round(py / texel) * texel;

    this.sunTarget.position.set(
      right.x * px + up.x * py + f.x * pz,
      right.y * px + up.y * py + f.y * pz,
      right.z * px + up.z * py + f.z * pz);
    this.sun.position.set(
      this.sunTarget.position.x + dir.x * 260,
      this.sunTarget.position.y + dir.y * 260 + 12,
      this.sunTarget.position.z + dir.z * 260);
    this.sunTarget.updateMatrixWorld();
  };

  // Repaint and re-convolve the environment. Cheap at this size, but not free,
  // so it only runs when the sky has actually changed.
  Sky.prototype.updateEnv = function (force) {
    var k = this._k;
    var zen = (k.zen || this.uniforms.uZenith.value);
    var hor = (k.hor || this.uniforms.uHorizon.value);
    var sun = (k.sun || this.uniforms.uSunColor.value);
    var key = zen.getHexString() + hor.getHexString() + sun.getHexString();
    if (!force && key === this.envKey) return;
    this.envKey = key;

    var ctx = this.envCanvas.getContext('2d');
    var W = this.envCanvas.width, H = this.envCanvas.height;
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#' + zen.getHexString());
    g.addColorStop(0.46, '#' + hor.getHexString());
    g.addColorStop(0.54, '#' + hor.clone().multiplyScalar(0.55).getHexString());
    g.addColorStop(1, '#2a2a2c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // a bright patch where the sun is, so highlights land somewhere sensible
    var d = this.uniforms.uSun.value;
    var u = (Math.atan2(d.z, d.x) / (Math.PI * 2) + 0.5) * W;
    var v = (0.5 - Math.asin(M.clamp(d.y, -1, 1)) / Math.PI) * H;
    var rg = ctx.createRadialGradient(u, v, 0, u, v, W * 0.16);
    rg.addColorStop(0, '#' + sun.getHexString());
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';

    this.envTex.needsUpdate = true;
    var rt = this.pmrem.fromEquirectangular(this.envTex);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.42;
  };

  Sky.prototype.update = function (dt, camera, wetTargetMat) {
    var Q = SB.Q.settings;
    if (!this.paused) this.hour = (this.hour + dt * this.speed * 24 / 24 * 1) % 24;
    this.uniforms.uTime.value += dt;

    // Precipitation is part of the same state transition as the palette, so
    // the first frame of a storm already feels wet instead of lagging a frame.
    if (this.weatherManual) this.targetRain = this.weatherMode === 'rain' ? 1 : 0;
    this.rain = M.damp(this.rain, this.targetRain, 0.55, dt);
    this.snow = M.damp(this.snow, this.weatherMode === 'snow' ? 1 : 0, 0.34, dt);

    // -- sun position: a tilted arc so it rises over the hills and sets at sea
    var t = (this.hour - 6) / 12;                  // 0 at sunrise, 1 at sunset
    // Peak elevation is deliberately kept near 45 degrees: an overhead sun
    // leaves every vertical wall in grazing light and the city reads flat.
    var elev = Math.sin(t * Math.PI) * 0.80;       // negative at night
    var azim = M.lerp(-0.35, Math.PI + 0.35, M.clamp(t, -0.6, 1.6));
    var cosE = Math.cos(M.clamp(elev, -1.4, 1.4));
    var dir = this.uniforms.uSun.value;
    dir.set(Math.cos(azim) * cosE, Math.sin(elev), Math.sin(azim) * cosE * 0.55 - 0.25).normalize();

    // -- palette lookup
    var k0 = KEYS[0], k1 = KEYS[KEYS.length - 1], f = 0;
    for (var i = 0; i < KEYS.length - 1; i++) {
      if (this.hour >= KEYS[i].h && this.hour <= KEYS[i + 1].h) {
        k0 = KEYS[i]; k1 = KEYS[i + 1];
        f = M.invLerp(k0.h, k1.h, this.hour);
        break;
      }
    }
    var k = lerpKey(k0, k1, M.smoothstep(f), this._k);
    this.weatherNight = M.damp(this.weatherNight, this.weatherMode === 'night' ? 1 : 0, 2.8, dt);
    this.night = Math.max(k.night, this.weatherNight);

    // Overcast during rain/snow: desaturate, cool, and drop the sun.
    var rainMix = this.rain;
    var stormMix = Math.max(rainMix, this.snow * 0.72);
    this.uniforms.uZenith.value.copy(k.zen)
      .lerp(new THREE.Color(0x5a6472), stormMix * 0.75)
      .lerp(new THREE.Color(0x070c1b), this.weatherNight * 0.82);
    this.uniforms.uHorizon.value.copy(k.hor)
      .lerp(new THREE.Color(0x7b8492), stormMix * 0.75)
      .lerp(new THREE.Color(0x101a31), this.weatherNight * 0.76);
    this.uniforms.uSunColor.value.copy(k.sun).lerp(new THREE.Color(0x4e6caa), this.weatherNight * 0.75);
    this.uniforms.uNight.value = this.night;
    this.uniforms.uHaze.value = k.haze * (1 - stormMix * 0.7);
    this.uniforms.uCloud.value = M.lerp(0.40, 0.92, stormMix);

    this.sun.color.copy(k.dir).lerp(new THREE.Color(0x526b9c), this.weatherNight * 0.72);
    this.sun.intensity = k.dirI * (1 - rainMix * 0.65) * (1 - this.weatherNight * 0.92);
    // the bounce comes from the opposite side and from below the horizon
    this.bounce.color.copy(k.dir).lerp(new THREE.Color(0xffc98a), 0.55);
    this.bounce.intensity = k.dirI * 0.26 * (1 - rainMix * 0.5) * (1 - this.weatherNight * 0.82);
    // Scale the intensity, never the colour: multiplying a colour past 1.0
    // clips channels unevenly and shifts the hue, which was tinting the whole
    // city cyan under a blue sky.
    this.hemi.intensity = k.ambI * (1 + rainMix * 0.55) * (1 - this.weatherNight * 0.18);
    this.hemi.color.copy(k.amb);
    this.hemi.groundColor.setHex(0x4a4438).lerp(new THREE.Color(0x2a2c30), this.night);

    var fog = this.scene.fog;
    fog.color.copy(k.fog)
      .lerp(new THREE.Color(0x8b939c), stormMix * 0.8)
      .lerp(new THREE.Color(0x101a2d), this.weatherNight * 0.72);
    fog.density = k.fogD * (1 + stormMix * 2.2 + this.weatherNight * 0.18) * SB.Q.settings.fogMul;

    // keep the shadow frustum centred on the camera
    if (camera) {
      var cx = camera.position.x, cz = camera.position.z;
      // Push the box slightly along the view so more of it lands in front of
      // you rather than behind.
      camera.getWorldDirection(this._fwd);
      cx += this._fwd.x * this.shadowLead;
      cz += this._fwd.z * this.shadowLead;
      this.snapShadow(cx, cz, dir);
      this.sun.visible = dir.y > -0.05 && this.weatherNight < 0.78;
      this.bounceTarget.position.set(camera.position.x, 0, camera.position.z);
      this.bounce.position.set(
        camera.position.x - dir.x * 120,
        camera.position.y - Math.abs(dir.y) * 60 - 20,
        camera.position.z - dir.z * 120);
      this.bounceTarget.updateMatrixWorld();
      this.mesh.position.set(cx, 0, cz);
      this.water.position.z = cz;
    }

    // water: deform the mesh from the same analytic surface boats and swimmers
    // query, then scroll the finer normal detail over it.
    this.water.userData.waveTimer -= dt;
    if (this.water.userData.waveTimer <= 0) {
      this.water.userData.waveTimer = Q.tier === 'low' ? 0.07 : 0.033;
      var attr = this.water.geometry.attributes.position;
      var wt = this.uniforms.uTime.value;
      var world = this.world;
      for (var wi = 0; wi < attr.count; wi++) {
        var wx = this.water.position.x + attr.getX(wi);
        var wz = this.water.position.z + attr.getZ(wi);
        var wy = world ? world.waterSurfaceHeight(wx, wz, wt) : this.water.position.y;
        attr.setY(wi, wy - this.water.position.y);
      }
      attr.needsUpdate = true;
      this.water.geometry.computeVertexNormals();
      this.water.geometry.attributes.normal.needsUpdate = true;
    }
    this.waterNormal.offset.x += dt * 0.010;
    this.waterNormal.offset.y += dt * 0.017;
    this.waterMat.color.setHex(0x2e6ea0).lerp(new THREE.Color(0x0d1826), k.night * 0.85);
    this.waterMat.roughness = M.lerp(0.14, 0.32, rainMix);
    this.waterMat.normalScale.setScalar(M.lerp(0.72, 1.05, rainMix));
    if (this.swimRipple && this.swimmer.active && this.world) {
      var rippleY = this.world.waterSurfaceHeight(this.swimmer.x, this.swimmer.z, this.uniforms.uTime.value) + 0.025;
      var pulse = (Math.sin(this.swimmer.t * 5.2) + 1) * 0.5;
      this.swimRipple.visible = true;
      this.swimRipple.position.set(this.swimmer.x, rippleY, this.swimmer.z);
      this.swimRipple.scale.setScalar(0.92 + pulse * 0.20);
      this.swimRipple.material.opacity = 0.24 + pulse * 0.14;
      this.swimRipple.rotation.z = this.swimmer.t * 0.35;
      this.swimRipple2.visible = true;
      this.swimRipple2.position.set(this.swimmer.x, rippleY + 0.006, this.swimmer.z);
      this.swimRipple2.scale.setScalar(0.84 + pulse * 0.28);
      this.swimRipple2.material.opacity = 0.11 + pulse * 0.08;
      this.swimRipple2.rotation.z = -this.swimmer.t * 0.24;
    } else if (this.swimRipple) {
      this.swimRipple.visible = false;
      this.swimRipple2.visible = false;
    }

    // refresh the reflection probe a few times a minute
    this.envTimer -= dt;
    if (this.envTimer <= 0) {
      this.envTimer = this.envInterval || 3.0;
      this.updateEnv(false);
    }

    // -- weather state machine
    if (!this.weatherManual) {
      this.weatherTimer -= dt;
      if (this.weatherTimer <= 0) {
        this.weatherTimer = 60 + Math.random() * 180;
        this.targetRain = Math.random() < 0.28 ? (0.45 + Math.random() * 0.55) : 0;
      }
    }
    if (this.rain < 0.02) this.rain = 0;
    this.wetness = M.damp(this.wetness, this.rain > 0.15 ? 1 : 0, 0.18, dt);

    // The weather module draws better precipitation from this same value -
    // streaked rain and round flakes rather than square points - so when it
    // is present this fallback stays off. Running both drew two rain systems
    // on top of each other and paid for 2,600 extra particles a frame to do
    // it. Without the weather module (a stripped build, or a failed
    // construction) this is still the rain.
    this.rainSys.points.visible = !this.precipOwned && this.rain > 0.04;
    if (this.rainSys.points.visible && camera) {
      this.rainSys.update(dt, camera, this.rain);
    }

    // Wet roads: raise reflectivity of the shared road materials.
    if (wetTargetMat) {
      for (var m = 0; m < wetTargetMat.length; m++) {
        var mm = wetTargetMat[m];
        if (!mm.userData.baseRough) mm.userData.baseRough = mm.roughness;
        mm.roughness = M.lerp(mm.userData.baseRough, 0.16, this.wetness * 0.85);
        mm.metalness = M.lerp(0, 0.35, this.wetness);
      }
    }
    return k;
  };

  // How much artificial light the city should be showing (0 day, 1 night).
  Sky.prototype.lampFactor = function () {
    return M.clamp(this.night * 1.5 + this.rain * 0.35 + this.snow * 0.04, 0, 1);
  };

  function makeRain() {
    var N = 2600;
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(N * 3);
    var vel = new Float32Array(N);
    for (var i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 90;
      pos[i * 3 + 1] = Math.random() * 42;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 90;
      vel[i] = 26 + Math.random() * 18;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    var mat = new THREE.PointsMaterial({
      color: 0xaebccc, size: 0.5, transparent: true, opacity: 0.4,
      depthWrite: false, sizeAttenuation: true
    });
    var points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return {
      points: points,
      update: function (dt, camera, amount) {
        mat.opacity = 0.15 + amount * 0.4;
        var p = geo.attributes.position.array;
        var cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
        for (var i = 0; i < N; i++) {
          p[i * 3 + 1] -= vel[i] * dt;
          if (p[i * 3 + 1] < cy - 6) {
            p[i * 3] = cx + (Math.random() - 0.5) * 90;
            p[i * 3 + 1] = cy + 34 + Math.random() * 10;
            p[i * 3 + 2] = cz + (Math.random() - 0.5) * 90;
          }
        }
        geo.attributes.position.needsUpdate = true;
      }
    };
  }

  SB.Sky = Sky;

})(window.SB = window.SB || {});
