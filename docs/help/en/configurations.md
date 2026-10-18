# Configurations

A configuration makes **variants** of one model, as in Onshape: say, a "Small" and a "Large" plate, or a housing with and without a lid. The variants are a table: its rows are the variants, its columns are the parameters of features that differ between them.

## Creating a configuration {#create}

1. Click **Configurations** in the right strip of the graphics area (below the variable table button).
2. Click **Add input** and choose its kind:
   - **List** — an input **Configuration** with two options: **Default** and **Option 2**;
   - **Checkbox** — an input **Checkbox** with two options: **Off** and **On** (like Onshape's checkbox input). A checkbox always has these two options: you cannot add or delete them, and above the feature list the input shows as a tick box.

   Rename the input and the options right in the table.
3. Click **+ Parameter** and choose a feature and its parameter: a size or an angle of the feature's dialog (say, the extrude's **Depth**), a checkbox (**Thin**, **Left handed**…), **Disabled** — whether the feature is disabled, or a variable's **Value**. A sketch lists its **dimensions** — numbered in the order they were made, with their current values (say, "Distance 2: 40 mm"). The parameter becomes a column of the table (the cross in its header removes it).
4. Fill in the cells: expressions as in any field (`25`, `25 mm`, `#w*2`), checkboxes with a tick. **An empty cell** keeps the feature's own value (shown grey in the cell).
5. **+ Option** below the table adds an option; the trash icon at the end of a row (shown on hover) deletes it — the last option stays.

The first option is the **default** one. There can be several inputs (say, "Size" and "Lid"); when two inputs set the same parameter, the lower one wins.

## Choosing a variant {#choose}

When the Part Studio has a configuration, its inputs appear above the feature list: option lists and checkbox ticks. Choose an option and the model rebuilds. The switch in the first column of the table does the same. Choosing an option is not an undo step.

## Editing in the chosen variant {#edit}

- A parameter set by the configuration has the configuration icon in the feature's dialog; its tooltip names the input and the chosen option. The dialog shows the chosen option's value, and what you type goes **into that option's cell** — the feature itself and the other options do not change.
- A sketch dimension set by the configuration shows the chosen option's value in the sketch; editing that dimension in the sketch writes into the chosen option's cell too.
- **Suppress / Unsuppress** in the feature list works the same way for a feature whose disabling the configuration sets, and so does editing a variable in the variable table.
- A deleted feature leaves the configuration tables too.

## What uses the configuration {#uses}

The variant is chosen for the whole Part Studio: its parts are built, its variables computed and its exports made in that variant, and drawings show the parts in the **chosen** variant.

**An assembly instance's own variant.** An instance of a part in an assembly shows the variant chosen in the Part Studio by default. To take another one, select the instance: its panel has a **Configuration** section with a list per input — **As in the Part Studio (…)** or a specific option. So one assembly can hold, say, a small and a large plate from the same Part Studio; the [bill of materials](assembly#bom) counts them as different rows and adds the option to the name: "Plate (Large)". Mates and exports use the instance's part in its own variant.

> **Limitation.** A drawing view cannot choose its own variant yet — it shows the one chosen in the Part Studio.

See also [Variables and expressions](variables), [Feature list](feature-list), [Agent API](agent-api).
