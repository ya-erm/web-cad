# Coincident

Makes points coincide, places a point on a curve, or puts lines on one line.

**Sketch toolbar:** **Coincident** · **Shortcut:** `I`

```figure
image: ../images/constraint-coincident.svg
alt: Two line endpoints joined at a common point
caption: Diagram: 1 — before the constraint, 2 — after. The exact positions depend on the other sketch constraints.
width: 600
```

## What to select {#select}

| Selection | Result |
|---|---|
| Two or more points (line endpoints, centers, standalone points) | All points coincide with the first one selected. |
| Exactly one point and one curve (line, circle, arc, ellipse) | The point lies on the curve. |
| Two or more lines | All the lines lie on the line of the first one selected (collinear). This is how a [text](sketch-text) is set on a line, say — by the bottom side of its box. |

Any other combination shows the message "Select points (and optionally one curve), or lines".

## How it works {#how}

- **Point to point:** the points merge into one and share the same coordinates. Both points move, roughly toward each other; if one of them is fixed or fully defined, the other moves to it.
- **Point on a line:** the point lies on the infinite line through the segment, including its extension beyond the segment's endpoints.
- **Point on a circle or arc:** the point is at a radius distance from the center, that is, on the full circle (for an arc, possibly beyond its endpoints).
- **Line on a line:** both ends of the second line lie on the infinite line through the first; the segments need not overlap — drag them or add other constraints to slide them along it.

## Created automatically {#auto}

- While drawing, when you click an existing point or a curve — the coincident icon is shown next to the cursor (see [Inferencing](sketch#inference)).
- In a chain of lines, and in rectangles, slots and polygons, between adjacent sides.
- When you drag a point onto another point or curve and release it (see [Drag inferencing](sketch#drag-inference)).

## Notes {#notes}

- A coincident constraint between two points has no icon: you can see it from the shared vertex. A point on a curve is marked with an icon.
- To separate coincident points, undo the action (`Ctrl+Z`), or delete one of the curves and draw it again.
- You cannot place a point on a spline: such a constraint has no effect.

## Deleting {#delete}

Click the constraint icon at the point (if icons are hidden, turn on **Show constraints**, `Shift+C`, or select the point) and press `Del`.

## See also {#see-also}

[Midpoint](constraint-midpoint), [Concentric](constraint-concentric), [Constraints](sketch-constraints).
