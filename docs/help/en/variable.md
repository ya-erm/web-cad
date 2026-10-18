# Variable

The **Variable** feature defines a named value that you can use in any numeric field and sketch dimension further down the history: `#name`. For an overview of variables and the expression syntax, see [Variables and expressions](variables).

**Toolbar:** **Variable** · also the **+** button in the **Variable table**

```figure
image: ../images/variable-dialog.png
alt: The wall length variable with the expression #width / 10
caption: With #width = 40 mm, #width / 10 evaluates to 4 mm. Enter the new name without # and references to other variables with #.
width: 360
```

## Steps {#steps}

1. Move the rollback bar to where the variable should appear (usually to the beginning).
2. Click **Variable**.
3. Choose the type, enter the name and the value, then click ✓ (`Enter`).

## Options {#options}

| Field | Description |
|---|---|
| **Length** / **Angle** / **Number** / **Any** | Value type. For **Length**, a number without units is read in document units; for **Angle**, in degrees. **Any** keeps the units of the expression as they are. |
| **Name** | Name without `#`: Latin letters, digits and `_`, starting with a letter or `_` (for example, `width`, `wall_t`). |
| **Value** | A number or an expression; it can reference variables above: `#width / 2 + 3 mm`. |
| **Description** | Optional comment; shown in the tooltip in the variable table. |

## Details {#details}

- The Feature list shows `#name = value` next to the feature name.
- A variable is visible only to the features below it. A suppressed variable has no effect.
- If the name is invalid or the expression has an error, the feature is marked with a red dot ("Invalid variable name" and the like).
