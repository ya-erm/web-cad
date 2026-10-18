# Variables and expressions

Variables make a model parametric: you define a size once and use it in sketches and features. When you change a variable, everything that depends on it rebuilds.

## Creating a variable {#create}

1. Place the [rollback bar](feature-list#rollback) where the variable should appear (usually at the start of the history).
2. Click **Variable** on the toolbar (or **Add variable** in the variable table).
3. Choose the type, enter the **Name** and **Value**, and optionally a **Description**.
4. Click ✓ (`Enter`).

A variable is visible only to features that are **below** it in the feature list. For details on the dialog, see [Variable](variable).

## Using variables {#use}

Type `#name` in any numeric field of a feature dialog or in a [sketch dimension](sketch-dimensions):

- `#width`
- `#width / 2`
- `#d + 2 * #wall`

A sketch dimension defined by an expression is marked with the **fx** icon.

## Variable table {#table}

The **Variable table** button (below the view menu in the top-right corner of the graphics area) opens a list of all variables in the Part Studio:

```figure
image: ../images/variable-table.jpg
alt: Variable table with the #width variable
width: 377
```

| Column | Contents |
|---|---|
| **Name** | The `#name` of the variable. |
| **Value** | The evaluated value in document units (in red if the expression has an error). |
| **Expression** | Click to edit the expression directly in the table: `Enter` applies, `Esc` cancels. |

- Double-click a row to open the variable dialog.
- The **+** button (**Add variable**) inserts a new variable at the rollback bar position and opens its dialog.
- Variables below the rollback bar and suppressed variables are shown dimmed.

## Expressions {#expressions}

Expressions work in any numeric field, in sketch dimensions, in sketch pattern parameters, and in variable values.

| What | Examples |
|---|---|
| Numbers | `10`, `2.5`, `.5`, `1e3` |
| Length units | `mm`, `cm`, `m`, `in`, `ft`, `yd`, `um` (also `millimeter`, `meter`, `inch`, `foot`) |
| Angle units | `deg`, `rad`, `°` (also `degree`, `radian`) |
| Operators | `+`, `-`, `*`, `/`, `^` (power), parentheses |
| Functions | `sqrt`, `abs`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `min`, `max`, `floor`, `ceil`, `round` |
| Constant | `pi` (or `PI`) |
| Variables | `#name` |

Rules:

- A number without length units is interpreted in document units; an angle without units, in degrees.
- You can add a unitless number to a value with units: `10 + 5 mm` = 15 mm.
- You cannot add a length to an angle: `10 mm + 5 deg` gives the error "Mismatched units".
- `sin`, `cos`, `tan` take an angle; a unitless number is treated as degrees.
- An invalid expression is highlighted in red, and the field is not applied.

## Examples {#examples}

| Expression | Value |
|---|---|
| `1 in + 3 mm` | 28.4 mm |
| `#width / 2` | half the width |
| `sqrt(#a^2 + #b^2)` | hypotenuse |
| `360 deg / #n` | angular spacing for `#n` instances |
| `max(#t, 2 mm)` | at least 2 mm |
