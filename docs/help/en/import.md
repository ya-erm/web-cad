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
- For STL, WebCAD tries to assemble a closed solid from the triangles. If the mesh is not closed, the message "Imported file contains no solids" appears.
- You can apply any features to imported parts: fillets, holes, Boolean operations and so on (for STL, with a caveat: the body consists of many flat triangular faces).

> **Limitation.** Only STEP and STL are supported. Part colors and names from the file are not transferred.

## See also {#see-also}

[Import and export](import-export), [Documents and tabs](documents#project-files) — importing a WebCAD project.
