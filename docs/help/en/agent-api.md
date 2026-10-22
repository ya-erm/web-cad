# Agent API

The Agent API lets you create and modify WebCAD models programmatically, with declarative operations in JSON. It is used by AI agents (for example, Claude Code) and scripts: you can build a part from the terminal while the app is open in the browser, or without a browser at all.

## Features {#features}

- Operations: variables, sketches from shapes (rectangles, circles, lines, arcs, slots, polygons, points), extrude, revolve, fillets, chamfers, shells, holes (including [ISO standard](hole#standard) tapped ones), patterns (along a [curve](curve-pattern) too), mirror, [ribs](rib), [face edits](move-face), Boolean operations, planes, mate connectors, section view, and any other features with "raw" parameters.
- [Assemblies](assembly): create an assembly tab, insert parts and sub-assemblies ([flexible](assembly-subassemblies#flexible) ones too), place and fix instances, mate them (faces and edges found with the same queries), group them, add mate relations, make [exploded views](assembly-exploded) (instances moved and turned step by step). One call can build the parts and then assemble them.
- [Mate animation](assembly-motion#animate) as a query: where the moving instances are (placement and bounding box) at each frame of a mate's motion — say, to check that parts do not run into each other. The document does not change.
- [Derived](derived): bring in parts and sketches of another Part Studio of the document or of a [version](derived#versions) (of this document or another one) and build on them (a sketch with Use projection, an extrude of a derived sketch's regions).
- [Configurations](configurations): set up a table of variants (feature parameters, sketch dimensions, disabled features, variables; list, checkbox and variable inputs), choose a variant and give an assembly instance a variant of its own.
- [Drawings](drawings): a sheet with a title block (custom or ГОСТ), the [standard views](drawings#views) of a part or an assembly at a scale that fits, projected views, [section and detail views](drawings#section), dimensions on the model's vertices and circles (they follow the model), hole callouts, notes, a [bill of materials with item numbers](drawings#bom); the sheet [exported](drawings#export) as PDF, SVG and DXF — in the browser and without it.
- [Versions and branches](versions): save a version, create a [branch](versions#branches) from a version, switch workspaces, merge a branch into the current one. Without a browser the versions are kept in the [project file](versions#file).
- Queries for faces, edges and parts by geometry ("top planar face", "edges parallel to Z").
- A model report: features and their errors, variables, parts with their bounding boxes, volume and area; for an assembly — its instances (placement and bounding box) and whether every mate holds.
- Screenshots of the graphics area (an assembly's exploded view too) and export (STL, STEP — an assembly with its product tree, project file, a drawing as PDF / SVG / DXF).
- All operations of one call are applied as **a single undo step** — you can undo them with `Ctrl+Z` in the app. Version operations are the exception: a version, a branch, a merge are made at once, in order, as in the Versions panel.

## How to run it {#usage}

In the WebCAD project folder:

```bash
npm run agent -- status                 # open WebCAD tabs
npm run agent -- create "Plate"         # new document in a tab
npm run agent -- run '[{"op":"sketch","shapes":[{"type":"rect","center":true,"w":40,"h":30}]},{"op":"extrude","depth":10}]'
npm run agent -- shot plate.png iso     # screenshot of the graphics area
npm run agent -- build ops.json --out model.webcad.json --stl model.stl   # without a browser
npm run agent -- run '[{"op":"drawing","of":"Part Studio 1"}]'           # a drawing with the standard views
npm run agent -- export pdf plate.pdf   # the drawing as a PDF
```

On an open page, the same methods are available in the console as `window.webcad`.

## For developers {#reference}

The full reference of operations, queries and the report format is the `docs/agent-api.md` file in the WebCAD repository. It is intended for developers and agents, so it is not part of this help.

> **Note.** While a feature dialog or a sketch is open, changes through the Agent API are rejected — finish or cancel the edit.
