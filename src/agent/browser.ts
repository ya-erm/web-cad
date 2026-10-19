// window.webcad: the agent API inside the running app, plus the client of the dev-server bridge
// (vite.config.ts) that lets command-line agents call it: `npm run agent -- run ops.json`.

import type { Draft } from 'immer';
import type { CadDocument, ConfigInput, DocTab, Feature, PartStudioTab } from '../core/types';
import { buildDerivedSources, sourceUnits } from '../core/derived';
import { derivableVersions, loadVersionSources, versionDocument } from '../store/versionSources';
import { kernel } from '../kernel/client';
import { LENGTH_FACTOR } from '../core/expr';
import { activeAssembly, activeStudio, useDoc, withStudio } from '../store/docStore';
import { useEditor, type ViewCommand } from '../store/editorStore';
import * as db from '../store/persistence';
import { projectText } from '../store/folderStore';
import { fileVersions } from '../store/versions';
import { getEngine } from '../viewport/engineRef';
import { buildStudio } from '../assembly/sources';
import { addSubassemblies, applySolve } from '../assembly/mates';
import { expandAssembly, stepAssemblies } from '../assembly/expand';
import { sourceKey } from '../assembly/compose';
import { AgentError, derivedVariant, findDerivedSource, queryModel, runOps, summarize, type AgentKernel } from './runner';
import { studioSources, summarizeAssembly } from './assembly';
import { configuredFeatures } from '../core/config';
import { needsDocument, runDocumentOps, type DocumentHost, type DocumentOp } from './document';
import type { AgentOp, AssemblySummary, Edges, Faces, ModelSummary, Parts, RunReport } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, what: string, ms = 15000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new AgentError(`Timed out waiting for ${what}`);
    await sleep(50);
  }
}

function agentKernel(studio: PartStudioTab, doc: CadDocument): AgentKernel {
  // a separate builder key so agent builds never supersede the UI's own rebuilds
  const keyOf = (id: string) => `agent:${id}`;
  const studioKey = keyOf(studio.id);
  const units = doc.units;
  const metaOf = (s: PartStudioTab) => Object.fromEntries(Object.entries(s.parts).map(([id, m]) => [id, { name: m.name, color: m.color, hidden: m.hidden }]));
  return {
    async build(features: Feature[]) {
      await kernel().ready();
      // the Part Studios it derives from first (their own agent builders), the versions among them loaded
      await loadVersionSources(doc, features);
      const fs = await buildDerivedSources(doc, studio.id, features, keyOf, (s, feats, u) =>
        kernel().build(keyOf(s.id), { units: u, features: feats, partMeta: metaOf(s), upTo: feats.length, meshless: true }),
      );
      return kernel().build(studioKey, { units, features: fs, partMeta: metaOf(studio), upTo: fs.length });
    },
    async derivedSource(name, forStudio, names, from) {
      await kernel().ready();
      // a saved version: of this document, or of another one by name
      let versionId: string | undefined;
      if (from) {
        const docs = await derivableVersions(doc.id, doc.name);
        const lower = (x: string) => x.toLowerCase();
        const d = from.document ? (docs.find((x) => x.name === from.document) ?? docs.find((x) => lower(x.name) === lower(from.document!))) : docs.find((x) => x.docId === doc.id);
        if (!d) throw new AgentError(from.document ? `No document "${from.document}" with versions. Documents with versions: ${docs.map((x) => x.name).join(', ') || '(none)'}` : 'This document has no versions');
        const v = d.versions.find((x) => x.name === from.version) ?? d.versions.find((x) => lower(x.name) === lower(from.version));
        if (!v) throw new AgentError(`No version "${from.version}" of ${d.name}. Versions: ${d.versions.map((x) => x.name).join(', ')}`);
        versionId = v.id;
        // with the versions it derives from in turn
        const snap = await versionDocument(v.id);
        if (snap) await loadVersionSources(snap);
      }
      const base = findDerivedSource(doc, name, forStudio, versionId);
      // in the configuration chosen for it (its builder: the variant's)
      const { studio: s, configuration } = derivedVariant(base, names, units.length);
      const upTo = s.rollback ?? s.features.length;
      const fs = await buildDerivedSources(doc, s.id, configuredFeatures(s).slice(0, upTo), keyOf, (x, feats, u) =>
        kernel().build(keyOf(x.id), { units: u, features: feats, partMeta: metaOf(x), upTo: feats.length, meshless: true }),
      );
      const res = await kernel().build(keyOf(s.id), { units: sourceUnits(doc, s.id), features: fs, partMeta: metaOf(s), upTo, meshless: true });
      const connectors = s.features.filter((f) => f.type === 'mateConnector').map((f) => ({ id: f.id, name: f.name }));
      const sketches = res.sketches.map((x) => ({ id: x.featureId, name: x.name ?? x.featureId }));
      return { studioId: base.id, name: base.name, parts: res.partList ?? [], connectors, sketches, ...(configuration ? { configuration } : {}) };
    },
    async measure(refs) {
      return (await kernel().measure({ studioKey, refs })).items;
    },
  };
}

