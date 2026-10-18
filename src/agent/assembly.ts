// Agent API for assemblies: open / create an assembly tab, insert instances (parts or sub-assemblies), place
// them, mate them, group them, relate mates — the same operations as the assembly tab of the app. Faces and
// edges for mates are found with the usual queries, in assembly coordinates, on the instance's placed part.

import type { AssemblyInstance, AssemblyMate, AssemblyTab, CadDocument, MateConnectorRef, MateEnd, MateLimits, PartStudioTab, Vec3 } from '../core/types';
import { uid } from '../core/ids';
import { LENGTH_FACTOR, tryEvaluate } from '../core/expr';
import { makeEvalContext } from '../core/features';
import { composeAssembly, insertPosition, instanceName, type AssemblySources, type StudioData } from '../assembly/compose';
import { addSubassemblies, applySolve, groupName, makeGroup, makeRelation, mateName, nearestFlip, relationName } from '../assembly/mates';
import { containsAssembly, expandAssembly, findInstance, topInstance } from '../assembly/expand';
import { AgentError, matchOnPart } from './runner';
import type { AssemblyOp, AssemblySummary, MateEndSpec, Num, Pt3, RunReport } from './types';

/** How the host builds a Part Studio for assemblies (the app's kernel in the browser, a builder in Node). */
export interface AssemblyHost {
  studio(doc: CadDocument, studio: PartStudioTab): Promise<StudioData>;
}

const OPS = new Set(['assembly', 'insert', 'place', 'mate', 'group', 'relation', 'deleteInstance', 'deleteMate']);
export const isAssemblyOp = (op: { op: string }) => OPS.has(op.op);

const round = (v: number) => Math.round(v * 1e4) / 1e4 + 0;
const round3 = (v: number[]): Pt3 => [round(v[0]), round(v[1]), round(v[2])];
/** Instance names compare without the spaces around "/" (a part inside a sub-assembly: "Sub <1>/Pin <1>"). */
const norm = (s: string) => s.replace(/\s*\/\s*/g, '/').trim().toLowerCase();

/** Build every Part Studio of the document once. */
export async function studioSources(doc: CadDocument, host: AssemblyHost): Promise<AssemblySources> {
  const out: AssemblySources = new Map();
  for (const t of doc.tabs) if (t.type === 'partStudio') out.set(t.id, await host.studio(doc, t));
  return out;
}

/** The assembly in a report: placements and boxes in document units, mates and whether they hold. */
export function summarizeAssembly(doc: CadDocument, asm: AssemblyTab, sources: AssemblySources, failed: string[]): AssemblySummary {
  const k = LENGTH_FACTOR[doc.units.length];
  const parts = composeAssembly(asm, sources).build.parts;
  const name = (id: string) => findInstance(asm, sources, id)?.name ?? id;
  return {
    name: asm.name,
    instances: asm.instances.map((i) => {
      const boxes = parts.filter((p) => p.id === i.id || p.id.startsWith(`${i.id}/`)).map((p) => p.bbox);
      const box = boxes.length
        ? { bboxMin: round3([0, 1, 2].map((c) => Math.min(...boxes.map((b) => b[0][c])) / k)), bboxMax: round3([0, 1, 2].map((c) => Math.max(...boxes.map((b) => b[1][c])) / k)) }
        : {};
      return {
        name: i.name,
        source: doc.tabs.find((x) => x.id === i.studioId)?.name ?? '?',
        position: round3(i.position.map((v) => v / k)),
        rotation: round3(i.rotation),
        ...(i.fixed ? { fixed: true } : {}),
        ...(i.hidden ? { hidden: true } : {}),
        ...(i.flexible ? { flexible: true } : {}),
        ...box,
      };
    }),
    mates: (asm.mates ?? []).map((m) => ({ name: m.name, type: m.type, a: name(m.a.instance), b: name(m.b.instance), ok: m.suppressed || !failed.includes(m.id) })),
    groups: (asm.groups ?? []).map((g) => ({ name: g.name, instances: g.members.map((m) => name(m.instance)) })),
    relations: (asm.relations ?? []).map((r) => ({ name: r.name, type: r.type, ok: !failed.includes(r.id) })),
  };
}

/**
 * Apply assembly ops to a copy of the document: the active assembly tab, or the one an `assembly` op opens or
 * creates. On an error nothing changes (the original document comes back with `ok: false`).
 */
