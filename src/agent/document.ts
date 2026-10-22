// Agent API on a whole document: one list of operations may build parts in a Part Studio, put them together in an
// assembly and draw them. Consecutive Part Studio ops run on the active Part Studio, assembly ops on the active
// assembly, drawing ops on the active drawing; {"op":"studio"} / {"op":"assembly"} / {"op":"drawing"} switch (or
// create) tabs. Nothing changes on an error.

import type { CadDocument, PartStudioTab } from '../core/types';
import { uid } from '../core/ids';
import { AgentError, runOps, type AgentKernel } from './runner';
import { isAssemblyOp, runAssemblyOps } from './assembly';
import { isDrawingOp, runDrawingOps, type DrawingHost } from './drawing';
import type { AgentOp, AssemblyOp, DrawingOp, RunReport } from './types';

/** Open the Part Studio with this name, or create it. */
export type StudioOp = { op: 'studio'; name?: string };
export type DocumentOp = AgentOp | AssemblyOp | DrawingOp | StudioOp;

export interface DocumentHost extends DrawingHost {
  /** The kernel the Part Studio ops build with. */
  kernel(doc: CadDocument, studio: PartStudioTab): AgentKernel;
}

type Kind = 'part' | 'assembly' | 'drawing' | 'tab';
const kindOf = (op: DocumentOp): Kind => (op.op === 'studio' ? 'tab' : isAssemblyOp(op) ? 'assembly' : isDrawingOp(op) ? 'drawing' : 'part');

/** Whether a list of ops needs the document-level runner (it switches tabs or works on assemblies). */
export const needsDocument = (ops: DocumentOp[]) => ops.some((op) => kindOf(op) !== 'part');

export async function runDocumentOps(doc: CadDocument, ops: DocumentOp[], host: DocumentHost): Promise<{ doc: CadDocument; report: RunReport }> {
  if (!Array.isArray(ops)) throw new AgentError('ops must be an array of operations');
  let d = doc;
  const out: RunReport = { ok: true, added: [], changed: [], removed: [], failed: [], applied: false };
  const fail = (at: number, report: RunReport) => {
    // the inner runners count ops from 0 within their stretch
    const error = report.error?.replace(/^op #(\d+)/, (_, n) => `op #${Number(n) + at}`);
    return { doc, report: { ...report, error, added: [], changed: [], removed: [], failed: [], applied: false } };
  };
  for (let i = 0; i < ops.length; ) {
    const kind = kindOf(ops[i]);
    let j = i + 1;
    while (j < ops.length && kind !== 'tab' && kindOf(ops[j]) === kind) j++;
    const stretch = ops.slice(i, j);
    if (kind === 'tab') {
      const op = ops[i] as StudioOp;
      const found = d.tabs.find((t) => t.type === 'partStudio' && (!op.name || t.name === op.name));
      if (found) d = { ...d, activeTab: found.id };
      else {
        let n = 1;
        while (d.tabs.some((t) => t.name === `Part Studio ${n}`)) n++;
        const ps: PartStudioTab = { id: uid('ps'), type: 'partStudio', name: op.name ?? `Part Studio ${n}`, features: [], rollback: null, parts: {} };
        d = { ...d, tabs: [...d.tabs, ps], activeTab: ps.id };
        out.added.push(ps.name);
      }
    } else if (kind === 'assembly') {
      const r = await runAssemblyOps(d, stretch as AssemblyOp[], host);
      if (r.report.error) return fail(i, r.report);
      d = r.doc;
      out.added.push(...r.report.added);
      out.changed.push(...r.report.changed);
      out.removed.push(...r.report.removed);
      out.failed.push(...r.report.failed);
      out.assembly = r.report.assembly;
    } else if (kind === 'drawing') {
      const r = await runDrawingOps(d, stretch as DrawingOp[], host);
      if (r.report.error) return fail(i, r.report);
      d = r.doc;
      out.added.push(...r.report.added);
      out.changed.push(...r.report.changed);
      out.removed.push(...r.report.removed);
      out.drawing = r.report.drawing;
    } else {
      const studio = d.tabs.find((t) => t.id === d.activeTab && t.type === 'partStudio') as PartStudioTab | undefined;
      if (!studio) return fail(i, { ...out, ok: false, error: `op #0 (${ops[i].op}): the active tab is not a Part Studio — switch with {"op":"studio","name":"…"}` });
      const r = await runOps(studio, d.units, stretch as AgentOp[], host.kernel(d, studio));
      if (r.report.error) return fail(i, r.report);
      const next = r.studio;
      d = { ...d, tabs: d.tabs.map((t) => (t.id === studio.id ? next : t)) };
      out.added.push(...r.report.added);
      out.changed.push(...r.report.changed);
      out.removed.push(...r.report.removed);
      out.failed.push(...r.report.failed);
      out.model = r.report.model;
    }
    i = kind === 'tab' ? i + 1 : j;
  }
  out.ok = !out.failed.length;
  return { doc: d, report: out };
}
