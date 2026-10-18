# Linear pattern

Copies parts or features along one or two directions at a constant spacing.

**Toolbar:** **Linear pattern**

## Steps {#steps}

1. Click **Linear pattern**.
2. Choose the type: **Part pattern** or **Feature pattern**.
3. Select parts (in the graphics area or the Parts list) or check features in the **Features to pattern** list.
4. Click the **Direction** field and select a sketch line, a linear edge, a planar face or a plane (the direction is their normal), a cylindrical face or a circular edge (the direction is their axis).
5. Set the **Distance** (spacing) and the **Instance count**. The button next to the distance flips the direction.
6. For a grid, turn on **Second direction** and set its direction, distance and count.
7. Click ✓ (`Enter`).

```figure
image: ../images/linear-pattern-result.png
alt: Six cylinders arranged in a three-by-two rectangular grid
caption: A part pattern with 3 instances along X and 2 along Y, spaced 16 mm in each direction. Counts include the original part.
width: 480
```


## Options {#options}

| Field | Description |
|---|---|
| **Part pattern** / **Feature pattern** | What to copy. |
| **Parts to pattern** | For a part pattern. |
| **Features to pattern** | For a feature pattern: a list of features above the current one that create or cut bodies (extrude, revolve, sweep, loft, hole, thicken). |
| **Direction** | Direction of the first row. |
| **Distance** | Spacing between instances (default 20 mm). |
| **Instance count** | Number of instances, including the original (default 3). |
| **Second direction** | Turns on the second row: **Direction**, **Distance**, **Instance count**. |
| **New** / **Add** | For a part pattern: the instances become separate parts or merge with the original. |

## Feature pattern {#feature-pattern}

A feature pattern repeats the result of the selected features at new locations with the same operation: instances of a cut remove material, instances of a boss add material (merging with all parts). This is a convenient way to replicate a hole or a slot on a part.

> **Limitation.** Face patterns are not supported yet — use a feature pattern.

## See also {#see-also}

[Circular pattern](circular-pattern), [Mirror](mirror), [Sketch patterns](sketch-pattern).
