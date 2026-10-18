# Parallel

Makes lines parallel.

**Sketch toolbar:** **Parallel** · **Shortcut:** `B`

```figure
image: ../images/constraint-parallel.svg
alt: Two lines become parallel
caption: Diagram: 1 — before the constraint, 2 — after. The exact positions depend on the other sketch constraints.
width: 600
```

## What to select {#select}

Two or more lines. Each line becomes parallel to the first one selected. If fewer than two lines are selected, the message "Select two lines" appears.

## How it works {#how}

- The lines rotate about their points until they are parallel; both rotate, each by part of the angle. Length and position are kept where possible.
- The nearest orientation is kept: lines pointing "the same way" stay in the same direction, opposite ones stay opposite. A line does not flip.
- To keep one line in place, first make it [horizontal](constraint-horizontal), [vertical](constraint-vertical) or [fix](constraint-fix) it.

## Typical uses {#uses}

- Opposite sides of arbitrary quadrilaterals and slots.
- Walls of constant thickness (together with a [distance dimension](dimension-distance) between the parallel lines).

## Deleting {#delete}

Click the ∥ icon next to the line and press `Del`.

## See also {#see-also}

[Perpendicular](constraint-perpendicular), [Length and distance](dimension-distance).
