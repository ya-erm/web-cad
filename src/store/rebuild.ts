// Sends rebuild requests to the geometry worker whenever the document or the edited
// feature changes, and stores the latest result in the editor store.

import { kernel, SupersededError } from '../kernel/client';
import { activeAssembly, activeStudio, effectiveRollback, studioById, useDoc } from './docStore';
import { useEditor } from './editorStore';
import type { AssemblyTab, CadDocument, Feature, PartStudioTab } from '../core/types';
import { configuredFeatures, parseSourceKey } from '../core/config';
import { buildDerivedSources, derivedInputs, parseVersionStudio, sourceStudio, sourceUnits } from '../core/derived';
import { loadVersionSources, versionDocument } from './versionSources';
import { sourceKey, variantStudio, type AssemblySources } from '../assembly/compose';
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
      // with the Part Studios they derive from
      ...studios.flatMap((s) => (s ? [s.features, s.rollback, s.parts, s.configuration, s.configChoice, ...derivedInputs(doc, s)] : [null])),
    ];
  }
  const studio = activeStudio(doc);
  if (!doc || !studio) return null;
  const ed = useEditor.getState().editing;
  // a change of a Part Studio it derives from rebuilds it too
  return [studio.id, studio.features, studio.rollback, studio.parts, studio.configuration, studio.configChoice, doc.units, ed?.index, ed?.draft, ed?.isNew, ...derivedInputs(doc, studio)];
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

/** The geometry worker's builder of a Part Studio used as a Derived source (apart from its own tab's builder). */
export const derivedKey = (studioId: string) => `src:${studioId}`;
/** Part order of each source's last build: its parts' palette colours go with them into other Part Studios. */
const sourceOrder = new Map<string, string[]>();

/**
 * The parts and sketches of a Derived source (its key: a Part Studio of the document or of a saved version, in a
 * configuration) as it has them: built — its own sources first.
 */
export async function sourceContents(doc: CadDocument, key: string): Promise<SourceContents> {
  await kernel().ready();
  const v = parseVersionStudio(parseSourceKey(key).studioId);
  if (v) await versionDocument(v.versionId);
  const source = sourceStudio(doc, key);
  if (!source) return { parts: [], sketches: [] };
  const upTo = effectiveRollback(source);
  const features = await withDerivedSources(doc, source.id, configuredFeatures(source).slice(0, upTo));
  const meta = Object.fromEntries(Object.entries(source.parts).map(([id, m]) => [id, { name: m.name }]));
  const res = await kernel().build(derivedKey(source.id), { units: sourceUnits(doc, key), features, partMeta: meta, upTo, meshless: true });
  return {
    parts: res.partList ?? [],
    sketches: res.sketches.map((s) => ({ id: s.featureId, name: s.name ?? s.featureId })),
  };
}

/** What a Part Studio can give to a Derived feature: its parts and sketches (ids and names). */
export interface SourceContents {
  parts: { id: string; name: string }[];
  sketches: { id: string; name: string }[];
}

/**
 * Build the Derived sources of a Part Studio (whose features are `features`) in the geometry worker, the deepest
 * first; returns the features, prepared for the build (each Derived feature knows its source's builder and version).
 */
export async function withDerivedSources(doc: CadDocument, studioId: string, features: Feature[]): Promise<Feature[]> {
  // saved versions it derives from (of this document or others): their snapshots first
  await loadVersionSources(doc, features);
  return buildDerivedSources(doc, studioId, features, derivedKey, async (s, feats, units) => {
    const req = (order: string[]) => ({
      units,
      features: feats,
      // names and colours (as the source shows them) go with its parts
      partMeta: Object.fromEntries(order.map((id) => [id, { name: s.parts[id]?.name, color: partColorFor(s, id, order) }])),
      upTo: feats.length,
      meshless: true,
    });
    const res = await kernel().build(derivedKey(s.id), req(sourceOrder.get(s.id) ?? Object.keys(s.parts)));
    // new parts: once more with their colours (everything else comes from the cache)
    if (JSON.stringify(res.partOrder) !== JSON.stringify(sourceOrder.get(s.id))) {
      sourceOrder.set(s.id, res.partOrder);
      await kernel().build(derivedKey(s.id), req(res.partOrder));
    }
  });
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
    // the variants instances choose by their own configuration: each its own build
    for (const v of used.variants) {
      const studio = studioById(doc, v.studioId);
      if (studio) sources.set(sourceKey(v), await buildStudio(doc, variantStudio(studio, v.configuration)));
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
  // parts brought from another Part Studio keep its colours unless they are given one here
  const derived = new Set(useEditor.getState().build?.parts.filter((p) => p.derived).map((p) => p.id));
  const partMeta: Record<string, { name?: string; color?: string; hidden?: boolean }> = {};
  const ids = new Set([...Object.keys(studio.parts), ...prevOrder]);
  for (const id of ids) {
    const m = studio.parts[id];
    partMeta[id] = { name: m?.name, color: m?.color ?? (derived.has(id) ? undefined : partColorFor(studio, id, prevOrder)), hidden: m?.hidden };
  }
  try {
    // as the chosen configuration has them; the Part Studios they derive from are built first
    const base = configuredFeatures(studio).slice(0, upTo);
    const all = await withDerivedSources(doc, studio.id, preview ? [...base, preview] : base);
    if (mySeq !== seq) return;
    const res = await kernel().build(studio.id, {
      units: doc.units,
      features: all.slice(0, base.length),
      partMeta,
      upTo,
      preview: preview && all[base.length],
    });
    if (mySeq !== seq) return;
    // Assign palette colours for parts that were new in this build.
    for (const p of res.parts) if (!studio.parts[p.id]?.color && !p.derived) p.color = partColorFor(studio, p.id, res.partOrder);
    if (res.preview) for (const p of res.preview.parts) if (!studio.parts[p.id]?.color && !p.derived) p.color = partColorFor(studio, p.id, res.partOrder);
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
