import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import opencascade from 'replicad-opencascadejs';
import * as R from 'replicad';
import type { SelRef } from '../core/types';
import { bboxOf, translated, type Shape3D } from './geom';
import { meshPart, topologyOf } from './meshing';
import { resolveEdge, resolveVertex } from './refs';
import { edgeSig, vertexSig } from './sigs';
import { emptyState, setPart } from './state';

beforeAll(async () => {
  const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  R.setOC(await opencascade({ locateFile: () => wasm } as never));
}, 60000);
afterEach(() => vi.restoreAllMocks());

const meta = { name: 'Test', color: '#abcdef', hidden: false };
const box = () => R.makeBox([0, 0, 0], [10, 20, 30]) as Shape3D;

describe('topology requested while building', () => {
  it.each([false, true])('resolves an edge without a display mesh, including a stale index (%s)', (stale) => {
    const source = box();
    const saved = meshPart('part', source, meta);
    const shape = box();
    const state = emptyState();
    setPart(state, 'part', shape);
    const mesh = vi.spyOn(shape, 'mesh');
    const meshEdges = vi.spyOn(shape, 'meshEdges');
    const extrema = vi.spyOn(R.getOC().BRepBndLib, 'AddOptimal');
    const index = 3;
    const ref: SelRef = { kind: 'edge', partId: 'part', index: stale ? saved.edges.length + 10 : index, sig: edgeSig(saved.edges[index], saved.bbox) };
    const resolved = resolveEdge(state, ref);
    expect(resolved.index).toBe(index);
    expect(resolved.info.start).toEqual(saved.edges[index].start);
    expect(resolved.info.length).toBeCloseTo(saved.edges[index].length, 10);
    expect(mesh).not.toHaveBeenCalled();
    expect(meshEdges).not.toHaveBeenCalled();
    if (stale) expect(extrema).toHaveBeenCalled();
    else expect(extrema).not.toHaveBeenCalled();
    // Showing it afterwards still returns the complete, unchanged display and picking data.
    const shown = meshPart('part', shape, meta);
    expect(shown.faces).toEqual(saved.faces);
    expect(shown.edges).toEqual(saved.edges);
    expect(shown.positions).toEqual(saved.positions);
    expect(shown.indices).toEqual(saved.indices);
    expect(shown.edges[index]).toBe(resolved.info);
  });

  it('enumerates subshapes and resolves a vertex without triangulating the body', () => {
    const shape = box();
    const mesh = vi.spyOn(shape, 'mesh');
    const meshEdges = vi.spyOn(shape, 'meshEdges');
    const topo = topologyOf(shape);
    expect(topo.faces.length).toBe(6);
    expect(topo.edges.length).toBe(12);
    const state = emptyState();
    setPart(state, 'part', shape);
    const point = topo.vertices[2];
    expect(resolveVertex(state, { kind: 'vertex', partId: 'part', index: 2, sig: vertexSig(point, bboxOf(shape)) })).toEqual(point);
    expect(mesh).not.toHaveBeenCalled();
    expect(meshEdges).not.toHaveBeenCalled();
  });

  it('still rejects an edge whose geometric signature has no match', () => {
    const shape = box();
    const state = emptyState();
    setPart(state, 'part', shape);
    expect(() => resolveEdge(state, { kind: 'edge', partId: 'part', index: 0, sig: { type: 'LINE', center: [1e6, 1e6, 1e6], size: 10 } })).toThrow('Referenced edge could not be found');
  });

  it('recovers from a valid but wrong edge index', () => {
    const saved = meshPart('part', box(), meta);
    const shape = box();
    const state = emptyState();
    setPart(state, 'part', shape);
    const extrema = vi.spyOn(R.getOC().BRepBndLib, 'AddOptimal');
    const wanted = 3;
    const resolved = resolveEdge(state, { kind: 'edge', partId: 'part', index: wanted + 1, sig: edgeSig(saved.edges[wanted], saved.bbox) });
    expect(resolved.index).toBe(wanted);
    expect(extrema).toHaveBeenCalled();
  });

  it('uses the full relative-position search after a part moves', () => {
    const saved = meshPart('part', box(), meta);
    const shape = translated(box(), [1000, 0, 0]);
    const state = emptyState();
    setPart(state, 'part', shape);
    const extrema = vi.spyOn(R.getOC().BRepBndLib, 'AddOptimal');
    const index = 3;
    const resolved = resolveEdge(state, { kind: 'edge', partId: 'part', index, sig: edgeSig(saved.edges[index], saved.bbox) });
    expect(resolved.index).toBe(index);
    expect(resolved.info.start[0]).toBeCloseTo(saved.edges[index].start[0] + 1000, 7);
    expect(extrema).toHaveBeenCalled();
  });

  it('falls back for a near match on a tiny part rather than relaxing the hint threshold', () => {
    const tiny = () => R.makeBox([0, 0, 0], [0.002, 0.003, 0.004]) as Shape3D;
    const saved = meshPart('tiny', tiny(), meta);
    const shape = tiny();
    const state = emptyState();
    setPart(state, 'tiny', shape);
    const sig = edgeSig(saved.edges[3], saved.bbox);
    sig.center = [sig.center[0] + 1e-6, sig.center[1], sig.center[2]];
    const extrema = vi.spyOn(R.getOC().BRepBndLib, 'AddOptimal');
    expect(resolveEdge(state, { kind: 'edge', partId: 'tiny', index: 3, sig }).index).toBe(3);
    expect(extrema).toHaveBeenCalled();
  });

  it('keeps the unsigned direction comparison without calculating body extrema', () => {
    const saved = meshPart('part', box(), meta);
    const shape = box();
    const state = emptyState();
    setPart(state, 'part', shape);
    const sig = edgeSig(saved.edges[3], saved.bbox);
    sig.dir = sig.dir!.map((v) => -v) as [number, number, number];
    const extrema = vi.spyOn(R.getOC().BRepBndLib, 'AddOptimal');
    expect(resolveEdge(state, { kind: 'edge', partId: 'part', index: 3, sig }).index).toBe(3);
    expect(extrema).not.toHaveBeenCalled();
  });

  it('does not accept a matching centre alone when the edge length differs', () => {
    const saved = meshPart('part', box(), meta);
    const shape = box();
    const state = emptyState();
    setPart(state, 'part', shape);
    const sig = edgeSig(saved.edges[3], saved.bbox);
    sig.size *= 1.1;
    const extrema = vi.spyOn(R.getOC().BRepBndLib, 'AddOptimal');
    expect(resolveEdge(state, { kind: 'edge', partId: 'part', index: 3, sig }).index).toBe(3);
    expect(extrema).toHaveBeenCalled();
  });

  it('uses the full search when a circular edge’s saved radius differs', () => {
    const saved = meshPart('cylinder', R.makeCylinder(6, 12), meta);
    const index = saved.edges.findIndex((e) => e.type === 'CIRCLE');
    const state = emptyState();
    setPart(state, 'cylinder', R.makeCylinder(6, 12));
    const sig = edgeSig(saved.edges[index], saved.bbox);
    sig.radius = sig.radius! + 0.01;
    const extrema = vi.spyOn(R.getOC().BRepBndLib, 'AddOptimal');
    expect(resolveEdge(state, { kind: 'edge', partId: 'cylinder', index, sig }).index).toBe(index);
    expect(extrema).toHaveBeenCalled();
  });

  it('preserves rejection of an invalid relative signature even when absolute geometry matches', () => {
    const saved = meshPart('part', box(), meta);
    const state = emptyState();
    setPart(state, 'part', box());
    const sig = { ...edgeSig(saved.edges[3], saved.bbox), rel: [NaN, 0, 0] as [number, number, number] };
    expect(() => resolveEdge(state, { kind: 'edge', partId: 'part', index: 3, sig })).toThrow('Referenced edge could not be found');
  });

  it('keeps cylinder seams, face adjacency and face signatures when display quality changes', () => {
    const shape = R.makeCylinder(5, 12);
    const topo = topologyOf(shape);
    const early = topo.edgeInfoAt(0);
    const first = meshPart('cylinder', shape, meta);
    expect(first.edges[0]).toBe(early);
    expect(first.edges.some((e) => e.seam)).toBe(true);
    expect(first.faces.every((f) => f.edges?.length && f.edges.every((i) => i >= 0 && i < first.edges.length))).toBe(true);
    const detailed = meshPart('cylinder', shape, meta, 3);
    expect(detailed.faces).toEqual(first.faces);
    const mesh = vi.spyOn(shape, 'mesh');
    const repeated = meshPart('cylinder', shape, meta, 3);
    expect(mesh).not.toHaveBeenCalled();
    expect(repeated.indices).toEqual(detailed.indices);
  });
});
