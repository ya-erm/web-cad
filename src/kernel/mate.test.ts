// Mate connectors: frames from geometry, use as sketch plane / axis / point, and the
// "mate connector to mate connector" transform. Real OpenCascade kernel in Node.

import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import opencascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { produce } from 'immer';
import { StudioBuilder } from './build';
import type { Feature, SelRef, SketchData } from '../core/types';
import { defaultParams } from '../core/features';
import { addArc, addCircle, addLine, addRectangle } from '../sketch/sketchOps';
import { computeRegions } from '../sketch/regions';
import { edgeSig, faceSig } from './sigs';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

beforeAll(async () => {
  const oc = await opencascade({ locateFile: () => wasm } as never);
  setOC(oc);
}, 60000);

const units = { length: 'mm' as const, angle: 'deg' as const };

function sketch(id: string, fn: (d: SketchData) => void, plane: SketchData['plane'] = { kind: 'std', name: 'top' }): Feature {
  return { id, type: 'sketch', name: id, params: produce({ plane, entities: [], constraints: [] } as SketchData, fn) };
}
const regions = (f: Feature): SelRef[] =>
  f.type === 'sketch' ? computeRegions(f.params.entities).map((r) => ({ kind: 'region' as const, sketchId: f.id, key: r.key })) : [];

async function build(features: Feature[]) {
  const b = new StudioBuilder();
  const res = await b.build({ type: 'build', reqId: 1, units, features, partMeta: {}, upTo: features.length });
  return { b, res };
}

