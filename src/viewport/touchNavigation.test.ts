import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Engine } from './engine';
import { setTouchNavigation, useEditor } from '../store/editorStore';

// Exercise the real event routing without allocating a WebGL renderer or a geometry kernel.
function harness(sketch = false) {
  const e = Object.create(Engine.prototype);
  Object.assign(e, {
    viewOnly: false, viewPointers: new Map(), viewDrag: null, down: null,
    lastPos: { x: 0, y: 0 }, cursorWanted: '',
    renderer: { domElement: {
      setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(),
      getBoundingClientRect: () => ({ left: 0, top: 0 }), style: {},
    } },
    cam: { beginRotate: vi.fn(), rotate: vi.fn(), pan: vi.fn(), zoomAt: vi.fn() },
    sketchEditor: { active: sketch, onPointerDown: vi.fn(), onPointerUp: vi.fn(), onPointerDrag: vi.fn() },
    raycastParts: () => null, onClick: vi.fn(), pickTriad: () => null,
  });
  return e;
}
function pointer(id: number, x: number, y: number, pointerType = 'touch') {
  return { pointerId: id, clientX: x, clientY: y, pointerType, button: 0, buttons: 1 } as PointerEvent;
}

beforeEach(() => useEditor.setState({ touchNavigation: true, contextMenu: null }));

describe('touch camera navigation', () => {
  it('routes fingers to rotation, keeping a short tap for selection', () => {
    const e = harness();
    e.onDown(pointer(1, 10, 10));
    e.viewMove(pointer(1, 30, 20));
    e.viewUp(pointer(1, 30, 20));
    expect(e.cam.rotate).toHaveBeenCalledWith(20, 10, undefined);
    expect(e.onClick).not.toHaveBeenCalled();
    e.onDown(pointer(2, 20, 20));
    e.viewUp(pointer(2, 22, 21));
    expect(e.onClick).toHaveBeenCalledOnce();
  });

  it('pans and zooms with two fingers; lifting one resumes rotation without a tap', () => {
    const e = harness();
    e.onDown(pointer(1, 0, 0));
    e.onDown(pointer(2, 100, 0));
    e.viewMove(pointer(2, 120, 0));
    expect(e.cam.pan).toHaveBeenCalledWith(10, 0);
    expect(e.cam.zoomAt).toHaveBeenCalledWith(100 / 120, 60, 0);
    e.viewUp(pointer(2, 120, 0));
    e.viewMove(pointer(1, 10, 0));
    e.viewUp(pointer(1, 10, 0));
    expect(e.cam.rotate).toHaveBeenCalledWith(10, 0, undefined);
    expect(e.onClick).not.toHaveBeenCalled();
    expect(e.viewPointers.size).toBe(0);
  });

  it('pans a sketch without editing; a tap invokes the sketch tool', () => {
    const e = harness(true);
    e.onDown(pointer(1, 0, 0));
    e.viewMove(pointer(1, 20, 0));
    e.viewUp(pointer(1, 20, 0));
    expect(e.cam.pan).toHaveBeenCalledWith(20, 0);
    expect(e.cam.rotate).not.toHaveBeenCalled();
    expect(e.sketchEditor.onPointerDown).not.toHaveBeenCalled();
    expect(e.sketchEditor.onPointerUp).not.toHaveBeenCalled();
    e.onDown(pointer(2, 0, 0));
    e.viewUp(pointer(2, 0, 0));
    expect(e.sketchEditor.onPointerDown).toHaveBeenCalledOnce();
    expect(e.sketchEditor.onPointerUp).toHaveBeenCalledWith(0, 0, expect.anything(), false);
  });

  it('does not draw after a two finger gesture or select after pointer cancellation', () => {
    const e = harness(true);
    e.onDown(pointer(1, 0, 0));
    e.onDown(pointer(2, 100, 0));
    e.viewUp(pointer(2, 100, 0));
    e.viewUp(pointer(1, 0, 0));
    e.onDown(pointer(3, 20, 20));
    e.viewUp(pointer(3, 20, 20), true);
    expect(e.sketchEditor.onPointerUp).not.toHaveBeenCalled();
    expect(e.onClick).not.toHaveBeenCalled();
    expect(e.viewPointers.size).toBe(0);
  });

  it('routes Apple Pencil to sketch interaction and keeps fingers separate', () => {
    const e = harness(true);
    const pen = pointer(1, 10, 10, 'pen');
    e.onDown(pen);
    expect(e.sketchEditor.onPointerDown).toHaveBeenCalledWith(10, 10, pen);
    expect(e.viewPointers.size).toBe(0);
    expect(e.down.button).toBe(0);
    expect(e.cam.beginRotate).not.toHaveBeenCalled();
    e.onDown(pointer(2, 30, 30));
    e.viewMove(pointer(2, 50, 30));
    expect(e.cam.pan).toHaveBeenCalledWith(20, 0);
    expect(e.sketchEditor.onPointerDown).toHaveBeenCalledOnce();
  });

  it('restores left button behavior for fingers when the preference is off', () => {
    setTouchNavigation(false);
    const e = harness(true);
    e.onDown(pointer(1, 10, 10));
    expect(e.sketchEditor.onPointerDown).toHaveBeenCalledOnce();
    expect(e.viewPointers.size).toBe(0);
  });
});
