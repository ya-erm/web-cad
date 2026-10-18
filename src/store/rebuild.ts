// Sends rebuild requests to the geometry worker whenever the document or the edited
// feature changes, and stores the latest result in the editor store.

import { kernel, SupersededError } from '../kernel/client';
import { activeAssembly, activeStudio, effectiveRollback, studioById, useDoc } from './docStore';
import { useEditor } from './editorStore';
import type { AssemblyTab, CadDocument, Feature, PartStudioTab } from '../core/types';
import { configuredFeatures } from '../core/config';
import type { AssemblySources } from '../assembly/compose';
import { buildStudio, useAssembly } from '../assembly/sources';
import { addSubassemblies, applySolve } from '../assembly/mates';
import { composeDisplayed } from '../assembly/explode';
import { usedTabs } from '../assembly/expand';

const PART_PALETTE = ['#a9bfd6', '#d8c3a1', '#a8c99e', '#d6a6a6', '#b3a8d6', '#9fcfcc', '#d9c27a', '#c9a6c9'];

let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastInputs: unknown[] = [];

function inputsOf(): unknown[] | null {
  const doc = useDoc.getState().doc;
  const asm = activeAssembly(doc);
  if (doc && asm) {
    // an assembly depends on its instances, its sub-assemblies and the Part Studios their parts come from
    const used = usedTabs(doc.tabs, asm);
    const studios = used.studios.map((id) => studioById(doc, id));
    return [
      'asm',
      asm.id,
      asm.instances,
      doc.units,
      ...used.subs.flatMap((s) => [s.instances, s.mates, s.groups, s.relations]),
      ...studios.flatMap((s) => (s ? [s.features, s.rollback, s.parts, s.configuration, s.configChoice] : [null])),
    ];
  }
  const studio = activeStudio(doc);
  if (!doc || !studio) return null;
  const ed = useEditor.getState().editing;
  return [studio.id, studio.features, studio.rollback, studio.parts, studio.configuration, studio.configChoice, doc.units, ed?.index, ed?.draft, ed?.isNew];
}

function sameInputs(a: unknown[], b: unknown[]) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function partColorFor(studio: PartStudioTab, partId: string, order: string[]): string {
  const c = studio.parts[partId]?.color;
  if (c) return c;
  const i = Math.max(0, order.indexOf(partId));
  return PART_PALETTE[i % PART_PALETTE.length];
}

/** An assembly: build its source Part Studios, then place the instances. */
async function runAssembly(doc: CadDocument, asm: AssemblyTab) {
  const mySeq = ++seq;
  useEditor.setState({ building: true });
  const t0 = performance.now();
  const sources: AssemblySources = new Map();
  try {
    const used = usedTabs(doc.tabs, asm);
    for (const id of used.studios) {
      const studio = studioById(doc, id);
      if (!studio) continue;
      sources.set(id, await buildStudio(doc, studio));
    }
    if (mySeq !== seq) return;
    // sub-assemblies as solved (the deepest first: each uses the ones inside it)
    addSubassemblies(doc.tabs, asm, sources);
    // the mates follow changes of the parts: re-solve and store the placements if they moved
    const solved = structuredClone(asm) as AssemblyTab;
    const failedMates = applySolve(solved, sources);
    const moved = solved.instances.some((i, k) => i.position.some((v, n) => Math.abs(v - asm.instances[k].position[n]) > 1e-7) || i.rotation.some((v, n) => Math.abs(v - asm.instances[k].rotation[n]) > 1e-7));
    // an open exploded view is what the graphics area shows
    const { build, missing } = composeDisplayed(solved, sources);
    build.timeMs = performance.now() - t0;
    useAssembly.setState({ sources, missing, failedMates });
    useEditor.setState({ build, building: false });
    if (moved)
      useDoc.getState().update(
        (d) => {
          const t = d.tabs.find((x) => x.id === asm.id);
          if (t?.type === 'assembly') t.instances = solved.instances;
        },
        { undoable: false },
      );
  } catch (e) {
    if (e instanceof SupersededError) return;
    if (mySeq === seq) {
      useEditor.setState({ building: false });
      useEditor.getState().showToast(`Rebuild failed: ${(e as Error).message}`, 'error');
    }
  }
}

async function run() {
  const doc = useDoc.getState().doc;
  const asm = activeAssembly(doc);
  if (doc && asm) return runAssembly(doc, asm);
  const studio = activeStudio(doc);
  if (!doc || !studio) return;
  const ed = useEditor.getState().editing;
  let upTo = effectiveRollback(studio);
  let preview: Feature | undefined;
  if (ed) {
    upTo = ed.index;
    if (ed.draft.type !== 'sketch') preview = ed.draft;
  }
  const mySeq = ++seq;
  useEditor.setState({ building: true });
  // Colours by creation order need the previous result's order; good enough for display.
  const prevOrder = useEditor.getState().build?.partOrder ?? [];
  const partMeta: Record<string, { name?: string; color?: string; hidden?: boolean }> = {};
  const ids = new Set([...Object.keys(studio.parts), ...prevOrder]);
  for (const id of ids) {
    const m = studio.parts[id];
    partMeta[id] = { name: m?.name, color: partColorFor(studio, id, prevOrder), hidden: m?.hidden };
  }
  try {
    const res = await kernel().build(studio.id, {
      units: doc.units,
      // as the chosen configuration has them
      features: configuredFeatures(studio).slice(0, upTo),
      partMeta,
      upTo,
      preview,
    });
    if (mySeq !== seq) return;
    // Assign palette colours for parts that were new in this build.
    for (const p of res.parts) if (!studio.parts[p.id]?.color) p.color = partColorFor(studio, p.id, res.partOrder);
    if (res.preview) for (const p of res.preview.parts) if (!studio.parts[p.id]?.color) p.color = partColorFor(studio, p.id, res.partOrder);
    useEditor.setState({ build: res, building: false });
  } catch (e) {
    if (e instanceof SupersededError) return;
    if (mySeq === seq) {
      useEditor.setState({ building: false });
      useEditor.getState().showToast(`Rebuild failed: ${(e as Error).message}`, 'error');
    }
  }
}

function schedule() {
  const inputs = inputsOf();
  if (!inputs) return;
  if (sameInputs(inputs, lastInputs)) return;
  lastInputs = inputs;
  if (timer) clearTimeout(timer);
  const editingDraft = !!useEditor.getState().editing;
  timer = setTimeout(run, editingDraft ? 120 : 10);
}

let started = false;

export function startRebuildLoop() {
  if (started) return;
  started = true;
  const k = kernel();
  if (k.isReady) useEditor.setState({ kernelReady: true });
  k.readyListeners.add(() => useEditor.setState({ kernelReady: true }));
  useDoc.subscribe(schedule);
  useEditor.subscribe((s, prev) => {
    if (s.editing !== prev.editing) schedule();
  });
  schedule();
}

/** Force a rebuild (e.g. after switching tabs). */
export function requestRebuild() {
  lastInputs = [];
  schedule();
}
