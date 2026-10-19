"""Merge overlapping font contours before using them as CAD sketch boundaries.

Run once after replacing the bundled WOFF files:
  python -m pip install 'fonttools[woff]==4.60.1' 'skia-pathops==0.9.0'
  python scripts/prepare-sketch-fonts.py

Font renderers use nonzero winding to fill overlapping contours (e.g. Inter's A
crossbar and sides). Sketch regions instead partition every bounded area. Removing
the overlaps keeps the same visible glyph, with one boundary and real counters.
This is asset preparation only; Python dependencies are not needed by WebCAD.
"""

from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.ttLib.removeOverlaps import removeOverlaps


def main():
    folder = Path(__file__).resolve().parents[1] / "src/sketch/fonts"
    for path in sorted(folder.glob("*.woff")):
        with TTFont(path, recalcTimestamp=False) as font:
            removeOverlaps(font)
            font.save(path)
        print(f"Prepared {path.name}")


if __name__ == "__main__":
    main()
