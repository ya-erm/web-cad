# Import

Adds bodies from STEP or STL files to the Part Studio. Each solid body in the file becomes a separate part.

**Toolbar:** **Import**

## Steps {#steps}

1. Click **Import**.
2. Click the **STEP / STL…** button in the **File** field and select a `.step`, `.stp` or `.stl` file.
3. For an STL, keep or clear **Recognize surfaces** (see below).
4. Wait for the preview and click ✓ (`Enter`).

The feature name is taken from the file name.

## Recognizing STL surfaces {#recognize}

An STL holds triangles only. With **Recognize surfaces** checked (the default), WebCAD finds which triangles lie on one plane, cylinder, cone or sphere and builds the part of real faces, as a CAD part: a hole becomes one cylindrical face with circular edges, a chamfer a cone, a fillet part of a cylinder, a ball a sphere. Such a part is easy to measure (radius, axis), holes and mate connectors attach to it, and the model is not covered with the hatching of triangle edges.

- The faces' boundaries are exact: two planes meet in a line, a plane across the axis of a cylinder, cone or sphere in a circle, a coaxial cylinder and cone in a circle too; other boundaries are splines through the mesh's points.
- The recognized part is checked: it must be a valid solid of the mesh's volume (within 1%). A face that cannot be built keeps its flat triangles; if the whole part cannot be built, it keeps its triangles altogether, and the feature shows a warning.
- Surfaces are found to a ten-thousandth of the model's size. STL files exported from CAD (their mesh's corners lie on the faces) are recognized well; scans and sculpted meshes keep their triangles.
- A torus (a bearing's groove, a fillet around an axis) is recognized as bands of cones along the mesh's rows. Freeform shapes (lofts, sweeps along a helix, threads) keep their triangles; a body of more than 30,000 triangles is not recognized at all.
- Clear the box to keep the original triangles (those lying in one plane are still merged into one face).

## Details {#details}

- The file is stored inside the document, so the document and the project file grow by its size. You do not need to select the file again after reloading.
- An STL (binary or text) is split into bodies along the edges its triangles share: each closed body becomes a part, an open mesh a surface. Parts that touch along an edge or a face in the file (an assembly saved as one STL, for example) stay separate parts.
- You can apply any features to imported parts: fillets, holes, Boolean operations and so on.

> **Limitation.** Only STEP and STL are supported. Part colors and names from the file are not transferred.

## See also {#see-also}

[Import and export](import-export), [Documents and tabs](documents#project-files) — importing a WebCAD project.
