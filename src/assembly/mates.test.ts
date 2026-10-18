// Assembly mates: placements that satisfy fastened / revolute / slider / cylindrical / planar / ball mates.

import { describe, expect, it } from 'vitest';
import type { AssemblyMate, AssemblyMateType, AssemblyTab, MateRelation, Vec3 } from '../core/types';
import type { PartMesh } from '../kernel/protocol';
import { applyDir, applyPoint, placementOf, type AssemblySources } from './compose';
import {
  animatableMotions,
  animatedAssembly,
  applySolve,
  connectorFrame,
  constrainRelative,
  draggedAssembly,
  makeGroup,
  makeRelation,
  matedGroup,
  mateValues,
  mulVec,
  nearestFlip,
  solveAssembly,
  transpose,
} from './mates';

function mesh(
  id: string,
  faces: PartMesh['faces'],
  bbox: PartMesh['bbox'] = [
    [0, 0, 0],
    [1, 1, 1],
  ],
): PartMesh {
  return {
    id,
    name: id,
    color: '#ccc',
    hidden: false,
    positions: new Float32Array(),
    normals: new Float32Array(),
    indices: new Uint32Array(),
    faceRanges: new Int32Array(),
    edgePositions: new Float32Array(),
    edgeRanges: new Int32Array(),
    vertices: new Float32Array(),
    faces,
    edges: [],
    bbox,
  };
}

// plate: top face at z = 10 (normal +Z); pin: bottom face at z = 0 (normal −Z), length 20
const plate = mesh('plate', [{ type: 'PLANE', center: [0, 0, 10], normal: [0, 0, 1], area: 1 }]);
const pin = mesh('pin', [
  { type: 'PLANE', center: [0, 0, 0], normal: [0, 0, -1], area: 1 },
  { type: 'PLANE', center: [0, 0, 20], normal: [0, 0, 1], area: 1 },
]);
const sources: AssemblySources = new Map([
  [
    'ps',
    {
      parts: new Map([
        ['plate', plate],
        ['pin', pin],
      ]),
      mates: [],
    },
  ],
]);

function assembly(type: AssemblyMateType, pinPos: Vec3, pinRot: Vec3, opts: Partial<AssemblyMate> = {}, plateFixed = true): AssemblyTab {
  const tab: AssemblyTab = {
    id: 'as',
    type: 'assembly',
    name: 'A',
    instances: [
      { id: 'P', name: 'Plate <1>', studioId: 'ps', partId: 'plate', position: [0, 0, 0], rotation: [0, 0, 0], fixed: plateFixed },
      { id: 'N', name: 'Pin <1>', studioId: 'ps', partId: 'pin', position: pinPos, rotation: pinRot },
    ],
    mates: [],
  };
  const a = { instance: 'P', connector: { kind: 'face' as const, index: 0 } };
  const b = { instance: 'N', connector: { kind: 'face' as const, index: 0 } };
  tab.mates = [{ id: 'm1', name: 'M', type, a, b, flip: nearestFlip(sources, tab, a, b), ...opts }];
  return tab;
}

const near = (a: number[], b: number[], d = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d));
const pinOf = (tab: AssemblyTab) => placementOf(tab.instances[1]);

