import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import opencascade from 'replicad-opencascadejs';
import * as R from 'replicad';
import type { Vec3 } from '../core/types';
import { applyBodyOp } from './features';
import { bboxOf, compoundOf, type Shape3D } from './geom';
import { emptyState, setPart, type BuildState } from './state';

beforeAll(async () => {
  const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  R.setOC(await opencascade({ locateFile: () => wasm } as never));
}, 60000);
afterEach(() => vi.restoreAllMocks());

const box = (lo: Vec3, hi: Vec3) => R.makeBox(lo, hi) as R.Solid;
const base = () => box([-10, -10, 0], [10, 10, 4]);
const scope = { mergeAll: true, parts: [] };
const tools = () => [-6, -2, 2, 6].map((x) => box([x - 1, -1, 4], [x + 1, 1, 7]));
const stateWith = (shape = base()) => {
  const st = emptyState();
  setPart(st, 'base', shape);
  return st;
};
const volume = (shape: Shape3D) => {
  const p = R.measureShapeVolumeProperties(shape);
  try { return p.volume; } finally { p.delete(); }
};
const volumes = (st: BuildState) => [...st.parts.values()].map((p) => volume(p.shape)).sort((a, b) => a - b);

describe('several additive tools', () => {
  it('adds four separate bosses in one feature, preserving the base part and its cached shape', () => {
    const shape = base();
    const st = stateWith(shape);
    applyBodyOp(st, 'bosses', compoundOf(tools()), 'add', scope);
    expect(st.partOrder).toEqual(['base']);
    expect(st.parts.size).toBe(1);
    expect(volume(st.parts.get('base')!.shape)).toBeCloseTo(1600 + 4 * 12, 6);
    expect(bboxOf(st.parts.get('base')!.shape)[1][2]).toBeCloseTo(7, 6);
    expect(volume(shape)).toBeCloseTo(1600, 6);
  });

  it('handles overlapping additive tools without counting their common volume twice', () => {
    const st = stateWith();
    const tool = compoundOf([box([-3, -1, 4], [1, 1, 7]), box([-1, -1, 4], [3, 1, 7])]);
    applyBodyOp(st, 'overlap', tool, 'add', scope);
    expect(st.parts.size).toBe(1);
    expect(volume(st.parts.get('base')!.shape)).toBeCloseTo(1600 + 36, 6);
  });

  it('keeps an unconnected tool as a separate part with the original naming rules', () => {
    const st = stateWith();
    const tool = compoundOf([box([-1, -1, 4], [1, 1, 6]), box([50, -1, 4], [52, 1, 6])]);
    applyBodyOp(st, 'add', tool, 'add', scope);
    expect(st.partOrder).toEqual(['base', 'add.0']);
    const v = volumes(st);
    expect(v[0]).toBeCloseTo(8, 6);
    expect(v[1]).toBeCloseTo(1608, 6);
  });

  it('still connects a tool through an earlier tool that alone touches the base', () => {
    const st = stateWith();
    applyBodyOp(st, 'chain', compoundOf([box([-1, -1, 4], [1, 1, 6]), box([-1, -1, 6], [1, 1, 8])]), 'add', scope);
    expect(st.partOrder).toEqual(['base']);
    expect(st.parts.size).toBe(1);
    expect(volume(st.parts.get('base')!.shape)).toBeCloseTo(1616, 6);
  });

  it('preserves a multi-part merge and transfers the consumed part’s thread ownership', () => {
    const st = emptyState();
    setPart(st, 'left', box([-10, -1, 0], [-6, 1, 4]));
    setPart(st, 'right', box([6, -1, 0], [10, 1, 4]));
    st.threads.set('thread', { featureId: 'hole', origin: [8, 0, 0], dir: [0, 0, 1], major: 2, minor: 1.5, length: 2, designation: 'M2', owner: 'right' });
    const tool = compoundOf([box([-6, -1, 0], [6, 1, 4]), box([-1, -1, 4], [1, 1, 6])]);
    applyBodyOp(st, 'bridge', tool, 'add', scope);
    expect([...st.parts.keys()]).toEqual(['left']);
    expect(volume(st.parts.get('left')!.shape)).toBeCloseTo(168, 6);
    expect(st.threads.get('thread')!.owner).toBe('left');
  });

  it('honours an explicit merge scope, leaving the other part untouched', () => {
    const st = stateWith();
    const other = base();
    setPart(st, 'other', other);
    applyBodyOp(st, 'scoped', compoundOf(tools()), 'add', { mergeAll: false, parts: [{ kind: 'part', partId: 'base' }] });
    expect(st.parts.size).toBe(2);
    expect(st.parts.get('other')!.shape).toBe(other);
    expect(volume(st.parts.get('base')!.shape)).toBeCloseTo(1648, 6);
  });

  it('keeps corner-only contacts as separate solids', () => {
    const st = stateWith();
    const tool = compoundOf([box([10, 10, 4], [12, 12, 6]), box([10, -12, 4], [12, -10, 6])]);
    applyBodyOp(st, 'corners', tool, 'add', scope);
    expect(st.parts.size).toBe(3);
    const v = volumes(st);
    expect(v[0]).toBeCloseTo(8, 6);
    expect(v[1]).toBeCloseTo(8, 6);
    expect(v[2]).toBeCloseTo(1600, 6);
  });

  it('retries sequentially after a recoverable compound-fuse error without partial state changes', () => {
    const shape = base();
    const st = stateWith(shape);
    const fuse = vi.spyOn(shape, 'fuse').mockImplementationOnce(() => { throw new Error('Compound fuse failed'); });
    applyBodyOp(st, 'retry', compoundOf(tools()), 'add', scope);
    expect(fuse).toHaveBeenCalledTimes(2);
    expect(st.partOrder).toEqual(['base']);
    expect(volume(st.parts.get('base')!.shape)).toBeCloseTo(1648, 6);
  });

  it.each([new WebAssembly.RuntimeError('unreachable'), new Error('Aborted(out of memory)')])('does not retry when the kernel itself failed (%s)', (error) => {
    const shape = base();
    const st = stateWith(shape);
    const fuse = vi.spyOn(shape, 'fuse').mockImplementationOnce(() => { throw error; });
    expect(() => applyBodyOp(st, 'fatal', compoundOf(tools()), 'add', scope)).toThrow(error);
    expect(fuse).toHaveBeenCalledTimes(1);
    expect(st.parts.get('base')!.shape).toBe(shape);
    expect(st.partOrder).toEqual(['base']);
  });
});
