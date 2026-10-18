# View controls

## Mouse {#mouse}

| Action | Mouse |
|---|---|
| Rotate | Right button + drag |
| Pan | Middle button + drag, or `Ctrl` + right button + drag |
| Zoom | Mouse wheel; zooms toward the point under the cursor |
| Zoom to fit | Double-click the middle button |
| Select | Left button |
| Context menu | Right-click without moving |

The view rotates around the point on the part under the cursor (if there is no part under the cursor, around the center of the view). Choose the rotation mode in **Settings** → **Rotation**:

- **Free rotation**: the model rotates around the screen axes (as in Onshape);
- **Turntable (Z up)**: rotation around the Z axis; the horizon does not tilt.

## View cube {#view-cube}

The cube in the top-right corner of the graphics area rotates together with the model. Click a face of the cube (**Front**, **Top**, **Right**, and so on) to view the model from that side; click an edge or a corner to view it at an angle.

- **Drag the cube** to rotate the view, as right-dragging in the graphics area does (about the centre of the view; the rotation mode from **Settings** applies here too).
- **Right-click the cube** for its menu: the standard views, isometric, dimetric, trimetric, **Zoom to fit** (`F`) and **Perspective**.

## View menu {#view-menu}

```figure
image: ../images/view-menu.png
alt: The view cube and standard view menu with shortcuts
caption: The Views menu below the cube: standard orientations, perspective and plane/sketch visibility.
width: 228
```

Buttons below the view cube:

| Button | What it does |
|---|---|
| **Zoom to fit** (`F`) | Zooms the view so that the whole model fits. |
| **View normal to** (`N`) | In a sketch, looks perpendicular to the sketch plane; if a planar face or plane is selected, perpendicular to it; otherwise, shows the top view. |
| **Section view** | Cuts the model with a plane, see [Section view](section-view). |
| **Views** | Standard views, perspective, and visibility of reference objects (see below). |

The **Views** menu:

| Item | Keys |
|---|---|
| **Front**, **Back**, **Left**, **Right**, **Top**, **Bottom** | `Shift+1` … `Shift+6` |
| **Isometric**, **Dimetric**, **Trimetric** (a group of their own) | Isometric — also `Shift+7` (the menu does not show the key) |
| **Perspective** | Toggles perspective projection (orthographic by default). |
| **Show planes** | `P` shows or hides planes |
| **Show sketches** | `Shift+H` shows or hides all sketches |

## Keyboard {#keyboard}

| Keys | Action |
|---|---|
| `←` `→` | Rotate the view 15° around the vertical axis |
| `↑` `↓` | Rotate the view 15° around the horizontal axis |
| `Shift` + arrow | Rotate 90° |
| `Shift+Z` | Zoom in |
| `Z` | Zoom out |
| `F` | Zoom to fit |
| `N` | View normal to |

You can hide individual planes, sketches, and helices with the eye icon in the [feature list](feature-list), and parts in the [parts list](parts).
