// Floating panels moved by their header stay inside the area they float in.

import { describe, expect, it } from 'vitest';
import { clampPlace } from './useDraggable';

describe('a moved panel', () => {
  const size = { w: 360, h: 200 };
  const area = { w: 1000, h: 600 };

  it('stays where it is put inside the area', () => {
    expect(clampPlace({ x: 300, y: 120 }, size, area)).toEqual({ x: 300, y: 120 });
  });

  it('is kept inside: not past the edges', () => {
    expect(clampPlace({ x: -50, y: -10 }, size, area)).toEqual({ x: 4, y: 4 });
    expect(clampPlace({ x: 900, y: 590 }, size, area)).toEqual({ x: 636, y: 396 });
  });

  it('a panel taller than the area keeps its header in it', () => {
    expect(clampPlace({ x: 10, y: 300 }, { w: 360, h: 900 }, area)).toEqual({ x: 10, y: 4 });
  });
});
