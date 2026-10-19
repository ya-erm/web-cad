# Thicken

Turns sketch regions or part faces into a solid of a given thickness.

**Toolbar:** **Thicken**

## Steps {#steps}

1. Click **Thicken**.
2. In the **Faces, surfaces and sketch regions** field, select sketch regions, faces (planar or curved) or surfaces.
3. Set the **Thickness**; the button next to it switches the side.
4. Click ✓ (`Enter`).

```figure
image: ../images/thicken-result.png
alt: A 3 mm thick flat plate with rounded ends
caption: A slot-shaped sketch region thickened by 3 mm along the normal to the Top plane.
width: 480
```


## Options {#options}

| Field | Description |
|---|---|
| **New** / **Add** / **Remove** / **Intersect** | Operation type. |
| **Faces, surfaces and sketch regions** | Sketch regions, part faces and whole [surfaces](offset-surface#thicken): all of a surface's faces are thickened and the corners between planar ones filled — one solid comes out. |
| **Thickness** | Thickness of the solid (default 2 mm). Planar regions and faces are thickened along the normal, curved faces are offset. |
| **Merge with all** / **Merge scope** | The parts to apply the operation to (except for **New**). |

> **Tip.** To make a plate from a sketch, thicken and [extrude](extrude) to the same depth give the same result; thicken is more convenient for faces of existing parts.
