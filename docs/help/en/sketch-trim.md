# Trim

Removes the part of a curve between adjacent intersections with other curves.

**Sketch toolbar:** **Trim** · **Shortcut:** `M`

```figure
image: ../images/sketch-trim-compare.svg
alt: Removing the middle segment between two intersections
caption: 1 — click the orange segment. 2 — the outer line segments remain. The dashed line shows the removed segment only in this diagram.
width: 600
```

## Steps {#steps}

1. Click **Trim** (`M`).
2. Click the part of the curve you want to remove. The piece between the nearest intersections on both sides of the click point is removed (or up to the end of the curve if there are no intersections).
3. Keep clicking other pieces; press `Esc` to exit the tool.

## Details {#details}

- Works with lines, arcs and circles (a trimmed circle becomes an arc).
- The remaining part of the curve keeps its identity, so constraints and dimensions applied to it are preserved where possible.
- If a curve has no intersections at all, clicking it deletes the whole curve.

## See also {#see-also}

[Extend](sketch-extend) — the opposite operation: lengthen a curve up to an intersection.
