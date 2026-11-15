// The embedded viewer shows a file: a STEP file or a project file — its document built by the kernel as the editor
// builds it (in memory only, never saved), an STL file — its meshes as they are. Done once the model is drawn,
// fitted in the isometric view.

import { create } from 'zustand';
import type { BuildResult } from '../kernel/protocol';
import type { LengthUnit } from '../core/types';
import { kernel, SupersededError } from '../kernel/client';
import { setVersionSnapshot } from '../core/derived';
import { activeTab, useDoc } from '../store/docStore';
import { useEditor } from '../store/editorStore';
import { dropRebuilds, paletteColor, rebuildListeners, type Rebuilt } from '../store/rebuild';
import { getEngine } from '../viewport/engineRef';
import { t } from '../i18n';
import type { EmbedFile } from './protocol';
import { EmbedError } from './session';
import { checkStl, modelTitle, viewModel, type ViewModel } from './model';

export interface ViewerState {
  /** Waiting for a file, opening one, showing it, or why it is not shown. */
  phase: 'waiting' | 'loading' | 'shown' | 'error';
  /** The file's name (without its extension). */
  title: string;
  units: LengthUnit;
  /** Of the model shown (each file and tab its own graphics area). */
  key: string;
  /** Shown, but there is nothing in it (a tab with no parts or sketches). */
  empty: boolean;
  /** Some features of the document failed: the model may be incomplete. */
  failedFeatures: number;
  error: string;
}

export const useViewer = create<ViewerState>(() => ({ phase: 'waiting', title: '', units: 'mm', key: '', empty: false, failedFeatures: 0, error: '' }));

/** A model is to be built this fast (the page around the viewer waits two minutes for it, the download included). */
export const BUILD_TIMEOUT_MS = 110_000;

let loads = 0;

/** Why the kernel's answer is not a model, for people. */
function kernelFailure(e: unknown): EmbedError {
  if (e instanceof EmbedError) return e;
  if (e instanceof SupersededError) return new EmbedError('BUILD_FAILED', t('The geometry kernel failed on this model'));
  console.error('The embedded viewer: the model could not be built', e);
  return new EmbedError('BUILD_FAILED', t('The model could not be built'));
}

/** Whatever happens first: `p`, the kernel failing (started anew), the time running out. */
function guarded<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const k = kernel();
    const stop = () => {
      k.restartListeners.delete(onRestart);
      clearTimeout(timer);
    };
    const onRestart = () => {
      stop();
      reject(new EmbedError('BUILD_FAILED', t('The geometry kernel failed on this model')));
    };
    const timer = setTimeout(() => {
      stop();
      reject(new EmbedError('BUILD_FAILED', t('Building the model took too long')));
    }, BUILD_TIMEOUT_MS);
    k.restartListeners.add(onRestart);
    p.then(
      (v) => {
        stop();
        resolve(v);
      },
      (e) => {
        stop();
        reject(e);
      },
    );
  });
}

/** The next rebuild of the open document (start waiting before the document changes). */
function nextRebuild(): Promise<void> {
  let off = () => {};
  const done = new Promise<void>((resolve, reject) => {
    const l = (r: Rebuilt) => (r.ok ? resolve() : reject(new EmbedError('BUILD_FAILED', t('The model could not be built'))));
    rebuildListeners.add(l);
    off = () => rebuildListeners.delete(l);
  });
  return guarded(done).finally(off);
}

/** The model shown before goes: its rebuilds, its shapes in the kernel, its document (the graphics go with its key). */
function clearModel() {
  dropRebuilds();
  useEditor.setState({ build: null, building: false, selection: [], hover: null, hoverList: null, section: null, editing: null, sketch: null, contextMenu: null, measure: null });
  if (useDoc.getState().doc) useDoc.setState({ doc: null, past: [], future: [], lastKey: null, readOnly: true });
  void kernel().reset().catch(() => undefined);
}

/** The messages of the Import feature that mean the file itself cannot be read. */
const UNREADABLE = ['Failed to load STEP file', 'Not an STL file', 'The STL file could not be read', 'The STL file has no triangles', 'No file data'];