describe('assembly mates', () => {
  it('fastened: the pin stands on the plate, axis up, turned by the mate angle only', () => {
    const tab = assembly('fastened', [50, 0, 3], [0, 0, 30]);
    expect(tab.mates![0].flip).toBe(true);
    expect(applySolve(tab, sources)).toEqual([]);
    const pl = pinOf(tab);
    near(applyPoint(pl, [0, 0, 0]), [0, 0, 10]);
    near(applyDir(pl, [0, 0, 1]), [0, 0, 1]);
    // the plate did not move
    near(tab.instances[0].position, [0, 0, 0]);
  });

  it('revolute keeps the turn about the axis; slider keeps the slide along it', () => {
    const rev = assembly('revolute', [50, 0, 3], [0, 0, 30]);
    applySolve(rev, sources);
    const pr = pinOf(rev);
    near(applyPoint(pr, [0, 0, 0]), [0, 0, 10]);
    near(applyDir(pr, [1, 0, 0]), [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0]);

    const sl = assembly('slider', [0, 0, 25], [0, 0, 0]);
    applySolve(sl, sources);
    near(applyPoint(pinOf(sl), [0, 0, 0]), [0, 0, 25]);
    const cyl = assembly('cylindrical', [3, 4, 25], [0, 0, 45]);
    applySolve(cyl, sources);
    near(applyPoint(pinOf(cyl), [0, 0, 0]), [0, 0, 25]);
    near(applyDir(pinOf(cyl), [1, 0, 0]), [Math.SQRT1_2, Math.SQRT1_2, 0]);
  });

  it('planar keeps the in-plane offset; ball keeps the orientation', () => {
    const pl = assembly('planar', [30, -7, 40], [0, 0, 0]);
    applySolve(pl, sources);
    near(applyPoint(pinOf(pl), [0, 0, 0]), [30, -7, 10]);
    const ball = assembly('ball', [30, 0, 40], [20, 0, 0]);
    applySolve(ball, sources);
    near(applyPoint(pinOf(ball), [0, 0, 0]), [0, 0, 10]);
    near(ball.instances[1].rotation, [20, 0, 0]);
  });

  it('moves the first end when the second one is fixed; reports mates that cannot hold', () => {
    const tab = assembly('fastened', [0, 0, 0], [0, 0, 0], {}, false);
    tab.instances[1].fixed = true;
    tab.instances[1].position = [100, 0, 50];
    applySolve(tab, sources);
    // the plate came to the pin: its top face under the pin's bottom face
    near(applyPoint(placementOf(tab.instances[0]), [0, 0, 10]), [100, 0, 50]);

    const both = assembly('fastened', [40, 0, 0], [0, 0, 0]);
    both.instances[1].fixed = true;
    expect(solveAssembly(both, sources).failed).toEqual(['m1']);
  });
});

