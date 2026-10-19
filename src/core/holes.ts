// Standard holes (Onshape Hole, Standard: ISO): metric threads ISO 261 / 262, clearance holes ISO 273, tap drills
// ISO 2306, counterbores for socket head cap screws ISO 4762 (DIN 974-1) and countersinks for countersunk head
// screws ISO 10642 (90°). All sizes in mm.

import type { HoleParams } from './types';

interface IsoSize {
  /** Nominal (major) diameter. */
  d: number;
  /** Coarse pitch, then the fine ones. */
  pitches: number[];
  /** Tap drill for the coarse pitch. */
  drill: number;
  /** Clearance holes ISO 273: fine, medium, coarse. */
  clearance: [number, number, number];
  /** Socket head (ISO 4762) diameter: the counterbore is a little wider. */
  head: number;
}

const S = (d: number, pitches: number[], drill: number, clearance: [number, number, number], head: number): IsoSize => ({ d, pitches, drill, clearance, head });

/** ISO metric sizes M1.6…M64. */
export const ISO_SIZES: Record<string, IsoSize> = {
  'M1.6': S(1.6, [0.35, 0.2], 1.25, [1.7, 1.8, 2], 3),
  M2: S(2, [0.4, 0.25], 1.6, [2.2, 2.4, 2.6], 3.8),
  'M2.5': S(2.5, [0.45, 0.35], 2.05, [2.7, 2.9, 3.1], 4.5),
  M3: S(3, [0.5, 0.35], 2.5, [3.2, 3.4, 3.6], 5.5),
  M4: S(4, [0.7, 0.5], 3.3, [4.3, 4.5, 4.8], 7),
  M5: S(5, [0.8, 0.5], 4.2, [5.3, 5.5, 5.8], 8.5),
  M6: S(6, [1, 0.75], 5, [6.4, 6.6, 7], 10),
  M8: S(8, [1.25, 1, 0.75], 6.8, [8.4, 9, 10], 13),
  M10: S(10, [1.5, 1.25, 1, 0.75], 8.5, [10.5, 11, 12], 16),
  M12: S(12, [1.75, 1.5, 1.25, 1], 10.2, [13, 13.5, 14.5], 18),
  M14: S(14, [2, 1.5, 1.25, 1], 12, [15, 15.5, 16.5], 21),
  M16: S(16, [2, 1.5, 1], 14, [17, 17.5, 18.5], 24),
  M18: S(18, [2.5, 2, 1.5, 1], 15.5, [19, 20, 21], 27),
  M20: S(20, [2.5, 2, 1.5, 1], 17.5, [21, 22, 24], 30),
  M22: S(22, [2.5, 2, 1.5, 1], 19.5, [23, 24, 26], 33),
  M24: S(24, [3, 2, 1.5, 1], 21, [25, 26, 28], 36),
  M27: S(27, [3, 2, 1.5, 1], 24, [28, 30, 32], 40),
  M30: S(30, [3.5, 3, 2, 1.5, 1], 26.5, [31, 33, 35], 45),
  M33: S(33, [3.5, 3, 2, 1.5], 29.5, [34, 36, 38], 50),
  M36: S(36, [4, 3, 2, 1.5], 32, [37, 39, 42], 54),
  M39: S(39, [4, 3, 2, 1.5], 35, [40, 42, 45], 58),
  M42: S(42, [4.5, 4, 3, 2, 1.5], 37.5, [43, 45, 48], 63),
  M45: S(45, [4.5, 4, 3, 2, 1.5], 40.5, [46, 48, 52], 68),
  M48: S(48, [5, 4, 3, 2, 1.5], 43, [50, 52, 56], 72),
  M52: S(52, [5, 4, 3, 2, 1.5], 47, [54, 56, 62], 78),
  M56: S(56, [5.5, 4, 3, 2, 1.5], 50.5, [58, 62, 66], 84),
  M60: S(60, [5.5, 4, 3, 2, 1.5], 54.5, [62, 66, 70], 90),
  M64: S(64, [6, 4, 3, 2, 1.5], 58, [66, 70, 74], 96),
};

export const ISO_SIZE_NAMES = Object.keys(ISO_SIZES);

/** The pitches of a size (mm), coarse first. */
export const isoPitches = (size: string) => ISO_SIZES[size]?.pitches ?? [];

const round1 = (x: number) => Math.round(x * 10) / 10;

/** A thread: its designation ("M6", "M8×1" — fine), major diameter and pitch. */
export interface ThreadSpec {
  designation: string;
  major: number;
  pitch: number;
}

/** The sizes of a standard hole, mm (the countersink angle in degrees); `thread` — a tapped hole's. */
export interface StandardHole {
  diameter: number;
  cboreDiameter: number;
  cboreDepth: number;
  csinkDiameter: number;
  csinkAngle: number;
  thread?: ThreadSpec;
}

/** Sizes of an ISO hole, or why there are none. */
export function isoHole(p: Pick<HoleParams, 'holeType' | 'size' | 'fit' | 'pitch'>): StandardHole | string {
  const s = p.size ? ISO_SIZES[p.size] : undefined;
  if (!s) return `Unknown ISO size "${p.size ?? ''}"`;
  const coarse = s.pitches[0];
  const pitch = p.pitch ? Number(p.pitch) : coarse;
  if (!s.pitches.includes(pitch)) return `${p.size} has no ${p.pitch} mm pitch`;
  const tapped = p.holeType === 'tapped';
  const fit = p.fit === 'close' ? 0 : p.fit === 'loose' ? 2 : 1;
  // a tapped hole: its tap drill (fine pitches: major − pitch); the screw goes through a clearance hole
  const diameter = tapped ? (pitch === coarse ? s.drill : round1(s.d - pitch)) : s.clearance[fit];
  const d = s.d;
  // DIN 974-1 for ISO 4762: the head with a clearance, as deep as the head is tall (= d) and a little more
  const cboreDiameter = round1(s.head + (d <= 6 ? 1 : d <= 16 ? 2 : d <= 20 ? 3 : 4));
  const cboreDepth = round1(d + (d <= 5 ? 0.4 : d <= 12 ? 0.6 : 0.8));
  // ISO 10642 heads (theoretical diameter ≈ 2.24 d for small screws, 2 d for large) with a clearance
  const k = d <= 12 ? 2.24 : d <= 16 ? 2.1 : 2.016;
  const csinkDiameter = round1(k * d + 0.3);
  return {
    diameter,
    cboreDiameter,
    cboreDepth,
    csinkDiameter,
    csinkAngle: 90,
    ...(tapped ? { thread: { designation: pitch === coarse ? p.size! : `${p.size}×${pitch}`, major: d, pitch } } : {}),
  };
}

/** Depths an ISO hole starts with: a tapped one — threaded 2 d deep, drilled a few pitches deeper; others — 2 d. */
export function isoDefaultDepths(size: string, tapped: boolean): { depth: number; tapDepth: number } {
  const s = ISO_SIZES[size];
  if (!s) return { depth: 10, tapDepth: 8 };
  const tapDepth = round1(2 * s.d);
  return { depth: tapped ? round1(tapDepth + 3 * s.pitches[0]) : tapDepth, tapDepth };
}
