// Assembly placement: rotations, moved meshes, composition and insert positions.

import { describe, expect, it } from 'vitest';
import type { AssemblyTab, Vec3 } from '../core/types';
import type { PartMesh } from '../kernel/protocol';
import { applyPoint, composeAssembly, insertPosition, instanceName, placeMesh, rotationAngles, rotationMatrix, type AssemblySources } from './compose';

/** A 10 × 4 × 2 box-like mesh (only what placement touches). */
function boxMesh(id: string): PartMesh {
  const pts: Vec3[] = [
    [0, 0, 0],
    [10, 0, 0],
    [10, 4, 0],
    [0, 4, 2],
  ];
  return {
    id,
    name: 'Part 1',
    color: '#a9bfd6',
    hidden: false,
    positions: new Float32Array(pts.flat()),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    faceRanges: new Int32Array([0, 3]),
    edgePositions: new Float32Array([0, 0, 0, 10, 0, 0]),
    edgeRanges: new Int32Array([0, 2]),
    vertices: new Float32Array([0, 0, 0]),
    faces: [{ type: 'PLANE', center: [5, 2, 0], normal: [0, 0, 1], area: 40 }],
    edges: [{ type: 'LINE', center: [5, 0, 0], start: [0, 0, 0], end: [10, 0, 0], length: 10, dir: [1, 0, 0] }],
    bbox: [
      [0, 0, 0],
      [10, 4, 2],
    ],
  };
}

const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

describe('assembly placement', () => {
  it('rotation angles round-trip through the matrix', () => {
    for (const r of [
      [0, 0, 0],
      [30, 0, 0],
      [0, 45, 0],
      [10, -20, 135],
      [-170, 60, 15],
    ] as Vec3[])
      close(rotationAngles(rotationMatrix(r)), r);
    // 90° about Z turns X into Y
    close(applyPoint({ R: rotationMatrix([0, 0, 90]), t: [0, 0, 0] }, [1, 0, 0]), [0, 1, 0]);
  });

  it('moves the mesh and its geometry info', () => {
    const m = placeMesh(boxMesh('p1'), { R: rotationMatrix([0, 0, 90]), t: [100, 0, 0] }, 'in1', 'Part 1 <1>');
    expect(m.id).toBe('in1');
    close(Array.from(m.positions.slice(3, 6)), [100, 10, 0]);
    close(m.faces[0].center, [98, 5, 0]);
    close(m.edges[0].dir!, [0, 1, 0]);
    close(m.bbox[0], [96, 0, 0]);
    close(m.bbox[1], [100, 10, 2]);
  });

  it('composes instances, reports missing sources and names / places new ones', () => {
    const src = boxMesh('p1');
    const sources: AssemblySources = new Map([['ps1', { parts: new Map([['p1', src]]), mates: [] }]]);
    const tab: AssemblyTab = {
      id: 'as1',
      type: 'assembly',
      name: 'Assembly 1',
      instances: [
        { id: 'a', name: 'Part 1 <1>', studioId: 'ps1', partId: 'p1', position: [0, 0, 0], rotation: [0, 0, 0] },
        { id: 'b', name: 'Part 1 <2>', studioId: 'ps1', partId: 'gone', position: [0, 0, 0], rotation: [0, 0, 0] },
        { id: 'c', name: 'Part 1 <3>', studioId: 'ps1', partId: 'p1', position: [0, 0, 20], rotation: [0, 0, 0], hidden: true },
      ],
    };
    const { build, missing } = composeAssembly(tab, sources);
    expect(build.parts.map((p) => p.id)).toEqual(['a', 'c']);
    expect(build.parts[1].hidden).toBe(true);
    expect(missing).toEqual(['b']);
    expect(instanceName(tab, 'Part 1')).toBe('Part 1 <4>');
    // next instance goes past the rightmost one (x = 10) with a gap
    const pos = insertPosition(tab, sources, src);
    expect(pos[0]).toBeGreaterThan(10);
    expect(insertPosition({ ...tab, instances: [] }, sources, src)).toEqual([0, 0, 0]);
  });

  it("carries the part's mate connectors with each instance", () => {
    const src = boxMesh('p1');
    const frame = { origin: [1, 0, 0] as Vec3, xDir: [1, 0, 0] as Vec3, yDir: [0, 1, 0] as Vec3, normal: [0, 0, 1] as Vec3 };
    const sources: AssemblySources = new Map([
      [
        'ps1',
        {
          parts: new Map([['p1', src]]),
          mates: [
            { featureId: 'mc1', name: 'MC1', frame, owner: 'p1' },
            { featureId: 'mc2', name: 'Other', frame, owner: 'p2' },
          ],
        },
      ],
    ]);
    const tab: AssemblyTab = {
      id: 'as1',
      type: 'assembly',
      name: 'A',
      instances: [{ id: 'a', name: 'Part 1 <1>', studioId: 'ps1', partId: 'p1', position: [0, 5, 0], rotation: [0, 0, 90] }],
    };
    const { build } = composeAssembly(tab, sources);
    expect(build.mates.map((m) => m.featureId)).toEqual(['a|mc1']);
    close(build.mates[0].frame.origin, [0, 6, 0]);
    close(build.mates[0].frame.xDir, [0, 1, 0]);
  });
});