/** Show a file sent to the viewer: resolves once it is drawn; an `EmbedError` says why it is not. */
export async function showFile(file: EmbedFile): Promise<void> {
  const n = ++loads;
  clearModel();
  useViewer.setState({ phase: 'loading', title: modelTitle(file.name), key: `m${n}`, empty: false, failedFeatures: 0, error: '' });
  try {
    if (file.format === 'stl') await showStl(file, n);
    else await showDocument(viewModel(file));
    await drawn(`m${n}`);
  } catch (e) {
    const err = kernelFailure(e);
    if (n === loads) {
      clearModel();
      useViewer.setState({ phase: 'error', error: err.message });
    }
    throw err;
  }
}

async function showStl(file: EmbedFile, n: number) {
  checkStl(new Uint8Array(file.buffer));
  useEditor.setState({ building: true });
  const t0 = performance.now();
  // the file's bytes go to the worker (nothing of them is kept here)
  const res = await guarded(kernel().stlMesh(file.buffer, `stl${n}`)).catch((e) => {
    // the kernel says why the file cannot be read ('Not an STL file'…)
    const m = (e as Error).message;
    throw UNREADABLE.includes(m) ? new EmbedError('INVALID_FILE', t(m)) : e;
  });
  res.parts.forEach((p, i) => (p.color = paletteColor(i)));
  const build: BuildResult = {
    type: 'build',
    reqId: 0,
    parts: res.parts,
    sketches: [],
    planes: [],
    mates: [],
    curves: [],
    statuses: {},
    partOrder: res.parts.map((p) => p.id),
    timeMs: performance.now() - t0,
  };
  // (no document: nothing is rebuilt over the meshes; STL has no units — millimetres, as the Import feature takes it)
  useViewer.setState({ units: 'mm' });
  useEditor.setState({ build, building: false });
}

async function showDocument(model: ViewModel) {
  // the versions its Derived features take parts from: from the file, not from this browser's storage
  for (const v of model.versions) setVersionSnapshot(v.id, { tabs: v.tabs, units: v.units });
  const built = nextRebuild();
  useDoc.setState({ doc: model.doc, past: [], future: [], lastKey: null, readOnly: true, saving: false, saveError: null });
  useViewer.setState({ units: model.doc.units.length });
  await built;
  const status = model.importId ? useEditor.getState().build?.statuses[model.importId] : undefined;
  if (status && !status.ok) {
    const m = status.error ?? 'The model could not be built';
    throw new EmbedError(UNREADABLE.includes(m) ? 'INVALID_FILE' : 'BUILD_FAILED', t(m));
  }
}

/** Another tab of the document shown (a Part Studio or an assembly). */
export async function showTab(tabId: string) {
  const doc = useDoc.getState().doc;
  if (!doc || activeTab(doc)?.id === tabId) return;
  const n = ++loads;
  dropRebuilds();
  useEditor.setState({ build: null, selection: [], hover: null, hoverList: null, section: null });
  const built = nextRebuild();
  useDoc.getState().update((d) => void (d.activeTab = tabId), { undoable: false });
  const key = `m${loads}:${tabId}`;
  useViewer.setState({ phase: 'loading', key, empty: false, failedFeatures: 0, error: '' });
  try {
    await built;
    await drawn(key);
  } catch (e) {
    if (n === loads) useViewer.setState({ phase: 'error', error: kernelFailure(e).message });
  }
}

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The model of `key` drawn: its graphics area made (by React, just after the key changed), the whole model in view and
 * on the canvas — then a frame (or a moment, when the frame is hidden and gets no frames).
 */
async function drawn(key: string) {
  for (let i = 0; i < 100 && !(useViewer.getState().key === key && getEngine()); i++) await later(20);
  const engine = getEngine();
  if (useViewer.getState().key !== key || !engine) throw new EmbedError('BUILD_FAILED', t('The model could not be shown'));
  const build = useEditor.getState().build;
  const visible = build ? build.parts.filter((p) => !p.hidden).length + build.sketches.length : 0;
  engine.showWhole();
  await Promise.race([new Promise((r) => requestAnimationFrame(r)), later(100)]);
  useViewer.setState({
    phase: 'shown',
    empty: visible === 0,
    failedFeatures: build ? Object.values(build.statuses).filter((s) => !s.ok).length : 0,
  });
}
