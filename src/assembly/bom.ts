// Bill of materials of an assembly (Onshape BOM): one row per distinct part (or sub-assembly), with how many
// instances use it — structured (sub-assemblies with their parts by levels), flattened or top-level only.

import type { AssemblyInstance, AssemblyTab, CadDocument } from '../core/types';
import { inputName } from '../core/config';
import { sourceKey, sourceMesh, type AssemblySources } from './compose';
import { expandAssembly } from './expand';

export interface BomRow {
  /** Item number: "2", and "2.1" for the first row inside sub-assembly 2 (structured). */
  item: string;
  /** 1 — the assembly's own instances, 2 — inside its sub-assemblies… */
  level: number;
  kind: 'part' | 'assembly';
  partNumber: string;
  name: string;
  description: string;
  /** Instances per one of its parent (structured), in all (flattened). */
  quantity: number;
  material: string;
  /** The Part Studio the part comes from (empty for a sub-assembly). */
  source: string;
  /** Its Part Studio (a sub-assembly: its assembly tab). */
  studioId: string;
  partId: string;
  /** The shown instances it stands for: parts (`X/inner` inside sub-assemblies) or sub-assembly instances. */
  instances: string[];
}

/** Onshape BOM types: sub-assemblies with their parts by levels, the parts only, the assembly's own instances only. */
export const BOM_TYPES = ['structured', 'flattened', 'topLevel'] as const;
export type BomType = (typeof BOM_TYPES)[number];
export const BOM_TYPE_LABELS: Record<BomType, string> = { structured: 'Structured', flattened: 'Flattened', topLevel: 'Top-level only' };

/** Columns of the table, in order; the part properties among them can be edited in the table. */
export const BOM_COLUMNS = ['item', 'partNumber', 'name', 'description', 'quantity', 'material', 'source'] as const;
export type BomColumn = (typeof BOM_COLUMNS)[number];
export const BOM_EDITABLE: BomColumn[] = ['partNumber', 'description', 'material'];
export const BOM_LABELS: Record<BomColumn, string> = {
  item: 'Item',
  partNumber: 'Part number',
  name: 'Name',
  description: 'Description',
  quantity: 'Quantity',
  material: 'Material',
  source: 'Part Studio',
};

/** A row for a part (its properties from its Part Studio) or a sub-assembly. */
function rowOf(doc: CadDocument, sources: AssemblySources, inst: AssemblyInstance): BomRow {
  const base = { item: '', level: 1, quantity: 0, instances: [] as string[] };
  if (inst.assemblyId) {
    const sub = sources.get(inst.assemblyId)?.assembly;
    const name = sub?.name ?? doc.tabs.find((x) => x.id === inst.assemblyId)?.name ?? inst.name.replace(/ <\d+>$/, '');
    return { ...base, kind: 'assembly', partNumber: '', name, description: '', material: '', source: '', studioId: inst.assemblyId, partId: '' };
  }
  const studio = doc.tabs.find((x) => x.id === inst.studioId);
  const meta = studio?.type === 'partStudio' ? studio.parts[inst.partId] : undefined;
  // a variant of its own configuration: named with its options, "Plate (Large)", "Plate (#length = 50 mm)"
  const options =
    studio?.type === 'partStudio'
      ? (studio.configuration ?? []).flatMap((i) => {
          const v = inst.configuration?.[i.id];
          if (!v) return [];
          if (i.kind === 'variable') return [`${inputName(studio.features, i)} = ${v}`];
          const o = i.options.find((x) => x.id === v);
          return o ? [o.name] : [];
        })
      : [];
  const name = sourceMesh(sources, inst)?.name ?? meta?.name ?? inst.name.replace(/ <\d+>$/, '');
  return {
    ...base,
    kind: 'part',
    partNumber: meta?.partNumber ?? '',
    name: options.length ? `${name} (${options.join(', ')})` : name,
    description: meta?.description ?? '',
    material: meta?.material ?? '',
    source: studio?.name ?? '?',
    studioId: inst.studioId,
    partId: inst.partId,
  };
}

/** Rows in the order the parts (and sub-assemblies) first appear among the instances. */
export function billOfMaterials(doc: CadDocument, asm: AssemblyTab, sources: AssemblySources, type: BomType = 'flattened'): BomRow[] {
  const top = type === 'flattened' ? expandAssembly(asm, sources).instances : asm.instances;
  return level(doc, sources, top.map((i) => ({ inst: i, id: i.id })), 1, 1, '', type === 'structured');
}

/**
 * The rows of one level: `found` — its instances in every one of the `parents` instances of the assembly it is
 * in (with their ids as shown); `deep` — follow each sub-assembly with its own rows ("2.1", "2.2"…).
 */
function level(doc: CadDocument, sources: AssemblySources, found: { inst: AssemblyInstance; id: string }[], parents: number, depth: number, prefix: string, deep: boolean): BomRow[] {
  const rows = new Map<string, BomRow & { first: AssemblyInstance }>();
  for (const { inst, id } of found) {
    // a part in another variant of its configuration is another row
    const key = inst.assemblyId ? `asm|${inst.assemblyId}` : `${sourceKey(inst)}|${inst.partId}`;
    let row = rows.get(key);
    if (!row) rows.set(key, (row = { ...rowOf(doc, sources, inst), item: `${prefix}${rows.size + 1}`, level: depth, first: inst }));
    row.instances.push(id);
  }
  return [...rows.values()].flatMap(({ first, ...row }) => {
    row.quantity = row.instances.length / parents;
    const sub = deep && first.assemblyId ? sources.get(first.assemblyId)?.assembly : undefined;
    if (!sub || depth > 16) return [row];
    const inside = row.instances.flatMap((id) => sub.instances.map((c) => ({ inst: c, id: `${id}/${c.id}` })));
    return [row, ...level(doc, sources, inside, row.instances.length, depth + 1, `${row.item}.`, deep)];
  });
}

/** CSV text (comma-separated, quoted where needed): a header row of `labels`, then the `columns` of each row. */
export function bomCsv(rows: BomRow[], columns: readonly BomColumn[], labels: Record<BomColumn, string>): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map((c) => labels[c]), ...rows.map((r) => columns.map((c) => r[c]))].map((line) => line.map(cell).join(',')).join('\n') + '\n';
}
