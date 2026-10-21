// The box of a sketch text is real geometry: a rectangle as wide as the text in its font, so its sides take
// constraints and dimensions — a width dimension sets the height, a parallel side turns the text, a coincident
// line lines it up. Old texts (two points) still build and get their box when they are edited.

import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { produce } from 'immer';
import type { SkFont, SkText, SketchData, Vec2 } from '../core/types';
import { solveSketch } from './solver';
import { addConstraint, addLine, addText, copyEntities, deleteItems, mirrorEntities, upgradeTexts } from './sketchOps';
import { expandTexts, FONT_FILES, fontsLoaded, isTextCounter, isTextPart, registerFont, textAspect, textBoxLines } from './text';
import { entityMap, pointOf } from './curves';
import { computeRegions } from './regions';

beforeAll(async () => {
  if (fontsLoaded()) return;
  for (const [k, url] of Object.entries(FONT_FILES)) {
    const buf = await readFile(url);
    registerFont(k as SkFont, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  }
});

const empty = (): SketchData => ({ plane: { kind: 'std', name: 'top' }, entities: [], constraints: [] });
const solve = (d: SketchData, dims: Record<string, number> = {}) => {
  const r = solveSketch(d.entities, d.constraints, dims);
  return { d: { ...d, entities: r.entities }, r };
};
const at = (d: SketchData, id: string): Vec2 => pointOf(entityMap(d.entities), id);
const close = (a: Vec2, b: Vec2, digits = 6) => {
  expect(a[0]).toBeCloseTo(b[0], digits);
  expect(a[1]).toBeCloseTo(b[1], digits);
};
const textOf = (d: SketchData, id: string) => d.entities.find((e) => e.id === id) as SkText & { p3: string; p4: string };
/** A text and what its box is made of. */
function withText(text = 'Text', p1: Vec2 = [0, 0], p2: Vec2 = [0, 10], more?: (d: SketchData) => void) {
  let made!: ReturnType<typeof addText>;
  const d = produce(empty(), (s) => {
    made = addText(s, p1, p2, text);
    more?.(s);
  });
  return { d, t: made };
}

describe('the box of a sketch text', () => {
  it('is a rectangle of four construction sides, as wide as the text in its font', () => {
    const { d, t } = withText('Text');
    const k = textAspect('Text', 'sans');
    expect(k).toBeGreaterThan(1.5);
    close(at(d, t.p3), [10 * k, 0]);
    close(at(d, t.p4), [10 * k, 10]);
    const sides = textBoxLines(d.entities, textOf(d, t.id));
    expect(Object.values(sides).sort()).toEqual(Object.values(t.lines).sort());
    for (const id of Object.values(t.lines)) expect(d.entities.find((e) => e.id === id)).toMatchObject({ type: 'line', construction: true, owner: t.id });
    // the letters are derived; the box is not derived again
    const all = expandTexts(d.entities);
    expect(all.some((e) => isTextPart(e.id) && e.type === 'line' && e.construction)).toBe(false);
    const regions = computeRegions(all);
    expect(regions.filter((x) => !isTextCounter(x, regions)).length).toBe(4);
    // free: it moves, turns and scales (4 degrees of freedom), and solving leaves it as it is
    const { d: s, r } = solve(d);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(4);
    close(at(s, t.p3), at(d, t.p3));
  });

  it('takes a width dimension: the height follows', () => {
    const { d, t } = withText('Text', [5, 5], [5, 15]);
    let dim = '';
    const sized = produce(d, (s) => {
      addConstraint(s, 'fix', [t.p1], { frozen: [5, 5] });
      dim = addConstraint(s, 'distance', [t.lines.bottom]);
    });
    const { d: s, r } = solve(sized, { [dim]: 50 });
    expect(r.ok).toBe(true);
    const k = textAspect('Text', 'sans');
    close(at(s, t.p1), [5, 5]);
    close(at(s, t.p3), [55, 5]);
    close(at(s, t.p2), [5, 5 + 50 / k]);
    close(at(s, t.p4), [55, 5 + 50 / k]);
  });

  it('lines up with a line (coincident sides) and turns parallel to one', () => {
    let h = '';
    const { d, t } = withText('Hi', [10, 20], [10, 30], (s) => {
      const l = addLine(s, [0, 0], [100, 50]);
      addConstraint(s, 'fix', [l.id], { frozen: [0, 0, 100, 50] });
      const [bottom, , , left] = s.entities.filter((e) => e.type === 'line' && e.owner);
      addConstraint(s, 'coincident', [l.id, bottom.id]);
      h = addConstraint(s, 'distance', [left.id]);
    });
    const { d: s, r } = solve(d, { [h]: 10 });
    expect(r.ok).toBe(true);
    const [p1, p2, p3] = [at(s, t.p1), at(s, t.p2), at(s, t.p3)];
    // both ends of the baseline on the line, the letters above it, the height kept
    for (const p of [p1, p3]) expect(Math.abs(p[1] - p[0] / 2)).toBeLessThan(1e-6);
    expect(Math.atan2(p3[1] - p1[1], p3[0] - p1[0])).toBeCloseTo(Math.atan2(50, 100), 6);
    expect(p2[1] - p2[0] / 2).toBeGreaterThan(0);
    expect(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])).toBeCloseTo(10, 4);

    // parallel: the top side along a line, the text keeps its place
    const q = withText('Hi', [10, 20], [10, 30], (sk) => {
      const l = addLine(sk, [0, 0], [100, -100]);
      addConstraint(sk, 'fix', [l.id], { frozen: [0, 0, 100, -100] });
    });
    const top = q.t.lines.top;
    const line = q.d.entities.find((e) => e.type === 'line' && !e.owner)!.id;
    const par = produce(q.d, (sk) => void addConstraint(sk, 'parallel', [line, top]));
    const { d: s2, r: r2 } = solve(par);
    expect(r2.ok).toBe(true);
    const [a, b] = [at(s2, q.t.p1), at(s2, q.t.p3)];
    expect(Math.abs((b[1] - a[1]) / (b[0] - a[0]))).toBeCloseTo(1, 6);
  });

  it('is not over-defined by a horizontal baseline and a vertical side', () => {
    const { d, t } = withText('Box', [0, 0], [1, 10]);
    const both = produce(d, (s) => {
      addConstraint(s, 'horizontal', [t.lines.bottom]);
      addConstraint(s, 'vertical', [t.lines.left]);
    });
    const { d: s, r } = solve(both);
    expect(r.ok).toBe(true);
    expect(r.conflicting).toEqual([]);
    const [p1, p3] = [at(s, t.p1), at(s, t.p3)];
    expect(p3[1]).toBeCloseTo(p1[1], 9);
  });

  it('follows a new string: wider from its start, or smaller under a width dimension', () => {
    const { d, t } = withText('A');
    const longer = produce(d, (s) => {
      (s.entities.find((e) => e.id === t.id) as SkText).text = 'ABCD';
    });
    const { d: s, r } = solve(longer);
    expect(r.ok).toBe(true);
    close(at(s, t.p1), [0, 0]);
    close(at(s, t.p2), [0, 10]);
    close(at(s, t.p3), [10 * textAspect('ABCD', 'sans'), 0]);

    // the width held: the letters get smaller
    const held = produce(d, (s) => {
      addConstraint(s, 'fix', [t.p1], { frozen: [0, 0] });
      addConstraint(s, 'distance', [t.lines.bottom], { value: '20' });
      (s.entities.find((e) => e.id === t.id) as SkText).font = 'mono';
    });
    const dim = held.constraints.find((c) => c.type === 'distance')!.id;
    const { d: s2, r: r2 } = solve(held, { [dim]: 20 });
    expect(r2.ok).toBe(true);
    close(at(s2, t.p3), [20, 0]);
    close(at(s2, t.p2), [0, 20 / textAspect('A', 'mono')]);

    // the width held, the baseline only on a line: the text keeps its start (it does not slide along the line)
    let width = '';
    const sliding = produce(d, (s) => {
      const l = addLine(s, [-50, 0], [50, 0]);
      addConstraint(s, 'fix', [l.id], { frozen: [-50, 0, 50, 0] });
      addConstraint(s, 'coincident', [l.id, t.lines.bottom]);
      width = addConstraint(s, 'distance', [t.lines.bottom], { value: '20' });
    });
    const { d: s3 } = solve(sliding, { [width]: 20 });
    const start = at(s3, t.p1);
    const { d: s4, r: r4 } = solve(
      produce(s3, (s) => {
        (s.entities.find((e) => e.id === t.id) as SkText).text = 'A longer text';
      }),
      { [width]: 20 },
    );
    expect(r4.ok).toBe(true);
    close(at(s4, t.p1), start);
    close(at(s4, t.p3), [start[0] + 20, 0]);
    close(at(s4, t.p2), [start[0], 20 / textAspect('A longer text', 'sans')]);
  });

  it('keeps a fixed text in place when its string changes', () => {
    const { d, t } = withText('A', [3, 4], [3, 14]);
    const fixed = produce(d, (s) => void addConstraint(s, 'fix', [t.id], { frozen: [3, 4, 3, 14] }));
    const { r } = solve(fixed);
    expect(r.dof).toBe(0);
    const edited = produce(fixed, (s) => {
      (s.entities.find((e) => e.id === t.id) as SkText).text = 'ABC';
    });
    const { d: s, r: r2 } = solve(edited);
    expect(r2.ok).toBe(true);
    expect(r2.conflicting).toEqual([]);
    close(at(s, t.p3), [3 + 10 * textAspect('ABC', 'sans'), 4]);
  });

  it('goes with its text: a side deleted deletes the text, copies and mirror images carry it', () => {
    const { d, t } = withText('Go');
    const gone = produce(d, (s) => deleteItems(s, [t.lines.right]));
    expect(gone.entities).toEqual([]);

    let map = new Map<string, string>();
    const moved = produce(d, (s) => {
      addConstraint(s, 'distance', [t.lines.bottom], { value: '30' });
      map = copyEntities(s, [t.lines.top], ([x, y]) => [x + 100, y], { copyConstraints: true });
    });
    const copy = textOf(moved, map.get(t.id)!);
    close(at(moved, copy.p3), [at(d, t.p3)[0] + 100, 0]);
    expect(map.get(t.lines.bottom)).toBe(textBoxLines(moved.entities, copy).bottom);
    expect(moved.constraints.filter((c) => c.type === 'distance').map((c) => c.refs[0])).toEqual([t.lines.bottom, map.get(t.lines.bottom)]);

    // mirrored about x = 50: the image of the box, reading the same way, held symmetric
    const mirrored = produce(d, (s) => {
      const axis = addLine(s, [50, 0], [50, 10], true);
      addConstraint(s, 'fix', [axis.id], { frozen: [50, 0, 50, 10] });
      mirrorEntities(s, [t.id], axis.id);
    });
    const { d: s, r } = solve(mirrored);
    expect(r.ok).toBe(true);
    const image = s.entities.find((e) => e.type === 'text' && e.id !== t.id) as SkText & { p3: string; p4: string };
    const w = at(d, t.p3)[0];
    close(at(s, image.p1), [100 - w, 0]);
    close(at(s, image.p3), [100, 0]);
    close(at(s, image.p2), [100 - w, 10]);
    // either string changed: each box as wide as its own string, the image's right side still the original's left one
    const edited = produce(s, (x) => {
      (x.entities.find((e) => e.id === t.id) as SkText).text = 'Gone long';
    });
    const { d: s2, r: r2 } = solve(edited);
    expect(r2.ok).toBe(true);
    close(at(s2, t.p2), [0, 10]);
    close(at(s2, t.p3), [10 * textAspect('Gone long', 'sans'), 0]);
    close(at(s2, image.p3), [100, 0]);
    close(at(s2, image.p4), [100, 10]);
    close(at(s2, image.p1), [100 - w, 0]);
  });

  it('is derived for an old text with two points, which gets its own box where that was', () => {
    const old: SketchData = {
      ...empty(),
      entities: [
        { id: 'a', type: 'point', x: 0, y: 0, owner: 't' },
        { id: 'b', type: 'point', x: 0, y: 10, owner: 't' },
        { id: 't', type: 'text', text: 'Old', font: 'sans', p1: 'a', p2: 'b' },
      ],
      constraints: [{ id: 'h', type: 'distance', refs: ['a', 'b'], value: '10' }],
    };
    const derived = expandTexts(old.entities);
    const box = derived.filter((e) => isTextPart(e.id) && e.type === 'line' && e.construction);
    expect(box.length).toBe(4);
    const regions = computeRegions(derived).length;
    const { r } = solve(old, { h: 10 });
    expect(r.ok).toBe(true);

    const up = produce(old, (s) => void upgradeTexts(s));
    const t = textOf(up, 't');
    const right = derived.find((e) => e.id.endsWith('~b1'));
    close(at(up, t.p3), right && right.type === 'point' ? [right.x, right.y] : [NaN, NaN]);
    expect(Object.keys(textBoxLines(up.entities, t)).length).toBe(4);
    expect(computeRegions(expandTexts(up.entities)).length).toBe(regions);
    const { r: r2 } = solve(up, { h: 10 });
    expect(r2.ok).toBe(true);
    expect(upgradeTexts(structuredClone(up))).toBe(0);
  });
});
