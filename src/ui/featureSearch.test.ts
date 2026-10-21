// The feature list's search: features found by their name as shown, their type (either language) or a variable's name.

import { afterEach, describe, expect, it } from 'vitest';
import type { Feature } from '../core/types';
import { featureMatches } from './FeatureTree';
import { getLang, setLang } from '../i18n';

const lang = getLang();
afterEach(() => setLang(lang));

const f = (type: string, name: string, params: Record<string, unknown> = {}) => ({ id: name, type, name, params }) as unknown as Feature;

describe('feature list search', () => {
  it('finds a feature by its name or its type, in the interface language or in English', () => {
    setLang('ru');
    const extrude = f('extrude', 'Extrude 1');
    const base = f('extrude', 'Основание');
    // the default name as shown ("Выдавливание 1") and as stored
    expect(featureMatches(extrude, 'выдав')).toBe(true);
    expect(featureMatches(extrude, 'Extrude')).toBe(true);
    // a name of its own: by it, and by the type
    expect(featureMatches(base, 'основ')).toBe(true);
    expect(featureMatches(base, 'выдавливание')).toBe(true);
    expect(featureMatches(base, 'extrude')).toBe(true);
    expect(featureMatches(base, 'отверстие')).toBe(false);
    // nothing typed: everything
    expect(featureMatches(base, '  ')).toBe(true);
  });

  it('finds a variable by its name', () => {
    const v = f('variable', 'Variable 1', { name: 'width', value: '20 mm' });
    expect(featureMatches(v, '#wid')).toBe(true);
    expect(featureMatches(v, '#len')).toBe(false);
  });
});
