import { describe, expect, it } from 'vitest';
import { build3MFModel, weldVertices, write3MF } from './threemf';
import { crc32 } from './zip';

/** Test-only reader for STORE zips: returns name -> content. */
function readZip(buf: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const dec = new TextDecoder();
  const end = buf.length - 22;
  expect(dv.getUint32(end, true)).toBe(0x06054b50);
  const count = dv.getUint16(end + 10, true);
  let o = dv.getUint32(end + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    expect(dv.getUint32(o, true)).toBe(0x02014b50);
    const crc = dv.getUint32(o + 16, true);
    const size = dv.getUint32(o + 20, true);
    const nameLen = dv.getUint16(o + 28, true);
    const skip = dv.getUint16(o + 30, true) + dv.getUint16(o + 32, true);
    const local = dv.getUint32(o + 42, true);
    const name = dec.decode(buf.subarray(o + 46, o + 46 + nameLen));
    o += 46 + nameLen + skip;
    expect(dv.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = buf.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    out.set(name, data);
  }
  return out;
}

// Unit cube as 12 independent triangles (36 unwelded vertices).
function soupCube(): { positions: number[]; indices: number[] } {
  const quads = [
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  ];
  const positions: number[] = [];
  for (const [a, b, c, d] of quads) positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  return { positions, indices: positions.map((_, i) => i).filter((i) => i < positions.length / 3) };
}

describe('weldVertices', () => {
  it('merges coincident vertices', () => {
    const cube = soupCube();
    expect(cube.positions.length / 3).toBe(36);
    const w = weldVertices(cube.positions, cube.indices);
    expect(w.positions.length / 3).toBe(8);
    expect(w.indices.length).toBe(36);
  });

  it('merges vertices within tolerance and drops degenerate triangles', () => {
    const w = weldVertices([0, 0, 0, 1, 0, 0, 0, 1, 0, 1 + 1e-8, 0, 0, 1, 1e-9, 0], [0, 1, 2, 3, 2, 0, 1, 3, 4]);
    expect(w.positions.length / 3).toBe(3);
    expect(w.indices).toEqual([0, 1, 2, 1, 2, 0]);
  });
});

describe('write3MF', () => {
  const cube = soupCube();
  const zip = write3MF([
    { name: 'Cube & Co', color: '#ff8000', positions: new Float32Array(cube.positions), indices: new Uint32Array(cube.indices) },
    { name: 'Plain', positions: cube.positions.map((v) => v + 2), indices: cube.indices },
    { name: 'Empty', positions: [], indices: [] },
  ]);
  const files = readZip(zip);

  it('contains the required package parts', () => {
    expect([...files.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
    const ct = new TextDecoder().decode(files.get('[Content_Types].xml'));
    expect(ct).toContain('application/vnd.ms-package.3dmanufacturing-3dmodel+xml');
    const rels = new TextDecoder().decode(files.get('_rels/.rels'));
    expect(rels).toContain('Target="/3D/3dmodel.model"');
  });

  it('writes welded meshes, materials and build items', () => {
    const model = new TextDecoder().decode(files.get('3D/3dmodel.model'));
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain('<basematerials id="1">');
    expect(model).toContain('displaycolor="#FF8000"');
    expect(model).toContain('name="Cube &amp; Co" pid="1" pindex="0"');
    expect((model.match(/<object /g) ?? []).length).toBe(2);
    expect((model.match(/<vertex /g) ?? []).length).toBe(16);
    expect((model.match(/<triangle /g) ?? []).length).toBe(24);
    expect((model.match(/<item objectid="\d+"\/>/g) ?? []).length).toBe(2);
    expect(model).toContain('<vertex x="3" y="3" z="3"/>');
  });

  it('supports inch units and objects without colours', () => {
    const model = build3MFModel([{ name: 'a', positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }], {
      unit: 'inch',
    });
    expect(model).toContain('unit="inch"');
    expect(model).not.toContain('basematerials');
    expect(model).toContain('<object id="1" type="model" name="a">');
  });
});
