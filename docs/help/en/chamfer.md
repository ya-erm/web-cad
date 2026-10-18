# Chamfer

Bevels part edges with a flat chamfer.

**Toolbar:** **Chamfer**

## Steps {#steps}

1. Select edges or faces (a face means all its edges).
2. Click **Chamfer**.
3. Choose the **Chamfer type** and set the dimensions, then click ✓ (`Enter`).

```figure
image: ../images/chamfer-result.png
alt: Chamfers on all four edges of the top face of a rectangular plate
caption: Equal distances of 2 mm create a flat sloping strip around the top perimeter.
width: 480
```


## Options {#options}

| Field | Description |
|---|---|
| **Edges and faces to chamfer** | Edges; a face means all its edges. |
| **Chamfer type** | **Equal distance** — the same leg on both faces; **Two distances** — different legs; **Distance and angle** — a leg and an angle. |
| **Distance** | Chamfer leg (default 2 mm). |
| **Distance 2** | Second leg for **Two distances**. |
| **Angle** | Angle for **Distance and angle** (default 45°). |
| **Opposite direction** | For asymmetric chamfers: switches the face from which the first distance is measured. |
| **Tangent propagation** | The chamfer continues onto smoothly connected edges. |

The message "Chamfer failed: distance may be too large" means the chamfer does not fit on the adjacent faces.

Like a fillet, a chamfer with **Tangent propagation** checked continues onto edges that smoothly continue the selected ones, and with it cleared stays on the selected edges only — see [Fillet: tangent propagation](fillet#tangent).

## See also {#see-also}

[Fillet](fillet).
