import { describe, expect, it } from 'vitest';
import { writeSTLAscii, writeSTLBinary } from './stl';

const tetra = {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
  indices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
};

describe('writeSTLBinary', () => {
  it('has length 84 + 50 * triangles and correct normals', () => {
    const second = { positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) };
    const buf = writeSTLBinary([tetra, second], 'solid-looking name');
    expect(buf.length).toBe(84 + 50 * 5);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    expect(dv.getUint32(80, true)).toBe(5);
    expect(new TextDecoder().decode(buf.subarray(0, 5))).not.toBe('solid');
    // First facet (0,2,1) lies in z=0 with normal -Z.
    expect([dv.getFloat32(84, true), dv.getFloat32(88, true), dv.getFloat32(92, true)]).toEqual([0, 0, -1]);
    // Its second vertex is (0,1,0).
    expect([dv.getFloat32(84 + 24, true), dv.getFloat32(84 + 28, true), dv.getFloat32(84 + 32, true)]).toEqual([0, 1, 0]);
    // Last facet normal is +Z.
    const last = 84 + 50 * 4;
    expect(dv.getFloat32(last + 8, true)).toBe(1);
    expect(dv.getUint16(last + 48, true)).toBe(0);
  });

  it('writes an empty file for no meshes', () => {
    expect(writeSTLBinary([]).length).toBe(84);
  });
});

describe('writeSTLAscii', () => {
  it('writes facets with normals', () => {
    const s = writeSTLAscii([tetra], 'part 1');
    expect(s.startsWith('solid part_1\n')).toBe(true);
    expect(s.trimEnd().endsWith('endsolid part_1')).toBe(true);
    expect((s.match(/facet normal/g) ?? []).length).toBe(4);
    expect((s.match(/vertex /g) ?? []).length).toBe(12);
    expect(s).toContain('facet normal 0.000000e+0 0.000000e+0 -1.000000e+0');
  });
});
