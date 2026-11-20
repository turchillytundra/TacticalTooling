/* TacticalTooling — geometry: footprints, bases, offsets, distances, line of sight, visibility polygons. */
(function (TT) {
  'use strict';
  var G = TT.geo = {};
  var EPS = 1e-9;

  G.mm = function (mm) { return mm / TT.MM_PER_INCH; };
  G.rad = function (deg) { return deg * Math.PI / 180; };
  G.dist = function (a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); };

  function rotPt(p, c, s) { return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; }

  // ---- Terrain footprints -------------------------------------------------
  G.footprintLocal = function (type) {
    var f = TT.FOOTPRINTS[type]; var w = f.w / 2, h = f.h / 2;
    // Event Companion 8" × 11.5" polygon: full 11.5" edge and 8" edge at right angles, a 2" short edge,
    // and a diagonal from the top of the 2" edge to the far end of the 11.5" edge. Two of these tile an 11.5" × 10" area.
    if (f.shape === 'tri') return [[-w, h - 2], [w, -h], [w, h], [-w, h]];
    return [[-w, -h], [w, -h], [w, h], [-w, h]];
  };
  G.terrainPolygon = function (t) {
    var pts = G.footprintLocal(t.type);
    var a = G.rad(t.rot || 0), c = Math.cos(a), s = Math.sin(a);
    return pts.map(function (p) {
      var q = t.mirror ? [-p[0], p[1]] : p;
      q = rotPt(q, c, s);
      return [q[0] + t.x, q[1] + t.y];
    });
  };
  G.bbox = function (pts) {
    var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    pts.forEach(function (p) {
      if (p[0] < b.minX) b.minX = p[0]; if (p[0] > b.maxX) b.maxX = p[0];
      if (p[1] < b.minY) b.minY = p[1]; if (p[1] > b.maxY) b.maxY = p[1];
    });
    return b;
  };
  G.centroid = function (pts) {
    var x = 0, y = 0; pts.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / pts.length, y / pts.length];
  };

  // ---- Model bases --------------------------------------------------------
  // unit.base = { kind: 'round'|'oval'|'rect', w: mm, h: mm }; model = { x, y, rot }
  G.baseRadius = function (base) { return G.mm(base.w) / 2; };
  G.isRound = function (base) { return base.kind === 'round' || (base.kind === 'oval' && base.w === base.h); };

  // Outline of a base grown by `off` inches (exact offset curve), as a polygon.
  G.basePolygon = function (model, base, off, n) {
    off = off || 0; n = n || 48;
    var pts = [], i, t;
    if (G.isRound(base)) {
      var r = G.mm(base.w) / 2 + off;
      for (i = 0; i < n; i++) { t = 2 * Math.PI * i / n; pts.push([model.x + r * Math.cos(t), model.y + r * Math.sin(t)]); }
      return pts;
    }
    var a = G.rad(model.rot || 0), c = Math.cos(a), s = Math.sin(a);
    var A = G.mm(base.w) / 2, B = G.mm(base.h || base.w) / 2;
    if (base.kind === 'oval') {
      for (i = 0; i < n; i++) {
        t = 2 * Math.PI * i / n;
        var px = A * Math.cos(t), py = B * Math.sin(t);
        var nx = B * Math.cos(t), ny = A * Math.sin(t), nl = Math.hypot(nx, ny) || 1;
        var q = rotPt([px + off * nx / nl, py + off * ny / nl], c, s);
        pts.push([model.x + q[0], model.y + q[1]]);
      }
      return pts;
    }
    // rect hull: rounded rectangle offset
    var corners = [[A, B, 0], [-A, B, Math.PI / 2], [-A, -B, Math.PI], [A, -B, 1.5 * Math.PI]];
    if (off <= 0) {
      corners.forEach(function (k) { var q = rotPt([k[0], k[1]], c, s); pts.push([model.x + q[0], model.y + q[1]]); });
      return pts;
    }
    var seg = Math.max(3, Math.round(n / 4));
    corners.forEach(function (k) {
      for (var j = 0; j <= seg; j++) {
        var ang = k[2] + (Math.PI / 2) * j / seg;
        var q = rotPt([k[0] + off * Math.cos(ang), k[1] + off * Math.sin(ang)], c, s);
        pts.push([model.x + q[0], model.y + q[1]]);
      }
    });
    return pts;
  };

  // Sample points on a model's base (centre + rim) for line-of-sight checks.
  G.baseSamples = function (model, base) {
    var rim = G.basePolygon(model, base, -0.02, 12);
    rim.unshift([model.x, model.y]);
    return rim;
  };

  // ---- Distances ----------------------------------------------------------
  function segPointDist(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    var t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  G.segPointDist = segPointDist;
  G.polyDist = function (P, Q) {
    if (G.polysOverlap(P, Q)) return 0;
    var best = Infinity, i, j;
    for (i = 0; i < P.length; i++) for (j = 0; j < Q.length; j++) {
      best = Math.min(best, segPointDist(P[i], Q[j], Q[(j + 1) % Q.length]), segPointDist(Q[j], P[i], P[(i + 1) % P.length]));
    }
    return best;
  };
  G.polysOverlap = function (P, Q) {
    return G.pointInPoly(P[0], Q) || G.pointInPoly(Q[0], P);
  };
  // Edge-to-edge distance between two model bases (inches).
  G.baseDist = function (m1, b1, m2, b2) {
    if (G.isRound(b1) && G.isRound(b2)) {
      return Math.max(0, Math.hypot(m1.x - m2.x, m1.y - m2.y) - G.mm(b1.w) / 2 - G.mm(b2.w) / 2);
    }
    return G.polyDist(G.basePolygon(m1, b1, 0, 32), G.basePolygon(m2, b2, 0, 32));
  };
  // Closest edge distance between two units, plus the pair of models.
  G.unitDist = function (u1, u2) {
    var best = { d: Infinity, a: null, b: null };
    u1.models.forEach(function (m1) {
      u2.models.forEach(function (m2) {
        var d = G.baseDist(m1, u1.base, m2, u2.base);
        if (d < best.d) best = { d: d, a: m1, b: m2 };
      });
    });
    return best;
  };
  // Distance from a point to the edge of a model base.
  G.pointBaseDist = function (p, m, b) {
    if (G.isRound(b)) return Math.max(0, Math.hypot(p[0] - m.x, p[1] - m.y) - G.mm(b.w) / 2);
    var poly = G.basePolygon(m, b, 0, 32);
    if (G.pointInPoly(p, poly)) return 0;
    var best = Infinity;
    for (var i = 0; i < poly.length; i++) best = Math.min(best, segPointDist(p, poly[i], poly[(i + 1) % poly.length]));
    return best;
  };

  // ---- Polygon tests ------------------------------------------------------
  G.pointInPoly = function (p, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };
  G.polyArea = function (poly) {
    // Shoelace formula: positive when the vertices run anticlockwise in maths (y-up) orientation
    var a = 0; for (var i = 0; i < poly.length; i++) { var p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
    return a / 2;
  };
  // Cyrus–Beck clip of P0 + t(P1-P0) against a convex polygon. Returns [tIn, tOut] or null.
  G.clipConvex = function (p0, p1, poly, tMin, tMax) {
    var tE = tMin, tL = tMax;
    var ccw = G.polyArea(poly) > 0;
    var d = [p1[0] - p0[0], p1[1] - p0[1]];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      var ex = b[0] - a[0], ey = b[1] - a[1];
      // inward normal
      var nx = ccw ? -ey : ey, ny = ccw ? ex : -ex;
      var num = nx * (p0[0] - a[0]) + ny * (p0[1] - a[1]);
      var den = nx * d[0] + ny * d[1];
      if (Math.abs(den) < EPS) { if (num < 0) return null; continue; }
      var t = -num / den;
      if (den > 0) { if (t > tE) tE = t; } else { if (t < tL) tL = t; }
      if (tE > tL) return null;
    }
    return [tE, tL];
  };

  // 11th edition Obscuring (13.10): if every line of sight between two models crosses an obscuring terrain
  // area — excluding areas either model is within — they are not visible. Callers pass only the polygons
  // of areas that neither model is within, so here any crossing blocks.
  G.segmentBlocked = function (a, b, obstacles) {
    for (var i = 0; i < obstacles.length; i++) {
      var r = G.clipConvex(a, b, obstacles[i], 0, 1);
      if (r && r[1] - r[0] > 1e-6) return true;
    }
    return false;
  };

  // Can any part of shooter model base see any part of target model base?
  G.modelsSee = function (m1, b1, m2, b2, obstacles) {
    var s1 = G.baseSamples(m1, b1), s2 = G.baseSamples(m2, b2);
    for (var i = 0; i < s1.length; i++) for (var j = 0; j < s2.length; j++) {
      if (!G.segmentBlocked(s1[i], s2[j], obstacles)) return [s1[i], s2[j]];
    }
    return null;
  };

  // Visibility polygon from point O inside board W×H, with convex obscuring obstacles.
  // A ray stops at the far (exit) side of the first obscuring area it passes into.
  G.visibilityPolygon = function (O, obstacles, W, H) {
    var obs = obstacles.filter(function (p) { return !G.pointInPoly(O, p); });
    var angles = [];
    var pushA = function (p) {
      var a = Math.atan2(p[1] - O[1], p[0] - O[0]);
      angles.push(a - 1e-5, a, a + 1e-5);
    };
    obs.forEach(function (p) { p.forEach(pushA); });
    [[0, 0], [W, 0], [W, H], [0, H]].forEach(pushA);
    for (var k = 0; k < 90; k++) angles.push(-Math.PI + 2 * Math.PI * k / 90);
    angles.sort(function (x, y) { return x - y; });
    var R = W + H;
    var out = [];
    angles.forEach(function (a) {
      var far = [O[0] + R * Math.cos(a), O[1] + R * Math.sin(a)];
      // clip to board
      var board = [[0, 0], [W, 0], [W, H], [0, H]];
      var bc = G.clipConvex(O, far, board, 0, 1);
      var tMax = bc ? bc[1] : 0;
      var bestIn = Infinity, bestOut = tMax;
      for (var i = 0; i < obs.length; i++) {
        var r = G.clipConvex(O, far, obs[i], 0, tMax);
        if (r && r[1] - r[0] > 1e-9 && r[0] < bestIn) { bestIn = r[0]; bestOut = r[1]; }
      }
      var t = bestIn === Infinity ? tMax : bestOut;
      out.push([O[0] + (far[0] - O[0]) * t, O[1] + (far[1] - O[1]) * t]);
    });
    return out;
  };

  // ---- Unit helpers -------------------------------------------------------
  G.unitCentre = function (u) {
    if (!u.models.length) return [0, 0];
    return G.centroid(u.models.map(function (m) { return [m.x, m.y]; }));
  };
  // Is every model base wholly within a terrain area polygon?
  G.unitWhollyWithin = function (u, poly) {
    return u.models.every(function (m) {
      return G.basePolygon(m, u.base, 0, 16).every(function (p) { return G.pointInPoly(p, poly); });
    });
  };
  G.unitTouches = function (u, poly) {
    return u.models.some(function (m) {
      var bp = G.basePolygon(m, u.base, 0, 16);
      return bp.some(function (p) { return G.pointInPoly(p, poly); }) || poly.some(function (p) { return G.pointInPoly(p, bp); });
    });
  };

  // Formation: lay out n models in rows, spacing = gap between bases (inches).
  G.formation = function (n, base, cx, cy, perRow, gap, rotDeg) {
    perRow = Math.max(1, perRow || 5); gap = gap == null ? 0.5 : gap;
    var w = G.mm(base.w), h = G.mm(base.kind === 'round' ? base.w : (base.h || base.w));
    var rows = Math.ceil(n / perRow), out = [];
    var a = G.rad(rotDeg || 0), c = Math.cos(a), s = Math.sin(a);
    for (var i = 0; i < n; i++) {
      var r = Math.floor(i / perRow), col = i % perRow;
      var inRow = Math.min(perRow, n - r * perRow);
      var lx = (col - (inRow - 1) / 2) * (w + gap) + (r % 2 ? (w + gap) / 4 : 0);
      var ly = (r - (rows - 1) / 2) * (h + gap * 0.6);
      var q = rotPt([lx, ly], c, s);
      out.push({ x: cx + q[0], y: cy + q[1], rot: rotDeg || 0 });
    }
    return out;
  };

  // ---- Dice ---------------------------------------------------------------
  var TWO_D6 = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
  // Probability that 2D6 >= need (need is a real distance in inches).
  G.p2d6AtLeast = function (need) {
    if (need <= 2) return 1;
    var n = Math.ceil(need - 1e-9); if (n > 12) return 0;
    var s = 0; for (var k = n; k <= 12; k++) s += TWO_D6[k];
    return s / 36;
  };

  G.parseInches = function (v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    var m = String(v).match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  };

})(window.TT = window.TT || {});
