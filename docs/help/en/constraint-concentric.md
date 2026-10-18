# Concentric

Gives two circles, arcs or ellipses a common center.

**Sketch toolbar:** **Concentric** · **Shortcut:** `Shift+O`

```figure
image: ../images/constraint-concentric.svg
alt: Circles with separate centers become concentric
caption: Diagram: 1 — before the constraint, 2 — after. The exact positions depend on the other sketch constraints.
width: 600
```

## What to select {#select}

Exactly two entities from: circles, arcs, ellipses, points. A point coincides with the center of the other curve. Otherwise, the message "Select two circles or arcs" appears.

## How it works {#how}

- The centers merge into one point; the radii do not change.
- Usually both curves move toward each other. To keep one in place, first fix it ([Fix](constraint-fix)) or locate its center with dimensions.

## Typical uses {#uses}

- Rings, washers, stepped shafts in a sketch for [revolve](revolve).
- A hole at the center of a fillet arc.

## Deleting {#delete}

Click the ◎ icon next to the curve and press `Del`.

## See also {#see-also}

[Coincident](constraint-coincident), [Tangent](constraint-tangent), [Equal](constraint-equal).
