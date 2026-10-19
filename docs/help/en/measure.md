# Measure

There is no separate measure tool: select entities in the graphics area (or a part in the [parts list](parts)), and a panel with the results appears in the bottom-right corner of the graphics area. The panel is hidden while a feature dialog or a sketch is open.

```figure
image: ../images/measure-panel.png
alt: A selected plate and the volume, area, mass and center of mass panel
caption: The Base part is selected in the parts list. The lower-right panel shows properties of the whole part, not a single face.
width: 640
```

## What is shown {#values}

| Selection | Values |
|---|---|
| Part | **Material**, **Volume**, **Surface area**, **Mass** (by its material's density), **Center of mass** (X, Y, Z) |
| Face | **Area**; for a cylindrical face, also **Radius** |
| Edge | **Length**; for a circle or arc, also **Radius** and **Diameter** |
| Vertex or origin | **X**, **Y**, **Z** coordinates |
| Sketch curve | **Length** |
| Any two entities | **Minimum distance** and its components **ΔX**, **ΔY**, **ΔZ**; **Maximum distance** — between the farthest points |
| Two circles, arcs, cylindrical or spherical faces, vertices | **Center to center**: between the centres of circles and spheres, between the axes of cylinders |
| Two edges, faces or planes | **Angle** — the acute angle between lines, between planes, or between a line and a plane. A circle's direction is its plane's normal, a cylinder's is its axis |
| Several edges / faces / parts | **Total length** / **Total area** / **Total volume** |

Lengths are shown in document units, angles in degrees.

The minimum distance is drawn on the model as an orange dashed segment. Click the **Maximum distance** or **Center to center** row and the segment shows that distance instead; the row gets a dash mark.

The maximum distance between straight edges and planar faces is exact (it is always between vertices); for curves and curved faces it is taken over their points, to a fraction of a percent.

## Steps {#steps}

1. Close the feature dialog or sketch if one is open.
2. Click a face, edge, or vertex. To measure a distance, click a second entity.
3. Read the values on the panel. Clicking empty space (or `Esc`) clears the selection.

> **Tip.** To quickly get the mass and volume of a part, right-click any of its faces and choose **Mass properties**; the whole part is selected.

## Material and mass {#material}

A part's mass comes from its material's density. To set the material, click the **Material** row of the panel, or choose **Material…** in the part's context menu (in the [parts list](parts) or on the model). Pick a library material — each shows its density — or **Custom**: type a name and a density in g/cm³. With several parts selected, all of them get it.

| Library materials | Density, g/cm³ |
|---|---|
| Steel, stainless steel, cast iron | 7.85; 7.93; 7.2 |
| Aluminum, titanium | 2.7; 4.51 |
| Brass, bronze, copper | 8.5; 8.8; 8.96 |
| PLA, ABS, PETG, nylon (PA6) | 1.24; 1.04; 1.27; 1.14 |
| Polycarbonate, acrylic (PMMA) | 1.2; 1.18 |
| Wood (pine), plywood, glass | 0.5; 0.6; 2.5 |

A part with no material weighs as steel (7.85 g/cm³). A mass under a kilogram is shown in grams. For several parts the panel shows the **Total mass**, each by its own material. The material's name goes to the **Material** column of an assembly's [bill of materials](assembly-bom).
