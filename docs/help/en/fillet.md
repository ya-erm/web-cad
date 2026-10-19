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
| **Constant radius** / **Variable radius** | One radius all along, or radii of their own at some vertices, see [below](#variable). |
| **Edges and faces to fillet** | Edges; a face means all its edges. You can select edges of different parts. |
| **Radius** | Fillet radius (default 2 mm); for a variable one — at the vertices without a radius of their own. |
| **Vertices with their own radius**, **Vertex 1**, **Vertex 2**… | For **Variable radius**: vertices of the selected edges and the radius at each. |
| **Smooth transition** | For **Variable radius**: the radius changes smoothly, without a kink at the vertices; otherwise linearly along each edge. |
| **Tangent propagation** | The fillet continues onto edges that smoothly continue the selected ones (for example, around an already rounded corner). See [below](#tangent). |

## Variable radius {#variable}

Like Onshape's variable fillet: along an edge the radius goes from its value at one vertex to the one at the other.

1. Choose **Variable radius** and the edges.
2. Click the **Vertices with their own radius** field and pick the ends of the edges in the graphics area.
3. Each vertex gets a row **Vertex 1**, **Vertex 2**… — set its radius there. The vertices without one take the common **Radius**.
4. **Smooth transition** makes the radius change smoothly (it levels off at the vertices), so a chain of edges has no kinks.

A vertex removed from the selection takes its radius with it. The radius at every vertex must be greater than zero.

```figure
image: ../images/variable-fillet-result.png
alt: Vertical edge fillet with radius varying from 1 to 7 mm
caption: A 20 × 20 × 20 mm block: radius 1 mm at the lower vertex and 7 mm at the upper one. The blend widens towards the top. Select one vertical edge and both endpoints in Variable radius mode to reproduce it.
width: 650
```

## Tips {#tips}

- The message "Fillet failed: radius may be too large" usually means the radius is larger than the adjacent faces — reduce it.
- Place fillets closer to the end of the history: that way they interfere less with edge selection in other features.

## Tangent propagation {#tangent}

Edges that smoothly continue the selected one (for example, the top edges of a box meeting at a rounded corner, or the edges of a slot) form one chain. With **Tangent propagation** checked (the default), fillets and [chamfers](chamfer) run along the whole chain.

Clear the checkbox and the fillet stays on the selected edges only, as in Onshape: at the end of a selected edge, where an unselected tangent one begins, it stops with a flat end square to the edge, and the neighbouring edge stays sharp. So you can round, say, one straight side of a slot without its arcs, or just an arc. This works for concave edges (the fillet adds material) and for chamfers too.

If the fillet cannot be cut back to the selected edges, the feature is built along the whole chain and shows a yellow warning "Edges tangent to the selected ones are included too: the blend could not be stopped at the selected edges".

> **Limitation.** Points with their own radius inside an edge (not at vertices), conic cross sections and face-to-face fillets are not supported yet.

## See also {#see-also}

[Chamfer](chamfer), [Sketch fillet](sketch-fillet).
