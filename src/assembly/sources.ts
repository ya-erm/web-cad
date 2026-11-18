// Part Studio parts used by assemblies: built through the same kernel builders (and cache) as the
// Part Studio tabs themselves.

import { create } from 'zustand';
import { kernel } from '../kernel/client';
import type { BuildResult, PartMesh } from '../kernel/protocol';
import type { CadDocument, PartStudioTab } from '../core/types';
import { configuredFeatures } from '../core/config';
import { effectiveRollback } from '../store/docStore';
import { partColorFor, withDerivedSources, type ReportBuildProgress } from '../store/rebuild';
import type { AssemblySources, StudioData } from './compose';

async function buildStudioResult(doc: CadDocument, studio: PartStudioTab, report?: ReportBuildProgress): Promise<BuildResult> {
  const upTo = effectiveRollback(studio);
  const partMeta: Record<string, { name?: string; color?: string; hidden?: boolean }> = {};
  for (const [id, m] of Object.entries(studio.parts)) partMeta[id] = { name: m.name, color: m.color };
  // the Part Studio as its chosen configuration has it (the Part Studios it derives from built first)
  const features = await withDerivedSources(doc, studio.id, configuredFeatures(studio).slice(0, upTo), report);
  const res = await kernel().build(studio.id, { units: doc.units, features, partMeta, upTo }, (p) => report?.(studio.name, p));
  for (const p of res.parts) {
    if (!studio.parts[p.id]?.color && !p.derived) p.color = partColorFor(studio, p.id, res.partOrder);
    p.hidden = false;
  }
  return res;
}

/** The parts and mate connectors of a Part Studio as built at its rollback bar (names and colours as in the studio). */
export async function buildStudio(doc: CadDocument, studio: PartStudioTab, report?: ReportBuildProgress): Promise<StudioData> {
  const res = await buildStudioResult(doc, studio, report);
  return { parts: new Map(res.parts.map((p) => [p.id, p])), mates: res.mates ?? [], ...(Object.values(res.statuses).some((s) => !s.ok) ? { failed: true } : {}) };
}

export async function buildStudioParts(doc: CadDocument, studio: PartStudioTab): Promise<PartMesh[]> {
  return (await buildStudioResult(doc, studio)).parts;
}

/** Source Part Studios of the active assembly, the instances whose source is gone and the mates that cannot be satisfied. */
export const useAssembly = create<{ sources: AssemblySources; missing: string[]; failedMates: string[] }>(() => ({
  sources: new Map(),
  missing: [],
  failedMates: [],
}));
