/* TacticalTooling — static data: battlefield, 11th edition terrain footprints, rules figures, bases, layouts. */
(function (TT) {
  'use strict';

  TT.MM_PER_INCH = 25.4;

  // Standard matched-play battlefield (Event Companion: 44" x 60").
  TT.BOARD_PRESETS = [
    { id: 'strike', name: 'Strike Force 44" × 60" (portrait, as in the Event Companion)', w: 44, h: 60 },
    { id: 'strike-l', name: 'Strike Force 60" × 44" (landscape)', w: 60, h: 44 },
    { id: 'incursion', name: 'Incursion / Combat Patrol 44" × 30"', w: 44, h: 30 }
  ];

  // 11th edition terrain area set: 16 footprints across 5 shapes (Event Companion terrain area set).
  // w = long side (x before rotation), h = short side. 'tri' is the 8" × 11.5" right-angled polygon.
  TT.FOOTPRINTS = {
    large:  { name: 'Large rectangle', w: 11.5, h: 7,   shape: 'rect', count: 4, obscuring: true },
    tri:    { name: 'Polygon 8" × 11.5"', w: 11.5, h: 8,   shape: 'tri',  count: 2, obscuring: true },
    medium: { name: 'Medium rectangle', w: 6,   h: 4,   shape: 'rect', count: 4, obscuring: true },
    long:   { name: 'Long line',       w: 10,   h: 2.5, shape: 'rect', count: 2, obscuring: true },
    short:  { name: 'Short line',      w: 6,    h: 2,   shape: 'rect', count: 4, obscuring: true }
  };
  TT.FOOTPRINT_ORDER = ['large', 'tri', 'medium', 'long', 'short'];

  // 11th edition core figures used by the analysis. All editable in Settings.
  TT.DEFAULT_RULES = {
    engagementRange: 2,      // 11th: engagement range is 2"
    maxChargeTargetDistance: 12,
    chargeMode: 'max',       // 'max' (12"), 'avg' (7"), 'custom'
    chargeCustom: 9,
    advanceMode: 'avg',      // Advance = M + D6 → 'max' (6), 'avg' (3.5), 'none'
    deepStrikeDistance: 8,   // 11th: set up more than 8" from enemy models
    hiddenDetection: 15,     // Core Rules 13.09: a hidden model's detection range is 15"
    objectiveControl: 3,     // ring shown around objectives that are NOT terrain areas (set to your mission's value)
    pileIn: 3
  };

  // Common base sizes (mm). Round bases are diameters; ovals are length × width.
  TT.BASE_PRESETS = [
    { label: '25mm round', kind: 'round', w: 25 },
    { label: '28.5mm round', kind: 'round', w: 28.5 },
    { label: '32mm round', kind: 'round', w: 32 },
    { label: '40mm round', kind: 'round', w: 40 },
    { label: '50mm round', kind: 'round', w: 50 },
    { label: '60mm round', kind: 'round', w: 60 },
    { label: '80mm round', kind: 'round', w: 80 },
    { label: '90mm round', kind: 'round', w: 90 },
    { label: '100mm round', kind: 'round', w: 100 },
    { label: '130mm round', kind: 'round', w: 130 },
    { label: '160mm round', kind: 'round', w: 160 },
    { label: '60 × 35mm oval', kind: 'oval', w: 60, h: 35 },
    { label: '75 × 42mm oval', kind: 'oval', w: 75, h: 42 },
    { label: '90 × 52mm oval', kind: 'oval', w: 90, h: 52 },
    { label: '105 × 70mm oval', kind: 'oval', w: 105, h: 70 },
    { label: '120 × 92mm oval', kind: 'oval', w: 120, h: 92 },
    { label: '150 × 95mm oval', kind: 'oval', w: 150, h: 95 },
    { label: '170 × 105mm oval', kind: 'oval', w: 170, h: 105 },
    { label: '170 × 109mm oval', kind: 'oval', w: 170, h: 109 },
    { label: 'Small flying (60 × 35mm oval)', kind: 'oval', w: 60, h: 35 },
    { label: 'Large flying (120 × 92mm oval)', kind: 'oval', w: 120, h: 92 },
    { label: 'Hull (rectangle — set size)', kind: 'rect', w: 120, h: 70 }
  ];

  // Generic deployment presets — NOT official 11th edition force disposition maps.
  // Coordinates in inches, origin top-left, x across the 60" edge, y down the 44" edge.
  TT.ZONE_PRESETS = [
    {
      id: 'long12', name: 'Long edges, 12" deep (generic)',
      make: function (W, H) {
        return [
          { player: 'A', label: 'Attacker', points: [[0, 0], [W, 0], [W, 12], [0, 12]] },
          { player: 'B', label: 'Defender', points: [[0, H - 12], [W, H - 12], [W, H], [0, H]] }
        ];
      }
    },
    {
      id: 'short18', name: 'Short edges, 18" deep (generic)',
      make: function (W, H) {
        return [
          { player: 'A', label: 'Attacker', points: [[0, 0], [18, 0], [18, H], [0, H]] },
          { player: 'B', label: 'Defender', points: [[W - 18, 0], [W, 0], [W, H], [W - 18, H]] }
        ];
      }
    },
    {
      id: 'quarters', name: 'Table quarters, 9" from centre (generic)',
      make: function (W, H) {
        var cx = W / 2, cy = H / 2, r = 9, pts = function (sx, sy) {
          // quarter minus a 9" radius around the centre, approximated with an arc
          var arr = [[cx, sy < 0 ? 0 : H]];
          arr.push([sx < 0 ? 0 : W, sy < 0 ? 0 : H]);
          arr.push([sx < 0 ? 0 : W, cy]);
          var a0 = sx < 0 ? Math.PI : 0, a1 = sy < 0 ? -Math.PI / 2 : Math.PI / 2;
          if (sx < 0 && sy > 0) { a0 = Math.PI; a1 = Math.PI / 2; }
          if (sx < 0 && sy < 0) { a0 = Math.PI; a1 = 1.5 * Math.PI; }
          if (sx > 0 && sy < 0) { a0 = 2 * Math.PI; a1 = 1.5 * Math.PI; }
          if (sx > 0 && sy > 0) { a0 = 0; a1 = Math.PI / 2; }
          for (var i = 0; i <= 12; i++) {
            var a = a0 + (a1 - a0) * i / 12;
            arr.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
          }
          return arr;
        };
        return [
          { player: 'A', label: 'Attacker', points: pts(-1, -1) },
          { player: 'B', label: 'Defender', points: pts(1, 1) }
        ];
      }
    }
  ];

  // Layout library: Blank + the official Event Companion layouts (js/layouts-official.js) + your saved layouts.
  TT.LAYOUTS = [
    { id: 'blank', name: 'Blank battlefield', official: false, board: { w: 44, h: 60 }, terrain: [], objectives: [], zones: [], features: [] }
  ];

  // Starter base library: units you've sized are remembered by name (Settings → Base library).
  TT.STARTER_BASES = {};

})(window.TT = window.TT || {});
