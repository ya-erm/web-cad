// Configurations: the chosen options set the configured parameters of features; edits of configured parameters go
// to the chosen option's cells.

import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import type { ConfigInput, Feature, PartStudioTab } from './types';
import { chosenLabel, commitConfigured, configKey, configuredFeatures, DIM, inputName, parseSourceKey, pruneConfiguration, setConfigured, sourceKey, variantStudio } from './config';

const extrude = { id: 'e', type: 'extrude', name: 'Extrude 1', params: { depth: '10 mm', thin: false } } as unknown as Feature;
const fillet = { id: 'f', type: 'fillet', name: 'Fillet 1', params: { radius: '3 mm' } } as unknown as Feature;
const size: ConfigInput = {
  id: 'size',
  name: 'Size',
  options: [
    { id: 's', name: 'Small' },
    { id: 'l', name: 'Large' },
  ],
  params: [configKey('e', 'depth'), configKey('e', 'thin'), configKey('f', 'suppressed')],
  values: { s: {}, l: { 'e/depth': '25 mm', 'e/thin': 'true', 'f/suppressed': 'true' } },
};
const studio = (choice?: string): PartStudioTab =>
  ({ id: 'ps', type: 'partStudio', name: 'PS', features: [extrude, fillet], rollback: null, parts: {}, configuration: [size], ...(choice ? { configChoice: { size: choice } } : {}) }) as PartStudioTab;

