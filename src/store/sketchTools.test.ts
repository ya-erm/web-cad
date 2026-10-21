// Sketch tools: a drawing tool starts with nothing selected — Q then makes what it draws construction, not what was
// selected before (a gear placed and still selected, say); tools that work on the selection keep it.

import { describe, expect, it } from 'vitest';
import { isDrawTool, useEditor, type SketchSession } from './editorStore';

const session = (selection: string[]): SketchSession =>
  ({ tool: 'select', selection, hover: null, construction: false, past: [], future: [], solve: null }) as SketchSession;

describe('sketch tools and the selection', () => {
  it('a drawing tool clears the selection, the others keep it', () => {
    for (const tool of ['line', 'rectCorner', 'circleCenter', 'arc3pt', 'spline', 'point', 'slot', 'ellipse', 'text', 'gear'] as const) {
      useEditor.setState({ sketch: session(['g1']) });
      useEditor.getState().setSketchTool(tool);
      expect(useEditor.getState().sketch!.selection, tool).toEqual([]);
      expect(useEditor.getState().sketch!.tool).toBe(tool);
    }
    for (const tool of ['select', 'dimension', 'trim', 'offset', 'use'] as const) {
      useEditor.setState({ sketch: session(['g1']) });
      useEditor.getState().setSketchTool(tool);
      expect(useEditor.getState().sketch!.selection, tool).toEqual(['g1']);
    }
  });

  it('knows the drawing tools', () => {
    expect(isDrawTool('line')).toBe(true);
    expect(isDrawTool('gear')).toBe(true);
    expect(isDrawTool('select')).toBe(false);
    expect(isDrawTool('dimension')).toBe(false);
  });
});
