// Sends rebuild requests to the geometry worker whenever the document or the edited
// feature changes, and stores the latest result in the editor store.

import { kernel, SupersededError } from '../kernel/client';
import type { BuildProgress, PartMeta } from '../kernel/protocol';
import { activeAssembly, activeStudio, effectiveRollback, studioById, useDoc } from './docStore';
import { useEditor } from './editorStore';
import type { AssemblyTab, CadDocument, Feature, PartStudioTab } from '../core/types';
import { configuredFeatures, parseSourceKey } from '../core/config';
import { buildDerivedSources, derivedInputs, parseVersionStudio, sourceStudio, sourceUnits } from '../core/derived';
import { loadVersionSources, versionDocument } from './versionSources';
import { sourceKey, variantStudio, type AssemblySources } from '../assembly/compose';
import { buildStudio, useAssembly } from '../assembly/sources';
import { addSubassemblies, applySolve } from '../assembly/mates';
import { composeDisplayed, explodeActive } from '../assembly/explode';
import { usedTabs } from '../assembly/expand';
import { t } from '../i18n';
import { loadBuildPreview, saveBuildPreview } from './buildPreview';

const PART_PALETTE = ['#a9bfd6', '#d8c3a1', '#a8c99e', '#d6a6a6', '#b3a8d6', '#9fcfcc', '#d9c27a', '#c9a6c9'];

/** A palette colour by creation order (parts given no colour of their own). */
export const paletteColor = (i: number) => PART_PALETTE[i % PART_PALETTE.length];

let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastInputs: unknown[] = [];

/** Each rebuild of the open tab that ended: built (its result is the editor store's `build` now) or failed — why. */
export type Rebuilt = { ok: true } | { ok: false; error: string };
export const rebuildListeners = new Set<(r: Rebuilt) => void>();
const rebuilt = (r: Rebuilt) => rebuildListeners.forEach((l) => l(r));

/** The rebuilds under way are not wanted any more (another model is shown): their results are dropped. */
export function dropRebuilds() {
  seq++;
  if (timer) clearTimeout(timer);
  timer = null;
  lastInputs = [];
  useEditor.setState({ loadingPreview: null, buildProgress: null });
}

export type ReportBuildProgress = (studio: string, progress: BuildProgress) => void;

function beginBuild(doc: CadDocument, studio: string, mySeq: number): ReportBuildProgress {
  useEditor.setState({ building: true, buildProgress: { studio, stage: 'features', current: 0, total: 0 } });
  if (!useEditor.getState().build && !useEditor.getState().editing && !explodeActive()) {
    void loadBuildPreview(doc).then((build) => {
      const ed = useEditor.getState();
      if (build && mySeq === seq && !ed.build && !ed.loadingPreview?.cached)
        useEditor.setState({ loadingPreview: { build, cached: true } });
    });
  }
  return (studio, progress) => {
    if (mySeq === seq) useEditor.setState({ buildProgress: { ...progress, studio } });
  };
}

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
  return paletteColor(Math.max(0, order.indexOf(partId)));
}

/**
 * What a Part Studio keeps about its parts, for their build: names, visibility, colours given — and for the others
 * the palette's by creation order (`order`: of its last build), which the kernel gives only to the Part Studio's own
 * parts: one brought from another Part Studio (Derived) keeps the source's colour.
 */
export function studioPartMeta(studio: PartStudioTab, order: string[]): Record<string, PartMeta> {
  const meta: Record<string, PartMeta> = {};
  for (const id of new Set([...Object.keys(studio.parts), ...order])) {
    const m = studio.parts[id];
    meta[id] = { name: m?.name, color: m?.color, autoColor: m?.color ? undefined : partColorFor(studio, id, order), hidden: m?.hidden };
  }
  return meta;
}

