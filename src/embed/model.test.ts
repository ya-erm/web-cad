// The embedded viewer's models of real files, built with the real OpenCascade kernel: a STEP file — a Part Studio
// importing it; binary and text STL — meshes of their bodies with the edges of the shape; a project file — its
// document with its assembly (opened at a Part Studio or an assembly, never a drawing); damaged files refused.

import { beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { emptyDocument, initOpenCascade, openHeadless } from '../agent/headless';
import type { AssemblySummary, ModelSummary } from '../agent/types';
import type { CadDocument } from '../core/types';
import { projectText } from '../store/folderStore';
import { stlMeshes } from '../kernel/stlMesh';
import { checkStl, modelTitle, viewModel, viewableTabs } from './model';
import { EmbedError } from './session';
import type { EmbedFormat } from './protocol';

const wasm = fileURLToPath(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));

/** The file's bytes as the page sends them (an ArrayBuffer of their own). */
const buffer = (b: Uint8Array | string): ArrayBuffer => {
  const u = typeof b === 'string' ? new TextEncoder().encode(b) : b;
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
};
const file = (name: string, format: EmbedFormat, b: Uint8Array | string) => ({ name, format, buffer: buffer(b) });
/** Why the viewer refuses a file ('ok' — it does not). */
const refusal = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    if (e instanceof EmbedError) return `${e.code}: ${e.message}`;
    throw e;
  }
  return 'ok';
};

type P = [number, number, number];
/** The 12 triangles of a box from `lo` to `hi`, wound outwards. */
function box(lo: P, hi: P): P[][] {
  const c = (i: number): P => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
  return [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ].flatMap(([a, b, d, e]) => [
    [c(a), c(b), c(d)],
    [c(a), c(d), c(e)],
  ]);
}
function binaryStl(tris: P[][]): Uint8Array {
  const out = new Uint8Array(84 + tris.length * 50);
  out.set(new TextEncoder().encode('solid exported as binary'));
  const v = new DataView(out.buffer);
  v.setUint32(80, tris.length, true);
  tris.forEach((t, i) => t.forEach((p, k) => p.forEach((x, c) => v.setFloat32(84 + i * 50 + 12 + k * 12 + c * 4, x, true))));
  return out;
}
const asciiStl = (tris: P[][]) =>
  `solid boxes\n${tris.map((t) => ` facet normal 0 0 0\n  outer loop\n${t.map((p) => `   vertex ${p.join(' ')}`).join('\n')}\n  endloop\n endfacet`).join('\n')}\nendsolid boxes\n`;

const twoBoxes = [...box([0, 0, 0], [20, 10, 5]), ...box([30, 0, 0], [40, 10, 10])];

let step: Uint8Array;
let rig: CadDocument;

beforeAll(async () => {
  await initOpenCascade(wasm);
  // a plate and a pin, an assembly of them and its drawing
  const s = await openHeadless(emptyDocument('Rig'), wasm);
  const r = await s.run([
    { op: 'sketch', shapes: [{ type: 'rect', center: true, w: 40, h: 30 }] },
    { op: 'extrude', depth: 6 },
    { op: 'part', part: 'Part 1', name: 'Plate' },
    { op: 'sketch', name: 'Pin', shapes: [{ type: 'circle', c: [100, 0], r: 4 }] },
    { op: 'extrude', sketch: 'Pin', depth: 20 },
    { op: 'part', part: 'Part 2', name: 'Pin' },
  ]);
  expect(r.error).toBeUndefined();
  step = await s.exportStep();
  const a = await s.run([
    { op: 'assembly', name: 'Rig' },
    { op: 'insert', part: 'Plate', fixed: true },
    { op: 'insert', part: 'Pin', position: [-100, 0, 6] },
    { op: 'drawing', name: 'Rig drawing', of: 'Rig' },
  ]);
  expect(a.error).toBeUndefined();
  rig = s.doc;
}, 180000);