describe('configurations', () => {
  it('the first option by default: cells left empty keep the features as they are', () => {
    const s = studio();
    expect(configuredFeatures(s)).toEqual(s.features);
    expect(configuredFeatures(s)[0]).toBe(extrude);
  });

  it('the chosen option sets expressions, checkboxes and suppression', () => {
    const [e, f] = configuredFeatures(studio('l'));
    expect(e.params).toMatchObject({ depth: '25 mm', thin: true });
    expect(f.suppressed).toBe(true);
    // the features themselves do not change
    expect(extrude.params).toMatchObject({ depth: '10 mm', thin: false });
  });

  it('a later input wins for the same parameter', () => {
    const more: ConfigInput = { id: 'm', name: 'More', options: [{ id: 'x', name: 'X' }], params: ['e/depth'], values: { x: { 'e/depth': '99 mm' } } };
    const s = { ...studio('l'), configuration: [size, more] };
    expect(configuredFeatures(s)[0].params).toMatchObject({ depth: '99 mm' });
  });

  it('a configured parameter typed in a dialog goes to the chosen option, the feature keeps its own', () => {
    const next = produce(studio('l'), (s) => {
      const typed = { ...configuredFeatures(s)[0], params: { depth: '30 mm', thin: true } } as Feature;
      s.features[0] = commitConfigured(s, s.features[0] as Feature, typed);
    });
    expect(next.features[0].params).toMatchObject({ depth: '10 mm', thin: false });
    expect(next.configuration![0].values.l['e/depth']).toBe('30 mm');
    // unchanged values do not fill empty cells
    const small = produce(studio('s'), (s) => {
      s.features[0] = commitConfigured(s, s.features[0] as Feature, configuredFeatures(s)[0]);
    });
    expect(small.configuration![0].values.s).toEqual({});
  });

  it('suppression set by hand, and parameters of features that are gone', () => {
    const s = produce(studio('s'), (d) => void setConfigured(d, 'f', 'suppressed', 'true'));
    expect(s.configuration![0].values.s['f/suppressed']).toBe('true');
    expect(setConfigured(structuredClone(studio()), 'f', 'radius', '1 mm')).toBe(false);
    const pruned = produce(studio('l'), (d) => {
      d.features = d.features.filter((f) => f.id !== 'f');
      pruneConfiguration(d);
    });
    expect(pruned.configuration![0].params).toEqual(['e/depth', 'e/thin']);
    expect(pruned.configuration![0].values.l).toEqual({ 'e/depth': '25 mm', 'e/thin': 'true' });
  });

  it('a sketch dimension in the table: the chosen value, and an edit of the sketch goes to its cell', () => {
    const sketch = {
      id: 'sk',
      type: 'sketch',
      name: 'Sketch 1',
      params: { plane: { kind: 'std', name: 'top' }, entities: [], constraints: [{ id: 'c1', type: 'distance', refs: [], value: '40 mm' }] },
    } as unknown as Feature;
    const width: ConfigInput = { id: 'w', name: 'Width', options: [{ id: 'n', name: 'Narrow' }, { id: 'v', name: 'Wide' }], params: [configKey('sk', `${DIM}c1`)], values: { v: { [`sk/${DIM}c1`]: '80 mm' } } };
    const s = { id: 'ps', type: 'partStudio', name: 'PS', features: [sketch], rollback: null, parts: {}, configuration: [width], configChoice: { w: 'v' } } as unknown as PartStudioTab;
    const dim = (f: Feature) => (f.type === 'sketch' ? f.params.constraints[0].value : undefined);
    expect(dim(configuredFeatures(s)[0])).toBe('80 mm');
    expect(dim(configuredFeatures(s, { w: 'n' })[0])).toBe('40 mm');
    const next = produce(s, (d) => {
      const shown = configuredFeatures(d)[0];
      const typed = produce(shown, (f) => void (f.type === 'sketch' && (f.params.constraints[0].value = '90 mm')));
      d.features[0] = commitConfigured(d, d.features[0] as Feature, typed);
    });
    expect(dim(next.features[0])).toBe('40 mm');
    expect(next.configuration![0].values.v[`sk/${DIM}c1`]).toBe('90 mm');
  });

  it('a variable input: any value typed for it, its own by default; an edit sets the value; gone with its variable', () => {
    const len = { id: 'v', type: 'variable', name: 'Variable 1', params: { name: 'len', value: '40 mm', description: '', varType: 'length' } } as Feature;
    const input: ConfigInput = { id: 'cv', name: 'len', kind: 'variable', options: [], params: [configKey('v', 'value')], values: {} };
    const s = { id: 'ps', type: 'partStudio', name: 'PS', features: [len, extrude], rollback: null, parts: {}, configuration: [input] } as unknown as PartStudioTab;
    const value = (f: Feature) => (f.type === 'variable' ? f.params.value : undefined);
    expect(value(configuredFeatures(s)[0])).toBe('40 mm');
    expect(value(configuredFeatures(s, { cv: '65 mm' })[0])).toBe('65 mm');
    expect(inputName(s.features, input)).toBe('#len');
    expect(chosenLabel(s.features, input)).toBe('40 mm');
    expect(chosenLabel(s.features, input, { cv: '65 mm' })).toBe('65 mm');
    // an instance's (a view's) own value: a variant of its own
    const v = variantStudio(s, { cv: '70 mm' });
    expect(v.id).toBe('ps#cv=70%20mm');
    // and back
    expect(parseSourceKey(v.id)).toEqual({ studioId: 'ps', configuration: { cv: '70 mm' } });
    expect(parseSourceKey('ps')).toEqual({ studioId: 'ps' });
    expect(parseSourceKey(sourceKey({ studioId: 'ps', configuration: { 'a,b': 'x=1, y', c: 'max(1,2)' } }))).toEqual({ studioId: 'ps', configuration: { 'a,b': 'x=1, y', c: 'max(1,2)' } });
    expect(sourceKey({ studioId: 'ps', configuration: { cv: '70 mm' } })).toBe(v.id);
    expect(value(configuredFeatures(v)[0])).toBe('70 mm');
    // typed in the variable table: the value now, the variable keeps its own
    const typed = produce(s, (d) => void setConfigured(d, 'v', 'value', '50 mm'));
    expect(typed.configChoice).toEqual({ cv: '50 mm' });
    expect(value(typed.features[0])).toBe('40 mm');
    // the variable deleted: its input goes too
    const pruned = produce(typed, (d) => {
      d.features = d.features.filter((f) => f.id !== 'v');
      pruneConfiguration(d);
    });
    expect(pruned.configuration).toBeUndefined();
    expect(pruned.configChoice).toEqual({});
  });
});
