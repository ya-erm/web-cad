// The colours of parts brought from other Part Studios (Derived) as the app's rebuild loop shows them: the source's,
// whatever the build before was (another tab, none yet) and whatever else the Part Studio keeps about them (hidden).
// The real OpenCascade kernel, its builders in this process instead of the geometry worker.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { CadDocument, PartStudioTab } from '../core/types';
import type { BuildResult } from '../kernel/protocol';
import type { StudioBuilder } from '../kernel/build';
import { emptyDocument, openHeadless, type HeadlessSession } from '../agent/headless';
import { useDoc } from './docStore';
import { useEditor } from './editorStore';
import { requestRebuild, startRebuildLoop } from './rebuild';

vi.mock('../kernel/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../kernel/client')>();
  const { StudioBuilder } = await import('../kernel/build');
  // the worker's builders by key
  const builders = new Map<string, StudioBuilder>();
  const builderFor = (key: string) => {
    let b = builders.get(key);
    if (!b) builders.set(key, (b = new StudioBuilder()));
    return b;
  };
  let reqId = 0;
  const client = {
    isReady: true,
    readyListeners: new Set(),
    restartListeners: new Set(),
    ready: async () => undefined,
    reset: async () => builders.clear(),
    build: (key: string, req: object) => builderFor(key).build({ ...req, type: 'build', reqId: ++reqId } as never, (k) => builders.get(k)),
  };
  return { ...actual, kernel: () => client };
});

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

const RED = '#cc3333';
/** The palette's second colour: an uncoloured source's second part. */
const SECOND = '#d8c3a1';

const studio = (doc: CadDocument, name: string) => doc.tabs.find((t) => t.name === name) as PartStudioTab;

/** The tab `name` opened in the app (the build before it — whatever the app had built last): its build. */
async function shown(doc: CadDocument, name: string): Promise<BuildResult> {
  return rebuilt(() => useDoc.setState({ doc: { ...doc, activeTab: studio(doc, name).id } }));
}

/** The app's build after `change`. */
async function rebuilt(change: () => void): Promise<BuildResult> {
  const before = useEditor.getState().build;
  change();
  await vi.waitFor(
    () => {
      const s = useEditor.getState();
      if (s.building || s.build === before) throw new Error('still building');
    },
    { timeout: 60000, interval: 20 },
  );
  return useEditor.getState().build!;
}

const looks = (res: BuildResult) => Object.fromEntries(res.parts.map((p) => [p.name, { color: p.color, hidden: p.hidden }]));

/** Part Studio 1: two blocks, the first red ("Body"), the second uncoloured (the palette's second colour). */
async function source(): Promise<HeadlessSession> {
  const s = await openHeadless(emptyDocument('Derived colours'), wasm);
  const r = await s.run([
    { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 10, h: 10 }] },
    { op: 'extrude', depth: 5 },
    { op: 'sketch', shapes: [{ type: 'circle', c: [30, 0], r: 5 }] },
    { op: 'extrude', depth: 5, boolean: 'new' },
    { op: 'part', part: 'Part 1', name: 'Body', color: RED },
  ]);
  expect(r.error).toBeUndefined();
  expect(r.ok).toBe(true);
  return s;
}

beforeAll(() => startRebuildLoop());

describe('Derived parts in the app', () => {
  it('keep the source’s colours when hidden and shown again, the build before being of another tab', async () => {
    const s = await source();
    const r = await s.run([
      { op: 'studio', name: 'Whole' },
      { op: 'derived', studio: 'Part Studio 1' },
      // hidden and shown again (by the agent, as the parts list's eye does it): the parts get records of their own
      { op: 'part', part: 'Body', hidden: true },
      { op: 'part', part: 'Part 2', hidden: true },
    ]);
    expect(r.ok).toBe(true);
    expect((await s.run([{ op: 'part', part: 'Body', hidden: false }])).ok).toBe(true);
    const doc = s.doc;
    expect(Object.values(studio(doc, 'Whole').parts).every((m) => m.color === undefined)).toBe(true);

    expect(looks(await shown(doc, 'Part Studio 1'))).toEqual({ Body: { color: RED, hidden: false }, 'Part 2': { color: SECOND, hidden: false } });
    // opened after the source's tab: the source's colours, "Part 2" still hidden
    expect(looks(await shown(doc, 'Whole'))).toEqual({ Body: { color: RED, hidden: false }, 'Part 2': { color: SECOND, hidden: true } });
    // and built once more in it
    expect(looks(await rebuilt(requestRebuild))).toEqual({ Body: { color: RED, hidden: false }, 'Part 2': { color: SECOND, hidden: true } });
  }, 120000);

  it('keep the colours of the source’s own source (a Part Studio derived from one that derives)', async () => {
    const s = await source();
    // "Middle": Part 2 first — the palette's first colour and Body the second one, were they its own parts
    const r = await s.run([
      { op: 'studio', name: 'Middle' },
      { op: 'derived', studio: 'Part Studio 1', parts: ['Part 2', 'Body'] },
      { op: 'studio', name: 'Whole' },
      { op: 'derived', studio: 'Middle' },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    const all = { Body: { color: RED, hidden: false }, 'Part 2': { color: SECOND, hidden: false } };
    expect(looks(await shown(s.doc, 'Middle'))).toEqual(all);
    expect(looks(await shown(s.doc, 'Whole'))).toEqual(all);
  }, 120000);
});
