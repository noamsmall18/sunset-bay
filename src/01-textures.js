// 01-textures.js - procedural surface textures plus the authored photo set.
// The photos are optional enhancements: every one has a generated fallback so
// the game still boots cleanly from an offline copy without the asset folder.
(function (SB) {
  'use strict';

  var M = SB.M;
  var cache = Object.create(null);

  // Reused across rooftop billboards so the city gets a coherent campaign
  // without creating one GPU texture for every sign.
  var PHOTO_BILLBOARDS = [
    'assets/billboard-coastline.png',
    'assets/billboard-nightdrive.png',
    'assets/billboard-marina.png',
    'assets/billboard-airport.png',
    'assets/billboard-beachclub.png',
    'assets/billboard-streetfood.png',
    'assets/billboard-highrise.png',
    'assets/sunset-bay-hero.png'
  ];

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // Data textures (normal, roughness) must stay linear; only colour is sRGB.
  function linearTexture(c, repeatX, repeatY, aniso) {
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX || 1, repeatY || 1);
    t.anisotropy = aniso || 8;
    return t;
  }

  function toTexture(c, repeatX, repeatY, aniso) {
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX || 1, repeatY || 1);
    t.anisotropy = aniso || 8;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // Build materials synchronously during the staged bootstrap, then swap in
  // the authored photo in-place when it arrives. If a file is missing the
  // procedural canvas remains the active texture.
  function optionalPhoto(path, fallback) {
    var t = new THREE.CanvasTexture(fallback);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = 8;
    var img = new Image();
    img.onload = function () {
      t.image = img;
      t.needsUpdate = true;
    };
    img.onerror = function () { /* keep procedural fallback */ };
    img.src = path;
    return t;
  }

  function noise(ctx, w, h, amount, alpha) {
    var img = ctx.getImageData(0, 0, w, h);
    var d = img.data;
    for (var i = 0; i < d.length; i += 4) {
      var n = (Math.random() - 0.5) * amount;
      d[i] = M.clamp(d[i] + n, 0, 255);
      d[i + 1] = M.clamp(d[i + 1] + n, 0, 255);
      d[i + 2] = M.clamp(d[i + 2] + n, 0, 255);
      if (alpha !== undefined) d[i + 3] = alpha;
    }
    ctx.putImageData(img, 0, 0);
  }

  // hsl helper that takes 0..1 hue so palettes read nicely
  function hsl(h, s, l, a) {
    return 'hsla(' + Math.round(h * 360) + ',' + Math.round(s * 100) + '%,' +
      Math.round(l * 100) + '%,' + (a === undefined ? 1 : a) + ')';
  }
  SB.hsl = hsl;

  // Derive a tangent-space normal map from a colour canvas by treating
  // luminance as height and running a Sobel filter over it. Every surface in
  // the game is painted here, so every surface can have relief for free.
  function normalFrom(src, strength) {
    var w = src.width, h = src.height;
    var sctx = src.getContext('2d');
    var img = sctx.getImageData(0, 0, w, h).data;
    var out = canvas(w, h);
    var octx = out.getContext('2d');
    var dst = octx.createImageData(w, h);
    var d = dst.data;
    var k = strength === undefined ? 2.0 : strength;

    function lum(x, y) {
      x = (x + w) % w; y = (y + h) % h;
      var i = (y * w + x) * 4;
      return (img[i] * 0.299 + img[i + 1] * 0.587 + img[i + 2] * 0.114) / 255;
    }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var tl = lum(x - 1, y - 1), t = lum(x, y - 1), tr = lum(x + 1, y - 1);
        var l = lum(x - 1, y), r = lum(x + 1, y);
        var bl = lum(x - 1, y + 1), b = lum(x, y + 1), br = lum(x + 1, y + 1);
        var dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
        var dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
        var nx = -dx * k, ny = -dy * k, nz = 1;
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        var i = (y * w + x) * 4;
        d[i] = (nx / len * 0.5 + 0.5) * 255;
        d[i + 1] = (ny / len * 0.5 + 0.5) * 255;
        d[i + 2] = (nz / len * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
    octx.putImageData(dst, 0, 0);
    return out;
  }

  // ------------------------------------------------------------- asphalt ----
  function asphalt() {
    var w = 512, c = canvas(w, w), ctx = c.getContext('2d');
    ctx.fillStyle = '#44464b';
    ctx.fillRect(0, 0, w, w);
    // patchy repairs
    for (var i = 0; i < 26; i++) {
      var x = Math.random() * w, y = Math.random() * w;
      var rw = 40 + Math.random() * 150, rh = 30 + Math.random() * 120;
      ctx.fillStyle = 'rgba(' + (58 + Math.random() * 30 | 0) + ',' +
        (58 + Math.random() * 30 | 0) + ',' + (61 + Math.random() * 30 | 0) + ',0.5)';
      ctx.fillRect(x, y, rw, rh);
    }
    // aggregate speckle
    for (i = 0; i < 5000; i++) {
      var agg = 88 + Math.random() * 80 | 0;
      ctx.fillStyle = 'rgba(' + agg + ',' + agg + ',' + (agg + 3) + ',' +
        (0.04 + Math.random() * 0.13) + ')';
      ctx.fillRect(Math.random() * w, Math.random() * w, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // cracks
    ctx.strokeStyle = 'rgba(20,20,22,0.55)';
    for (i = 0; i < 14; i++) {
      ctx.lineWidth = 0.6 + Math.random() * 1.4;
      ctx.beginPath();
      var px = Math.random() * w, py = Math.random() * w;
      ctx.moveTo(px, py);
      var segs = 3 + (Math.random() * 5 | 0);
      for (var s = 0; s < segs; s++) {
        px += (Math.random() - 0.5) * 90;
        py += (Math.random() - 0.5) * 90;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    noise(ctx, w, w, 9);
    return c;
  }

  // ----------------------------------------------------------- sidewalk ----
  function sidewalk() {
    var w = 512, c = canvas(w, w), ctx = c.getContext('2d');
    ctx.fillStyle = '#9a9691';
    ctx.fillRect(0, 0, w, w);
    var cell = w / 4;
    for (var gx = 0; gx < 4; gx++) {
      for (var gy = 0; gy < 4; gy++) {
        var v = 0.9 + Math.random() * 0.2;
        ctx.fillStyle = 'rgba(' + (154 * v | 0) + ',' + (150 * v | 0) + ',' + (145 * v | 0) + ',1)';
        ctx.fillRect(gx * cell + 1.5, gy * cell + 1.5, cell - 3, cell - 3);
      }
    }
    ctx.strokeStyle = 'rgba(90,88,85,0.8)';
    ctx.lineWidth = 2.5;
    for (gx = 0; gx <= 4; gx++) {
      ctx.beginPath(); ctx.moveTo(gx * cell, 0); ctx.lineTo(gx * cell, w); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, gx * cell); ctx.lineTo(w, gx * cell); ctx.stroke();
    }
    // stains
    for (var i = 0; i < 40; i++) {
      ctx.fillStyle = 'rgba(70,66,62,' + (0.03 + Math.random() * 0.09) + ')';
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * w, 3 + Math.random() * 22, 0, M.TAU);
      ctx.fill();
    }
    noise(ctx, w, w, 12);
    return c;
  }

  // -------------------------------------------------------------- sand -----
  function sand() {
    var w = 256, c = canvas(w, w), ctx = c.getContext('2d');
    ctx.fillStyle = '#dfcda2';
    ctx.fillRect(0, 0, w, w);
    for (var i = 0; i < 3000; i++) {
      ctx.fillStyle = 'rgba(' + (200 + Math.random() * 55 | 0) + ',' +
        (180 + Math.random() * 55 | 0) + ',' + (140 + Math.random() * 50 | 0) + ',0.5)';
      ctx.fillRect(Math.random() * w, Math.random() * w, 2, 2);
    }
    noise(ctx, w, w, 16);
    return c;
  }

  // -------------------------------------------------------------- grass ----
  function grass() {
    var w = 256, c = canvas(w, w), ctx = c.getContext('2d');
    ctx.fillStyle = '#4c7a3a';
    ctx.fillRect(0, 0, w, w);
    for (var i = 0; i < 4000; i++) {
      var l = 0.7 + Math.random() * 0.7;
      ctx.strokeStyle = 'rgba(' + (76 * l | 0) + ',' + (122 * l | 0) + ',' + (58 * l | 0) + ',0.8)';
      ctx.lineWidth = 1;
      var x = Math.random() * w, y = Math.random() * w;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (Math.random() - 0.5) * 3, y - 2 - Math.random() * 3); ctx.stroke();
    }
    noise(ctx, w, w, 10);
    return c;
  }

  // ------------------------------------------------------------ ground -----
  // Neutral grain for the terrain. The land's actual colour - sand, grass,
  // scrub, rock - arrives as vertex colours, so this map has to stay grey or
  // it would tint every one of them.
  function groundDetail() {
    var w = 256, c = canvas(w, w), ctx = c.getContext('2d');
    ctx.fillStyle = '#b4b4b4';
    ctx.fillRect(0, 0, w, w);
    var i;
    for (i = 0; i < 2600; i++) {
      var l = 150 + Math.random() * 80 | 0;
      ctx.fillStyle = 'rgba(' + l + ',' + l + ',' + l + ',0.42)';
      var x = Math.random() * w, y = Math.random() * w;
      ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    // faint clumping, so a wide slope does not read as flat noise
    for (i = 0; i < 90; i++) {
      var g = ctx.createRadialGradient(
        Math.random() * w, Math.random() * w, 0,
        Math.random() * w, Math.random() * w, 18 + Math.random() * 34);
      g.addColorStop(0, 'rgba(150,150,150,0.20)');
      g.addColorStop(1, 'rgba(150,150,150,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, w);
    }
    noise(ctx, w, w, 12);
    return c;
  }

  // ------------------------------------------------------------ facades ----
  // Facade textures carry the whole visual load of the city, so there are
  // several distinct styles and each one is generated with per-window variation
  // (lit / dark / blinds) that the night pass reads through an emissive map.

  var GLASS_TINTS = [[0.55, 0.30, 0.42], [0.53, 0.22, 0.46], [0.50, 0.18, 0.40], [0.58, 0.12, 0.44]];

  // Returns { map:canvas, emissive:canvas }
  function facade(style, seed) {
    var rng = M.rng(seed);
    var i;
    var W = 256, H = 256;
    var c = canvas(W, H), ctx = c.getContext('2d');
    var e = canvas(W, H), ectx = e.getContext('2d');
    ectx.fillStyle = '#000'; ectx.fillRect(0, 0, W, H);
    // Roughness is painted deliberately rather than guessed from the albedo:
    // glass has to be glossy and the wall around it matte, or the whole
    // elevation reads as one plastic sheet.
    var rgh = canvas(W, H), rctx = rgh.getContext('2d');
    var grey = function (v) { var n = Math.round(v * 255); return 'rgb(' + n + ',' + n + ',' + n + ')'; };
    rctx.fillStyle = grey(0.9); rctx.fillRect(0, 0, W, H);

    if (style === 'glass') {
      var tint = GLASS_TINTS[rng.int(0, GLASS_TINTS.length - 1)];
      var base = hsl(tint[0], tint[1], tint[2]);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, W, H);
      var cols = rng.pick([8, 10, 12]), rows = 8;
      var cw = W / cols, ch = H / rows;
      // mullions
      for (var r = 0; r < rows; r++) {
        for (var q = 0; q < cols; q++) {
          var v = 0.75 + rng() * 0.5;
          ctx.fillStyle = hsl(tint[0] + (rng() - 0.5) * 0.03, tint[1], tint[2] * v);
          ctx.fillRect(q * cw + 1, r * ch + 1, cw - 2, ch - 2);
          // sky reflection gradient in the upper part of each pane
          var g = ctx.createLinearGradient(0, r * ch, 0, r * ch + ch);
          g.addColorStop(0, 'rgba(190,220,255,0.30)');
          g.addColorStop(0.55, 'rgba(190,220,255,0.05)');
          g.addColorStop(1, 'rgba(255,190,140,0.06)');
          ctx.fillStyle = g;
          ctx.fillRect(q * cw + 1, r * ch + 1, cw - 2, ch - 2);
          rctx.fillStyle = grey(0.10 + rng() * 0.06);
          rctx.fillRect(q * cw + 1, r * ch + 1, cw - 2, ch - 2);
          if (rng.chance(0.30)) {
            var lit = hsl(0.11, 0.55, 0.62);
            ectx.fillStyle = lit;
            ectx.fillRect(q * cw + 2, r * ch + 2, cw - 4, ch - 4);
          }
        }
      }
      ctx.strokeStyle = 'rgba(30,34,44,0.85)';
      ctx.lineWidth = 2;
      rctx.strokeStyle = grey(0.72); rctx.lineWidth = 3;
      for (r = 0; r <= rows; r++) {
        ctx.beginPath(); ctx.moveTo(0, r * ch); ctx.lineTo(W, r * ch); ctx.stroke();
        rctx.beginPath(); rctx.moveTo(0, r * ch); rctx.lineTo(W, r * ch); rctx.stroke();
      }
      for (q = 0; q <= cols; q++) {
        ctx.beginPath(); ctx.moveTo(q * cw, 0); ctx.lineTo(q * cw, H); ctx.stroke();
        rctx.beginPath(); rctx.moveTo(q * cw, 0); rctx.lineTo(q * cw, H); rctx.stroke();
      }

    } else if (style === 'brick') {
      var bh = rng.pick([0.06, 0.10, 0.14]);
      ctx.fillStyle = hsl(bh, 0.35, 0.34);
      ctx.fillRect(0, 0, W, H);
      // brick courses
      var brickH = 8, brickW = 20;
      for (var by = 0; by < H; by += brickH) {
        var off = ((by / brickH) % 2) * (brickW / 2);
        for (var bx = -brickW; bx < W; bx += brickW) {
          var vv = 0.82 + rng() * 0.36;
          ctx.fillStyle = hsl(bh + (rng() - 0.5) * 0.02, 0.34, 0.34 * vv);
          ctx.fillRect(bx + off + 1, by + 1, brickW - 2, brickH - 2);
        }
      }
      // windows
      var wcols = rng.pick([3, 4]), wrows = 4;
      var pw = W / wcols, ph = H / wrows;
      for (r = 0; r < wrows; r++) {
        for (q = 0; q < wcols; q++) {
          var wx = q * pw + pw * 0.22, wy = r * ph + ph * 0.18;
          var ww = pw * 0.56, wh2 = ph * 0.56;
          ctx.fillStyle = '#d8d2c4';
          ctx.fillRect(wx - 3, wy - 3, ww + 6, wh2 + 6);   // frame / sill
          var dark = rng.chance(0.55);
          ctx.fillStyle = dark ? '#1a1e26' : '#3a4354';
          ctx.fillRect(wx, wy, ww, wh2);
          // blinds
          if (rng.chance(0.4)) {
            ctx.fillStyle = 'rgba(226,220,205,0.85)';
            ctx.fillRect(wx, wy, ww, wh2 * rng.range(0.2, 0.6));
          }
          rctx.fillStyle = grey(0.18);
          rctx.fillRect(wx, wy, ww, wh2);
          ctx.strokeStyle = '#d8d2c4'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh2); ctx.stroke();
          if (rng.chance(0.34)) {
            ectx.fillStyle = hsl(0.10, 0.6, rng.range(0.45, 0.7));
            ectx.fillRect(wx, wy, ww, wh2);
          }
        }
      }

    } else if (style === 'stucco') {
      var sh = rng.pick([0.09, 0.11, 0.05, 0.13, 0.5, 0.02]);
      ctx.fillStyle = hsl(sh, 0.34, rng.range(0.68, 0.80));
      ctx.fillRect(0, 0, W, H);
      for (i = 0; i < 900; i++) {
        ctx.fillStyle = 'rgba(255,255,255,' + (rng() * 0.09) + ')';
        ctx.beginPath(); ctx.arc(rng() * W, rng() * H, rng() * 3, 0, M.TAU); ctx.fill();
      }
      wcols = rng.pick([3, 4]); wrows = 4;
      pw = W / wcols; ph = H / wrows;
      for (r = 0; r < wrows; r++) {
        for (q = 0; q < wcols; q++) {
          wx = q * pw + pw * 0.2; wy = r * ph + ph * 0.2;
          ww = pw * 0.6; wh2 = ph * 0.5;
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.fillRect(wx - 4, wy - 4, ww + 8, wh2 + 8);
          ctx.fillStyle = rng.chance(0.5) ? '#232a35' : '#39424f';
          ctx.fillRect(wx, wy, ww, wh2);
          rctx.fillStyle = grey(0.18);
          rctx.fillRect(wx, wy, ww, wh2);
          // little balcony rail
          if (rng.chance(0.35)) {
            ctx.strokeStyle = 'rgba(60,60,64,0.8)'; ctx.lineWidth = 1.5;
            for (var bxx = wx - 3; bxx < wx + ww + 3; bxx += 4) {
              ctx.beginPath(); ctx.moveTo(bxx, wy + wh2 + 4); ctx.lineTo(bxx, wy + wh2 + 12); ctx.stroke();
            }
            ctx.beginPath(); ctx.moveTo(wx - 4, wy + wh2 + 12); ctx.lineTo(wx + ww + 4, wy + wh2 + 12); ctx.stroke();
          }
          if (rng.chance(0.32)) {
            ectx.fillStyle = hsl(0.09, 0.65, rng.range(0.45, 0.68));
            ectx.fillRect(wx, wy, ww, wh2);
          }
        }
      }

    } else if (style === 'concrete') {
      // warm precast, light enough to hold colour in shadow
      ctx.fillStyle = hsl(rng.pick([0.08, 0.10, 0.12, 0.55]), rng.range(0.05, 0.14), rng.range(0.60, 0.76));
      ctx.fillRect(0, 0, W, H);
      // panel seams
      ctx.strokeStyle = 'rgba(0,0,0,0.20)'; ctx.lineWidth = 2;
      for (i = 0; i <= 4; i++) {
        ctx.beginPath(); ctx.moveTo(0, i * H / 4); ctx.lineTo(W, i * H / 4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i * W / 4, 0); ctx.lineTo(i * W / 4, H); ctx.stroke();
      }
      // ribbon windows, with a lighter spandrel under each run so the
      // elevation does not read as one dark stripe per floor
      for (r = 0; r < 4; r++) {
        var ry = r * H / 4 + H / 4 * 0.30;
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.fillRect(6, ry + H / 4 * 0.34, W - 12, H / 4 * 0.10);
        ctx.fillStyle = '#42506a';
        ctx.fillRect(6, ry, W - 12, H / 4 * 0.34);
        rctx.fillStyle = grey(0.14);
        rctx.fillRect(6, ry, W - 12, H / 4 * 0.34);
        for (q = 0; q < 10; q++) {
          if (rng.chance(0.28)) {
            ectx.fillStyle = hsl(0.12, 0.5, rng.range(0.4, 0.65));
            ectx.fillRect(6 + q * (W - 12) / 10, ry, (W - 12) / 10 - 2, H / 4 * 0.34);
          }
        }
        ctx.strokeStyle = 'rgba(150,150,155,0.7)'; ctx.lineWidth = 1.5;
        for (q = 0; q <= 10; q++) {
          var mx = 6 + q * (W - 12) / 10;
          ctx.beginPath(); ctx.moveTo(mx, ry); ctx.lineTo(mx, ry + H / 4 * 0.34); ctx.stroke();
        }
      }

    } else if (style === 'industrial') {
      ctx.fillStyle = hsl(0.08, 0.08, rng.range(0.40, 0.52));
      ctx.fillRect(0, 0, W, H);
      // corrugated ribs
      for (var xr = 0; xr < W; xr += 8) {
        ctx.fillStyle = 'rgba(0,0,0,' + (0.05 + rng() * 0.06) + ')';
        ctx.fillRect(xr, 0, 3, H);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(xr + 4, 0, 2, H);
      }
      // rust streaks
      for (i = 0; i < 24; i++) {
        var g2 = ctx.createLinearGradient(0, 0, 0, H);
        g2.addColorStop(0, 'rgba(120,60,25,0.30)');
        g2.addColorStop(1, 'rgba(120,60,25,0)');
        ctx.fillStyle = g2;
        ctx.fillRect(rng() * W, rng() * H * 0.5, 2 + rng() * 8, H * rng.range(0.2, 0.6));
      }
      // high strip windows
      rctx.fillStyle = grey(0.52); rctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#39434f';
      ctx.fillRect(0, H * 0.12, W, H * 0.10);
      rctx.fillStyle = grey(0.22);
      rctx.fillRect(0, H * 0.12, W, H * 0.10);
      for (q = 0; q < 12; q++) {
        if (rng.chance(0.2)) {
          ectx.fillStyle = hsl(0.15, 0.35, 0.55);
          ectx.fillRect(q * W / 12, H * 0.12, W / 12 - 2, H * 0.10);
        }
      }
    }

    // universal grime pass: darker near the bottom, streaks under sills
    var gg = ctx.createLinearGradient(0, H * 0.6, 0, H);
    gg.addColorStop(0, 'rgba(20,18,16,0)');
    gg.addColorStop(1, 'rgba(20,18,16,0.22)');
    ctx.fillStyle = gg;
    ctx.fillRect(0, 0, W, H);
    noise(ctx, W, H, 10);
    return { map: c, emissive: e, rough: rgh };
  }

  // ------------------------------------------------------- ground floor ----
  // A separate strip texture used for the first storey so the street level
  // reads as shops rather than repeating apartment windows.
  var SHOP_NAMES = ['DELI', 'LIQUOR', 'TACOS', 'LAUNDRY', 'PIZZA', 'BARBER', 'PAWN', 'NAILS',
    '24/7', 'COFFEE', 'BURGERS', 'PHONES', 'DONUTS', 'RAMEN', 'VINYL', 'THRIFT', 'TATTOO', 'ARCADE'];

  function storefront(seed) {
    var rng = M.rng(seed);
    var W = 512, H = 128;
    var c = canvas(W, H), ctx = c.getContext('2d');
    var e = canvas(W, H), ectx = e.getContext('2d');
    ectx.fillStyle = '#000'; ectx.fillRect(0, 0, W, H);

    ctx.fillStyle = hsl(0.09, 0.06, 0.35);
    ctx.fillRect(0, 0, W, H);

    var units = rng.int(3, 4);
    var uw = W / units;
    for (var u = 0; u < units; u++) {
      var x0 = u * uw;
      var hue = rng();
      // shop box
      ctx.fillStyle = hsl(hue, 0.35, 0.28);
      ctx.fillRect(x0 + 3, 0, uw - 6, H);
      // glass
      ctx.fillStyle = '#20262f';
      ctx.fillRect(x0 + 10, 34, uw - 20, H - 44);
      // warm interior glow behind the glass
      var g = ctx.createLinearGradient(0, 34, 0, H);
      g.addColorStop(0, 'rgba(255,210,150,0.35)');
      g.addColorStop(1, 'rgba(255,180,110,0.10)');
      ctx.fillStyle = g;
      ctx.fillRect(x0 + 10, 34, uw - 20, H - 44);
      // silhouetted shelving
      ctx.fillStyle = 'rgba(20,18,20,0.6)';
      for (var s = 0; s < 4; s++) ctx.fillRect(x0 + 16 + s * (uw - 32) / 4, 60, 6, H - 70);
      // door
      ctx.fillStyle = '#171b21';
      ctx.fillRect(x0 + uw * 0.42, 46, uw * 0.16, H - 46);
      // awning
      ctx.fillStyle = hsl(hue, 0.55, 0.45);
      ctx.fillRect(x0 + 4, 22, uw - 8, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      for (var st = 0; st < 6; st++) ctx.fillRect(x0 + 4 + st * (uw - 8) / 6, 22, (uw - 8) / 12, 14);
      // sign band + name
      ctx.fillStyle = hsl(hue, 0.5, 0.16);
      ctx.fillRect(x0 + 4, 2, uw - 8, 20);
      var name = SHOP_NAMES[rng.int(0, SHOP_NAMES.length - 1)];
      ctx.font = 'bold 15px "Helvetica Neue", Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var neon = hsl(rng(), 0.9, 0.66);
      ctx.fillStyle = neon;
      ctx.fillText(name, x0 + uw / 2, 13);
      // emissive: sign text + window glow
      ectx.font = ctx.font; ectx.textAlign = 'center'; ectx.textBaseline = 'middle';
      ectx.fillStyle = neon;
      ectx.fillText(name, x0 + uw / 2, 13);
      var eg = ectx.createLinearGradient(0, 34, 0, H);
      eg.addColorStop(0, 'rgba(255,196,120,0.50)');
      eg.addColorStop(1, 'rgba(255,150,80,0.18)');
      ectx.fillStyle = eg;
      ectx.fillRect(x0 + 10, 34, uw - 20, H - 44);
    }
    noise(ctx, W, H, 8);
    return { map: c, emissive: e };
  }

  // ------------------------------------------------------------ details ----
  function roofTex() {
    var w = 256, c = canvas(w, w), ctx = c.getContext('2d');
    ctx.fillStyle = '#4b4d50'; ctx.fillRect(0, 0, w, w);
    for (var i = 0; i < 400; i++) {
      ctx.fillStyle = 'rgba(' + (60 + Math.random() * 50 | 0) + ',' + (60 + Math.random() * 50 | 0) + ',' + (62 + Math.random() * 50 | 0) + ',0.5)';
      ctx.fillRect(Math.random() * w, Math.random() * w, 2 + Math.random() * 12, 2 + Math.random() * 12);
    }
    // tar seams
    ctx.strokeStyle = 'rgba(30,30,32,0.6)'; ctx.lineWidth = 3;
    for (i = 0; i < 8; i++) {
      ctx.beginPath(); ctx.moveTo(0, i * w / 8); ctx.lineTo(w, i * w / 8); ctx.stroke();
    }
    noise(ctx, w, w, 12);
    return c;
  }

  function roadMarkTex() {
    // transparent overlay with lane dashes, used on a decal plane
    var w = 64, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(236,226,180,0.85)';
    for (var y = 0; y < h; y += 64) ctx.fillRect(w / 2 - 3, y, 6, 34);
    return c;
  }

  function palmLeafTex() {
    var w = 128, h = 128, c = canvas(w, h), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    // one frond pointing +x, feathered
    ctx.strokeStyle = '#2f6b2c'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(2, h / 2); ctx.quadraticCurveTo(w * 0.6, h / 2 - 10, w - 4, h / 2 + 14); ctx.stroke();
    for (var i = 0; i < 26; i++) {
      var t = i / 26;
      var x = M.lerp(2, w - 4, t);
      var y = M.lerp(h / 2, h / 2 + 14, t * t) - Math.sin(t * Math.PI) * 8;
      var len = Math.sin(t * Math.PI) * 30 + 6;
      var sh = 0.55 + Math.random() * 0.45;
      ctx.strokeStyle = 'rgba(' + (44 * sh | 0) + ',' + (110 * sh | 0) + ',' + (42 * sh | 0) + ',1)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 6, y - len); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 6, y + len); ctx.stroke();
    }
    return c;
  }

  function waterNormalTex() {
    var w = 256, c = canvas(w, w), ctx = c.getContext('2d');
    var img = ctx.createImageData(w, w);
    var d = img.data;
    // sum of a few sine ripples baked into a tangent-space normal map
    for (var y = 0; y < w; y++) {
      for (var x = 0; x < w; x++) {
        var hgt = function (px, py) {
          return Math.sin(px * 0.09 + py * 0.05) * 0.5 +
            Math.sin(px * 0.031 - py * 0.062) * 0.35 +
            Math.sin(px * 0.15 + py * 0.13) * 0.15;
        };
        var dx = hgt(x + 1, y) - hgt(x - 1, y);
        var dy = hgt(x, y + 1) - hgt(x, y - 1);
        var nx = -dx * 0.6, ny = -dy * 0.6, nz = 1;
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        var i = (y * w + x) * 4;
        d[i] = (nx / len * 0.5 + 0.5) * 255;
        d[i + 1] = (nz / len * 0.5 + 0.5) * 255;
        d[i + 2] = (ny / len * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function billboardTex(seed) {
    var rng = M.rng(seed);
    var w = 512, h = 256, c = canvas(w, h), ctx = c.getContext('2d');
    var hue = rng();
    var g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, hsl(hue, 0.7, 0.45));
    g.addColorStop(1, hsl(hue + 0.15, 0.8, 0.25));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    var slogans = [
      ['SUNSET BAY', 'live fast'], ['VELOCE', 'drive it like you stole it'],
      ['PACIFIC AIR', 'fly the coast'], ['NEON NIGHTS', 'downtown, 10pm'],
      ['BAYSIDE', 'condos from $2M'], ['LUCKY 7', 'casino & resort'],
      ['CROWN LAGER', 'ice cold'], ['THE STRIP', 'open all night'],
      ['MOTO', 'two wheels, one life'], ['GOLD COAST', 'realty']
    ];
    var s = slogans[rng.int(0, slogans.length - 1)];
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = 'bold 62px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(s[0], w / 2, h / 2);
    ctx.font = '26px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(s[1], w / 2, h / 2 + 44);
    // vignette
    var vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
    return c;
  }

  // A soft radial blob, reused for shadows, glows, headlight pools, smoke.
  function blobTex(hard) {
    var w = 128, c = canvas(w, w), ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    if (hard) {
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.45, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
    } else {
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
    return c;
  }

  function smokeTex() {
    var w = 128, c = canvas(w, w), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, w);
    for (var i = 0; i < 18; i++) {
      var x = w / 2 + (Math.random() - 0.5) * 40;
      var y = w / 2 + (Math.random() - 0.5) * 40;
      var r = 12 + Math.random() * 30;
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.16)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, M.TAU); ctx.fill();
    }
    return c;
  }

  // ---------------------------------------------------------------- api ----
  var T = SB.Tex = {};

  function memo(name, fn) {
    T[name] = function () {
      if (cache[name]) return cache[name];
      return (cache[name] = fn.apply(null, arguments));
    };
  }

  memo('asphalt', function () { return toTexture(asphalt(), 24, 24, 16); });
  memo('sidewalk', function () { return toTexture(sidewalk(), 8, 8, 16); });
  memo('asphaltNormal', function () { return linearTexture(normalFrom(asphalt(), 1.1), 24, 24, 16); });
  memo('sidewalkNormal', function () { return linearTexture(normalFrom(sidewalk(), 2.2), 8, 8, 16); });
  memo('roofNormal', function () { return linearTexture(normalFrom(roofTex(), 1.6), 4, 4, 8); });
  memo('sandNormal', function () { return linearTexture(normalFrom(sand(), 1.4), 40, 40, 8); });
  memo('sand', function () { return toTexture(sand(), 40, 40, 8); });
  memo('grass', function () { return toTexture(grass(), 20, 20, 8); });
  memo('ground', function () { return toTexture(groundDetail(), 16, 16, 8); });
  memo('groundNormal', function () { return linearTexture(normalFrom(groundDetail(), 0.8), 16, 16, 8); });
  memo('roof', function () { return toTexture(roofTex(), 4, 4, 8); });
  memo('roadMark', function () {
    var t = toTexture(roadMarkTex(), 1, 1, 8);
    return t;
  });
  memo('palmLeaf', function () {
    var t = new THREE.CanvasTexture(palmLeafTex());
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
  memo('waterNormal', function () {
    var t = new THREE.CanvasTexture(waterNormalTex());
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(12, 12);
    return t;
  });
  memo('blob', function () {
    var t = new THREE.CanvasTexture(blobTex(false));
    return t;
  });
  memo('blobHard', function () {
    var t = new THREE.CanvasTexture(blobTex(true));
    return t;
  });
  memo('smoke', function () {
    var t = new THREE.CanvasTexture(smokeTex());
    return t;
  });

  // Facades are variant-keyed rather than singletons.
  var facadeCache = Object.create(null);
  T.facade = function (style, variant) {
    var key = style + ':' + variant;
    if (facadeCache[key]) return facadeCache[key];
    var res = facade(style, (variant * 2654435761) >>> 0);
    var map = toTexture(res.map, 1, 1, 8);
    var emi = toTexture(res.emissive, 1, 1, 8);
    emi.repeat.copy(map.repeat);
    var out = { map: map, emissive: emi };
    out.rough = linearTexture(res.rough, 1, 1);
    if (SB.Q && SB.Q.settings.normalMaps) {
      out.normal = linearTexture(normalFrom(res.map, style === 'brick' ? 3.0 : 2.0), 1, 1);
    }
    return (facadeCache[key] = out);
  };

  var shopCache = Object.create(null);
  T.storefront = function (variant) {
    if (shopCache[variant]) return shopCache[variant];
    var res = storefront((variant * 40503 + 7919) >>> 0);
    var map = toTexture(res.map, 1, 1, 8);
    var emi = toTexture(res.emissive, 1, 1, 8);
    var out = { map: map, emissive: emi };
    if (SB.Q && SB.Q.settings.normalMaps) {
      out.normal = linearTexture(normalFrom(res.map, 1.6), 1, 1);
    }
    return (shopCache[variant] = out);
  };

  var billCache = Object.create(null);
  T.billboard = function (variant) {
    var index = Math.abs(variant | 0) % PHOTO_BILLBOARDS.length;
    if (billCache[index]) return billCache[index];
    var t = optionalPhoto(PHOTO_BILLBOARDS[index], billboardTex((variant * 7717 + 13) >>> 0));
    return (billCache[index] = t);
  };

  T.canvas = canvas;
  T.toTexture = toTexture;
  T.linearTexture = linearTexture;
  T.normalFrom = normalFrom;

})(window.SB = window.SB || {});
