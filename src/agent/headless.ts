// Headless agent API for Node: runs ops with the OpenCascade kernel in-process (no browser),
// e.g. from scripts/webcad.mjs or tests. Documents are plain CadDocument JSON (.webcad.json),
// the same format the app imports / exports.

import { setOC } from 'replicad';
import opencascade from 'replicad-opencascadejs';
import type { AssemblyTab, CadDocument, Feature, PartStudioTab, SelRef } from '../core/types';
import { buildDerivedSources } from '../core/derived';
import { docId, uid } from '../core/ids';
import { StudioBuilder, assemblyStepOf, placedShape, stlOf } from '../kernel/build';
import { addSubassemblies, applySolve } from '../assembly/mates';
import { expandAssembly, stepAssemblies } from '../assembly/expand';
import { sourceKey } from '../assembly/compose';
import { findDerivedSource, runOps, summarize, queryModel, type AgentKernel } from './runner';
import { studioSources, summarizeAssembly } from './assembly';
import { configuredFeatures } from '../core/config';
import { runDocumentOps, type DocumentHost, type DocumentOp } from './document';
import type { AssemblySummary, Edges, Faces, ModelSummary, Parts, RunReport } from './types';

let ocReady: Promise<void> | null = null;

/** Load the OpenCascade WASM once (path to replicad_single.wasm). */
export function initOpenCascade(wasmPath: string): Promise<void> {
  if (!ocReady)
    ocReady = (async () => {
      const oc = await opencascade({ locateFile: () => wasmPath } as never);
      setOC(oc);
    })();
  return ocReady;
}

/**
 * A builder for one Part Studio. With Derived features: `prepare` builds their sources first and readies the
 * features, `sources` finds the sources' builders.
 */
export function nodeKernel(
  units: CadDocument['units'],
  derived?: {
    prepare(features: Feature[]): Promise<Feature[]>;
    sources(key: string): StudioBuilder | undefined;
    source: NonNullable<AgentKernel['derivedSource']>;
  },
): AgentKernel & { builder: StudioBuilder } {
  const builder = new StudioBuilder();
  let reqId = 0;
  return {
    builder,
    build: async (features) => {
      const fs = derived ? await derived.prepare(features) : features;
      return builder.build({ type: 'build', reqId: ++reqId, units, features: fs, partMeta: {}, upTo: fs.length }, derived?.sources);
    },
    measure: async (refs: SelRef[]) => builder.measure(refs).items,
    derivedSource: derived?.source,
  };
}

export function emptyDocument(name: string): CadDocument {
  const ps: PartStudioTab = { id: uid('ps'), type: 'partStudio', name: 'Part Studio 1', features: [], rollback: null, parts: {} };
  const now = Date.now();
  return { id: docId(), name, created: now, modified: now, units: { length: 'mm', angle: 'deg' }, tabs: [ps], activeTab: ps.id, version: 1 };
}

function studioOf(doc: CadDocument): PartStudioTab {
  const t = doc.tabs.find((x) => x.id === doc.activeTab && x.type === 'partStudio') ?? doc.tabs.find((x) => x.type === 'partStudio');
  if (!t || t.type !== 'partStudio') throw new Error('The document has no Part Studio');
  return t;
}

const assemblyOf = (doc: CadDocument) => doc.tabs.find((x) => x.id === doc.activeTab && x.type === 'assembly') as AssemblyTab | undefined;

export interface HeadlessSession {
  doc: CadDocument;
  run(ops: DocumentOp[]): Promise<RunReport>;
  /** The active Part Studio's model, or the active assembly. */
  state(): Promise<ModelSummary | { assembly: AssemblySummary }>;
  query(q: { faces?: Faces; edges?: Edges; parts?: Parts }): Promise<unknown>;
  /** The active Part Studio's parts, or the active assembly (with its product tree). */
  exportStep(): Promise<Uint8Array>;
  exportStl(binary?: boolean): Promise<Uint8Array>;
}

