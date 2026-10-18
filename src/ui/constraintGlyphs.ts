/**
 * Small constraint glyphs drawn on the sketch canvas next to constrained
 * geometry (like Onshape's white constraint boxes).
 *
 * Same visual language as the constraint toolbar icons in `icons.tsx`
 * (dark strokes with Onshape-blue accents), simplified for ~14 px.
 */
import type { ConstraintType } from '../core/types';

const DARK = '#2b2b2b';
const BLUE = '#2f6fc4';

/** Wraps glyph content in a 14×14 SVG (no width/height — size it with CSS). */
const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" fill="none" stroke="${DARK}" ` +
  `stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const dot = (x: number, y: number, r: number, color = DARK): string =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="none"/>`;

/** Five small circles on a ring, the first one dark (seed), the rest blue. */
const patternRing = (): string => {
  const out: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = ((-90 + i * 72) * Math.PI) / 180;
    const x = Math.round((7 + 4.6 * Math.cos(a)) * 100) / 100;
    const y = Math.round((7 + 4.6 * Math.sin(a)) * 100) / 100;
    out.push(`<circle cx="${x}" cy="${y}" r="1.55" stroke="${i === 0 ? DARK : BLUE}" stroke-width="1.1"/>`);
  }
  return out.join('');
};

/** Raw SVG markup (string) 14×14 viewBox, no width/height attributes, for innerHTML of a 16px white box. */
export const CONSTRAINT_GLYPH_SVG: Partial<Record<ConstraintType | 'pattern' | 'mirror', string>> = {
  coincident: svg(
    `<path d="M1.5 4.5 L12.5 9.5"/><path d="M4 12.5 L10 1.5" stroke="${BLUE}"/>${dot(7, 7, 1.8)}`,
  ),
  concentric: svg(
    `<circle cx="7" cy="7" r="5.4" stroke="${BLUE}"/><circle cx="7" cy="7" r="2.6" stroke="${BLUE}"/>`,
  ),
  parallel: svg(`<path d="M2 10.5 L7 2.5 M7 11.5 L12 3.5" stroke-width="1.4"/>`),
  perpendicular: svg(
    `<path d="M5 8.5 H8.5 V12" stroke-width="1"/><path d="M5 12 V2" stroke="${BLUE}"/>` +
      `<path d="M1.5 12 H12.5" stroke-width="1.5"/>`,
  ),
  tangent: svg(`<circle cx="8.3" cy="8.3" r="3.9" stroke="${BLUE}"/><path d="M1.5 9.6 L9.6 1.5"/>`),
  horizontal: svg(`<path d="M2 7 H12" stroke-width="1.8"/>`),
  vertical: svg(`<path d="M7 2 V12" stroke-width="1.8"/>`),
  equal: svg(`<path d="M2.5 4.8 H11.5 M2.5 9.2 H11.5" stroke-width="1.6"/>`),
  midpoint: svg(`<path d="M1.5 7 H12.5" stroke="${BLUE}"/>${dot(7, 7, 2.1)}`),
  symmetric: svg(
    `<path d="M7 1.5 V12.5" stroke-width="0.9" stroke-dasharray="1.5 1.2" stroke-linecap="butt"/>` +
      `<path d="M1.5 3 V11 L5.3 7 Z"/><path d="M12.5 3 V11 L8.7 7 Z" stroke="${BLUE}"/>`,
  ),
  fix: svg(
    `<path d="M4 7.5 L2.3 10.3 M6.6 7.5 L4.9 10.3 M9.2 7.5 L7.5 10.3 M11.8 7.5 L10.1 10.3" stroke-width="1"/>` +
      `<path d="M1.5 6 H12.5" stroke="${BLUE}" stroke-width="2" stroke-linecap="butt"/>`,
  ),
  pattern: svg(patternRing()),
  mirror: svg(
    `<path d="M7 1.5 V12.5" stroke-width="0.9" stroke-dasharray="1.5 1.2" stroke-linecap="butt"/>` +
      `<path d="M4.8 2.5 L1.8 7 L4.8 11.5"/><path d="M9.2 2.5 L12.2 7 L9.2 11.5" stroke="${BLUE}"/>`,
  ),
};
