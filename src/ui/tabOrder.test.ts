import { describe, expect, it } from 'vitest';
import { reorderTabs } from './tabOrder';
const tabs = ['a', 'b', 'c', 'd'].map((id) => ({ id, features: [] }));
const ids = (value: typeof tabs) => value.map((tab) => tab.id);
describe('tab order', () => {
  it('moves either direction before or after an identity', () => {
    expect(ids(reorderTabs(tabs, 'a', 'c', false))).toEqual(['b', 'a', 'c', 'd']);
    expect(ids(reorderTabs(tabs, 'a', 'c', true))).toEqual(['b', 'c', 'a', 'd']);
    expect(ids(reorderTabs(tabs, 'd', 'b', false))).toEqual(['a', 'd', 'b', 'c']);
    expect(ids(reorderTabs(tabs, 'd', 'b', true))).toEqual(['a', 'b', 'd', 'c']);
  });
  it('keeps no-op and invalid drops out of undo history', () => {
    for (const [source, target, after] of [['a', 'a', true], ['missing', 'b', true], ['a', 'missing', false], ['a', 'b', false], ['c', 'b', true]] as const)
      expect(reorderTabs(tabs, source, target, after)).toBe(tabs);
  });
  it('does not lose imported tabs with ambiguous duplicate identities', () => {
    const duplicate = [{ id: 'a' }, { id: 'a' }, { id: 'b' }];
    expect(reorderTabs(duplicate, 'a', 'b', true)).toBe(duplicate);
    expect(reorderTabs(duplicate, 'b', 'a', false)).toBe(duplicate);
    expect(duplicate).toHaveLength(3);
  });
  it('preserves all model references and never mutates the input', () => {
    for (const source of tabs) for (const target of tabs) for (const after of [true, false]) {
      const next = reorderTabs(tabs, source.id, target.id, after);
      expect(next).toHaveLength(tabs.length);
      expect(new Set(next).size).toBe(tabs.length);
      expect([...next].sort((a, b) => a.id.localeCompare(b.id))).toEqual(tabs);
      for (const tab of next) expect(tab).toBe(tabs.find((value) => value.id === tab.id));
    }
    expect(ids(tabs)).toEqual(['a', 'b', 'c', 'd']);
  });
});
