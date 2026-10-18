# Section view

**Section view** temporarily cuts parts with a plane so you can look inside the model: the part on one side of the plane is hidden, and the cut surfaces are shaded darker. The model itself does not change; this is only a display mode.

```figure
image: ../images/section-view.jpg
alt: Section view on the Front plane and the "Section view" panel
width: 480
1 93.5% 20% "Section view" button in the view menu
2 63.3% 37.3% Section plane
3 63.3% 43% Offset: slider and value
4 63.3% 48.2% Keep the other side
5 83.1% 31.8% Close the section view
6 24.1% 47% Cut faces
```

## Steps {#steps}

1. Optionally, select the planar face or plane to cut along.
2. Click **Section view** in the view menu (below the view cube). If a planar face or plane was selected, the section uses it (**Selected**); otherwise, it uses the **Front** plane.
3. On the **Section view** panel, choose the plane: **Top**, **Front**, **Right**, or **Selected** (the button is available when a planar face or plane is selected).
4. Move the slider or enter the **offset** along the plane normal in the field to the right of the slider (in document units, `Enter` applies).
5. The **Keep the other side** checkbox shows the opposite half of the model.
6. Close the section view with the cross on the panel or by clicking the **Section view** button again.

## Notes {#notes}

- The section view affects only parts; sketches and planes are shown as usual.
- You cannot click to select the cut-away part of the model.
- The section view is not saved in the document and does not appear in exports or drawings.

> **Note.** You can also control the section view from the [Agent API](agent-api): `npm run agent -- call section '{"plane":"front","offset":5}'`.
