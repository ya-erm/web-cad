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

Edges that smoothly continue the selected one (for example, the top edges of a box meeting at a rounded corner) form one chain. Fillets and [chamfers](chamfer) run along the whole chain — just like Onshape with **Tangent propagation** checked.

In Onshape you can clear the checkbox so the fillet stops at the selected edge. The WebCAD geometry kernel (OpenCascade) cannot do that: it always runs along the whole chain. So with the checkbox cleared the result is the same, and if the chain did continue onto unselected edges, the feature shows a yellow warning "Edges tangent to the selected ones are included too: tangent propagation cannot be turned off".

> **Limitation.** Variable radius and face-to-face fillets are not supported yet; filleting only the selected edge without its tangent chain is not possible (see above).

## See also {#see-also}

[Chamfer](chamfer), [Sketch fillet](sketch-fillet).