/** The geometry worker's builder of a Part Studio used as a Derived source (apart from its own tab's builder). */
export const derivedKey = (studioId: string) => `src:${studioId}`;
/** Part order of each source's last build: its parts' palette colours go with them into other Part Studios. */
const sourceOrder = new Map<string, string[]>();
/** Part order of each Part Studio's last build in its tab: the palette colours of its parts. */
const studioOrder = new Map<string, string[]>();

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
export async function withDerivedSources(doc: CadDocument, studioId: string, features: Feature[], report?: ReportBuildProgress): Promise<Feature[]> {
  // saved versions it derives from (of this document or others): their snapshots first
  await loadVersionSources(doc, features);
  return buildDerivedSources(doc, studioId, features, derivedKey, async (s, feats, units) => {
    const req = (order: string[]) => ({
      units,
      features: feats,
      // names and colours (as the source shows them — its own Derived parts their sources') go with its parts
      partMeta: studioPartMeta(s, order),
      upTo: feats.length,
      meshless: true,
    });
    const res = await kernel().build(derivedKey(s.id), req(sourceOrder.get(s.id) ?? Object.keys(s.parts)), (p) => report?.(s.name, p));
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
  const report = beginBuild(doc, asm.name, mySeq);
  const t0 = performance.now();
  const sources: AssemblySources = new Map();
  try {
    const used = usedTabs(doc.tabs, asm);
    const publishPartial = () => {
      if (mySeq !== seq || useEditor.getState().build || useEditor.getState().loadingPreview?.cached) return;
      const partial = new Map(sources);
      for (const sub of used.subs) partial.set(sub.id, { parts: new Map(), mates: [], assembly: sub });
      const { build } = composeDisplayed(asm, partial);
      if (build.parts.length) useEditor.setState({ loadingPreview: { build, cached: false } });
    };
    // Small sources first: the first opening can show useful geometry before the expensive body is ready.
    const studios = [...used.studios].sort((a, b) => (studioById(doc, a)?.features.length ?? 0) - (studioById(doc, b)?.features.length ?? 0));
    for (const id of studios) {
      if (mySeq !== seq) return;
      const studio = studioById(doc, id);
      if (!studio) continue;
      sources.set(id, await buildStudio(doc, studio, report));
      publishPartial();
    }
    // the variants instances choose by their own configuration: each its own build
    for (const v of used.variants) {
      if (mySeq !== seq) return;
      const studio = studioById(doc, v.studioId);
      if (studio) sources.set(sourceKey(v), await buildStudio(doc, variantStudio(studio, v.configuration), report));
      publishPartial();
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
    useEditor.setState({ build, building: false, loadingPreview: null, buildProgress: null });
    rebuilt({ ok: true });
    if (moved)
      useDoc.getState().update(
        (d) => {
          const t = d.tabs.find((x) => x.id === asm.id);
          if (t?.type === 'assembly') t.instances = solved.instances;
        },
        { undoable: false },
      );
    if (!explodeActive() && !missing.length && !failedMates.length && ![...sources.values()].some((s) => s.failed))
      void saveBuildPreview(useDoc.getState().doc ?? doc, build);
  } catch (e) {
    if (e instanceof SupersededError) return;
    if (mySeq === seq) {
      useEditor.setState({ building: false, loadingPreview: null, buildProgress: null });
      useEditor.getState().showToast(`Rebuild failed: ${(e as Error).message}`, 'error');
      rebuilt({ ok: false, error: (e as Error).message });
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
  const report = beginBuild(doc, studio.name, mySeq);
  // Colours by creation order need the order of this Part Studio's last build (the app's last one may be another
  // tab's); good enough for display. Parts brought from another Part Studio keep its colours unless given one here.
  const partMeta = studioPartMeta(studio, studioOrder.get(studio.id) ?? []);
  try {
    // as the chosen configuration has them; the Part Studios they derive from are built first
    const base = configuredFeatures(studio).slice(0, upTo);
    const all = await withDerivedSources(doc, studio.id, preview ? [...base, preview] : base, report);
    if (mySeq !== seq) return;
    const res = await kernel().build(studio.id, {
      units: doc.units,
      features: all.slice(0, base.length),
      partMeta,
      upTo,
      preview: preview && all[base.length],
    }, (p) => report(studio.name, p));
    if (mySeq !== seq) return;
    studioOrder.set(studio.id, res.partOrder);
    // Assign palette colours for parts that were new in this build.
    for (const p of res.parts) if (!studio.parts[p.id]?.color && !p.derived) p.color = partColorFor(studio, p.id, res.partOrder);
    if (res.preview) for (const p of res.preview.parts) if (!studio.parts[p.id]?.color && !p.derived) p.color = partColorFor(studio, p.id, res.partOrder);
    useEditor.setState({ build: res, building: false, loadingPreview: null, buildProgress: null });
    if (!ed) void saveBuildPreview(doc, res);
    rebuilt({ ok: true });
  } catch (e) {
    if (e instanceof SupersededError) return;
    if (mySeq === seq) {
      useEditor.setState({ building: false, loadingPreview: null, buildProgress: null });
      useEditor.getState().showToast(`Rebuild failed: ${(e as Error).message}`, 'error');
      rebuilt({ ok: false, error: (e as Error).message });
    }
  }
}

function schedule() {
  const inputs = inputsOf();
  if (!inputs) return;
  if (sameInputs(inputs, lastInputs)) return;
  seq++; // invalidate callbacks and results immediately, before the debounce expires
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
  // the kernel failed or hung and was started anew: the model is built again — unless it keeps failing on it
  const restarts: number[] = [];
  k.restartListeners.add(() => {
    const now = Date.now();
    restarts.push(now);
    while (restarts.length && now - restarts[0] > 60_000) restarts.shift();
    useEditor.setState({ building: false, kernelReady: false, loadingPreview: null, buildProgress: null });
    if (restarts.length >= 3) {
      useEditor.getState().showToast(t('The geometry kernel keeps failing on this model: undo the last change (Ctrl+Z) or reload the page'), 'error');
      return;
    }
    useEditor.getState().showToast(t('The geometry kernel failed and was restarted: the model is being rebuilt'), 'error');
    requestRebuild();
  });
  // another document: the builders of the one before (its Part Studios, variants, sources) are forgotten — their
  // shapes would stay in the kernel's memory for the whole session otherwise (the new one is built anew anyway)
  useDoc.subscribe((s, prev) => {
    if (s.doc?.id !== prev.doc?.id || s.doc?.activeTab !== prev.doc?.activeTab) {
      dropRebuilds();
      useEditor.setState({ build: null, building: !!(activeStudio(s.doc) || activeAssembly(s.doc)) });
    }
    if (prev.doc && s.doc?.id !== prev.doc.id) void k.reset().catch(() => undefined);
  });
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
