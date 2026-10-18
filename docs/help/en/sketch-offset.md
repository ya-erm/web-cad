# Offset

Creates an offset copy of a chain of curves at a set distance from it (inward or outward). The distance is set by a single dimension that drives the whole copy.

**Sketch toolbar:** **Offset** · **Shortcut:** `O`

## Steps {#steps}

1. Click **Offset** (`O`).
2. Click a line, arc or circle. The whole connected chain that contains this curve is selected (curves joined at their ends). To add more chains, `Shift`-click them.
3. Move the cursor toward the side you want to offset to: a preview and the current distance are shown.

   ![Offset preview of a chain of two lines with the distance at the cursor](../images/sketch-offset-preview.png)

4. Click to create the copy. A dimension field opens right away — enter the exact distance and press `Enter`.

If you select the curves **before** starting the tool, step 2 is skipped: the offset preview of the selected curves appears immediately.

## Details {#details}

- Offset curves are joined at the corners the same way as the originals and stay linked to the original chain: the [offset dimension](dimension-offset) (one for the whole operation) drives the distance, and the copy follows the original geometry when it changes.
- Offsetting to different sides of a closed profile gives a profile smaller or larger than the original.
- Deleting part of the copy removes only the corresponding pairs from the offset dimension.
- The message "The offset distance is too large for this geometry" appears if, at that distance, some segment vanishes or turns inside out (for example, an arc radius would become negative).

> **Limitation.** Only lines, arcs and circles can be offset; splines and ellipses cannot.

## See also {#see-also}

[Thicken](thicken) and the **Thin** option in [Extrude](extrude) — for walls of constant thickness in 3D.
