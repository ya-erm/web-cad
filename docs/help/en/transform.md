# Transform

Moves, rotates or scales parts — or copies of them.

**Toolbar:** **Transform**

## Steps {#steps}

1. Click **Transform**.
2. Choose the **Transform type**.
3. In the **Parts to transform** field, select parts.
4. Set the options of the selected type (see below).
5. To keep the original part in place, turn on **Copy part**.
6. Click ✓ (`Enter`).

```figure
image: ../images/transform-result.png
alt: The original blue plate and an offset orange copy
caption: Translation with Copy enabled: X = 50 mm, Y = 0 mm, Z = 15 mm. The original part stays in place.
width: 480
```


## Transform types {#types}

| Type | Options |
|---|---|
| **Translate by XYZ** | **X**, **Y**, **Z** — translation along the coordinate axes (default 0, 0, 10 mm). |
| **Translate by entity** | **Direction** — a sketch line, an edge, a planar face or a plane (along the normal), a cylindrical face (along the axis), a [mate connector](mate-connector) (along its Z axis); **Distance** and a flip button. |
| **Rotate** | **Axis** — a sketch line, a linear or circular edge, a cylindrical face, a mate connector; **Angle** and a flip button. |
| **Scale uniformly** | **Point** — the center of scaling (a vertex, a sketch point, the origin, the center of a circular edge; if none is selected — the origin); **Scale** — the scale factor (greater than 0). |
| **Mate connector to mate connector** | See [below](#mates). |

**Copy part** — a new copy of the part is moved instead of the part itself.

Mate connectors [owned](mate-connector#owner) by the moved part move with it (except with **Copy part**).

## Mate connector to mate connector {#mates}

Aligns parts so that one [mate connector](mate-connector) takes the place of another: their origins and axes coincide.

1. Create a mate connector on the part to move (for example, at the center of its bottom face) and a mate connector at the destination.
2. In **Transform**, choose the **Mate connector to mate connector** type.
3. Select the **Parts to transform**, then the **Mate connector to move** and the **Destination mate connector**.
4. Click ✓.

> **Tip.** To turn the part as you align it, change **Flip primary axis** or **Rotation about Z** on a mate connector.

## See also {#see-also}

[Mate connector](mate-connector), [Linear pattern](linear-pattern), [Circular pattern](circular-pattern).
