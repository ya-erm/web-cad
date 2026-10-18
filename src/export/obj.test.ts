import { describe, expect, it } from 'vitest';
import { writeOBJ } from './obj';

describe('writeOBJ', () => {
  it('writes 1-based global indices with optional normals', () => {
    const obj = writeOBJ([
      { name: 'first part', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] },
      {
        name: 'second',
        positions: new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1]),
        normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
      },
    ]);
    const lines = obj.trim().split('\n');
    expect(lines).toContain('o first_part');
    expect(lines).toContain('o second');
    expect(lines.filter((l) => l.startsWith('v ')).length).toBe(7);
    expect(lines.filter((l) => l.startsWith('vn ')).length).toBe(4);
    expect(lines).toContain('f 1 2 3');
    expect(lines).toContain('f 4//1 5//2 6//3');
    expect(lines).toContain('f 5//2 7//4 6//3');
    expect(lines).toContain('v 1 0 0');
    expect(lines).toContain('vn 0 0 1');
  });
});
