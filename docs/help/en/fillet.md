# Fillet

Rounds part edges with an arc of a given radius.

**Toolbar:** **Fillet** · **Shortcut:** `Shift+F`

| Before filleting | Radius: 3 mm |
|---|---|
| ![A plate with sharp vertical edges](../images/plate-before.png) | ![All four vertical edges of the plate rounded with a 3 mm radius](../images/first-part-fillet.png) |

## Steps {#steps}

1. Select edges or faces (selecting a face fillets all its edges).
2. Click **Fillet** (`Shift+F`).
3. Set the **Radius**, then click ✓ (`Enter`).

## Options {#options}

| Field | Description |
|---|---|
| **Edges and faces to fillet** | Edges; a face means all its edges. You can select edges of different parts. |
| **Radius** | Fillet radius (default 2 mm). |
| **Tangent propagation** | The fillet continues onto edges that smoothly continue the selected ones (for example, around an already rounded corner). See [below](#tangent). |

## Tips {#tips}

- The message "Fillet failed: radius may be too large" usually means the radius is larger than the adjacent faces — reduce it.
- Place fillets closer to the end of the history: that way they interfere less with edge selection in other features.

## Tangent propagation {#tangent}

Edges that smoothly continue the selected one (for example, the top edges of a box meeting at a rounded corner, or the edges of a slot) form one chain. With **Tangent propagation** checked (the default), fillets and [chamfers](chamfer) run along the whole chain.

Clear the checkbox and the fillet stays on the selected edges only, as in Onshape: at the end of a selected edge, where an unselected tangent one begins, it stops with a flat end square to the edge, and the neighbouring edge stays sharp. So you can round, say, one straight side of a slot without its arcs, or just an arc. This works for concave edges (the fillet adds material) and for chamfers too.

If the fillet cannot be cut back to the selected edges, the feature is built along the whole chain and shows a yellow warning "Edges tangent to the selected ones are included too: the blend could not be stopped at the selected edges".

> **Limitation.** Variable radius and face-to-face fillets are not supported yet.

## See also {#see-also}

[Chamfer](chamfer), [Sketch fillet](sketch-fillet).
