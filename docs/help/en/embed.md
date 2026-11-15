# Embedded viewer

The embedded viewer shows a 3D model inside another website: the site opens WebCAD in a frame on its page (an iframe) and passes the file to it. This is how attachments open on the components site. The model can only be viewed there: no editing, no saving and no document list.

## Which files open {#formats}

| File | How it is shown |
|---|---|
| **STEP** (`.step`, `.stp`) | As a new document with one Part Studio that imports the file with an [Import](import) feature: exact solids with their faces and edges, in millimeters. |
| **STL** (binary and text) | As a triangle mesh, not turned into solids, so even a large file opens in seconds. Each separate body is a part with its own color. Edges are drawn where faces meet at more than 30° and along the borders of open bodies. STL has no units: numbers are taken as millimeters. |
| **WebCAD project** (`.webcad.json`) | The document as it is: its Part Studios and assemblies are built just as in the editor, in the document's units; [drawings](#drawings) are shown as sheets. If it has several tabs, pick one in the list at the top right. It opens at the tab that was active when it was saved; if that is a drawing, at its first Part Studio or assembly. |

Files up to 20 MB are supported.

## View controls {#view}

| Action | Mouse | Touch |
|---|---|---|
| Rotate | Drag with the left or right button | One finger |
| Pan | Drag with the middle button or Shift + left button | Two fingers |
| Zoom | Mouse wheel | Pinch |

The **Zoom to fit** button (or the `F` key) brings the whole model back into view. Pick standard views with the view cube and the **Views** menu; the view keys work too — `Shift`+`1`…`7`, the arrows, `Z` (see [View controls](view-controls)). Clicking a face selects it. For a planar face of a STEP model or a project, **View normal to** turns the model to face it, and a [section view](section-view) can go through it; a section through a standard plane is always available. The **?** button in the bar above the model reminds you of the controls.

The button with a rotation arrow in the bar above the model locks the axis: the view turns about the vertical, the Z axis stays upright on the screen and the horizon level (like **Turntable (Z up)** in the settings of WebCAD itself). Press it again for free rotation. The mode is remembered in this browser.

Once loaded, the whole model is shown in the isometric view. If the chosen tab has no parts or sketches, a note in the middle of the window says so. If some features of the document fail to build, a warning appears at the bottom: the model may be incomplete.

## Measuring {#measure}

Measuring is on as soon as the model opens; the ruler button in the bar above the model turns it off and on again. With nothing selected, the panel at the bottom right shows the **overall size of the model** along X, Y and Z. Click faces, edges and vertices, and the panel shows their sizes:

| Selected | Values |
|---|---|
| Edge | **Length**; for a circle or an arc (a hole's rim, for example) — **Radius** and **Diameter** |
| Face | **Area**; for a cylindrical face — **Radius**. In an STL a face is the whole body: **Area** and **Volume** |
| Vertex | Coordinates **X**, **Y**, **Z** |
| Two items | **Minimum distance** and its projections **ΔX**, **ΔY**, **ΔZ**, **Maximum distance**; for circles, cylinders and spheres — **Center to center**; for lines and planes — **Angle** |
| Several edges or faces | **Total length** or **Total area** |

The minimum distance is drawn on the model as an orange dashed line; click the **Maximum distance** or **Center to center** row to show that one. Clicking a selected item again drops it; the cross in the hint or `Esc` clears the whole selection. Values are in the model's units (millimeters for STEP and STL).

STEP models and projects are measured exactly, as with [Measure](measure) in WebCAD itself, assemblies included. An STL has no exact geometry, so its triangle mesh is measured:

- edges are its crease lines and borders, vertices are their corners;
- a circle is recognized when the points of an edge lie on it; its radius and diameter come from those points, the corners of the polygon the mesh uses for the circle;
- a distance to a body is measured to its triangles: exact for flat faces, to the mesh's accuracy for curved ones.

## Drawings {#drawings}

A project's [drawing](drawings) tabs are in the tab list together with its Part Studios and assemblies. A drawing is shown as its sheet, as it is exported to SVG: views with dimensions, notes, the border and the title block. The views are projected from the model again, so they match it as it is now.

| Action | Mouse | Touch |
|---|---|---|
| Move the sheet | Drag with any button | One or two fingers |
| Zoom | Mouse wheel, about the point under the cursor | Pinch |
| The whole sheet | Double click, the **Zoom to fit** button at the top right or the `F` key | The **Zoom to fit** button |

The sheet stays crisp at any zoom. Rotation and measuring are not available on a drawing tab: the dimensions on the sheet are the drawing's own.

## When a model does not open {#errors}

If a file cannot be opened, the window says why, and the site offers to try again or to download the original file:

- **The file is not a STEP / STL file / a WebCAD project** — its content does not match the attachment's format.
- **The file is damaged or incomplete** — for example, a STEP file without its closing `END-ISO-10303-21;` line, or a binary STL with fewer triangles than its header says.
- **The document has no Part Studios, assemblies or drawings to show** — the project has no tab that can be shown.
- **The model could not be built**, **The geometry kernel failed on this model**, **Building the model took too long** — the file was read, but the kernel could not build it. Open the file in WebCAD itself with [Import](import) or **Import project** to see which feature fails.

## Privacy {#privacy}

- The site passes the file itself: WebCAD gets neither a link to its storage nor your tokens and cookies of that site. The model is built right in the browser and is not sent anywhere.
- The embedded viewer neither reads nor changes the WebCAD documents in this browser, their versions or [folders on the computer](documents#folder): the model lives only in the frame's memory and is gone when the frame closes.
- Only allowed sites can show models. If another site embeds WebCAD, a message says it is not allowed instead of a model.
