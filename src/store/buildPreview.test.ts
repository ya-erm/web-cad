import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderPreview } from './persistence';
import type { BuildResult, PartMesh } from '../kernel/protocol';
import { newDocument } from './docStore';

const storage = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('./persistence', () => ({ loadRenderPreview: storage.load, saveRenderPreview: storage.save }));
const { loadBuildPreview, saveBuildPreview, previewSignature } = await import('./buildPreview');

export function mesh(id = 'body'): PartMesh {
  return {
    id, name: 'Body', color: '#abcdef', hidden: false, meshKey: '1@1',
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), normals: new Float32Array(9), indices: new Uint32Array([0, 1, 2]),
    faceRanges: new Int32Array([0, 3]), edgePositions: new Float32Array(6), edgeRanges: new Int32Array([0, 2]), vertices: new Float32Array(3),
    faces: [], edges: [], bbox: [[0, 0, 0], [1, 1, 0]],
  };
}

const result = (): BuildResult => ({ type: 'build', reqId: 10, parts: [mesh()], partOrder: ['body'], sketches: [], planes: [], curves: [], mates: [], statuses: {}, timeMs: 100 });

beforeEach(() => vi.resetAllMocks());

describe('saved build previews', () => {
  it('restores typed mesh data only for the exact document content, separately from live mesh keys', async () => {
    const doc = newDocument('Test');
    const live = result();
    storage.save.mockImplementation(async (p: RenderPreview) => storage.load.mockResolvedValue(structuredClone(p)));
    await saveBuildPreview(doc, live);
    const cached = await loadBuildPreview(doc);
    expect(cached?.parts[0].positions).toBeInstanceOf(Float32Array);
    expect(cached?.parts[0].meshKey).toMatch(/^saved:/);
    expect(live.parts[0].meshKey).toBe('1@1');
    expect(await loadBuildPreview({ ...doc, units: { length: 'cm', angle: 'deg' } })).toBeNull();
    expect(previewSignature({ ...doc, name: 'Renamed', modified: doc.modified + 1 })).toBe(previewSignature(doc));
    const changed = structuredClone(doc);
    changed.tabs[0].name = 'Changed tab';
    expect(await loadBuildPreview(changed)).toBeNull();
  });

  it('falls back to a normal build when storage is unavailable or full', async () => {
    storage.load.mockRejectedValue(new Error('blocked'));
    storage.save.mockRejectedValue(new Error('quota'));
    const doc = newDocument();
    await expect(loadBuildPreview(doc)).resolves.toBeNull();
    await expect(saveBuildPreview(doc, result())).resolves.toBeUndefined();
  });

  it('does not cache draft previews, failed geometry or oversized meshes', async () => {
    const doc = newDocument();
    await saveBuildPreview(doc, { ...result(), preview: { status: { ok: true }, parts: [], changed: [] } });
    await saveBuildPreview(doc, { ...result(), statuses: { broken: { ok: false } } });
    const large = result();
    large.parts[0].positions = new Float32Array(3 * 1024 * 1024);
    await saveBuildPreview(doc, large);
    expect(storage.save).not.toHaveBeenCalled();
  });
});