/** A document session; `run` applies ops in place when they succeed (like the browser API). */
export async function openHeadless(doc: CadDocument, wasmPath: string): Promise<HeadlessSession> {
  await initOpenCascade(wasmPath);
  // one builder per Part Studio: its parts for the studio's own ops, for the assemblies that use them and for the
  // Part Studios that derive from it
  const kernels = new Map<string, ReturnType<typeof nodeKernel>>();
  /** The document the builds belong to now (a run works on its own copy). */
  let docNow = doc;
  const builderOf = (key: string) => kernels.get(key)?.builder;
  const metaOf = (s: PartStudioTab) => Object.fromEntries(Object.entries(s.parts).map(([id, m]) => [id, { name: m.name, color: m.color }]));
  let reqId = 0;
  /** Build the Part Studios a studio derives from (theirs first), then ready its features. */
  const prepare = (studioId: string, features: Feature[]) =>
    buildDerivedSources(docNow, studioId, features, (id) => id, (s, feats) =>
      kernelOf(docNow, s).builder.build({ type: 'build', reqId: ++reqId, units: docNow.units, features: feats, partMeta: metaOf(s), upTo: feats.length, meshless: true }, builderOf),
    );
  /** A Part Studio by name, built (its sources first), as a source for another one. */
  const source = async (name: string, forStudio: string) => {
    const s = findDerivedSource(docNow, name, forStudio);
    const upTo = s.rollback ?? s.features.length;
    const features = await prepare(s.id, configuredFeatures(s).slice(0, upTo));
    const res = await kernelOf(docNow, s).builder.build({ type: 'build', reqId: ++reqId, units: docNow.units, features, partMeta: metaOf(s), upTo, meshless: true }, builderOf);
    return { studioId: s.id, name: s.name, parts: res.partList ?? [] };
  };
  const kernelOf = (d: CadDocument, studio: PartStudioTab): ReturnType<typeof nodeKernel> => {
    docNow = d;
    let k = kernels.get(studio.id);
    if (!k) kernels.set(studio.id, (k = nodeKernel(d.units, { prepare: (features) => prepare(studio.id, features), sources: builderOf, source })));
    return k;
  };
  const host: DocumentHost = {
    kernel: kernelOf,
    async studio(d, studio) {
      const upTo = studio.rollback ?? studio.features.length;
      const k = kernelOf(d, studio);
      const features = await prepare(studio.id, configuredFeatures(studio).slice(0, upTo));
      const res = await k.builder.build({ type: 'build', reqId: ++reqId, units: d.units, features, partMeta: metaOf(studio), upTo }, builderOf);
      return { parts: new Map(res.parts.map((p) => [p.id, p])), mates: res.mates ?? [] };
    },
  };
  /** The active assembly's sources, every Part Studio built (so its builder holds the full model). */
  const assemblySources = async (a: AssemblyTab) => addSubassemblies(session.doc.tabs, a, await studioSources(session.doc, host));
  const shape = (studioKey: string, partId: string) => kernels.get(studioKey)?.builder.shapesFor([partId])[0];
  const session: HeadlessSession = {
    doc,
    async run(ops) {
      const { doc: next, report } = await runDocumentOps(session.doc, ops, host);
      if (report.ok) {
        session.doc = { ...next, modified: Date.now() };
        report.applied = true;
      }
      return report;
    },
    async state() {
      const a = assemblyOf(session.doc);
      if (!a) return summarize(studioOf(session.doc), session.doc.units, kernelOf(session.doc, studioOf(session.doc)));
      const src = await assemblySources(a);
      return { assembly: summarizeAssembly(session.doc, a, src, applySolve(structuredClone(a) as AssemblyTab, src)) };
    },
    query: (q) => queryModel(studioOf(session.doc), session.doc.units, kernelOf(session.doc, studioOf(session.doc)), q),
    async exportStep() {
      const a = assemblyOf(session.doc);
      if (a) {
        const src = await assemblySources(a);
        return assemblyStepOf(stepAssemblies(a.name, a.instances.filter((i) => !i.hidden), src), shape);
      }
      const s = studioOf(session.doc);
      await summarize(s, session.doc.units, kernelOf(session.doc, s));
      return kernelOf(session.doc, s).builder.exportStep([]);
    },
    async exportStl(binary = true) {
      const a = assemblyOf(session.doc);
      if (a) {
        const src = await assemblySources(a);
        const items = expandAssembly(a, src)
          .instances.filter((i) => !i.hidden)
          .flatMap((i) => {
            const it = shape(sourceKey(i), i.partId);
            return it ? [{ ...it, name: i.name, shape: placedShape(it.shape, i) }] : [];
          });
        return stlOf(items, 0.01, 0.2, binary);
      }
      const s = studioOf(session.doc);
      await summarize(s, session.doc.units, kernelOf(session.doc, s));
      return kernelOf(session.doc, s).builder.exportStl([], 0.01, 0.2, binary);
    },
  };
  return session;
}

export { runOps };