describe('parallel and pin slot mates, groups', () => {
  it('parallel: only the Z axes line up, the connector stays where it is', () => {
    const tab = assembly('parallel', [30, -7, 40], [20, 0, 0]);
    expect(applySolve(tab, sources)).toEqual([]);
    near(applyPoint(pinOf(tab), [0, 0, 0]), [30, -7, 40]);
    near(applyDir(pinOf(tab), [0, 0, 1]), [0, 0, 1]);
    near(applyDir(pinOf(tab), [1, 0, 0]), [1, 0, 0]);
  });

  it('pin slot: the pin stays in the slot (the first connector’s X axis) and keeps its turn', () => {
    const tab = assembly('pinSlot', [30, 12, 40], [0, 0, 30]);
    expect(applySolve(tab, sources)).toEqual([]);
    const slot = connectorFrame(sources, tab.instances[0], { kind: 'face', index: 0 })!;
    const d = [slot.R[0], slot.R[3], slot.R[6]];
    const s = 30 * d[0] + 12 * d[1];
    near(applyPoint(pinOf(tab), [0, 0, 0]), [s * d[0], s * d[1], 10]);
    near(applyDir(pinOf(tab), [0, 0, 1]), [0, 0, 1]);
    near(applyDir(pinOf(tab), [1, 0, 0]), [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0]);
  });

  it('pin slot along an edge of the slot: no mate connector needed', () => {
    const slotPlate: PartMesh = {
      ...mesh('sp', [{ type: 'PLANE', center: [0, 0, 10], normal: [0, 0, 1], area: 1 }]),
      edges: [{ type: 'LINE', start: [0, 0, 10], end: [10, 10, 10], center: [5, 5, 10], length: 14.142, dir: [Math.SQRT1_2, Math.SQRT1_2, 0] }],
    };
    const src: AssemblySources = new Map([['ps', { parts: new Map([['sp', slotPlate], ['pin', pin]]), mates: [] }]]);
    const tab: AssemblyTab = {
      id: 'as',
      type: 'assembly',
      name: 'S',
      instances: [
        { id: 'P', name: 'P', studioId: 'ps', partId: 'sp', position: [0, 0, 0], rotation: [0, 0, 0], fixed: true },
        { id: 'N', name: 'N', studioId: 'ps', partId: 'pin', position: [30, 12, 40], rotation: [0, 0, 0] },
      ],
    };
    const a = { instance: 'P', connector: { kind: 'face' as const, index: 0 } };
    const b = { instance: 'N', connector: { kind: 'face' as const, index: 0 } };
    tab.mates = [{ id: 'm', name: 'M', type: 'pinSlot', a, b, a2: { instance: 'P', connector: { kind: 'edge', index: 0 } }, flip: nearestFlip(src, tab, a, b) }];
    expect(applySolve(tab, src)).toEqual([]);
    // the pin went onto the 45° line through the face centre, at its projection
    near(applyPoint(placementOf(tab.instances[1]), [0, 0, 0]), [21, 21, 10]);
  });

  it('a group holds its members as they stood; dragging one carries the rest', () => {
    const tab = assembly('fastened', [50, 0, 3], [0, 0, 30]);
    tab.instances.push({ id: 'X', name: 'Pin <2>', studioId: 'ps', partId: 'pin', position: [60, 5, 3], rotation: [0, 0, 30] });
    const local = (t: AssemblyTab) => {
      const n = placementOf(t.instances[1]);
      const x = placementOf(t.instances[2]);
      return mulVec(transpose(n.R), [x.t[0] - n.t[0], x.t[1] - n.t[1], x.t[2] - n.t[2]]);
    };
    const before = local(tab);
    tab.groups = [makeGroup(tab, ['N', 'X'], 'g1', 'Group 1')];
    expect(applySolve(tab, sources)).toEqual([]);
    // N went onto the plate; X kept its place relative to N
    near(applyPoint(pinOf(tab), [0, 0, 0]), [0, 0, 10]);
    near(local(tab), before);
    near(tab.instances[2].rotation, tab.instances[1].rotation);
    expect([...matedGroup(tab, 'X')].sort()).toEqual(['N', 'P', 'X']);
    // with nothing fixed, dragging X brings the whole group along
    tab.instances[0].fixed = false;
    const dragged = draggedAssembly(tab, sources, 'X', [0, 0, 7], 0, [0, 0, 1], [0, 0, 0]);
    near(dragged.instances[1].position, [tab.instances[1].position[0], tab.instances[1].position[1], tab.instances[1].position[2] + 7]);
    near(dragged.instances[0].position, [0, 0, 7]);
  });
});

