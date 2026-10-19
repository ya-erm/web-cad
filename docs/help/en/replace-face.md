# Replace face

A direct edit, like Onshape's Replace face: planar faces of a part go to a plane (offset from it), and the faces around them extend or shrink to it. Use it to line up a part's top with another part or a plane, to make a wall a given thickness or to cut a part at a slant.

**Toolbar:** **Replace face**

## Steps {#steps}

1. Click **Replace face**.
2. In **Faces to replace**, select planar faces.
3. In **Replace with**, select a plane, a planar face (of another part too) or a [mate connector](mate-connector) — its XY plane.
4. If needed, set an **Offset** from that plane (the button next to it flips the side), click ✓ (`Enter`).

The offset goes the way the replaced face looks (out of the material).

## Example: match a sloping face {#example}

**Blue** is the 40 × 25 × 20 mm block to change. **Orange** is a separate reference part with a sloping top. Extend the orange face's plane onto the blue block.

| Before: horizontal block top | After: top matches the reference face's plane |
|---|---|
| ![Blue rectangular block in front of an orange part with a sloping top](../images/replace-face-guide-before.png) | ![Blue block top slopes in the same plane as the orange reference face](../images/replace-face-guide-after.png) |

1. Open **Replace face**.
2. In **Faces to replace**, select the **top face of the blue block**.
3. Switch to **Replace with** and select the **sloping top face of the orange part**.
4. Leave **Offset = 0** and click ✓.

The blue block now slopes from 15 mm high at one end to 35 mm at the other. Side walls extend or shrink to the new plane. The orange part stays unchanged; the parts remain separate. They can be a distance apart for this operation.

> **Tip.** If the blue block hides the reference face, rotate the model to reach it. Select the sloping top, rather than a vertical wall of the reference part.

## Limitations {#limits}

- Only planar faces, and only with a plane; the faces around them must be planar (see [Move face](move-face#limits)).

## See also {#see-also}

[Move face](move-face), [Delete face](delete-face).
