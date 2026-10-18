# Fix

Locks sketch entities in their current position.

**Sketch toolbar:** **Fix** · **Shortcut:** `Shift+J`

```figure
image: ../images/constraint-fix.svg
alt: A free blue line becomes fixed and black
caption: Diagram: 1 — before the constraint, 2 — after. The exact positions depend on the other sketch constraints.
width: 600
```

## What to select {#select}

One or more entities of any kind: points, lines, circles, arcs, ellipses, splines. If nothing is selected, you see "Select entities to fix".

## How it works {#how}

- All parameters of the entity are frozen: point coordinates; for a circle, the center and radius; for a line, both endpoints.
- A fixed entity is fully defined and shown in black; other constraints can no longer move it, so the other entities move instead.

## Created automatically {#auto}

- A point placed at the origin (origin inference) is fixed there.
- Geometry [projected](sketch-use) with the **Use** tool is fixed (its position comes from the source).

## Typical uses {#uses}

- A "reference" entity that the rest of the sketch is built from, for example when tracing over [projected](sketch-use) geometry.
- A temporary fix so that the right part of the sketch moves when you add other constraints.

> **Tip.** For parametric sketches, it is better to locate entities with [dimensions](sketch-dimensions) from the origin: a fix stores numbers that you cannot later change with an expression.

## Deleting {#delete}

Click the anchor icon at the entity and press `Del` — the entity can be moved again.
