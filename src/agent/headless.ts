// Headless agent API for Node: runs ops with the OpenCascade kernel in-process (no browser),
// e.g. from scripts/webcad.mjs or tests. Documents are plain CadDocument JSON (.webcad.json),
// the same format the app imports / exports.

import { setOC } from 'replicad';
import opencascade from 'replicad-opencascadejs';
import type { AssemblyTab, CadDocument, DrawingTab, Feature, PartStudioTab, SelRef, SkFont } from '../core/types';
import { shownParts } from '../assembly/expand';
import { variantStudio } from '../core/config';
import { drawSheet, sheetFile } from '../drawing/drawingModel';
import type { PdfFont } from '../export/pdf';
import { pdfFontOf } from '../export/pdfFont';
import { summarizeDrawing } from './drawing';
import { addReport, applyVersionOp, stretches, summarizeVersions, type AnyOp, type ProjectDoc } from './versions';
import { FONT_FILES, fontsLoaded, registerFont } from '../sketch/text';
import { buildDerivedSources, setVersionSnapshot, sourceUnits } from '../core/derived';
import { docId, uid } from '../core/ids';
import { StudioBuilder, assemblyStepOf, placedShape, stlOf } from '../kernel/build';
import { addSubassemblies, applySolve } from '../assembly/mates';
import { expandAssembly, stepAssemblies } from '../assembly/expand';
import { sourceKey } from '../assembly/compose';
import { AgentError, derivedVariant, findDerivedSource, runOps, summarize, queryModel, measureModel, type AgentKernel } from './runner';
import { animateMate, studioSources, summarizeAssembly } from './assembly';
import { configuredFeatures } from '../core/config';
import { runDocumentOps, type DocumentHost } from './document';
import type { AnimateQuery, AnimateResult, AssemblySummary, DrawingSummary, Edges, Faces, ModelSummary, Parts, RunReport, VersionsSummary } from './types';

let ocReady: Promise<void> | null = null;

