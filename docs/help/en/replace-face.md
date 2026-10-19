# Replace face

A direct edit, like Onshape's Replace face: planar faces of a part go to a plane (offset from it), and the faces around them extend or shrink to it. Use it to line up a part's top with another part or a plane, to make a wall a given thickness or to cut a part at a slant.

**Toolbar:** **Replace face**

## Steps {#steps}

1. Click **Replace face**.
2. In **Faces to replace**, select planar faces.
3. In **Replace with**, select a plane, a planar face (of another part too) or a [mate connector](mate-connector) — its XY plane.
4. If needed, set an **Offset** from that plane (the button next to it flips the side), click ✓ (`Enter`).

The offset goes the way the replaced face looks (out of the material).

## Example {#example}

A block 10 mm tall: replace its top face with the **Top** plane offset 12 mm — the block is 12 mm tall; its right side face with the **Right** plane offset 5 mm — the right side stands at x = 5.

## Limitations {#limits}

- Only planar faces, and only with a plane; the faces around them must be planar (see [Move face](move-face#limits)).

## See also {#see-also}

[Move face](move-face), [Delete face](delete-face).
