# Offset surface

Makes a surface — a body of faces with no thickness or volume — at a distance from the selected faces, like Onshape's Offset surface. A distance of 0 copies the faces. Surfaces serve as reference geometry (for [Replace face](replace-face) or a sketch on them, say) and become solids with [Thicken](thicken).

**Toolbar:** **Offset surface**

## Steps {#steps}

1. Select faces and click **Offset surface** (or click the button and select the faces).
2. Set the **Distance**: positive — out of the material, along the faces' normals. The button next to it flips the side.
3. Click ✓ (`Enter`).

The faces of one part are sewn into one surface; faces of different parts make surfaces of their own.

## Surfaces in the model {#surfaces}

- The **Parts** list keeps surfaces in a group of their own, **Surfaces**, named "Surface 1", "Surface 2"…; parts are numbered without them.
- A surface is seen from both sides, its faces and edges are picked as those of parts, it can be hidden, renamed, moved, exported (STEP, STL).
- Surfaces take no part in Booleans: an extrude or a hole with **Merge with all** leaves them alone.
- [Measuring](measure) a surface gives its area (it has no volume or mass).
- A part whose [faces are deleted](delete-face) without healing becomes a surface too.

## Thickening a surface {#thicken}

[Thicken](thicken) takes a whole surface: each of its faces is thickened along its normal, and the corners between planar faces are filled (with a sharp outer edge), so one solid comes out.

> **Limitation.** Surfaces come only from offsetting faces and from deleting faces without healing for now. Extruding open curves into surfaces, sewing surfaces into a solid (Enclose) and trimming surfaces are not supported.

## See also {#see-also}

[Thicken](thicken), [Delete face](delete-face), [Replace face](replace-face).
