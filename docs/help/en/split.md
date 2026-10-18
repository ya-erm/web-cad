# Split

Cuts parts with a plane into separate parts.

**Toolbar:** **Split**

## Steps {#steps}

1. Click **Split**.
2. In the **Parts to split** field, select parts.
3. Click the **Split tool** field and select a plane or a planar face.
4. Click ✓ (`Enter`).

Each part the plane crosses turns into several parts: the piece on one side keeps the original part, the pieces on the other side become new parts. If the plane does not cross any part, the message "The split tool does not intersect the selected parts" appears.

> **Limitation.** You can split only with a plane; splitting with a surface or another part is not supported yet.

```figure
image: ../images/split-result.png
alt: A rectangular plate split into two separate parts with a gap between them
caption: Splitting with the Right plane creates two parts. For clarity, one half was then moved 8 mm away from the other and colored orange.
width: 480
```


## See also {#see-also}

[Section view](section-view) — view a cross-section without changing the model.
