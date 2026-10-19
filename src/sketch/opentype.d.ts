// The part of opentype.js (1.3.x, no typings of its own) that sketch text uses.

declare module 'opentype.js' {
  export type PathCommand =
    | { type: 'M' | 'L'; x: number; y: number }
    | { type: 'Q'; x1: number; y1: number; x: number; y: number }
    | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: 'Z' };

  export interface Glyph {
    index: number;
    advanceWidth?: number;
    /** The outline in font units, y up. */
    path: { commands: PathCommand[] };
    getBoundingBox(): { x1: number; y1: number; x2: number; y2: number };
  }

  export interface Font {
    unitsPerEm: number;
    tables: { os2?: { sCapHeight?: number } };
    charToGlyph(c: string): Glyph;
    /** Lays out `text` (kerning, ligatures) and calls back with each glyph and its pen position; returns the end x. */
    forEachGlyph(
      text: string,
      x: number,
      y: number,
      fontSize: number,
      options: { kerning?: boolean },
      callback: (glyph: Glyph, x: number, y: number, fontSize: number) => void,
    ): number;
  }

  export function parse(buffer: ArrayBuffer): Font;
  const opentype: { parse: typeof parse };
  export default opentype;
}
