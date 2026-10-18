# Shell

Hollows out a part, leaving walls of a given thickness. The selected faces are removed, which gives an open housing.

**Toolbar:** **Shell**

## Steps {#steps}

1. Click **Shell**.
2. Select the faces to remove (for example, the top face of a box). To get a closed hollow part without openings, select the part itself in the [Parts list](parts).
3. Set the **Thickness**, then click ✓ (`Enter`).

```figure
image: ../images/shell-result.png
alt: A hollow rectangular part with its top face removed
caption: The top face of a 40 × 30 × 22 mm block is removed, leaving 2 mm walls and a 2 mm bottom.
width: 480
```


## Options {#options}

| Field | Description |
|---|---|
| **Faces to remove** | Faces that become open; or the whole part — for a closed shell. |
| **Thickness** | Wall thickness (default 2 mm). |
| **Shell outward** | The walls grow outside the original surface, so the inner volume keeps the part's dimensions. |

The message "Shell failed: thickness may be too large" means the wall does not fit (for example, the thickness is larger than a fillet radius).