/** Part Studios for assemblies are built by the app's own kernel builders (shared with the tabs); the agent's own ops by its key. */
const browserHost: DocumentHost = {
  kernel: (doc, studio) => agentKernel(studio, doc),
  studio: (doc, studio) => buildStudio(doc, studio),
};

function current(forEdit = false) {
  const doc = useDoc.getState().doc;
  if (!doc) throw new AgentError('No document is open: call open(idOrName) or create(name) first');
  const studio = activeStudio(doc);
  if (!studio) throw new AgentError('The active tab is not a Part Studio');
  if (forEdit && useEditor.getState().editing)
    throw new AgentError('A feature dialog or sketch is open in the app: finish it first or call cancelEdit()');
  return { doc, studio };
}

const toBase64 = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const VIEWS = ['front', 'back', 'left', 'right', 'top', 'bottom', 'iso', 'dimetric', 'trimetric'] as const;
type ViewName = (typeof VIEWS)[number] | 'fit';

const HELP = `WebCAD agent API (window.webcad, or \`npm run agent -- call <method> <json args>\` via the dev server).
Methods:
  documents()                       list documents in this browser
  open(idOrName) / create(name)     open or create a document (shows it in the app)
  state()                           features (status), variables, parts (bbox, volume), sketch frames — or, on an
                                    assembly tab, its instances (placement, box) and mates (ok or not)
  run(ops, {atomic?})               apply operations as ONE undo step; atomic (default) = nothing changes if a feature fails;
                                    assemblies: {"op":"assembly"}, insert, place, mate, group, relation… ({"op":"studio"} back)
  query({faces|edges|parts})        list matching faces / edges with geometry (to design queries)
  feature(name)                     raw feature JSON
  undo() / redo() / cancelEdit()
  view(name)                        iso | top | front | right | … | fit
  section({plane, offset?, flip?})  section view by top | front | right (null = off)
  screenshot({view?})               PNG data URL of the graphics area
  export(format)                    stl | step | webcad → { fileName, mime, base64 }
Ops reference with examples: docs/agent-api.md in the WebCAD repository.`;

