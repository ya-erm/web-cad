# Symmetric

Makes two entities mirror images of each other about a line (the axis of symmetry).

**Sketch toolbar:** the **Symmetric** button · **Shortcut:** `Shift+Q`

```figure
image: ../images/constraint-symmetric.svg
alt: Two lines become symmetric about a construction axis
caption: Diagram: 1 — before the constraint, 2 — after. The exact positions depend on the other sketch constraints.
width: 600
```

## What to select {#select}

Exactly three entities, one of which is the axis line:

| Selection | Result |
|---|---|
| Two points and a line | The points are symmetric about the line. |
| Two lines and a line | The line endpoints are symmetric in pairs; the endpoint pairs are matched automatically. |
| Two circles and a line | The centers are symmetric and the radii are equal. |
| Two arcs and a line | The arc centers and endpoints are symmetric in pairs. |

Otherwise, the message "Select two points, lines, arcs or circles and a line as the axis" appears.

## Which line becomes the axis {#axis}

The selection order does not matter. The axis is the line about which the other two entities are already closest to being mirror images. Construction lines take priority, so it is convenient to draw the axis as a [construction](sketch#construction) line (`Q`). When three regular lines are selected, the middle one becomes the axis.

## How it works {#how}

- Mirrored points lie on the same perpendicular to the axis, at equal distances from it.
- If the two lines share an endpoint (the vertex of a "V" shape), that point is placed on the axis.
- The axis itself can also move if nothing holds it in place. To keep the axis in place, make it [vertical](constraint-vertical) or [horizontal](constraint-horizontal) and attach it to the origin.

```figure
image: ../images/constraint-symmetric-circles.svg
alt: Two circles symmetric about a construction axis: their radii became equal
width: 420
```

## Created automatically {#auto}

[Sketch mirror](sketch-mirror) links the copies to the originals with symmetric constraints.

## Deleting {#delete}

Click the symmetric icon next to the entity and press `Del`.

## See also {#see-also}

[Midpoint](constraint-midpoint), [Sketch mirror](sketch-mirror).
