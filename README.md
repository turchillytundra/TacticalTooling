# TacticalTooling — 11th Edition Warhammer 40,000 tactics board

A browser-based battlefield planner for developing game-play strategy and tactics in 11th edition
Warhammer 40,000. Load an official terrain layout, put both armies on the table, and see what each unit
can shoot, charge and see, and what can hit it back.

**Open it:** open `index.html` in a browser (no install or server needed), or enable GitHub Pages for this
repository (Settings → Pages → deploy from `main` / root) and use it from any device.

## Features

**Battlefield and terrain**
- 44" × 60" battlefield (portrait, as in the Event Companion), plus a landscape option and Incursion size. *Rotate battlefield 90°* turns everything, armies included.
- **All 45 official terrain layouts** from the *Warhammer Event Companion v1.2*: Layouts A, B and C for all 15 force disposition matchups. Each one includes deployment zones, objective types (home, central, expansion) and terrain areas.
- The exact 11th edition terrain area set: 4× 11.5"×7", 2× 8"×11.5" polygon, 4× 6"×4", 2× 10"×2.5", 4× 6"×2". The palette shows how many of each piece you've used.
- A precise placement editor. Type a centre point, or the distance from any battlefield edge to a footprint edge, plus a rotation, so you can recreate any printed diagram. Snaps to ¼".
- Footprints can share a terrain area number to act as one terrain area. Each area can be marked obscuring and/or dense.
- Save your own layouts, and export or import them as JSON.

**Armies**
- **Import lists** from:
  - BattleScribe / New Recruit roster files (`.ros`, `.rosz`). These are the same files Yellowscribe reads.
  - **Yellowscribe** army JSON: paste the code, or open `yellowscribe.xyz/get_army_by_id?id=CODE` and paste what it shows.
  - New Recruit JSON export.
  - Text exports from the Warhammer 40,000 app or New Recruit.
- **Base sizes come in automatically** from the Base Size Guide (June 2026, 1,100+ units), covering round, oval and flying bases. Hulls need their size set. You can set any base by hand, and *Remember base* saves it for future imports.
- Add units manually: model count, base, Move, and ranged and melee weapons (with an Assault flag).
- Formations (1, 2 or 3 rows, or a blob), rotation, duplicating units, and dragging single models.

**Analysis (toggle in the View tab)**
- **Threat ranges**, each measured from the base edge:
  - Shooting: M + weapon range, plus Advance for Assault weapons.
  - Charge: M + 2D6, capped at 12".
  - Move, Advance (M + D6), and Engagement range (2").
  - Show them for the selected unit, one army or everyone. Choose "next turn" or "current position". Overlaps can stack into a heat map.
- **Line of sight** under the 11th edition Obscuring rule (13.10). A line crossing an obscuring terrain area is blocked, unless one of the two models is within that area.
- **Hidden** (13.09). Infantry, Beasts and Swarm models within an area that has dense features, and that haven't shot, can only be seen within 15".
- **Benefit of cover** (13.08) is flagged per target.
- **Visibility shading** shows where the selected unit can see, and can be clipped to its maximum range.
- For the selected unit, a **targets and threats table** lists every enemy unit with:
  - closest base-to-base distance
  - models visible
  - which weapons can shoot it now
  - charge success odds now and after a move
  - what can see, shoot or charge *this* unit on the enemy's turn
- **Measure tool**: edge-to-edge when you start on a model.

**Quality of life**
- Zoom with the wheel or a pinch, pan by dragging, *Fit* to the board, unit labels with cover and hidden tags, undo/redo, keyboard shortcuts, autosave in your browser, scenario save/load, and PNG export.
- Works on desktop, tablet and phone (on narrow screens the panel becomes a bottom sheet).

### Keyboard
| Key | Action |
|---|---|
| Drag empty space / Shift-drag | Pan |
| Wheel, `+` / `-`, `0` | Zoom, fit |
| `M` / `V` | Measure / select tool |
| `G` or Alt-drag | Move single models instead of the whole unit |
| `R` / Shift+`R` | Rotate selected unit or terrain ±15° |
| `D`, `Delete` | Duplicate, delete selected |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| `L` | Toggle labels |

## Accuracy notes
- **Terrain layouts** were extracted from the vector diagrams in the Event Companion PDF (see `tools/`). Every layout was checked by drawing the result over the original pages. Axis-aligned footprints are snapped to the ¼" grid that all the printed measurements use. Rotated pieces keep the angle and position from the diagram.
- **Rules values** come from the 11th edition Core Rules: engagement range 2", charge 2D6 with targets within 12", Advance M + D6, hidden detection range 15". You can change them under View → Rules values.
- **Line of sight is top-down.** It uses the terrain area footprints and model bases, not model or terrain heights, windows or the Solid rule. Treat it as a planning aid, and agree real line of sight with your opponent.
- **Charge odds** assume a straight-line path. They ignore terrain you'd have to move around.

## Project layout
```
index.html               app shell
css/app.css              styles
js/data.js               footprints, rules values, base presets, zone presets
js/geometry.js           bases, offsets, distances, line of sight, visibility polygons
js/importers.js          .ros/.rosz, Yellowscribe JSON, New Recruit JSON, text importers
js/layouts-official.js   45 Event Companion v1.2 layouts (generated)
js/bases-guide.js        Base Size Guide, June 2026 (generated)
js/app.js                state, rendering, interaction, analysis, panels
tools/                   scripts that generate the two data files from the Event Companion PDF
```

Unofficial fan tool, not affiliated with or endorsed by Games Workshop. Warhammer 40,000 and related names are trademarks of Games Workshop Ltd.
