// The left panel's width and the share of its two lists stay usable whatever was dragged, and are remembered.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clampSplit, clampWidth, loadSplit, loadWidth, MIN_WIDTH, saveSplit, saveWidth } from './panelSize';

describe('the left panel width', () => {
  it('stays as dragged in a roomy window', () => {
    expect(clampWidth(380, 1600)).toBe(380);
    expect(clampWidth(380.6, 1600)).toBe(381);
  });

  it('is not narrower than its minimum', () => {
    expect(clampWidth(40, 1600)).toBe(MIN_WIDTH);
  });

  it('leaves the graphics area room, and is never past 720 px', () => {
    expect(clampWidth(900, 1000)).toBe(680);
    expect(clampWidth(2000, 3000)).toBe(720);
    // a window too narrow for both: the panel keeps its minimum
    expect(clampWidth(500, 400)).toBe(MIN_WIDTH);
  });
});

describe('the share of the upper list', () => {
  it('stays as dragged when both lists keep room', () => {
    expect(clampSplit(0.3, 800)).toBe(0.3);
    expect(clampSplit(0.12345, 800)).toBe(0.123);
  });

  it('leaves each list its header and a couple of rows', () => {
    expect(clampSplit(0, 840)).toBe(0.1);
    expect(clampSplit(1, 840)).toBe(0.9);
  });

  it('splits in half when the panel is too low for both', () => {
    expect(clampSplit(0.9, 100)).toBe(0.5);
    expect(clampSplit(0.2, 0)).toBe(0.5);
  });
});

describe('remembered sizes', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('keeps the width and each kind of panel its own share', () => {
    expect(loadWidth()).toBeNull();
    saveWidth(360);
    saveSplit('partStudio', 0.4);
    expect(loadWidth()).toBe(360);
    expect(loadSplit('partStudio')).toBe(0.4);
    expect(loadSplit('assembly')).toBeNull();
  });

  it('forgets them on a reset, and ignores what is not a size', () => {
    saveWidth(360);
    saveWidth(null);
    expect(loadWidth()).toBeNull();
    store.set('webcad.leftPanel.split.assembly', '1.5');
    store.set('webcad.leftPanel.width', 'wide');
    expect(loadSplit('assembly')).toBeNull();
    expect(loadWidth()).toBeNull();
  });

  it('a browser without storage keeps the usual sizes', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadWidth()).toBeNull();
    expect(() => saveSplit('partStudio', 0.4)).not.toThrow();
  });
});
