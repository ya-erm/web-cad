# Bill of materials {#bom}

[Assembly overview](assembly) · Product structure, quantities, part properties and CSV.

The **Bill of materials** button (the table at the right of the toolbar) shows the list of parts in the assembly: one row per part with its **Quantity** — how many instances use it — and the Part Studio it comes from.

Choose the type of the bill of materials in the list in its header (as in Onshape):

| Type | Rows |
|---|---|
| **Structured** (default) | The instances of this assembly, and under each [sub-assembly](assembly-subassemblies#subassemblies) its parts and nested sub-assemblies, indented. Items are numbered by levels: "2", "2.1", "2.1.3". The **Quantity** inside a sub-assembly is how many there are in one sub-assembly. The arrow of a sub-assembly collapses and expands its rows. |
| **Flattened** | Parts only — from all levels together, with the total quantity. |
| **Top-level only** | The instances of this assembly: parts and sub-assemblies, without what is inside them. |

- **Part number**, **Description** and **Material** are part properties: click the cell and type; `Enter` saves the value with the part in its Part Studio (one undo step), so every assembly that uses the part shows it. Sub-assembly rows have no such properties.
- Instances of one part in different [configuration variants](assembly-instances#position) are different rows; the instance's options are added to the part name: "Plate (Large)".
- The **Columns** button (the funnel) shows or hides columns.
- A click on a row selects the instances of that part (or sub-assembly).
- The download button saves the shown columns as a CSV file, which opens in spreadsheets; the CSV has every row, collapsed ones too, and the item number shows the level.

```figure
image: ../images/assembly-bom.jpg
alt: Assembly bill of materials: one base and one pin
caption: This assembly has two rows: Base and Pin, quantity 1 each. Part number, description and material can be edited directly in the table.
width: 760
```
