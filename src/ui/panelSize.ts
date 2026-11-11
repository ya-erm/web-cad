// Sizes of the panel at the left of a Part Studio or an assembly that the user sets by dragging: its width (shared
// by both) and the share of its height taken by the upper list — Features over Parts, Instances over Mates.
// Remembered in this browser; without a remembered size the panel keeps its usual one.

export type SplitKind = 'partStudio' | 'assembly';

export const DEFAULT_WIDTH = 270;
export const MIN_WIDTH = 200;
const MAX_WIDTH = 720;
/** Room the graphics area keeps beside a wide panel. */
const GRAPHICS_ROOM = 320;
/** The upper list's usual share of the height. */
export const DEFAULT_SPLIT: Record<SplitKind, number> = { partStudio: 0.65, assembly: 0.6 };
/** Each of the two lists keeps at least its header and a couple of rows. */
const MIN_LIST = 84;

const WIDTH_KEY = 'webcad.leftPanel.width';
const splitKey = (kind: SplitKind) => `webcad.leftPanel.split.${kind}`;

/** A width the panel can take in a window this wide: not under its minimum, leaving the graphics area room. */
export function clampWidth(w: number, windowWidth: number): number {
  const max = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, windowWidth - GRAPHICS_ROOM));
  return Math.round(Math.min(Math.max(MIN_WIDTH, w), max));
}

/** The upper list's share of the two lists' `total` height, leaving each at least MIN_LIST (half each when they can't). */
export function clampSplit(share: number, total: number): number {
  const lo = total > 0 ? Math.min(0.5, MIN_LIST / total) : 0.5;
  return Math.round(Math.min(Math.max(lo, share), 1 - lo) * 1000) / 1000;
}

function load(key: string, ok: (v: number) => boolean): number | null {
  try {
    const s = localStorage.getItem(key);
    const v = s == null ? NaN : Number(s);
    return Number.isFinite(v) && ok(v) ? v : null;
  } catch {
    return null;
  }
}

function save(key: string, v: number | null) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(v));
  } catch {
    /* a browser that keeps nothing: the size lasts until a reload */
  }
}

export const loadWidth = () => load(WIDTH_KEY, (v) => v > 0);
/** null: back to the usual width. */
export const saveWidth = (w: number | null) => save(WIDTH_KEY, w);
export const loadSplit = (kind: SplitKind) => load(splitKey(kind), (v) => v > 0 && v < 1);
/** null: back to the usual share. */
export const saveSplit = (kind: SplitKind, share: number | null) => save(splitKey(kind), share);
