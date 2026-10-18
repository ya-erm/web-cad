// Configurations: the chosen options set the configured parameters of features; edits of configured parameters go
// to the chosen option's cells.

import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import type { ConfigInput, Feature, PartStudioTab } from './types';
import { commitConfigured, configKey, configuredFeatures, pruneConfiguration, setConfigured } from './config';

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
});
