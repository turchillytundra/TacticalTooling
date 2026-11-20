// Run: node tests/geometry.test.js
global.window = {};
const fs = require('fs'), path = require('path'), assert = require('assert');
for (const f of ['data', 'geometry', 'layouts-official']) eval(fs.readFileSync(path.join(__dirname, '..', 'js', f + '.js'), 'utf8'));
const TT = window.TT, G = TT.geo;
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const near = (a, b, e = 1e-6) => assert(Math.abs(a - b) < e, a + ' != ' + b);

t('polyArea is positive for anticlockwise (maths) order and orientation-independent for clipping', () => {
  near(G.polyArea([[0, 0], [1, 0], [1, 1], [0, 1]]), 1);
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];
  assert.deepStrictEqual(G.clipConvex([-1, 0.5], [2, 0.5], sq, 0, 1).map(v => +v.toFixed(4)), [0.3333, 0.6667]);
  assert.deepStrictEqual(G.clipConvex([-1, 0.5], [2, 0.5], sq.slice().reverse(), 0, 1).map(v => +v.toFixed(4)), [0.3333, 0.6667]);
  assert.strictEqual(G.clipConvex([-1, 2], [2, 2], sq, 0, 1), null);
});
t('a line crossing an obscuring footprint is blocked; one passing beside it is not', () => {
  const P = G.terrainPolygon({ type: 'large', x: 22, y: 30, rot: 0 });
  assert(G.segmentBlocked([22, 20], [22, 40], [P]));
  assert(!G.segmentBlocked([10, 20], [10, 40], [P]));
});
t('footprint sizes match the 11th edition terrain area set', () => {
  for (const [k, w, h] of [['large', 11.5, 7], ['tri', 11.5, 8], ['medium', 6, 4], ['long', 10, 2.5], ['short', 6, 2]]) {
    const b = G.bbox(G.terrainPolygon({ type: k, x: 0, y: 0, rot: 0 }));
    near(b.maxX - b.minX, w); near(b.maxY - b.minY, h);
  }
  // two polygons rotated 180° tile an 11.5" x 10" area
  const a = G.terrainPolygon({ type: 'tri', x: 22, y: 31, rot: 0 }), b = G.terrainPolygon({ type: 'tri', x: 22, y: 29, rot: 180 });
  near(Math.abs(G.polyArea(a)) + Math.abs(G.polyArea(b)), 115);
});
t('base-to-base distance and 2D6 odds', () => {
  near(G.baseDist({ x: 0, y: 0 }, { kind: 'round', w: 25.4 }, { x: 3, y: 0 }, { kind: 'round', w: 25.4 }), 2);
  near(G.p2d6AtLeast(7), 21 / 36); near(G.p2d6AtLeast(2), 1); near(G.p2d6AtLeast(12.1), 0);
});
t('all 45 official layouts have 16 footprints on a 44x60 battlefield, two zones and objectives', () => {
  assert.strictEqual(TT.OFFICIAL_LAYOUTS.length, 45);
  TT.OFFICIAL_LAYOUTS.forEach(L => {
    assert.strictEqual(L.terrain.length, 16, L.id);
    assert.strictEqual(L.zones.length, 2, L.id);
    assert(L.objectives.length >= 4, L.id);
    L.terrain.forEach(tt => { assert(tt.x > 0 && tt.x < 44 && tt.y > 0 && tt.y < 60, L.id); });
  });
});
console.log(n + ' tests passed');
