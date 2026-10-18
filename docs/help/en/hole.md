# Hole

Creates drilled holes — simple, counterbored or countersunk — at sketch points.

**Toolbar:** **Hole**

## Steps {#steps}

1. Draw a sketch on a part face and place [points](sketch-point) at the centers of the future holes.
2. Click **Hole**.
3. Choose the type: **Simple**, **Counterbore** or **Countersink**.
4. Select sketch points (or circular edges — then the hole is placed at their center).
5. Choose the **Termination**, set the **Diameter** and the other dimensions, then click ✓ (`Enter`).

The hole starts at the sketch plane and goes into the material — opposite to the sketch plane normal (for a circular edge — along its axis).

```figure
image: ../images/hole-result.png
alt: Two counterbored through holes in a plate
caption: Two sketch points locate the holes: diameter 6 mm, counterbore diameter 10 mm and counterbore depth 3 mm.
width: 480
```


## Options {#options}

| Field | Description |
|---|---|
| **Simple** / **Counterbore** / **Countersink** | Hole type. |
| **Sketch points to place holes** | Sketch points or circular edges. |
| **Termination** | **Blind** or **Through all**. |
| **Diameter** | Hole diameter (default 5 mm). |
| **Depth** | For **Blind** (default 10 mm). |
| **Tip angle** | The cone at the bottom of a blind hole (default 118°, like a drill bit). |
| **Counterbore diameter**, **Counterbore depth** | For **Counterbore** (default 9 and 4 mm). The counterbore diameter must be larger than the hole diameter. |
| **Countersink diameter**, **Countersink angle** | For **Countersink** (default 10 mm and 90°). |
| **Merge with all** / **Merge scope** | The parts to cut the holes from: all parts or only the selected ones. |

> **Limitation.** Tapped holes and standard hole size tables are not supported yet.

## See also {#see-also}

[Point](sketch-point), [Extrude](extrude) with the **Remove** operation, [Linear pattern](linear-pattern).
