# Plane

Creates a reference plane — for sketches, mirror, split, loft and other features.

**Toolbar:** **Plane**

## Steps {#steps}

1. Click **Plane**.
2. Choose the **Plane type**.
3. In the **Entities** field, select the reference geometry (see the table).
4. Set the offset or angle, then click ✓ (`Enter`).

```figure
image: ../images/plane-result.png
alt: A construction plane above a rectangular plate
caption: The plane is offset 25 mm from Top, placing it 15 mm above the top face of a 10 mm thick plate.
width: 480
```


## Plane types {#types}

| Type | What to select | Options |
|---|---|---|
| **Offset** | A plane or a planar face | **Offset** — distance along the normal (default 10 mm); the button next to it flips it to the other side. |
| **Point normal** | A point (a vertex, a sketch point, the origin) and a direction (a sketch line, a linear edge, a plane or a face) | The plane passes through the point perpendicular to the direction. **Flip normal** switches its side. |
| **Three point** | Three points | A plane through three points (not on one line). **Flip normal**. |
| **Line angle** | A line (a sketch line or a linear edge) and, optionally, a reference plane | The plane passes through the line at the **Angle** to the reference plane (default 30°). |
| **Mid plane** | Two parallel planes or planar faces | A plane midway between them. |

## Usage {#use}

- The plane appears in the [Feature list](feature-list) and in the graphics area. You can hide it with the eye icon; hide all planes with the `P` key.
- Select the plane and click **Sketch** (`Shift+S`) to draw on it.
- The plane size is set automatically based on the size of the model.
