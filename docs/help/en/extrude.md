# Extrude

Creates a solid by extruding sketch regions or planar faces perpendicular to their plane. It can create a new part, add material to existing parts, remove material, or keep the intersection.

**Toolbar:** **Extrude** · **Shortcut:** `Shift+E`

```figure
image: ../images/feature-dialog-extrude.jpg
alt: The Extrude dialog: operation New, a sketch region, end type Blind, depth 10 mm, and the preview
width: 600
```

## Steps {#steps}

1. Select sketch regions or planar faces (you can click a sketch in the [Feature list](feature-list) to select all its regions).
2. Click **Extrude** (`Shift+E`).
3. Choose the operation type: **New**, **Add**, **Remove** or **Intersect**.
4. Choose the **End type** and set the **Depth** (or a face for **Up to face**).
5. If needed, turn on **Thin**, **Draft**, **Starting offset** or **Second end position**.
6. Click ✓ (`Enter`).

You can type the depth right away: with the dialog open, type a number — it goes into the **Depth** field — and press `Enter`.

## Options {#options}

| Field | Description |
|---|---|
| **New** / **Add** / **Remove** / **Intersect** | Operation type, see [Feature dialogs](feature-dialogs#operation). |
| **Faces and sketch regions to extrude** | Profiles: closed sketch regions or planar faces of parts. |
| **End type** | **Blind** — to a specified distance; **Symmetric** — half the depth to each side of the sketch plane; **Up to face** — up to the selected plane, planar face, vertex or sketch point; **Through all** — through the entire model. |
| **Up to** | For **Up to face**: the plane, planar face, vertex or sketch point to extrude up to. The plane must not be parallel to the direction. |
| **Depth** | Extrude distance (default 25 mm). The button next to it flips the direction. |
| **Opposite direction** | For **Up to face** and **Through all**: extrudes to the other side. |
| **Thin**, **Thickness** | Instead of a solid body, builds a wall of the given thickness along the outer boundary of the profile. The button next to the thickness moves the wall outward. |
| **Draft**, **Draft angle** | Tilts the side faces by the given angle (tapering in or out). The button flips the tilt direction. |
| **Starting offset** | The extrude starts away from the sketch plane: **Start type: By distance** — by the **Start offset** along the extrude direction (the button next to it — the other way); **From entity** — at a selected face, plane, mate connector or point. The depth counts from the new start; **Up to face** still ends at its face. A draft turns about the new start. |
| **Second end position** | Also extrudes to the opposite side of the sketch plane; the second direction has its own **End type** (**Blind**, **Up to face**, **Through all**) and **Depth**. Not available for **Symmetric**. |
| **Merge with all** / **Merge scope** | For **Add**, **Remove**, **Intersect**: the parts to apply the operation to. |

## Surface {#surface}

The **Solid / Surface** switch at the top of the dialog. As a **Surface** the extrude takes **Sketch curves** instead of regions — open ones too (a line, a polyline, an arc): a [surface](offset-surface#surfaces) "Surface N" with no thickness comes out. The end is **Blind**, **Symmetric** or **Through all** (and a second end); thin walls, draft and Booleans do not apply to a surface. Surfaces can be [thickened](thicken) or [enclosed into a solid](enclose).

```figure
image: ../images/extrude-surface-result.png
alt: Surface from an open polyline extruded 20 mm
caption: An open three-segment polyline extruded 20 mm in Surface mode makes three connected faces without thickness. Apply Thicken afterwards to make a solid wall.
width: 650
```

## Tips {#tips}

- **Remove** + **Through all** is a quick way to make a through cut. For round holes, [Hole](hole) is more convenient.
- You can link the depth to a variable: `#t`, `#height - 2 mm`.
- The message "Nothing to remove: the tool does not touch any part" means the cutting body does not touch any part — check the direction.

> **Limitation.** In **Thin** mode, only the outer boundary of the profile is used; inner loops (holes in the region) are ignored.

## See also {#see-also}

[Revolve](revolve), [Sweep](sweep), [Loft](loft), [Sketch overview](sketch).
