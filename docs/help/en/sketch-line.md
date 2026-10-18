# Line

Draws straight line segments, by default as a continuous chain: the end of one segment becomes the start of the next.

**Sketch toolbar:** **Line** · **Shortcut:** `L`

## Steps {#steps}

1. Click **Line** (`L`).
2. Click the start point.
3. Click the next points — each click adds a segment connected to the previous one.
4. End the chain: `Esc`, double-click, right-click or `Enter`.

The chain ends automatically when you click an existing point or curve (for example, to close the profile at the first point).

## Details {#details}

- While you draw a segment, its current length is shown next to it.
- When you draw a segment nearly horizontal or vertical, the horizontal or vertical icon appears next to the cursor and the line gets that constraint.
- Start and end points placed on a point, curve, line midpoint or the origin get the matching constraints (see [Inferencing](sketch#inference)). Acquired points let you align the end of a segment with another point.
- After each segment, a [quick dimension](sketch#quick-dimensions) field appears on it: type the length and press `Enter` — the chain continues from the point at the new length.
- Adjacent segments of a chain are connected by coincident constraints.
- With **Construction** mode on (`Q`), lines are created as construction geometry.

## See also {#see-also}

- [Tangent arc](sketch-arc#tangent) — continue the chain with an arc.
- [Rectangle](sketch-rectangle), [Constraints](sketch-constraints), [Dimensions](sketch-dimensions).
