// Variable fillets (Onshape: Variable) with the real OpenCascade kernel: radii at vertices, linear or smooth.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, openHeadless } from './headless';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

/** A 20×20×10 block, its vertical edge at (10, 10) filleted: 1 mm at the bottom, 4 mm at the top. */
async function block(extra: Record<string, unknown> = {}) {
  const s = await openHeadless(emptyDocument('Variable fillet'), wasm);
  const r = await s.run([
    { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 20, h: 20 }] },
    { op: 'extrude', depth: 10 },
    {
      op: 'fillet',
      edges: { type: 'line', dir: 'z', near: [10, 10, 5] },
      radius: 2,
      vertices: [
        { at: [10, 10, 0], radius: 1 },
        { at: [10, 10, 10], radius: 4 },
      ],
      ...extra,
    } as never,
  ]);
  expect(r.error).toBeUndefined();
  expect(r.failed).toEqual([]);
  return { s, r };
}

/** The area a corner fillet of radius r takes from a face: r² (1 − π/4). */
const corner = (r: number) => r * r * (1 - Math.PI / 4);

describe('Variable fillet', () => {
  it('goes from the radius at one vertex to the one at the other, linearly', async () => {
    const { s, r } = await block();
    const f = r.model!.features.find((x) => x.name === 'Fillet 1');
    expect(f?.status).toBe('ok');
    // the top face loses a 4 mm corner, the bottom one a 1 mm corner (nearly round: the ball grows as it rolls)
    const top = (await s.query({ faces: { normal: 'z', pick: '+z' } })) as { faces: { area: number }[] };
    const bottom = (await s.query({ faces: { normal: '-z', pick: '-z' } })) as { faces: { area: number }[] };
    expect(top.faces[0].area).toBeCloseTo(400 - corner(4), 1);
    expect(bottom.faces[0].area).toBeCloseTo(400 - corner(1), 1);
    // the volume: about ∫ r(z)² (1 − π/4) dz with r from 1 to 4 over 10 mm
    const removed = (1 - Math.PI / 4) * ((4 ** 3 - 1) / (3 * 0.3));
    expect(r.model!.parts[0].volume!).toBeCloseTo(4000 - removed, 0);
    expect((s.doc.tabs[0] as { features: { params: Record<string, unknown> }[] }).features[2].params).toMatchObject({ filletType: 'variable', vertexRadii: ['1 mm', '4 mm'] });
  }, 60000);

  it('smoothly: the same ends, a fuller middle (level at the vertices)', async () => {
    const linear = (await block()).r.model!.parts[0].volume!;
    const { s, r } = await block({ smooth: true });
    const top = (await s.query({ faces: { normal: 'z', pick: '+z' } })) as { faces: { area: number }[] };
    expect(top.faces[0].area).toBeCloseTo(400 - corner(4), 1);
    // smoothstep r(z) = 1 + 3 s(z/10): ∫ r² dz = 10 ∫₀¹ (1 + 3 s)² du = 10 (1 + 3 + 9 · 13/35) — more than linear
    const removed = (1 - Math.PI / 4) * 10 * (1 + 3 + (9 * 13) / 35);
    expect(r.model!.parts[0].volume!).toBeCloseTo(4000 - removed, 0);
    expect(linear - r.model!.parts[0].volume!).toBeGreaterThan(0.2);
  }, 60000);
});

describe('Chamfer types through the agent', () => {
  it('two distances and distance with angle', async () => {
    const s = await openHeadless(emptyDocument('Chamfers'), wasm);
    const edge = { type: 'line', dir: 'z', near: [10, 10, 5] };
    const base = [
      { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 20, h: 20 }] },
      { op: 'extrude', depth: 10 },
    ];
    const two = await s.run([...base, { op: 'chamfer', edges: edge, distance: 2, type: 'twoDistances', distance2: 4 }] as never);
    expect(two.failed).toEqual([]);
    // a right triangle 2 × 4 off the corner along 10 mm
    expect(two.model!.parts[0].volume!).toBeCloseTo(4000 - 0.5 * 2 * 4 * 10, 3);
    const s2 = await openHeadless(emptyDocument('Chamfers 2'), wasm);
    const da = await s2.run([...base, { op: 'chamfer', edges: edge, distance: 3, type: 'distanceAngle', angle: 30 }] as never);
    expect(da.failed).toEqual([]);
    // legs 3 and 3·tan 30°
    expect(da.model!.parts[0].volume!).toBeCloseTo(4000 - 0.5 * 3 * 3 * Math.tan(Math.PI / 6) * 10, 3);
  }, 60000);
});
