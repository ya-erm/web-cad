# Split

Cuts parts and [surfaces](offset-surface#surfaces) into pieces with a plane, a face or a surface, like Onshape's Split.

**Toolbar:** **Split**

## Steps {#steps}

1. Click **Split**.
2. In the **Parts and surfaces to split** field, select what to cut.
3. Click the **Split tool** field and select a plane, a mate connector, a face of a part or a surface. A whole surface is picked in the parts list (the "Surfaces" group); clicking it in the graphics area picks one of its faces.
4. Click ✓ (`Enter`).

Each part or surface the tool crosses falls into several pieces: one keeps the original name, the others become new parts (surfaces). Split by a plane, the piece on the side the plane's normal points to keeps the name. If the tool crosses nothing, the message "The split tool does not intersect the selected parts" appears.

## Tools {#tools}

| Tool | How it cuts |
|---|---|
| Plane, mate connector | Along the whole plane. |
| Planar face | Along its whole plane; with **Trim to face boundaries** — only within the face. |
| Non-planar face (cylinder, sphere and so on) | Within the face itself. |
| Surface | Within the surface. It is used up by the split unless **Keep tools** is on. A part is not a tool — select a face of it. |

A part is split only by a tool that goes right through it: a surface that ends inside the part does not cut it.

## Trim surfaces against each other {#trim}

Two crossing surfaces are trimmed along the line where they meet like this:

1. Split the first surface with the second, **Keep tools** on.
2. Split the second surface with a piece of the first (its edge lies on the line where they meet — the cut goes along it).
3. Delete the pieces you do not need with [Delete part](delete-part).
4. [Union](boolean#surfaces) the rest: they are sewn along the shared edge into one surface. It can be [thickened](thicken) or, if it closes a volume, [enclosed into a solid](enclose).

A part can trim a surface too: [subtract](boolean#surfaces) the part from the surface.

```figure
image: ../images/split-result.png
alt: A rectangular plate split into two separate parts with a gap between them
caption: Splitting with the Right plane creates two parts. For clarity, one half was then moved 8 mm away from the other and colored orange.
width: 480
```


## See also {#see-also}

[Section view](section-view) — view a cross-section without changing the model.
