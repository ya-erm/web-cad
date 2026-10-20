# Drawings

A **Drawing** tab creates sheets with orthographic views of Part Studio parts, dimensions, and notes, with a border and a title block. You can export a drawing to PDF, SVG, and DXF.

```figure
image: ../images/drawing.jpg
alt: The Drawing tab: standard views of a part on an A3 sheet, the sheet and view properties panel
1 14.8% 16.3% Sheet settings
2 14.8% 72.2% View list
3 18.8% 81.7% Selected view properties
4 34% 9.1% Insert view
5 43.4% 9.1% Select, dimension, note
6 96.4% 9.1% Export PDF, SVG, DXF
7 61.3% 17.8% Selected view
8 65.6% 72.2% Title block
9 70.3% 95.3% Cursor coordinates and hint
10 21.1% 98.3% Drawing tab
```

## Creating a drawing {#create}

1. Click **+** in the bottom bar and choose **Drawing**. A tab with an empty sheet appears.
2. Click **Standard views (3 + iso)** (on the empty sheet or in the **Insert view** menu). WebCAD inserts the front, side, top, and isometric views and picks a scale that fits the sheet size.
3. To add a single view, use **Insert view** → Part Studio → **Front**, **Back**, **Top**, **Bottom**, **Left**, **Right**, or **Isometric**.

