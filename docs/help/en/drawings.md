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

Views are built from the current Part Studio model with hidden lines removed; you can show hidden lines as dashed lines.

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

Click the title block at the bottom right of the sheet, or **Title block** in the toolbar, to open an editor with a preview. **Apply** saves the title, designation, and author as one undoable action. **Cancel** or `Esc` closes the editor without changes; `Ctrl+Enter` (`⌘+Enter` on macOS) applies changes. To rename the drawing tab itself, double-click its name in the bottom bar.

## Views {#views}

- The **Views** list shows all views and their scale. Click a view in the list or on the sheet to select it.
- Drag views with the mouse. Projected views stay aligned with their parent view.
- **View properties**: **Orientation**, **Scale** (also changes linked projected views at once), **Show hidden lines**, **Label**, **Delete view**.

## Dimensions and notes {#annotations}

- **Dimension** (`D`): click two points (view vertices are highlighted), then click where to place the dimension; a horizontal, vertical, or aligned dimension is chosen based on the cursor position. Clicking a circle places a diameter, `Shift` + click places a radius.
- **Note**: click a spot on the sheet and type the text in the window.
- Press `Del` to delete the selected dimension, note, or view. `Esc` returns to the select tool.

## Navigation {#navigation}

Mouse wheel: zoom; right or middle button: pan; **Zoom to fit** (`F`): the whole sheet.

## Export {#export}

The **Export** button on the right of the drawing toolbar: **PDF**, **SVG**, or **DXF**; the whole sheet at 1:1 scale in millimeters.

> **Limitation.** Drawing dimensions are attached to view points, not to model edges, so check them after you change the model. Section views, detail views, tolerances, and surface finish symbols are not supported yet.
