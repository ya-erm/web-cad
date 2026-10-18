# Loft

Builds a solid that transitions smoothly through several profiles lying on different planes. The first and last "profile" can be a point — then the solid converges to a tip.

**Toolbar:** **Loft**

## Steps {#steps}

1. Draw the profiles in sketches on different planes (for example, on planes created by the [Plane](plane) feature with an offset).
2. Click **Loft**.
3. In the **Profiles** field, select the profiles **in order** — from the first to the last. You can select a sketch point or a vertex as the first or last one.
4. If needed, turn on **Ruled**, then click ✓ (`Enter`).

```figure
image: ../images/loft-result.png
alt: A smooth transition through three circular profiles on parallel planes
caption: Three circles with radii of 18, 10 and 14 mm at heights of 0, 20 and 40 mm. The loft joins them smoothly in order from bottom to top.
width: 480
```


## Options {#options}

| Field | Description |
|---|---|
| **New** / **Add** / **Remove** / **Intersect** | Operation type. |
| **Profiles** | Sketch regions, planar faces, sketch points or vertices. At least two items are required. |
| **Ruled** | Adjacent profiles are connected by straight (ruled) surfaces instead of a smooth transition. |
| **Merge with all** / **Merge scope** | The parts to apply the operation to (except for **New**). |

> **Limitation.** Only the outer boundary of each profile is used; guide curves and vertex matching between profiles are not supported yet.

## See also {#see-also}

[Sweep](sweep), [Plane](plane).