Views are built from the current Part Studio model with hidden lines removed; you can show hidden lines as dashed lines. Tapped [holes](hole#thread) are shown by the ISO 6410 convention: a thin three-quarter circle from the hole's mouth, thin hidden lines from the side.

## Sheet {#sheet}

The left panel has two blocks: **Sheet** (format and projection) and **Title block** (the texts of the title block).

| Field | Description |
|---|---|
| **Format** (Sheet) | A4, A3, A2, A1, A0, Letter, Tabloid; the adjacent list selects **Landscape** or **Portrait** orientation. |
| **Projection** (Sheet) | **First angle (ISO/ГОСТ)** or **Third angle (ANSI)**; determines where projected views are placed. |
| **Drawing title** (Title block) | The title in the title block (the document name by default). |
| **Designation** (Title block) | The drawing number or part code in the title block. |
| **Author** (Title block) | The author in the title block. |

Edit the title in the multiline **Drawing title** field on the left. Long titles wrap in the title block and use a smaller font when needed. Values that still do not fit end with an ellipsis; the full text remains available in the editor.

Choose **Title block template** in the sidebar or in the title block editor:

- **GOST · form 1** — the main table of form 1 in GOST R 2.104-2023, with fixed dimensions of **185 × 55 mm**. Title, designation, and author use the shared fields. Open **Additional GOST fields** in the editor for material, mass (including its unit), organization, version, letter, and reviewers. Signatures and the change register remain blank. This template covers the main table; additional fields outside it, such as inventory numbers along the binding margin, are not generated.
- **Custom title block** — the simplified table with **Table width (mm)** and **Table height (mm)** controls. The minimum size is **100 × 35 mm**; the maximum is the current sheet's inner frame. The table stays in the bottom-right corner, and its cells and text scale with it.

Switching templates retains custom dimensions and GOST fields. On a smaller sheet, a custom table is limited to the inner frame; returning to a larger sheet restores the requested dimensions. Existing and new drawings default to the **185 × 55 mm** custom template.

Click the title block at the bottom right of the sheet, or **Title block** in the toolbar, to open an editor with a preview. **Apply** saves the title, designation, and author as one undoable action. **Cancel** or `Esc` closes the editor without changes; `Ctrl+Enter` (`⌘+Enter` on macOS) applies changes. To rename the drawing tab itself, double-click its name in the bottom bar.

## Views {#views}

- The **Views** list shows all views and their scale. Click a view in the list or on the sheet to select it.
- Drag views with the mouse. Projected views stay aligned with their parent view.
- **View properties**: **Orientation**, **Scale** (also changes linked projected views at once), **Show hidden lines**, **Configuration** (when the Part Studio has a [configuration](configurations#uses): the view's own variant, also together with its linked projected views), **Label**, **Delete view**.

## Section views {#section}

A section view shows the parts cut by a plane along a line drawn on a view (Onshape **Section view**).

1. Click **Section view** on the toolbar.
2. Click the start of the cutting line on an orthographic view (just outside its frame works too), then its end. The points snap to the view's vertices and circle centers; a line within 5° of horizontal or vertical is straightened.
3. Move the cursor to where the section goes — the arrows on the line show the viewing direction — and click. With **First angle** projection the arrows point towards the placed section, with **Third angle** away from it.

```figure
image: ../images/drawing-section.svg
alt: A top view of a block with three holes, the cutting line A–A through their centers, and the section A–A above the view
caption: The cutting line on a top view and the section **A–A**: the hole walls and the counterbore are cut, the part's body is hatched.
width: 380
```

The parts are cut by the plane through the cutting line, perpendicular to the view; the part between the plane and the viewer is removed. The section looks across the line: a cutting line on a top view gives a front view, a vertical one on a front view gives a side view. Cut faces are hatched with thin lines at 45°, an adjacent part the other way, further parts wider (ISO 128-50). Hidden lines are off by default in sections. A thread the plane cuts lengthwise is shown per ISO 6410: the major diameter as thin solid lines, the thread end as a thick one; a thread in front of the cutting plane (removed) is not drawn.

**Offset section.** After the second point of the cutting line, **Shift**+click adds another point: each next segment runs along the first one or across it (whichever is nearer the cursor). The segments along the first one each cut their own plane; those across are the steps between them: they are not drawn in the section itself, and on the parent view the bends of the line get thick strokes.

```figure
image: ../images/drawing-section-offset.svg
alt: An offset cutting line goes through two holes at different heights, and the section shows both
caption: An offset section: the counterbored hole and the through hole lie on different lines but come into one section.
width: 420
```

**Aligned section.** After the second point, **Alt**+click puts the third at any angle — the line bends at the second point (usually the part's centre). The part beyond the bend is cut by its own plane and turned about the bend's axis into the plane of the first segment (ISO 128-44 / GOST 2.305): for example, a flange's holes at different angles come into one section. On the parent view the arrows stand across each end segment, the bend gets a thick corner.

```figure
image: ../images/drawing-section-aligned.svg
alt: A flange with holes at 0° and 120°, a cutting line bent at the center, and the section A–A with both holes
caption: An aligned section of a flange: the hole at 120° is turned into the plane of the hole at 0°; the center hole is in the middle.
width: 400
```

**Half section.** Take the cutting line to the part's axis and **Shift**+click its last segment across — towards the viewer (the side the section goes with first angle) and out of the part. Then one half of the picture is a section and the other a view, with a thin chain line (the axis) between them.

```figure
image: ../images/drawing-half-section.svg
alt: A counterbored bush: the cutting line to the axis and down, the half section A–A with the section on the left and the view on the right
caption: A half section of a bush: the left half is cut through the counterbore, the right half is a view, the axis between them.
width: 340
```

The parent view gets the cutting line (ISO 128-44 / GOST 2.305): a thin chain line across the view, thick strokes beyond it, arrows and letters. The section is labeled **A–A** above it. Letters go in order (Latin — without I, O, Q, S, X, Z; in Russian — without Ё, З, Й, О, Х, Ъ, Ы, Ь) and are changed in the **View letter** field of the section's properties; the button next to it reverses the viewing direction. A section has its parent's scale and configuration. It stays on its line of projection (across the cutting line): dragging moves it along that line only, and it follows its parent when the parent is moved. Hold **Alt** to drag it anywhere.

## Local sections {#local-section}

A local section opens part of a view itself, without a new view (Onshape **Broken-out section**).

1. Click **Local section** on the toolbar.
2. Click round the area on a view: the outline runs as a smooth curve through the points. Clicking the first point or `Enter` closes it, `Esc` cancels.

Inside the outline the parts are cut away from the viewer down to the **Local section depth** (the view's properties; measured from the parts' front, empty — to their middle). The cut face is hatched, the inner surfaces behind it (hole walls and the like) are seen, and the boundary is a thin freehand line (GOST 2.305). A new outline replaces the old one; the trash button next to the depth removes the local section. A detail view of this view shows it with the local section.

```figure
image: ../images/drawing-local-section.svg
alt: A front view of a block: the left blind hole is opened by a local section with a freehand boundary, the right one is shown dashed
caption: A local section opens the left blind hole down to the middle of the part; the right one is seen only as hidden lines.
width: 400
```

## Detail views {#detail}

A detail view shows the part of a view inside a circle at a larger scale (Onshape **Detail view**).

1. Click **Detail view** on the toolbar.
2. Click the circle's center on a view (points snap to vertices and circle centers), then a point that sets the radius.
3. Click where to place the detail: a dashed circle at the cursor shows its size.

The scale is the nearest standard one at least twice the view's (1:1 → 2:1); it is changed in the properties independently of the parent. The parent gets a thin circle and the letter on a leader's shelf, the detail the label **B (4:1)**; the detail itself is bounded by a thin circle. Dimensions are placed on a detail as on any view; points outside its circle are not highlighted.

```figure
image: ../images/drawing-detail.svg
alt: A front view of a chamfered block, the circle B at a corner, and the detail view B (4:1) with the enlarged chamfer
caption: The detail **B (4:1)**: the 2 mm chamfer at the block's corner, four times larger.
width: 520
```

Deleting a view also deletes the sections and details made from it.

## Dimensions and notes {#annotations}

- **Dimension** (`D`): click two points (view vertices are highlighted), then click where to place the dimension; a horizontal, vertical, or aligned dimension is chosen based on the cursor position. Clicking a circle places a diameter, `Shift` + click places a radius.
- **Hole callout**: click a hole made by the [Hole](hole) feature in a view along its axis (it lights up under the cursor), then where the text goes. The callout, with an arrow at the hole's outer circle and a shelf, gives its sizes per ISO 15786: the thread and its depth (`M8 ↧16`), the diameter and depth or **THRU** (`Ø6.8 ↧20`), the counterbore (`⌴ Ø15 ↧8.6`), the countersink (`⌵ Ø18 × 90°`); when the feature made several holes (a pattern of it too), their number comes first — `4×`. The symbols are drawn as lines, so they look the same in SVG, DXF, and PDF. The callout follows changes of the hole in the model.
- **Note**: click a spot on the sheet and type the text in the window.
- Press `Del` to delete the selected dimension, note, or view. `Esc` returns to the select tool.

```figure
image: ../images/drawing-hole-callout.svg
alt: A top view of a block with a tapped hole and two counterbored holes, each with a callout of its sizes
caption: Hole callouts: the M8 thread with its depth and the tap drill; two holes of one patterned feature, "2×", through, counterbored.
width: 480
```

## Navigation {#navigation}

Mouse wheel: zoom; right or middle button: pan; **Zoom to fit** (`F`): the whole sheet.

## Export {#export}

The **Export** button on the right of the drawing toolbar: **PDF**, **SVG**, or **DXF**; the whole sheet at 1:1 scale in millimeters.

All three formats preserve the selected template and its dimensions. When the sheet has Cyrillic (or other characters beyond Latin), the PDF embeds the Inter font — the one of [sketch text](sketch-text) — and all the sheet's text is set in it: the service labels stay in the interface language, and the PDF text can be searched and copied. A sheet with Latin text only uses the standard Helvetica, and the file is smaller.

> **Limitation.** Drawing dimensions are attached to view points, not to model edges, so check them after you change the model. Tolerances and surface finish symbols are not supported yet.
