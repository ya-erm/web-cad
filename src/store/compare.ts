// The model compared with a version on it (Onshape: Compare): the version's Part Studio built apart in the kernel,
// its faces matched with the model's by their geometry — what is new or changed lights up, what is gone is a ghost.

import type { CadDocument, PartStudioTab } from '../core/types';
import type { BuildResult } from '../kernel/protocol';
import { configuredFeatures } from '../core/config';
import { kernel } from '../kernel/client';
import { diffFaces } from '../viewport/compareModel';
import * as db from './persistence';
import { effectiveRollback, useDoc } from './docStore';
import { useEditor } from './editorStore';
import { withDerivedSources } from './rebuild';

/** The model's current build, once the open tab's build is done — another than `was` (another tab's) — or none after a while. */
async function settledBuild(tabId: string, was: BuildResult | null, timeout = 60000) {
  const t0 = Date.now();
  for (;;) {
    const { build, building } = useEditor.getState();
    if (build && build !== was && !building && useDoc.getState().doc?.activeTab === tabId) return build;
    if (Date.now() - t0 > timeout) return null;
    await new Promise((r) => setTimeout(r, 150));
  }
}

let computing = false;

/**
 * Compare Part Studio `tabId` with how version `versionId` has it, on the model: the tab opens, the version's tab is
 * built apart, their faces are matched. False when there is nothing to compare (the version has no such tab).
 */
export async function compareOnModel(versionId: string, tabId: string, label: string): Promise<boolean> {
  const snap = await db.loadVersion(versionId);
  const before = snap?.tabs.find((t): t is PartStudioTab => t.id === tabId && t.type === 'partStudio');
  if (!snap || !before) return false;
  computing = true;
  useEditor.setState({ compare: { label, tabId, changed: {}, ghost: [], pending: true } });
  try {
    // the tab open (its build is the model now)
    const other = useDoc.getState().doc?.activeTab !== tabId;
    const was = other ? useEditor.getState().build : null;
    if (other) useDoc.getState().update((d) => void (d.activeTab = tabId), { undoable: false });
    const now = await settledBuild(tabId, was);
    if (!now) {
      endCompare();
      return false;
    }
    // the version's tab: apart from the model's own builder (one for every comparison: the worker keeps its builders)
    const features = await withDerivedSources(snap as CadDocument, tabId, configuredFeatures(before).slice(0, effectiveRollback(before)));
    const res = await kernel().build('compare', { units: snap.units, features, partMeta: {}, upTo: features.length });
    const shown = now.parts.filter((p) => !p.hidden);
    const diff = diffFaces(shown, res.parts);
    // the version's faces that are gone: their triangles
    const ghost = res.parts.flatMap((p) => {
      const faces = diff.removed[p.id];
      if (!faces?.length) return [];
      const idx: number[] = [];
      for (const i of faces) {
        const s = p.faceRanges[i * 2];
        for (let k = s; k < s + p.faceRanges[i * 2 + 1]; k++) idx.push(p.indices[k]);
      }
      return [{ positions: p.positions, indices: Uint32Array.from(idx) }];
    });
    // cancelled meanwhile (Hide)
    if (!useEditor.getState().compare?.pending) return false;
    useEditor.setState({ compare: { label, tabId, changed: diff.changed, ghost } });
    return true;
  } catch (e) {
    console.error('compare with a version', e);
    endCompare();
    return false;
  } finally {
    computing = false;
  }
}

export const endCompare = () => useEditor.setState({ compare: null });

let started = false;

/** The comparison ends when the model changes (it was of the model as it was) or another tab opens. */
export function startCompare() {
  if (started) return;
  started = true;
  useEditor.subscribe((s, p) => {
    if (!s.compare || computing) return;
    if (s.build !== p.build || useDoc.getState().doc?.activeTab !== s.compare.tabId) endCompare();
  });
}
