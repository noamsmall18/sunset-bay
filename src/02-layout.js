// 02-layout.js - the city plan.
//
// MAP 2.0. The old map was a single rectilinear grid; this one is a set of
// regions that each lay their own roads in their own idiom - warped radial
// downtown, looping suburbs, switchbacks climbing real terrain, big industrial
// blocks - plus an elevated freeway ring and a rail network threaded over the
// top.
//
// Nothing downstream knows any of that. The generator's whole job is to emit
// the same three things the rest of the game already consumes:
//
//   nodes   junction points, with a y so roads can climb and fly
//   edges   straight segments between nodes (curves are polylines of these,
//           which is what lets traffic AI stay completely unaware of curvature)
//   blocks  polygonal city blocks, recovered from the road graph itself by
//           planar face traversal rather than being handed down from a grid
//
// Roads are authored as polylines, then welded: every crossing becomes a real
// shared junction. That weld is what makes an organically-drawn network
// actually drivable instead of a pile of overlapping ribbons.
(function (SB) {
  'use strict';

  var M = SB.M;

  var DIST = {
    DOWNTOWN: 'downtown',
    MIDTOWN: 'midtown',
    RESIDENTIAL: 'residential',
    SUBURB: 'suburb',
    HILLS: 'hills',
    INDUSTRIAL: 'industrial',
    BEACH: 'beach'
  };

  var STREET_W = 15;
  var AVENUE_W = 25;
  var FREEWAY_W = 30;
  var SIDEWALK_W = 4.5;
  var FREEWAY_Y = 11.5;

  // World extent. The old map's road network spanned about 840 units; this is
  // a little over 2000, roughly five times the area.
  var EXTENT = 1040;
  var BEACH_X = -1010;

  // Zones no procedural road or block may enter, because something
  // hand-placed already lives there (the airport apron, the marina basin).
  // Kept in world coordinates so the existing hand-placed infrastructure
  // keeps its exact position across a map regeneration.
  var RESERVED = [
    { name: 'airport', x0: -430, z0: -600, x1: 300, z1: -400 },
    { name: 'marina', x0: -700, z0: -330, x1: -480, z1: -120 }
  ];

  function inReserved(x, z, pad) {
    pad = pad || 0;
    for (var i = 0; i < RESERVED.length; i++) {
      var r = RESERVED[i];
      if (x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ terrain ----
  // The hills are part of the plan, not scenery bolted on afterwards: roads
  // are draped over exactly these bumps, so the generator and the world have
  // to agree on the height field. Both read this list.
  var HILLS = [
    { x: 700, z: -640, r: 430, h: 96 },
    { x: 480, z: -430, r: 330, h: 62 },
    { x: 880, z: -330, r: 300, h: 74 },
    { x: 660, z: -180, r: 260, h: 38 },
    { x: 980, z: -620, r: 260, h: 58 }
  ];

  function terrainAt(x, z) {
    var y = 0;
    for (var i = 0; i < HILLS.length; i++) {
      var h = HILLS[i];
      var dx = x - h.x, dz = z - h.z;
      var d2 = (dx * dx + dz * dz) / (h.r * h.r);
      if (d2 >= 1) continue;
      var t = 1 - d2;
      y += h.h * t * t * (3 - 2 * t) * 0.5;
    }
    return y;
  }

  // ========================================================== road net =====
  // Accumulates polylines, then welds them into a planar graph.
  function RoadNet() {
    this.paths = [];
  }

  RoadNet.prototype.add = function (pts, opt) {
    if (!pts || pts.length < 2) return;
    opt = opt || {};
    this.paths.push({
      pts: pts,
      width: opt.width || STREET_W,
      lanes: opt.lanes || 1,
      kind: opt.kind || 'street',
      elevated: !!opt.elevated,
      noBlocks: !!opt.noBlocks
    });
  };

  // Sample a parametric curve into a polyline, dropping any part that strays
  // into a reserved zone.
  RoadNet.prototype.addCurve = function (fn, steps, opt, reject) {
    var run = [];
    for (var i = 0; i <= steps; i++) {
      var p = fn(i / steps);
      if (!p || inReserved(p.x, p.z, 12) || (reject && reject(p.x, p.z))) {
        if (run.length > 1) this.add(run, opt);
        run = [];
        continue;
      }
      run.push(p);
    }
    if (run.length > 1) this.add(run, opt);
  };

  // ---------------------------------------------------------- welding -----
  // Split every segment at every crossing, then merge coincident endpoints so
  // the separate polylines become one connected graph.
  //
  // The weld radius used to be 2.2m, which is tight enough that two roads
  // laid three metres apart - a downtown avenue and the arterial that runs
  // beside it, a suburb loop clipping the grid it grew out of - stayed two
  // separate roads with a strip of "block" between them narrower than a
  // pavement. At street widths of 15 to 24m their carriageways physically
  // overlapped, which is the smeared look the city had. Welding at 8m folds
  // those into one junction: the same road, drawn once.
  var WELD_EPS = 8.0;
  // Two roads only weld if they are at the same height as well as the same
  // place. A freeway deck welded to a street eight metres below it is not a
  // junction: it drags the deck sideways, hands the street the deck's height,
  // and leaves the ring visibly kinked where it passes over the grid. The gate
  // is the height difference rather than the elevated flag, so the point where
  // a ramp touches down - elevated on one side, a normal road on the other -
  // still joins up, which is the whole reason ramps exist.
  var WELD_DY = 6.0;        // two roads of the same kind, on a slope
  var WELD_DY_MIXED = 1.5;  // a deck meeting the ground: the touchdown only

  function segIntersect(ax, az, bx, bz, cx, cz, dx, dz, out) {
    var r0 = bx - ax, r1 = bz - az;
    var s0 = dx - cx, s1 = dz - cz;
    var denom = r0 * s1 - r1 * s0;
    if (Math.abs(denom) < 1e-9) return false;       // parallel
    var t = ((cx - ax) * s1 - (cz - az) * s0) / denom;
    var u = ((cx - ax) * r1 - (cz - az) * r0) / denom;
    // strictly interior crossings only; shared endpoints weld on their own
    if (t <= 1e-4 || t >= 1 - 1e-4 || u <= 1e-4 || u >= 1 - 1e-4) return false;
    out.t = t; out.u = u;
    out.x = ax + r0 * t; out.z = az + r1 * t;
    return true;
  }

  RoadNet.prototype.weld = function () {
    // 1. flatten every path into segments carrying their road attributes
    var segs = [];
    for (var p = 0; p < this.paths.length; p++) {
      var path = this.paths[p];
      for (var i = 0; i < path.pts.length - 1; i++) {
        var a = path.pts[i], b = path.pts[i + 1];
        if (M.dist2(a.x, a.z, b.x, b.z) < 1) continue;
        segs.push({
          ax: a.x, az: a.z, ay: a.y === undefined ? null : a.y,
          bx: b.x, bz: b.z, by: b.y === undefined ? null : b.y,
          path: path, cuts: []
        });
      }
    }

    // 2. find crossings, grid-accelerated so this stays near linear
    var grid = new SB.Grid(60);
    var s, i2;
    for (s = 0; s < segs.length; s++) {
      var sg = segs[s];
      sg._i = s;
      grid.insert(sg,
        Math.min(sg.ax, sg.bx), Math.min(sg.az, sg.bz),
        Math.max(sg.ax, sg.bx), Math.max(sg.az, sg.bz));
    }
    var hit = {}, q = [], stamp = 1;
    for (s = 0; s < segs.length; s++) {
      var A = segs[s];
      var near = grid.query(
        Math.min(A.ax, A.bx) - 1, Math.min(A.az, A.bz) - 1,
        Math.max(A.ax, A.bx) + 1, Math.max(A.az, A.bz) + 1, q, stamp++);
      for (i2 = 0; i2 < near.length; i2++) {
        var B = near[i2];
        if (B._i <= A._i) continue;
        // An elevated road crossing a surface road is a flyover, not a junction.
        if (A.path.elevated !== B.path.elevated) continue;
        if (segIntersect(A.ax, A.az, A.bx, A.bz, B.ax, B.az, B.bx, B.bz, hit)) {
          A.cuts.push({ t: hit.t, x: hit.x, z: hit.z });
          B.cuts.push({ t: hit.u, x: hit.x, z: hit.z });
        }
      }
    }

    // 3. build nodes, snapping nearby points together
    var nodes = [];
    var snap = new SB.Grid(WELD_EPS * 2);
    var sq = [], sstamp = 1;
    function nodeAt(x, z, y, air) {
      var wantY = (y === null || y === undefined) ? terrainAt(x, z) : y;
      var found = snap.queryPoint(x, z, WELD_EPS, sq, sstamp++);
      // Nearest wins, not first-found. At a 2m radius the difference was
      // academic; at 8m, taking whichever candidate the grid happened to
      // return first can drag a junction several metres off the road it
      // belongs to, and every road meeting there bends with it.
      var best = null, bestD = WELD_EPS * WELD_EPS;
      for (var k = 0; k < found.length; k++) {
        var n = found[k];
        var lim = (n.air === !!air) ? WELD_DY : WELD_DY_MIXED;
        if (Math.abs(n.y - wantY) > lim) continue;
        var d2 = M.dist2(n.x, n.z, x, z);
        if (d2 <= bestD) { bestD = d2; best = n; }
      }
      if (best) {
        if (y !== null && y !== undefined) best.y = Math.max(best.y, y);
        return best;
      }
      var nn = { id: nodes.length, x: x, z: z, y: wantY, air: !!air, edges: [] };
      nodes.push(nn);
      snap.insert(nn, x, z, x, z);
      return nn;
    }

    // 4. cut segments at crossings and emit edges
    var edges = [];
    var edgeKeys = Object.create(null);
    function addEdge(na, nb, path) {
      if (na === nb) return;
      var key = na.id < nb.id ? na.id + ':' + nb.id : nb.id + ':' + na.id;
      if (edgeKeys[key]) return;
      var len = M.dist(na.x, na.z, nb.x, nb.z);
      if (len < 4) return;
      var e = {
        id: edges.length, a: na.id, b: nb.id,
        width: path.width, lanes: path.lanes, kind: path.kind,
        elevated: path.elevated, noBlocks: path.noBlocks,
        len: len, avenue: path.lanes > 1,
        // dominant axis, kept only so the signal phasing has something
        // sensible to alternate on
        axis: Math.abs(nb.x - na.x) >= Math.abs(nb.z - na.z) ? 'x' : 'z'
      };
      edges.push(e);
      edgeKeys[key] = 1;
      na.edges.push(e.id);
      nb.edges.push(e.id);
    }

    for (s = 0; s < segs.length; s++) {
      var sg2 = segs[s];
      sg2.cuts.sort(function (m, n) { return m.t - n.t; });
      var air = sg2.path.elevated;
      var prev = nodeAt(sg2.ax, sg2.az, sg2.ay, air);
      for (var c = 0; c < sg2.cuts.length; c++) {
        var cut = sg2.cuts[c];
        var cy = sg2.ay === null ? null : M.lerp(sg2.ay, sg2.by, cut.t);
        var nd = nodeAt(cut.x, cut.z, cy, air);
        addEdge(prev, nd, sg2.path);
        prev = nd;
      }
      addEdge(prev, nodeAt(sg2.bx, sg2.bz, sg2.by, air), sg2.path);
    }

    this.nodes = nodes;
    this.edges = edges;
    return this;
  };

  // ------------------------------------------------------------- tidy -----
  // Welding fixes roads that share a junction. It cannot fix two roads that
  // never meet but run down the same street a few metres apart, because
  // nothing in the generator knows that the arterial it just drew is on top
  // of a grid street laid by a different pass. Those pairs are what made the
  // map look smeared: two carriageways of tarmac where the city has one
  // street, with a leftover strip between them extracted as a "block" too
  // thin to hold a pavement.
  //
  // The unit of work here is a whole street, not a segment. Deleting single
  // overlapping segments is tempting and looks fine in the numbers, but it
  // punches a hole in the middle of a road and leaves the two halves either
  // side of the gap - visibly broken tarmac that traffic drives around. A
  // street is either redundant along its whole run or it stays.
  var PARALLEL_COS = 0.985;   // ~10 degrees
  var OVERLAP_FRAC = 0.55;    // most of the run has to be redundant
  var STUB_LEN = 30;          // a dead end shorter than this is debris

  // Higher is more worth keeping. Kind first - a freeway outranks everything,
  // and a multi-lane avenue outranks a street however long the street is -
  // then width, then length as the tie-break.
  function edgeRank(e) {
    var kind = e.kind === 'freeway' ? 4000 : e.kind === 'ramp' ? 3000 :
      (e.lanes > 1 ? 2000 : 1000);
    return kind + e.width * 10 + Math.min(e.len, 400) * 0.1;
  }

  // Break the graph into streets: maximal runs of edges joined end to end
  // through nodes that do nothing but continue the road. The ends of a chain
  // are junctions or dead ends, which is exactly the granularity at which
  // removing a road still leaves a coherent map.
  function chainsOf(nodes, edges, alive) {
    function degree(n) {
      var d = 0;
      for (var k = 0; k < n.edges.length; k++) if (alive[n.edges[k]]) d++;
      return d;
    }
    var used = new Uint8Array(edges.length);
    var chains = [];
    var i, k;
    for (i = 0; i < nodes.length; i++) {
      var start = nodes[i];
      if (degree(start) === 2) continue;              // mid-street, not an end
      for (k = 0; k < start.edges.length; k++) {
        var first = start.edges[k];
        if (!alive[first] || used[first]) continue;
        var ids = [first];
        used[first] = 1;
        var e = edges[first];
        var at = e.a === start.id ? e.b : e.a;
        var len = e.len;
        var guard = 0;
        while (degree(nodes[at]) === 2 && guard++ < 500) {
          var nxt = -1;
          for (var j = 0; j < nodes[at].edges.length; j++) {
            var cand = nodes[at].edges[j];
            if (alive[cand] && cand !== ids[ids.length - 1]) { nxt = cand; break; }
          }
          if (nxt < 0 || used[nxt]) break;
          used[nxt] = 1;
          ids.push(nxt);
          len += edges[nxt].len;
          var en = edges[nxt];
          at = en.a === at ? en.b : en.a;
        }
        chains.push({ ids: ids, a: start.id, b: at, len: len });
      }
    }
    return chains;
  }

  RoadNet.prototype.tidy = function () {
    var nodes = this.nodes, edges = this.edges;
    var i, j, k;

    var alive = new Uint8Array(edges.length);
    for (i = 0; i < edges.length; i++) alive[i] = 1;

    // Bounded reachability, used as a bridge test: if the far end of a street
    // is still reachable without it, the street is not the only thing holding
    // two halves of the map together and it is safe to drop. The bound makes a
    // failed search mean "could not prove it safe", so the road stays - the
    // pass errs toward leaving tarmac in rather than stranding a district.
    var mark = new Int32Array(nodes.length);
    var stamp = 0;
    var queue = new Int32Array(nodes.length);
    function reaches(from, to, skip) {
      if (from === to) return true;
      stamp++;
      var head = 0, tail = 0, visited = 0;
      queue[tail++] = from; mark[from] = stamp;
      while (head < tail && visited++ < 1200) {
        var cur = queue[head++];
        var nd = nodes[cur];
        for (var m = 0; m < nd.edges.length; m++) {
          var id = nd.edges[m];
          if (!alive[id] || skip[id]) continue;
          var e = edges[id];
          var other = e.a === cur ? e.b : e.a;
          if (mark[other] === stamp) continue;
          if (other === to) return true;
          mark[other] = stamp;
          queue[tail++] = other;
        }
      }
      return false;
    }

    // ---- how much of each edge is buried under another road
    var grid = new SB.Grid(60);
    for (i = 0; i < edges.length; i++) {
      var e0 = edges[i], a0 = nodes[e0.a], b0 = nodes[e0.b];
      grid.insert(e0,
        Math.min(a0.x, b0.x), Math.min(a0.z, b0.z),
        Math.max(a0.x, b0.x), Math.max(a0.z, b0.z));
    }

    // For each edge: the id of the best road it duplicates, or -1.
    var coveredBy = new Int32Array(edges.length);
    var q = [], gs = 1;
    for (i = 0; i < edges.length; i++) {
      coveredBy[i] = -1;
      var A = edges[i];
      if (A.elevated) continue;                 // a flyover belongs up there
      var an = nodes[A.a], bn = nodes[A.b];
      var near = grid.query(
        Math.min(an.x, bn.x) - 30, Math.min(an.z, bn.z) - 30,
        Math.max(an.x, bn.x) + 30, Math.max(an.z, bn.z) + 30, q, gs++);
      var bestRank = -1;
      for (j = 0; j < near.length; j++) {
        var B = near[j];
        if (B.id === A.id || B.elevated) continue;
        // Sharing a node makes them a junction, not a duplicate.
        if (A.a === B.a || A.a === B.b || A.b === B.a || A.b === B.b) continue;
        var cn = nodes[B.a], dn = nodes[B.b];
        var cos = Math.abs(Math.cos(
          Math.atan2(bn.z - an.z, bn.x - an.x) -
          Math.atan2(dn.z - cn.z, dn.x - cn.x)));
        if (cos < PARALLEL_COS) continue;
        // Distance from A's midpoint to B's centreline. Using the midpoint
        // catches a short street sitting alongside a long one without also
        // catching two streets that merely point the same way a block apart.
        var mx = (an.x + bn.x) * 0.5, mz = (an.z + bn.z) * 0.5;
        var dx = dn.x - cn.x, dz = dn.z - cn.z;
        var len2 = dx * dx + dz * dz;
        if (len2 < 1e-6) continue;
        var t = M.clamp(((mx - cn.x) * dx + (mz - cn.z) * dz) / len2, 0, 1);
        if (M.dist(cn.x + dx * t, cn.z + dz * t, mx, mz) >= (A.width + B.width) * 0.5) continue;
        var r = edgeRank(B);
        if (r > bestRank) { bestRank = r; coveredBy[i] = B.id; }
      }
    }

    // ---- 1. drop whole streets that duplicate a better one
    var chains = chainsOf(nodes, edges, alive);
    var cand = [];
    for (i = 0; i < chains.length; i++) {
      var ch = chains[i];
      var covered = 0, rank = 0, blocked = false;
      for (k = 0; k < ch.ids.length; k++) {
        var ce = edges[ch.ids[k]];
        // The freeway and its ramps are the skeleton of the map; the elevated
        // deck genuinely does run above other roads.
        if (ce.elevated || ce.kind === 'freeway' || ce.kind === 'ramp') { blocked = true; break; }
        rank = Math.max(rank, edgeRank(ce));
        var cover = coveredBy[ch.ids[k]];
        // Only redundant against a road that is at least as important, and
        // that is not part of this same street.
        if (cover >= 0 && edgeRank(edges[cover]) >= edgeRank(ce) &&
            ch.ids.indexOf(cover) < 0) covered += ce.len;
      }
      if (blocked || ch.len <= 0) continue;
      if (covered / ch.len < OVERLAP_FRAC) continue;
      cand.push({ ch: ch, rank: rank, frac: covered / ch.len });
    }
    // Weakest first, so a lane that duplicates three roads is considered
    // before the avenue it duplicates, and the avenue survives.
    cand.sort(function (m, n) { return (m.rank - n.rank) || (n.frac - m.frac); });

    var skip = new Uint8Array(edges.length);
    var droppedStreets = 0, droppedLen = 0;
    for (i = 0; i < cand.length; i++) {
      var c2 = cand[i].ch;
      var stillLive = false;
      for (k = 0; k < c2.ids.length; k++) if (alive[c2.ids[k]]) stillLive = true;
      if (!stillLive) continue;
      for (k = 0; k < c2.ids.length; k++) skip[c2.ids[k]] = 1;
      var safe = reaches(c2.a, c2.b, skip);
      if (safe) {
        for (k = 0; k < c2.ids.length; k++) { alive[c2.ids[k]] = 0; droppedLen += edges[c2.ids[k]].len; }
        droppedStreets++;
      }
      for (k = 0; k < c2.ids.length; k++) skip[c2.ids[k]] = 0;
    }

    // ---- 2. dead-end debris
    // A road that stops after twenty metres is not a cul-de-sac, it is the
    // tail of a curve clipped by a reserved zone or the map edge. Long dead
    // ends are left alone: suburbs are supposed to have them.
    var trimmed = 0;
    for (var pass = 0; pass < 4; pass++) {
      var again = false;
      var live = chainsOf(nodes, edges, alive);
      for (i = 0; i < live.length; i++) {
        var st = live[i];
        if (st.len > STUB_LEN) continue;
        var degA = 0, degB = 0, hard = false;
        for (k = 0; k < nodes[st.a].edges.length; k++) if (alive[nodes[st.a].edges[k]]) degA++;
        for (k = 0; k < nodes[st.b].edges.length; k++) if (alive[nodes[st.b].edges[k]]) degB++;
        if (degA !== 1 && degB !== 1) continue;        // not a dead end
        for (k = 0; k < st.ids.length; k++) {
          var te = edges[st.ids[k]];
          if (te.elevated || te.kind === 'freeway' || te.kind === 'ramp') hard = true;
        }
        if (hard) continue;
        for (k = 0; k < st.ids.length; k++) alive[st.ids[k]] = 0;
        trimmed++; again = true;
      }
      if (!again) break;
    }

    // ---- 3. rebuild
    var kept = [];
    for (i = 0; i < nodes.length; i++) nodes[i].edges = [];
    for (i = 0; i < edges.length; i++) {
      if (!alive[i]) continue;
      var k2 = edges[i];
      k2.id = kept.length;
      nodes[k2.a].edges.push(k2.id);
      nodes[k2.b].edges.push(k2.id);
      kept.push(k2);
    }
    this.edges = kept;
    this.tidied = {
      streets: droppedStreets, metres: Math.round(droppedLen), stubs: trimmed
    };
    return this;
  };

  // Keep only the largest connected component. An island of streets that no
  // road reaches is worse than no streets at all - traffic spawned there is
  // stranded, and the player can see roads they can never drive to.
  RoadNet.prototype.prune = function () {
    var nodes = this.nodes, edges = this.edges;
    var comp = new Int32Array(nodes.length).fill(-1);
    var sizes = [];
    for (var i = 0; i < nodes.length; i++) {
      if (comp[i] >= 0) continue;
      var id = sizes.length, count = 0;
      var stack = [i];
      comp[i] = id;
      while (stack.length) {
        var cur = stack.pop();
        count++;
        var nd = nodes[cur];
        for (var k = 0; k < nd.edges.length; k++) {
          var e = edges[nd.edges[k]];
          var other = e.a === cur ? e.b : e.a;
          if (comp[other] < 0) { comp[other] = id; stack.push(other); }
        }
      }
      sizes.push(count);
    }
    var best = 0;
    for (i = 1; i < sizes.length; i++) if (sizes[i] > sizes[best]) best = i;

    var keptNodes = [], remap = new Int32Array(nodes.length).fill(-1);
    for (i = 0; i < nodes.length; i++) {
      if (comp[i] !== best) continue;
      remap[i] = keptNodes.length;
      nodes[i].id = keptNodes.length;
      nodes[i].edges = [];
      keptNodes.push(nodes[i]);
    }
    var keptEdges = [];
    for (i = 0; i < edges.length; i++) {
      var ed = edges[i];
      if (remap[ed.a] < 0 || remap[ed.b] < 0) continue;
      ed.a = remap[ed.a]; ed.b = remap[ed.b];
      ed.id = keptEdges.length;
      keptNodes[ed.a].edges.push(ed.id);
      keptNodes[ed.b].edges.push(ed.id);
      keptEdges.push(ed);
    }
    this.nodes = keptNodes;
    this.edges = keptEdges;
    return this;
  };

  // ------------------------------------------------------------- faces -----
  // Recover city blocks from the graph. Walking each face by always taking the
  // next edge clockwise from the one we arrived on traces out the interior
  // faces; the single enormous face is the outside world and gets dropped.
  RoadNet.prototype.faces = function () {
    var nodes = this.nodes, edges = this.edges;
    var i, j;

    // sort each node's incident edges by bearing
    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var self = n;
      n.edges.sort(function (ea, eb) {
        var A = edges[ea], B = edges[eb];
        var oa = nodes[A.a === self.id ? A.b : A.a];
        var ob = nodes[B.a === self.id ? B.b : B.a];
        return Math.atan2(oa.z - self.z, oa.x - self.x) -
          Math.atan2(ob.z - self.z, ob.x - self.x);
      });
    }

    var visited = Object.create(null);
    var faces = [];
    for (i = 0; i < edges.length; i++) {
      for (var dir = 0; dir < 2; dir++) {
        var startFrom = dir === 0 ? edges[i].a : edges[i].b;
        var startTo = dir === 0 ? edges[i].b : edges[i].a;
        var key = startFrom + '>' + startTo;
        if (visited[key]) continue;

        var poly = [];
        var from = startFrom, to = startTo;
        var guard = 0;
        var ok = true;
        while (guard++ < 400) {
          visited[from + '>' + to] = 1;
          poly.push({ x: nodes[to].x, z: nodes[to].z, node: to });
          // at `to`, step to the edge just clockwise of the way we came in
          var cur = nodes[to];
          var back = -1;
          for (j = 0; j < cur.edges.length; j++) {
            var ee = edges[cur.edges[j]];
            var other = ee.a === to ? ee.b : ee.a;
            if (other === from) { back = j; break; }
          }
          if (back < 0) { ok = false; break; }
          var nextIdx = (back - 1 + cur.edges.length) % cur.edges.length;
          var ne = edges[cur.edges[nextIdx]];
          var nxt = ne.a === to ? ne.b : ne.a;
          from = to; to = nxt;
          if (from === startFrom && to === startTo) break;
        }
        if (!ok || guard >= 400 || poly.length < 3) continue;

        // signed area: interior faces come out positive with this winding
        var area = 0;
        for (j = 0; j < poly.length; j++) {
          var a = poly[j], b = poly[(j + 1) % poly.length];
          area += a.x * b.z - b.x * a.z;
        }
        area *= 0.5;
        if (area <= 0) continue;                       // outer face
        if (area > 300000) continue;                   // the whole-map face
        if (area < 90) continue;                       // degenerate
        faces.push({ poly: poly, area: area });
      }
    }
    return faces;
  };

  // ------------------------------------------------------ polygon tools ----
  function polyCentroid(poly) {
    var cx = 0, cz = 0, a = 0;
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i], q = poly[(i + 1) % poly.length];
      var cross = p.x * q.z - q.x * p.z;
      a += cross;
      cx += (p.x + q.x) * cross;
      cz += (p.z + q.z) * cross;
    }
    a *= 0.5;
    if (Math.abs(a) < 1e-6) return { x: poly[0].x, z: poly[0].z };
    return { x: cx / (6 * a), z: cz / (6 * a) };
  }

  // Shrink a polygon inward by a fixed distance, so the block's buildable lot
  // sits back off the kerb by the width of the pavement. This offsets each
  // edge along its own inward normal and re-intersects neighbouring edges,
  // rather than pulling vertices toward the centroid - a centroid pull
  // collapses long thin blocks, and long thin blocks are exactly what curved
  // streets produce.
  function polyInset(poly, amount) {
    var n = poly.length;
    if (n < 3) return null;
    var perEdge = typeof amount !== 'number';
    var lines = [];
    var i;
    for (i = 0; i < n; i++) {
      var p = poly[i], q = poly[(i + 1) % n];
      var dx = q.x - p.x, dz = q.z - p.z;
      var len = Math.hypot(dx, dz);
      if (len < 1e-6) return null;
      var ux = dx / len, uz = dz / len;
      // interior lies to the left of travel for a positively-wound polygon
      var nx = -uz, nz = ux;
      var off = perEdge ? amount[i] : amount;
      lines.push({ px: p.x + nx * off, pz: p.z + nz * off, ux: ux, uz: uz });
    }
    var out = [];
    for (i = 0; i < n; i++) {
      var A = lines[(i - 1 + n) % n], B = lines[i];
      var corner = poly[i];
      var off = perEdge ? Math.max(amount[(i - 1 + n) % n], amount[i]) : amount;
      var denom = A.ux * B.uz - A.uz * B.ux;
      var ox = (A.px + B.px) * 0.5, oz = (A.pz + B.pz) * 0.5;
      if (Math.abs(denom) < 0.02) {
        // near-parallel neighbours: the corner is effectively a straight run,
        // and solving for their intersection would send the vertex to infinity
        out.push({ x: ox, z: oz });
        continue;
      }
      var t = ((B.px - A.px) * B.uz - (B.pz - A.pz) * B.ux) / denom;
      var vx = A.px + A.ux * t, vz = A.pz + A.uz * t;
      // A shallow corner still produces a miter that runs far past anything
      // sensible. Cap how far the inset vertex may travel from the corner it
      // came from; beyond that, bevel it instead.
      var lim = off * 4 + 24;
      if (!isFinite(vx) || !isFinite(vz) || M.dist2(vx, vz, corner.x, corner.z) > lim * lim) {
        out.push({ x: ox, z: oz });
        continue;
      }
      out.push({ x: vx, z: vz });
    }
    // an inset that folds through itself means the block was thinner than the
    // pavement; there is nothing to build on
    var area = 0;
    for (i = 0; i < n; i++) {
      var a = out[i], b = out[(i + 1) % n];
      area += a.x * b.z - b.x * a.z;
    }
    if (area * 0.5 < 40) return null;
    return out;
  }

  function polyBounds(poly) {
    var x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i];
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.z < z0) z0 = p.z;
      if (p.z > z1) z1 = p.z;
    }
    return { x0: x0, z0: z0, x1: x1, z1: z1 };
  }

  function pointInPoly(poly, x, z) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a.z > z) !== (b.z > z) &&
        x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
    }
    return inside;
  }

  function polyArea(poly) {
    var a = 0;
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i], q = poly[(i + 1) % poly.length];
      a += p.x * q.z - q.x * p.z;
    }
    return Math.abs(a) * 0.5;
  }

  SB.Poly = {
    centroid: polyCentroid, inset: polyInset, bounds: polyBounds,
    contains: pointInPoly, area: polyArea
  };

  // ====================================================== region layout ====
  // Each region draws roads in its own idiom. Together they make a city that
  // never repeats the same street pattern twice.

  // Which idiom owns a given patch of ground. Each region's roads reject
  // points outside their own patch, so the street pattern changes completely
  // when you drive from one part of town into the next - which is the whole
  // point of the map. Arterials and the freeway deliberately ignore this and
  // stitch the regions back together.
  function regionAt(x, z) {
    if (x < BEACH_X + 210) return 'beach';
    if (terrainAt(x, z) > 9) return 'hills';
    if (M.dist2(x, z, 630, 480) < 400 * 400) return 'suburbSE';
    if (M.dist2(x, z, -650, 440) < 350 * 350) return 'suburbSW';
    if (z > 520 && x > -340 && x < 470) return 'industrial';
    if (x * x + z * z < 430 * 430) return 'downtown';
    return 'midtown';
  }
  function notIn(name) {
    return function (x, z) { return regionAt(x, z) !== name; };
  }

  // Downtown: a warped radial web. Rings that wobble, avenues that radiate
  // but bend, and diagonals cutting across - so nothing stays parallel.
  function layDowntown(net, rng) {
    var R0 = 62, RINGS = 8, ringGap = 52;
    var HUB = 46;              // the circus at the centre
    var rej = notIn('downtown');
    var r, k;

    // Every radial plan has to answer the question of what happens where the
    // spokes meet, and the answer is never "they all cross at a point". Seven
    // avenues converging inside a 70m circle was a knot of tarmac with no
    // block big enough to build on. A circus at the centre gives them
    // somewhere to arrive: the spokes terminate on the ring, the ring carries
    // the turning movements, and the middle becomes one plaza-sized block
    // instead of a dozen slivers.
    net.addCurve(function (t) {
      var a = t * Math.PI * 2;
      return { x: Math.cos(a) * HUB, z: Math.sin(a) * HUB * 0.92 };
    }, 36, { width: AVENUE_W, lanes: 2 }, rej);
    for (r = 0; r < RINGS; r++) {
      var rad = R0 + r * ringGap;
      var wob = ringGap * rng.range(0.13, 0.26);
      var phase = rng() * 6.28;
      var wide = (r === 2 || r === 5);
      net.addCurve(function (t) {
        var a = t * Math.PI * 2;
        var rr = rad + Math.sin(a * 3 + phase) * wob + Math.sin(a * 5 - phase) * wob * 0.4;
        return { x: Math.cos(a) * rr, z: Math.sin(a) * rr * 0.92 };
      }, 54 + r * 6, { width: wide ? AVENUE_W : STREET_W, lanes: wide ? 2 : 1 }, rej);
    }
    var spokes = 13;
    for (k = 0; k < spokes; k++) {
      var base = (k / spokes) * Math.PI * 2 + rng() * 0.10;
      var bend = (rng() - 0.5) * 0.55;
      var major = k % 4 === 0;
      // Only every third spoke runs all the way in. The rest start out at the
      // third ring, so the inner two rings are streets rather than a starburst.
      var inner = (k % 3 === 0) ? HUB : R0 + ringGap * 1.6;
      var outer = R0 + RINGS * ringGap + 30;
      net.addCurve(function (t) {
        var rr = M.lerp(inner, outer, t);
        var a = base + bend * t * t;
        return { x: Math.cos(a) * rr, z: Math.sin(a) * rr * 0.92 };
      }, 34, { width: major ? AVENUE_W : STREET_W, lanes: major ? 2 : 1 }, rej);
    }
    // diagonals slicing across the rings, the streets that make downtown
    // confusing in the way real downtowns are
    for (k = 0; k < 5; k++) {
      var a0 = rng() * 6.28;
      var a1 = a0 + 1.9 + rng() * 1.0;
      var rA = R0 + rng() * 300, rB = R0 + rng() * 300;
      net.add([
        { x: Math.cos(a0) * rA, z: Math.sin(a0) * rA * 0.92 },
        { x: (Math.cos(a0) * rA + Math.cos(a1) * rB) * 0.5 + (rng() - 0.5) * 70,
          z: (Math.sin(a0) * rA + Math.sin(a1) * rB) * 0.46 + (rng() - 0.5) * 70 },
        { x: Math.cos(a1) * rB, z: Math.sin(a1) * rB * 0.92 }
      ], { width: AVENUE_W, lanes: 2 });
    }
  }

  // Midtown: a grid pushed out of true. Every line bows, spacing varies, and
  // it reads as a city that grew rather than one that was planned.
  function layWarped(net, rng, x0, z0, x1, z1, spacing, warp, region) {
    var x, z;
    var cols = [], rows = [];
    var rej = region ? notIn(region) : null;
    for (x = x0; x <= x1; x += spacing * rng.range(0.74, 1.28)) cols.push(x);
    for (z = z0; z <= z1; z += spacing * rng.range(0.74, 1.28)) rows.push(z);

    for (var c = 0; c < cols.length; c++) {
      var cx = cols[c];
      var amp = warp * rng.range(0.5, 1.5);
      var ph = rng() * 6.28;
      var wide = c % 5 === 1;
      net.addCurve(function (t) {
        var zz = M.lerp(z0, z1, t);
        return { x: cx + Math.sin(t * 3.1 + ph) * amp + Math.sin(t * 7.3 + ph) * amp * 0.3, z: zz };
      }, 44, { width: wide ? AVENUE_W : STREET_W, lanes: wide ? 2 : 1 }, rej);
    }
    for (var r2 = 0; r2 < rows.length; r2++) {
      var rz = rows[r2];
      var amp2 = warp * rng.range(0.5, 1.5);
      var ph2 = rng() * 6.28;
      var wide2 = r2 % 5 === 2;
      net.addCurve(function (t) {
        var xx = M.lerp(x0, x1, t);
        return { x: xx, z: rz + Math.sin(t * 2.7 + ph2) * amp2 + Math.sin(t * 6.1 + ph2) * amp2 * 0.3 };
      }, 44, { width: wide2 ? AVENUE_W : STREET_W, lanes: wide2 ? 2 : 1 }, rej);
    }
  }

  // Suburbs: concentric looping crescents fed by spines, with cul-de-sacs
  // hanging off them. No straight line survives more than a few metres.
  function laySuburb(net, rng, cx, cz, radius, region) {
    var rej = region ? notIn(region) : null;
    var loops = 9, i;
    for (i = 0; i < loops; i++) {
      var gapR = radius * 0.098;
      var rad = radius * 0.16 + gapR * i;
      var squash = rng.range(0.70, 1.0);
      var wob = gapR * rng.range(0.14, 0.28);
      var ph = rng() * 6.28;
      net.addCurve(function (t) {
        var a = t * Math.PI * 2;
        var rr = rad + Math.sin(a * 2 + ph) * wob + Math.sin(a * 3.7 - ph) * wob * 0.5;
        return { x: cx + Math.cos(a) * rr, z: cz + Math.sin(a) * rr * squash };
      }, 52, { width: STREET_W, lanes: 1 }, rej);
    }
    for (i = 0; i < 6; i++) {
      var a0 = (i / 6) * Math.PI * 2 + rng.range(-0.22, 0.22);
      var wide = i % 2 === 0;
      net.addCurve(function (t) {
        var rr = t * radius * 1.08;
        var a = a0 + Math.sin(t * 2.2) * 0.26;
        return { x: cx + Math.cos(a) * rr, z: cz + Math.sin(a) * rr * 0.85 };
      }, 30, { width: wide ? AVENUE_W : STREET_W, lanes: wide ? 2 : 1 }, rej);
    }
    // cul-de-sacs: a short stub ending in a turning bulb, the signature move
    for (i = 0; i < 30; i++) {
      var ang = rng() * 6.28;
      var rr0 = radius * rng.range(0.26, 0.90);
      var sx = cx + Math.cos(ang) * rr0, sz = cz + Math.sin(ang) * rr0 * 0.85;
      if (inReserved(sx, sz, 20)) continue;
      var outAng = ang + rng.range(-0.9, 0.9);
      var len = rng.range(30, 56);
      var ex = sx + Math.cos(outAng) * len, ez = sz + Math.sin(outAng) * len;
      net.add([{ x: sx, z: sz },
        { x: sx + Math.cos(outAng) * len * 0.55 + Math.cos(outAng + 1.57) * rng.range(-8, 8),
          z: sz + Math.sin(outAng) * len * 0.55 + Math.sin(outAng + 1.57) * rng.range(-8, 8) },
        { x: ex, z: ez }], { width: 12, lanes: 1 });
      var bulbR = 13;
      net.addCurve(function (t) {
        var a = t * Math.PI * 2;
        return { x: ex + Math.cos(a) * bulbR, z: ez + Math.sin(a) * bulbR };
      }, 12, { width: 11, lanes: 1 });
    }
  }

  // Hills: switchbacks climbing the slope, crossed by contour roads that hold
  // their elevation. The hairpins are what sell the height, and the contours
  // are what turn a pair of climbing roads into an actual hillside
  // neighbourhood with blocks between them.
  function layHills(net, rng) {
    var runs = [
      { x0: 300, z0: -200, x1: 900, z1: -720, legs: 10, spread: 215 },
      { x0: 980, z0: -160, x1: 700, z1: -640, legs: 8, spread: 175 }
    ];
    var r, i, k;
    for (r = 0; r < runs.length; r++) {
      var run = runs[r];
      var pts = [];
      for (i = 0; i <= run.legs; i++) {
        var t = i / run.legs;
        var bx = M.lerp(run.x0, run.x1, t);
        var bz = M.lerp(run.z0, run.z1, t);
        var side = (i % 2 === 0 ? 1 : -1);
        var perpA = Math.atan2(run.z1 - run.z0, run.x1 - run.x0) + Math.PI / 2;
        var off = side * run.spread * (0.35 + 0.65 * Math.sin(t * Math.PI));
        var px = bx + Math.cos(perpA) * off;
        var pz = bz + Math.sin(perpA) * off;
        if (i > 0) {
          var prev = pts[pts.length - 1];
          pts.push({ x: M.lerp(prev.x, px, 0.45) + rng.range(-14, 14),
            z: M.lerp(prev.z, pz, 0.45) + rng.range(-14, 14) });
        }
        pts.push({ x: px, z: pz });
      }
      for (i = 0; i < pts.length; i++) pts[i].y = terrainAt(pts[i].x, pts[i].z);
      net.add(pts, { width: AVENUE_W, lanes: 2 });
    }

    // contour roads: walk around each hill at a fixed height, following the
    // gradient outward until the terrain matches the target elevation
    // Only the two dominant summits get contour roads. The hills overlap one
    // another, so ringing all five stacked loop on loop until the tops were
    // more carriageway than ground.
    var peaks = [HILLS[0], HILLS[2]];
    for (i = 0; i < peaks.length; i++) {
      var hp = peaks[i];
      var levels = Math.max(2, Math.round(hp.h / 34));
      for (var lv = 1; lv <= levels; lv++) {
        var frac = lv / (levels + 0.6);
        var rr = hp.r * Math.sqrt(1 - Math.sqrt(frac)) * 0.94;
        if (rr < 70) continue;
        var wobP = rng() * 6.28, wobA = rng.range(0.06, 0.15);
        net.addCurve(function (t) {
          var a = t * Math.PI * 2;
          var radius = rr * (1 + Math.sin(a * 3 + wobP) * wobA);
          var x = hp.x + Math.cos(a) * radius;
          var z = hp.z + Math.sin(a) * radius * 0.9;
          return { x: x, z: z, y: terrainAt(x, z) };
        }, 46, { width: STREET_W, lanes: 1 });
      }
    }

    // ridge road along the tops
    var ridge = [];
    for (k = 0; k <= 34; k++) {
      var t2 = k / 34;
      var rx = M.lerp(360, 1010, t2) + Math.sin(t2 * 5) * 70;
      var rz = M.lerp(-280, -700, t2) + Math.cos(t2 * 4) * 90;
      ridge.push({ x: rx, z: rz, y: terrainAt(rx, rz) });
    }
    net.add(ridge, { width: STREET_W, lanes: 1 });

    // short driveways hanging off the contours
    for (k = 0; k < 10; k++) {
      var sx = M.lerp(380, 1000, rng());
      var sz = M.lerp(-260, -710, rng());
      var a = rng() * 6.28, L2 = rng.range(34, 76);
      net.add([
        { x: sx, z: sz, y: terrainAt(sx, sz) },
        { x: sx + Math.cos(a) * L2, z: sz + Math.sin(a) * L2,
          y: terrainAt(sx + Math.cos(a) * L2, sz + Math.sin(a) * L2) }
      ], { width: 12, lanes: 1 });
    }
  }

  // Industrial / port: long service roads and very large yards.
  function layIndustrial(net, rng, x0, z0, x1, z1) {
    var z, x;
    for (z = z0; z <= z1; z += rng.range(105, 155)) {
      net.add([{ x: x0, z: z }, { x: (x0 + x1) / 2, z: z + rng.range(-16, 16) }, { x: x1, z: z }],
        { width: AVENUE_W, lanes: 2 });
    }
    for (x = x0; x <= x1; x += rng.range(135, 195)) {
      net.add([{ x: x, z: z0 }, { x: x + rng.range(-14, 14), z: (z0 + z1) / 2 }, { x: x, z: z1 }],
        { width: STREET_W, lanes: 1 });
    }
  }

  // The beachfront: one promenade running the length of the shore with short
  // streets combing back off it into the blocks behind.
  function layBeach(net, rng) {
    var prom = [];
    for (var i = 0; i <= 60; i++) {
      var t = i / 60;
      var z = M.lerp(-620, 860, t);
      var x = BEACH_X + 62 + Math.sin(t * 5.1) * 26;
      prom.push({ x: x, z: z, y: 0 });
    }
    net.add(prom, { width: AVENUE_W, lanes: 2 });
    for (i = 0; i < 26; i++) {
      var pz = M.lerp(-600, 840, i / 25) + rng.range(-14, 14);
      var px = BEACH_X + 56;
      net.add([{ x: px, z: pz, y: 0 },
        { x: px + rng.range(120, 210), z: pz + rng.range(-24, 24), y: 0 }],
        { width: STREET_W, lanes: 1 });
    }
  }

  // A perimeter road around every reserved zone, and a boulevard around the
  // whole built-up area. These exist for a structural reason as much as a
  // realistic one: streets that run into the airport fence currently just stop,
  // and a street that stops closes no city block. Giving them something to
  // terminate against turns dozens of dead fragments into real blocks - which
  // is also exactly what a perimeter road is for in a real city.
  function layPerimeters(net, rng) {
    var i, k;
    for (i = 0; i < RESERVED.length; i++) {
      var r = RESERVED[i];
      var pad = 20;
      var x0 = r.x0 - pad, z0 = r.z0 - pad, x1 = r.x1 + pad, z1 = r.z1 + pad;
      var pts = [];
      // walk the rectangle with a few intermediate points so the ring welds
      // cleanly against everything that runs into it
      function side(ax, az, bx, bz) {
        var n = Math.max(2, Math.round(Math.hypot(bx - ax, bz - az) / 40));
        for (var j = 0; j < n; j++) {
          pts.push({ x: M.lerp(ax, bx, j / n), z: M.lerp(az, bz, j / n) });
        }
      }
      side(x0, z0, x1, z0); side(x1, z0, x1, z1);
      side(x1, z1, x0, z1); side(x0, z1, x0, z0);
      pts.push({ x: x0, z: z0 });
      for (k = 0; k < pts.length; k++) pts[k].y = terrainAt(pts[k].x, pts[k].z);
      net.add(pts, { width: AVENUE_W, lanes: 2 });
    }

    // an outer boulevard, holding the edge of the city
    var ring = [];
    for (i = 0; i <= 110; i++) {
      var a = (i / 110) * Math.PI * 2;
      var rr = 880 + Math.sin(a * 3 + 0.4) * 90 + Math.sin(a * 2 - 1.1) * 60;
      var x = Math.cos(a) * rr, z = Math.sin(a) * rr * 0.95;
      if (x < BEACH_X + 120) { x = BEACH_X + 120; }
      ring.push({ x: x, z: z, y: terrainAt(x, z) });
    }
    net.add(ring, { width: AVENUE_W, lanes: 2 });

    // and a mid boulevard between the core and the edge, which gives the
    // outer districts a second continuous route and closes their blocks
    var mid = [];
    for (i = 0; i <= 90; i++) {
      var a2 = (i / 90) * Math.PI * 2;
      var rr2 = 560 + Math.sin(a2 * 2 + 2.2) * 80 + Math.sin(a2 * 5) * 40;
      var mx = Math.cos(a2) * rr2, mz = Math.sin(a2) * rr2 * 0.95;
      if (inReserved(mx, mz, 14)) continue;
      mid.push({ x: mx, z: mz, y: terrainAt(mx, mz) });
    }
    net.add(mid, { width: AVENUE_W, lanes: 2 });
  }

  // The elevated freeway: a ring in the sky with ramps down into the city.
  // Marked noBlocks so it never carves the ground into fake city blocks.
  function layFreeway(net, rng) {
    var ringPts = [];
    for (var i = 0; i <= 96; i++) {
      var a = (i / 96) * Math.PI * 2;
      var rr = 690 + Math.sin(a * 2) * 110 + Math.sin(a * 3 + 1.1) * 70;
      var x = Math.cos(a) * rr;
      var z = Math.sin(a) * rr * 0.95;
      if (inReserved(x, z, 30)) { rr *= 0.72; x = Math.cos(a) * rr; z = Math.sin(a) * rr * 0.95; }
      ringPts.push({ x: x, z: z, y: FREEWAY_Y + terrainAt(x, z) * 0.55 });
    }
    ringPts.push({ x: ringPts[0].x, z: ringPts[0].z, y: ringPts[0].y });
    net.add(ringPts, { width: FREEWAY_W, lanes: 2, kind: 'freeway', elevated: true, noBlocks: true });

    // a spur straight across the middle, so the ring is not the only fast road
    var spur = [];
    for (i = 0; i <= 40; i++) {
      var t = i / 40;
      var sx = M.lerp(-660, 660, t);
      var sz = Math.sin(t * Math.PI) * 150 - 40;
      spur.push({ x: sx, z: sz, y: FREEWAY_Y + 5 + terrainAt(sx, sz) * 0.4 });
    }
    net.add(spur, { width: FREEWAY_W, lanes: 2, kind: 'freeway', elevated: true, noBlocks: true });

    // on/off ramps: each one descends from the ring to ground level
    var ramps = [];
    for (i = 0; i < 10; i++) {
      var ra = (i / 10) * Math.PI * 2 + 0.25;
      var idx = Math.round((ra / (Math.PI * 2)) * 96) % 96;
      var top = ringPts[idx];
      var inward = Math.atan2(-top.z, -top.x);
      var pts = [];
      for (var k = 0; k <= 10; k++) {
        var tt = k / 10;
        var rr2 = 200 * tt;
        var bend = inward + Math.sin(tt * 2.4) * 0.5;
        var px = top.x + Math.cos(bend) * rr2;
        var pz = top.z + Math.sin(bend) * rr2;
        if (inReserved(px, pz, 15)) break;
        pts.push({ x: px, z: pz, y: M.lerp(top.y, terrainAt(px, pz), M.smoothstep(tt)) });
      }
      if (pts.length > 3) {
        // Split the ramp where it reaches street height. The flying part stays
        // elevated (and so only meets other elevated roads); the tail is a
        // normal road, which is what lets it weld into the city grid below.
        var touch = pts.length - 1;
        for (var m = 1; m < pts.length; m++) {
          if (pts[m].y - terrainAt(pts[m].x, pts[m].z) < 1.6) { touch = m; break; }
        }
        touch = Math.max(2, Math.min(touch, pts.length - 2));
        net.add(pts.slice(0, touch + 1),
          { width: 16, lanes: 1, kind: 'ramp', elevated: true, noBlocks: true });
        var tail = pts.slice(touch);
        // run the tail on a little further so it is sure to meet a street
        var last = tail[tail.length - 1], prev2 = tail[tail.length - 2];
        var tdx = last.x - prev2.x, tdz = last.z - prev2.z;
        var tl = Math.hypot(tdx, tdz) || 1;
        for (var g = 1; g <= 3; g++) {
          var ex = last.x + tdx / tl * 34 * g, ez = last.z + tdz / tl * 34 * g;
          if (inReserved(ex, ez, 10)) break;
          tail.push({ x: ex, z: ez, y: terrainAt(ex, ez) });
        }
        for (var h = 0; h < tail.length; h++) tail[h].y = terrainAt(tail[h].x, tail[h].z);
        net.add(tail, { width: 16, lanes: 1, kind: 'ramp' });
        ramps.push(pts);
      }
    }
    return ramps;
  }

  // Arterials tying the outer districts back to the core.
  function layArterials(net, rng) {
    var targets = [
      { x: 640, z: 470 }, { x: -640, z: 430 }, { x: 700, z: -420 },
      { x: -660, z: -300 }, { x: 120, z: 720 }, { x: -180, z: -690 },
      { x: 880, z: 120 }, { x: -820, z: 60 }
    ];
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var pts = [];
      for (var k = 0; k <= 16; k++) {
        var u = k / 16;
        var x = M.lerp(0, t.x, u) + Math.sin(u * 3.4 + i) * 60 * (1 - u * 0.4);
        var z = M.lerp(0, t.z, u) + Math.cos(u * 3.0 + i) * 60 * (1 - u * 0.4);
        if (inReserved(x, z, 14)) break;
        pts.push({ x: x, z: z, y: terrainAt(x, z) });
      }
      if (pts.length > 3) net.add(pts, { width: AVENUE_W, lanes: 2 });
    }
    // a coastal road hugging the shoreline
    var coast = [];
    for (i = 0; i <= 40; i++) {
      var ct = i / 40;
      var cz = M.lerp(-560, 780, ct);
      var cx = BEACH_X + 120 + Math.sin(ct * 4.2) * 55;
      if (inReserved(cx, cz, 14)) continue;
      coast.push({ x: cx, z: cz, y: 0 });
    }
    net.add(coast, { width: AVENUE_W, lanes: 2 });
  }

  // ============================================================= rail =====
  // A single loop line, elevated where it crosses the city and on the ground
  // out in the open, with stations spaced around it.
  function buildRail() {
    var pts = [];
    var N = 320;
    for (var i = 0; i <= N; i++) {
      var t = i / N;
      var a = t * Math.PI * 2;
      var rr = 470 + Math.sin(a * 2 + 0.7) * 130 + Math.sin(a * 3) * 60;
      var x = Math.cos(a) * rr;
      var z = Math.sin(a) * rr * 0.9;
      var ground = terrainAt(x, z);
      // elevated through the dense middle third of the loop, on grade elsewhere
      var elev = 0.5 + 0.5 * Math.sin(a * 2 - 1.0);
      var y = ground + 1.2 + elev * 9.5;
      pts.push({ x: x, z: z, y: y, elevated: elev > 0.35 });
    }
    var stations = [];
    var names = ['Union', 'Harborside', 'Midtown', 'Hillcrest', 'Southgate', 'Eastpark'];
    for (i = 0; i < names.length; i++) {
      var idx = Math.floor((i / names.length) * N);
      var p = pts[idx];
      stations.push({ name: names[i] + ' Station', x: p.x, y: p.y, z: p.z, index: idx });
    }
    return { pts: pts, stations: stations, loop: true };
  }

  // ============================================================= build ====
  function build() {
    var rng = M.rng(0x5B2020);
    var net = new RoadNet();

    layDowntown(net, rng);
    layWarped(net, rng, -900, -760, 980, 900, 72, 15, 'midtown');
    laySuburb(net, rng, 630, 480, 400, 'suburbSE');
    laySuburb(net, rng, -650, 440, 350, 'suburbSW');
    layHills(net, rng);
    layIndustrial(net, rng, -330, 540, 460, 900);
    layBeach(net, rng);
    layArterials(net, rng);
    layPerimeters(net, rng);
    // The offshore chain, if the islands module is present. Pelican Key's
    // streets go in here rather than being drawn separately, so blocks,
    // buildings, traffic and navigation all treat the key as part of the
    // city - which is exactly what a causeway makes it.
    if (SB.Islands) SB.Islands.layRoads(net, BEACH_X);
    var ramps = layFreeway(net, rng);

    net.weld();
    net.tidy();
    net.prune();
    var faces = net.faces();

    var L = {
      nodes: net.nodes,
      edges: net.edges,
      blocks: [],
      lights: [],
      rail: buildRail(),
      hills: HILLS,
      terrainAt: terrainAt,
      reserved: RESERVED,
      freewayRamps: ramps,
      bounds: { minX: -EXTENT, maxX: EXTENT, minZ: -EXTENT, maxZ: EXTENT },
      // How far west the world reaches. bounds stays the mainland, because
      // props and city scatter over it; this is the number the terrain field
      // and the play-area clamp use so the islands are inside the world.
      seaMinX: SB.Islands ? SB.Islands.minX : -EXTENT - 220,
      islands: SB.Islands ? SB.Islands.LIST : [],
      beachX: BEACH_X,
      waterX: BEACH_X - 120,
      DIST: DIST,
      SIDEWALK_W: SIDEWALK_W,
      FREEWAY_Y: FREEWAY_Y
    };

    // ---- blocks from faces
    var blockRng = M.rng(0xB10C5);
    for (var f = 0; f < faces.length; f++) {
      var face = faces[f];
      var poly = face.poly;
      var c = polyCentroid(poly);
      if (inReserved(c.x, c.z, 0)) continue;
      // Blocks are clipped to the mainland extent, plus whatever the islands
      // claim: without the second test the key's streets would enclose faces
      // that are silently dropped, and the island would come out paved and
      // empty.
      if (Math.abs(c.z) > EXTENT) continue;
      if (Math.abs(c.x) > EXTENT && !(SB.Islands && SB.Islands.near(c.x, c.z, 30))) continue;
      // A face's boundary runs down the middle of the streets around it, so
      // the block proper starts half a carriageway in - and each side has to
      // be pulled in by ITS OWN road's width, or a block between an avenue and
      // an alley ends up lopsided.
      var halfW = [];
      var kerbIn = [];
      for (var vi = 0; vi < poly.length; vi++) {
        var n0 = poly[vi].node, n1 = poly[(vi + 1) % poly.length].node;
        var w = STREET_W;
        var nd0 = L.nodes[n0];
        for (var ei = 0; ei < nd0.edges.length; ei++) {
          var ce = L.edges[nd0.edges[ei]];
          if ((ce.a === n0 && ce.b === n1) || (ce.b === n0 && ce.a === n1)) { w = ce.width; break; }
        }
        halfW.push(w * 0.5);
        kerbIn.push(w * 0.5 + SIDEWALK_W);
      }
      var kerbPoly = polyInset(poly, halfW);
      if (!kerbPoly) continue;
      var lot = polyInset(poly, kerbIn);
      // A face too narrow to hold a pavement and a building is still a real
      // piece of ground between two streets. Paving it as a traffic island
      // keeps the city continuous - leaving it out puts a patch of open
      // countryside in the middle of downtown.
      var island = false;
      if (!lot) { lot = kerbPoly; island = true; }
      var bb = polyBounds(kerbPoly);
      var lb = polyBounds(lot);
      var district = districtFor(c.x, c.z);

      var b = {
        id: L.blocks.length,
        poly: poly, kerbPoly: kerbPoly,
        lot: { poly: lot, x0: lb.x0, z0: lb.z0, x1: lb.x1, z1: lb.z1 },
        x0: bb.x0, z0: bb.z0, x1: bb.x1, z1: bb.z1,
        cx: c.x, cz: c.z,
        w: bb.x1 - bb.x0, d: bb.z1 - bb.z0,
        area: SB.Poly.area(kerbPoly),
        y: terrainAt(c.x, c.z),
        district: district,
        kind: 'buildings',
        seed: (f * 73856093) >>> 0,
        neighbors: []
      };

      var r = blockRng();
      if (island || b.area < 520) {
        b.kind = (district === DIST.SUBURB || district === DIST.HILLS ||
          district === DIST.BEACH) && r < 0.6 ? 'park' : 'island';
        L.blocks.push(b);
        continue;
      }
      // parks, plazas and surface lots, so the fabric is not wall-to-wall
      if (district === DIST.DOWNTOWN) {
        if (r < 0.09) b.kind = 'plaza'; else if (r < 0.15) b.kind = 'lot';
      } else if (district === DIST.INDUSTRIAL) {
        if (r < 0.28) b.kind = 'lot';
      } else if (district === DIST.BEACH) {
        if (r < 0.24) b.kind = 'park';
      } else if (district === DIST.SUBURB) {
        if (r < 0.14) b.kind = 'park';
      } else {
        if (r < 0.10) b.kind = 'park'; else if (r < 0.17) b.kind = 'lot';
      }
      // a very large block is open ground, never one enormous building
      if (b.area > 26000 && b.kind === 'buildings') b.kind = r < 0.55 ? 'park' : 'lot';
      L.blocks.push(b);
    }

    L.blockGrid = new SB.Grid(70);
    for (var i = 0; i < L.blocks.length; i++) {
      var bl = L.blocks[i];
      L.blockGrid.insert(bl, bl.x0, bl.z0, bl.x1, bl.z1);
    }

    // neighbour links, used by pedestrians deciding to cross the street
    var q = [], stamp = 1;
    for (i = 0; i < L.blocks.length; i++) {
      var me = L.blocks[i];
      var near = L.blockGrid.query(me.x0 - 40, me.z0 - 40, me.x1 + 40, me.z1 + 40, q, stamp++);
      for (var n2 = 0; n2 < near.length; n2++) {
        if (near[n2] !== me && me.neighbors.length < 8) me.neighbors.push(near[n2]);
      }
    }

    // ---- signals at the busiest junctions
    var lightRng = M.rng(0xA11CE);
    for (i = 0; i < L.nodes.length; i++) {
      var nd = L.nodes[i];
      nd.halfX = 9; nd.halfZ = 9;
      var wide = 0;
      for (var e = 0; e < nd.edges.length; e++) {
        var ed = L.edges[nd.edges[e]];
        if (ed.elevated) { wide = -99; break; }        // never signal a flyover
        if (ed.lanes > 1) wide++;
        nd.halfX = Math.max(nd.halfX, ed.width / 2);
        nd.halfZ = Math.max(nd.halfZ, ed.width / 2);
      }
      nd.hasLight = wide >= 1 && nd.edges.length >= 3;
      if (nd.hasLight) {
        // no two signals within sight of each other
        var tooClose = false;
        for (var q2 = 0; q2 < L.lights.length; q2++) {
          if (M.dist2(L.lights[q2].x, L.lights[q2].z, nd.x, nd.z) < 68 * 68) { tooClose = true; break; }
        }
        if (tooClose) nd.hasLight = false;
      }
      if (!nd.hasLight) { nd.light = null; continue; }
      var lg = {
        node: nd.id, x: nd.x, z: nd.z,
        period: 17 + lightRng() * 5,
        offset: lightRng() * 20,
        greenX: 0.5, phase: 0, timer: 0
      };
      nd.light = lg;
      L.lights.push(lg);
    }

    // ---- landmark blocks the HUD points at
    L.landmarks = {
      garage: pickBlock(L, -150, 150, 'buildings'),
      stadium: pickBlock(L, 430, 300, null),
      park: pickBlock(L, 60, 40, null),
      // The fire station needs a block of its own with a street on it: an
      // apparatus bay that opens onto somebody's back garden is no use when
      // the engines have to get out in seconds.
      firehouse: pickBlock(L, -330, -110, 'buildings')
    };
    if (L.landmarks.garage) L.landmarks.garage.kind = 'garage';
    if (L.landmarks.stadium) L.landmarks.stadium.kind = 'stadium';
    if (L.landmarks.park) L.landmarks.park.kind = 'park';
    // 'firehouse' is not a kind the city builder knows, which is the point:
    // it skips anything that is not 'buildings', so the block comes out as
    // open paved ground for the fire module to build on.
    if (L.landmarks.firehouse) L.landmarks.firehouse.kind = 'firehouse';

    // ---- edge lookup grid, for "am I on a road" tests
    // Anything flying over the city - freeway decks, ramps, the elevated
    // railway - claims the air above its route. Buildings consult this so a
    // tower never grows straight through a viaduct.
    L.airGrid = new SB.Grid(40);
    for (i = 0; i < L.edges.length; i++) {
      var ae = L.edges[i];
      if (!ae.elevated) continue;
      var an = L.nodes[ae.a], bn = L.nodes[ae.b];
      L.airGrid.insert({ ax: an.x, az: an.z, bx: bn.x, bz: bn.z, r: ae.width * 0.5 + 4 },
        Math.min(an.x, bn.x) - 6, Math.min(an.z, bn.z) - 6,
        Math.max(an.x, bn.x) + 6, Math.max(an.z, bn.z) + 6);
    }
    var rp = L.rail.pts;
    for (i = 0; i < rp.length - 1; i++) {
      var r0 = rp[i], r1 = rp[i + 1];
      L.airGrid.insert({ ax: r0.x, az: r0.z, bx: r1.x, bz: r1.z, r: 7 },
        Math.min(r0.x, r1.x) - 8, Math.min(r0.z, r1.z) - 8,
        Math.max(r0.x, r1.x) + 8, Math.max(r0.z, r1.z) + 8);
    }
    L._aq = []; L._as = 0;
    L.corridorNear = function (x, z, extra) {
      var list = this.airGrid.queryPoint(x, z, extra + 14, this._aq, ++this._as);
      for (var k = 0; k < list.length; k++) {
        var c = list[k];
        var dx = c.bx - c.ax, dz = c.bz - c.az;
        var len2 = dx * dx + dz * dz;
        if (len2 < 1e-6) continue;
        var t = M.clamp(((x - c.ax) * dx + (z - c.az) * dz) / len2, 0, 1);
        var px = c.ax + dx * t, pz = c.az + dz * t;
        var lim = c.r + extra;
        if (M.dist2(px, pz, x, z) < lim * lim) return true;
      }
      return false;
    };

    L.edgeGrid = new SB.Grid(60);
    for (i = 0; i < L.edges.length; i++) {
      var ee2 = L.edges[i];
      var na = L.nodes[ee2.a], nb = L.nodes[ee2.b];
      L.edgeGrid.insert(ee2,
        Math.min(na.x, nb.x), Math.min(na.z, nb.z),
        Math.max(na.x, nb.x), Math.max(na.z, nb.z));
    }

    return L;
  }

  function pickBlock(L, x, z, kindWanted) {
    var best = null, bd = 1e18;
    for (var i = 0; i < L.blocks.length; i++) {
      var b = L.blocks[i];
      if (kindWanted && b.kind !== kindWanted) continue;
      if (b.area < 2000) continue;
      var d = M.dist2(b.cx, b.cz, x, z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  function districtFor(x, z) {
    if (x < BEACH_X + 190) return DIST.BEACH;
    var r = Math.sqrt(x * x + z * z);
    // hills sit high and to the north-east
    if (terrainAt(x, z) > 12) return DIST.HILLS;
    if (z > 520 && x > -340 && x < 460) return DIST.INDUSTRIAL;
    if (r < 300) return DIST.DOWNTOWN;
    if (r < 560) return DIST.MIDTOWN;
    if (r < 850) return DIST.RESIDENTIAL;
    return DIST.SUBURB;
  }

  // ============================================================ Roads =====
  var Roads = SB.Roads = {};
  Roads.build = build;
  Roads.DIST = DIST;
  Roads.STREET_W = STREET_W;
  Roads.AVENUE_W = AVENUE_W;
  Roads.FREEWAY_W = FREEWAY_W;
  Roads.districtFor = districtFor;
  Roads.terrainAt = terrainAt;
  Roads.HILLS = HILLS;

  Roads.halfWidth = function (e) { return e.width / 2; };

  Roads.laneOffset = function (e, dir, lane) {
    var base = e.lanes === 2 ? [3.6, 9.6] : [3.9];
    var o = base[Math.min(lane, base.length - 1)];
    return o * dir;
  };

  // World position of a point along a lane. Works for any edge heading: the
  // lane sits to the right of the centreline, where right is the travel
  // direction rotated a quarter turn.
  Roads.lanePoint = function (L, e, dir, lane, t, out) {
    var a = L.nodes[e.a], b = L.nodes[e.b];
    var from = dir > 0 ? a : b, to = dir > 0 ? b : a;
    var dx = to.x - from.x, dz = to.z - from.z;
    var len = Math.hypot(dx, dz) || 1;
    var ux = dx / len, uz = dz / len;
    var off = Roads.laneOffset(e, 1, lane);
    out.x = from.x + ux * len * t + (-uz) * off;
    out.z = from.z + uz * len * t + (ux) * off;
    out.y = M.lerp(from.y, to.y, t);
    return out;
  };

  Roads.laneDir = function (L, e, dir, out) {
    var a = L.nodes[e.a], b = L.nodes[e.b];
    var from = dir > 0 ? a : b, to = dir > 0 ? b : a;
    var dx = to.x - from.x, dz = to.z - from.z;
    var len = Math.hypot(dx, dz) || 1;
    out.x = dx / len; out.z = dz / len;
    return out;
  };

  Roads.otherNode = function (e, nodeId) { return e.a === nodeId ? e.b : e.a; };

  Roads.nearestNode = function (L, x, z) {
    var bi = 0, bd = 1e18;
    for (var i = 0; i < L.nodes.length; i++) {
      var n = L.nodes[i];
      var d = M.dist2(n.x, n.z, x, z);
      if (d < bd) { bd = d; bi = i; }
    }
    return L.nodes[bi];
  };

  // Distance from a point to the nearest road centreline, used to decide
  // whether something is standing in the carriageway.
  Roads.onRoad = function (L, x, z) {
    var list = L.edgeGrid.queryPoint(x, z, 26, L._q || (L._q = []), (L._stamp = (L._stamp || 0) + 1));
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var a = L.nodes[e.a], b = L.nodes[e.b];
      var dx = b.x - a.x, dz = b.z - a.z;
      var len2 = dx * dx + dz * dz;
      if (len2 < 1e-6) continue;
      var t = M.clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
      var px = a.x + dx * t, pz = a.z + dz * t;
      if (M.dist2(px, pz, x, z) <= (e.width * 0.5) * (e.width * 0.5)) return true;
    }
    return false;
  };

  Roads.randomLanePoint = function (L, rng, px, pz, minDist, maxDist, out) {
    for (var tries = 0; tries < 80; tries++) {
      var e = L.edges[rng.int(0, L.edges.length - 1)];
      var dir = rng.chance(0.5) ? 1 : -1;
      var lane = rng.int(0, e.lanes - 1);
      Roads.lanePoint(L, e, dir, lane, rng.range(0.15, 0.85), out);
      if (px === undefined) return { edge: e, dir: dir, lane: lane, x: out.x, z: out.z, y: out.y };
      var d = M.dist(out.x, out.z, px, pz);
      if (d >= minDist && (!maxDist || d <= maxDist)) {
        return { edge: e, dir: dir, lane: lane, x: out.x, z: out.z, y: out.y };
      }
    }
    return { edge: L.edges[0], dir: 1, lane: 0, x: out.x, z: out.z, y: out.y };
  };

  // ------------------------------------------------------------ routing ----
  // Routing used to be a hop-count breadth-first search. Hop count is the
  // wrong metric on this graph: a freeway edge can be four hundred metres of
  // one hop while a downtown block is twelve metres of one hop, so the search
  // reliably chose the freeway ring for a walk across the street. Everything
  // now costs travel *time*, which is what a driver actually minimises.
  var ROUTE_SPEED = { freeway: 27, ramp: 14, avenue: 17, street: 12, foot: 11 };
  Roads.ROUTE_SPEED = ROUTE_SPEED;

  // Junctions are not free: a signal or a give-way costs a few seconds, and
  // charging for them is what stops the router from threading twenty side
  // streets to save one block of avenue.
  var JUNCTION_COST = 2.4;
  // Getting on and off the freeway costs more than the ramp geometry says.
  var RAMP_COST = 6.0;

  Roads.edgeCost = function (e) {
    var speed = e.kind === 'freeway' ? ROUTE_SPEED.freeway
      : e.kind === 'ramp' ? ROUTE_SPEED.ramp
        : (e.lanes > 1 ? ROUTE_SPEED.avenue : ROUTE_SPEED.street);
    var cost = e.len / speed + JUNCTION_COST;
    if (e.kind === 'ramp') cost += RAMP_COST;
    return cost;
  };

  // Binary min-heap over node ids keyed by a cost array. A plain array scan
  // was fine for a few hundred nodes; this graph has thousands.
  function Heap(cost) {
    this.cost = cost;
    this.items = [];
  }
  Heap.prototype.push = function (id) {
    var a = this.items, c = this.cost;
    a.push(id);
    var i = a.length - 1;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (c[a[p]] <= c[a[i]]) break;
      var t = a[p]; a[p] = a[i]; a[i] = t;
      i = p;
    }
  };
  Heap.prototype.pop = function () {
    var a = this.items, c = this.cost;
    var top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      var i = 0, n = a.length;
      for (;;) {
        var l = i * 2 + 1, r = l + 1, s = i;
        if (l < n && c[a[l]] < c[a[s]]) s = l;
        if (r < n && c[a[r]] < c[a[s]]) s = r;
        if (s === i) break;
        var t = a[s]; a[s] = a[i]; a[i] = t;
        i = s;
      }
    }
    return top;
  };

  // A single Dijkstra from the destination gives every node in the city its
  // next hop toward that destination at once. One pursuit target serves every
  // patrol car chasing it, and the HUD walks the same field instead of
  // re-searching the graph once per waypoint - which is what it used to do.
  var FIELD_CACHE = 6;

  Roads.routeField = function (L, targetNode) {
    if (!L._fields) L._fields = [];
    var fields = L._fields, i;
    for (i = 0; i < fields.length; i++) {
      if (fields[i].target === targetNode) {
        // Most-recently-used first, so the cache keeps the live targets.
        if (i) { var hit = fields.splice(i, 1)[0]; fields.unshift(hit); }
        return fields[0];
      }
    }

    var n = L.nodes.length;
    var f = fields.length >= FIELD_CACHE ? fields.pop() : null;
    if (!f || f.next.length !== n) {
      f = { target: -1, next: new Int32Array(n), cost: new Float64Array(n), done: new Uint8Array(n) };
    }
    var next = f.next, cost = f.cost, done = f.done;
    for (i = 0; i < n; i++) { next[i] = -1; cost[i] = Infinity; done[i] = 0; }

    var heap = new Heap(cost);
    cost[targetNode] = 0;
    next[targetNode] = targetNode;
    heap.push(targetNode);
    while (heap.items.length) {
      var cur = heap.pop();
      if (done[cur]) continue;
      done[cur] = 1;
      var node = L.nodes[cur], base = cost[cur];
      for (var k = 0; k < node.edges.length; k++) {
        var e = L.edges[node.edges[k]];
        var nb = e.a === cur ? e.b : e.a;
        if (done[nb]) continue;
        var c = base + Roads.edgeCost(e);
        if (c < cost[nb]) {
          cost[nb] = c;
          next[nb] = cur;
          heap.push(nb);
        }
      }
    }
    f.target = targetNode;
    fields.unshift(f);
    return f;
  };

  // Next node to drive to on the way to `targetNode`, or the target itself if
  // the graph does not connect them.
  Roads.routeStep = function (L, fromNode, targetNode) {
    if (fromNode === targetNode) return targetNode;
    var f = Roads.routeField(L, targetNode);
    var nx = f.next[fromNode];
    return nx < 0 ? targetNode : nx;
  };

  // Whole route as node ids, `fromNode` first and `targetNode` last. Walking
  // the cached field is O(route length) rather than a search per hop.
  Roads.findPath = function (L, fromNode, targetNode) {
    var out = [fromNode];
    if (fromNode === targetNode) return out;
    var f = Roads.routeField(L, targetNode);
    if (f.next[fromNode] < 0) return null;
    var cur = fromNode, guard = L.nodes.length + 2;
    while (cur !== targetNode && guard-- > 0) {
      var nx = f.next[cur];
      if (nx < 0 || nx === cur) return null;
      out.push(nx);
      cur = nx;
    }
    return cur === targetNode ? out : null;
  };

  // Estimated seconds of driving from a node to a routed destination.
  Roads.routeCost = function (L, fromNode, targetNode) {
    if (fromNode === targetNode) return 0;
    var f = Roads.routeField(L, targetNode);
    var c = f.cost[fromNode];
    return isFinite(c) ? c : Infinity;
  };

  Roads.lightGreen = function (light, axis) {
    if (!light) return true;
    return axis === 'x' ? light.phase === 0 : light.phase === 1;
  };

  Roads.updateLights = function (L, time) {
    for (var i = 0; i < L.lights.length; i++) {
      var lg = L.lights[i];
      var t = ((time + lg.offset) % lg.period) / lg.period;
      var was = lg.phase;
      lg.phase = t < lg.greenX ? 0 : 1;
      var toFlip = lg.phase === 0 ? (lg.greenX - t) * lg.period : (1 - t) * lg.period;
      lg.amber = toFlip < 2.2;
      if (was !== lg.phase) lg.timer = 0;
    }
  };

  // Pedestrian walking loop: the block's own polygon, pulled in off the kerb.
  Roads.sidewalkLoop = function (b, inset) {
    inset = inset === undefined ? 2.0 : inset;
    var poly = (b.lot && b.lot.poly) || b.kerbPoly || b.poly;
    var out = polyInset(poly, -inset);
    if (out) return out;
    return poly.map(function (p) { return { x: p.x, z: p.z }; });
  };

})(window.SB = window.SB || {});
