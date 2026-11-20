/* TacticalTooling — army list importers.
   Supported: BattleScribe / New Recruit roster files (.ros, .rosz) — the same files Yellowscribe consumes,
   Yellowscribe army JSON (from yellowscribe.xyz/get_army_by_id?id=CODE), New Recruit JSON export,
   and plain-text exports (Warhammer 40,000 app / New Recruit text). */
(function (TT) {
  'use strict';
  var I = TT.importers = {};

  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/[^\d.\-]/g, '')); return isNaN(n) ? 0 : n; }
  function isMeleeRange(r) { return /melee/i.test(String(r)); }

  function normWeapon(name, range, extra) {
    var melee = isMeleeRange(range);
    extra = String(extra || '');
    return {
      name: name,
      range: melee ? 0 : num(range),
      melee: melee,
      assault: /assault/i.test(extra),
      pistol: /pistol/i.test(extra)
    };
  }

  function dedupeWeapons(ws) {
    var seen = {}, out = [];
    ws.forEach(function (w) {
      var k = w.name + '|' + w.range + '|' + w.melee;
      if (!seen[k]) { seen[k] = 1; out.push(w); }
    });
    return out;
  }

  // ---- ZIP (.rosz) --------------------------------------------------------
  I.unzipFirst = async function (buf) {
    var dv = new DataView(buf), u8 = new Uint8Array(buf);
    // find End Of Central Directory
    var eocd = -1;
    for (var i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a zip file');
    var cdOff = dv.getUint32(eocd + 16, true);
    if (dv.getUint32(cdOff, true) !== 0x02014b50) throw new Error('Bad zip directory');
    var method = dv.getUint16(cdOff + 10, true);
    var csize = dv.getUint32(cdOff + 20, true);
    var lho = dv.getUint32(cdOff + 42, true);
    var nameLen = dv.getUint16(lho + 26, true), extraLen = dv.getUint16(lho + 28, true);
    var start = lho + 30 + nameLen + extraLen;
    var data = u8.slice(start, start + csize);
    if (method === 0) return new TextDecoder().decode(data);
    if (method !== 8) throw new Error('Unsupported zip compression');
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unzip .rosz — save as .ros instead');
    var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  };

  // ---- Generic BattleScribe-like tree (XML or New Recruit JSON) -----------
  // node API: name, type, number, children (selections), profiles [{typeName, chars:{}}], categories [names], cost
  function walkUnits(forces) {
    var units = [];
    forces.forEach(function (force) {
      force.selections.forEach(function (sel) { collect(sel, units, force.name); });
    });
    return units;
  }
  function collect(sel, out, forceName) {
    var t = (sel.type || '').toLowerCase();
    if (t === 'unit' || t === 'model') {
      out.push(buildUnit(sel, forceName));
      return;
    }
    // upgrade wrappers (e.g. detachment / configuration) — look inside for units
    sel.children.forEach(function (c) { collect(c, out, forceName); });
  }
  function allDesc(sel, fn) { fn(sel); sel.children.forEach(function (c) { allDesc(c, fn); }); }
  function buildUnit(sel, forceName) {
    var models = 0, M = 0, weapons = [], keywords = [], pts = 0, profileM = {};
    var hasModelChild = false;
    sel.children.forEach(function (c) { allDesc(c, function (n) { if ((n.type || '').toLowerCase() === 'model') hasModelChild = true; }); });
    allDesc(sel, function (n) {
      pts += n.cost || 0;
      if (n !== sel && (n.type || '').toLowerCase() === 'model') models += n.number || 1;
      n.profiles.forEach(function (p) {
        var tn = (p.typeName || '').toLowerCase();
        if (tn === 'unit' || tn === 'model') {
          var m = num(p.chars.M || p.chars.Move || p.chars.m);
          if (m) { profileM[p.name] = m; if (!M || m < M) M = m; }
        } else if (tn.indexOf('ranged') >= 0) {
          weapons.push(normWeapon(p.name, p.chars.Range || p.chars.range, p.chars.Keywords || p.chars.Abilities || ''));
        } else if (tn.indexOf('melee') >= 0) {
          weapons.push(normWeapon(p.name, 'Melee', p.chars.Keywords || ''));
        } else if (tn === 'weapon' || tn === 'weapons') {
          // older (9th edition) data: one profile type with Range and Type (e.g. "Assault 2", "Melee")
          var type = p.chars.Type || '';
          var rng = /melee/i.test(type) ? 'Melee' : (p.chars.Range || '');
          weapons.push(normWeapon(p.name, rng, type + ' ' + (p.chars.Abilities || '')));
        }
      });
    });
    sel.categories.forEach(function (c) { keywords.push(c); });
    if (!hasModelChild) models = sel.number || 1;
    return {
      name: sel.customName || sel.name, count: Math.max(1, models), M: M, weapons: dedupeWeapons(weapons),
      keywords: keywords, points: pts, force: forceName
    };
  }

  function xmlToTree(xmlText) {
    var doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Could not read roster XML');
    var kids = function (el, name) { return Array.prototype.filter.call(el.children || [], function (c) { return c.localName === name; }); };
    var first = function (el, name) { return kids(el, name)[0]; };
    var node = function (el) {
      var profiles = [];
      var ps = first(el, 'profiles');
      if (ps) kids(ps, 'profile').forEach(function (p) {
        var chars = {};
        var cs = first(p, 'characteristics');
        if (cs) kids(cs, 'characteristic').forEach(function (c) { chars[c.getAttribute('name')] = (c.textContent || '').trim(); });
        profiles.push({ name: p.getAttribute('name'), typeName: p.getAttribute('typeName') || '', chars: chars });
      });
      var cats = [];
      var cg = first(el, 'categories');
      if (cg) kids(cg, 'category').forEach(function (c) { cats.push(c.getAttribute('name')); });
      var cost = 0;
      var co = first(el, 'costs');
      if (co) kids(co, 'cost').forEach(function (c) { if (/pts|points/i.test(c.getAttribute('name') || '')) cost += num(c.getAttribute('value')); });
      var sels = first(el, 'selections');
      return {
        name: el.getAttribute('name'), customName: el.getAttribute('customName'), type: el.getAttribute('type'),
        number: parseInt(el.getAttribute('number') || '1', 10), profiles: profiles, categories: cats, cost: cost,
        children: sels ? kids(sels, 'selection').map(node) : []
      };
    };
    var roster = doc.documentElement;
    var forces = [];
    var addForces = function (el) {
      var fs = first(el, 'forces'); if (!fs) return;
      kids(fs, 'force').forEach(function (f) {
        var sels = first(f, 'selections');
        forces.push({ name: f.getAttribute('name') || f.getAttribute('catalogueName'), selections: sels ? kids(sels, 'selection').map(node) : [] });
        addForces(f);
      });
    };
    addForces(roster);
    return { name: roster.getAttribute('name') || 'Imported roster', forces: forces };
  }

  function jsonToTree(r) {
    var txt = function (c) { return c.$text != null ? c.$text : (c['#text'] != null ? c['#text'] : (c.value != null ? c.value : '')); };
    var node = function (s) {
      return {
        name: s.name, customName: s.customName, type: s.type, number: s.number || 1,
        profiles: (s.profiles || []).map(function (p) {
          var chars = {}; (p.characteristics || []).forEach(function (c) { chars[c.name] = String(txt(c)).trim(); });
          return { name: p.name, typeName: p.typeName || '', chars: chars };
        }),
        categories: (s.categories || []).map(function (c) { return c.name; }),
        cost: (s.costs || []).reduce(function (a, c) { return a + (/pts|points/i.test(c.name || '') ? num(c.value) : 0); }, 0),
        children: (s.selections || []).map(node)
      };
    };
    var forces = [];
    var addForces = function (list) {
      (list || []).forEach(function (f) { forces.push({ name: f.name || f.catalogueName, selections: (f.selections || []).map(node) }); addForces(f.forces); });
    };
    addForces(r.forces);
    return { name: r.name || 'Imported roster', forces: forces };
  }

  // ---- Yellowscribe army JSON --------------------------------------------
  I.parseYellowscribe = function (obj) {
    var unitsObj = obj.armyData || obj.units || obj;
    if (unitsObj.units && !unitsObj.name) unitsObj = unitsObj.units;
    var order = obj.order && obj.order.length ? obj.order : Object.keys(unitsObj);
    var units = [];
    order.forEach(function (k) {
      var u = unitsObj[k]; if (!u || !u.name) return;
      var count = (u.models && u.models.totalNumberOfModels) || 0;
      if (!count && u.models && u.models.models) {
        Object.keys(u.models.models).forEach(function (mk) { count += u.models.models[mk].number || 1; });
      }
      var M = 0;
      Object.keys(u.modelProfiles || {}).forEach(function (pk) {
        var m = num(u.modelProfiles[pk].m); if (m && (!M || m < M)) M = m;
      });
      var weapons = Object.keys(u.weapons || {}).map(function (wk) {
        var w = u.weapons[wk];
        return normWeapon(w.name || wk, w.range, (w.abilities || '') + ' ' + (w.type || ''));
      });
      units.push({ name: u.name, count: Math.max(1, count), M: M, weapons: dedupeWeapons(weapons), keywords: (u.keywords || []).concat(u.factionKeywords || []), points: u.pl || 0 });
    });
    return { name: 'Yellowscribe army', units: units, source: 'Yellowscribe' };
  };

  // ---- Plain text ---------------------------------------------------------
  I.parseText = function (text) {
    var lines = text.replace(/\r/g, '').split('\n');
    var units = [], cur = null;
    var header = /^\s*(?:[A-Za-z]+\d*:\s*)?(.+?)\s*[\(\[]\s*(\d+)\s*(?:points|pts|pt)\s*[\)\]]\s*$/i;
    var countLine = /^\s*[•\-\*·]?\s*(\d+)\s*x\s+(.+?)\s*$/i;
    lines.forEach(function (raw) {
      var line = raw.replace(/\t/g, '    ');
      if (!line.trim()) return;
      var h = line.match(header);
      if (h && !/^\s*[◦]/.test(line) && !/detachment|strike force|incursion|onslaught|combat patrol|total|^\s*\+/i.test(h[1])) {
        cur = { name: h[1].replace(/^\s*[•\-\*]\s*/, '').trim(), count: 0, M: 0, weapons: [], keywords: [], points: parseInt(h[2], 10), bullets: [] };
        units.push(cur); return;
      }
      if (!cur) return;
      // Warhammer 40,000 app: "• 4x Intercessor" (model) then "◦ 4x Bolt rifle" (its wargear).
      if (/^\s*[◦]/.test(line)) { if (cur.bullets.length) cur.bullets[cur.bullets.length - 1].kids++; return; }
      var c = line.match(countLine);
      if (/^\s*[•]/.test(line)) cur.bullets.push({ n: c ? parseInt(c[1], 10) : 0, kids: 0 });
    });
    units.forEach(function (u) {
      // bullets with wargear children are models; otherwise it's a single model listing its wargear
      var models = u.bullets.filter(function (b) { return b.kids > 0 && b.n > 0; });
      u.count = models.length ? models.reduce(function (a, b) { return a + b.n; }, 0) : 1;
      delete u.bullets;
    });
    return { name: 'Text list', units: units, source: 'Text' };
  };

  // ---- Entry points -------------------------------------------------------
  I.parseRosterXML = function (xmlText) {
    var tree = xmlToTree(xmlText);
    return { name: tree.name, units: walkUnits(tree.forces), source: 'BattleScribe/New Recruit' };
  };

  I.parseAny = async function (file) {
    var name = (file.name || '').toLowerCase();
    if (name.endsWith('.rosz')) {
      var xml = await I.unzipFirst(await file.arrayBuffer());
      return I.parseRosterXML(xml);
    }
    var text = await file.text();
    return I.parseString(text);
  };

  I.parseString = function (text) {
    var t = text.trim();
    if (t[0] === '<') return I.parseRosterXML(t);
    if (t[0] === '{' || t[0] === '[') {
      var obj = JSON.parse(t);
      if (obj.err) throw new Error('Yellowscribe says: ' + obj.err + ' (codes expire after about 10 minutes)');
      if (obj.roster && obj.roster.forces) {
        var tree = jsonToTree(obj.roster);
        return { name: tree.name, units: walkUnits(tree.forces), source: 'New Recruit JSON' };
      }
      if (obj.forces) { var tr = jsonToTree(obj); return { name: tr.name, units: walkUnits(tr.forces), source: 'Roster JSON' }; }
      return I.parseYellowscribe(obj);
    }
    return I.parseText(t);
  };

  // Yellowscribe codes: the service doesn't allow cross-site requests, so we try, then fall back
  // to opening the JSON in a new tab for the user to copy/paste.
  I.yellowscribeUrl = function (code) {
    return 'https://yellowscribe.xyz/get_army_by_id?id=' + encodeURIComponent(code.trim());
  };
  I.fetchYellowscribe = async function (code) {
    var res = await fetch(I.yellowscribeUrl(code));
    if (!res.ok) throw new Error('Yellowscribe returned ' + res.status);
    return I.parseString(await res.text());
  };

})(window.TT = window.TT || {});