/** Load the OpenCascade WASM once (path to replicad_single.wasm), and the fonts of sketch text. */
export function initOpenCascade(wasmPath: string): Promise<void> {
  if (!ocReady)
    ocReady = (async () => {
      const oc = await opencascade({ locateFile: () => wasmPath } as never);
      setOC(oc);
      if (!fontsLoaded()) {
        for (const [k, url] of Object.entries(FONT_FILES)) {
          const buf = await readBytes(url);
          registerFont(k as SkFont, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
        }
      }
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
const drawingOf = (doc: CadDocument) => doc.tabs.find((x) => x.id === doc.activeTab && x.type === 'drawing') as DrawingTab | undefined;

/**
 * A file next to the module (Node only — the app's types have no Node): the built-in module taken as it is (the CLI's
 * Vite runner is closed once the module is imported: a dynamic import would fail).
 */
async function readBytes(url: URL): Promise<Uint8Array> {
  const fsModule = 'node:fs/promises';
  const proc = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process;
  const { readFile } = (proc?.getBuiltinModule?.(fsModule) ?? (await import(/* @vite-ignore */ fsModule))) as { readFile(p: URL): Promise<Uint8Array> };
  return readFile(url);
}

let pdfFontReady: Promise<PdfFont | undefined> | null = null;
/** The font a drawing's PDF embeds (Inter, as the app's): its Cyrillic too. */
function pdfFont(): Promise<PdfFont | undefined> {
  pdfFontReady ??= readBytes(new URL('../sketch/fonts/Inter-Regular.woff', import.meta.url))
    .then((b) => pdfFontOf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer))
    .catch(() => undefined);
  return pdfFontReady;
}

export interface HeadlessSession {
  /** The document, with its versions and the workspaces it is not in (as a project file has them). */
  doc: CadDocument;
  run(ops: AnyOp[]): Promise<RunReport>;
  /** The active Part Studio's model, the active assembly, or the active drawing. */
  state(): Promise<ModelSummary | { assembly: AssemblySummary } | { drawing: DrawingSummary }>;
  query(q: { faces?: Faces; edges?: Edges; parts?: Parts }): Promise<unknown>;
  /** The measure panel's values of the matched selections (document units, degrees). */
  measure(q: { faces?: Faces; edges?: Edges; parts?: Parts }): Promise<Record<string, number>>;
  /** A mate's motion in frames (Onshape Animate): where the instances that move are; the document does not change. */
  animate(q: AnimateQuery): Promise<AnimateResult>;
  /** The active Part Studio's parts, or the active assembly (with its product tree). */
  exportStep(): Promise<Uint8Array>;
  exportStl(binary?: boolean): Promise<Uint8Array>;
  /** A drawing (by name; default the active one, else the first) as a PDF (Cyrillic too), SVG or DXF file. */
  exportDrawing(format: 'pdf' | 'svg' | 'dxf', name?: string): Promise<Uint8Array>;
  /** The document's versions, the workspace it is in and the others. */
  versions(): VersionsSummary;
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
  // the versions a project file keeps (named ones, the ones made since): Derived features may use their Part Studios
  const versionsNow = () => (session.doc as ProjectDoc).versions ?? [];
  for (const v of (doc as ProjectDoc).versions ?? []) if (v?.id && Array.isArray(v.tabs)) setVersionSnapshot(v.id, v);
  /** Build the Part Studios a studio derives from (theirs first), then ready its features. */
  const prepare = (studioId: string, features: Feature[]) =>
    buildDerivedSources(docNow, studioId, features, (id) => id, (s, feats, units) =>
      kernelOf(docNow, s).builder.build({ type: 'build', reqId: ++reqId, units, features: feats, partMeta: metaOf(s), upTo: feats.length, meshless: true }, builderOf),
    );
  /** A Part Studio by name (of the document or of a version it keeps), built (its sources first), as a source for another one. */
  const source = async (name: string, forStudio: string, names?: Record<string, string | number>, from?: { version: string; document?: string }) => {
    if (from?.document) throw new AgentError('Versions of other documents can be derived from in the browser only (`npm run agent -- run`)');
    const versions = versionsNow();
    const version = from && (versions.find((v) => v.name === from.version) ?? versions.find((v) => v.name.toLowerCase() === from.version.toLowerCase()));
    if (from && !version) throw new AgentError(`No version "${from.version}". Versions: ${versions.map((v) => v.name).join(', ') || '(none)'}`);
    const base = findDerivedSource(docNow, name, forStudio, version?.id);
    // in the configuration chosen for it (its builder: the variant's)
    const { studio: s, configuration } = derivedVariant(base, names, docNow.units.length);
    const upTo = s.rollback ?? s.features.length;
    const features = await prepare(s.id, configuredFeatures(s).slice(0, upTo));
    const units = sourceUnits(docNow, s.id);
    const res = await kernelOf(docNow, s).builder.build({ type: 'build', reqId: ++reqId, units, features, partMeta: metaOf(s), upTo, meshless: true }, builderOf);
    const connectors = s.features.filter((f) => f.type === 'mateConnector').map((f) => ({ id: f.id, name: f.name }));
    const sketches = res.sketches.map((x) => ({ id: x.featureId, name: x.name ?? x.featureId }));
    return { studioId: base.id, name: base.name, parts: res.partList ?? [], connectors, sketches, ...(configuration ? { configuration } : {}) };
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
    // drawings: a Part Studio (as a view's configuration has it) built, an assembly's parts placed in a builder of their own
    drawingSource: (d) => (tab, configuration) => {
      let get: (() => Promise<StudioBuilder>) | undefined;
      if (tab?.type === 'partStudio') {
        const s = variantStudio(tab, configuration);
        get = async () => {
          await host.studio(d, s);
          return kernelOf(d, s).builder;
        };
      } else if (tab?.type === 'assembly') {
        get = async () => {
          await studioSources(d, host);
          const b = new StudioBuilder();
          b.place(shownParts(d.tabs, tab).map((i) => ({ id: i.id, studioKey: sourceKey(i), partId: i.partId, name: i.name, position: i.position, rotation: i.rotation })), builderOf);
          return b;
        };
      }
      if (!get) return undefined;
      let built: Promise<StudioBuilder> | null = null;
      const b = () => (built ??= get!());
      return {
        projection: async (r) => ({ type: 'projection', reqId: 0, ...(await b()).projection(r.partIds, r.orientation, r.hidden, { axes: r.axes, section: r.section, breakout: r.breakout }) }),
        viewAnchor: async (r) => (await b()).viewAnchor(r.partIds, r.axes, r.p, r.circle, r.lineTo, r.cut),
        viewRefs: async (r) => (await b()).viewRefs(r.axes, r.refs, r.cut, r.near, r.partIds),
      };
    },
  };
  /** The active assembly's sources, every Part Studio built (so its builder holds the full model). */
  const assemblySources = async (a: AssemblyTab) => addSubassemblies(session.doc.tabs, a, await studioSources(session.doc, host));
  const shape = (studioKey: string, partId: string) => kernels.get(studioKey)?.builder.shapesFor([partId])[0];
  const session: HeadlessSession = {
    doc,
    async run(ops) {
      if (!Array.isArray(ops)) throw new AgentError('ops must be an array of operations');
      // the document's ops in stretches between version ops (applied at once, in order: the file's versions and workspaces)
      const out: RunReport = { ok: true, added: [], changed: [], removed: [], failed: [], applied: false };
      let versions = false;
      for (const s of stretches(ops)) {
        if ('op' in s) {
          try {
            const r = applyVersionOp(session.doc as ProjectDoc, s.op);
            if (r.created) setVersionSnapshot(r.created.id, r.created);
            session.doc = { ...r.doc, modified: Date.now() };
            if (r.merged) (out.versions ??= summarizeVersions(session.doc)).merged = r.merged;
            versions = true;
            out.applied = true;
          } catch (e) {
            return { ...out, ok: false, error: `op #${s.at} (${s.op.op}): ${e instanceof Error ? e.message : String(e)}` };
          }
          continue;
        }
        const { doc: next, report } = await runDocumentOps(session.doc, s.ops, host);
        addReport(out, report, s.at);
        if (!report.ok) return out;
        session.doc = { ...next, modified: Date.now() };
        out.applied = true;
      }
      if (versions) out.versions = { ...summarizeVersions(session.doc), ...(out.versions?.merged ? { merged: out.versions.merged } : {}) };
      return out;
    },
    async state() {
      const dw = drawingOf(session.doc);
      if (dw) return { drawing: await summarizeDrawing(session.doc, dw, host.drawingSource(session.doc)) };
      const a = assemblyOf(session.doc);
      if (!a) return summarize(studioOf(session.doc), session.doc.units, kernelOf(session.doc, studioOf(session.doc)));
      const src = await assemblySources(a);
      return { assembly: summarizeAssembly(session.doc, a, src, applySolve(structuredClone(a) as AssemblyTab, src)) };
    },
    query: (q) => queryModel(studioOf(session.doc), session.doc.units, kernelOf(session.doc, studioOf(session.doc)), q),
    measure: (q) => measureModel(studioOf(session.doc), session.doc.units, kernelOf(session.doc, studioOf(session.doc)), q),
    animate: (q) => animateMate(session.doc, host, q),
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
    async exportDrawing(format, name) {
      const dw = (name !== undefined
        ? session.doc.tabs.find((t) => t.type === 'drawing' && (t.name === name || t.name.toLowerCase() === name.toLowerCase()))
        : (drawingOf(session.doc) ?? session.doc.tabs.find((t) => t.type === 'drawing'))) as DrawingTab | undefined;
      if (!dw) throw new AgentError(name !== undefined ? `No drawing "${name}"` : 'The document has no drawing: make one with {"op":"drawing"}');
      const sheet = await drawSheet(session.doc, dw, host.drawingSource(session.doc));
      const file = sheetFile(sheet, format, dw.drawing.title || dw.name, format === 'pdf' ? await pdfFont() : undefined);
      return typeof file.data === 'string' ? new TextEncoder().encode(file.data) : file.data;
    },
    versions: () => summarizeVersions(session.doc),
  };
  return session;
}

export { runOps };
// the language of the sheets drawn (title block, section letters, callouts): the app's own choice
export { setLang } from '../i18n';