export const webcadApi = {
  version: 1,

  help(): string {
    return HELP;
  },

  async documents() {
    return (await db.listDocuments()).filter((d) => !d.trashed).map((d) => ({ id: d.id, name: d.name, modified: new Date(d.modified).toISOString() }));
  },

  async open(idOrName: string) {
    const docs = (await db.listDocuments()).filter((d) => !d.trashed);
    const d = docs.find((x) => x.id === idOrName) ?? docs.find((x) => x.name === idOrName) ?? docs.find((x) => x.name.toLowerCase() === idOrName.toLowerCase());
    if (!d) throw new AgentError(`No document "${idOrName}". Documents: ${docs.map((x) => x.name).join(', ') || '(none)'}`);
    useEditor.getState().cancelEditing();
    location.hash = `#/doc/${d.id}`;
    await waitFor(() => useDoc.getState().doc?.id === d.id, 'the document to open');
    return { id: d.id, name: d.name };
  },

  async create(name = 'Agent model') {
    const id = await useDoc.getState().createDocument(name);
    location.hash = `#/doc/${id}`;
    await waitFor(() => useDoc.getState().doc?.id === id, 'the new document to open');
    return { id, name };
  },

  async state(): Promise<(ModelSummary | { assembly: AssemblySummary }) & { document: { id: string; name: string }; tab: string }> {
    const doc = useDoc.getState().doc;
    const asm = activeAssembly(doc);
    if (doc && asm) {
      // an assembly tab: its instances, mates and whether they hold
      const src = addSubassemblies(doc.tabs, asm, await studioSources(doc, browserHost));
      return { document: { id: doc.id, name: doc.name }, tab: asm.name, assembly: summarizeAssembly(doc, asm, src, applySolve(structuredClone(asm), src)) };
    }
    const { doc: d, studio } = current();
    return { document: { id: d.id, name: d.name }, tab: studio.name, ...(await summarize(studio, d.units, agentKernel(studio, d))) };
  },

  async run(ops: DocumentOp[], opts: { atomic?: boolean } = {}): Promise<RunReport> {
    if (useDoc.getState().readOnly) throw new AgentError('A version of the document is open for viewing in the app: return to the workspace first');
    if (needsDocument(ops)) {
      // assemblies / several tabs: the whole document, as one undo step
      const doc = useDoc.getState().doc;
      if (!doc) throw new AgentError('No document is open: call open(idOrName) or create(name) first');
      if (useEditor.getState().editing) throw new AgentError('A feature dialog or sketch is open in the app: finish it first or call cancelEdit()');
      const { doc: next, report } = await runDocumentOps(doc, ops, browserHost);
      if (!report.error && (report.ok || opts.atomic === false)) {
        useDoc.getState().update((d) => {
          d.tabs = next.tabs as Draft<DocTab>[];
          d.activeTab = next.activeTab;
        });
        report.applied = true;
      }
      return report;
    }
    const { doc, studio } = current(true);
    const { studio: next, report } = await runOps(studio, doc.units, ops as AgentOp[], agentKernel(studio, doc));
    if (!report.error && (report.ok || opts.atomic === false)) {
      useDoc.getState().update((d) =>
        withStudio(d, (s) => {
          s.features = next.features as Draft<Feature>[];
          s.rollback = next.rollback;
          s.parts = next.parts;
          if (next.folders) s.folders = next.folders;
          s.configuration = next.configuration as Draft<ConfigInput>[] | undefined;
          s.configChoice = next.configChoice;
        }),
      );
      report.applied = true;
    }
    return report;
  },

  async query(q: { faces?: Faces; edges?: Edges; parts?: Parts }) {
    const { doc, studio } = current();
    return queryModel(studio, doc.units, agentKernel(studio, doc), q);
  },

  feature(name: string): Feature {
    const { studio } = current();
    const f = studio.features.find((x) => x.name === name || x.id === name);
    if (!f) throw new AgentError(`No feature "${name}"`);
    return f;
  },

  undo() {
    useDoc.getState().undo();
    return true;
  },

  redo() {
    useDoc.getState().redo();
    return true;
  },

  cancelEdit() {
    useEditor.getState().cancelEditing();
    return true;
  },

  async view(name: ViewName = 'iso') {
    const cmd: ViewCommand = name === 'fit' ? { kind: 'fit' } : { kind: 'std', view: name };
    if (name !== 'fit' && !VIEWS.includes(name)) throw new AgentError(`Unknown view "${name}": ${VIEWS.join(', ')}, fit`);
    useEditor.getState().view(cmd);
    await sleep(700); // camera animation
    return true;
  },

  /** Section view: plane top | front | right (offset in document units, flip = keep the other side); null turns it off. */
  section(opts: { plane: 'top' | 'front' | 'right'; offset?: number; flip?: boolean } | null) {
    const { doc } = current();
    if (!opts) {
      useEditor.setState({ section: null });
      return true;
    }
    const normals: Record<string, [number, number, number]> = { top: [0, 0, 1], front: [0, -1, 0], right: [1, 0, 0] };
    if (!normals[opts.plane]) throw new AgentError('plane: top | front | right');
    const off = (opts.offset ?? 0) * LENGTH_FACTOR[doc.units.length];
    useEditor.setState({ section: { source: opts.plane, normal: normals[opts.plane], origin: [0, 0, 0], offset: off, flip: !!opts.flip } });
    return true;
  },

  async screenshot(opts: { view?: ViewName } = {}) {
    // any tab with a graphics area: a Part Studio or an assembly
    if (!useDoc.getState().doc) throw new AgentError('No document is open: call open(idOrName) or create(name) first');
    // wait for the app's own rebuild of the latest edit
    await waitFor(() => !useEditor.getState().building, 'the model to rebuild', 30000);
    if (opts.view) await webcadApi.view(opts.view);
    const e = getEngine();
    if (!e) throw new AgentError('The graphics area is not visible');
    return e.snapshot();
  },

  async export(format: 'stl' | 'step' | 'webcad' = 'stl') {
    const open = useDoc.getState().doc;
    if (!open) throw new AgentError('No document is open: call open(idOrName) or create(name) first');
    const safe = open.name.replace(/[^\p{L}\p{N}._ -]+/gu, '_');
    if (format === 'webcad') {
      // the project file with the document's versions
      const bytes = new TextEncoder().encode(projectText(open, await fileVersions(open.id)));
      return { fileName: `${safe}.webcad.json`, mime: 'application/json', base64: toBase64(bytes) };
    }
    if (format !== 'stl' && format !== 'step') throw new AgentError('format: stl | step | webcad');
    const asm = activeAssembly(open);
    if (asm) {
      // the assembly (STEP: with its product tree), every Part Studio built by the app's kernel
      const src = addSubassemblies(open.tabs, asm, await studioSources(open, browserHost));
      const shown = asm.instances.filter((i) => !i.hidden);
      const res = await kernel().exportFile(
        format === 'step'
          ? { studioKey: '', format, partIds: [], assemblies: stepAssemblies(asm.name, shown, src) }
          : {
              studioKey: '',
              format,
              partIds: [],
              instances: expandAssembly({ ...asm, instances: shown }, src).instances.map((i) => ({ studioKey: sourceKey(i), partId: i.partId, name: i.name, position: i.position, rotation: i.rotation })),
              tolerance: 0.01,
              angularTolerance: 0.2,
            },
      );
      return { fileName: `${safe} — ${asm.name}.${format}`, mime: res.mime, base64: toBase64(res.data) };
    }
    const { doc, studio } = current();
    const k = agentKernel(studio, doc);
    await k.build(configuredFeatures(studio).slice(0, studio.rollback ?? studio.features.length));
    const res = await kernel().exportFile({ studioKey: `agent:${studio.id}`, format, partIds: [], tolerance: 0.01, angularTolerance: 0.2 });
    return { fileName: `${safe}.${format}`, mime: res.mime, base64: toBase64(res.data) };
  },
};

