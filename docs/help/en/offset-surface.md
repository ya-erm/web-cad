# Offset surface

Makes a surface — a body of faces with no thickness or volume — at a distance from the selected faces, like Onshape's Offset surface. A distance of 0 copies the faces. Surfaces serve as reference geometry (for [Replace face](replace-face) or a sketch on them, say) and become solids with [Thicken](thicken).

**Toolbar:** **Offset surface**

## Steps {#steps}

1. Select faces and click **Offset surface** (or click the button and select the faces).
2. Set the **Distance**: positive — out of the material, along the faces' normals. The button next to it flips the side.
3. Click ✓ (`Enter`).

The faces of one part are sewn into one surface; faces of different parts make surfaces of their own.

![Orange surface above the blue block](../images/offset-surface-result.png)

Select the top face of a 10 mm high block and set **Distance** to 8 mm. The orange surface lies at a height of 18 mm; the original stays in place. At distance 0 the copy coincides with the original face.

## Surfaces in the model {#surfaces}

- The **Parts** list keeps surfaces in a group of their own, **Surfaces**, named "Surface 1", "Surface 2"…; parts are numbered without them.
- A surface is seen from both sides, its faces and edges are picked as those of parts, it can be hidden, renamed, moved, exported (STEP, STL).
- An extrude or a hole with **Merge with all** leaves surfaces alone. [Boolean](boolean#surfaces) sews surfaces together and subtracts parts from them, [Split](split) cuts them with a plane, a face or another surface — that is how surfaces are [trimmed against each other](split#trim).
- [Measuring](measure) a surface gives its area (it has no volume or mass).
- Surfaces also come from [extruding](extrude#surface), [revolving](revolve#surface) and [sweeping](sweep#surface) sketch curves; a part whose [faces are deleted](delete-face) without healing becomes a surface too.

## Thickening a surface {#thicken}

[Thicken](thicken) takes a whole surface: each of its faces is thickened along its normal, and the corners between planar faces are filled (with a sharp outer edge), so one solid comes out.

Surfaces come from offsetting faces, from deleting faces without healing and from [extruding](extrude#surface) sketch curves as a **Surface**; surfaces that close a volume are [enclosed into a solid](enclose).

> **Limitation.** Surfaces are not trimmed against each other; revolving and sweeping into surfaces are not supported yet.

## See also {#see-also}

[Thicken](thicken), [Delete face](delete-face), [Replace face](replace-face).
