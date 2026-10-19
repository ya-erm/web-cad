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

## Surface {#surface}

The **Solid / Surface** switch at the top of the dialog. As a **Surface** the sweep takes **Sketch curves and edges**, open or closed; curves joined end to end go as one chain. A [surface](offset-surface#surfaces) "Surface N" with no thickness comes out: a closed curve gives a tube with open ends, not a solid. **Keep profile orientation** works as for a solid; Booleans do not apply to a surface.

For example, a circle of radius 5 mm on the **Top** plane swept along a vertical line 15 mm long gives the side of a cylinder, area 2π·5·15 ≈ 471.2 mm², with no bottom or lid.

## See also {#see-also}

[Loft](loft), [Extrude](extrude).
