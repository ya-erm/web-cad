# Circular pattern

Copies parts or features around an axis.

**Toolbar:** **Circular pattern**

## Steps {#steps}

1. Click **Circular pattern**.
2. Choose **Part pattern** or **Feature pattern** and specify what to copy.
3. Click the **Axis** field and select a sketch line, a linear edge, a circular edge or a cylindrical face (their axis is used).
4. Set the **Angle** and the **Instance count**, then click ✓ (`Enter`).

```figure
image: ../images/circular-pattern-result.png
alt: Six cylinders evenly spaced around a circle
caption: 6 instances over a full turn about Z, with the cylinder centers 22 mm from the axis.
width: 480
```


## Options {#options}

| Field | Description |
|---|---|
| **Part pattern** / **Feature pattern** | What to copy, see [Linear pattern](linear-pattern#feature-pattern). |
| **Parts to pattern** / **Features to pattern** | Source parts or features. |
| **Axis** | Axis the instances rotate around. |
| **Angle** | Total pattern angle (default 360°). The button next to it flips the direction. |
| **Instance count** | Number of instances, including the original (default 4). |
| **Equal spacing** | Instances are distributed over the **Angle**: at 360° — evenly around the circle, otherwise the first and last instances sit at the ends of the angle. When unchecked, the **Angle** is the spacing between adjacent instances. |
| **New** / **Add** | For a part pattern: separate parts or merged with the original. |

## See also {#see-also}

[Linear pattern](linear-pattern), [Sketch patterns](sketch-pattern#circular).
