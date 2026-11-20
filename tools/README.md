# Extraction tools

These scripts rebuild `js/layouts-official.js` and `js/bases-guide.js` from the Warhammer Event Companion PDF
(the PDF itself is not included — download it from warhammer-community.com).

```bash
pip install pymupdf pypdf numpy pillow
export EC_PDF=/path/to/event-companion.pdf
python3 extract.py     # reads the vector diagrams on pp. 9–53 → layouts_raw.json
python3 bases.py       # reads the Base Size Guide (pp. 55–93) → bases_raw.json
python3 build.py       # writes ../js/layouts-official.js and ../js/bases-guide.js
python3 overlay.py 9 10 11   # optional: draws the result over the PDF pages → ov.png for checking
```

How it works: each terrain area footprint is a vector outline in the PDF. Its straight edges give the
footprint's exact rotation and edges; axis-aligned pieces are snapped to the nearest ¼" (every printed
measurement in the companion is a multiple of ¼"). Deployment zones are the filled red/blue paths, objective
types come from their icons, "single terrain area" eye icons join adjacent footprints into one area, and
dense/light features (green/yellow) mark each area as dense (Hidden possible) and obscuring.
