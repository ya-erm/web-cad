# Draft

Tilts part faces by a given angle relative to the pull direction of a mold — this is how casting drafts are made.

**Toolbar:** **Draft**

## Steps {#steps}

1. Click **Draft**.
2. In the **Neutral plane** field, select a plane or a planar face. Its normal is the pull direction; the faces do not move along the line where they intersect the neutral plane.
3. Click the **Faces to draft** field and select the side faces.
4. Set the **Draft angle** (the button next to it flips the tilt direction), then click ✓ (`Enter`).

```figure
image: ../images/draft-result.png
alt: A block with four sloping side faces and a smaller top face
caption: Four side faces of a 30 mm tall block are drafted by 12°. Top is the neutral plane, so the bottom perimeter stays fixed.
width: 480
```


## Options {#options}

| Field | Description |
|---|---|
| **Neutral plane** | A plane or a planar face. |
| **Faces to draft** | Faces to tilt. |
| **Draft angle** | Tilt angle (default 3°). |

> **Tip.** You can draft the side walls right when extruding — use the **Draft** checkbox in [Extrude](extrude).
