# Use (projection)

Projects part edges and vertices, faces, or entities of other sketches into the current sketch. Projected geometry **stays linked** to its source: it is recomputed when the model rebuilds.

**Sketch toolbar:** **Use** · **Shortcut:** `U`

```figure
image: ../images/sketch-use-projection.svg
alt: Source-face edges projected onto the sketch plane
caption: Diagram: 1 — source edges, 2 — their projection onto another plane. Dashed lines explain the projection direction. The black profile is linked to the source and fixed.
width: 600
```

## Steps {#steps}

1. In sketch mode, click **Use** (`U`).
2. Click in the graphics area:
   - an **edge** — its curve is projected (line, circle, arc or spline);
   - a **vertex** — a point is projected;
   - a **face** — all its boundary edges are projected;
   - an **entity of another sketch** — a line, curve or point;
   - the **origin**.
3. Press `Esc` to return to selection.

## Details {#details}

- Projected entities are fixed (the **Fix** constraint) — you cannot move them by hand, but you can snap to them and add constraints and dimensions to them.
- If the source changes (for example, a part dimension changes), the projected geometry updates on rebuild.
- If the source is gone (the feature was deleted or changed so that the edge cannot be found), the sketch shows the warning "Some projected (Use) geometry could not be found".
- If the geometry is already projected, the message "This geometry is already used in the sketch" appears.
- To use projected geometry only as a reference that does not form regions, make it [construction](sketch#construction) (`Q`).

## See also {#see-also}

[Sketch overview](sketch), [Offset](sketch-offset).