describe('STEP', () => {
  it('opens as a Part Studio importing the file: its parts, in millimetres', async () => {
    const m = viewModel(file('Rig v2.step', 'step', step));
    expect(m.doc.name).toBe('Rig v2');
    expect(m.doc.units.length).toBe('mm');
    expect(m.doc.tabs.map((x) => x.type)).toEqual(['partStudio']);
    expect(m.importId).toBeTruthy();
    const s = await openHeadless(m.doc, wasm);
    const st = (await s.state()) as ModelSummary;
    expect(st.features.map((f) => f.status)).toEqual(['ok']);
    expect(st.parts).toHaveLength(2);
    // the plate as it was: 40 × 30 × 6
    expect(st.parts.map((p) => p.size.map((v) => Math.round(v))).sort()).toEqual([
      [40, 30, 6],
      [8, 8, 20],
    ]);
  }, 60000);

  it('takes .stp and a byte order mark; refuses what is not STEP or is cut short', () => {
    expect(refusal(() => viewModel(file('part.stp', 'step', new Uint8Array([0xef, 0xbb, 0xbf, ...step]))))).toBe('ok');
    expect(refusal(() => viewModel(file('part.step', 'step', step.subarray(0, step.length - 200))))).toBe('INVALID_FILE: Файл STEP повреждён или загружен не полностью');
    expect(refusal(() => viewModel(file('part.step', 'step', 'solid cube\nendsolid\n')))).toBe('INVALID_FILE: Это не файл STEP');
    expect(refusal(() => viewModel(file('part.step', 'step', new Uint8Array(1000).fill(7))))).toBe('INVALID_FILE: Это не файл STEP');
  });

  it('a file with a STEP header and no model in it fails to build (the Import feature says why)', async () => {
    const m = viewModel(file('empty.step', 'step', 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n'));
    const st = (await (await openHeadless(m.doc, wasm)).state()) as ModelSummary;
    expect(st.features[0].status).toBe('error');
    expect(st.parts).toEqual([]);
  }, 60000);
});

describe('STL', () => {
  it('a binary file: each body a mesh, its edges where faces meet at an angle', () => {
    const bytes = binaryStl(twoBoxes);
    expect(refusal(() => checkStl(bytes))).toBe('ok');
    const parts = stlMeshes(bytes, 'k');
    expect(parts.map((p) => [p.indices.length / 3, p.edges.length, !!p.surface])).toEqual([
      [12, 12, false],
      [12, 12, false],
    ]);
    // the 12 edges of a box, not the diagonals of its faces
    expect(parts[0].edges.map((e) => Math.round(e.length)).sort((a, b) => a - b)).toEqual([5, 5, 5, 5, 10, 10, 10, 10, 20, 20, 20, 20]);
    expect(parts[1].bbox).toEqual([
      [30, 0, 0],
      [40, 10, 10],
    ]);
    expect(parts.map((p) => p.meshKey)).toEqual(['k:0', 'k:1']);
    // the graphics' arrays: three corners a triangle, one face a body
    expect(parts[0].positions.length).toBe(12 * 9);
    expect(Array.from(parts[0].faceRanges)).toEqual([0, 36]);
  });

  it('a text file gives the same; an open body is a surface', () => {
    const text = asciiStl(twoBoxes);
    expect(refusal(() => checkStl(new TextEncoder().encode(text)))).toBe('ok');
    const parts = stlMeshes(new TextEncoder().encode(text), 'k');
    expect(parts.map((p) => [p.indices.length / 3, p.edges.length])).toEqual([
      [12, 12],
      [12, 12],
    ]);
    const open = stlMeshes(binaryStl(box([0, 0, 0], [1, 1, 1]).slice(2)), 'k');
    expect(open[0].surface).toBe(true);
  });

  it('refuses a file cut short, one with no triangles and one that is not STL', () => {
    const bytes = binaryStl(twoBoxes);
    expect(refusal(() => checkStl(bytes.subarray(0, bytes.length - 30)))).toBe('INVALID_FILE: Файл STL повреждён или загружен не полностью');
    expect(refusal(() => checkStl(binaryStl([])))).toBe('INVALID_FILE: В файле STL нет треугольников');
    expect(refusal(() => checkStl(new TextEncoder().encode('ISO-10303-21;\nEND-ISO-10303-21;')))).toBe('INVALID_FILE: Это не файл STL');
    expect(refusal(() => checkStl(new Uint8Array(10)))).toBe('INVALID_FILE: Это не файл STL');
    // the kernel's own reading says the same of a text file with no whole triangle
    expect(() => stlMeshes(new TextEncoder().encode('solid x\n facet normal 0 0 1\n  vertex 0 0 0\n endfacet\nendsolid'), 'k')).toThrow('Not an STL file');
  });
});

describe('WebCAD project', () => {
  it('opens the document as it is, at a Part Studio or an assembly (not its drawing)', async () => {
    expect(rig.tabs.find((x) => x.id === rig.activeTab)?.type).toBe('drawing');
    const m = viewModel(file('Rig.webcad.json', 'webcad', projectText(rig)));
    expect(m.doc.name).toBe('Rig');
    expect(viewableTabs(m.doc).map((x) => x.type)).toEqual(['partStudio', 'assembly']);
    expect(m.doc.tabs.find((x) => x.id === m.doc.activeTab)?.type).toBe('partStudio');
    expect(m.importId).toBeUndefined();
    // its assembly, built as the viewer shows it
    const asm = viewableTabs(m.doc)[1];
    const s = await openHeadless({ ...m.doc, activeTab: asm.id }, wasm);
    const st = (await s.state()) as { assembly: AssemblySummary };
    expect(st.assembly.instances.map((i) => i.name)).toEqual(['Plate <1>', 'Pin <1>']);
    expect(st.assembly.instances[1].bboxMin![2]).toBeCloseTo(6, 6);
  }, 120000);

  it('keeps an assembly the document had open, and the versions of the file', () => {
    const asm = viewableTabs(rig)[1];
    const version = { id: 'v-1', name: 'v1', created: 1, units: rig.units, tabs: rig.tabs.slice(0, 1), activeTab: rig.tabs[0].id };
    const m = viewModel(file('Rig.webcad.json', 'webcad', projectText({ ...rig, activeTab: asm.id }, [version])));
    expect(m.doc.activeTab).toBe(asm.id);
    expect(m.versions.map((v) => v.id)).toEqual(['v-1']);
  });

  it('refuses a document of drawings only, a damaged or cut short file and one that is not a project', () => {
    const drawings = { ...rig, tabs: rig.tabs.filter((x) => x.type === 'drawing') };
    expect(refusal(() => viewModel(file('d.webcad.json', 'webcad', projectText(drawings))))).toBe(
      'UNSUPPORTED_FORMAT: В документе нет Part Studio и сборок: чертежи во встроенном просмотре не показываются',
    );
    const text = projectText(rig);
    expect(refusal(() => viewModel(file('x.webcad.json', 'webcad', text.slice(0, text.length / 2))))).toBe('INVALID_FILE: Это не проект WebCAD');
    expect(refusal(() => viewModel(file('x.webcad.json', 'webcad', '[1, 2, 3]')))).toBe('INVALID_FILE: Это не проект WebCAD');
    expect(refusal(() => viewModel(file('x.webcad.json', 'webcad', new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]))))).toBe('INVALID_FILE: Это не проект WebCAD');
    const broken = JSON.parse(text);
    broken.tabs[0].features = 'none';
    expect(refusal(() => viewModel(file('x.webcad.json', 'webcad', JSON.stringify(broken))))).toBe('INVALID_FILE: Проект WebCAD повреждён');
    expect(refusal(() => viewModel(file('x.webcad.json', 'webcad', JSON.stringify({ ...JSON.parse(text), units: { length: 'parsec' } }))))).toBe(
      'INVALID_FILE: Проект WebCAD повреждён',
    );
  });
});

it('names the model by the file without its extension or characters that are not shown', () => {
  expect(modelTitle('Корпус v3.webcad.json')).toBe('Корпус v3');
  expect(modelTitle('board.STP')).toBe('board');
  expect(modelTitle('a\u0000b\u001b.stl')).toBe('ab');
  expect(modelTitle('.stl')).toBe('Model');
});
