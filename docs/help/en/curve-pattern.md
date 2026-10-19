# Curve pattern

Copies parts or features along a curve — a line, an arc or a chain of edges and sketch curves — like Onshape's Curve pattern. The copies turn with the curve: bosses on an arc, say, each face its centre as the original does.

**Toolbar:** **Curve pattern**

## Steps {#steps}

1. Click **Curve pattern**.
2. Choose **Part pattern** or **Feature pattern** and select what to copy.
3. Click the **Path** field and select sketch curves or edges — one chain.
4. Set the **Instance count** (the original included), click ✓ (`Enter`).

The first instance is the original: the path is measured from its start, so it is handy for the original part or feature to stand at the start of the path. Each copy goes where the path's start point would get to and turns as the curve turns.

![Six rectangular parts along an arc, viewed from above](../images/curve-pattern-result.png)

The 12 × 5 × 8 mm seed sits at the start of a radius 40 mm, 120° arc. Set **Instance count to 6**, with **Equal spacing** and **Turn with the path** enabled. Neighbours turn by 24°; the first and last sit at the ends. Turn off **Turn with the path** to keep every rectangle aligned with the seed.

## Options {#options}

| Field | Description |
|---|---|
| **Part pattern** / **Feature pattern** | What to copy, see [Linear pattern](linear-pattern#feature-pattern). |
| **Path** | Sketch curves, edges, a helix — one chain. |
| **Instance count** | How many instances with the original (default 4). |
| **Equal spacing** | The instances spread over the whole path: an open one from end to end, a closed one all the way round. Without it, set the **Distance** between neighbours along the path. |
| **From the other end** | Measure the path from its other end. |
| **Turn with the path** | The copies turn with the curve (the default). Without it they only move and keep the original's orientation. |
| **New** / **Add** | For a part pattern: separate parts or merged with the original. |

On a planar curve the copies turn within its plane; on a 3D one (a [helix](helix), say) — without needless twisting about the curve.

## See also {#see-also}

[Linear pattern](linear-pattern), [Circular pattern](circular-pattern), [Sweep](sweep).
