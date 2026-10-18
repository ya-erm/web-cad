# Sketch fillet

Replaces a corner where two lines meet with a tangent arc.

**Sketch toolbar:** **Sketch fillet** · **Shortcut:** `Shift+F` (in sketch mode)

```figure
image: ../images/sketch-fillet-compare.svg
alt: A sharp corner replaced by a tangent arc
caption: 1 — click the shared vertex of two lines. 2 — the lines are shortened and joined by an arc of radius R. The dashed corner is shown only for comparison.
width: 600
```

## Steps {#steps}

1. Click **Sketch fillet** (`Shift+F`).
2. Click the corner point where two lines meet.
3. Double-click the radius dimension that appears, enter the value you need and press `Enter`.

## Details {#details}

- The initial radius is about one fifth of the length of the shorter of the two lines (rounded).
- The lines are trimmed to the tangent points; the arc gets tangent constraints with both lines and a radius dimension.
- The tool stays active, so you can fillet several corners in a row.
- The message "Fillet is not possible at this corner" means that the radius does not fit or that the point is not where exactly two lines meet.

> **Limitation.** Only corners between two lines can be filleted (not between a line and an arc).

## See also {#see-also}

[Fillet](fillet) — fillets the edges of a 3D part.
