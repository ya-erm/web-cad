// Integration tests of the feature kernel running OpenCascade (WASM) in Node.

import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import opencascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { StudioBuilder } from './build';
import type { Feature, SelRef, SketchData } from '../core/types';
import { defaultParams } from '../core/features';
import { addCircle, addConstraint, addRectangle } from '../sketch/sketchOps';
import { computeRegions } from '../sketch/regions';
import { produce } from 'immer';
import { faceSig, edgeSig } from './sigs';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

beforeAll(async () => {
  const oc = await opencascade({ locateFile: () => wasm } as never);
  setOC(oc);
}, 60000);

const units = { length: 'mm' as const, angle: 'deg' as const };

function sketch(id: string, fn: (d: SketchData) => void, plane: SketchData['plane'] = { kind: 'std', name: 'top' }): Feature {
  const params = produce({ plane, entities: [], constraints: [] } as SketchData, fn);
  return { id, type: 'sketch', name: id, params };
}

function regionRefs(f: Feature): SelRef[] {
  if (f.type !== 'sketch') return [];
  return computeRegions(f.params.entities).map((r) => ({ kind: 'region', sketchId: f.id, key: r.key }));
}

async function build(features: Feature[], preview?: Feature) {
  const b = new StudioBuilder();
  const res = await b.build({ type: 'build', reqId: 1, units, features, partMeta: {}, upTo: features.length, preview });
  return { b, res };
}