describe('tangent and width mates', () => {
  const src: AssemblySources = new Map([
    [
      'fs',
      {
        parts: new Map([
          ['plate', mesh('plate', [{ type: 'PLANE', center: [0, 0, 10], normal: [0, 0, 1], area: 1 }])],
          [
            'ball',
            mesh('ball', [{ type: 'SPHERE', center: [0, 0, 0], axisPoint: [0, 0, 0], radius: 5, area: 1 }], [
              [-5, -5, -5],
              [5, 5, 5],
            ]),
          ],
          ['rod', mesh('rod', [{ type: 'CYLINDRE', center: [0, 0, 0], axis: [1, 0, 0], axisPoint: [0, 0, 0], radius: 3, area: 1 }])],
          [
            'cone',
            mesh('cone', [{ type: 'CONE', center: [0, 0, 5], axis: [0, 0, 1], axisPoint: [0, 0, 0], apex: [0, 0, 0], semiAngle: Math.PI / 6, area: 1 }], [
              [-5, -5, 0],
              [5, 5, 10],
            ]),
          ],
          [
            'ring',
            mesh('ring', [{ type: 'TORUS', center: [0, 0, 0], axis: [0, 0, 1], axisPoint: [0, 0, 0], tubePoint: [8, 0, 0], majorRadius: 8, minorRadius: 2, area: 1 }], [
              [-10, -10, -2],
              [10, 10, 2],
            ]),
          ],
          [
            'slot',
            mesh('slot', [
              { type: 'PLANE', center: [-10, 0, 0], normal: [1, 0, 0], area: 1 },
              { type: 'PLANE', center: [10, 0, 0], normal: [-1, 0, 0], area: 1 },
            ]),
          ],
          [
            'tab',
            mesh('tab', [
              { type: 'PLANE', center: [-4, 0, 0], normal: [-1, 0, 0], area: 1 },
              { type: 'PLANE', center: [4, 0, 0], normal: [1, 0, 0], area: 1 },
            ]),
          ],
        ]),
        mates: [],
      },
    ],
  ]);
  const face = (instance: string, index: number) => ({ instance, connector: { kind: 'face' as const, index } });
  const two = (pa: string, pb: string, pos: Vec3, rot: Vec3 = [0, 0, 0], extra: Partial<AssemblyMate> = {}): AssemblyTab => {
    const tab: AssemblyTab = {
      id: 'as',
      type: 'assembly',
      name: 'T',
      instances: [
        { id: 'A', name: 'A', studioId: 'fs', partId: pa, position: [0, 0, 0], rotation: [0, 0, 0], fixed: true },
        { id: 'B', name: 'B', studioId: 'fs', partId: pb, position: pos, rotation: rot },
      ],
    };
    const type = extra.type ?? 'tangent';
    tab.mates = [{ id: 'm', name: 'M', type, a: face('A', 0), b: face('B', 0), flip: nearestFlip(src, tab, face('A', 0), face('B', 0), type), ...extra }];
    return tab;
  };
  const b = (tab: AssemblyTab) => placementOf(tab.instances[1]);

  it('a sphere rests on a plane, moving only along its normal', () => {
    const tab = two('plate', 'ball', [3, 4, 40]);
    expect(applySolve(tab, src)).toEqual([]);
    near(applyPoint(b(tab), [0, 0, 0]), [3, 4, 15], 5);
  });

  it('a cylinder lies on a plane: its axis turns parallel to the plane, at the radius', () => {
    const tab = two('plate', 'rod', [0, 0, 40], [0, 20, 0]);
    expect(applySolve(tab, src)).toEqual([]);
    expect(applyDir(b(tab), [1, 0, 0])[2]).toBeCloseTo(0, 5);
    expect(applyPoint(b(tab), [0, 0, 0])[2]).toBeCloseTo(13, 4);
  });

  it('a cylinder standing upright on the plane lies down on it', () => {
    // the rod's axis exactly along the plane's normal: a dead point for the solver, nudged out of
    const tab = two('plate', 'rod', [0, 0, 40], [0, -90, 0]);
    expect(applySolve(tab, src)).toEqual([]);
    expect(applyDir(b(tab), [1, 0, 0])[2]).toBeCloseTo(0, 5);
    expect(applyPoint(b(tab), [0, 0, 0])[2]).toBeCloseTo(13, 4);
  });

  it('a cone lies on a plane along a generator', () => {
    const tab = two('plate', 'cone', [3, 4, 30]);
    expect(applySolve(tab, src)).toEqual([]);
    // apex on the plane, the axis tilted up by the half-angle (30°)
    expect(applyPoint(b(tab), [0, 0, 0])[2]).toBeCloseTo(10, 4);
    expect(applyDir(b(tab), [0, 0, 1])[2]).toBeCloseTo(0.5, 5);
  });

  it('a torus lies flat on a plane, or stands on its rim like a wheel', () => {
    const flat = two('plate', 'ring', [0, 0, 30]);
    expect(applySolve(flat, src)).toEqual([]);
    near(applyPoint(b(flat), [0, 0, 0]), [0, 0, 12], 4);
    const wheel = two('plate', 'ring', [0, 0, 30], [80, 0, 0]);
    expect(applySolve(wheel, src)).toEqual([]);
    expect(applyPoint(b(wheel), [0, 0, 0])[2]).toBeCloseTo(20, 4);
    expect(applyDir(b(wheel), [0, 0, 1])[2]).toBeCloseTo(0, 5);
  });

  it('a cone and a cylinder are not a pair it handles: the mate is reported', () => {
    const tab = two('rod', 'cone', [0, 0, 30]);
    expect(applySolve(tab, src)).toEqual(['m']);
  });

  it('two spheres touch at the sum of their radii', () => {
    const tab = two('ball', 'ball', [20, 0, 0]);
    expect(applySolve(tab, src)).toEqual([]);
    near(applyPoint(b(tab), [0, 0, 0]), [10, 0, 0], 5);
  });

  it('width: the tab is centred between the walls of the slot', () => {
    const tab = two('slot', 'tab', [7, 3, 2], [0, 0, 0], { type: 'width', a2: face('A', 1), b2: face('B', 1) });
    expect(applySolve(tab, src)).toEqual([]);
    near(applyPoint(b(tab), [0, 0, 0]), [0, 3, 2], 5);
  });
});

