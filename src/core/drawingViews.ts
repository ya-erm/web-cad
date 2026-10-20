// Drawing views: the axes they are seen along, section and detail views made from a parent view.

import type { DrawingView, Vec2, Vec3, ViewOrientation } from './types';
import type { SectionCut } from '../kernel/protocol';
import { v3 } from './math';

/** Projection axes: n points towards the viewer, x is the screen right direction. */
export interface ViewAxes {
  n: Vec3;
  x: Vec3;
}

export const VIEW_AXES: Record<ViewOrientation, ViewAxes> = {
  front: { n: [0, -1, 0], x: [1, 0, 0] },
  back: { n: [0, 1, 0], x: [-1, 0, 0] },
  top: { n: [0, 0, 1], x: [1, 0, 0] },
  bottom: { n: [0, 0, -1], x: [1, 0, 0] },
  right: { n: [1, 0, 0], x: [0, 1, 0] },
  left: { n: [-1, 0, 0], x: [0, -1, 0] },
  iso: { n: v3.norm([1, -1, 1]), x: v3.norm([1, 1, 0]) },
};

export type SectionLine = NonNullable<DrawingView['section']>;

/** The view a section or detail view is made from. */
export function parentView(v: DrawingView, views: DrawingView[]): DrawingView | undefined {
  return v.parent ? views.find((x) => x.id === v.parent && x.id !== v.id) : undefined;
}

/** A view's own geometry: the views it is projected with by alignment only (not section / detail ones). */
export const isDerivedView = (v: DrawingView) => !!(v.section || v.detail);

/**
 * The axes a view is seen along: a standard view — by its orientation; a section view — the parent's turned about
 * the cutting line (projected from the parent across the line, as in Onshape); a detail view — its parent's.
 */
export function viewAxes(v: DrawingView, views: DrawingView[], depth = 0): ViewAxes {
  const p = depth < 16 ? parentView(v, views) : undefined;
  if (p && v.detail) return viewAxes(p, views, depth + 1);
  if (p && v.section) return sectionPlane(viewAxes(p, views, depth + 1), v.section).axes;
  return VIEW_AXES[v.orientation];
}

/** The cutting plane of a section view (the material on the viewer's side of it is removed) and the axes it is seen along. */
export function sectionPlane(parent: ViewAxes, s: Pick<SectionLine, 'a' | 'b' | 'side'>): { axes: ViewAxes; origin: Vec3 } {
  const np = parent.n;
  const xp = parent.x;
  const yp = v3.cross(np, xp);
  const l = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) || 1;
  const u: Vec2 = [(s.b[0] - s.a[0]) / l, (s.b[1] - s.a[1]) / l];
  // the line in space, the direction looked in (across the line, to its `side`)
  const d = v3.add(v3.scale(xp, u[0]), v3.scale(yp, u[1]));
  const w = v3.add(v3.scale(xp, -u[1] * s.side), v3.scale(yp, u[0] * s.side));
  const n = v3.neg(w);
  // the turn about the line that brings the parent's normal to the section's
  const e = v3.cross(d, np);
  const ec = v3.cross(d, n);
  const turn = (q: Vec3) => v3.add(v3.add(v3.scale(d, v3.dot(q, d)), v3.scale(n, v3.dot(q, np))), v3.scale(ec, v3.dot(q, e)));
  const origin = v3.add(v3.scale(xp, s.a[0]), v3.scale(yp, s.a[1]));
  return { axes: { n, x: v3.norm(turn(xp)) }, origin };
}

/** All the points of a section's cutting line (a, b, then an offset section's steps). */
export const cuttingLine = (s: Pick<SectionLine, 'a' | 'b' | 'steps'>): Vec2[] => [s.a, s.b, ...(s.steps ?? [])];

/** What the kernel cuts for a section view: its plane — and an offset section's whole line, across the parent view. */
export function sectionCut(parent: ViewAxes, s: SectionLine): { axes: ViewAxes; cut: SectionCut } {
  const { axes, origin } = sectionPlane(parent, s);
  const pts = cuttingLine(s);
  if (pts.length < 3) return { axes, cut: { origin, normal: axes.n } };
  const yp = v3.cross(parent.n, parent.x);
  const line = pts.map((p) => v3.add(v3.scale(parent.x, p[0]), v3.scale(yp, p[1])));
  return { axes, cut: { origin, normal: axes.n, line, along: parent.n } };
}

/**
 * The next point of an offset section's line: the segment from `from` turned along the first segment (a → b) or across
 * it, whichever is nearer to `to`.
 */
export function stepPoint(a: Vec2, b: Vec2, from: Vec2, to: Vec2): Vec2 {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  const d: Vec2 = [to[0] - from[0], to[1] - from[1]];
  const along = d[0] * u[0] + d[1] * u[1];
  const across = -d[0] * u[1] + d[1] * u[0];
  return Math.abs(along) >= Math.abs(across) ? [from[0] + u[0] * along, from[1] + u[1] * along] : [from[0] - u[1] * across, from[1] + u[0] * across];
}

// Letters of sections and details: ГОСТ 2.316 skips Ё З Й О Х Ъ Ы Ь, ASME Y14.3 — I O Q S X Z.
const LETTERS_RU = 'АБВГДЕЖИКЛМНПРСТУФЦЧШЩЭЮЯ';
const LETTERS_EN = 'ABCDEFGHJKLMNPRTUVWY';

/** The first letter not used by the drawing's section and detail views yet (then A1, B1 …). */
export function nextViewLetter(views: DrawingView[], lang: string): string {
  const used = new Set(views.map((v) => v.section?.letter ?? v.detail?.letter).filter(Boolean));
  const letters = lang === 'ru' ? LETTERS_RU : LETTERS_EN;
  for (let round = 0; ; round++)
    for (const ch of letters) {
      const l = round ? `${ch}${round}` : ch;
      if (!used.has(l)) return l;
    }
}

/** The label above a section or detail view: "A–A", "B (2:1)". */
export function derivedViewLabel(v: DrawingView, scaleText: string): string | undefined {
  if (v.section) return `${v.section.letter}–${v.section.letter}`;
  if (v.detail) return `${v.detail.letter} (${scaleText})`;
  return undefined;
}
