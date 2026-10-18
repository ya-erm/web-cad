# Equal

Makes line lengths or circle and arc radii equal.

**Sketch toolbar:** **Equal** · **Shortcut:** `E`

```figure
image: ../images/constraint-equal.svg
alt: Two unequal segments become equal in length
caption: Diagram: 1 — before the constraint, 2 — after. The exact positions depend on the other sketch constraints.
width: 600
```

## What to select {#select}

Two or more curves of the same kind:

- lines — equal lengths;
- circles and arcs (in any combination) — equal radii.

Each curve is made equal to the first one selected. If fewer than two curves are selected, you see "Select two or more lines or arcs".

## How it works {#how}

- The shorter line gets longer and the longer one gets shorter, each by part of the difference. Line directions do not change.
- For circles and arcs, the radii change and the centers stay in place.

## Typical uses {#uses}

- Identical holes: give one a [diameter](dimension-radius) and make the rest equal to it.
- Equal sides of a polygon (this is how the [polygon](sketch-polygon) is built).

## Notes {#notes}

- Do not mix lines and circles in one selection: an equal constraint between a line and a circle has no effect.
- Equal is not supported for splines and ellipses.

## Deleting {#delete}

Click the = icon next to the curve and press `Del`.