type Api = typeof webcadApi;

declare global {
  interface Window {
    webcad: Api;
  }
}

/** Expose window.webcad and, when served by the WebCAD dev / preview server, answer bridge calls. */
export function installAgentApi() {
  window.webcad = webcadApi;
  void bridgeLoop();
}

/** Short id of this browser tab for the bridge (kept across reloads of the tab). */
function tabId(): string {
  const KEY = 'webcad.agentTab';
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = `t${Math.random().toString(36).slice(2, 6)}`;
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

async function bridgeLoop() {
  const base = new URL('__webcad/', document.baseURI);
  const tab = tabId();
  const post = (path: string, body?: unknown) =>
    fetch(new URL(path, base), {
      method: 'POST',
      headers: { 'x-webcad': 'app', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const r = await post('status');
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return; // static hosting: no bridge
  } catch {
    return;
  }
  for (;;) {
    try {
      const r = await post('poll', { tab, document: useDoc.getState().doc?.name ?? null });
      if (r.status === 204) continue;
      if (!r.ok) {
        await sleep(3000);
        continue;
      }
      const job = (await r.json()) as { id: string; method: string; args?: unknown[] };
      let reply: { id: string; result?: unknown; error?: string };
      try {
        const fn = (webcadApi as Record<string, unknown>)[job.method];
        if (typeof fn !== 'function') throw new AgentError(`Unknown method "${job.method}". ${HELP}`);
        reply = { id: job.id, result: await (fn as (...a: unknown[]) => unknown).apply(webcadApi, job.args ?? []) };
      } catch (e) {
        reply = { id: job.id, error: e instanceof Error ? e.message : String(e) };
      }
      await post('reply', reply);
    } catch {
      await sleep(3000);
    }
  }
}