describe('kernel', () => {
  it('extrudes a rectangle with a hole', async () => {
    const s = sketch('s1', (d) => {
      addRectangle(d, [0, 0], [40, 20]);
      addCircle(d, [20, 10], 5);
    });
    const regions = computeRegions((s as { params: SketchData }).params.entities);
    expect(regions.length).toBe(2);
    const outer = regions.find((r) => r.holes.length === 1)!;
    const ex: Feature = {
      id: 'e1',
      type: 'extrude',
      name: 'Extrude 1',
      params: { ...defaultParams('extrude'), profiles: [{ kind: 'region', sketchId: 's1', key: outer.key }], depth: '10 mm' },
    };
    const { res, b } = await build([s, ex]);
    expect(res.statuses.e1).toEqual({ ok: true });
    expect(res.parts.length).toBe(1);
    const m = b.measure([{ kind: 'part', partId: res.parts[0].id }]);
    const vol = m.items.find((i) => i.label === 'Volume')!.value;
    expect(vol).toBeCloseTo(40 * 20 * 10 - Math.PI * 25 * 10, 1);
    // face → edge adjacency (sketch "Use" of a face): the top face is bounded by 4 lines and the hole circle
    const top = res.parts[0].faces.find((f) => f.type === 'PLANE' && f.normal && f.normal[2] > 0.99)!;
    const types = top.edges!.map((i) => res.parts[0].edges[i].type).sort();
    expect(types).toEqual(['CIRCLE', 'LINE', 'LINE', 'LINE', 'LINE']);
  });

  it('rebuilds with a variable-driven dimension and fillets an edge', async () => {
    const v: Feature = { id: 'v1', type: 'variable', name: 'Variable 1', params: { name: 'w', value: '30 mm', description: '' } };
    const s = sketch('s1', (d) => {
      const lines = addRectangle(d, [0, 0], [10, 10]);
      addConstraint(d, 'distance', [lines[0].id], { value: '#w' });
      addConstraint(d, 'distance', [lines[1].id], { value: '15' });
      addConstraint(d, 'fix', [lines[0].p1], { frozen: [0, 0] });
    });
    const ex: Feature = {
      id: 'e1',
      type: 'extrude',
      name: 'Extrude 1',
      params: { ...defaultParams('extrude'), profiles: regionRefs(s), depth: '5' },
    };
    const { res } = await build([v, s, ex]);
    expect(res.statuses.s1.ok).toBe(true);
    const part = res.parts[0];
    expect(part.bbox[1][0] - part.bbox[0][0]).toBeCloseTo(30, 5);
    expect(part.bbox[1][1] - part.bbox[0][1]).toBeCloseTo(15, 5);
    // fillet a vertical edge
    const ei = part.edges.findIndex((e) => e.type === 'LINE' && e.dir && Math.abs(e.dir[2]) > 0.99);
    const edgeRef: SelRef = { kind: 'edge', partId: part.id, index: ei, sig: edgeSig(part.edges[ei]) };
    const fi: Feature = { id: 'f1', type: 'fillet', name: 'Fillet 1', params: { ...defaultParams('fillet'), edges: [edgeRef], radius: '3' } };
    const r2 = await build([v, s, ex, fi]);
    expect(r2.res.statuses.f1).toEqual({ ok: true });
    expect(r2.res.parts[0].faces.some((f) => f.type === 'CYLINDRE')).toBe(true);
    // change the variable: the fillet reference must still resolve
    const v2 = { ...v, params: { ...v.params, value: '50 mm' } } as Feature;
    const r3 = await build([v2, s, ex, fi]);
    expect(r3.res.statuses.f1.ok).toBe(true);
    expect(r3.res.parts[0].bbox[1][0] - r3.res.parts[0].bbox[0][0]).toBeCloseTo(50, 5);
  });

  it('sketches on a face, cuts, patterns and exports STEP', async () => {
    const s = sketch('s1', (d) => {
      addRectangle(d, [-20, -20], [20, 20]);
    });
    const ex: Feature = { id: 'e1', type: 'extrude', name: 'E1', params: { ...defaultParams('extrude'), profiles: regionRefs(s), depth: '10' } };
    const { res } = await build([s, ex]);
    const part = res.parts[0];
    const top = part.faces.findIndex((f) => f.type === 'PLANE' && f.normal && f.normal[2] > 0.99);
    const faceRef: SelRef = { kind: 'face', partId: part.id, index: top, sig: faceSig(part.faces[top]) };
    const s2 = sketch(
      's2',
      (d) => {
        addCircle(d, [-12, 0], 3);
      },
      { kind: 'face', ref: faceRef },
    );
    const cut: Feature = {
      id: 'e2',
      type: 'extrude',
      name: 'E2',
      params: { ...defaultParams('extrude'), op: 'remove', profiles: regionRefs(s2), endType: 'throughAll', flip: true },
    };
    const pat: Feature = {
      id: 'p1',
      type: 'circularPattern',
      name: 'P1',
      params: {
        ...defaultParams('circularPattern'),
        patternType: 'feature',
        features: ['e2'],
        axis: [{ kind: 'plane', planeId: 'top' }],
        count: '4',
      },
    };
    const { res: r2, b } = await build([s, ex, s2, cut, pat]);
    expect(r2.statuses.e2).toEqual({ ok: true });
    expect(r2.statuses.p1).toEqual({ ok: true });
    const m = b.measure([{ kind: 'part', partId: r2.parts[0].id }]);
    const vol = m.items.find((i) => i.label === 'Volume')!.value;
    expect(vol).toBeCloseTo(40 * 40 * 10 - 4 * Math.PI * 9 * 10, 0);
    const step = await b.exportStep([]);
    expect(new TextDecoder().decode(step.slice(0, 20))).toContain('ISO-10303-21');
    const proj = b.projection([], 'front', true);
    expect(proj.edges.length).toBeGreaterThan(4);
  });

  it('revolves, shells and chamfers', async () => {
    const s = sketch(
      's1',
      (d) => {
        addRectangle(d, [5, 0], [15, 20]);
      },
      { kind: 'std', name: 'front' },
    );
    const rv: Feature = {
      id: 'r1',
      type: 'revolve',
      name: 'R1',
      params: { ...defaultParams('revolve'), profiles: regionRefs(s), axis: [{ kind: 'plane', planeId: 'top' }] },
    };
    const { res } = await build([s, rv]);
    expect(res.statuses.r1).toEqual({ ok: true });
    const box: Feature = sketch('s2', (d) => {
      addRectangle(d, [30, 30], [60, 60]);
    });
    const ex: Feature = { id: 'e1', type: 'extrude', name: 'E', params: { ...defaultParams('extrude'), profiles: regionRefs(box), depth: '20' } };
    const r2 = await build([s, rv, box, ex]);
    const p = r2.res.parts.find((x) => x.bbox[0][0] > 25)!;
    const top = p.faces.findIndex((f) => f.normal && f.normal[2] > 0.99);
    const sh: Feature = {
      id: 'sh',
      type: 'shell',
      name: 'S',
      params: { ...defaultParams('shell'), faces: [{ kind: 'face', partId: p.id, index: top, sig: faceSig(p.faces[top]) }], thickness: '2' },
    };
    const r3 = await build([s, rv, box, ex, sh]);
    expect(r3.res.statuses.sh).toEqual({ ok: true });
    const ei = p.edges.findIndex((e) => e.type === 'LINE' && e.dir && Math.abs(e.dir[0]) > 0.99 && e.center[2] < 1);
    const ch: Feature = {
      id: 'ch',
      type: 'chamfer',
      name: 'C',
      params: { ...defaultParams('chamfer'), edges: [{ kind: 'edge', partId: p.id, index: ei, sig: edgeSig(p.edges[ei]) }], distance: '2' },
    };
    const r4 = await build([s, rv, box, ex, ch]);
    expect(r4.res.statuses.ch).toEqual({ ok: true });
  });
});

