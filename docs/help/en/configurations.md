# Configurations

A configuration makes **variants** of one model, as in Onshape: say, a "Small" and a "Large" plate, or a housing with and without a lid. The variants are a table: its rows are the variants, its columns are the parameters of features that differ between them.

## Creating a configuration {#create}

1. Click **Configurations** in the right strip of the graphics area (below the variable table button).
2. Click **Add input** and choose its kind:
   - **List** — an input **Configuration** with two options: **Default** and **Option 2**;
   - **Checkbox** — an input **Checkbox** with two options: **Off** and **On** (like Onshape's checkbox input). A checkbox always has these two options: you cannot add or delete them, and above the feature list the input shows as a tick box;
   - **Variable** — a number input (like Onshape's configuration variable), see [below](#variable).

   Rename the input and the options right in the table.
3. Click **+ Parameter** and choose a feature and its parameter: a size or an angle of the feature's dialog (say, the extrude's **Depth**), a checkbox (**Thin**, **Left handed**…), **Disabled** — whether the feature is disabled, or a variable's **Value**. A sketch lists its **dimensions** — numbered in the order they were made, with their current values (say, "Distance 2: 40 mm"). The parameter becomes a column of the table (the cross in its header removes it).
4. Fill in the cells: expressions as in any field (`25`, `25 mm`, `#w*2`), checkboxes with a tick. **An empty cell** keeps the feature's own value (shown grey in the cell).
5. **+ Option** below the table adds an option; the trash icon at the end of a row (shown on hover) deletes it — the last option stays.

The first option is the **default** one. There can be several inputs (say, "Size" and "Lid"); when two inputs set the same parameter, the lower one wins.

## Variable input {#variable}

A list gives a few options known in advance, a **variable** takes any value: say, the length of a profile chosen when it goes into an assembly.

1. In the **Add input** menu choose **Variable**. A variable `#var1` (a length, 10 mm) appears at the top of the feature list, and the panel gets its block: **Type** (length, angle, number, any) and the **Default value**. Rename the variable in its own dialog in the feature list.
2. Use `#var1` in feature fields and sketch dimensions like any [variable](variables).
3. Type its value above the feature list in the `#var1` field: an empty field is the default value (shown grey). A number without units takes the document's units.

Editing the variable's value in the variable table changes the input's current value, not the default one. Deleting the input leaves the variable in the feature list (features may use it); deleting the variable removes the input too.

## Choosing a variant {#choose}

When the Part Studio has a configuration, its inputs appear above the feature list: option lists, checkbox ticks and variable fields. Choose an option and the model rebuilds. The switch in the first column of the table does the same. Choosing an option is not an undo step.

## Editing in the chosen variant {#edit}

- A parameter set by the configuration has the configuration icon in the feature's dialog; its tooltip names the input and the chosen option. The dialog shows the chosen option's value, and what you type goes **into that option's cell** — the feature itself and the other options do not change.
- A sketch dimension set by the configuration shows the chosen option's value in the sketch; editing that dimension in the sketch writes into the chosen option's cell too.
- **Suppress / Unsuppress** in the feature list works the same way for a feature whose disabling the configuration sets, and so does editing a variable in the variable table.
- A deleted feature leaves the configuration tables too.

## What uses the configuration {#uses}

The variant is chosen for the whole Part Studio: its parts are built, its variables computed and its exports made in that variant; assemblies and drawings show the parts in the **chosen** variant by default.

**An assembly instance's own variant.** For an instance of a part in an assembly to take another variant, select it: its panel has a **Configuration** section with a list per input — **As in the Part Studio (…)** or a specific option (a variable has a value field; empty — as in the Part Studio). So one assembly can hold, say, a small and a large plate from the same Part Studio; the [bill of materials](assembly#bom) counts them as different rows and adds the option to the name: "Plate (Large)", "Profile (#len = 500 mm)". Mates and exports use the instance's part in its own variant.

**A drawing view's own variant.** Select a view on the sheet or in the **Views** list — its **View properties** get the same **Configuration** section. The views projected with it take the chosen variant too (as with the scale); the isometric view is chosen on its own. The list of views adds the variant to the name: "Front · 1:2 · Large". So one sheet can show, say, the small and the large plates.

See also [Variables and expressions](variables), [Feature list](feature-list), [Agent API](agent-api).
