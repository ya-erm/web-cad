// Assembly export: parts of a Part Studio placed as instances (turned and moved copies) and written to STEP.
// Real OpenCascade kernel in Node.

import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import opencascade from 'replicad-opencascadejs';
import { importSTEP, setOC } from 'replicad';
import { produce } from 'immer';
import { StudioBuilder, assemblyStepOf, placedShape, stepOf } from './build';
import type { Feature, SelRef, SketchData, Vec3 } from '../core/types';
import type { StepAssembly } from './protocol';
import { defaultParams } from '../core/features';
import { addRectangle } from '../sketch/sketchOps';
import { computeRegions } from '../sketch/regions';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

beforeAll(async () => {
  const oc = await opencascade({ locateFile: () => wasm } as never);
  setOC(oc);
}, 60000);

describe('assembly export', () => {
  it('places copies of a part as instances and writes them to STEP', async () => {
    // a 20 × 10 × 5 block from the origin
    const s1: Feature = {
      id: 's1',
      type: 'sketch',
      name: 's1',
      params: produce({ plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] } as SketchData, (d) => void addRectangle(d, [0, 0], [20, 10])),
    };
    const profiles: SelRef[] = s1.type === 'sketch' ? computeRegions(s1.params.entities).map((r) => ({ kind: 'region', sketchId: 's1', key: r.key })) : [];
    const ex: Feature = { id: 'e1', type: 'extrude', name: 'E1', params: { ...defaultParams('extrude'), profiles, depth: '5' } };
    const b = new StudioBuilder();
    const res = await b.build({ type: 'build', reqId: 1, units: { length: 'mm', angle: 'deg' }, features: [s1, ex], partMeta: {}, upTo: 2 });
    const [item] = b.shapesFor([res.parts[0].id]);
    const bounds = (s: typeof item.shape) => s.boundingBox.bounds.map((p) => p.map((v) => Math.round(v * 1e6) / 1e6 + 0));

    // a quarter turn about Z, then 100 mm along X: x ∈ [100 − 10, 100], y ∈ [0, 20]
    const placed = placedShape(item.shape, { rotation: [0, 0, 90], position: [100, 0, 0] });
    expect(bounds(placed)).toEqual([
      [90, 0, 0],
      [100, 20, 5],
    ]);
    // the part itself is untouched
    expect(bounds(item.shape)).toEqual([
      [0, 0, 0],
      [20, 10, 5],
    ]);

    const step = new TextDecoder().decode(
      await stepOf([
        { name: 'Block <1>', color: item.color, shape: placedShape(item.shape, { rotation: [0, 0, 0], position: [0, 0, 0] }) },
        { name: 'Block <2>', color: item.color, shape: placed },
      ]),
    );
    expect(step).toContain('ISO-10303-21');
    expect(step).toContain('Block <1>');
    expect(step).toContain('Block <2>');

    // with the product tree: the part once; the assembly with a block and a sub-assembly of two blocks
    const at = (position: Vec3, rotation: Vec3 = [0, 0, 0]) => ({ position, rotation });
    const assemblies: StepAssembly[] = [
      { name: 'Rig', components: [{ name: 'Block <1>', studioKey: 'k', partId: 'p', ...at([0, 0, 0]) }, { name: 'Pair <1>', assembly: 1, ...at([0, 0, 50]) }] },
      { name: 'Pair', components: [{ name: 'Block <1>', studioKey: 'k', partId: 'p', ...at([0, 0, 0]) }, { name: 'Block <2>', studioKey: 'k', partId: 'p', ...at([100, 0, 0], [0, 0, 90]) }] },
    ];
    const bytes = await assemblyStepOf(assemblies, () => ({ name: 'Block', color: '#3366cc', shape: item.shape }));
    const tree = new TextDecoder().decode(bytes);
    expect(tree.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g)?.length).toBe(4);
    expect(tree.match(/PRODUCT\('Block'/g)?.length).toBe(1);
    expect(tree).toContain("PRODUCT('Rig'");
    expect(tree).toContain("PRODUCT('Pair'");
    expect(tree).toContain('Pair <1>');
    // read back: the blocks stand where the instances put them (the pair 50 mm up)
    const back = await importSTEP(new Blob([bytes]));
    expect(bounds(back as typeof item.shape)).toEqual([
      [0, 0, 0],
      [100, 20, 55],
    ]);
  }, 60000);
});
