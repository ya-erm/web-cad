# Import and export

```figure
image: ../images/export-dialog.png
alt: The 3MF export dialog with mesh resolution, units and selected parts
caption: Check the Parts row before exporting. Mesh resolution is available for STL, OBJ and 3MF; STEP does not need it.
width: 460
```

## Exporting parts {#export-parts}

1. Select the parts to export in the [parts list](parts). If no parts are selected, all visible parts are exported.
2. Click **Export** in the top-right corner (or **Export part** in the part context menu).
3. In the **Export parts** dialog, choose the **Format**, **Resolution** (for mesh formats), and **Units**.
4. Click **Export**; the browser downloads the file.

| Format | What is saved |
|---|---|
| **STEP (.step)** | Exact solid geometry (B-rep). Suitable for exchange with other CAD systems. |
| **STL binary (.stl)**, **STL ASCII (.stl)** | A triangle mesh for 3D printing. |
| **OBJ (.obj)** | A triangle mesh with normals; each part is a separate object. |
| **3MF (.3mf)** | A mesh with part colors and units, for 3D printing. |

**Resolution** (**Coarse**, **Medium**, **Fine**) sets the mesh accuracy for STL, OBJ, and 3MF: the higher it is, the smoother the curved surfaces and the larger the file. **Units**: mm or inch. Several selected parts are saved to one file.

## Exporting an assembly {#export-assembly}

On an [assembly](assembly) tab, **Export** opens **Export assembly**: the same formats, for the instances where they stand in the assembly — the selected ones, or every shown instance when nothing is selected.

- **STEP** — with the product tree, as Onshape writes it: the assembly is a product whose components are the instances (“Pin <1>”, “Pin <2>”…); each part is written once — with its name, color and exact geometry — and every instance places it; a [sub-assembly](assembly#subassemblies) is a product of its own inside. Other CAD systems open it as an assembly.
- **STL** — all instances as one mesh; **OBJ** and **3MF** — one object per instance.

An open [exploded view](assembly#exploded) does not affect the export: the instances are written where the assembly places them.

## Exporting a sketch to DXF {#export-dxf}

Right-click a sketch in the [feature list](feature-list) → **Export DXF**. Construction geometry is saved with a separate line style. The file units are millimeters (or inches if they are the document units).

## Drawings {#drawings}

Drawing sheets are exported to **PDF**, **SVG**, and **DXF** with the **Export** button on the drawing toolbar. See [Drawings](drawings).

## Import {#import}

- **STEP** and **STL** files are imported into a Part Studio with the [Import](import) feature. Imported bodies become parts and can be used in subsequent features.
- A whole WebCAD project (`.webcad.json`) is opened with the **Import project** button on the documents page. See [Documents and tabs](documents#project-files).

> **Limitation.** Other formats (IGES, Parasolid, native formats of other CAD systems) are not supported yet.
