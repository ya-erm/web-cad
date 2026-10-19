// Stepping a value field up / down (its ▲▼ buttons, the arrow keys): a plain number with an optional unit moves by a
// step that suits the unit; expressions (variables, arithmetic) are not stepped.

/** The step of a unit: 1 mm, 0.1 cm / in / ft, 0.01 m, 1°, 0.1 rad; a bare number — 1, or 0.1 if it has decimals. */
function unitStep(unit: string, number: string): number {
  switch (unit.toLowerCase()) {
    case 'mm':
    case 'deg':
    case '°':
      return 1;
    case 'cm':
    case 'in':
    case 'ft':
    case 'rad':
      return 0.1;
    case 'm':
      return 0.01;
    default:
      return number.includes('.') ? 0.1 : 1;
  }
}

/**
 * `text` moved one step up (`dir` 1) or down (−1); `scale` — Shift ×10, Alt ×0.1. None for an expression.
 * The unit and its spacing are kept ("10 mm" → "11 mm", "0.5" → "0.6").
 */
export function stepExpression(text: string, dir: 1 | -1, scale = 1): string | null {
  const m = /^\s*(-?\d*\.?\d+)(\s*)(mm|cm|m|in|ft|deg|rad|°)?\s*$/i.exec(text);
  if (!m) return null;
  const step = unitStep(m[3] ?? '', m[1]) * scale;
  const v = parseFloat(m[1]) + dir * step;
  // as many decimals as the step needs, no float noise
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9), (m[1].split('.')[1] ?? '').length);
  const s = v.toFixed(Math.min(decimals, 6)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return `${s === '-0' ? '0' : s}${m[2]}${m[3] ?? ''}`;
}