describe('offsets, limits and closed loops', () => {
  const face = (instance: string, index: number) => ({ instance, connector: { kind: 'face' as const, index } });

  it('an offset moves the second connector along the first one’s Z', () => {
    const tab = assembly('fastened', [50, 0, 3], [0, 0, 0], { offset: 5 });
    expect(applySolve(tab, sources)).toEqual([]);
    near(applyPoint(pinOf(tab), [0, 0, 0]), [0, 0, 15]);
  });

  it('limits stop a slider and a revolute mate', () => {
    const sl = assembly('slider', [0, 0, 25], [0, 0, 0], { limits: { zMin: 0, zMax: 8 } });
    applySolve(sl, sources);
    near(applyPoint(pinOf(sl), [0, 0, 0]), [0, 0, 18]);
    // dragging further does not pass the limit
    const dragged = draggedAssembly(sl, sources, 'N', [0, 0, 100], 0, [0, 0, 1], [0, 0, 18]);
    near(applyPoint(pinOf(dragged), [0, 0, 0]), [0, 0, 18]);
    const rot = (deg: number) => {
      const a = (deg * Math.PI) / 180;
      return [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
    };
    const c = constrainRelative({ type: 'revolute', flip: false, limits: { aMin: -30, aMax: 30 } }, { R: rot(50), o: [0, 0, 0] });
    near(c.R, rot(30));
    near(constrainRelative({ type: 'revolute', flip: false, limits: { aMin: -30, aMax: 30 } }, { R: rot(-10), o: [0, 0, 0] }).R, rot(-10));
  });

  it('closes a loop: every free instance moves until all mates hold', () => {
    // plate (fixed) — slider — pin N — fastened — pin X — planar 60 mm over the plate — back to the plate
    const tab = assembly('slider', [0, 0, 25], [0, 0, 0]);
    tab.instances.push({ id: 'X', name: 'Pin <2>', studioId: 'ps', partId: 'pin', position: [0, 0, 60], rotation: [0, 0, 0] });
    const m2 = { a: face('N', 1), b: face('X', 0) };
    const m3 = { a: face('P', 0), b: face('X', 1) };
    tab.mates!.push(
      { id: 'm2', name: 'F', type: 'fastened', ...m2, flip: nearestFlip(sources, tab, m2.a, m2.b) },
      { id: 'm3', name: 'Pl', type: 'planar', ...m3, flip: nearestFlip(sources, tab, m3.a, m3.b), offset: 60 },
    );
    expect(applySolve(tab, sources)).toEqual([]);
    // X's top 60 mm over the plate top (z = 70), so X's bottom at 50, N's top at 50 and N's bottom at 30
    near(applyPoint(placementOf(tab.instances[2]), [0, 0, 20]), [0, 0, 70], 5);
    near(applyPoint(pinOf(tab), [0, 0, 0]), [0, 0, 30], 5);
    near(applyDir(pinOf(tab), [1, 0, 0]), [1, 0, 0], 5);
  });

  it('closes a four-bar linkage of revolute mates', () => {
    // links with pivot faces (normal +Z) at their ends: ground 100, crank 40, coupler 100, rocker 60
    const link = (id: string, l: number) =>
      mesh(id, [
        { type: 'PLANE', center: [0, 0, 0], normal: [0, 0, 1], area: 1 },
        { type: 'PLANE', center: [l, 0, 0], normal: [0, 0, 1], area: 1 },
      ]);
    const src: AssemblySources = new Map([
      ['ls', { parts: new Map([['g', link('g', 100)], ['c', link('c', 40)], ['k', link('k', 100)], ['r', link('r', 60)]]), mates: [] }],
    ]);
    const inst = (id: string, partId: string, position: Vec3, rz: number, fixed = false) => ({ id, name: id, studioId: 'ls', partId, position, rotation: [0, 0, rz] as Vec3, fixed });
    const rev = (id: string, a: string, fa: number, b: string, fb: number): AssemblyMate => ({ id, name: id, type: 'revolute', a: face(a, fa), b: face(b, fb), flip: false });
    const tab: AssemblyTab = {
      id: 'as',
      type: 'assembly',
      name: 'Four-bar',
      instances: [inst('G', 'g', [0, 0, 0], 0, true), inst('C', 'c', [0, 0, 0], 60), inst('K', 'k', [20, 34.64, 0], 0), inst('R', 'r', [100, 0, 0], 90)],
      mates: [rev('m1', 'G', 0, 'C', 0), rev('m2', 'C', 1, 'K', 0), rev('m3', 'K', 1, 'R', 1), rev('m4', 'G', 1, 'R', 0)],
    };
    expect(applySolve(tab, src)).toEqual([]);
    const pl = (i: number) => placementOf(tab.instances[i]);
    const crankEnd = applyPoint(pl(1), [40, 0, 0]);
    const couplerEnd = applyPoint(pl(2), [100, 0, 0]);
    near(applyPoint(pl(1), [0, 0, 0]), [0, 0, 0], 5);
    near(applyPoint(pl(2), [0, 0, 0]), crankEnd, 5);
    near(applyPoint(pl(3), [0, 0, 0]), [100, 0, 0], 5);
    near(applyPoint(pl(3), [60, 0, 0]), couplerEnd, 5);
    // the links keep their lengths and stay in their plane
    expect(Math.hypot(couplerEnd[0] - 100, couplerEnd[1], couplerEnd[2])).toBeCloseTo(60, 5);
    expect(crankEnd[2]).toBeCloseTo(0, 6);
  });

  describe('mate relations', () => {
    const link = (id: string, l: number) =>
      mesh(id, [
        { type: 'PLANE', center: [0, 0, 0], normal: [0, 0, 1], area: 1 },
        { type: 'PLANE', center: [l, 0, 0], normal: [0, 0, 1], area: 1 },
      ]);
    const src: AssemblySources = new Map([['ls', { parts: new Map([['g', link('g', 100)], ['c', link('c', 40)], ['k', link('k', 40)]]), mates: [] }]]);
    const inst = (id: string, partId: string, position: Vec3, fixed = false) => ({ id, name: id, studioId: 'ls', partId, position, rotation: [0, 0, 0] as Vec3, fixed });
    const mate = (id: string, type: AssemblyMateType, a: string, fa: number, b: string, fb: number): AssemblyMate => ({ id, name: id, type, a: face(a, fa), b: face(b, fb), flip: false });
    /** Ground G (fixed) with C on its first pivot and K on its second. */
    const rig = (tc: AssemblyMateType, tk: AssemblyMateType, rel: Omit<MateRelation, 'zero' | 'last' | 'id' | 'name' | 'a' | 'b'>, b = 'm2'): AssemblyTab => {
      const tab: AssemblyTab = {
        id: 'as',
        type: 'assembly',
        name: 'R',
        instances: [inst('G', 'g', [0, 0, 0], true), inst('C', 'c', [0, 0, 0]), inst('K', 'k', [100, 0, 0])],
        mates: [mate('m1', tc, 'G', 0, 'C', 0), mate('m2', tk, 'G', 1, 'K', 0)],
      };
      tab.relations = [makeRelation(tab, src, { id: 'r1', name: 'R1', a: 'm1', b, ...rel })];
      return tab;
    };
    const turnC = (tab: AssemblyTab, deg: number) => draggedAssembly(tab, src, 'C', [0, 0, 0], (deg * Math.PI) / 180, [0, 0, 1], [0, 0, 0]);
    const dirX = (tab: AssemblyTab, i: number) => applyDir(placementOf(tab.instances[i]), [1, 0, 0]);
    const dir = (deg: number) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), 0];

    it('gear: the second gear turns the other way, by the ratio; the dragged one stays where it was turned', () => {
      const tab = turnC(rig('revolute', 'revolute', { type: 'gear', value: 2 }), 30);
      expect(solveAssembly(tab, src).failed).toEqual([]);
      near(dirX(tab, 1), dir(30), 5);
      near(dirX(tab, 2), dir(-60), 5);
      near(applyPoint(placementOf(tab.instances[2]), [0, 0, 0]), [100, 0, 0], 5);
    });

    it('gear: turns keep counting past half a revolution (ratio 1.5, one full turn → half a turn more)', () => {
      let tab = rig('revolute', 'revolute', { type: 'gear', value: 1.5 });
      for (let i = 0; i < 6; i++) tab = turnC(tab, 60);
      near(dirX(tab, 1), dir(0), 5);
      // 360° × 1.5 = 540°: the second gear ends half a turn round
      near(dirX(tab, 2), dir(180), 5);
      expect(tab.relations![0].last[0]).toBeCloseTo(2 * Math.PI, 5);
    });

    it('rack and pinion: the rack travels pitch radius × angle; reverse goes the other way', () => {
      const tab = turnC(rig('revolute', 'slider', { type: 'rackPinion', value: 20 }), 90);
      near(applyPoint(placementOf(tab.instances[2]), [0, 0, 0]), [100, 0, (-10 * Math.PI) / 2], 4);
      const rev = turnC(rig('revolute', 'slider', { type: 'rackPinion', value: 20, reverse: true }), 90);
      near(applyPoint(placementOf(rev.instances[2]), [0, 0, 0]), [100, 0, (10 * Math.PI) / 2], 4);
    });

    it('screw: a cylindrical mate advances by the pitch per turn', () => {
      let tab = rig('cylindrical', 'revolute', { type: 'screw', value: 2 }, 'm1');
      for (let i = 0; i < 4; i++) tab = turnC(tab, 90);
      near(applyPoint(placementOf(tab.instances[1]), [0, 0, 0]), [0, 0, 2], 3);
      near(dirX(tab, 1), dir(0), 3);
    });

    it('animating the first gear turns the second one by the ratio', () => {
      const tab = animatedAssembly(rig('revolute', 'revolute', { type: 'gear', value: 2 }), src, 'm1', 'turn', 45);
      near(dirX(tab, 1), dir(45), 5);
      near(dirX(tab, 2), dir(-90), 5);
    });

    it('a relation between mates of the wrong kind is reported', () => {
      const tab = rig('slider', 'revolute', { type: 'gear', value: 1 });
      expect(solveAssembly(tab, src).failed).toEqual(['r1']);
    });
  });

  it('a loop that cannot close keeps the walk’s placements and reports its mates', () => {
    const tab = assembly('fastened', [0, 0, 0], [0, 0, 0]);
    tab.instances.push({ id: 'X', name: 'Pin <2>', studioId: 'ps', partId: 'pin', position: [0, 0, 60], rotation: [0, 0, 0] });
    const m2 = { a: face('N', 1), b: face('X', 0) };
    const m3 = { a: face('P', 0), b: face('X', 1) };
    tab.mates!.push(
      { id: 'm2', name: 'F', type: 'fastened', ...m2, flip: nearestFlip(sources, tab, m2.a, m2.b) },
      { id: 'm3', name: 'Pl', type: 'planar', ...m3, flip: nearestFlip(sources, tab, m3.a, m3.b), offset: 60 },
    );
    // the fastened chain puts X's top at 50, the planar mate wants 70
    expect(applySolve(tab, sources)).toEqual(['m3']);
    near(applyPoint(placementOf(tab.instances[2]), [0, 0, 20]), [0, 0, 50]);
  });
});