describe('mate connector', () => {
  it('sits on a face centroid, hosts a sketch and moves a part onto another connector', async () => {
    const s1 = sketch('s1', (d) => {
      addRectangle(d, [-10, -10], [10, 10]);
    });
    const ex: Feature = { id: 'e1', type: 'extrude', name: 'E1', params: { ...defaultParams('extrude'), profiles: regions(s1), depth: '10' } };
    const { res } = await build([s1, ex]);
    const part = res.parts[0];
    const top = part.faces.findIndex((f) => f.type === 'PLANE' && f.normal![2] > 0.99);
    const topRef: SelRef = { kind: 'face', partId: part.id, index: top, sig: faceSig(part.faces[top], part.bbox) };
    // connector on the top face, raised by 5 mm along its own Z
    const mc: Feature = { id: 'm1', type: 'mateConnector', name: 'MC1', params: { ...defaultParams('mateConnector'), location: [topRef], dz: '5 mm' } };
    // a cylinder sketched on the connector (its XY plane)
    const s2 = sketch(
      's2',
      (d) => {
        addCircle(d, [0, 0], 3);
      },
      { kind: 'feature', featureId: 'm1' },
    );
    const ex2: Feature = { id: 'e2', type: 'extrude', name: 'E2', params: { ...defaultParams('extrude'), profiles: regions(s2), depth: '4' } };
    const r2 = await build([s1, ex, mc, s2, ex2]);
    expect(r2.res.statuses.m1).toEqual({ ok: true });
    expect(r2.res.statuses.e2).toEqual({ ok: true });
    const m = r2.res.mates.find((x) => x.featureId === 'm1')!;
    expect(m.frame.origin[2]).toBeCloseTo(15, 6);
    expect(m.frame.normal[2]).toBeCloseTo(1, 6);
    const cyl = r2.res.parts.find((p) => p.bbox[0][2] > 14)!;
    expect(cyl.bbox[0][2]).toBeCloseTo(15, 4);
    expect(cyl.bbox[1][2]).toBeCloseTo(19, 4);

    // second connector at the origin; move the cylinder's connector onto it (rigid motion)
    const mc0: Feature = { id: 'm0', type: 'mateConnector', name: 'MC0', params: { ...defaultParams('mateConnector'), location: [{ kind: 'origin' }], flipPrimary: true } };
    const tr: Feature = {
      id: 't1',
      type: 'transform',
      name: 'T1',
      params: { ...defaultParams('transform'), mode: 'mates', parts: [{ kind: 'part', partId: cyl.id }], fromMate: [{ kind: 'plane', planeId: 'm1' }], toMate: [{ kind: 'plane', planeId: 'm0' }] },
    };
    const r3 = await build([s1, ex, mc, s2, ex2, mc0, tr]);
    expect(r3.res.statuses.t1).toEqual({ ok: true });
    const moved = r3.res.parts.find((p) => p.id === cyl.id)!;
    // the target Z points down: the cylinder now hangs below the origin
    expect(moved.bbox[1][2]).toBeCloseTo(0, 4);
    expect(moved.bbox[0][2]).toBeCloseTo(-4, 4);
  }, 60000);

  it('uses inference points: hole centre / edge ends parallel to a face, cylinder axis ends, reorient', async () => {
    const s1 = sketch('s1', (d) => {
      addRectangle(d, [-20, -10], [20, 10]);
      addCircle(d, [8, 0], 3);
    });
    const outer = computeRegions((s1 as { params: SketchData }).params.entities).find((r) => r.holes.length === 1)!;
    const ex: Feature = {
      id: 'e1',
      type: 'extrude',
      name: 'E1',
      params: { ...defaultParams('extrude'), profiles: [{ kind: 'region', sketchId: 's1', key: outer.key }], depth: '10' },
    };
    const s2 = sketch('s2', (d) => {
      addCircle(d, [-12, 0], 2);
    });
    const ex2: Feature = { id: 'e2', type: 'extrude', name: 'E2', params: { ...defaultParams('extrude'), profiles: regions(s2), depth: '25' } };
    const { res } = await build([s1, ex, s2, ex2]);
    const plate = res.parts.find((p) => p.bbox[1][2] < 11)!;
    const pin = res.parts.find((p) => p.bbox[1][2] > 20)!;
    const top = plate.faces.findIndex((f) => f.type === 'PLANE' && f.normal![2] > 0.99);
    const topRef: SelRef = { kind: 'face', partId: plate.id, index: top, sig: faceSig(plate.faces[top], plate.bbox) };
    const hole = plate.edges.findIndex((e) => e.type === 'CIRCLE' && Math.abs(e.center[2] - 10) < 1e-6);
    const holeRef: SelRef = { kind: 'edge', partId: plate.id, index: hole, sig: edgeSig(plate.edges[hole], plate.bbox) };
    const long = plate.edges.findIndex((e) => e.type === 'LINE' && e.dir && Math.abs(e.dir[0]) > 0.99 && Math.abs(e.center[1] + 10) < 1e-6 && Math.abs(e.center[2] - 10) < 1e-6);
    const longRef: SelRef = { kind: 'edge', partId: plate.id, index: long, sig: edgeSig(plate.edges[long], plate.bbox) };
    const cyl = pin.faces.findIndex((f) => f.type === 'CYLINDRE');
    const cylRef: SelRef = { kind: 'face', partId: pin.id, index: cyl, sig: faceSig(pin.faces[cyl], pin.bbox) };
    const mc = (id: string, params: Partial<Feature['params']>): Feature =>
      ({ id, type: 'mateConnector', name: id, params: { ...defaultParams('mateConnector'), ...params } }) as Feature;
    const feats = [
      s1,
      ex,
      s2,
      ex2,
      mc('hole', { location: [holeRef], inference: 'center', orientFace: [topRef] }),
      mc('edgeStart', { location: [longRef], inference: 'start', orientFace: [topRef] }),
      mc('edgeEnd', { location: [longRef], inference: 'end', orientFace: [topRef] }),
      mc('axisStart', { location: [cylRef], inference: 'start' }),
      mc('axisEnd', { location: [cylRef], inference: 'end' }),
      mc('re', { location: [{ kind: 'origin' }], reorient: 'x' }),
      // halfway between the hole centre and the pin's top end
      mc('between', { mode: 'between', location: [holeRef], inference: 'center', orientFace: [topRef], location2: [cylRef], inference2: 'end' }),
    ];
    const r = await build(feats);
    const f = (id: string) => r.res.mates.find((m) => m.featureId === id)!.frame;
    expect(r.res.statuses.hole).toEqual({ ok: true });
    expect(f('hole').origin).toEqual([expect.closeTo(8, 6), expect.closeTo(0, 6), expect.closeTo(10, 6)]);
    expect(f('hole').normal[2]).toBeCloseTo(1, 6);
    // the two ends of the front top edge, both oriented like the top face
    const xs = [f('edgeStart').origin[0], f('edgeEnd').origin[0]].sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-20, 6);
    expect(xs[1]).toBeCloseTo(20, 6);
    expect(f('edgeStart').normal[2]).toBeCloseTo(1, 6);
    expect(f('edgeStart').origin[2]).toBeCloseTo(10, 6);
    // pin axis from z = 0 to z = 25
    const zs = [f('axisStart').origin[2], f('axisEnd').origin[2]].sort((a, b) => a - b);
    expect(zs[0]).toBeCloseTo(0, 4);
    expect(zs[1]).toBeCloseTo(25, 4);
    expect(f('axisStart').origin[0]).toBeCloseTo(-12, 4);
    // reorient: the primary axis now points along the former X
    expect(f('re').normal).toEqual([expect.closeTo(1, 6), expect.closeTo(0, 6), expect.closeTo(0, 6)]);
    // between (8, 0, 10) and the "end" axis point of the pin; Z like the top face
    const end = f('axisEnd').origin;
    expect(f('between').origin[0]).toBeCloseTo((8 + end[0]) / 2, 4);
    expect(f('between').origin[2]).toBeCloseTo((10 + end[2]) / 2, 4);
    expect(f('between').normal[2]).toBeCloseTo(1, 6);
  }, 60000);

  it('sits on the axis of a cone / torus and at the centre of a sphere', async () => {
    const s1 = sketch('s1', (d) => {
      addCircle(d, [20, 0], 5);
    });
    const ex: Feature = { id: 'e1', type: 'extrude', name: 'E1', params: { ...defaultParams('extrude'), profiles: regions(s1), depth: '10' } };
    // a sphere of radius 5 centred at (0, 0, 20): half disc revolved about the Z axis
    const s2 = sketch(
      's2',
      (d) => {
        addArc(d, [0, 20], [0, 15], [0, 25]);
        addLine(d, [0, 25], [0, 15]);
      },
      { kind: 'std', name: 'front' },
    );
    const rv: Feature = { id: 'r1', type: 'revolve', name: 'R1', params: { ...defaultParams('revolve'), profiles: regions(s2), axis: [{ kind: 'plane', planeId: 'top' }] } };
    const r0 = await build([s1, ex, s2, rv]);
    expect(r0.res.statuses.r1).toEqual({ ok: true });
    const pin = r0.res.parts.find((p) => p.bbox[0][0] > 10)!;
    const circleAt = (part: typeof pin, z: number) => {
      const i = part.edges.findIndex((e) => e.type === 'CIRCLE' && Math.abs(e.center[2] - z) < 1e-6);
      return { kind: 'edge' as const, partId: part.id, index: i, sig: edgeSig(part.edges[i], part.bbox) };
    };
    // 2 mm chamfer on the top rim (a cone from z = 8 to 10), then a 2 mm fillet on the bottom rim (a torus)
    const ch: Feature = { id: 'c1', type: 'chamfer', name: 'C1', params: { ...defaultParams('chamfer'), edges: [circleAt(pin, 10)] } };
    const r1 = await build([s1, ex, s2, rv, ch]);
    const pin1 = r1.res.parts.find((p) => p.id === pin.id)!;
    const fi: Feature = { id: 'f1', type: 'fillet', name: 'F1', params: { ...defaultParams('fillet'), edges: [circleAt(pin1, 0)] } };
    const r2 = await build([s1, ex, s2, rv, ch, fi]);
    expect(r2.res.statuses.f1).toEqual({ ok: true });
    const pin2 = r2.res.parts.find((p) => p.id === pin.id)!;
    const ball = r2.res.parts.find((p) => p.id !== pin.id)!;
    const faceRef = (part: typeof pin, type: string): SelRef => {
      const i = part.faces.findIndex((f) => f.type === type);
      expect(i).toBeGreaterThanOrEqual(0);
      return { kind: 'face', partId: part.id, index: i, sig: faceSig(part.faces[i], part.bbox) };
    };
    const cone = faceRef(pin2, 'CONE');
    const torus = faceRef(pin2, 'TORUS');
    const sphere = faceRef(ball, 'SPHERE');
    expect(pin2.faces.find((f) => f.type === 'CONE')!.axis).toBeDefined();
    // cone of the 2 mm × 45° chamfer: half-angle 45°, apex on the pin axis, the axis widening from it
    const coneInfo = pin2.faces.find((f) => f.type === 'CONE')!;
    expect(coneInfo.semiAngle).toBeCloseTo(Math.PI / 4, 6);
    expect(coneInfo.apex).toEqual([expect.closeTo(20, 6), expect.closeTo(0, 6), expect.closeTo(13, 6)]);
    expect(coneInfo.axis![2]).toBeCloseTo(-1, 6);
    // torus of the 2 mm fillet on the bottom rim of the r = 5 pin: tube r = 2 round a circle of R = 3 at z = 2
    const torusInfo = pin2.faces.find((f) => f.type === 'TORUS')!;
    expect(torusInfo.minorRadius).toBeCloseTo(2, 6);
    expect(torusInfo.majorRadius).toBeCloseTo(3, 6);
    expect(torusInfo.tubePoint![2]).toBeCloseTo(2, 6);
    const mc = (id: string, params: Partial<Feature['params']>): Feature =>
      ({ id, type: 'mateConnector', name: id, params: { ...defaultParams('mateConnector'), ...params } }) as Feature;
    const r = await build([
      s1,
      ex,
      s2,
      rv,
      ch,
      fi,
      mc('coneMid', { location: [cone], inference: 'mid' }),
      mc('coneEnd', { location: [cone], inference: 'end' }),
      mc('torusMid', { location: [torus], inference: 'mid' }),
      mc('ball', { location: [sphere] }),
    ]);
    const f = (id: string) => r.res.mates.find((m) => m.featureId === id)!.frame;
    for (const id of ['coneMid', 'coneEnd', 'torusMid', 'ball']) expect(r.res.statuses[id]).toEqual({ ok: true });
    // on the pin axis (x = 20, y = 0), Z along it
    expect(f('coneMid').origin).toEqual([expect.closeTo(20, 4), expect.closeTo(0, 4), expect.closeTo(9, 4)]);
    expect(Math.abs(f('coneMid').normal[2])).toBeCloseTo(1, 6);
    expect([8, 10].some((z) => Math.abs(f('coneEnd').origin[2] - z) < 1e-4)).toBe(true);
    expect(f('torusMid').origin).toEqual([expect.closeTo(20, 4), expect.closeTo(0, 4), expect.closeTo(1, 4)]);
    expect(Math.abs(f('torusMid').normal[2])).toBeCloseTo(1, 6);
    expect(f('ball').origin).toEqual([expect.closeTo(0, 4), expect.closeTo(0, 4), expect.closeTo(20, 4)]);
  }, 60000);

  it('moves with its owner part in later transforms', async () => {
    const s1 = sketch('s1', (d) => {
      addRectangle(d, [-10, -10], [10, 10]);
    });
    const ex: Feature = { id: 'e1', type: 'extrude', name: 'E1', params: { ...defaultParams('extrude'), profiles: regions(s1), depth: '10' } };
    const { res } = await build([s1, ex]);
    const part = res.parts[0];
    const top = part.faces.findIndex((f) => f.type === 'PLANE' && f.normal![2] > 0.99);
    const topRef: SelRef = { kind: 'face', partId: part.id, index: top, sig: faceSig(part.faces[top], part.bbox) };
    const partRef: SelRef = { kind: 'part', partId: part.id };
    const mc = (id: string, params: Partial<Feature['params']>): Feature =>
      ({ id, type: 'mateConnector', name: id, params: { ...defaultParams('mateConnector'), ...params } }) as Feature;
    const tr = (id: string, params: Partial<Feature['params']>): Feature =>
      ({ id, type: 'transform', name: id, params: { ...defaultParams('transform'), parts: [partRef], ...params } }) as Feature;
    const base = [
      s1,
      ex,
      // implicit owner: the part of the top face; explicit owner for a connector at the origin; no owner
      mc('onTop', { location: [topRef] }),
      mc('owned', { location: [{ kind: 'origin' }], ownerPart: [partRef] }),
      mc('free', { location: [{ kind: 'origin' }] }),
    ];
    const r1 = await build([...base, tr('up', { mode: 'translateXYZ', dx: '0 mm', dy: '0 mm', dz: '5 mm' })]);
    const f1 = (id: string) => r1.res.mates.find((m) => m.featureId === id)!;
    expect(f1('onTop').frame.origin[2]).toBeCloseTo(15, 6);
    expect(f1('onTop').owner).toBe(part.id);
    expect(f1('owned').frame.origin[2]).toBeCloseTo(5, 6);
    expect(f1('free').frame.origin[2]).toBeCloseTo(0, 6);
    expect(f1('free').owner).toBeUndefined();

    // rotation about Z by 90°: the X axis of the owned connector turns to +Y
    const r2 = await build([...base, tr('turn', { mode: 'rotate', axis: [{ kind: 'plane', planeId: 'top' }], angle: '90 deg' })]);
    const turned = r2.res.mates.find((m) => m.featureId === 'owned')!.frame;
    expect(turned.xDir).toEqual([expect.closeTo(0, 6), expect.closeTo(1, 6), expect.closeTo(0, 6)]);
    expect(turned.normal[2]).toBeCloseTo(1, 6);

    // mate connector to mate connector: the moved connector lands on the target one
    const target = mc('target', { location: [{ kind: 'origin' }], dx: '50 mm', flipPrimary: true });
    const r3 = await build([...base, target, tr('mate', { mode: 'mates', fromMate: [{ kind: 'plane', planeId: 'onTop' }], toMate: [{ kind: 'plane', planeId: 'target' }] })]);
    expect(r3.res.statuses.mate).toEqual({ ok: true });
    const a = r3.res.mates.find((m) => m.featureId === 'onTop')!.frame;
    const b = r3.res.mates.find((m) => m.featureId === 'target')!.frame;
    for (let i = 0; i < 3; i++) {
      expect(a.origin[i]).toBeCloseTo(b.origin[i], 6);
      expect(a.normal[i]).toBeCloseTo(b.normal[i], 6);
      expect(a.xDir[i]).toBeCloseTo(b.xDir[i], 6);
    }
    // copies leave the connectors where they were
    const r4 = await build([...base, tr('copy', { mode: 'translateXYZ', dz: '5 mm', copy: true })]);
    expect(r4.res.mates.find((m) => m.featureId === 'onTop')!.frame.origin[2]).toBeCloseTo(10, 6);
  }, 60000);

  it('serves as an axis (its Z) for a circular pattern', async () => {
    const s1 = sketch('s1', (d) => {
      addCircle(d, [20, 0], 2);
    });
    const ex: Feature = { id: 'e1', type: 'extrude', name: 'E1', params: { ...defaultParams('extrude'), profiles: regions(s1), depth: '5' } };
    const mc: Feature = { id: 'm1', type: 'mateConnector', name: 'MC1', params: { ...defaultParams('mateConnector'), location: [{ kind: 'origin' }] } };
    const pat: Feature = {
      id: 'p1',
      type: 'circularPattern',
      name: 'P1',
      params: { ...defaultParams('circularPattern'), parts: [], patternType: 'part', axis: [{ kind: 'plane', planeId: 'm1' }], count: '4' },
    };
    const { res } = await build([s1, ex, mc]);
    pat.params = { ...(pat.params as object), parts: [{ kind: 'part', partId: res.parts[0].id }] } as never;
    const r2 = await build([s1, ex, mc, pat]);
    expect(r2.res.statuses.p1).toEqual({ ok: true });
    expect(r2.res.parts.length).toBe(4);
  }, 60000);
});
