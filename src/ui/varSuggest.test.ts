import { describe, expect, it } from 'vitest';
import { matchingVariables, typedVariable, varChoices } from './varSuggest';

describe('Variable suggestions', () => {
  it('finds the "#name" being typed before the caret', () => {
    expect(typedVariable('#', 1)).toEqual({ start: 0, prefix: '' });
    expect(typedVariable('2 * #wi', 7)).toEqual({ start: 4, prefix: 'wi' });
    expect(typedVariable('#width + 5', 6)).toEqual({ start: 0, prefix: 'width' });
    // after a space or a number: nothing to suggest
    expect(typedVariable('#width ', 7)).toBeNull();
    expect(typedVariable('10', 2)).toBeNull();
  });

  it('lists the names starting with the letters first, then those containing them', () => {
    const all = varChoices(
      { wall: { v: 2, len: 1, ang: 0 }, width: { v: 40, len: 1, ang: 0 }, tilt: { v: Math.PI / 6, len: 0, ang: 1 }, n: { v: 4, len: 0, ang: 0 }, bowl: { v: 1, len: 0, ang: 0 } },
      { length: 'mm', angle: 'deg' },
    );
    expect(all.map((c) => `${c.name} ${c.value}`)).toEqual(['bowl 1', 'n 4', 'tilt 30°', 'wall 2 mm', 'width 40 mm']);
    expect(matchingVariables(all, 'W').map((c) => c.name)).toEqual(['wall', 'width', 'bowl']);
    expect(matchingVariables(all, '').length).toBe(5);
    // inches
    expect(varChoices({ w: { v: 25.4, len: 1, ang: 0 } }, { length: 'in', angle: 'deg' })[0].value).toBe('1 in');
  });
});
