# Import

Adds bodies from STEP or STL files to the Part Studio. Each solid body in the file becomes a separate part.

**Toolbar:** **Import**

## Steps {#steps}

1. Click **Import**.
2. Click the **STEP / STL…** button in the **File** field and select a `.step`, `.stp` or `.stl` file.
3. Wait for the preview and click ✓ (`Enter`).

The feature name is taken from the file name.

## Details {#details}

- The file is stored inside the document, so the document and the project file grow by its size. You do not need to select the file again after reloading.
- An STL (binary or text) is split into bodies along the edges its triangles share: each closed body becomes a part, an open mesh a surface. Parts that touch along an edge or a face in the file (an assembly saved as one STL, for example) stay separate parts.
- STL triangles lying in one plane are merged into one face; curved surfaces (holes, fillets) stay sets of flat triangles, and their edges show on the model.
- You can apply any features to imported parts: fillets, holes, Boolean operations and so on (for STL, with a caveat: curved surfaces consist of triangular faces).

> **Limitation.** Only STEP and STL are supported. Part colors and names from the file are not transferred.

## See also {#see-also}

[Import and export](import-export), [Documents and tabs](documents#project-files) — importing a WebCAD project.
