# Arc

| Tool | Shortcut | Defined by |
|---|---|---|
| **3 point arc** | `A` | Start, end and a point on the arc. |
| **Tangent arc** | `Shift+A` | Continues a line or arc tangentially. |
| **Center point arc** | — | Center, start and end. |

```figure
image: ../images/sketch-arc-steps.svg
alt: Drawing a three-point arc
caption: 1 — start, 2 — end, 3 — a point on the arc. The third click sets the bulge, not the center.
width: 600
```

## 3 point arc {#three-point}

1. Click **3 point arc** (`A`).
2. Click the start point, then the end point.
3. Click a third point for the arc to pass through (it sets the radius and the side the arc bulges to).

Start and end points placed on existing points get coincident constraints.

## Tangent arc {#tangent}

1. Click **Tangent arc** (`Shift+A`).
2. Click the endpoint of an existing line or arc — the arc starts there, tangent to it.
3. Click the end point of the arc.

The arc gets a coincident constraint with the start point and a tangent constraint with the original curve. If you click somewhere other than the end of a line or arc, the message "Start the tangent arc at the end of a line or arc" appears.

## Center point arc {#center}

1. Click **Center point arc**.
2. Click the center, then the start point (it sets the radius).
3. Click where the arc should end: only the angle matters, the radius stays the same.

The arc is drawn counterclockwise from the start point to the end point.

## Details {#details}

- After you create a 3 point or center point arc, a [quick dimension](sketch#quick-dimensions) field is offered for the **radius**.
- You can set the arc radius with a [dimension](sketch-dimensions) (`R`) and make two arcs equal with the [Equal](sketch-constraints) constraint.

## See also {#see-also}

[Circle](sketch-circle), [Sketch fillet](sketch-fillet), [Line](sketch-line).