describe('tangent propagation (fillet / chamfer)', () => {
  it('follows tangent edges; with the option off a warning says so', async () => {
    const s = sketch('s1', (d) => {
      addRectangle(d, [-10, -10], [10, 10]);
    });
    const ex: Feature = { id: 'e1', type: 'extrude', name: 'E', params: { ...defaultParams('extrude'), profiles: regionRefs(s), depth: '10' } };
    const r0 = await build([s, ex]);
    const p0 = r0.res.parts[0];
    const edgeRef = (p: typeof p0, pred: (e: (typeof p0)['edges'][number]) => boolean): SelRef => {
      const i = p.edges.findIndex(pred);
      expect(i).toBeGreaterThanOrEqual(0);
      return { kind: 'edge', partId: p.id, index: i, sig: edgeSig(p.edges[i], p.bbox) };
    };
    // round the vertical corner edge at (10, -10): the top edges meeting there become one tangent chain
    const corner = edgeRef(p0, (e) => e.type === 'LINE' && !!e.dir && Math.abs(e.dir[2]) > 0.99 && Math.abs(e.center[0] - 10) < 1e-6 && Math.abs(e.center[1] + 10) < 1e-6);
    const f1: Feature = { id: 'f1', type: 'fillet', name: 'F1', params: { ...defaultParams('fillet'), edges: [corner], radius: '4' } };
    const r1 = await build([s, ex, f1]);
    const p1 = r1.res.parts[0];
    const topFront = edgeRef(p1, (e) => e.type === 'LINE' && !!e.dir && Math.abs(e.dir[0]) > 0.99 && Math.abs(e.center[1] + 10) < 1e-6 && Math.abs(e.center[2] - 10) < 1e-6);
    for (const type of ['fillet', 'chamfer'] as const) {
      const on: Feature = { id: 'x', type, name: 'X', params: { ...defaultParams(type), edges: [topFront] } } as Feature;
      const off: Feature = { ...on, params: { ...(on.params as object), tangentPropagation: false } } as Feature;
      const a = await build([s, ex, f1, on]);
      expect(a.res.statuses.x).toEqual({ ok: true });
      const b = await build([s, ex, f1, off]);
      expect(b.res.statuses.x.ok).toBe(true);
      expect(b.res.statuses.x.warning).toMatch(/tangent propagation cannot be turned off/);
      // the same geometry either way
      expect(b.res.parts[0].faces.length).toBe(a.res.parts[0].faces.length);
    }
    // an isolated edge (no tangent neighbours) gives no warning
    const bottom = edgeRef(p1, (e) => e.type === 'LINE' && !!e.dir && Math.abs(e.dir[0]) > 0.99 && Math.abs(e.center[1] - 10) < 1e-6 && Math.abs(e.center[2]) < 1e-6);
    const lone: Feature = { id: 'y', type: 'fillet', name: 'Y', params: { ...defaultParams('fillet'), edges: [bottom], tangentPropagation: false } };
    expect((await build([s, ex, f1, lone])).res.statuses.y).toEqual({ ok: true });
  }, 60000);
});

describe('sketch Use (projected geometry)', () => {
  it('follows the source edge after an upstream change', async () => {
    const mk = (w: number) =>
      sketch('s1', (d) => {
        addRectangle(d, [0, 0], [w, 20]);
      });
    const s1 = mk(40);
    const ex: Feature = { id: 'e1', type: 'extrude', name: 'E1', params: { ...defaultParams('extrude'), profiles: regionRefs(s1), depth: '10' } };
    const { res } = await build([s1, ex]);
    const part = res.parts[0];
    // the right vertical edge on the top face: x = 40, z = 10, along Y
    const ei = part.edges.findIndex((e) => e.type === 'LINE' && e.dir && Math.abs(e.dir[1]) > 0.99 && Math.abs(e.center[0] - 40) < 1e-6 && Math.abs(e.center[2] - 10) < 1e-6);
    expect(ei).toBeGreaterThanOrEqual(0);
    const edgeRef: SelRef = { kind: 'edge', partId: part.id, index: ei, sig: edgeSig(part.edges[ei], part.bbox) };
    const { projectGeometry, addUsedGeometry } = await import('../sketch/useGeometry');
    const { STD_PLANES } = await import('../core/math');
    const g = projectGeometry({ kind: 'line', a: part.edges[ei].start, b: part.edges[ei].end }, STD_PLANES.top)!;
    const s2 = sketch('s2', (d) => {
      addUsedGeometry(d as never, g, edgeRef);
    });
    // widen the box: the used line must move to x = 60
    const s1b = mk(60);
    const ex2: Feature = { ...ex, params: { ...ex.params, profiles: regionRefs(s1b) } } as Feature;
    const { res: r2 } = await build([s1b, ex2, s2]);
    expect(r2.statuses.s2.ok).toBe(true);
    expect(r2.statuses.s2.warning).toBeUndefined();
    const sk = r2.sketches.find((x) => x.featureId === 's2')!;
    const xs = sk.entities.filter((e) => e.type === 'point').map((e) => (e as { x: number }).x);
    expect(xs.length).toBe(2);
    for (const x of xs) expect(x).toBeCloseTo(60, 6);
  });
});