export async function runAssemblyOps(doc: CadDocument, ops: AssemblyOp[], host: AssemblyHost): Promise<{ doc: CadDocument; report: RunReport }> {
  const d = structuredClone(doc) as CadDocument;
  const k = LENGTH_FACTOR[d.units.length];
  const base = await studioSources(d, host);
  let asm = d.tabs.find((t) => t.id === d.activeTab && t.type === 'assembly') as AssemblyTab | undefined;
  const added: string[] = [];
  const changed = new Set<string>();
  const removed: string[] = [];
  const sources = () => addSubassemblies(d.tabs, need(), new Map(base));
  function need(): AssemblyTab {
    if (!asm) throw new AgentError('No assembly: open or create one first with {"op":"assembly","name":"…"}');
    return asm;
  }
  const len = (v: Num, what: string) => {
    if (typeof v === 'number') return v * k;
    const r = tryEvaluate(v, 'length', makeEvalContext(d, {}));
    if (r === null) throw new AgentError(`Invalid ${what} "${v}"`);
    return r;
  };
  const mm = (p: Pt3): Vec3 => [p[0] * k, p[1] * k, p[2] * k];
  const instance = (n: string): AssemblyInstance => {
    const a = need();
    const i = a.instances.find((x) => x.name === n || x.id === n) ?? a.instances.find((x) => norm(x.name) === norm(n));
    if (!i) throw new AgentError(`No instance "${n}". Instances: ${a.instances.map((x) => x.name).join(', ') || '(none)'}`);
    return i;
  };
  const mateByName = (n: string): AssemblyMate => {
    const m = (need().mates ?? []).find((x) => x.name === n || x.id === n) ?? (need().mates ?? []).find((x) => x.name.toLowerCase() === n.toLowerCase());
    if (!m) throw new AgentError(`No mate "${n}". Mates: ${(need().mates ?? []).map((x) => x.name).join(', ') || '(none)'}`);
    return m;
  };

  /** A mate end: the instance (or a part of a sub-assembly) and the face / edge / vertex / mate connector on it. */
  const end = async (spec: MateEndSpec, src: AssemblySources): Promise<MateEnd> => {
    const a = need();
    const flat = expandAssembly(a, src).instances;
    const leaf = flat.find((x) => x.id === spec.instance || x.name === spec.instance) ?? flat.find((x) => norm(x.name) === norm(spec.instance));
    if (!leaf) throw new AgentError(`No instance "${spec.instance}" (a part of a sub-assembly: "Sub <1>/Part <1>"). Instances: ${flat.map((x) => x.name).join(', ')}`);
    if (leaf.assemblyId) throw new AgentError(`"${spec.instance}" is a sub-assembly: mate one of its parts ("${leaf.name}/…")`);
    let ref: MateConnectorRef;
    if (spec.connector) {
      const studio = d.tabs.find((x) => x.id === leaf.studioId && x.type === 'partStudio') as PartStudioTab | undefined;
      const f = studio?.features.find((x) => x.type === 'mateConnector' && (x.name === spec.connector || x.name.toLowerCase() === spec.connector!.toLowerCase()));
      const mc = f && src.get(leaf.studioId)?.mates.find((m) => m.featureId === f.id);
      if (!f || !mc) throw new AgentError(`No mate connector "${spec.connector}" in ${studio?.name ?? 'the Part Studio'}`);
      if (mc.owner !== leaf.partId) throw new AgentError(`Mate connector "${spec.connector}" does not belong to the part of "${leaf.name}"`);
      ref = { kind: 'connector', featureId: f.id };
    } else if (spec.face || spec.edge) {
      const build = composeAssembly(a, src).build;
      const found = await matchOnPart(build, d.units, leaf.id, { face: spec.face, edge: spec.edge });
      if (!found.length) throw new AgentError(`No ${spec.face ? 'face' : 'edge'} of "${leaf.name}" matches ${JSON.stringify(spec.face ?? spec.edge)}`);
      if (found.length > 1) throw new AgentError(`${found.length} ${spec.face ? 'faces' : 'edges'} of "${leaf.name}" match ${JSON.stringify(spec.face ?? spec.edge)}: add "pick", "near" or coordinates`);
      ref = { kind: found[0].kind, index: found[0].index };
    } else if (spec.vertex) {
      const part = composeAssembly(a, src).build.parts.find((p) => p.id === leaf.id);
      const v = part?.vertices;
      if (!v?.length) throw new AgentError(`"${leaf.name}" has no vertices`);
      const t = mm(spec.vertex);
      let best = 0;
      for (let i = 1; i < v.length / 3; i++)
        if (Math.hypot(v[i * 3] - t[0], v[i * 3 + 1] - t[1], v[i * 3 + 2] - t[2]) < Math.hypot(v[best * 3] - t[0], v[best * 3 + 1] - t[1], v[best * 3 + 2] - t[2])) best = i;
      ref = { kind: 'vertex', index: best };
    } else throw new AgentError('A mate end needs "face", "edge", "vertex" or "connector"');
    return { instance: leaf.id, connector: ref };
  };

  const apply = async (op: AssemblyOp) => {
    switch (op.op) {
      case 'assembly': {
        const existing = op.name ? (d.tabs.find((t) => t.type === 'assembly' && t.name === op.name) as AssemblyTab | undefined) : undefined;
        if (existing) asm = existing;
        else {
          let n = 1;
          while (d.tabs.some((t) => t.name === `Assembly ${n}`)) n++;
          asm = { id: uid('as'), type: 'assembly', name: op.name ?? `Assembly ${n}`, instances: [], mates: [] };
          d.tabs.push(asm);
          added.push(asm.name);
        }
        d.activeTab = asm.id;
        return;
      }
      case 'insert': {
        const a = need();
        const src = sources();
        let inst: AssemblyInstance;
        if (op.assembly) {
          const sub = d.tabs.find((t) => t.type === 'assembly' && (t.name === op.assembly || t.name.toLowerCase() === op.assembly!.toLowerCase())) as AssemblyTab | undefined;
          if (!sub) throw new AgentError(`No assembly "${op.assembly}"`);
          if (containsAssembly(d.tabs as AssemblyTab[], sub.id, a.id)) throw new AgentError(`"${sub.name}" contains "${a.name}": it cannot go inside it`);
          inst = { id: uid('in'), name: op.name ?? instanceName(a, sub.name), studioId: sub.id, partId: '', assemblyId: sub.id, position: [0, 0, 0], rotation: [0, 0, 0] };
          if (!op.position) inst.position = insertPosition(a, src, { bbox: [[0, 0, 0], [0, 0, 0]] } as never);
        } else {
          if (!op.part) throw new AgentError('insert needs "part" (with "studio" if several Part Studios have it) or "assembly"');
          const studios = d.tabs.filter((t): t is PartStudioTab => t.type === 'partStudio' && (!op.studio || t.name === op.studio || t.name.toLowerCase() === op.studio.toLowerCase()));
          if (!studios.length) throw new AgentError(`No Part Studio "${op.studio}"`);
          let hit: { studio: PartStudioTab; mesh: NonNullable<ReturnType<StudioData['parts']['get']>> } | undefined;
          for (const s of studios) {
            const parts = [...(src.get(s.id)?.parts.values() ?? [])];
            const m = parts.find((p) => p.name === op.part || p.id === op.part) ?? parts.find((p) => p.name.toLowerCase() === op.part!.toLowerCase());
            if (m) {
              hit = { studio: s, mesh: m };
              break;
            }
          }
          if (!hit) throw new AgentError(`No part "${op.part}" in ${studios.map((s) => s.name).join(', ')}`);
          inst = {
            id: uid('in'),
            name: op.name ?? instanceName(a, hit.mesh.name),
            studioId: hit.studio.id,
            partId: hit.mesh.id,
            position: insertPosition(a, src, hit.mesh),
            rotation: [0, 0, 0],
          };
        }
        if (op.name && a.instances.some((x) => x.name === op.name)) throw new AgentError(`An instance named "${op.name}" already exists`);
        if (op.position) inst.position = mm(op.position);
        if (op.rotation) inst.rotation = [...op.rotation] as Vec3;
        if (op.fixed) inst.fixed = true;
        if (op.flexible) {
          if (!inst.assemblyId) throw new AgentError('"flexible" is for a sub-assembly ("assembly")');
          inst.flexible = true;
        }
        a.instances.push(inst);
        added.push(inst.name);
        return;
      }
      case 'place': {
        const i = instance(op.instance);
        if (op.position) i.position = mm(op.position);
        if (op.rotation) i.rotation = [...op.rotation] as Vec3;
        if (op.fixed !== undefined) i.fixed = op.fixed || undefined;
        if (op.hidden !== undefined) i.hidden = op.hidden || undefined;
        if (op.flexible !== undefined) {
          if (!i.assemblyId) throw new AgentError(`"${i.name}" is not a sub-assembly: only a sub-assembly can be flexible`);
          // rigid again: its parts go back to where it places them
          if (op.flexible) i.flexible = true;
          else {
            delete i.flexible;
            delete i.flex;
          }
        }
        if (op.name) i.name = op.name;
        changed.add(i.name);
        return;
      }
      case 'mate': {
        const a = need();
        const src = sources();
        const ea = await end(op.a, src);
        const eb = await end(op.b, src);
        const ends2 = op.type === 'width' ? { a2: await end(op.a2 ?? op.a, src), b2: await end(op.b2 ?? op.b, src) } : {};
        if (op.type === 'width' && (!op.a2 || !op.b2)) throw new AgentError('A width mate needs "a2" and "b2": the second face of each pair');
        if (topInstance(ea.instance) === topInstance(eb.instance)) throw new AgentError('A mate ties two different instances');
        if (op.name && (a.mates ?? []).some((m) => m.name === op.name)) throw new AgentError(`A mate named "${op.name}" already exists`);
        const limits: MateLimits | undefined = op.limits
          ? {
              ...(op.limits.zMin !== undefined ? { zMin: len(op.limits.zMin, 'limit') } : {}),
              ...(op.limits.zMax !== undefined ? { zMax: len(op.limits.zMax, 'limit') } : {}),
              ...(op.limits.aMin !== undefined ? { aMin: op.limits.aMin } : {}),
              ...(op.limits.aMax !== undefined ? { aMax: op.limits.aMax } : {}),
            }
          : undefined;
        const mate: AssemblyMate = {
          id: uid('mt'),
          name: op.name ?? mateName(a, op.type),
          type: op.type,
          a: ea,
          b: eb,
          ...ends2,
          flip: op.flip ?? nearestFlip(src, a, ea, eb, op.type),
          ...(op.angle ? { angle: op.angle } : {}),
          ...(op.offset !== undefined ? { offset: len(op.offset, 'offset') } : {}),
          ...(limits ? { limits } : {}),
        };
        a.mates = [...(a.mates ?? []), mate];
        added.push(mate.name);
        // the next operations see the instances where the mate puts them
        applySolve(a, src);
        return;
      }
      case 'group': {
        const a = need();
        const ids = op.instances.map((n) => instance(n).id);
        if (ids.length < 2) throw new AgentError('A group needs two or more instances');
        const g = makeGroup(a, ids, uid('gr'), op.name ?? groupName(a));
        a.groups = [...(a.groups ?? []), g];
        added.push(g.name);
        return;
      }
      case 'relation': {
        const a = need();
        const ma = mateByName(op.a);
        const mb = op.type === 'screw' ? ma : mateByName(op.b ?? '');
        const value = op.type === 'gear' ? (typeof op.value === 'number' ? op.value : Number(op.value)) : len(op.value, 'value');
        if (!(value > 0)) throw new AgentError(`Invalid relation value "${op.value}"`);
        const r = makeRelation(a, sources(), {
          id: uid('rl'),
          name: op.name ?? relationName(a, op.type),
          type: op.type,
          a: ma.id,
          b: mb.id,
          value,
          ...(op.reverse ? { reverse: true } : {}),
        });
        a.relations = [...(a.relations ?? []), r];
        added.push(r.name);
        return;
      }
      case 'deleteInstance': {
        const a = need();
        const i = instance(op.instance);
        a.instances = a.instances.filter((x) => x.id !== i.id);
        a.mates = (a.mates ?? []).filter((m) => topInstance(m.a.instance) !== i.id && topInstance(m.b.instance) !== i.id);
        const left = new Set(a.mates.map((m) => m.id));
        a.relations = (a.relations ?? []).filter((r) => left.has(r.a) && left.has(r.b));
        a.groups = (a.groups ?? []).flatMap((g) => {
          const rest = g.members.map((m) => m.instance).filter((id) => id !== i.id);
          return rest.length < 2 ? [] : [rest.length === g.members.length ? g : makeGroup(a, rest, g.id, g.name)];
        });
        removed.push(i.name);
        return;
      }
      case 'deleteMate': {
        const a = need();
        const m = mateByName(op.mate);
        a.mates = (a.mates ?? []).filter((x) => x.id !== m.id);
        a.relations = (a.relations ?? []).filter((r) => r.a !== m.id && r.b !== m.id);
        removed.push(m.name);
        return;
      }
      default:
        throw new AgentError(`Unknown assembly op "${(op as { op: string }).op}"`);
    }
  };

  let i = 0;
  try {
    for (; i < ops.length; i++) await apply(ops[i]);
    need();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { doc, report: { ok: false, error: `op #${i} (${ops[i]?.op ?? '?'}): ${msg}`, added: [], changed: [], removed: [], failed: [], applied: false } };
  }
  const a = need();
  const src = sources();
  const failedIds = applySolve(a, src);
  // the mates of flexible sub-assemblies act here too: "Sub <1> / Revolute 1"
  const flat = expandAssembly(a, src);
  const names = new Map([...(flat.mates ?? []), ...(flat.groups ?? []), ...(flat.relations ?? [])].map((x) => [x.id, x.name] as const));
  const failed = failedIds.map((id) => ({ feature: names.get(id) ?? id, error: 'cannot be satisfied' }));
  return {
    doc: d,
    report: { ok: !failed.length, added, changed: [...changed], removed, failed, applied: false, assembly: summarizeAssembly(d, a, src, failedIds) },
  };
}
