# Sweep

Sweeps a profile (a sketch region or a planar face) along a path — a chain of sketch curves or edges. Use it for tubes, handrails, springs along a path and the like.

**Toolbar:** **Sweep**

## Steps {#steps}

1. Draw the path in one sketch and the profile in another, on a plane that crosses the start of the path (usually perpendicular to it).
2. Click **Sweep**.
3. In the **Faces and sketch regions to sweep** field, select the profile.
4. Click the **Path** field and select sketch curves or edges. They must form a single connected chain.
5. Click ✓ (`Enter`).

```figure
image: ../images/sweep-result.png
alt: A hollow pipe swept along an arc, with its ring-shaped cross section visible at the end
caption: A ring profile with radii of 4 and 2.5 mm follows a 120° arc of radius 25 mm. The inner contour keeps the pipe hollow.
width: 480
```


## Options {#options}

| Field | Description |
|---|---|
| **New** / **Add** / **Remove** / **Intersect** | Operation type. |
| **Faces and sketch regions to sweep** | Profiles. Inner loops of the profile (holes) are kept — the result is a tube. |
| **Path** | Sketch curves, part edges or a [helix](helix#spring), connected end to end. |
| **Keep profile orientation** | The profile follows the path with minimal twisting. When unchecked, the profile orientation follows the bends of the path (Frenet frame). If the result looks twisted, try toggling this checkbox. |
| **Merge with all** / **Merge scope** | The parts to apply the operation to (except for **New**). |

The message "Path edges must be connected" means the selected curves do not form a continuous chain.

## See also {#see-also}

[Loft](loft), [Extrude](extrude).