describe('animating mates', () => {
  const solved = (tab: AssemblyTab) => (applySolve(tab, sources), tab);

  it('sets the turn of a revolute mate and the travel of a slider', () => {
    const rev = solved(assembly('revolute', [0, 0, 10], [0, 0, 0]));
    const turned = animatedAssembly(rev, sources, 'm1', 'turn', mateValues(sources, rev, rev.mates![0])!.angle + 90);
    near(applyDir(pinOf(turned), [1, 0, 0]), [0, 1, 0]);
    near(applyPoint(pinOf(turned), [0, 0, 0]), [0, 0, 10]);
    expect(animatableMotions('revolute')).toEqual(['turn']);
    expect(animatableMotions('cylindrical')).toEqual(['turn', 'slide']);
    expect(animatableMotions('fastened')).toEqual([]);

    const sl = solved(assembly('slider', [0, 0, 25], [0, 0, 0]));
    const slid = animatedAssembly(sl, sources, 'm1', 'slide', 12);
    near(applyPoint(pinOf(slid), [0, 0, 0]), [0, 0, 22]);
    // the base is left as it was
    near(sl.instances[1].position, [0, 0, 25]);
  });

  it('with nothing fixed, the first instance holds still', () => {
    const rev = solved(assembly('revolute', [0, 0, 10], [0, 0, 0], {}, false));
    const turned = animatedAssembly(rev, sources, 'm1', 'turn', mateValues(sources, rev, rev.mates![0])!.angle - 90);
    near(turned.instances[0].position, [0, 0, 0]);
    near(turned.instances[0].rotation, [0, 0, 0]);
    near(applyDir(pinOf(turned), [1, 0, 0]), [0, -1, 0]);
    expect(turned.instances[0].fixed).toBeFalsy();
  });
});

