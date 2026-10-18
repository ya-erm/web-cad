# Perpendicular

Makes lines perpendicular.

**Sketch toolbar:** **Perpendicular** · **Shortcut:** `Shift+L`

```figure
image: ../images/constraint-perpendicular.svg
alt: The angle between two lines becomes a right angle
caption: Diagram: 1 — before the constraint, 2 — after. The exact positions depend on the other sketch constraints.
width: 600
```

## What to select {#select}

Two or more lines: each becomes perpendicular to the first one selected. If fewer than two lines are selected, you see "Select two lines".

## How it works {#how}

- Both lines rotate, each by part of the angle, until the angle between them is 90°.
- The direction of rotation is kept: a line turned counterclockwise becomes perpendicular on that same side instead of flipping.
- The lines do not have to intersect: their directions are perpendicular.

## Typical uses {#uses}

- Right angles in arbitrarily rotated profiles.
- Combined with a [horizontal](constraint-horizontal) constraint on the first line, it makes the second line vertical without a separate constraint.

## Deleting {#delete}

Click the ⊥ icon and press `Del`.

## See also {#see-also}

[Parallel](constraint-parallel), [Angle](dimension-angle).
