// The tool search of the Part Studio toolbar: names in the interface language or in English, best matches first.

import { describe, expect, it } from 'vitest';
import { searchTools } from './Toolbar';

const RU: Record<string, string> = { Plane: 'Плоскость', Helix: 'Спираль', 'Linear pattern': 'Линейный массив', 'Circular pattern': 'Круговой массив', Split: 'Разделить' };
const ru = (s: string) => RU[s] ?? s;

describe('tool search', () => {
  it('finds tools by their name in the interface language', () => {
    expect(searchTools('Пл', ru).map((x) => x.id)).toEqual(['plane']);
    expect(searchTools('  массив ', ru).map((x) => x.id)).toEqual(['linearPattern', 'circularPattern']);
  });

  it('finds them by the English name too, names that start with the query first', () => {
    // "Plane" starts with it, "Replace face" has it inside
    expect(searchTools('pla', ru).map((x) => x.id)).toEqual(['plane', 'replaceFace']);
    // a word of the name starts with it
    expect(searchTools('pattern').map((x) => x.id)).toEqual(['linearPattern', 'circularPattern', 'curvePattern']);
    expect(searchTools('li').map((x) => x.id)[0]).toBe('linearPattern');
    expect(searchTools('xyz')).toEqual([]);
    expect(searchTools('   ')).toEqual([]);
  });
});
