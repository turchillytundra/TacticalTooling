/* TacticalTooling — main application: state, rendering, interaction, analysis, panels. */
(function (TT) {
  'use strict';
  var G = TT.geo;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var uid = function () { return Math.random().toString(36).slice(2, 9); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); };
  var fmt = function (v, d) { return (Math.round(v * Math.pow(10, d == null ? 1 : d)) / Math.pow(10, d == null ? 1 : d)).toString(); };
  var pct = function (p) { return Math.round(p * 100) + '%'; };

  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };

  // ---------------------------------------------------------------- state
  function defaultState() {
    return {
      v: 2,
      board: { w: 44, h: 60 },
      layout: { id: 'blank', name: 'Blank battlefield' },
      terrain: [], zones: [], objectives: [], features: [], units: [],
      players: { A: { name: 'Attacker', color: '#c8372d' }, B: { name: 'Defender', color: '#2f6fb7' } },
      rules: clone(TT.DEFAULT_RULES),
      view: {
        labels: true, grid: true, features: true, zones: true, areaLabels: false, snap: true, lockLayout: true,
        threat: { move: false, advance: false, shoot: true, charge: true, engage: false },
        threatScope: 'selected', threatBasis: 'move', stack: false,
        los: true, vis: false, visClip: false, cover: true, overlay: 'lanes', laneBasis: 'now'
      }
    };
  }
  var S = LS.get('tt.state', null);
  if (!S || S.v !== 2) S = defaultState();
  S.view = Object.assign(defaultState().view, S.view || {});
  S.rules = Object.assign(clone(TT.DEFAULT_RULES), S.rules || {});
  var APP_VERSION = '2026.11.20-4';
  // On first run of a new version, re-lock the layout so terrain and zones can't be dragged by accident
  if (S.appv !== APP_VERSION) { S.view.lockLayout = true; S.appv = APP_VERSION; }
  var BASELIB = LS.get('tt.baseLib', {});
  var MYLAYOUTS = LS.get('tt.layouts', []);

  var UI = {
    sel: null, tool: 'select', modelMode: false,
    cam: { x: 20, y: 20, k: 10 },
    measure: null, drag: null, pointers: {}, pinch: null,
    tab: 'sel', cache: {}, dirty: true
  };

  var undo = [], redo = [], lastSnap = JSON.stringify(S);
  function commit() {
    var s = JSON.stringify(S);
    if (s === lastSnap) return;
    undo.push(lastSnap); if (undo.length > 80) undo.shift();
    redo = []; lastSnap = s;
    LS.set('tt.state', S);
    UI.cache = {};
  }
  function restore(snap) { S = JSON.parse(snap); lastSnap = snap; LS.set('tt.state', S); UI.cache = {}; if (UI.sel && !findSel()) UI.sel = null; renderAll(); }
  function doUndo() { if (!undo.length) return; redo.push(lastSnap); restore(undo.pop()); toast('Undone'); }
  function doRedo() { if (!redo.length) return; undo.push(lastSnap); restore(redo.pop()); toast('Redone'); }

  // ---------------------------------------------------------------- lookups
  function unitById(id) { return S.units.find(function (u) { return u.id === id; }); }
  function terrById(id) { return S.terrain.find(function (t) { return t.id === id; }); }
  function objById(id) { return S.objectives.find(function (o) { return o.id === id; }); }
  function zoneById(id) { return S.zones.find(function (z) { return z.id === id; }); }
  function findSel() {
    if (!UI.sel) return null;
    var k = UI.sel.kind, id = UI.sel.id;
    return k === 'unit' ? unitById(id) : k === 'terrain' ? terrById(id) : k === 'obj' ? objById(id) : k === 'zone' ? zoneById(id) : null;
  }
  function selUnit() { return UI.sel && UI.sel.kind === 'unit' ? unitById(UI.sel.id) : null; }
  function enemyOf(p) { return p === 'A' ? 'B' : 'A'; }
  function onBoard(u) {
    var c = G.unitCentre(u); return c[0] >= 0 && c[1] >= 0 && c[0] <= S.board.w && c[1] <= S.board.h;
  }

  // Terrain areas (footprints sharing an area id form one terrain area)
  function areas() {
    if (UI.cache.areas) return UI.cache.areas;
    var map = {};
    S.terrain.forEach(function (t) {
      var a = map[t.area] || (map[t.area] = { id: t.area, polys: [], items: [], dense: false, obscuring: false });
      a.polys.push(G.terrainPolygon(t)); a.items.push(t);
      if (t.dense) a.dense = true;
      if (t.obscuring !== false) a.obscuring = true;
    });
    UI.cache.areas = map;
    return map;
  }
  function nextAreaId() { var m = 0; S.terrain.forEach(function (t) { m = Math.max(m, t.area || 0); }); return m + 1; }

  // Which areas a model is within (any part of its base inside any footprint of that area)
  function modelAreas(m, base) {
    var A = areas(), out = [];
    var bp = G.basePolygon(m, base, 0, 16);
    Object.keys(A).forEach(function (k) {
      var a = A[k];
      for (var i = 0; i < a.polys.length; i++) {
        var P = a.polys[i];
        if (bp.some(function (p) { return G.pointInPoly(p, P); }) || P.some(function (p) { return G.pointInPoly(p, bp); }) || G.pointInPoly([m.x, m.y], P)) { out.push(a.id); break; }
      }
    });
    return out;
  }
  function modelInfo(u) {
    var key = 'mi_' + u.id;
    if (UI.cache[key]) return UI.cache[key];
    var A = areas();
    var info = u.models.map(function (m) {
      var ma = modelAreas(m, u.base);
      var inDense = ma.some(function (id) { return A[id] && A[id].dense; });
      return { areas: ma, inArea: ma.length > 0, hidden: !!(u.infantry && !u.shot && inDense) };
    });
    UI.cache[key] = info;
    return info;
  }
  function obstaclePolys(exclude) {
    var A = areas(), out = [];
    Object.keys(A).forEach(function (k) {
      var a = A[k];
      if (!a.obscuring) return;
      if (exclude.indexOf(a.id) >= 0) return;
      a.polys.forEach(function (p) { out.push(p); });
    });
    return out;
  }

  // ---------------------------------------------------------------- analysis
  function chargeDist() {
    var r = S.rules; return r.chargeMode === 'avg' ? 7 : r.chargeMode === 'custom' ? +r.chargeCustom : 12;
  }
  function advDist() { var r = S.rules; return r.advanceMode === 'max' ? 6 : r.advanceMode === 'avg' ? 3.5 : 0; }
  function rangedWeapons(u) { return (u.weapons || []).filter(function (w) { return !w.melee && w.range > 0; }); }
  function maxRange(u) { return rangedWeapons(u).reduce(function (m, w) { return Math.max(m, w.range); }, 0); }
  function shootThreat(u) {
    var ws = rangedWeapons(u); if (!ws.length) return 0;
    var basis = S.view.threatBasis === 'move' ? (u.M || 0) : 0;
    return ws.reduce(function (m, w) {
      var extra = (S.view.threatBasis === 'move' && w.assault) ? advDist() : 0;
      return Math.max(m, basis + extra + w.range);
    }, 0);
  }

  // Unit-to-unit visibility per 11th edition rules (top-down approximation)
  function visibility(su, tu) {
    var key = 'vis_' + su.id + '_' + tu.id;
    if (UI.cache[key]) return UI.cache[key];
    var si = modelInfo(su), ti = modelInfo(tu);
    var det = +S.rules.hiddenDetection;
    var visibleTargets = 0, line = null, fully = true, seers = 0;
    var seer = su.models.map(function () { return false; });
    tu.models.forEach(function (tm, j) {
      var seen = false, allSamplesSeen = true;
      for (var i = 0; i < su.models.length; i++) {
        var sm = su.models[i];
        if (ti[j].hidden && G.baseDist(sm, su.base, tm, tu.base) > det) continue;
        var obs = obstaclePolys(si[i].areas.concat(ti[j].areas));
        var l = G.modelsSee(sm, su.base, tm, tu.base, obs);
        if (l) {
          seen = true; seer[i] = true;
          if (!line) line = l;
          if (allSamplesSeen) {
            var a = [sm.x, sm.y];
            allSamplesSeen = G.baseSamples(tm, tu.base).every(function (p) { return !G.segmentBlocked(a, p, obs); });
          }
        }
      }
      if (seen) visibleTargets++;
      if (!seen || !allSamplesSeen) fully = false;
    });
    seer.forEach(function (b) { if (b) seers++; });
    var res = { visible: visibleTargets, total: tu.models.length, line: line, fully: fully && visibleTargets === tu.models.length, seers: seers };
    UI.cache[key] = res;
    return res;
  }
  function hasCover(su, tu) {
    var ti = modelInfo(tu), v = visibility(su, tu);
    var inf = !!tu.infantry;
    var allIn = ti.every(function (x) { return x.inArea; });
    return (inf && allIn) || (v.visible > 0 && !v.fully);
  }
  function analyse(u) {
    var foes = S.units.filter(function (x) { return x.player !== u.player && onBoard(x); });
    var M = u.M || 0;
    return foes.map(function (f) {
      var d = G.unitDist(u, f).d;
      var vis = visibility(u, f);
      var weapons = rangedWeapons(u).map(function (w) {
        return { name: w.name, range: w.range, inRange: d <= w.range, ok: d <= w.range && vis.visible > 0 };
      });
      var chargeNow = d <= S.rules.maxChargeTargetDistance ? G.p2d6AtLeast(d) : 0;
      var needNext = Math.max(d - M, S.rules.engagementRange);
      var chargeNext = (d - M) <= S.rules.maxChargeTargetDistance ? G.p2d6AtLeast(needNext) : 0;
      // threats from this enemy to u
      var back = visibility(f, u);
      var fM = f.M || 0, fR = maxRange(f);
      var fAssault = rangedWeapons(f).some(function (w) { return w.assault && w.range >= fR; });
      var canShootNow = fR > 0 && d <= fR && back.visible > 0;
      var canShootNext = fR > 0 && d <= fM + fR + (fAssault ? advDist() : 0);
      var theyChargeNext = (d - fM) <= S.rules.maxChargeTargetDistance ? G.p2d6AtLeast(Math.max(d - fM, S.rules.engagementRange)) : 0;
      return {
        unit: f, d: d, vis: vis, weapons: weapons, chargeNow: chargeNow, chargeNext: chargeNext,
        cover: vis.visible ? hasCover(u, f) : false,
        back: back, canShootNow: canShootNow, canShootNext: canShootNext, theyChargeNext: theyChargeNext
      };
    }).sort(function (a, b) { return a.d - b.d; });
  }

  // ---------------------------------------------------------------- base lookup
  function parseBase(s) {
    if (!s) return null;
    var m;
    if ((m = String(s).match(/([\d.]+)\s*x\s*([\d.]+)\s*mm/i))) return { kind: 'oval', w: +m[1], h: +m[2] };
    if ((m = String(s).match(/([\d.]+)\s*mm/i))) return { kind: 'round', w: +m[1] };
    if (/large flying/i.test(s)) return { kind: 'oval', w: 120, h: 92 };
    if (/small flying/i.test(s)) return { kind: 'oval', w: 60, h: 35 };
    if (/hull/i.test(s)) return { kind: 'rect', w: 120, h: 70, hull: true };
    return null;
  }
  var GUIDE_INDEX = null;
  function guideIndex() {
    if (GUIDE_INDEX) return GUIDE_INDEX;
    GUIDE_INDEX = [];
    Object.keys(TT.BASE_GUIDE || {}).forEach(function (fac) {
      TT.BASE_GUIDE[fac].forEach(function (r) { GUIDE_INDEX.push({ faction: fac, name: r[0], key: norm(r[0]), size: r[1] }); });
    });
    return GUIDE_INDEX;
  }
  function norm(s) { return String(s).toLowerCase().replace(/\[.*?\]/g, '').replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function lookupBase(name) {
    var k = norm(name);
    if (BASELIB[k]) return { base: BASELIB[k], source: 'your library' };
    var idx = guideIndex();
    var hit = idx.find(function (r) { return r.key === k; }) ||
      idx.find(function (r) { return r.key.split(':')[0].trim() === k; }) ||
      idx.find(function (r) { return r.key.indexOf(k + ' ') === 0 || r.key.indexOf(k + ':') === 0; }) ||
      idx.find(function (r) { return k.length > 5 && r.key.indexOf(k) >= 0; }) ||
      idx.find(function (r) { return r.key.split(' ').length >= 2 && (' ' + k + ' ').indexOf(' ' + r.key + ' ') >= 0; });
    if (hit) { var b = parseBase(hit.size); if (b) return { base: b, source: 'Base Size Guide: ' + hit.name + ' — ' + hit.size }; }
    return null;
  }

  // ---------------------------------------------------------------- camera
  var svg, world, stage;
  function screenToWorld(px, py) {
    var r = svg.getBoundingClientRect();
    return [(px - r.left - UI.cam.x) / UI.cam.k, (py - r.top - UI.cam.y) / UI.cam.k];
  }
  function fit() {
    var r = svg.getBoundingClientRect();
    var pad = 24, W = S.board.w, H = S.board.h;
    var k = Math.min((r.width - pad * 2) / W, (r.height - pad * 2) / H);
    UI.cam.k = Math.max(2, k);
    UI.cam.x = (r.width - W * UI.cam.k) / 2;
    UI.cam.y = (r.height - H * UI.cam.k) / 2;
    applyCam(); render();
  }
  function zoomAt(px, py, f) {
    var r = svg.getBoundingClientRect();
    var sx = px - r.left, sy = py - r.top;
    var nk = Math.min(200, Math.max(2, UI.cam.k * f));
    UI.cam.x = sx - (sx - UI.cam.x) * nk / UI.cam.k;
    UI.cam.y = sy - (sy - UI.cam.y) * nk / UI.cam.k;
    UI.cam.k = nk;
    applyCam(); render();
  }
  function applyCam() { world.setAttribute('transform', 'translate(' + UI.cam.x + ',' + UI.cam.y + ') scale(' + UI.cam.k + ')'); }

  // ---------------------------------------------------------------- rendering
  function ptsAttr(pts) { return pts.map(function (p) { return fmt(p[0], 3) + ',' + fmt(p[1], 3); }).join(' '); }
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var t = f < 0 ? 0 : 255, p = Math.abs(f);
    return 'rgb(' + Math.round((t - r) * p + r) + ',' + Math.round((t - g) * p + g) + ',' + Math.round((t - b) * p + b) + ')';
  }
  function baseShape(m, u, off, attrs) {
    if (G.isRound(u.base)) return '<circle cx="' + fmt(m.x, 3) + '" cy="' + fmt(m.y, 3) + '" r="' + fmt(G.mm(u.base.w) / 2 + (off || 0), 3) + '" ' + attrs + '/>';
    return '<polygon points="' + ptsAttr(G.basePolygon(m, u.base, off || 0, 40)) + '" ' + attrs + '/>';
  }

  var rafPending = false;
  function render() {
    if (rafPending) return; rafPending = true;
    requestAnimationFrame(function () { rafPending = false; draw(); });
  }
  function draw() {
    var W = S.board.w, H = S.board.h, k = UI.cam.k, px = 1 / k;
    document.documentElement.style.setProperty('--pa', S.players.A.color);
    document.documentElement.style.setProperty('--pb', S.players.B.color);
    var out = [];
    // board
    out.push('<rect x="-200" y="-200" width="' + (W + 400) + '" height="' + (H + 400) + '" fill="transparent" data-k="bg"/>');
    out.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#d8d3c4" stroke="#222" stroke-width="' + 2 * px + '" data-k="bg"/>');
    if (S.view.zones) S.zones.forEach(function (z) {
      var c = S.players[z.player] ? S.players[z.player].color : '#888';
      var sel = UI.sel && UI.sel.kind === 'zone' && UI.sel.id === z.id;
      out.push('<polygon points="' + ptsAttr(z.points) + '" fill="' + c + '" fill-opacity="0.32" stroke="' + c + '" stroke-width="' + (sel ? 3 : 1.5) * px + '" data-k="zone" data-id="' + z.id + '"/>');
    });
    if (S.view.grid) {
      var g = [];
      for (var x = 1; x < W; x++) g.push('<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + H + '" stroke-width="' + (x % 6 ? 0.5 : 1) * px + '" stroke-opacity="' + (x % 6 ? 0.25 : 0.5) + '"/>');
      for (var y = 1; y < H; y++) g.push('<line x1="0" y1="' + y + '" x2="' + W + '" y2="' + y + '" stroke-width="' + (y % 6 ? 0.5 : 1) * px + '" stroke-opacity="' + (y % 6 ? 0.25 : 0.5) + '"/>');
      out.push('<g stroke="#5a5446" pointer-events="none">' + g.join('') + '</g>');
      out.push('<g stroke="#222" stroke-dasharray="' + 4 * px + ' ' + 4 * px + '" stroke-width="' + px + '" pointer-events="none"><line x1="' + W / 2 + '" y1="0" x2="' + W / 2 + '" y2="' + H + '"/><line x1="0" y1="' + H / 2 + '" x2="' + W + '" y2="' + H / 2 + '"/></g>');
    }
    // terrain
    var A = areas();
    var objAreas = {};
    S.objectives.forEach(function (o) { if (o.area != null) objAreas[o.area] = o.kind; });
    S.terrain.forEach(function (t) {
      var sel = UI.sel && UI.sel.kind === 'terrain' && UI.sel.id === t.id;
      var a = A[t.area] || {};
      var fill = a.dense ? '#77736a' : a.obscuring ? '#a8a396' : '#c9c5b7';
      var stroke = objAreas[t.area] ? '#0f8a77' : (sel ? '#fff' : '#3f3b33');
      var sw = (objAreas[t.area] ? 3 : sel ? 2.5 : 1.2) * px;
      out.push('<polygon points="' + ptsAttr(G.terrainPolygon(t)) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '" data-k="terrain" data-id="' + t.id + '"/>');
    });
    if (S.view.areaLabels) Object.keys(A).forEach(function (id) {
      var a = A[id], c = G.centroid([].concat.apply([], a.polys));
      out.push('<text x="' + c[0] + '" y="' + c[1] + '" font-size="' + 11 * px + '" text-anchor="middle" fill="#111" pointer-events="none">#' + id + (a.dense ? ' D' : '') + '</text>');
    });
    // objectives
    S.objectives.forEach(function (o) {
      var sel = UI.sel && UI.sel.kind === 'obj' && UI.sel.id === o.id;
      var col = o.kind === 'home-attacker' ? S.players.A.color : o.kind === 'home-defender' ? S.players.B.color : o.kind === 'expansion' ? '#21917f' : '#0b6e5d';
      var r = 0.8;
      if (o.area == null) out.push('<circle cx="' + o.x + '" cy="' + o.y + '" r="' + (r + (+S.rules.objectiveControl)) + '" fill="none" stroke="' + col + '" stroke-dasharray="' + 4 * px + ' ' + 3 * px + '" stroke-width="' + 1.5 * px + '" pointer-events="none"/>');
      var shape = o.kind === 'expansion'
        ? '<rect x="' + (o.x - r * 0.75) + '" y="' + (o.y - r * 0.75) + '" width="' + r * 1.5 + '" height="' + r * 1.5 + '" transform="rotate(45 ' + o.x + ' ' + o.y + ')"'
        : '<circle cx="' + o.x + '" cy="' + o.y + '" r="' + r + '"';
      out.push('<g data-k="obj" data-id="' + o.id + '">' + shape + ' fill="' + col + '" stroke="' + (sel ? '#fff' : '#111') + '" stroke-width="' + (sel ? 3 : 1.5) * px + '"/>' +
        '<text x="' + o.x + '" y="' + (o.y + 0.32) + '" font-size="0.9" text-anchor="middle" fill="#fff" font-weight="700" pointer-events="none">' + (o.kind === 'central' ? 'C' : o.kind === 'expansion' ? 'E' : 'H') + '</text></g>');
    });
    // visibility shading
    var su = selUnit();
    if (su && S.view.overlay && S.view.overlay !== 'none' && !UI.drag && onBoard(su)) out.push(drawOverlay(su));
    if (su && S.view.vis && !UI.drag) out.push(drawVisibility(su));
    // threat rings
    out.push(drawThreats(su));
    // LOS lines
    if (su && S.view.los && !UI.drag && onBoard(su)) {
      S.units.forEach(function (f) {
        if (f.player === su.player || !onBoard(f)) return;
        var v = visibility(su, f);
        if (v.line) out.push('<line x1="' + v.line[0][0] + '" y1="' + v.line[0][1] + '" x2="' + v.line[1][0] + '" y2="' + v.line[1][1] + '" stroke="#18c964" stroke-width="' + 2 * px + '" pointer-events="none"/>');
      });
    }
    // units
    S.units.forEach(function (u) {
      var c = S.players[u.player].color, sel = su && su.id === u.id;
      var info = S.view.cover ? modelInfo(u) : null;
      var g = '<g data-k="unit" data-id="' + u.id + '">';
      u.models.forEach(function (m, i) {
        var hidden = info && info[i].hidden;
        g += baseShape(m, u, 0, 'fill="' + c + '" fill-opacity="' + (hidden ? 0.55 : 0.95) + '" stroke="' + (sel ? '#fff' : shade(c, -0.55)) + '" stroke-width="' + (sel ? 2.5 : 1) * px + '"' + (hidden ? ' stroke-dasharray="' + 3 * px + ' ' + 2 * px + '"' : '') + ' data-mi="' + i + '"');
        if (u.base.kind !== 'round' && G.mm(u.base.w) * k > 18) {
          var a = G.rad(m.rot || 0), L = G.mm(u.base.w) / 2;
          g += '<line x1="' + m.x + '" y1="' + m.y + '" x2="' + (m.x + Math.cos(a) * L) + '" y2="' + (m.y + Math.sin(a) * L) + '" stroke="#fff" stroke-opacity="0.6" stroke-width="' + px + '" pointer-events="none"/>';
        }
      });
      g += '</g>';
      out.push(g);
    });
    // labels
    if (S.view.labels) S.units.forEach(function (u) {
      if (!u.models.length) return;
      var bb = G.bbox(u.models.map(function (m) { return [m.x, m.y]; }));
      var r = G.mm(u.base.kind === 'round' ? u.base.w : Math.max(u.base.w, u.base.h || 0)) / 2;
      var cx = (bb.minX + bb.maxX) / 2, cy = bb.minY - r - 4 * px;
      var info = modelInfo(u), tags = [];
      if (S.view.cover) {
        if (u.infantry && info.every(function (x) { return x.inArea; })) tags.push('cover');
        if (info.length && info.every(function (x) { return x.hidden; })) tags.push('hidden');
      }
      var label = esc(u.name) + (tags.length ? ' · ' + tags.join(' · ') : '');
      out.push('<text x="' + cx + '" y="' + cy + '" font-size="' + 12 * px + '" text-anchor="middle" class="ulabel" paint-order="stroke" stroke="#000" stroke-width="' + 3 * px + '" fill="#fff" pointer-events="none">' + label + '</text>');
    });
    // zone vertex handles
    if (UI.sel && UI.sel.kind === 'zone' && !S.view.lockLayout) {
      var z = zoneById(UI.sel.id);
      if (z) z.points.forEach(function (p, i) {
        out.push('<rect x="' + (p[0] - 5 * px) + '" y="' + (p[1] - 5 * px) + '" width="' + 10 * px + '" height="' + 10 * px + '" fill="#fff" stroke="#000" stroke-width="' + px + '" data-k="zv" data-id="' + z.id + '" data-vi="' + i + '"/>');
      });
    }
    // measure
    if (UI.measure) {
      var me = UI.measure, a0 = me.a, b0 = me.b;
      var d = measureDist(me);
      out.push('<g pointer-events="none"><line x1="' + a0[0] + '" y1="' + a0[1] + '" x2="' + b0[0] + '" y2="' + b0[1] + '" stroke="#ffeb3b" stroke-width="' + 3 * px + '"/><line x1="' + a0[0] + '" y1="' + a0[1] + '" x2="' + b0[0] + '" y2="' + b0[1] + '" stroke="#000" stroke-width="' + px + '" stroke-dasharray="' + 6 * px + ' ' + 4 * px + '"/>' +
        '<text x="' + (b0[0] + 8 * px) + '" y="' + (b0[1] - 8 * px) + '" font-size="' + 16 * px + '" font-weight="700" paint-order="stroke" stroke="#000" stroke-width="' + 4 * px + '" fill="#ffeb3b">' + fmt(d.d, 2) + '"' + (d.edge ? ' edge' : '') + '</text></g>');
    }
    world.innerHTML = out.join('');
    hud();
  }

  function threatRing(u, dist, fill, cls) {
    if (!(dist > 0)) return '';
    var s = '<g opacity="' + (S.view.stack ? 0.12 : (cls === 'shoot' ? 0.16 : cls === 'charge' ? 0.3 : 0.2)) + '" fill="' + fill + '" pointer-events="none" class="' + cls + '">';
    u.models.forEach(function (m) { s += baseShape(m, u, dist, ''); });
    return s + '</g>';
  }
  // Outline of the union of all models' offset shapes: keep only perimeter edges not inside another model's shape.
  function threatOutline(u, dist, color, dash) {
    if (!(dist > 0)) return '';
    var px = 1 / UI.cam.k, round = G.isRound(u.base), r = G.mm(u.base.w) / 2 + dist;
    var shapes = u.models.map(function (m) { return G.basePolygon(m, u.base, dist, 96); });
    var inside = function (p, j) {
      var m = u.models[j];
      if (round) return Math.hypot(p[0] - m.x, p[1] - m.y) < r - 1e-6;
      return G.pointInPoly(p, shapes[j]);
    };
    var d = '';
    shapes.forEach(function (poly, i) {
      for (var k = 0; k < poly.length; k++) {
        var a = poly[k], b = poly[(k + 1) % poly.length], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        var hidden = false;
        for (var j = 0; j < shapes.length && !hidden; j++) if (j !== i && inside(mid, j)) hidden = true;
        if (!hidden) d += 'M' + fmt(a[0], 3) + ' ' + fmt(a[1], 3) + 'L' + fmt(b[0], 3) + ' ' + fmt(b[1], 3);
      }
    });
    return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="' + 1.6 * px + '" stroke-opacity="0.9"' + (dash ? ' stroke-dasharray="' + 6 * px + ' ' + 4 * px + '"' : '') + ' pointer-events="none"/>';
  }
  function drawThreats(su) {
    var v = S.view, out = [];
    var list = S.units.filter(function (u) {
      if (!onBoard(u) && !(su && su.id === u.id)) return false;
      if (u.pin) return true;
      if (v.threatScope === 'all') return true;
      if (v.threatScope === 'A' || v.threatScope === 'B') return u.player === v.threatScope;
      return su && su.id === u.id;
    });
    var ovOn = su && v.overlay && v.overlay !== 'none' && onBoard(su);
    list.forEach(function (u) {
      var c = S.players[u.player].color, M = u.M || 0;
      var fills = !(ovOn && su.id === u.id);
      var basis = v.threatBasis === 'move' ? M : 0;
      if (v.threat.shoot) { var sd = shootThreat(u); if (fills) out.push(threatRing(u, sd, c, 'shoot')); if (list.length < 6 || !fills) out.push(threatOutline(u, sd, c, false)); }
      if (v.threat.charge) {
        var cd = basis + Math.min(chargeDist(), S.rules.maxChargeTargetDistance);
        if (fills) out.push(threatRing(u, cd, 'url(#hatch' + u.player + ')', 'charge'));
        if (list.length < 6 || !fills) out.push(threatOutline(u, cd, c, true));
      }
      if (v.threat.advance && M) out.push(threatOutline(u, M + advDist(), '#fff', true));
      if (v.threat.move && M) out.push(threatRing(u, M, '#ffffff', 'move'));
      if (v.threat.engage) out.push(threatRing(u, S.rules.engagementRange, '#000', 'engage'));
    });
    return out.join('');
  }
  function drawVisibility(u) {
    var key = 'vispoly_' + u.id;
    var polys = UI.cache[key];
    if (!polys) {
      var info = modelInfo(u);
      var models = u.models.length > 12 ? u.models.filter(function (m, i) { return i % Math.ceil(u.models.length / 12) === 0; }) : u.models;
      polys = models.map(function (m) {
        var idx = u.models.indexOf(m);
        return G.visibilityPolygon([m.x, m.y], obstaclePolys(info[idx].areas), S.board.w, S.board.h);
      });
      UI.cache[key] = polys;
    }
    var c = S.players[u.player].color;
    var clip = '';
    if (S.view.visClip) {
      var r = maxRange(u);
      if (r > 0) {
        var cp = u.models.map(function (m) { return baseShape(m, u, r, ''); }).join('');
        $('#rangeClip').innerHTML = cp; clip = ' clip-path="url(#rangeClip)"';
      }
    }
    return '<g opacity="0.33" fill="' + c + '" pointer-events="none"' + clip + '>' + polys.map(function (p) { return '<polygon points="' + ptsAttr(p) + '"/>'; }).join('') + '</g>';
  }

  // ---------------------------------------------------------------- tactical overlays
  // Classifies every 0.5" cell of the battlefield, applying 11th edition Obscuring (13.10), Hidden (13.09)
  // and Benefit of Cover (13.08), and paints the result as one image under the units.
  var CELL = 0.5;
  function cellGrid() {
    if (UI.cache.cellGrid) return UI.cache.cellGrid;
    var A = areas(), nx = Math.ceil(S.board.w / CELL), ny = Math.ceil(S.board.h / CELL);
    var areaOf = new Array(nx * ny).fill(null);
    var boxes = [];
    Object.keys(A).forEach(function (k) { A[k].polys.forEach(function (P) { boxes.push({ id: A[k].id, P: P, b: G.bbox(P) }); }); });
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var p = [(i + 0.5) * CELL, (j + 0.5) * CELL];
      for (var q = 0; q < boxes.length; q++) {
        var B = boxes[q];
        if (p[0] < B.b.minX || p[0] > B.b.maxX || p[1] < B.b.minY || p[1] > B.b.maxY) continue;
        if (G.pointInPoly(p, B.P)) { areaOf[j * nx + i] = B.id; break; }
      }
    }
    UI.cache.cellGrid = { nx: nx, ny: ny, areaOf: areaOf };
    return UI.cache.cellGrid;
  }
  function sampleModels(u, n) {
    if (u.models.length <= n) return u.models.map(function (m, i) { return i; });
    var out = [], step = (u.models.length - 1) / (n - 1);
    for (var k = 0; k < n; k++) out.push(Math.round(k * step));
    return out;
  }
  // Obstacle lists per (shooter model areas + target cell area), memoised
  function obsFor(shooterAreas, cellArea, memo) {
    var key = shooterAreas.join(',') + '|' + cellArea;
    if (!memo[key]) memo[key] = obstaclePolys(cellArea != null ? shooterAreas.concat([cellArea]) : shooterAreas);
    return memo[key];
  }
  function pointSeenBy(from, fromAreas, p, cellArea, memo) {
    return !G.segmentBlocked(from, p, obsFor(fromAreas, cellArea, memo));
  }
  var OFFS = [[0.65, 0], [-0.65, 0], [0, 0.65], [0, -0.65]];
  // Firing lanes for unit u: where could it shoot a target, and what would the target get?
  function computeLanes(u) {
    var key = 'lanes_' + u.id + '_' + S.view.laneBasis;
    if (UI.cache[key]) return UI.cache[key];
    var g = cellGrid(), A = areas(), info = modelInfo(u), memo = {};
    var idx = sampleModels(u, 8);
    var range = maxRange(u), det = +S.rules.hiddenDetection;
    var moveBonus = S.view.laneBasis === 'move' ? (u.M || 0) : 0;
    var res = new Uint8Array(g.nx * g.ny); // 0 out of range, 1 blocked, 2 clear, 3 cover, 4 hidden
    var r0 = G.mm(u.base.w) / 2;
    for (var j = 0; j < g.ny; j++) for (var i = 0; i < g.nx; i++) {
      var p = [(i + 0.5) * CELL, (j + 0.5) * CELL], c = j * g.nx + i, ca = g.areaOf[c];
      var dmin = Infinity;
      idx.forEach(function (mi) { var m = u.models[mi]; var d = Math.hypot(p[0] - m.x, p[1] - m.y) - r0; if (d < dmin) dmin = d; });
      if (range <= 0 || dmin > range + moveBonus) { res[c] = 0; continue; }
      var seen = false, seenFrom = null;
      for (var k = 0; k < idx.length && !seen; k++) {
        var m = u.models[idx[k]];
        if (pointSeenBy([m.x, m.y], info[idx[k]].areas, p, ca, memo)) { seen = true; seenFrom = k; }
      }
      if (!seen) { res[c] = 1; continue; }
      if (ca != null && A[ca] && A[ca].dense && dmin - moveBonus > det) { res[c] = 4; continue; }
      if (ca != null) { res[c] = 3; continue; }
      // partly obscured? check a model-base-sized neighbourhood
      var partial = false;
      for (var o = 0; o < OFFS.length && !partial; o++) {
        var q = [p[0] + OFFS[o][0], p[1] + OFFS[o][1]];
        var qa = null;
        var any = false;
        for (var k2 = 0; k2 < idx.length && !any; k2++) {
          var m2 = u.models[idx[k2]];
          if (pointSeenBy([m2.x, m2.y], info[idx[k2]].areas, q, qa, memo)) any = true;
        }
        if (!any) partial = true;
      }
      res[c] = partial ? 3 : 2;
    }
    UI.cache[key] = res;
    return res;
  }
  // Danger map for unit u: how many enemy units could shoot it at each point (from their current
  // positions; with "next turn" they may also move first). Applies Hidden to u's type.
  function computeDanger(u) {
    var key = 'danger_' + u.id + '_' + S.view.laneBasis;
    if (UI.cache[key]) return UI.cache[key];
    var g = cellGrid(), A = areas(), memo = {}, det = +S.rules.hiddenDetection;
    var foes = S.units.filter(function (f) { return f.player !== u.player && onBoard(f) && maxRange(f) > 0; });
    var res = new Uint8Array(g.nx * g.ny), cov = new Uint8Array(g.nx * g.ny);
    var canHide = !!u.infantry;
    foes.forEach(function (f) {
      var info = modelInfo(f), idx = sampleModels(f, 5), r0 = G.mm(f.base.w) / 2;
      var mv = S.view.laneBasis === 'move' ? (f.M || 0) : 0;
      var reach = maxRange(f) + mv + (S.view.laneBasis === 'move' && rangedWeapons(f).some(function (w) { return w.assault; }) ? advDist() : 0);
      for (var j = 0; j < g.ny; j++) for (var i = 0; i < g.nx; i++) {
        var p = [(i + 0.5) * CELL, (j + 0.5) * CELL], c = j * g.nx + i, ca = g.areaOf[c];
        var dmin = Infinity;
        idx.forEach(function (mi) { var m = f.models[mi]; var d = Math.hypot(p[0] - m.x, p[1] - m.y) - r0; if (d < dmin) dmin = d; });
        if (dmin > reach) continue;
        if (canHide && ca != null && A[ca] && A[ca].dense && dmin - mv > det) continue; // hidden from this unit
        var seen = false;
        for (var k = 0; k < idx.length && !seen; k++) { var m = f.models[idx[k]]; if (pointSeenBy([m.x, m.y], info[idx[k]].areas, p, ca, memo)) seen = true; }
        if (seen) { res[c]++; if (canHide && ca != null) cov[c] = 1; }
      }
    });
    var out = { n: res, cover: cov, foes: foes.length };
    UI.cache[key] = out;
    return out;
  }
  function overlayImage(key, build) {
    if (UI.cache[key]) return UI.cache[key];
    var g = cellGrid();
    var cv = document.createElement('canvas'); cv.width = g.nx; cv.height = g.ny;
    var ctx = cv.getContext('2d'), img = ctx.createImageData(g.nx, g.ny);
    for (var c = 0; c < g.nx * g.ny; c++) {
      var col = build(c);
      if (!col) continue;
      img.data[c * 4] = col[0]; img.data[c * 4 + 1] = col[1]; img.data[c * 4 + 2] = col[2]; img.data[c * 4 + 3] = col[3];
    }
    ctx.putImageData(img, 0, 0);
    UI.cache[key] = cv.toDataURL();
    return UI.cache[key];
  }
  var LANE_COL = { 1: [18, 18, 26, 150], 2: [34, 197, 94, 120], 3: [245, 176, 40, 135], 4: [155, 92, 230, 130] };
  var DANGER_COL = [[34, 197, 94, 105], [250, 204, 21, 120], [249, 115, 22, 135], [220, 38, 38, 145]];
  function drawOverlay(u) {
    var g = cellGrid(), href;
    if (S.view.overlay === 'lanes') {
      var L = computeLanes(u);
      href = overlayImage('lanesImg_' + u.id + '_' + S.view.laneBasis, function (c) { return LANE_COL[L[c]] || null; });
    } else if (S.view.overlay === 'danger') {
      var D = computeDanger(u);
      href = overlayImage('dangerImg_' + u.id + '_' + S.view.laneBasis, function (c) {
        var n = D.n[c]; var col = DANGER_COL[Math.min(n, 3)].slice();
        if (n && D.cover[c]) col[3] = Math.round(col[3] * 0.6);
        return col;
      });
    } else return '';
    return '<image href="' + href + '" x="0" y="0" width="' + g.nx * CELL + '" height="' + g.ny * CELL + '" preserveAspectRatio="none" pointer-events="none" style="image-rendering:auto"/>';
  }
  function legendHtml() {
    var su = selUnit(), v = S.view;
    if (!su || !onBoard(su) || !v.overlay || v.overlay === 'none') return '';
    var sw = function (c) { return '<i style="background:rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (c[3] / 160) + ')"></i>'; };
    var basis = v.laneBasis === 'move' ? 'after moving' : 'from where it stands';
    if (v.overlay === 'lanes') {
      return '<b>Firing lanes</b> — ' + esc(su.name) + ' ' + basis + ' (' + maxRange(su) + '" max)<br>' +
        sw(LANE_COL[2]) + 'Clear shot ' + sw(LANE_COL[3]) + 'Target gets cover (−1 BS) ' + sw(LANE_COL[4]) + 'Target hidden (inf. in dense terrain, &gt;' + S.rules.hiddenDetection + '") ' + sw(LANE_COL[1]) + 'No line of sight';
    }
    var D = computeDanger(su);
    return '<b>Danger map</b> — enemy units that could shoot ' + esc(su.name) + ' ' + (v.laneBasis === 'move' ? 'next turn' : 'right now') + ' (' + D.foes + ' shooting units)<br>' +
      sw(DANGER_COL[0]) + 'Safe ' + sw(DANGER_COL[1]) + '1 ' + sw(DANGER_COL[2]) + '2 ' + sw(DANGER_COL[3]) + '3+' + (su.infantry ? ' · paler = it would have cover there' : '');
  }

  function measureDist(me) {
    if (me.ua && me.ub) {
      var ua = unitById(me.ua.u), ub = unitById(me.ub.u);
      if (ua && ub) {
        var ma = ua.models[me.ua.i], mb = ub.models[me.ub.i];
        if (ma && mb) return { d: G.baseDist(ma, ua.base, mb, ub.base), edge: true };
      }
    }
    if (me.ua) { var u1 = unitById(me.ua.u); if (u1 && u1.models[me.ua.i]) return { d: G.pointBaseDist(me.b, u1.models[me.ua.i], u1.base), edge: true }; }
    return { d: G.dist(me.a, me.b), edge: false };
  }

  function hud() {
    var lg = $('#legend'); if (lg) { var lh = legendHtml(); lg.innerHTML = lh; lg.style.display = lh ? 'block' : 'none'; }
    var h = $('#hud'), parts = [];
    parts.push(S.view.lockLayout ? '🔒 Layout locked' : '<span style="color:#ffb347">🔓 Layout unlocked — terrain &amp; zones can be dragged</span>');
    parts.push('<b>' + esc(S.layout.name) + '</b>');
    parts.push(S.board.w + '" × ' + S.board.h + '"');
    if (UI.tool === 'measure') parts.push('Measure: drag on the board (start on a model for edge-to-edge)');
    if (UI.modelMode) parts.push('Dragging single models');
    h.innerHTML = parts.join(' · ');
  }

  // ---------------------------------------------------------------- pointer interaction
  function hitInfo(target) {
    var el = target.closest ? target.closest('[data-k]') : null;
    if (!el) return { k: 'bg' };
    var mi = target.getAttribute && target.getAttribute('data-mi');
    return { k: el.getAttribute('data-k'), id: el.getAttribute('data-id'), mi: mi != null ? +mi : null, vi: el.getAttribute('data-vi') != null ? +el.getAttribute('data-vi') : null };
  }
  function nearestModel(pt, tol) {
    var best = null;
    S.units.forEach(function (u) {
      u.models.forEach(function (m, i) {
        var d = G.pointBaseDist(pt, m, u.base);
        if (d <= (tol || 0) && (!best || d < best.d)) best = { d: d, u: u.id, i: i };
      });
    });
    return best;
  }

  function onDown(e) {
    svg.setPointerCapture(e.pointerId);
    UI.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(UI.pointers);
    if (ids.length === 2) {
      var p1 = UI.pointers[ids[0]], p2 = UI.pointers[ids[1]];
      UI.pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), cx: (p1.x + p2.x) / 2, cy: (p1.y + p2.y) / 2 };
      if (UI.drag && UI.drag.moved) { restoreDragOrig(); }
      UI.drag = null; return;
    }
    var w = screenToWorld(e.clientX, e.clientY);
    var hit = hitInfo(e.target);
    if (S.view.lockLayout && (hit.k === 'zone' || hit.k === 'zv')) hit = { k: 'bg' };
    if (UI.tool === 'measure' && e.button !== 1) {
      var nm = nearestModel(w, 0);
      UI.measure = { a: nm ? [unitById(nm.u).models[nm.i].x, unitById(nm.u).models[nm.i].y] : w, b: w, ua: nm, ub: null };
      UI.drag = { kind: 'measure' };
      render(); return;
    }
    if (e.button === 1 || e.button === 2 || hit.k === 'bg' || (e.shiftKey && hit.k !== 'unit')) {
      UI.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: UI.cam.x, cy: UI.cam.y, moved: false, clickBg: hit.k === 'bg' };
      return;
    }
    var start = w;
    if (hit.k === 'unit') {
      var u = unitById(hit.id);
      select('unit', u.id);
      var single = UI.modelMode || e.altKey;
      UI.drag = { kind: 'unit', id: u.id, mi: single ? hit.mi : null, start: start, orig: clone(u.models), moved: false };
    } else if (hit.k === 'terrain') {
      var t = terrById(hit.id); select('terrain', t.id);
      UI.drag = S.view.lockLayout ? { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: UI.cam.x, cy: UI.cam.y, moved: false } : { kind: 'terrain', id: t.id, start: start, orig: { x: t.x, y: t.y }, moved: false };
    } else if (hit.k === 'obj') {
      var o = objById(hit.id); select('obj', o.id);
      UI.drag = S.view.lockLayout ? { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: UI.cam.x, cy: UI.cam.y, moved: false } : { kind: 'obj', id: o.id, start: start, orig: { x: o.x, y: o.y }, moved: false };
    } else if (hit.k === 'zone') {
      select('zone', hit.id);
      UI.drag = { kind: 'zone', id: hit.id, start: start, orig: clone(zoneById(hit.id).points), moved: false };
    } else if (hit.k === 'zv') {
      UI.drag = { kind: 'zv', id: hit.id, vi: hit.vi, start: start, orig: clone(zoneById(hit.id).points[hit.vi]), moved: false };
    }
  }
  function restoreDragOrig() {
    var d = UI.drag; if (!d) return;
    if (d.kind === 'unit') { var u = unitById(d.id); if (u) u.models = d.orig; }
    if (d.kind === 'terrain') { var t = terrById(d.id); if (t) { t.x = d.orig.x; t.y = d.orig.y; } }
  }
  function snapv(v) { return S.view.snap ? Math.round(v * 4) / 4 : Math.round(v * 100) / 100; }
  function onMove(e) {
    if (UI.pointers[e.pointerId]) UI.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(UI.pointers);
    if (ids.length === 2 && UI.pinch) {
      var p1 = UI.pointers[ids[0]], p2 = UI.pointers[ids[1]];
      var d = Math.hypot(p1.x - p2.x, p1.y - p2.y), cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
      UI.cam.x += cx - UI.pinch.cx; UI.cam.y += cy - UI.pinch.cy;
      zoomAt(cx, cy, d / UI.pinch.d);
      UI.pinch = { d: d, cx: cx, cy: cy };
      return;
    }
    var dr = UI.drag; if (!dr) return;
    var w = screenToWorld(e.clientX, e.clientY);
    if (dr.kind === 'pan') {
      var dx = e.clientX - dr.sx, dy = e.clientY - dr.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) dr.moved = true;
      UI.cam.x = dr.cx + dx; UI.cam.y = dr.cy + dy; applyCam(); return;
    }
    if (dr.kind === 'measure') {
      UI.measure.b = w;
      var nm = nearestModel(w, 0);
      if (nm && (!UI.measure.ua || nm.u !== UI.measure.ua.u)) { UI.measure.ub = nm; } else UI.measure.ub = null;
      render(); return;
    }
    var ddx = w[0] - dr.start[0], ddy = w[1] - dr.start[1];
    if (!dr.moved && Math.hypot(ddx, ddy) * UI.cam.k < 3) return;
    dr.moved = true;
    if (dr.kind === 'unit') {
      var u = unitById(dr.id);
      u.models = dr.orig.map(function (m, i) {
        if (dr.mi != null && i !== dr.mi) return m;
        return { x: m.x + ddx, y: m.y + ddy, rot: m.rot };
      });
    } else if (dr.kind === 'terrain') {
      var t = terrById(dr.id); t.x = snapv(dr.orig.x + ddx); t.y = snapv(dr.orig.y + ddy);
    } else if (dr.kind === 'obj') {
      var o = objById(dr.id); o.x = snapv(dr.orig.x + ddx); o.y = snapv(dr.orig.y + ddy);
    } else if (dr.kind === 'zone') {
      var z = zoneById(dr.id); z.points = dr.orig.map(function (p) { return [snapv(p[0] + ddx), snapv(p[1] + ddy)]; });
    } else if (dr.kind === 'zv') {
      var z2 = zoneById(dr.id); z2.points[dr.vi] = [snapv(dr.orig[0] + ddx), snapv(dr.orig[1] + ddy)];
    }
    UI.cache = {};
    render();
    if (UI.tab === 'sel' && dr.kind !== 'unit') liveCoords();
  }
  function onUp(e) {
    delete UI.pointers[e.pointerId];
    if (Object.keys(UI.pointers).length < 2) UI.pinch = null;
    var dr = UI.drag; UI.drag = null;
    if (!dr) return;
    if (dr.kind === 'pan') { if (!dr.moved && dr.clickBg) { UI.sel = null; renderPanel(); render(); } return; }
    if (dr.kind === 'measure') { render(); return; }
    if (dr.moved) {
      if (dr.kind === 'obj') { var o = objById(dr.id); o.area = areaAt([o.x, o.y]); }
      UI.cache = {};
      commit(); renderPanel();
    }
    render();
  }
  function areaAt(p) {
    var A = areas(), hit = null;
    Object.keys(A).forEach(function (k) { if (A[k].polys.some(function (P) { return G.pointInPoly(p, P); })) hit = A[k].id; });
    return hit;
  }

  function select(kind, id) {
    UI.sel = kind ? { kind: kind, id: id } : null;
    if (kind) showTab('sel');
    renderPanel(); render();
  }

  // ---------------------------------------------------------------- panels
  function showTab(t) {
    UI.tab = t;
    $$('.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
    $$('.tab').forEach(function (s) { s.classList.toggle('on', s.id === 'tab-' + t); });
    renderPanel();
  }
  function renderPanel() {
    var t = UI.tab;
    if (t === 'sel') panelSel();
    else if (t === 'armies') panelArmies();
    else if (t === 'layout') panelLayout();
    else if (t === 'view') panelView();
    else if (t === 'file') panelFile();
  }
  function bind(root) {
    $$('[data-act]', root).forEach(function (el) {
      var ev = (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') && el.type !== 'button' ? 'change' : 'click';
      el.addEventListener(ev, function (e) { ACTIONS[el.dataset.act] && ACTIONS[el.dataset.act](el, e); });
    });
  }
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? (d || 0) : n; }

  function baseLabel(b) {
    if (!b) return '?';
    if (b.kind === 'round') return b.w + 'mm';
    if (b.kind === 'oval') return b.w + '×' + b.h + 'mm oval';
    return 'hull ' + b.w + '×' + b.h + 'mm';
  }

  function panelSel() {
    var el = $('#tab-sel'), s = UI.sel, h = '';
    var obj = findSel();
    if (!s || !obj) {
      h += '<h3>Getting started</h3><ol class="help">' +
        '<li><b>Layout</b> tab → pick an Event Companion layout (all 45 are built in).</li>' +
        '<li><b>Armies</b> tab → import a list (BattleScribe/New Recruit .ros/.rosz, Yellowscribe JSON or text) or add units. Base sizes come from the Base Size Guide automatically.</li>' +
        '<li>Drag units onto the table. Select one to see its threat ranges, line of sight and charge odds.</li>' +
        '<li><b>View</b> tab → toggle shooting / charge / move rings, LOS shading and labels.</li></ol>' +
        '<p class="muted">Drag empty space to pan · wheel / pinch to zoom · Shift-drag pans anywhere · Alt-drag (or “Unit drag” button) moves a single model · R / Shift+R rotate · Del deletes · Ctrl+Z undo.</p>';
      el.innerHTML = h; bind(el); return;
    }
    if (s.kind === 'unit') return panelUnit(el, obj);
    if (s.kind === 'terrain') return panelTerrain(el, obj);
    if (s.kind === 'obj') return panelObj(el, obj);
    if (s.kind === 'zone') return panelZone(el, obj);
  }

  function panelUnit(el, u) {
    var h = '<div class="row"><input class="grow big" data-act="uName" value="' + esc(u.name) + '"><select data-act="uPlayer">' +
      ['A', 'B'].map(function (p) { return '<option value="' + p + '"' + (u.player === p ? ' selected' : '') + '>' + esc(S.players[p].name) + '</option>'; }).join('') + '</select></div>';
    h += '<div class="grid3"><label>Models<input type="number" min="1" max="60" data-act="uCount" value="' + u.models.length + '"></label>' +
      '<label>Move (")<input type="number" step="0.5" data-act="uM" value="' + (u.M || 0) + '"></label>' +
      '<label>Base<select data-act="uBasePreset"><option value="">' + esc(baseLabel(u.base)) + '</option>' + TT.BASE_PRESETS.map(function (b, i) { return '<option value="' + i + '">' + esc(b.label) + '</option>'; }).join('') + '</select></label></div>';
    h += '<div class="grid3"><label>Kind<select data-act="uBaseKind">' + ['round', 'oval', 'rect'].map(function (k) { return '<option' + (u.base.kind === k ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></label>' +
      '<label>' + (u.base.kind === 'round' ? 'Diameter' : 'Length') + ' mm<input type="number" step="0.5" data-act="uBaseW" value="' + u.base.w + '"></label>' +
      (u.base.kind !== 'round' ? '<label>Width mm<input type="number" step="0.5" data-act="uBaseH" value="' + (u.base.h || u.base.w) + '"></label>' : '<label>&nbsp;<button data-act="uSaveBase" type="button">Remember base</button></label>') + '</div>';
    if (u.baseSource) h += '<p class="muted small">Base: ' + esc(u.baseSource) + '</p>';
    h += '<div class="row wrap"><label class="chk"><input type="checkbox" data-act="uInf"' + (u.infantry ? ' checked' : '') + '> Infantry / Beasts / Swarm</label>' +
      '<label class="chk"><input type="checkbox" data-act="uShot"' + (u.shot ? ' checked' : '') + '> Shot this/last turn (not hidden)</label>' +
      '<label class="chk"><input type="checkbox" data-act="uPin"' + (u.pin ? ' checked' : '') + '> Always show rings</label></div>';
    h += '<h4>Weapons</h4><table class="wtab"><tr><th>Name</th><th>Range</th><th title="Assault: can shoot after advancing">Asl</th><th></th></tr>';
    (u.weapons || []).forEach(function (w, i) {
      h += '<tr><td><input data-act="wName" data-i="' + i + '" value="' + esc(w.name) + '"></td><td><input type="text" data-act="wRange" data-i="' + i + '" value="' + (w.melee ? 'Melee' : w.range) + '" size="4"></td>' +
        '<td><input type="checkbox" data-act="wAssault" data-i="' + i + '"' + (w.assault ? ' checked' : '') + (w.melee ? ' disabled' : '') + '></td><td><button type="button" class="x" data-act="wDel" data-i="' + i + '">✕</button></td></tr>';
    });
    h += '</table><div class="row"><button type="button" data-act="wAdd">+ Ranged</button><button type="button" data-act="wAddMelee">+ Melee</button></div>';
    h += '<h4>Formation</h4><div class="row wrap"><button type="button" data-act="form" data-n="1">1 row</button><button type="button" data-act="form" data-n="2">2 rows</button><button type="button" data-act="form" data-n="3">3 rows</button><button type="button" data-act="form" data-n="0">Blob</button>' +
      '<button type="button" data-act="uRot" data-d="-15">⟲ 15°</button><button type="button" data-act="uRot" data-d="15">⟳ 15°</button></div>';
    h += '<div class="row"><button type="button" data-act="uDup">Duplicate</button><button type="button" data-act="uFocus">Centre view</button><button type="button" class="danger" data-act="uDel">Delete</button></div>';
    // analysis
    if (onBoard(u)) {
      var rows = analyse(u);
      var info = modelInfo(u);
      var hiddenN = info.filter(function (x) { return x.hidden; }).length, inArea = info.filter(function (x) { return x.inArea; }).length;
      h += '<h4>Board overlay</h4><div class="seg">' + [['lanes', 'Firing lanes'], ['danger', 'Danger map'], ['none', 'Off']].map(function (o) { return '<button type="button" data-act="setOverlay" data-v="' + o[0] + '" class="' + (S.view.overlay === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div>' +
        '<div class="seg">' + [['now', 'From current position'], ['move', 'After moving']].map(function (o) { return '<button type="button" data-act="setLaneBasis" data-v="' + o[0] + '" class="' + (S.view.laneBasis === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div>' +
        '<p class="muted small">' + (S.view.overlay === 'danger' ? 'Where this unit would be exposed to enemy shooting. Green = no enemy unit can see and reach it. ' + (su_inf(u) ? 'As Infantry it can be hidden inside dense terrain more than ' + S.rules.hiddenDetection + '" from the shooter.' : 'Not Infantry/Beasts/Swarm, so it can\'t use Hidden.') : 'Where this unit could shoot, coloured by what a target standing there would get. Cover/hidden apply to Infantry, Beasts and Swarm targets in terrain; amber outside terrain means the target is partly obscured.') + '</p>';
      h += '<h4>Status</h4><p class="small">' + inArea + '/' + u.models.length + ' models within a terrain area' + (u.infantry ? (inArea === u.models.length ? ' → <b>benefit of cover</b>' : '') : '') +
        (hiddenN ? ' · <b>' + hiddenN + ' hidden</b> (visible only within ' + S.rules.hiddenDetection + '")' : '') + '</p>';
      if (rows.length) {
        h += '<h4>Targets &amp; threats</h4><div class="tablewrap"><table class="atab"><tr><th>Enemy</th><th>Dist</th><th>LOS</th><th>Shoot now</th><th>Charge now</th><th>Charge after move</th></tr>';
        rows.forEach(function (r) {
          var wOk = r.weapons.filter(function (w) { return w.ok; }).map(function (w) { return w.name; });
          h += '<tr data-act="selUnit" data-id="' + r.unit.id + '"><td>' + esc(r.unit.name) + '</td><td>' + fmt(r.d) + '"</td>' +
            '<td class="' + (r.vis.visible ? 'ok' : 'no') + '">' + r.vis.visible + '/' + r.vis.total + (r.vis.visible && r.cover ? ' <span title="Target has the benefit of cover (-1 BS)">C</span>' : '') + '</td>' +
            '<td>' + (wOk.length ? '<span class="ok">' + esc(wOk.join(', ')) + '</span>' : '<span class="muted">—</span>') + '</td>' +
            '<td>' + (r.chargeNow ? pct(r.chargeNow) : '—') + '</td><td>' + (r.chargeNext ? pct(r.chargeNext) : '—') + '</td></tr>';
        });
        h += '</table></div>';
        h += '<h4>Danger to this unit (enemy turn)</h4><div class="tablewrap"><table class="atab"><tr><th>Enemy</th><th>Can see it now</th><th>Can shoot it after moving</th><th>Charge odds</th></tr>';
        rows.forEach(function (r) {
          h += '<tr><td>' + esc(r.unit.name) + '</td><td class="' + (r.canShootNow ? 'no' : 'ok') + '">' + (r.back.visible ? r.back.visible + '/' + r.back.total + (r.canShootNow ? ' in range' : '') : 'no') + '</td>' +
            '<td class="' + (r.canShootNext ? 'no' : 'ok') + '">' + (r.canShootNext ? 'yes' : 'no') + '</td><td class="' + (r.theyChargeNext > 0.4 ? 'no' : '') + '">' + (r.theyChargeNext ? pct(r.theyChargeNext) : '—') + '</td></tr>';
        });
        h += '</table></div><p class="muted small">Distances are closest base-to-base. Charge odds = chance of rolling the needed 2D6 (target within 12"); “after move” assumes a straight-line Normal move ending outside engagement range. LOS uses 11th edition Obscuring and Hidden rules, viewed top-down.</p>';
      }
    } else {
      h += '<p class="muted">Off the table — drag it onto the battlefield to see analysis.</p>';
    }
    el.innerHTML = h; bind(el);
  }

  function terrainEdges(t) { return G.bbox(G.terrainPolygon(t)); }
  function panelTerrain(el, t) {
    var f = TT.FOOTPRINTS[t.type], bb = terrainEdges(t), A = areas()[t.area] || {};
    var h = '<h3>' + esc(f.name) + ' <span class="muted">' + f.w + '" × ' + f.h + '"</span></h3>' + lockNote();
    h += '<p class="muted small">Positions in inches from the top-left corner of the battlefield. Edge fields move the piece so that edge sits at that distance.</p>';
    h += '<div class="grid2"><label>Centre X<input type="number" step="0.25" data-act="tX" value="' + fmt(t.x, 3) + '"></label><label>Centre Y<input type="number" step="0.25" data-act="tY" value="' + fmt(t.y, 3) + '"></label></div>';
    h += '<div class="grid2"><label>Left edge from left<input type="number" step="0.25" data-act="tL" value="' + fmt(bb.minX, 2) + '"></label><label>Right edge from right<input type="number" step="0.25" data-act="tR" value="' + fmt(S.board.w - bb.maxX, 2) + '"></label>' +
      '<label>Top edge from top<input type="number" step="0.25" data-act="tT" value="' + fmt(bb.minY, 2) + '"></label><label>Bottom edge from bottom<input type="number" step="0.25" data-act="tB" value="' + fmt(S.board.h - bb.maxY, 2) + '"></label></div>';
    h += '<div class="row wrap"><label>Rotation °<input type="number" step="1" data-act="tRot" value="' + fmt(t.rot || 0, 2) + '" size="5"></label><button type="button" data-act="tRotBy" data-d="-90">⟲90</button><button type="button" data-act="tRotBy" data-d="-15">⟲15</button><button type="button" data-act="tRotBy" data-d="15">⟳15</button><button type="button" data-act="tRotBy" data-d="90">⟳90</button>' +
      (t.type === 'tri' ? '<label class="chk"><input type="checkbox" data-act="tMirror"' + (t.mirror ? ' checked' : '') + '> Mirror</label>' : '') + '</div>';
    h += '<div class="row wrap"><label class="chk"><input type="checkbox" data-act="tObs"' + (t.obscuring !== false ? ' checked' : '') + '> Obscuring (has light or dense features)</label>' +
      '<label class="chk"><input type="checkbox" data-act="tDense"' + (t.dense ? ' checked' : '') + '> Dense features (allows Hidden)</label></div>';
    h += '<div class="row"><label>Terrain area #<input type="number" min="1" data-act="tArea" value="' + t.area + '" size="4"></label><span class="muted small">' + (A.items && A.items.length > 1 ? 'Shared with ' + (A.items.length - 1) + ' other footprint(s) — one terrain area' : 'Give two footprints the same number to make them one terrain area') + '</span></div>';
    h += '<div class="row"><button type="button" data-act="tDup">Duplicate</button><button type="button" class="danger" data-act="tDel">Delete</button></div>';
    el.innerHTML = h; bind(el);
  }
  function liveCoords() {
    var s = UI.sel; if (!s) return;
    if (s.kind === 'terrain') {
      var t = terrById(s.id); if (!t) return; var bb = terrainEdges(t);
      var set = function (a, v) { var i = $('[data-act="' + a + '"]'); if (i && document.activeElement !== i) i.value = fmt(v, 2); };
      set('tX', t.x); set('tY', t.y); set('tL', bb.minX); set('tR', S.board.w - bb.maxX); set('tT', bb.minY); set('tB', S.board.h - bb.maxY);
    }
  }
  function su_inf(u) { return !!u.infantry; }
  function lockNote() { return S.view.lockLayout ? '<p class="small lockbar">Layout is locked, so this can\'t be dragged. Unlock it in the <b>Layout</b> tab to move pieces (the fields below still edit it exactly).</p>' : ''; }
  function panelObj(el, o) {
    var h = '<h3>Objective</h3>' + lockNote() + '<div class="grid2"><label>Type<select data-act="oKind">' +
      [['central', 'Central'], ['expansion', 'Expansion'], ['home-attacker', 'Home (Attacker)'], ['home-defender', 'Home (Defender)']].map(function (k) { return '<option value="' + k[0] + '"' + (o.kind === k[0] ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></label>' +
      '<label>Label<input data-act="oLabel" value="' + esc(o.label || '') + '"></label>' +
      '<label>X<input type="number" step="0.25" data-act="oX" value="' + o.x + '"></label><label>Y<input type="number" step="0.25" data-act="oY" value="' + o.y + '"></label></div>';
    h += '<p class="small">' + (o.area != null ? 'Terrain objective: terrain area #' + o.area + ' (models within that area are in range).' : 'Not on a terrain area: showing a ' + S.rules.objectiveControl + '" control ring (change in View → Rules).') + '</p>';
    h += '<div class="row"><button type="button" class="danger" data-act="oDel">Delete</button></div>';
    el.innerHTML = h; bind(el);
  }
  function panelZone(el, z) {
    var h = '<h3>Deployment zone</h3><div class="row"><label>Player<select data-act="zPlayer">' + ['A', 'B'].map(function (p) { return '<option value="' + p + '"' + (z.player === p ? ' selected' : '') + '>' + esc(S.players[p].name) + '</option>'; }).join('') + '</select></label></div>';
    h += '<label>Corner points (x,y per line, inches)<textarea rows="8" data-act="zPts">' + z.points.map(function (p) { return fmt(p[0], 2) + ',' + fmt(p[1], 2); }).join('\n') + '</textarea></label>';
    h += '<p class="muted small">Drag the white handles on the board to reshape. Drag inside the zone to move it.</p><div class="row"><button type="button" class="danger" data-act="zDel">Delete</button></div>';
    el.innerHTML = h; bind(el);
  }

  function panelArmies() {
    var el = $('#tab-armies'), h = '';
    ['A', 'B'].forEach(function (p) {
      var pl = S.players[p];
      var us = S.units.filter(function (u) { return u.player === p; });
      var pts = us.reduce(function (a, u) { return a + (u.points || 0); }, 0);
      h += '<div class="army"><div class="row"><input type="color" data-act="pColor" data-p="' + p + '" value="' + pl.color + '"><input class="grow big" data-act="pName" data-p="' + p + '" value="' + esc(pl.name) + '"><span class="muted small">' + us.length + ' units' + (pts ? ' · ' + pts + ' pts' : '') + '</span></div>';
      h += '<ul class="ulist">' + us.map(function (u) {
        return '<li class="' + (UI.sel && UI.sel.id === u.id ? 'on' : '') + '"><span data-act="selUnit" data-id="' + u.id + '" class="grow">' + esc(u.name) + ' <span class="muted">' + u.models.length + '× ' + esc(baseLabel(u.base)) + (u.M ? ' · M' + u.M + '"' : '') + (onBoard(u) ? '' : ' · off table') + '</span></span>' +
          '<button type="button" class="x" title="Always show rings" data-act="uPinT" data-id="' + u.id + '">' + (u.pin ? '◉' : '○') + '</button></li>';
      }).join('') + '</ul>';
      h += '<div class="row wrap"><button type="button" data-act="addUnit" data-p="' + p + '">+ Add unit</button><button type="button" data-act="importFile" data-p="' + p + '">Import file…</button><button type="button" data-act="deployAll" data-p="' + p + '">Stage off-table</button><button type="button" class="danger" data-act="clearArmy" data-p="' + p + '">Clear</button></div></div>';
    });
    h += '<h4>Import a list</h4><div class="row"><label>Into<select id="impPlayer"><option value="A">' + esc(S.players.A.name) + '</option><option value="B">' + esc(S.players.B.name) + '</option></select></label></div>' +
      '<textarea id="impText" rows="5" placeholder="Paste a Warhammer 40,000 app / New Recruit text export, Yellowscribe JSON, or roster XML/JSON here"></textarea>' +
      '<div class="row"><button type="button" data-act="importPaste">Import pasted list</button></div>' +
      '<div class="row"><input id="ysCode" class="grow" placeholder="Yellowscribe code"><button type="button" data-act="ysFetch">Fetch</button><button type="button" data-act="ysOpen">Open JSON</button></div>' +
      '<p class="muted small">Yellowscribe: in New Recruit choose Export → Yellowscribe, then paste the code. If the direct fetch is blocked by your browser, press <b>Open JSON</b>, copy everything on that page and paste it above. You can also import the same .ros/.rosz file you give Yellowscribe. Codes expire after about 10 minutes.</p>';
    el.innerHTML = h; bind(el);
  }

  function panelLayout() {
    var el = $('#tab-layout'), h = '';
    var opts = '<option value="blank">Blank battlefield</option><optgroup label="Event Companion v1.2 (official)">' +
      (TT.OFFICIAL_LAYOUTS || []).map(function (l) { return '<option value="off:' + l.id + '"' + (S.layout.id === l.id ? ' selected' : '') + '>' + esc(l.name) + '</option>'; }).join('') + '</optgroup>';
    if (MYLAYOUTS.length) opts += '<optgroup label="My layouts">' + MYLAYOUTS.map(function (l, i) { return '<option value="my:' + i + '">' + esc(l.name) + '</option>'; }).join('') + '</optgroup>';
    h += '<div class="lockbar">' + chk('lockLayout', '<b>Lock layout</b> — terrain, objectives and deployment zones can\'t be moved') + '</div>';
    h += '<h4>Layout library</h4><select id="layoutSel" class="full">' + opts + '</select><div class="row wrap"><button type="button" data-act="loadLayout">Load layout</button><button type="button" data-act="rotateBoard">Rotate battlefield 90°</button></div>';
    var cur = (TT.OFFICIAL_LAYOUTS || []).find(function (l) { return l.id === S.layout.id; });
    if (cur) h += '<p class="small">' + esc(cur.dispositions[0]) + ' (' + esc(cur.missions[0]) + ') vs ' + esc(cur.dispositions[1]) + ' (' + esc(cur.missions[1]) + ') · Event Companion p.' + cur.page + '</p>';
    h += '<h4>Terrain footprints</h4><div class="palette">' + TT.FOOTPRINT_ORDER.map(function (k) {
      var f = TT.FOOTPRINTS[k], used = S.terrain.filter(function (t) { return t.type === k; }).length;
      return '<button type="button" data-act="addFoot" data-t="' + k + '"><svg viewBox="-6.5 -5 13 10" width="52" height="40"><polygon points="' + ptsAttr(G.terrainPolygon({ type: k, x: 0, y: 0, rot: 0 })) + '" fill="#8f8b80" stroke="#333" stroke-width="0.25"/></svg><span>' + esc(f.name) + '<br><span class="muted">' + f.w + '"×' + f.h + '" · ' + used + '/' + f.count + '</span></span></button>';
    }).join('') + '</div>';
    h += '<h4>Objectives</h4><div class="row wrap"><button type="button" data-act="addObj" data-k="central">+ Central</button><button type="button" data-act="addObj" data-k="expansion">+ Expansion</button><button type="button" data-act="addObj" data-k="home-attacker">+ Home (A)</button><button type="button" data-act="addObj" data-k="home-defender">+ Home (D)</button></div>';
    h += '<h4>Deployment zones</h4><div class="row wrap"><select id="zonePreset">' + TT.ZONE_PRESETS.map(function (z) { return '<option value="' + z.id + '">' + esc(z.name) + '</option>'; }).join('') + '</select><button type="button" data-act="applyZones">Apply</button><button type="button" data-act="addZone">+ Zone rectangle</button></div>';
    h += '<h4>Battlefield</h4><div class="row wrap"><select id="boardPreset">' + TT.BOARD_PRESETS.map(function (b) { return '<option value="' + b.id + '">' + esc(b.name) + '</option>'; }).join('') + '</select><button type="button" data-act="applyBoard">Set size</button></div>' +
      '<div class="grid2"><label>Width "<input type="number" data-act="boardW" value="' + S.board.w + '"></label><label>Depth "<input type="number" data-act="boardH" value="' + S.board.h + '"></label></div>';
    h += '<h4>Save / share layouts</h4><div class="row wrap"><button type="button" data-act="saveLayout">Save as my layout</button><button type="button" data-act="exportLayout">Export layout JSON</button><button type="button" data-act="importLayout">Import layout JSON</button>' +
      (MYLAYOUTS.length ? '<button type="button" class="danger" data-act="delMyLayout">Delete selected “my layout”</button>' : '') + '</div>';
    h += '<div class="row"><button type="button" class="danger" data-act="clearTerrain">Clear terrain &amp; objectives</button></div>';
    el.innerHTML = h; bind(el);
  }

  function chk(path, label, title) {
    var v = path.split('.').reduce(function (o, k) { return o[k]; }, S.view);
    return '<label class="chk"' + (title ? ' title="' + esc(title) + '"' : '') + '><input type="checkbox" data-act="viewChk" data-path="' + path + '"' + (v ? ' checked' : '') + '> ' + label + '</label>';
  }
  function panelView() {
    var el = $('#tab-view'), v = S.view, r = S.rules;
    var h = '<h4>Threat ranges</h4><div class="row wrap">' + chk('threat.shoot', 'Shooting') + chk('threat.charge', 'Charge') + chk('threat.move', 'Move') + chk('threat.advance', 'Advance') + chk('threat.engage', 'Engagement (2")') + '</div>';
    h += '<div class="grid2"><label>Show rings for<select data-act="viewSel" data-path="threatScope">' +
      [['selected', 'Selected unit'], ['A', S.players.A.name], ['B', S.players.B.name], ['all', 'Everyone']].map(function (o) { return '<option value="' + o[0] + '"' + (v.threatScope === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>' +
      '<label>Measure rings<select data-act="viewSel" data-path="threatBasis"><option value="move"' + (v.threatBasis === 'move' ? ' selected' : '') + '>Next turn (move + range)</option><option value="now"' + (v.threatBasis === 'now' ? ' selected' : '') + '>From current position</option></select></label></div>';
    h += '<div class="row wrap">' + chk('stack', 'Stack overlaps (heat map)', 'Overlapping rings darken where more units threaten') + '</div>';
    h += '<h4>Board overlay (selected unit)</h4><div class="grid2"><label>Overlay<select data-act="viewSel" data-path="overlay">' + [['lanes', 'Firing lanes'], ['danger', 'Danger map'], ['none', 'Off']].map(function (o) { return '<option value="' + o[0] + '"' + (v.overlay === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<label>Basis<select data-act="viewSel" data-path="laneBasis"><option value="now"' + (v.laneBasis === 'now' ? ' selected' : '') + '>Current positions</option><option value="move"' + (v.laneBasis === 'move' ? ' selected' : '') + '>After moving</option></select></label></div>';
    h += '<h4>Line of sight</h4><div class="row wrap">' + chk('los', 'LOS lines to visible enemies') + chk('vis', 'Raw line-of-sight shading') + chk('visClip', 'Clip shading to max range') + chk('cover', 'Cover / hidden badges') + '</div>';
    h += '<p class="muted small">Terrain shading: <b style="color:#77736a">dark</b> = area with dense features (Hidden possible), <b style="color:#a8a396">mid</b> = light features only (obscuring), <b style="color:#c9c5b7">pale</b> = not obscuring. Teal outline = terrain objective.</p>';
    h += '<h4>Display</h4><div class="row wrap">' + chk('labels', 'Unit labels') + chk('grid', 'Grid') + chk('zones', 'Deployment zones') + chk('areaLabels', 'Terrain area numbers') + chk('snap', 'Snap terrain to ¼"') + '</div>';
    h += '<h4>Rules values (11th edition)</h4><div class="grid2">' +
      '<label>Charge distance<select data-act="ruleSel" data-path="chargeMode"><option value="max"' + (r.chargeMode === 'max' ? ' selected' : '') + '>Max 12"</option><option value="avg"' + (r.chargeMode === 'avg' ? ' selected' : '') + '>Average 7"</option><option value="custom"' + (r.chargeMode === 'custom' ? ' selected' : '') + '>Custom</option></select></label>' +
      '<label>Custom charge "<input type="number" data-act="ruleNum" data-path="chargeCustom" value="' + r.chargeCustom + '"></label>' +
      '<label>Advance (D6)<select data-act="ruleSel" data-path="advanceMode"><option value="avg"' + (r.advanceMode === 'avg' ? ' selected' : '') + '>Average 3.5"</option><option value="max"' + (r.advanceMode === 'max' ? ' selected' : '') + '>Max 6"</option><option value="none"' + (r.advanceMode === 'none' ? ' selected' : '') + '>Ignore</option></select></label>' +
      '<label>Engagement range "<input type="number" step="0.5" data-act="ruleNum" data-path="engagementRange" value="' + r.engagementRange + '"></label>' +
      '<label>Hidden detection "<input type="number" data-act="ruleNum" data-path="hiddenDetection" value="' + r.hiddenDetection + '"></label>' +
      '<label>Objective ring "<input type="number" step="0.5" data-act="ruleNum" data-path="objectiveControl" value="' + r.objectiveControl + '"></label></div>';
    h += '<p class="muted small">Charge: 2D6, targets must be within 12" and within the roll (base to base). Advance: M + D6. Engagement range 2". Hidden models are only visible within 15". Obscuring: line of sight crossing an obscuring terrain area is blocked unless one of the models is within it.</p>';
    el.innerHTML = h; bind(el);
  }

  function panelFile() {
    var el = $('#tab-file');
    var h = '<h4>Scenario</h4><div class="row wrap"><button type="button" data-act="saveScenario">Save scenario (.json)</button><button type="button" data-act="loadScenario">Load scenario…</button><button type="button" data-act="copyScenario">Copy as text</button><button type="button" data-act="exportPng">Export PNG</button><button type="button" class="danger" data-act="newScenario">New scenario</button></div>' +
      '<p class="muted small">Everything autosaves in this browser. Scenario files hold the layout, both armies and their positions — handy for planning deployments before a game.</p>';
    h += '<h4>Base library</h4><p class="muted small">Bases you set with “Remember base” are used next time a unit with that name is imported. The built-in Base Size Guide (June 2026, ' + guideIndex().length + ' entries) is used otherwise.</p>' +
      '<ul class="ulist">' + Object.keys(BASELIB).map(function (k) { return '<li><span class="grow">' + esc(k) + ' <span class="muted">' + esc(baseLabel(BASELIB[k])) + '</span></span><button type="button" class="x" data-act="libDel" data-k="' + esc(k) + '">✕</button></li>'; }).join('') + '</ul>';
    h += '<h4>About</h4><p class="small">TacticalTooling — an 11th edition Warhammer 40,000 tactics board. Terrain layouts and base sizes transcribed from the Warhammer Event Companion v1.2; rules values from the 11th edition Core Rules. Unofficial fan tool, not affiliated with Games Workshop.</p><p class="muted small">Version ' + APP_VERSION + '</p>';
    el.innerHTML = h; bind(el);
  }

  // ---------------------------------------------------------------- unit factory
  function placeUnit(u, cx, cy, perRow) {
    var n = u.models.length || u.count || 1;
    u.models = G.formation(n, u.base, cx, cy, perRow || Math.min(5, n), 0.5, 0);
  }
  function stagingSpot(p) {
    var us = S.units.filter(function (u) { return u.player === p && !onBoard(u); });
    var y = 2, x = p === 'A' ? -9 : S.board.w + 9;
    us.forEach(function (u) { var bb = G.bbox(u.models.map(function (m) { return [m.x, m.y]; })); y = Math.max(y, bb.maxY + 3); });
    return [x, y];
  }
  function makeUnit(p, src) {
    var lb = lookupBase(src.name);
    var base = (lb && lb.base) || { kind: 'round', w: 32 };
    var kw = (src.keywords || []).join(' ').toLowerCase();
    var u = {
      id: uid(), player: p, name: src.name || 'Unit', base: base, baseSource: lb ? lb.source : 'default 32mm — set the base size',
      M: src.M || 6, weapons: src.weapons && src.weapons.length ? src.weapons : [{ name: 'Gun', range: 24, melee: false, assault: false }, { name: 'Close combat weapon', range: 0, melee: true }],
      keywords: src.keywords || [], points: src.points || 0,
      infantry: src.keywords ? /\b(infantry|beasts?|swarm)\b/.test(kw) : true,
      shot: false, pin: false, models: []
    };
    if (!src.M && /vehicle|monster/.test(kw)) u.M = 10;
    u.models = new Array(Math.max(1, src.count || 1)).fill(0).map(function () { return { x: 0, y: 0, rot: 0 }; });
    return u;
  }
  function importUnits(p, parsed) {
    if (!parsed.units.length) { toast('No units found in that list'); return; }
    var count = 0, missing = 0;
    parsed.units.forEach(function (src) {
      var u = makeUnit(p, src);
      if (/default/.test(u.baseSource)) missing++;
      var spot = stagingSpot(p);
      u.models = G.formation(u.models.length, u.base, spot[0], spot[1] + 1, Math.min(5, u.models.length), 0.5, 0);
      var bb = G.bbox(u.models.map(function (m) { return [m.x, m.y]; }));
      u.models.forEach(function (m) { m.y += (spot[1] - bb.minY); });
      S.units.push(u); count++;
    });
    UI.cache = {}; commit(); renderAll();
    toast('Imported ' + count + ' units from ' + parsed.source + (missing ? ' · ' + missing + ' need a base size' : '') + ' — they are staged beside the table');
  }

  // ---------------------------------------------------------------- layout ops
  function loadLayout(L, official) {
    S.board = { w: (L.board && L.board.w) || S.board.w, h: (L.board && L.board.h) || S.board.h };
    S.terrain = (L.terrain || []).map(function (t, i) {
      var f = TT.FOOTPRINTS[t.type];
      return { id: uid(), type: t.type, x: t.x, y: t.y, rot: t.rot || 0, mirror: !!t.mirror, area: t.area != null ? t.area : i + 1, dense: t.dense != null ? t.dense : true, obscuring: t.obscuring != null ? t.obscuring : f.obscuring };
    });
    S.features = clone(L.features || []);
    S.objectives = (L.objectives || []).map(function (o) { return { id: uid(), kind: o.kind || 'central', x: o.x, y: o.y, area: o.area != null ? o.area : null, label: o.label || '' }; });
    S.zones = (L.zones || []).map(function (z) { return { id: uid(), player: z.player, points: clone(z.points) }; });
    if (L.zonePreset) applyZonePreset(L.zonePreset);
    S.layout = { id: L.id || 'custom', name: L.name || 'Layout' };
    UI.cache = {}; UI.sel = null;
    // re-link objectives to areas if not set
    S.objectives.forEach(function (o) { if (o.area == null) o.area = areaAt([o.x, o.y]); });
    commit(); renderAll(); fit();
  }
  function applyZonePreset(id) {
    var p = TT.ZONE_PRESETS.find(function (z) { return z.id === id; }); if (!p) return;
    S.zones = p.make(S.board.w, S.board.h).map(function (z) { return { id: uid(), player: z.player, points: z.points }; });
  }
  function rotateBoard() {
    var W = S.board.w, H = S.board.h;
    var R = function (x, y) { return [H - y, x]; }; // rotate 90° clockwise
    S.terrain.forEach(function (t) { var p = R(t.x, t.y); t.x = p[0]; t.y = p[1]; t.rot = ((t.rot || 0) + 90) % 360; });
    S.features.forEach(function (f) { f.points = f.points.map(function (q) { return R(q[0], q[1]); }); });
    S.objectives.forEach(function (o) { var p = R(o.x, o.y); o.x = p[0]; o.y = p[1]; });
    S.zones.forEach(function (z) { z.points = z.points.map(function (q) { return R(q[0], q[1]); }); });
    S.units.forEach(function (u) { u.models.forEach(function (m) { var p = R(m.x, m.y); m.x = p[0]; m.y = p[1]; m.rot = ((m.rot || 0) + 90) % 360; }); });
    S.board = { w: H, h: W };
    UI.cache = {}; commit(); renderAll(); fit();
  }
  function layoutJSON() {
    return {
      name: S.layout.name, board: S.board,
      terrain: S.terrain.map(function (t) { return { type: t.type, x: t.x, y: t.y, rot: t.rot, mirror: t.mirror, area: t.area, dense: t.dense, obscuring: t.obscuring }; }),
      zones: S.zones.map(function (z) { return { player: z.player, points: z.points }; }),
      objectives: S.objectives.map(function (o) { return { kind: o.kind, x: o.x, y: o.y, area: o.area, label: o.label }; }),
      features: S.features
    };
  }

  // ---------------------------------------------------------------- files
  function download(name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function pickFile(accept, cb) {
    var inp = $('#fileInput'); inp.value = ''; inp.accept = accept || '';
    inp.onchange = function () { if (inp.files[0]) cb(inp.files[0]); };
    inp.click();
  }
  function exportPng() {
    var prev = clone(UI.cam);
    var scale = 20, W = S.board.w, H = S.board.h, pad = 1;
    UI.cam = { x: pad * scale, y: pad * scale, k: scale };
    draw();
    var clone2 = svg.cloneNode(true);
    clone2.setAttribute('width', (W + pad * 2) * scale); clone2.setAttribute('height', (H + pad * 2) * scale);
    clone2.querySelector('#world').setAttribute('transform', 'translate(' + pad * scale + ',' + pad * scale + ') scale(' + scale + ')');
    var css = '<style>text{font-family:system-ui,Segoe UI,Roboto,sans-serif}</style>';
    var str = new XMLSerializer().serializeToString(clone2).replace(/var\(--pa\)/g, S.players.A.color).replace(/var\(--pb\)/g, S.players.B.color).replace('<defs>', css + '<defs>');
    UI.cam = prev; applyCam(); draw();
    var img = new Image();
    img.onload = function () {
      var c = document.createElement('canvas'); c.width = (W + pad * 2) * scale; c.height = (H + pad * 2) * scale;
      var ctx = c.getContext('2d'); ctx.fillStyle = '#1b1d22'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0);
      c.toBlob(function (b) { download((S.layout.name || 'battlefield').replace(/[^\w\- ]+/g, '') + '.png', b); });
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(str);
  }

  // ---------------------------------------------------------------- actions
  function withUnit(fn) { var u = selUnit(); if (u) { fn(u); UI.cache = {}; commit(); renderPanel(); render(); } }
  function withTerr(fn) { var t = UI.sel && terrById(UI.sel.id); if (t) { fn(t); UI.cache = {}; commit(); renderPanel(); render(); } }
  function moveTerrBy(t, dx, dy) { t.x += dx; t.y += dy; }
  function reform(u, rows) {
    var c = G.unitCentre(u), n = u.models.length;
    var perRow = rows === 0 ? Math.ceil(Math.sqrt(n)) : Math.ceil(n / rows);
    var rot = (u.models[0] && u.models[0].rot) || 0;
    u.models = G.formation(n, u.base, c[0], c[1], perRow, rows === 0 ? 0.2 : 0.5, rot);
  }
  var ACTIONS = {
    uName: function (el) { withUnit(function (u) { u.name = el.value; }); },
    uPlayer: function (el) { withUnit(function (u) { u.player = el.value; }); },
    uCount: function (el) {
      withUnit(function (u) {
        var n = Math.max(1, Math.min(60, parseInt(el.value, 10) || 1));
        if (n < u.models.length) u.models = u.models.slice(0, n);
        else { var c = G.unitCentre(u); while (u.models.length < n) { var last = u.models[u.models.length - 1] || { x: c[0], y: c[1] }; u.models.push({ x: last.x + G.mm(u.base.w) + 0.5, y: last.y, rot: last.rot || 0 }); } reform(u, Math.ceil(n / 5)); }
      });
    },
    uM: function (el) { withUnit(function (u) { u.M = num(el.value); }); },
    uBasePreset: function (el) { if (el.value === '') return; withUnit(function (u) { var b = TT.BASE_PRESETS[+el.value]; u.base = { kind: b.kind, w: b.w, h: b.h || b.w }; u.baseSource = 'set manually'; }); },
    uBaseKind: function (el) { withUnit(function (u) { u.base.kind = el.value; if (el.value !== 'round' && !u.base.h) u.base.h = u.base.w; u.baseSource = 'set manually'; }); },
    uBaseW: function (el) { withUnit(function (u) { u.base.w = Math.max(10, num(el.value, 32)); u.baseSource = 'set manually'; }); },
    uBaseH: function (el) { withUnit(function (u) { u.base.h = Math.max(10, num(el.value, 32)); u.baseSource = 'set manually'; }); },
    uSaveBase: function () { var u = selUnit(); if (!u) return; BASELIB[norm(u.name)] = clone(u.base); LS.set('tt.baseLib', BASELIB); toast('Remembered ' + baseLabel(u.base) + ' for “' + u.name + '”'); },
    uInf: function (el) { withUnit(function (u) { u.infantry = el.checked; }); },
    uShot: function (el) { withUnit(function (u) { u.shot = el.checked; }); },
    uPin: function (el) { withUnit(function (u) { u.pin = el.checked; }); },
    uPinT: function (el) { var u = unitById(el.dataset.id); if (u) { u.pin = !u.pin; commit(); renderPanel(); render(); } },
    wName: function (el) { withUnit(function (u) { u.weapons[+el.dataset.i].name = el.value; }); },
    wRange: function (el) { withUnit(function (u) { var w = u.weapons[+el.dataset.i]; if (/melee/i.test(el.value)) { w.melee = true; w.range = 0; } else { w.melee = false; w.range = num(el.value); } }); },
    wAssault: function (el) { withUnit(function (u) { u.weapons[+el.dataset.i].assault = el.checked; }); },
    wDel: function (el) { withUnit(function (u) { u.weapons.splice(+el.dataset.i, 1); }); },
    wAdd: function () { withUnit(function (u) { u.weapons.push({ name: 'Ranged weapon', range: 24, melee: false, assault: false }); }); },
    wAddMelee: function () { withUnit(function (u) { u.weapons.push({ name: 'Melee weapon', range: 0, melee: true }); }); },
    form: function (el) { withUnit(function (u) { reform(u, +el.dataset.n); }); },
    uRot: function (el) {
      withUnit(function (u) {
        var c = G.unitCentre(u), a = G.rad(+el.dataset.d), cs = Math.cos(a), sn = Math.sin(a);
        u.models.forEach(function (m) { var dx = m.x - c[0], dy = m.y - c[1]; m.x = c[0] + dx * cs - dy * sn; m.y = c[1] + dx * sn + dy * cs; m.rot = ((m.rot || 0) + (+el.dataset.d) + 360) % 360; });
      });
    },
    uDup: function () { var u = selUnit(); if (!u) return; var c = clone(u); c.id = uid(); c.models.forEach(function (m) { m.x += 3; m.y += 3; }); S.units.push(c); UI.cache = {}; commit(); select('unit', c.id); },
    uFocus: function () { var u = selUnit(); if (!u) return; var c = G.unitCentre(u), r = svg.getBoundingClientRect(); UI.cam.x = r.width / 2 - c[0] * UI.cam.k; UI.cam.y = r.height / 2 - c[1] * UI.cam.k; applyCam(); render(); },
    uDel: function () { var u = selUnit(); if (!u) return; S.units = S.units.filter(function (x) { return x !== u; }); UI.sel = null; UI.cache = {}; commit(); renderAll(); },
    selUnit: function (el) { select('unit', el.dataset.id); },

    tX: function (el) { withTerr(function (t) { t.x = num(el.value, t.x); }); },
    tY: function (el) { withTerr(function (t) { t.y = num(el.value, t.y); }); },
    tL: function (el) { withTerr(function (t) { moveTerrBy(t, num(el.value) - terrainEdges(t).minX, 0); }); },
    tR: function (el) { withTerr(function (t) { moveTerrBy(t, (S.board.w - num(el.value)) - terrainEdges(t).maxX, 0); }); },
    tT: function (el) { withTerr(function (t) { moveTerrBy(t, 0, num(el.value) - terrainEdges(t).minY); }); },
    tB: function (el) { withTerr(function (t) { moveTerrBy(t, 0, (S.board.h - num(el.value)) - terrainEdges(t).maxY); }); },
    tRot: function (el) { withTerr(function (t) { t.rot = ((num(el.value) % 360) + 360) % 360; }); },
    tRotBy: function (el) { withTerr(function (t) { t.rot = (((t.rot || 0) + (+el.dataset.d)) % 360 + 360) % 360; }); },
    tMirror: function (el) { withTerr(function (t) { t.mirror = el.checked; }); },
    tObs: function (el) { withTerr(function (t) { t.obscuring = el.checked; }); },
    tDense: function (el) { withTerr(function (t) { t.dense = el.checked; }); },
    tArea: function (el) { withTerr(function (t) { t.area = Math.max(1, parseInt(el.value, 10) || t.area); }); },
    tDup: function () { var t = UI.sel && terrById(UI.sel.id); if (!t) return; var c = clone(t); c.id = uid(); c.x += 2; c.y += 2; c.area = nextAreaId(); S.terrain.push(c); UI.cache = {}; commit(); select('terrain', c.id); },
    tDel: function () { var t = UI.sel && terrById(UI.sel.id); if (!t) return; S.terrain = S.terrain.filter(function (x) { return x !== t; }); S.objectives.forEach(function (o) { o.area = areaAt([o.x, o.y]); }); UI.sel = null; UI.cache = {}; commit(); renderAll(); },

    oKind: function (el) { var o = UI.sel && objById(UI.sel.id); if (o) { o.kind = el.value; commit(); render(); } },
    oLabel: function (el) { var o = UI.sel && objById(UI.sel.id); if (o) { o.label = el.value; commit(); } },
    oX: function (el) { var o = UI.sel && objById(UI.sel.id); if (o) { o.x = num(el.value, o.x); o.area = areaAt([o.x, o.y]); commit(); renderPanel(); render(); } },
    oY: function (el) { var o = UI.sel && objById(UI.sel.id); if (o) { o.y = num(el.value, o.y); o.area = areaAt([o.x, o.y]); commit(); renderPanel(); render(); } },
    oDel: function () { var o = UI.sel && objById(UI.sel.id); if (!o) return; S.objectives = S.objectives.filter(function (x) { return x !== o; }); UI.sel = null; commit(); renderAll(); },
    zPlayer: function (el) { var z = UI.sel && zoneById(UI.sel.id); if (z) { z.player = el.value; commit(); render(); } },
    zPts: function (el) {
      var z = UI.sel && zoneById(UI.sel.id); if (!z) return;
      var pts = el.value.split(/\n+/).map(function (l) { var m = l.split(/[,\s]+/).map(parseFloat); return m.length >= 2 && !isNaN(m[0]) && !isNaN(m[1]) ? [m[0], m[1]] : null; }).filter(Boolean);
      if (pts.length >= 3) { z.points = pts; commit(); render(); } else toast('A zone needs at least 3 points');
    },
    zDel: function () { var z = UI.sel && zoneById(UI.sel.id); if (!z) return; S.zones = S.zones.filter(function (x) { return x !== z; }); UI.sel = null; commit(); renderAll(); },

    pName: function (el) { S.players[el.dataset.p].name = el.value; commit(); renderPanel(); hud(); },
    pColor: function (el) { S.players[el.dataset.p].color = el.value; commit(); render(); },
    addUnit: function (el) {
      var p = el.dataset.p, u = makeUnit(p, { name: 'New unit', count: 5 });
      var z = S.zones.find(function (q) { return q.player === p; });
      var c = z ? G.centroid(z.points) : [S.board.w / 2, p === 'A' ? 6 : S.board.h - 6];
      placeUnit(u, c[0], c[1]); S.units.push(u); UI.cache = {}; commit(); select('unit', u.id);
    },
    importFile: function (el) {
      var p = el.dataset.p;
      pickFile('.ros,.rosz,.json,.txt,.xml', function (f) {
        TT.importers.parseAny(f).then(function (r) { importUnits(p, r); }).catch(function (e) { toast('Import failed: ' + e.message); });
      });
    },
    importPaste: function () {
      var t = $('#impText').value, p = $('#impPlayer').value;
      if (!t.trim()) { toast('Paste a list first'); return; }
      try { importUnits(p, TT.importers.parseString(t)); } catch (e) { toast('Import failed: ' + e.message); }
    },
    ysFetch: function () {
      var code = $('#ysCode').value, p = $('#impPlayer').value; if (!code.trim()) return;
      toast('Fetching from Yellowscribe…');
      TT.importers.fetchYellowscribe(code).then(function (r) { importUnits(p, r); }).catch(function () {
        toast('Your browser blocked the direct fetch — use Open JSON, copy the page and paste it into the box.');
      });
    },
    ysOpen: function () { var code = $('#ysCode').value; if (code.trim()) window.open(TT.importers.yellowscribeUrl(code), '_blank'); },
    deployAll: function (el) {
      var p = el.dataset.p; var y = 2, x = p === 'A' ? -9 : S.board.w + 9;
      S.units.filter(function (u) { return u.player === p; }).forEach(function (u) {
        var n = u.models.length; u.models = G.formation(n, u.base, x, 0, Math.min(5, n), 0.5, 0);
        var bb = G.bbox(u.models.map(function (m) { return [m.x, m.y]; }));
        var dy = y - bb.minY + 0.5; u.models.forEach(function (m) { m.y += dy; }); y = bb.maxY + dy + 2.5;
      });
      UI.cache = {}; commit(); renderAll(); fit();
    },
    clearArmy: function (el) { var p = el.dataset.p; dialog('Remove all units for ' + S.players[p].name + '?', { ok: 'Remove' }).then(function (ok) { if (!ok) return; S.units = S.units.filter(function (u) { return u.player !== p; }); UI.sel = null; UI.cache = {}; commit(); renderAll(); }); },

    loadLayout: function () {
      var v = $('#layoutSel').value;
      if (v === 'blank') return loadLayout(TT.LAYOUTS[0]);
      if (v.indexOf('off:') === 0) { var L = (TT.OFFICIAL_LAYOUTS || []).find(function (l) { return l.id === v.slice(4); }); if (L) loadLayout(L, true); return; }
      if (v.indexOf('my:') === 0) { var M = MYLAYOUTS[+v.slice(3)]; if (M) loadLayout(M); }
    },
    rotateBoard: function () { rotateBoard(); },
    addFoot: function (el) {
      unlockForEdit();
      var k = el.dataset.t, r = svg.getBoundingClientRect();
      var c = screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
      var t = { id: uid(), type: k, x: snapv(Math.min(Math.max(c[0], 6), S.board.w - 6)), y: snapv(Math.min(Math.max(c[1], 6), S.board.h - 6)), rot: 0, mirror: false, area: nextAreaId(), dense: true, obscuring: TT.FOOTPRINTS[k].obscuring };
      S.terrain.push(t); UI.cache = {}; commit(); select('terrain', t.id);
    },
    addObj: function (el) {
      unlockForEdit();
      var o = { id: uid(), kind: el.dataset.k, x: S.board.w / 2, y: S.board.h / 2, area: null, label: '' };
      o.area = areaAt([o.x, o.y]); S.objectives.push(o); commit(); select('obj', o.id);
    },
    applyZones: function () { applyZonePreset($('#zonePreset').value); commit(); render(); },
    addZone: function () { unlockForEdit(); var z = { id: uid(), player: 'A', points: [[0, 0], [S.board.w, 0], [S.board.w, 12], [0, 12]] }; S.zones.push(z); commit(); select('zone', z.id); },
    applyBoard: function () { var b = TT.BOARD_PRESETS.find(function (x) { return x.id === $('#boardPreset').value; }); if (b) { S.board = { w: b.w, h: b.h }; commit(); renderAll(); fit(); } },
    boardW: function (el) { S.board.w = Math.max(10, num(el.value, 44)); commit(); render(); fit(); },
    boardH: function (el) { S.board.h = Math.max(10, num(el.value, 60)); commit(); render(); fit(); },
    saveLayout: function () {
      dialog('Name for this layout', { input: S.layout.name + ' (mine)', ok: 'Save' }).then(function (name) {
        if (!name) return;
        var L = layoutJSON(); L.name = name; L.id = 'my-' + uid(); MYLAYOUTS.push(L); LS.set('tt.layouts', MYLAYOUTS); S.layout = { id: L.id, name: name }; commit(); renderPanel(); toast('Saved “' + name + '”');
      });
    },
    delMyLayout: function () {
      var v = $('#layoutSel').value; if (v.indexOf('my:') !== 0) { toast('Select one of “My layouts” first'); return; }
      MYLAYOUTS.splice(+v.slice(3), 1); LS.set('tt.layouts', MYLAYOUTS); renderPanel();
    },
    exportLayout: function () { download((S.layout.name || 'layout').replace(/[^\w\- ]+/g, '') + '.layout.json', JSON.stringify(layoutJSON(), null, 1)); },
    importLayout: function () {
      pickFile('.json', function (f) { f.text().then(function (t) { try { var L = JSON.parse(t); loadLayout(L); } catch (e) { toast('Not a layout file'); } }); });
    },
    clearTerrain: function () { dialog('Remove all terrain, objectives and zones?', { ok: 'Remove' }).then(function (ok) { if (!ok) return; S.terrain = []; S.objectives = []; S.features = []; S.zones = []; S.layout = { id: 'custom', name: 'Custom layout' }; UI.sel = null; UI.cache = {}; commit(); renderAll(); }); },

    viewChk: function (el) { var path = el.dataset.path.split('.'), o = S.view; while (path.length > 1) o = o[path.shift()]; o[path[0]] = el.checked; if (el.dataset.path === 'lockLayout') { if (UI.sel && UI.sel.kind === 'zone') UI.sel = null; toast(el.checked ? 'Layout locked' : 'Layout unlocked — terrain, objectives and zones can be moved'); } commit(); render(); },
    viewSel: function (el) { S.view[el.dataset.path] = el.value; commit(); render(); },
    ruleSel: function (el) { S.rules[el.dataset.path] = el.value; UI.cache = {}; commit(); render(); renderPanel(); },
    ruleNum: function (el) { S.rules[el.dataset.path] = num(el.value, S.rules[el.dataset.path]); UI.cache = {}; commit(); render(); },

    saveScenario: function () { download((S.layout.name || 'scenario').replace(/[^\w\- ]+/g, '') + '.scenario.json', JSON.stringify(S)); },
    loadScenario: function () {
      pickFile('.json', function (f) {
        f.text().then(function (t) {
          try { var o = JSON.parse(t); if (!o.board || !o.units) throw new Error('x'); var d = defaultState(); o.view = Object.assign(d.view, o.view || {}); o.rules = Object.assign(d.rules, o.rules || {}); o.v = 2; S = o; UI.sel = null; UI.cache = {}; commit(); renderAll(); fit(); toast('Scenario loaded'); }
          catch (e) { toast('Not a scenario file'); }
        });
      });
    },
    exportPng: function () { exportPng(); },
    setOverlay: function (el) { S.view.overlay = el.dataset.v; commit(); renderPanel(); render(); },
    setLaneBasis: function (el) { S.view.laneBasis = el.dataset.v; commit(); renderPanel(); render(); },
    copyScenario: function () {
      try { navigator.clipboard.writeText(JSON.stringify(S)).then(function () { toast('Scenario copied — paste it into a .json file to keep it'); }, function () { toast('Clipboard blocked by this browser'); }); }
      catch (e) { toast('Clipboard blocked by this browser'); }
    },
    newScenario: function () { dialog('Start a new scenario? The current one is replaced (you can undo).', { ok: 'Start new' }).then(function (ok) { if (!ok) return; S = defaultState(); UI.sel = null; UI.cache = {}; commit(); renderAll(); fit(); }); },
    libDel: function (el) { delete BASELIB[el.dataset.k]; LS.set('tt.baseLib', BASELIB); renderPanel(); }
  };
  function unlockForEdit() { if (S.view.lockLayout) { S.view.lockLayout = false; toast('Layout unlocked for editing — re-lock it in the Layout tab'); } }
  // In-page dialog (browser confirm/prompt are blocked in some embedded viewers)
  function dialog(msg, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var d = document.createElement('div'); d.className = 'modal';
      d.innerHTML = '<div class="box"><p>' + esc(msg) + '</p>' + (opts.input != null ? '<input class="full" value="' + esc(opts.input) + '">' : '') +
        '<div class="row"><span class="grow"></span><button type="button" data-r="0">Cancel</button><button type="button" class="on" data-r="1">' + esc(opts.ok || 'OK') + '</button></div></div>';
      document.body.appendChild(d);
      var inp = d.querySelector('input'); if (inp) { inp.focus(); inp.select(); }
      var done = function (ok) { var v = inp ? inp.value : true; d.remove(); resolve(ok ? v : null); };
      d.addEventListener('click', function (e) { var r = e.target.getAttribute('data-r'); if (r != null) done(r === '1'); else if (e.target === d) done(false); });
      d.addEventListener('keydown', function (e) { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    });
  }

  // ---------------------------------------------------------------- misc UI
  var toastT;
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('on'); }, 3500); }
  function renderAll() { renderPanel(); render(); }

  function onKey(e) {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    var k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
    if (k === 'Escape') { UI.measure = null; select(null); return; }
    if (k === '+' || k === '=') { var r = svg.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25); }
    if (k === '-') { var r2 = svg.getBoundingClientRect(); zoomAt(r2.left + r2.width / 2, r2.top + r2.height / 2, 0.8); }
    if (k === '0') fit();
    if (k === 'm' || k === 'M') setTool(UI.tool === 'measure' ? 'select' : 'measure');
    if (k === 'v' || k === 'V') setTool('select');
    if (k === 'g' || k === 'G') toggleModelMode();
    if (k === 'l' || k === 'L') { S.view.labels = !S.view.labels; commit(); render(); }
    if (k === 'r' || k === 'R') {
      var d = e.shiftKey ? -15 : 15;
      if (UI.sel && UI.sel.kind === 'terrain') ACTIONS.tRotBy({ dataset: { d: d } });
      if (UI.sel && UI.sel.kind === 'unit') ACTIONS.uRot({ dataset: { d: d } });
    }
    if (k === 'Delete' || k === 'Backspace') {
      if (!UI.sel) return;
      e.preventDefault();
      ({ unit: ACTIONS.uDel, terrain: ACTIONS.tDel, obj: ACTIONS.oDel, zone: ACTIONS.zDel })[UI.sel.kind]();
    }
    if (k === 'd' && UI.sel) { if (UI.sel.kind === 'unit') ACTIONS.uDup(); if (UI.sel.kind === 'terrain') ACTIONS.tDup(); }
  }
  function setTool(t) {
    UI.tool = t; if (t !== 'measure') UI.measure = null;
    $$('[data-tool]').forEach(function (b) { b.classList.toggle('on', b.dataset.tool === t); });
    svg.style.cursor = t === 'measure' ? 'crosshair' : '';
    render();
  }
  function toggleModelMode() { UI.modelMode = !UI.modelMode; var b = $('#btnModelMode'); b.textContent = UI.modelMode ? 'Model drag' : 'Unit drag'; b.classList.toggle('on', UI.modelMode); hud(); }

  // ---------------------------------------------------------------- init
  function init() {
    svg = $('#svg'); world = $('#world'); stage = $('#stage');
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    svg.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    svg.addEventListener('wheel', function (e) { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', function () { render(); });
    $$('.tabs button').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); document.body.classList.add('panel-open'); }); });
    $$('[data-tool]').forEach(function (b) { b.addEventListener('click', function () { setTool(b.dataset.tool); }); });
    $('#btnModelMode').addEventListener('click', toggleModelMode);
    $('#btnZoomIn').addEventListener('click', function () { var r = svg.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25); });
    $('#btnZoomOut').addEventListener('click', function () { var r = svg.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 0.8); });
    $('#btnFit').addEventListener('click', fit);
    $('#btnUndo').addEventListener('click', doUndo);
    $('#btnRedo').addEventListener('click', doRedo);
    $('#btnPanel').addEventListener('click', function () { document.body.classList.toggle('panel-open'); });
    // first run: load the first official layout so there's something to look at
    if (!S.terrain.length && !S.units.length && TT.OFFICIAL_LAYOUTS && TT.OFFICIAL_LAYOUTS.length && !LS.get('tt.seen', false)) {
      LS.set('tt.seen', true);
      loadLayout(TT.OFFICIAL_LAYOUTS[0], true);
      demoUnits();
    }
    renderAll();
    setTimeout(fit, 30);
  }
  function demoUnits() {
    var a = makeUnit('A', { name: 'Intercessor Squad', count: 5, M: 6, keywords: ['Infantry'], weapons: [{ name: 'Bolt rifle', range: 24, melee: false, assault: true }, { name: 'Close combat weapon', range: 0, melee: true }] });
    placeUnit(a, 12, 14); S.units.push(a);
    var b = makeUnit('B', { name: 'Boyz', count: 10, M: 6, keywords: ['Infantry'], weapons: [{ name: 'Slugga', range: 12, melee: false, pistol: true }, { name: 'Choppa', range: 0, melee: true }] });
    placeUnit(b, 30, 46); S.units.push(b);
    UI.cache = {}; commit();
  }
  TT.app = { computeLanes: computeLanes, computeDanger: computeDanger, state: function () { return S; }, ui: UI, actions: ACTIONS, analyse: analyse, visibility: visibility, lookupBase: lookupBase, select: select, loadLayout: loadLayout, fit: fit, importUnits: importUnits };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.TT = window.TT || {});
