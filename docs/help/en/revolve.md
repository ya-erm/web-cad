# Revolve

Creates a revolved solid: sketch regions or planar faces rotate around an axis.

**Toolbar:** **Revolve** · **Shortcut:** `Shift+W`

## Steps {#steps}

1. Draw the profile and the axis (usually a construction line) in the same sketch — the profile must not cross the axis.
2. Select the regions and click **Revolve** (`Shift+W`).
3. Click the **Revolve axis** field and select the axis.
4. Choose the **Revolve type** and the angles, then click ✓ (`Enter`).

```figure
image: ../images/revolve-result.png
alt: A revolved part with a wide base and an axial through hole
caption: A stepped profile on the Front plane is revolved 360° about Z. The gap between the profile and the axis creates the hole.
width: 480
```


## Options {#options}

| Field | Description |
|---|---|
| **New** / **Add** / **Remove** / **Intersect** | Operation type, see [Feature dialogs](feature-dialogs#operation). |
| **Faces and sketch regions to revolve** | Profiles to revolve. |
| **Revolve axis** | A sketch line or a linear edge; also a circular edge or a cylindrical face — then their axis is used. |
| **Revolve type** | **Full** — 360°; **One direction** — by the **Angle**; **Symmetric** — half the angle to each side; **Two directions** — the **Angle** to one side and the **Second angle** to the other. |
| **Angle** | Rotation angle (default 90°). The button next to it flips the direction. |
| **Second angle** | For **Two directions** (default 45°). |
| **Merge with all** / **Merge scope** | The parts to apply the operation to (except for **New**). |

## Surface {#surface}

The **Solid / Surface** switch at the top of the dialog. As a **Surface** the revolve takes **Sketch curves and edges** instead of regions, open ones too: a line, a polyline, an arc, part edges. A [surface](offset-surface#surfaces) "Surface N" with no thickness comes out. Curves lying on the axis itself are skipped, so the axis can be an ordinary line of the same sketch. The revolve types and angles are the same as for a solid; Booleans do not apply to a surface.

For example, a line from (0, 20) to (10, 20) and a line from (10, 20) to (10, 0) on the **Front** plane, axis Z. A **Full** revolve gives an upturned cup with no thickness: a disc of radius 10 mm and a wall 20 mm high, area 2π·10·20 + π·10² ≈ 1570.8 mm².

## Tips {#tips}

- You can draw the axis in the same sketch as a construction line (`Q`) — it does not interfere with the regions.
- A total angle greater than 360° is limited to a full revolution.

## See also {#see-also}

[Extrude](extrude), [Helix](helix), [Circular pattern](circular-pattern).
