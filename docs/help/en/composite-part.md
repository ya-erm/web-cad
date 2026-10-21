# Composite part

Groups several parts (solids and surfaces) so that they act as one part, like Composite part in Onshape. The composite has:

- one row in the Parts list and in the bill of materials;
- one instance in an assembly;
- one mass.

**Toolbar:** **Composite part**

## Steps {#steps}

1. Click **Composite part**. If you select parts in the list or on the model first, they go straight into the field.
2. In the **Parts** field, select parts: click their rows in the [Parts list](parts), or their faces in the graphics area.
3. Check **Closed** if the parts should exist only inside the composite (see below).
4. Click ✓ (`Enter`).

Composite parts are named **Composite part 1**, **Composite part 2**, and so on. You can rename one like any part.

## Open and closed {#closed}

| | Open (the default) | Closed (**Closed** checked) |
|---|---|---|
| The parts it is made of | Stay in the Parts list as parts of their own. | Are consumed: only the composite is listed. |
| Later features | Work on its parts, and the composite follows them: move a part, and the composite moves too. | Work on it as one part: material added to it does not break it into pieces. |
| Graphics area | Its parts are shown. Selecting the composite's row highlights them all. | It is shown itself, and its faces and edges are selected as usual. |

The **Parts** list shows composite parts in a section of their own, **Composite parts**; their icon is two parts in a dashed outline. The arrow on the left expands the parts it is made of. An open composite's parts can be selected with a click; a closed one's are only names, in grey.

A single part can be made a composite too. A composite can go into another one: a closed composite consumes it, an open one does not. Selecting an open composite stands for its parts.

## Where it is one part {#one-part}

- **Assembly.** It is inserted into an [assembly](assembly) as one instance. The mate connectors of its parts travel with it.
- **Bill of materials** of an assembly [drawing](drawings#bom): one row.
- **Measuring.** The volume, area and mass are of all its bodies together, by the material of the composite itself (see [Measure](measure)).
- **Derived.** A [Derived](derived) feature brings it as one part.
- **Export** writes its bodies as separate parts, as Onshape does (see [Import and export](import-export)). The bodies of an open composite are exported under their own names. Those of a closed one are exported under the names they had before it was made, if their number has not changed.

## Dissolve {#dissolve}

Right-click a composite part in the list → **Dissolve composite part**. A [Delete part](delete-part) feature with **Dissolve composite parts** checked is added to the history.

- A **closed** composite falls apart into its parts, with their names, colors and materials back.
- An **open** one just goes, and its parts stay. Deleting an open composite does the same: its parts are not deleted.

You can also delete or suppress the **Composite part** feature itself in the feature list.

## Details {#details}

- A closed composite has one color for all its bodies.
- The mate connectors of the parts a closed composite consumes go to it; dissolved, they go back to the body they stand on.
- [Agent API](agent-api): `{"op":"composite","parts":["Part 1","Part 2"],"closed":true}`; to dissolve — `{"op":"deletePart","parts":"Composite part 1","dissolve":true}`.

## See also {#see-also}

[Parts and appearance](parts), [Delete part](delete-part), [Boolean](boolean), [Assemblies](assembly).
