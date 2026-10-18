# Midpoint

Places a point at the midpoint of a line.

**Sketch toolbar:** **Midpoint** · **Shortcut:** `Shift+M`

```figure
image: ../images/constraint-midpoint.svg
alt: A point moves to the midpoint of a segment
caption: Diagram: 1 — before the constraint, 2 — after. The exact positions depend on the other sketch constraints.
width: 600
```

## What to select {#select}

Exactly one point and one line. The point can be an endpoint of another line, a circle center or a standalone point. Otherwise, the message "Select a point and a line" appears.

## How it works {#how}

The point becomes the midpoint of the segment: it coincides with the point halfway between its endpoints. If their positions are not constrained, both the point and the line can move.

## Created automatically {#auto}

- While drawing, when you click the midpoint of a line (the midpoint icon appears next to the cursor).
- The center of a [center rectangle](sketch-rectangle) is the midpoint of its construction diagonal.

## Typical uses {#uses}

- Placing a hole symmetrically on a side.
- A T-joint: the endpoint of one line at the midpoint of another.

## Deleting {#delete}

Click the midpoint icon at the point and press `Del`.

## See also {#see-also}

[Symmetric](constraint-symmetric), [Coincident](constraint-coincident).
