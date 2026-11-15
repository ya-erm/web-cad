# Embedded viewer

The embedded viewer shows a 3D model inside another website: the site opens WebCAD in a frame on its page (an iframe) and passes the file to it. This is how attachments open on the components site. The model can only be viewed there: no editing, no saving and no document list.

## Which files open {#formats}

| File | How it is shown |
|---|---|
| **STEP** (`.step`, `.stp`) | As a new document with one Part Studio that imports the file with an [Import](import) feature: exact solids with their faces and edges, in millimeters. |
| **STL** (binary and text) | As a triangle mesh, not turned into solids, so even a large file opens in seconds. Each separate body is a part with its own color. Edges are drawn where faces meet at more than 30° and along the borders of open bodies. STL has no units: numbers are taken as millimeters. |
| **WebCAD project** (`.webcad.json`) | The document as it is: its Part Studios and assemblies are built just as in the editor, in the document's units. If it has several tabs, pick one in the list at the top right. Drawings are not shown in the embedded viewer. |

Files up to 20 MB are supported.

## View controls {#view}

| Action | Mouse | Touch |
|---|---|---|
| Rotate | Drag with the left or right button | One finger |
| Pan | Drag with the middle button or Shift + left button | Two fingers |
| Zoom | Mouse wheel | Pinch |

The **Zoom to fit** button (or the `F` key) brings the whole model back into view. Pick standard views with the view cube and the **Views** menu; the view keys work too — `Shift`+`1`…`7`, the arrows, `Z` (see [View controls](view-controls)). Clicking a face selects it. For a planar face of a STEP model or a project, **View normal to** turns the model to face it, and a [section view](section-view) can go through it; a section through a standard plane is always available. The **?** button in the bar above the model reminds you of the controls.

Once loaded, the whole model is shown in the isometric view. If the chosen tab has no parts or sketches, a note in the middle of the window says so. If some features of the document fail to build, a warning appears at the bottom: the model may be incomplete.

## When a model does not open {#errors}

If a file cannot be opened, the window says why, and the site offers to try again or to download the original file:

- **The file is not a STEP / STL file / a WebCAD project** — its content does not match the attachment's format.
- **The file is damaged or incomplete** — for example, a STEP file without its closing `END-ISO-10303-21;` line, or a binary STL with fewer triangles than its header says.
- **The document has no Part Studios or assemblies** — the project has drawings only.
- **The model could not be built**, **The geometry kernel failed on this model**, **Building the model took too long** — the file was read, but the kernel could not build it. Open the file in WebCAD itself with [Import](import) or **Import project** to see which feature fails.

## Privacy {#privacy}

- The site passes the file itself: WebCAD gets neither a link to its storage nor your tokens and cookies of that site. The model is built right in the browser and is not sent anywhere.
- The embedded viewer neither reads nor changes the WebCAD documents in this browser, their versions or [folders on the computer](documents#folder): the model lives only in the frame's memory and is gone when the frame closes.
- Only allowed sites can show models. If another site embeds WebCAD, a message says it is not allowed instead of a model.
