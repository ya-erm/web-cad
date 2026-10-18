# Parts and appearance

A part is a separate solid body in the Part Studio. Parts are created by features with the **New** operation ([Extrude](extrude), [Revolve](revolve), and others), by [import](import), by [patterns](linear-pattern), and by [split](split). By default they are named **Part 1**, **Part 2**, and so on.

## Parts list {#parts-list}

The **Parts** list is below the feature list. The header shows the number of parts.

- Click to select a part (click again to deselect it). For a single selected part, the [measure panel](measure) shows the volume, surface area, mass, and center of mass.
- When you hover over a part, it is highlighted in the graphics area.
- Double-click to rename (`Enter` saves, `Esc` cancels).
- The eye icon hides or shows the part.

## Context menu {#context-menu}

```figure
image: ../images/parts-menu.png
alt: A part context menu with visibility, export and color controls
caption: The menu applies to the selected part. The palette changes its color; Hide only changes visibility.
width: 350
```

Right-click a part in the list:

| Item | What it does |
|---|---|
| **Rename** | Changes the part name. |
| **Hide** / **Show** | Part visibility. |
| **Hide other parts** | Leaves only this part visible. |
| **Show all** | Shows all parts. |
| **Export part** | Opens the export dialog for this part only, see [Import and export](import-export). |
| **Delete part** | Adds a [Delete part](delete-part) feature to the history. |
| **Change color** | A palette of 20 colors and **Custom color…** for any color. |

Color, name, and visibility are stored in the document. The color is preserved when you export to 3MF.

You can also hide a part from the graphics area: right-click one of its faces or edges → **Hide**.

> **Limitation.** You cannot set a part material in the UI yet: mass is calculated with a density of 7.85 g/cm³ (steel).
