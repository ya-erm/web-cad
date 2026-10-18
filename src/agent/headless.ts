// Headless agent API for Node: runs ops with the OpenCascade kernel in-process (no browser),
// e.g. from scripts/webcad.mjs or tests. Documents are plain CadDocument JSON (.webcad.json),
// the same format the app imports / exports.

import { setOC } from 'replicad';
import opencascade from 'replicad-opencascadejs';
import type { AssemblyTab, CadDocument, PartStudioTab, SelRef } from '../core/types';
import { docId, uid } from '../core/ids';
import { StudioBuilder, assemblyStepOf, placedShape, stlOf } from '../kernel/build';
import { addSubassemblies, applySolve } from '../assembly/mates';
import { expandAssembly, stepAssemblies } from '../assembly/expand';
import { runOps, summarize, queryModel, type AgentKernel } from './runner';
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

export function nodeKernel(units: CadDocument['units']): AgentKernel & { builder: StudioBuilder } {
  const builder = new StudioBuilder();
  let reqId = 0;
  return {
    builder,
    build: (features) => builder.build({ type: 'build', reqId: ++reqId, units, features, partMeta: {}, upTo: features.length }),
    measure: async (refs: SelRef[]) => builder.measure(refs).items,
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
  // one builder per Part Studio: its parts for the studio's own ops and for the assemblies that use them
  const kernels = new Map<string, ReturnType<typeof nodeKernel>>();
  const kernelOf = (d: CadDocument, studio: PartStudioTab) => {
    let k = kernels.get(studio.id);
    if (!k) kernels.set(studio.id, (k = nodeKernel(d.units)));
    return k;
  };
  let reqId = 0;
  const host: DocumentHost = {
    kernel: kernelOf,
    async studio(d, studio) {
      const upTo = studio.rollback ?? studio.features.length;
      const partMeta = Object.fromEntries(Object.entries(studio.parts).map(([id, m]) => [id, { name: m.name, color: m.color }]));
      const res = await kernelOf(d, studio).builder.build({ type: 'build', reqId: ++reqId, units: d.units, features: configuredFeatures(studio).slice(0, upTo), partMeta, upTo });
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
            const it = shape(i.studioId, i.partId);
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
