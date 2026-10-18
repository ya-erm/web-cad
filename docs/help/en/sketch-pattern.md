# Sketch patterns

Linear and circular patterns copy the selected sketch entities. Patterns are **associative**: the copies are built from the original entities (the "seed") every time the sketch is solved, so they repeat any change to the original.

**Sketch toolbar:** **Sketch linear pattern**, **Sketch circular pattern**

```figure
image: ../images/sketch-pattern-examples.svg
alt: Linear and circular patterns of circles
caption: 1 — a 3 × 2 linear pattern. 2 — a circular pattern with 6 instances. The orange circle is the seed and is included in the count.
width: 600
```

## Linear pattern {#linear}

1. In select mode, select the entities.
2. Click **Sketch linear pattern**. The copies and a parameters panel appear.
3. Set the **Instance count** (including the original), the **Distance** (spacing) and the **Direction angle** (the → ↑ ← ↓ buttons set 0°, 90°, 180°, 270°).
4. For a grid, turn on **Second direction** (perpendicular to the first) and set its **Instance count** and **Distance**.
5. Click ✓ (`Enter`) or click empty space. ✕ (`Esc`) cancels the pattern.

In the graphics area, you can change the spacing and direction by dragging the arrow from the seed. Double-click the count or spacing badge to open a field for entering the value.

## Circular pattern {#circular}

1. Select the entities. To set the pattern center, select a sketch point (for example, a circle center) **last** — the center is attached to it.
2. Click **Sketch circular pattern**.
3. Set the **Instance count**. The **Full circle (equal spacing)** checkbox spaces the copies evenly around the full circle; without it, set the **Angle** — the total angle of the pattern.
4. You can drag an unattached center by its handle in the graphics area; if you drop it on a point, the center attaches to that point.
5. Click ✓ (`Enter`).

## Editing and deleting {#edit}

- Double-click a copy or the "N×" label next to the seed to open the pattern parameters.
- Right-click a copy: **Edit pattern**, **Delete instance**, **Delete pattern**.
- A deleted copy leaves a "gap"; the number of gaps is shown on the panel ("removed instances: N"). Gaps are kept when you change the count.
- The **Delete pattern** button on the panel deletes all copies (the seed stays).

## Details {#details}

- You can enter expressions and [variables](variables) in all fields, for example `#n` or `#pitch * 2`.
- Copies have no constraints of their own; you cannot snap to them or dimension them — control the seed and the pattern parameters instead.
- Copies form regions and take part in features just like regular geometry.
- A pattern can have at most 500 copies.

## See also {#see-also}

[Sketch mirror](sketch-mirror), [Linear pattern](linear-pattern) and [Circular pattern](circular-pattern) — patterns in 3D.