describe('dragging instances', () => {
  const solved = (tab: AssemblyTab) => (applySolve(tab, sources), tab);

  it('a slider held by a fixed plate only moves along its axis', () => {
    const base = solved(assembly('slider', [0, 0, 25], [0, 0, 0]));
    const tab = draggedAssembly(base, sources, 'N', [30, 5, 10], 0, [0, 0, 1], [0, 0, 25]);
    near(applyPoint(pinOf(tab), [0, 0, 0]), [0, 0, 35]);
    near(applyDir(pinOf(tab), [1, 0, 0]), [1, 0, 0]);
    // the base is left alone
    near(base.instances[1].position, [0, 0, 25]);
  });

  it('a revolute mate turns the part so that the grabbed point follows the mouse', () => {
    const base = solved(assembly('revolute', [0, 0, 10], [0, 0, 0]));
    // grab the pin 10 mm off its axis and pull that point a quarter turn round
    const tab = draggedAssembly(base, sources, 'N', [-10, 10, 0], 0, [0, 0, 1], [10, 0, 15]);
    near(applyPoint(pinOf(tab), [0, 0, 0]), [0, 0, 10]);
    near(applyDir(pinOf(tab), [1, 0, 0]), [0, 1, 0]);
  });

  it('a group tied to nothing fixed follows the dragged instance; Shift turns it', () => {
    const base = solved(assembly('fastened', [0, 0, 10], [0, 0, 0], {}, false));
    const moved = draggedAssembly(base, sources, 'P', [5, 0, 0], 0, [0, 0, 1], [0, 0, 0]);
    near(moved.instances[0].position, [5, 0, 0]);
    near(applyPoint(pinOf(moved), [0, 0, 0]), [5, 0, 10]);
    const turned = draggedAssembly(base, sources, 'P', [0, 0, 0], Math.PI / 2, [0, 0, 1], [0, 0, 0]);
    near(turned.instances[0].rotation, [0, 0, 90]);
    near(applyDir(pinOf(turned), [1, 0, 0]), [0, 1, 0]);
  });

  it('the mated group of an instance', () => {
    const tab = assembly('fastened', [0, 0, 10], [0, 0, 0]);
    tab.instances.push({ id: 'X', name: 'Pin <2>', studioId: 'ps', partId: 'pin', position: [0, 0, 0], rotation: [0, 0, 0] });
    expect([...matedGroup(tab, 'N')].sort()).toEqual(['N', 'P']);
    expect([...matedGroup(tab, 'X')]).toEqual(['X']);
    tab.mates![0].suppressed = true;
    expect([...matedGroup(tab, 'N')]).toEqual(['N']);
  });
});
