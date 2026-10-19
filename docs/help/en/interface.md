# User interface

The document editor window (the **Part Studio** tab) consists of several areas.

```figure
image: ../images/interface-part-studio.jpg
alt: Part Studio window: top bar, toolbar, feature list and parts list, graphics area
1 50% 2.8% Top bar
2 67% 8.5% Toolbar
3 20% 43% Feature list
4 20% 78% Parts list
5 42% 80% Graphics area
6 95% 18% View cube
7 89% 31% View menu
8 97.5% 37% Variable table
9 90% 92% Measurement panel
10 16% 98% Tabs and status bar
```

1. **Top bar.** The ◆ logo takes you back [to the document list](documents). Next to it are the document name (click to rename), the [**Versions**](versions) button, the file name if the document lives in a [folder on your computer](documents), and the save status: **Saved** or **Saving…**. On the right are the **?** button (help for the current context, `F1`), the **Settings** menu, and the **Export** button.
2. **Toolbar.** Undo and redo, the Part Studio feature buttons, and the **Search tools** field: type part of a name and press `Enter` to start the first matching tool. In sketch mode, the [sketch tools](sketch) appear here. The buttons that do not fit in the window go behind the **»** button at the end of the toolbar — click it to reach them.
3. **Feature list** (**Features**). The default geometry (**Origin**, the **Top**, **Front**, and **Right** planes) and the build history with the rollback bar. See [Feature list](feature-list).
4. **Parts list** (**Parts**). All bodies in the Part Studio with their color and visibility. See [Parts and appearance](parts).
5. **Graphics area.** The model, planes, and sketches. Here you select faces, edges, vertices, and sketch regions (in the screenshot, the top face of the boss is selected and highlighted in orange).
6. **View cube.** Click a face, edge, or corner of the cube to rotate the view. See [View controls](view-controls).
7. **View menu:** **Zoom to fit**, **View normal to**, [**Section view**](section-view), and the **Views** menu (standard views, perspective, plane and sketch visibility).
8. **Variable table**: the button below the view menu, see [Variables and expressions](variables).
9. **Measure panel**: shows length, area, volume, and distances for the selected entities. See [Measure](measure).
10. **Bottom bar.** The **+** button adds a tab (**Part Studio** or **Drawing**), followed by the document tabs. On the right are the active tool hint, the sketch status, the model rebuild time, the document units, and the app version in semver, e.g. **v0.15.0** (new features raise the middle number, fixes the last one; **dev** marks a run from the development server). Its tooltip has the date, time and code of the build's commit; quote them when reporting a bug. The rebuild time and the units have tooltips too.

While you create or edit a feature, its **dialog** is open in the top-left corner of the graphics area. See [Feature dialogs](feature-dialogs).

> **Note.** The screenshots in this help are taken in the Russian UI.

## Settings {#settings}

The **Settings** menu in the top bar of a document (on the documents page — only **Rotation** and **Language**):

| Item | What it does |
|---|---|
| **Units** | Document length units: mm, cm, m, in, ft. Numbers without units in fields and dimensions are interpreted in these units. |
| **Rotation** | **Free rotation** rotates around the screen axes; **Turntable (Z up)** rotates around the Z axis and keeps the horizon level. The setting is remembered in the browser. |
| **Language** | **Русский** or **English**. The page reloads. |

The whole document goes to a `.webcad.json` file with the **Export** button and the **WebCAD project** format. See [Documents and tabs](documents#project-files).

## Context menus {#context-menus}

Right-clicking **without moving** the mouse opens a context menu (right-dragging rotates the view):

- on a plane or planar face: **New sketch** (`Shift+S`) and **View normal to** (`N`);
- on a sketch region or entity: **Edit** (opens that sketch);
- on a face, edge, or vertex: **Hide** (hides the part) and **Mass properties** (selects the whole part, see [Measure](measure));
- anywhere: **Zoom to fit** (`F`) and **Hide planes** / **Show planes** (`P`).

The [feature list](feature-list#context-menu), the [parts list](parts), tabs, and the [sketch](sketch#context-menu) have their own context menus.

## Selecting entities {#selection}

- Clicking an entity in the graphics area adds it to the selection; clicking it again removes it.
- Clicking empty space, `Esc`, or `Space` clears the selection (`Shift`-clicking empty space does not clear it).
- The entity under the cursor is highlighted; while a feature dialog is open, only entities that fit the active field are highlighted.
- Geometry you select in advance goes into the dialog of the feature you start. See [Feature dialogs](feature-dialogs#preselection).

## Cursor {#cursor}

The cursor shape shows what a click will do:

- **hand**: over a face, edge, or other entity you can select;
- **rotate** and **grab**: while you rotate or pan the view;
- in a [sketch](sketch#cursor): **crosshair** where a click draws, and **move** while you drag geometry.

## Messages {#messages}

Errors and hints appear at the bottom of the graphics area for a few seconds. While the geometry kernel is loading (the first time you open a document), the graphics area shows **Loading geometry kernel…**.
