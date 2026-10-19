# Split curve

Splits a line or an arc in two at a chosen point — like Split in Onshape. Handy when the parts of a curve need different constraints or dimensions.

**Sketch toolbar:** **Split curve**

## Steps {#steps}

1. Click **Split curve**.
2. Click a line or an arc where to split it: the split point is the point of the curve nearest to the click. The curve under the cursor is highlighted.
3. Keep clicking other curves; `Esc` leaves the tool.

## How it works {#how}

- The parts are joined at the split point (coincident). The two parts of a line stay on one straight line (parallel through a shared point), the two parts of an arc on one circle (one center, equal radii).
- The first part is the same curve: its constraints and dimensions stay. The constraints of the far end go to the end of the second part.
- A line length or an arc length dimension, and a fix of the curve itself, are removed: they were about the whole curve. Horizontal and vertical go to both parts of a line.
- A circle is not split — [trim](sketch-trim) turns it into an arc. A click right at the end of a curve splits nothing.

## See also {#see-also}

[Trim](sketch-trim), [Extend](sketch-extend).
