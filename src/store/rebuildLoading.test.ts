import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildProgress, BuildRequest, BuildResult, PartMesh } from '../kernel/protocol';
import { newDocument, newPartStudio, newAssemblyTab, useDoc } from './docStore';
import { useEditor } from './editorStore';

const cache = vi.hoisted(() => ({ load: vi.fn(async () => null as BuildResult | null), save: vi.fn(async () => {}) }));
vi.mock('./buildPreview', () => ({ loadBuildPreview: cache.load, saveBuildPreview: cache.save }));
const client = vi.hoisted(() => ({ isReady: true, readyListeners: new Set(), restartListeners: new Set(), reset: vi.fn(async () => {}), build: vi.fn() }));
vi.mock('../kernel/client', async (original) => ({ ...await original<object>(), kernel: () => client }));
const { startRebuildLoop, dropRebuilds } = await import('./rebuild');

const result = (id = 'body'): BuildResult => ({
  type: 'build', reqId: 1, parts: [{ id, name: id, color: '#abcdef', hidden: false, positions: new Float32Array(9), normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), faceRanges: new Int32Array([0, 3]), edgePositions: new Float32Array(6), edgeRanges: new Int32Array([0, 2]), vertices: new Float32Array(3), faces: [], edges: [], bbox: [[0, 0, 0], [1, 1, 1]] } satisfies PartMesh],
  sketches: [], planes: [], curves: [], mates: [], statuses: {}, partOrder: [id], timeMs: 1,
});

let pending: { key: string; finish: (r: BuildResult) => void; progress?: (p: BuildProgress) => void }[];
beforeAll(() => startRebuildLoop());
beforeEach(() => {
  vi.useFakeTimers();
  dropRebuilds();
  useDoc.setState({ doc: null });
  useEditor.setState({ build: null, building: false, editing: null, loadingPreview: null, buildProgress: null });
  cache.load.mockResolvedValue(null);
  cache.save.mockClear();
  pending = [];
  client.build.mockImplementation((key: string, _req: BuildRequest, progress?: (p: BuildProgress) => void) => new Promise<BuildResult>((finish) => pending.push({ key, finish, progress })));
});
afterEach(() => { dropRebuilds(); vi.useRealTimers(); });
const tick = () => vi.advanceTimersByTimeAsync(15);

describe('opening while geometry is building', () => {
  it('shows saved geometry separately from the editable result, then replaces it', async () => {
    const doc = newDocument();
    const saved = result();
    cache.load.mockResolvedValue(saved);
    useDoc.setState({ doc });
    await tick();
    expect(useEditor.getState().loadingPreview).toEqual({ build: saved, cached: true });
    expect(useEditor.getState().build).toBeNull();
    pending[0].progress?.({ stage: 'features', current: 2, total: 5, featureName: 'Fillet' });
    expect(useEditor.getState().buildProgress?.featureName).toBe('Fillet');
    const live = result();
    pending[0].finish(live);
    await tick();
    expect(useEditor.getState()).toMatchObject({ build: live, building: false, loadingPreview: null, buildProgress: null });
    expect(cache.save).toHaveBeenCalledWith(doc, live);
  });

  it('drops stale progress and a late cached preview after switching documents', async () => {
    let loaded!: (b: BuildResult) => void;
    cache.load.mockImplementationOnce(() => new Promise((r) => { loaded = r; }));
    useDoc.setState({ doc: newDocument('Old') });
    await tick();
    const old = pending[0];
    useDoc.setState({ doc: newDocument('New') });
    await tick();
    loaded(result('old'));
    old.progress?.({ stage: 'features', current: 99, total: 99, featureName: 'Old' });
    old.finish(result('old'));
    await tick();
    expect(useEditor.getState().build).toBeNull();
    expect(useEditor.getState().loadingPreview).toBeNull();
    expect(useEditor.getState().buildProgress?.featureName).not.toBe('Old');
    pending[1].finish(result('new'));
    await tick();
    expect(useEditor.getState().build?.parts[0].id).toBe('new');
  });

  it('builds small assembly sources first and displays them before the whole assembly is ready', async () => {
    const doc = newDocument();
    const heavy = newPartStudio('Heavy');
    heavy.features.push({ id: 'v', type: 'variable', name: 'Size', params: { name: 'n', value: '1' } } as never);
    const small = newPartStudio('Small');
    const asm = newAssemblyTab('Together');
    asm.instances = [heavy, small].map((s, i) => ({ id: `i${i}`, studioId: s.id, partId: s.id, name: s.name, position: [0, 0, 0], rotation: [0, 0, 0], fixed: true }));
    doc.tabs = [heavy, small, asm];
    doc.activeTab = asm.id;
    useDoc.setState({ doc });
    await tick();
    expect(pending[0].key).toBe(small.id);
    pending[0].finish(result(small.id));
    await tick();
    expect(useEditor.getState().loadingPreview?.build.parts.map((p) => p.name)).toEqual(['Small']);
    expect(useEditor.getState().building).toBe(true);
    expect(useEditor.getState().build).toBeNull();
    pending[1].finish(result(heavy.id));
    await tick();
    expect(useEditor.getState().build?.parts.map((p) => p.name)).toEqual(['Heavy', 'Small']);
    expect(useEditor.getState().loadingPreview).toBeNull();
  });
});
