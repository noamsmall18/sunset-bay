// 22-post.js - the screen-space rendering pipeline.
//
// The scene renders once into a half-float HDR buffer with a depth texture
// attached. Everything after that reads depth: view-space position and normals
// are reconstructed from it, which buys ambient occlusion, wet-road
// reflections, light shafts and motion blur without a second geometry pass and
// without a G-buffer.
//
//   scene -> sceneRT (HDR + depth)
//              +-> AO      (half res, hemisphere sampling + bilateral blur)
//              +-> SSR     (half res, screen-space ray march on up-facing
//              |            surfaces, Fresnel weighted)
//              +-> shafts  (quarter res, occlusion-masked radial blur)
//              +-> bloom   (threshold, then separable blurs at 1/2 and 1/4)
//              +-> composite -> FXAA -> screen
//
// Every stage is switchable, so the same code runs on a phone with only bloom
// and FXAA left on.
(function (SB) {
  'use strict';

  var M = SB.M;

  var QUAD_VERT = [
    'varying vec2 vUv;',
    'void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
  ].join('\n');

  // Shared depth helpers, prepended to any pass that needs geometry back.
  var DEPTH_LIB = [
    'uniform sampler2D uDepth;',
    'uniform mat4 uInvProj;',
    'uniform vec2 uTexel;',
    'uniform float uNear;',
    'uniform float uFar;',

    'float rawDepth(vec2 uv){ return texture2D(uDepth, uv).x; }',

    // Perspective depth back to view-space position; z is negative in front.
    'vec3 viewPos(vec2 uv, float d){',
    '  vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);',
    '  vec4 v = uInvProj * clip;',
    '  return v.xyz / v.w;',
    '}',
    'vec3 viewPosAt(vec2 uv){ return viewPos(uv, rawDepth(uv)); }',
    'bool isSky(float d){ return d >= 0.99999; }',

    // Normals from depth. Taking the nearer neighbour on each axis stops
    // silhouettes smearing into the background.
    'vec3 viewNormal(vec2 uv){',
    '  float c = rawDepth(uv);',
    '  vec3 P = viewPos(uv, c);',
    '  vec2 ex = vec2(uTexel.x, 0.0);',
    '  vec2 ey = vec2(0.0, uTexel.y);',
    '  vec3 l = viewPosAt(uv - ex), r = viewPosAt(uv + ex);',
    '  vec3 dn = viewPosAt(uv - ey), up = viewPosAt(uv + ey);',
    '  vec3 dx = (abs(l.z - P.z) < abs(r.z - P.z)) ? (P - l) : (r - P);',
    '  vec3 dy = (abs(dn.z - P.z) < abs(up.z - P.z)) ? (P - dn) : (up - P);',
    '  return normalize(cross(dx, dy));',
    '}',

    'float hash12(vec2 p){',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}'
  ].join('\n');

  // ------------------------------------------------------------------ AO ---
  var AO_FRAG = DEPTH_LIB + [
    'uniform mat4 uProj;',
    'uniform vec3 uKernel[16];',
    'uniform float uRadius;',
    'uniform float uBias;',
    'uniform float uIntensity;',
    'uniform int uSamples;',
    'varying vec2 vUv;',

    'void main(){',
    '  float d = rawDepth(vUv);',
    '  if (isSky(d)) { gl_FragColor = vec4(1.0); return; }',
    '  vec3 P = viewPos(vUv, d);',
    '  vec3 N = viewNormal(vUv);',
    // per-pixel rotation, or the fixed kernel bands badly
    '  float ang = hash12(vUv * 1024.0) * 6.2831853;',
    '  vec3 rv = vec3(cos(ang), sin(ang), 0.0);',
    '  vec3 T = normalize(rv - N * dot(rv, N));',
    '  vec3 B = cross(N, T);',
    '  mat3 TBN = mat3(T, B, N);',

    '  float occ = 0.0;',
    '  for (int i = 0; i < 16; i++) {',
    '    if (i >= uSamples) break;',
    '    vec3 sp = P + (TBN * uKernel[i]) * uRadius;',
    '    vec4 off = uProj * vec4(sp, 1.0);',
    '    off.xyz /= off.w;',
    '    vec2 suv = off.xy * 0.5 + 0.5;',
    '    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;',
    '    float sd = rawDepth(suv);',
    '    if (isSky(sd)) continue;',
    '    float sampleZ = viewPos(suv, sd).z;',
    // only count occluders inside the sample radius, otherwise a distant wall
    // darkens everything standing in front of it
    '    float range = smoothstep(0.0, 1.0, uRadius / max(abs(P.z - sampleZ), 0.0001));',
    '    occ += (sampleZ >= sp.z + uBias ? 1.0 : 0.0) * range;',
    '  }',
    '  float ao = 1.0 - (occ / float(uSamples)) * uIntensity;',
    '  gl_FragColor = vec4(clamp(ao, 0.0, 1.0));',
    '}'
  ].join('\n');

  // Depth-aware blur: removes the AO noise without bleeding across edges.
  var AO_BLUR_FRAG = [
    'uniform sampler2D uSrc;',
    'uniform sampler2D uDepth;',
    'uniform vec2 uDir;',
    'uniform float uNear;',
    'uniform float uFar;',
    'varying vec2 vUv;',
    'float linZ(float d){ float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }',
    'void main(){',
    '  float centerZ = linZ(texture2D(uDepth, vUv).x);',
    '  float sum = 0.0, wsum = 0.0;',
    '  for (int i = -4; i <= 4; i++) {',
    '    vec2 uv = vUv + uDir * float(i);',
    '    float z = linZ(texture2D(uDepth, uv).x);',
    '    float w = exp(-float(i * i) * 0.14) * exp(-abs(z - centerZ) * 1.4);',
    '    sum += texture2D(uSrc, uv).r * w;',
    '    wsum += w;',
    '  }',
    '  gl_FragColor = vec4(sum / max(wsum, 0.0001));',
    '}'
  ].join('\n');

  // ----------------------------------------------------------------- SSR ---
  // Restricted to surfaces facing up, which is where the payoff is: roads,
  // pavements, car roofs, water. Fresnel drives the strength so reflections
  // appear at grazing angles the way asphalt actually behaves, and rain pushes
  // them much further.
  var SSR_FRAG = DEPTH_LIB + [
    'uniform sampler2D uScene;',
    'uniform mat4 uProj;',
    'uniform vec3 uViewUp;',
    'uniform float uWet;',
    'uniform float uDry;',
    'uniform int uSteps;',
    'varying vec2 vUv;',

    'void main(){',
    '  float d = rawDepth(vUv);',
    '  if (isSky(d)) { gl_FragColor = vec4(0.0); return; }',
    '  vec3 N = viewNormal(vUv);',
    '  float up = dot(N, uViewUp);',
    '  if (up < 0.72) { gl_FragColor = vec4(0.0); return; }',
    '  vec3 P = viewPos(vUv, d);',
    '  vec3 V = normalize(P);',
    '  vec3 R = reflect(V, N);',
    '  if (R.z > -0.02) { gl_FragColor = vec4(0.0); return; }',

    // Schlick Fresnel for a dielectric. Dry asphalt reflects almost nothing
    // head on and a surprising amount at a grazing angle; water multiplies it.
    '  float cosT = max(dot(-V, N), 0.0);',
    '  float F = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);',
    '  float strength = F * (uDry + uWet * (1.0 - uDry));',
    '  strength *= smoothstep(0.72, 0.86, up);',
    // distance fade: far reflections are all noise and no information
    '  strength *= 1.0 - smoothstep(60.0, 190.0, abs(P.z));',
    '  if (strength < 0.008) { gl_FragColor = vec4(0.0); return; }',

    '  float stride = max(0.32, abs(P.z) * 0.055);',
    '  float jitter = hash12(vUv * 512.0);',
    '  vec3 pos = P + R * stride * (0.6 + jitter * 0.6);',
    '  float hit = 0.0;',
    '  vec2 hitUV = vec2(0.0);',

    '  for (int i = 0; i < 40; i++) {',
    '    if (i >= uSteps) break;',
    '    vec4 clip = uProj * vec4(pos, 1.0);',
    '    if (clip.w <= 0.0) break;',
    '    vec2 suv = (clip.xy / clip.w) * 0.5 + 0.5;',
    '    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;',
    '    float sd = rawDepth(suv);',
    '    if (!isSky(sd)) {',
    '      float sceneZ = viewPos(suv, sd).z;',
    '      float diff = sceneZ - pos.z;',
    // the ray is behind geometry: accept only if the gap is thin enough to be
    // a real surface rather than a silhouette we slipped past
    '      if (diff > 0.0 && diff < stride * 2.4) { hitUV = suv; hit = 1.0; break; }',
    '    }',
    '    pos += R * stride;',
    '    stride *= 1.16;',
    '  }',

    '  if (hit < 0.5) { gl_FragColor = vec4(0.0); return; }',
    // fade at the screen edges, where there is simply nothing left to reflect
    '  vec2 edge = smoothstep(vec2(0.0), vec2(0.14), hitUV) *',
    '              (1.0 - smoothstep(vec2(0.86), vec2(1.0), hitUV));',
    '  float fade = edge.x * edge.y;',
    // Roughness blur. A dry road is rough, so its reflection is a soft sheen;
    // rain fills the pores and sharpens it toward a mirror. Sampling a small
    // disc around the hit is far cheaper than a separate blur pass.
    '  float rough = (1.0 - uWet) * 0.85 + 0.06;',
    '  float rad = rough * 0.012 * (0.4 + 0.6 * clamp(abs(P.z) / 40.0, 0.0, 1.0));',
    '  vec3 refl = texture2D(uScene, hitUV).rgb;',
    '  for (int k = 0; k < 5; k++) {',
    '    float a = float(k) * 1.2566 + jitter * 6.2831;',
    '    refl += texture2D(uScene, hitUV + vec2(cos(a), sin(a)) * rad).rgb;',
    '  }',
    '  refl /= 6.0;',
    '  gl_FragColor = vec4(refl, strength * fade);',
    '}'
  ].join('\n');

  // -------------------------------------------------------------- shafts ---
  var SHAFT_FRAG = DEPTH_LIB + [
    'uniform vec2 uSunUV;',
    'uniform float uSunVisible;',
    'uniform float uDensity;',
    'uniform float uDecay;',
    'varying vec2 vUv;',
    'void main(){',
    '  if (uSunVisible < 0.01) { gl_FragColor = vec4(0.0); return; }',
    '  vec2 delta = (vUv - uSunUV) * (uDensity / 24.0);',
    '  vec2 uv = vUv;',
    '  float illum = 1.0;',
    '  float acc = 0.0;',
    '  uv -= delta * hash12(vUv * 700.0);',
    '  for (int i = 0; i < 24; i++) {',
    '    uv -= delta;',
    '    float d = texture2D(uDepth, clamp(uv, 0.0, 1.0)).x;',
    '    acc += (d >= 0.99999 ? 1.0 : 0.0) * illum;',
    '    illum *= uDecay;',
    '  }',
    '  gl_FragColor = vec4(vec3(acc / 24.0), 1.0);',
    '}'
  ].join('\n');

  // --------------------------------------------------------------- bloom ---
  var BRIGHT_FRAG = [
    'uniform sampler2D uSrc;',
    'uniform float uThreshold;',
    'uniform float uKnee;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec3 c = texture2D(uSrc, vUv).rgb;',
    '  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));',
    '  float soft = clamp(l - uThreshold + uKnee, 0.0, 2.0 * uKnee);',
    '  soft = soft * soft / (4.0 * uKnee + 0.0001);',
    '  float contrib = max(soft, l - uThreshold) / max(l, 0.0001);',
    '  gl_FragColor = vec4(c * contrib, 1.0);',
    '}'
  ].join('\n');

  var BLUR_FRAG = [
    'uniform sampler2D uSrc;',
    'uniform vec2 uDir;',
    'varying vec2 vUv;',
    'void main(){',
    '  vec3 sum = texture2D(uSrc, vUv).rgb * 0.227027;',
    '  vec2 o1 = uDir * 1.3846153846;',
    '  vec2 o2 = uDir * 3.2307692308;',
    '  sum += (texture2D(uSrc, vUv + o1).rgb + texture2D(uSrc, vUv - o1).rgb) * 0.3162162162;',
    '  sum += (texture2D(uSrc, vUv + o2).rgb + texture2D(uSrc, vUv - o2).rgb) * 0.0702702703;',
    '  gl_FragColor = vec4(sum, 1.0);',
    '}'
  ].join('\n');

  // ----------------------------------------------------------- composite ---
  var COMPOSITE_FRAG = DEPTH_LIB + [
    'uniform sampler2D uScene;',
    'uniform sampler2D uBloomA;',
    'uniform sampler2D uBloomB;',
    'uniform sampler2D uAO;',
    'uniform sampler2D uSSR;',
    'uniform sampler2D uShafts;',
    'uniform mat4 uInvViewProj;',
    'uniform mat4 uPrevViewProj;',
    'uniform vec3 uSunColor;',
    'uniform float uStrength;',
    'uniform float uWideMix;',
    'uniform float uExposure;',
    'uniform float uVignette;',
    'uniform float uNight;',
    'uniform float uAOAmount;',
    'uniform float uSSRAmount;',
    'uniform float uShaftAmount;',
    'uniform float uMotion;',
    'uniform float uGrain;',
    'uniform float uChroma;',
    'uniform float uTime;',
    'varying vec2 vUv;',

    'vec3 aces(vec3 x){',
    '  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;',
    '  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);',
    '}',
    'vec3 toSRGB(vec3 c){',
    '  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0/2.4)) - 0.055, step(0.0031308, c));',
    '}',

    'void main(){',
    '  float d = rawDepth(vUv);',

    // ---- camera motion blur: reproject this pixel through last frame's
    // view-projection and smear along the difference
    '  vec2 vel = vec2(0.0);',
    '  if (uMotion > 0.001 && !isSky(d)) {',
    '    vec4 clip = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);',
    '    vec4 world = uInvViewProj * clip;',
    '    world /= world.w;',
    '    vec4 prev = uPrevViewProj * world;',
    '    vec2 prevUV = (prev.xy / prev.w) * 0.5 + 0.5;',
    '    vel = (vUv - prevUV) * uMotion;',
    '    float len = length(vel);',
    '    if (len > 0.018) vel *= 0.018 / len;',
    '  }',

    '  vec3 col;',
    '  if (length(vel) > 0.0007) {',
    '    col = vec3(0.0);',
    '    float wsum = 0.0;',
    '    for (int i = 0; i < 8; i++) {',
    '      float t = (float(i) / 7.0 - 0.5);',
    '      float w = 1.0 - abs(t) * 0.8;',
    '      col += texture2D(uScene, clamp(vUv + vel * t, 0.001, 0.999)).rgb * w;',
    '      wsum += w;',
    '    }',
    '    col /= wsum;',
    '  } else {',
    '    col = texture2D(uScene, vUv).rgb;',
    '  }',

    // ---- reflections, added before tone mapping so bright reflected
    // highlights still feed the bloom
    '  if (uSSRAmount > 0.001) {',
    '    vec4 ssr = texture2D(uSSR, vUv);',
    '    col = mix(col, ssr.rgb, clamp(ssr.a * uSSRAmount, 0.0, 0.92));',
    '  }',

    // ---- ambient occlusion
    '  if (uAOAmount > 0.001) {',
    '    float ao = texture2D(uAO, vUv).r;',
    '    col *= mix(1.0, ao, uAOAmount);',
    '  }',

    // ---- bloom and light shafts
    '  vec3 bloom = texture2D(uBloomA, vUv).rgb + texture2D(uBloomB, vUv).rgb * uWideMix;',
    '  col += bloom * uStrength;',
    '  if (uShaftAmount > 0.001) {',
    '    col += uSunColor * texture2D(uShafts, vUv).r * uShaftAmount;',
    '  }',

    '  col *= uExposure;',
    '  col = aces(col);',

    // ---- grade: cool shadows, warm highlights, a little more bite at night
    '  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));',
    '  vec3 shadowTint = vec3(0.965, 0.985, 1.030);',
    '  vec3 highTint = vec3(1.030, 1.000, 0.965);',
    '  col *= mix(shadowTint, highTint, smoothstep(0.15, 0.75, l));',
    '  col = mix(vec3(l), col, 1.18 + uNight * 0.10);',
    // gentle S-curve so midtones separate instead of sitting in one grey band
    '  col = clamp(col, 0.0, 1.0);',
    '  col = col * col * (3.0 - 2.0 * col) * 0.32 + col * 0.68;',

    '  vec2 dc = vUv - 0.5;',
    '  float r2 = dot(dc, dc);',
    // ---- chromatic aberration, edge weighted and driven by speed
    '  if (uChroma > 0.0001) {',
    '    float amt = uChroma * r2;',
    '    vec3 shifted = aces(vec3(',
    '      texture2D(uScene, vUv - dc * amt).r,',
    '      texture2D(uScene, vUv).g,',
    '      texture2D(uScene, vUv + dc * amt).b) * uExposure);',
    '    col = mix(col, vec3(shifted.r, col.g, shifted.b), 0.8);',
    '  }',

    '  col *= 1.0 - r2 * uVignette;',
    // ---- film grain, heavier at night the way a real sensor behaves
    '  if (uGrain > 0.0001) {',
    '    float g = hash12(vUv * 900.0 + fract(uTime) * 91.7) - 0.5;',
    '    col += g * uGrain * (1.0 + uNight * 1.4);',
    '  }',
    '  gl_FragColor = vec4(toSRGB(clamp(col, 0.0, 1.0)), 1.0);',
    '}'
  ].join('\n');

  // ---------------------------------------------------------------- FXAA ---
  var FXAA_FRAG = [
    'uniform sampler2D uSrc;',
    'uniform vec2 uTexel;',
    'varying vec2 vUv;',
    'float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }',
    'void main(){',
    '  vec3 rgbM = texture2D(uSrc, vUv).rgb;',
    '  float lM = lum(rgbM);',
    '  float lNW = lum(texture2D(uSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb);',
    '  float lNE = lum(texture2D(uSrc, vUv + vec2( 1.0, -1.0) * uTexel).rgb);',
    '  float lSW = lum(texture2D(uSrc, vUv + vec2(-1.0,  1.0) * uTexel).rgb);',
    '  float lSE = lum(texture2D(uSrc, vUv + vec2( 1.0,  1.0) * uTexel).rgb);',
    '  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));',
    '  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));',
    '  if (lMax - lMin < max(0.0312, lMax * 0.125)) { gl_FragColor = vec4(rgbM, 1.0); return; }',
    '  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));',
    '  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);',
    '  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);',
    '  dir = clamp(dir * rcp, -8.0, 8.0) * uTexel;',
    '  vec3 rgbA = 0.5 * (texture2D(uSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb +',
    '                     texture2D(uSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);',
    '  vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(uSrc, vUv - dir * 0.5).rgb +',
    '                                   texture2D(uSrc, vUv + dir * 0.5).rgb);',
    '  float lB = lum(rgbB);',
    '  gl_FragColor = vec4((lB < lMin || lB > lMax) ? rgbA : rgbB, 1.0);',
    '}'
  ].join('\n');

  // ----------------------------------------------------------------- impl ---
  function makeTarget(w, h, byteType) {
    var rt = new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: byteType ? THREE.UnsignedByteType : THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false
    });
    rt.texture.colorSpace = THREE.NoColorSpace;
    rt.texture.generateMipmaps = false;
    return rt;
  }

  function aoKernel(n) {
    var out = [];
    var rng = M.rng(0xA0A0);
    for (var i = 0; i < n; i++) {
      var v = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng());
      v.normalize();
      // cluster toward the origin so nearby geometry dominates the occlusion
      var t = i / n;
      v.multiplyScalar(M.lerp(0.15, 1.0, t * t));
      out.push(v);
    }
    while (out.length < 16) out.push(new THREE.Vector3(0, 0, 1));
    return out;
  }

  function Post(renderer, scene, camera) {
    var q = SB.Q.settings;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = true;

    this.useAO = !!q.ao;
    this.useSSR = !!q.ssr;
    this.useShafts = !!q.shafts;
    this.useMotion = !!q.motionBlur;
    this.useFXAA = q.fxaa !== false;
    this.wide = !!q.bloomWide;

    this.strength = 0.60;
    this.exposure = 0.92;
    this.aoAmount = q.aoAmount === undefined ? 0.85 : q.aoAmount;
    this.ssrAmount = q.ssrAmount === undefined ? 1.0 : q.ssrAmount;
    this.motionAmount = q.motionAmount === undefined ? 0.55 : q.motionAmount;
    this.grain = q.grain === undefined ? 0.012 : q.grain;
    this.chroma = 0.0;

    var size = renderer.getSize(new THREE.Vector2());
    var pr = renderer.getPixelRatio();
    this.w = Math.max(2, Math.floor(size.x * pr));
    this.h = Math.max(2, Math.floor(size.y * pr));

    // The depth texture is the whole point of this pipeline, and it rules out
    // MSAA on the scene target, so FXAA does the antialiasing instead.
    this.depthTex = new THREE.DepthTexture(this.w, this.h);
    this.depthTex.type = THREE.UnsignedIntType;
    this.depthTex.format = THREE.DepthFormat;
    this.depthTex.minFilter = THREE.NearestFilter;
    this.depthTex.magFilter = THREE.NearestFilter;

    this.sceneRT = new THREE.WebGLRenderTarget(this.w, this.h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: this.depthTex
    });
    this.sceneRT.texture.colorSpace = THREE.NoColorSpace;
    this.ldrRT = makeTarget(this.w, this.h, true);

    var hw = Math.floor(this.w / 2), hh = Math.floor(this.h / 2);
    var qw = Math.floor(this.w / 4), qh = Math.floor(this.h / 4);
    this.brightRT = makeTarget(hw, hh);
    this.blurA1 = makeTarget(hw, hh);
    this.blurA2 = makeTarget(hw, hh);
    this.blurB1 = makeTarget(qw, qh);
    this.blurB2 = makeTarget(qw, qh);
    this.aoRT = makeTarget(hw, hh, true);
    this.aoBlur1 = makeTarget(hw, hh, true);
    this.aoBlur2 = makeTarget(hw, hh, true);
    this.ssrRT = makeTarget(hw, hh);
    this.shaftRT = makeTarget(qw, qh, true);

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.invProj = new THREE.Matrix4();
    this.invViewProj = new THREE.Matrix4();
    this.prevViewProj = new THREE.Matrix4();
    this.viewProj = new THREE.Matrix4();
    this.viewUp = new THREE.Vector3(0, 1, 0);
    this.sunUV = new THREE.Vector2(0.5, 0.5);
    this._v = new THREE.Vector3();
    this.time = 0;

    var self = this;
    function depthUniforms() {
      return {
        uDepth: { value: self.depthTex },
        uInvProj: { value: self.invProj },
        uTexel: { value: new THREE.Vector2(1 / self.w, 1 / self.h) },
        uNear: { value: camera.near },
        uFar: { value: camera.far }
      };
    }
    function assign(a, b) {
      for (var k in b) a[k] = b[k];
      return a;
    }
    function mat(frag, uniforms) {
      return new THREE.ShaderMaterial({
        uniforms: uniforms,
        vertexShader: QUAD_VERT,
        fragmentShader: frag,
        depthTest: false,
        depthWrite: false
      });
    }

    this.aoMat = mat(AO_FRAG, assign(depthUniforms(), {
      uProj: { value: new THREE.Matrix4() },
      uKernel: { value: aoKernel(16) },
      uRadius: { value: q.aoRadius === undefined ? 1.6 : q.aoRadius },
      uBias: { value: 0.045 },
      uIntensity: { value: 1.0 },
      uSamples: { value: q.aoSamples || 12 }
    }));
    this.aoBlurMat = mat(AO_BLUR_FRAG, {
      uSrc: { value: null }, uDepth: { value: this.depthTex },
      uDir: { value: new THREE.Vector2() },
      uNear: { value: camera.near }, uFar: { value: camera.far }
    });
    this.ssrMat = mat(SSR_FRAG, assign(depthUniforms(), {
      uScene: { value: this.sceneRT.texture },
      uProj: { value: new THREE.Matrix4() },
      uViewUp: { value: this.viewUp },
      uWet: { value: 0 },
      uDry: { value: 0.16 },
      uSteps: { value: q.ssrSteps || 26 }
    }));
    this.shaftMat = mat(SHAFT_FRAG, assign(depthUniforms(), {
      uSunUV: { value: this.sunUV },
      uSunVisible: { value: 0 },
      uDensity: { value: 0.9 },
      uDecay: { value: 0.955 }
    }));
    this.brightMat = mat(BRIGHT_FRAG, {
      uSrc: { value: null }, uThreshold: { value: 1.02 }, uKnee: { value: 0.55 }
    });
    this.blurMat = mat(BLUR_FRAG, {
      uSrc: { value: null }, uDir: { value: new THREE.Vector2() }
    });
    this.compMat = mat(COMPOSITE_FRAG, assign(depthUniforms(), {
      uScene: { value: this.sceneRT.texture },
      uBloomA: { value: this.blurA2.texture },
      uBloomB: { value: this.blurB2.texture },
      uAO: { value: this.aoBlur2.texture },
      uSSR: { value: this.ssrRT.texture },
      uShafts: { value: this.shaftRT.texture },
      uInvViewProj: { value: this.invViewProj },
      uPrevViewProj: { value: this.prevViewProj },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uStrength: { value: this.strength },
      uWideMix: { value: this.wide ? 0.65 : 0.0 },
      uExposure: { value: this.exposure },
      uVignette: { value: 0.52 },
      uNight: { value: 0 },
      uAOAmount: { value: 0 },
      uSSRAmount: { value: 0 },
      uShaftAmount: { value: 0 },
      uMotion: { value: 0 },
      uGrain: { value: this.grain },
      uChroma: { value: 0 },
      uTime: { value: 0 }
    }));
    this.fxaaMat = mat(FXAA_FRAG, {
      uSrc: { value: this.ldrRT.texture },
      uTexel: { value: new THREE.Vector2(1 / this.w, 1 / this.h) }
    });
  }

  Post.prototype.setSize = function (w, h, pr) {
    this.w = Math.max(2, Math.floor(w * pr));
    this.h = Math.max(2, Math.floor(h * pr));
    var hw = Math.floor(this.w / 2), hh = Math.floor(this.h / 2);
    var qw = Math.floor(this.w / 4), qh = Math.floor(this.h / 4);
    this.sceneRT.setSize(this.w, this.h);
    this.ldrRT.setSize(this.w, this.h);
    this.brightRT.setSize(hw, hh);
    this.blurA1.setSize(hw, hh);
    this.blurA2.setSize(hw, hh);
    this.blurB1.setSize(qw, qh);
    this.blurB2.setSize(qw, qh);
    this.aoRT.setSize(hw, hh);
    this.aoBlur1.setSize(hw, hh);
    this.aoBlur2.setSize(hw, hh);
    this.ssrRT.setSize(hw, hh);
    this.shaftRT.setSize(qw, qh);

    var tx = 1 / this.w, ty = 1 / this.h;
    this.aoMat.uniforms.uTexel.value.set(tx, ty);
    this.ssrMat.uniforms.uTexel.value.set(tx, ty);
    this.shaftMat.uniforms.uTexel.value.set(tx, ty);
    this.compMat.uniforms.uTexel.value.set(tx, ty);
    this.fxaaMat.uniforms.uTexel.value.set(tx, ty);
  };

  // Call on any camera cut - a teleport, a respawn, walking into a building -
  // so the reprojection does not smear the whole frame across the jump.
  Post.prototype.dispose = function () {
    // Quality downgrades release GPU targets, not just hide their passes.
    for (var key in this) {
      var value = this[key];
      if (value && (value.isWebGLRenderTarget || value.isMaterial || value.isTexture)) value.dispose();
    }
    if (this.quad && this.quad.geometry) this.quad.geometry.dispose();
    this.enabled = false;
  };

  Post.prototype.resetHistory = function () {
    var cam = this.camera;
    cam.updateMatrixWorld();
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.prevViewProj.copy(this.viewProj);
    this._skipMotion = true;
  };

  Post.prototype.blit = function (mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target || null);
    if (target) this.renderer.clear(true, false, false);
    this.renderer.render(this.quadScene, this.quadCam);
  };

  // ctx: { night, wet, sunDir, sunColor, dt }
  Post.prototype.render = function (ctx) {
    var r = this.renderer;
    var cam = this.camera;
    ctx = ctx || {};
    this.time += ctx.dt === undefined ? 0.016 : ctx.dt;

    cam.updateMatrixWorld();
    this.invProj.copy(cam.projectionMatrixInverse);
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.invViewProj.copy(this.viewProj).invert();
    this.viewUp.set(0, 1, 0).transformDirection(cam.matrixWorldInverse);

    var near = cam.near, far = cam.far;
    this.aoMat.uniforms.uNear.value = near; this.aoMat.uniforms.uFar.value = far;
    this.ssrMat.uniforms.uNear.value = near; this.ssrMat.uniforms.uFar.value = far;
    this.shaftMat.uniforms.uNear.value = near; this.shaftMat.uniforms.uFar.value = far;
    this.compMat.uniforms.uNear.value = near; this.compMat.uniforms.uFar.value = far;
    this.aoBlurMat.uniforms.uNear.value = near; this.aoBlurMat.uniforms.uFar.value = far;

    // ---- scene into HDR; tone mapping is deferred to the composite
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(this.scene, cam);

    // ---- ambient occlusion
    var aoOn = this.useAO && this.aoAmount > 0.001;
    if (aoOn) {
      var hw = this.aoRT.width, hh = this.aoRT.height;
      this.aoMat.uniforms.uProj.value.copy(cam.projectionMatrix);
      this.blit(this.aoMat, this.aoRT);
      this.aoBlurMat.uniforms.uSrc.value = this.aoRT.texture;
      this.aoBlurMat.uniforms.uDir.value.set(1 / hw, 0);
      this.blit(this.aoBlurMat, this.aoBlur1);
      this.aoBlurMat.uniforms.uSrc.value = this.aoBlur1.texture;
      this.aoBlurMat.uniforms.uDir.value.set(0, 1 / hh);
      this.blit(this.aoBlurMat, this.aoBlur2);
    }

    // ---- screen space reflections
    var wet = ctx.wet || 0;
    var ssrOn = this.useSSR && this.ssrAmount > 0.001;
    if (ssrOn) {
      this.ssrMat.uniforms.uProj.value.copy(cam.projectionMatrix);
      this.ssrMat.uniforms.uWet.value = wet;
      this.blit(this.ssrMat, this.ssrRT);
    }

    // ---- light shafts, only while the sun is on screen and above the horizon
    var shaftStrength = 0;
    if (this.useShafts && ctx.sunDir) {
      this._v.copy(ctx.sunDir).multiplyScalar(900).add(cam.position);
      this._v.project(cam);
      var onScreen = this._v.z < 1 &&
        Math.abs(this._v.x) < 1.6 && Math.abs(this._v.y) < 1.6;
      if (onScreen && ctx.sunDir.y > 0.02) {
        this.sunUV.set(this._v.x * 0.5 + 0.5, this._v.y * 0.5 + 0.5);
        var edgeFade = M.clamp(1.6 - Math.max(Math.abs(this._v.x), Math.abs(this._v.y)), 0, 1);
        shaftStrength = edgeFade * M.clamp(ctx.sunDir.y * 5.0, 0, 1) * (1 - (ctx.night || 0));
        this.shaftMat.uniforms.uSunVisible.value = 1;
        this.blit(this.shaftMat, this.shaftRT);
      } else {
        this.shaftMat.uniforms.uSunVisible.value = 0;
      }
    }

    // ---- bloom
    this.brightMat.uniforms.uSrc.value = this.sceneRT.texture;
    this.blit(this.brightMat, this.brightRT);
    var bw = this.brightRT.width, bh = this.brightRT.height;
    this.blurMat.uniforms.uSrc.value = this.brightRT.texture;
    this.blurMat.uniforms.uDir.value.set(1 / bw, 0);
    this.blit(this.blurMat, this.blurA1);
    this.blurMat.uniforms.uSrc.value = this.blurA1.texture;
    this.blurMat.uniforms.uDir.value.set(0, 1 / bh);
    this.blit(this.blurMat, this.blurA2);
    if (this.wide) {
      var qw = this.blurB1.width, qh = this.blurB1.height;
      this.blurMat.uniforms.uSrc.value = this.blurA2.texture;
      this.blurMat.uniforms.uDir.value.set(1.6 / qw, 0);
      this.blit(this.blurMat, this.blurB1);
      this.blurMat.uniforms.uSrc.value = this.blurB1.texture;
      this.blurMat.uniforms.uDir.value.set(0, 1.6 / qh);
      this.blit(this.blurMat, this.blurB2);
    }

    // ---- composite
    var u = this.compMat.uniforms;
    u.uNight.value = ctx.night || 0;
    u.uStrength.value = this.strength * (1 + (ctx.night || 0) * 0.55);
    u.uWideMix.value = this.wide ? 0.65 : 0.0;
    u.uExposure.value = this.exposure;
    u.uAOAmount.value = aoOn ? this.aoAmount : 0;
    u.uSSRAmount.value = ssrOn ? this.ssrAmount : 0;
    u.uShaftAmount.value = shaftStrength * 0.55;
    u.uMotion.value = (this.useMotion && !this._skipMotion) ? this.motionAmount : 0;
    this._skipMotion = false;
    u.uGrain.value = this.grain;
    u.uChroma.value = Number.isFinite(this.chroma) ? M.clamp(this.chroma, 0, 0.001) : 0;
    u.uTime.value = this.time;
    if (ctx.sunColor) u.uSunColor.value.copy(ctx.sunColor);

    if (this.useFXAA) {
      this.blit(this.compMat, this.ldrRT);
      this.blit(this.fxaaMat, null);
    } else {
      this.blit(this.compMat, null);
    }

    // remember this frame's transform for next frame's motion blur
    this.prevViewProj.copy(this.viewProj);
  };

  SB.Post = Post;

})(window.SB = window.SB || {});
