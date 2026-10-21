import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ConstraintType, FeatureType } from '../core/types';
import { useEditor, type SketchTool } from '../store/editorStore';
import { useDoc } from '../store/docStore';
import { getEngine } from '../viewport/engineRef';
import { Icon, type IconName } from './icons';
import { t } from '../i18n';

export interface ToolDef {
  id: FeatureType;
  icon: IconName;
  label: string;
  shortcut?: string;
}

export const FEATURE_TOOLS: (ToolDef | '|')[] = [
  { id: 'sketch', icon: 'sketch', label: 'Sketch', shortcut: 'Shift+S' },
  '|',
  { id: 'extrude', icon: 'extrude', label: 'Extrude', shortcut: 'Shift+E' },
  { id: 'revolve', icon: 'revolve', label: 'Revolve', shortcut: 'Shift+W' },
  { id: 'sweep', icon: 'sweep', label: 'Sweep' },
  { id: 'loft', icon: 'loft', label: 'Loft' },
  { id: 'thicken', icon: 'thicken', label: 'Thicken' },
  '|',
  { id: 'fillet', icon: 'fillet', label: 'Fillet', shortcut: 'Shift+F' },
  { id: 'chamfer', icon: 'chamfer', label: 'Chamfer' },
  { id: 'draft', icon: 'draft', label: 'Draft' },
  { id: 'shell', icon: 'shell', label: 'Shell' },
  { id: 'rib', icon: 'rib', label: 'Rib' },
  { id: 'wrap', icon: 'wrap', label: 'Wrap' },
  { id: 'hole', icon: 'hole', label: 'Hole' },
  '|',
  // direct edits of faces
  { id: 'moveFace', icon: 'moveFace', label: 'Move face' },
  { id: 'replaceFace', icon: 'replaceFace', label: 'Replace face' },
  { id: 'deleteFace', icon: 'deleteFace', label: 'Delete face' },
  { id: 'offsetSurface', icon: 'offsetSurface', label: 'Offset surface' },
  { id: 'enclose', icon: 'enclose', label: 'Enclose' },
  '|',
  { id: 'linearPattern', icon: 'linearPattern', label: 'Linear pattern' },
  { id: 'circularPattern', icon: 'circularPattern', label: 'Circular pattern' },
  { id: 'curvePattern', icon: 'curvePattern', label: 'Curve pattern' },
  { id: 'mirror', icon: 'mirror', label: 'Mirror' },
  '|',
  { id: 'boolean', icon: 'boolean', label: 'Boolean' },
  { id: 'split', icon: 'split', label: 'Split' },
  { id: 'transform', icon: 'transform', label: 'Transform' },
  { id: 'deletePart', icon: 'deletePart', label: 'Delete part' },
  '|',
  { id: 'plane', icon: 'plane', label: 'Plane' },
  { id: 'helix', icon: 'helix', label: 'Helix' },
  { id: 'mateConnector', icon: 'mateConnector', label: 'Mate connector' },
  '|',
  { id: 'variable', icon: 'variable', label: 'Variable' },
  { id: 'import', icon: 'import', label: 'Import' },
  { id: 'derived', icon: 'partStudio', label: 'Derived' },
];

export interface SketchToolDef {
  id: SketchTool;
  icon: IconName;
  label: string;
  shortcut?: string;
}

export const SKETCH_TOOLS: (SketchToolDef | '|')[] = [
  { id: 'select', icon: 'select', label: 'Select', shortcut: 'Esc' },
  '|',
  { id: 'line', icon: 'line', label: 'Line', shortcut: 'L' },
  { id: 'rectCorner', icon: 'rectCorner', label: 'Corner rectangle', shortcut: 'G' },
  { id: 'rectCenter', icon: 'rectCenter', label: 'Center rectangle', shortcut: 'R' },
  { id: 'circleCenter', icon: 'circleCenter', label: 'Center point circle', shortcut: 'C' },
  { id: 'circle3pt', icon: 'circle3pt', label: '3 point circle' },
  { id: 'arc3pt', icon: 'arc3pt', label: '3 point arc', shortcut: 'A' },
  { id: 'arcTangent', icon: 'arcTangent', label: 'Tangent arc', shortcut: 'Shift+A' },
  { id: 'arcCenter', icon: 'arcCenter', label: 'Center point arc' },
  { id: 'spline', icon: 'spline', label: 'Spline' },
  { id: 'bezier', icon: 'bezier', label: 'Bezier curve' },
  { id: 'conic', icon: 'conic', label: 'Conic' },
  { id: 'point', icon: 'point', label: 'Point' },
  { id: 'slot', icon: 'slot', label: 'Slot' },
  { id: 'polygonInscribed', icon: 'polygonInscribed', label: 'Inscribed polygon' },
  { id: 'polygon', icon: 'polygon', label: 'Circumscribed polygon' },
  { id: 'ellipse', icon: 'ellipse', label: 'Ellipse' },
  { id: 'text', icon: 'sketchText', label: 'Text' },
  { id: 'gear', icon: 'sketchGear', label: 'Spur gear' },
  '|',
  { id: 'fillet', icon: 'sketchFillet', label: 'Sketch fillet', shortcut: 'Shift+F' },
  { id: 'trim', icon: 'trim', label: 'Trim', shortcut: 'M' },
  { id: 'extend', icon: 'extend', label: 'Extend', shortcut: 'X' },
  { id: 'split', icon: 'sketchSplit', label: 'Split curve' },
  { id: 'offset', icon: 'offset', label: 'Offset', shortcut: 'O' },
  { id: 'use', icon: 'use', label: 'Use', shortcut: 'U' },
  '|',
  { id: 'dimension', icon: 'dimension', label: 'Dimension', shortcut: 'D' },
];

export const CONSTRAINT_TOOLS: { id: ConstraintType; icon: IconName; label: string; shortcut?: string }[] = [
  { id: 'coincident', icon: 'coincident', label: 'Coincident', shortcut: 'I' },
  { id: 'concentric', icon: 'concentric', label: 'Concentric', shortcut: 'Shift+O' },
  { id: 'parallel', icon: 'parallel', label: 'Parallel', shortcut: 'B' },
  { id: 'tangent', icon: 'tangent', label: 'Tangent', shortcut: 'T' },
  { id: 'horizontal', icon: 'horizontal', label: 'Horizontal', shortcut: 'H' },
  { id: 'vertical', icon: 'vertical', label: 'Vertical', shortcut: 'V' },
  { id: 'perpendicular', icon: 'perpendicular', label: 'Perpendicular', shortcut: 'Shift+L' },
  { id: 'equal', icon: 'equal', label: 'Equal', shortcut: 'E' },
  { id: 'midpoint', icon: 'midpoint', label: 'Midpoint', shortcut: 'Shift+M' },
  { id: 'symmetric', icon: 'symmetric', label: 'Symmetric', shortcut: 'Shift+Q' },
  { id: 'fix', icon: 'fix', label: 'Fix', shortcut: 'Shift+J' },
];

const tip = (label: string, sc?: string) => (sc ? `${t(label)} (${sc})` : t(label));

/** The » button's width with its gap. */
const MORE_W = 34;

/**
 * Tool buttons in a row that keeps to the room it has: those that do not fit go into a panel behind » at its end,
 * as in Onshape. The buttons' widths are measured once (all shown), then the row shows as many as fit.
 */
function OverflowRow({ children }: { children: React.ReactNode }) {
  const items = Children.toArray(children);
  const row = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const widths = useRef<number[] | null>(null);
  const [fit, setFit] = useState(items.length);
  const [open, setOpen] = useState(false);
  // another set of tools: measured anew
  const shape = items.map((c) => (isValidElement(c) ? String(c.key) : '')).join('|');
  useLayoutEffect(() => {
    widths.current = null;
    setFit(items.length);
  }, [shape]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const layout = () => {
      if (!widths.current) {
        if (fit < items.length) return;
        const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
        // with their margins (separators have them)
        widths.current = [...el.children].slice(0, items.length).map((c) => {
          const cs = getComputedStyle(c);
          return c.getBoundingClientRect().width + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0) + gap;
        });
      }
      const w = widths.current;
      const room = el.clientWidth;
      const total = w.reduce((a, b) => a + b, 0);
      let n = w.length;
      if (total > room) {
        let used = MORE_W;
        n = 0;
        while (n < w.length && used + w[n] <= room) used += w[n++];
      }
      if (n !== fit) setFit(n);
    };
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(el);
    return () => ro.disconnect();
  });
  // a click outside closes the panel
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('.tb-more-panel, .tb-more')) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const rest = items.slice(fit).filter((c) => !(isValidElement(c) && (c.props as { className?: string }).className === 'tb-sep'));
  const box = open ? more.current?.getBoundingClientRect() : undefined;
  return (
    <div className="tb-row" ref={row}>
      {items.slice(0, fit)}
      {rest.length > 0 && (
        <button ref={more} className={'icon-btn tb-more' + (open ? ' active' : '')} title={t('More tools')} onClick={() => setOpen(!open)}>
          »
        </button>
      )}
      {box && rest.length > 0 && (
        // placed in the window: the toolbar clips what sticks out of it
        <div className="dropdown tb-more-panel" style={{ position: 'fixed', top: box.bottom + 4, right: Math.max(8, window.innerWidth - box.right) }} onClickCapture={() => setTimeout(() => setOpen(false))}>
          {rest}
        </div>
      )}
    </div>
  );
}

/**
 * Feature tools whose name — in the interface language or in English — has the query in it: names that start with
 * it first, then those with a word that does, then the rest.
 */
export function searchTools(query: string, tr: (s: string) => string = t): ToolDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rank = (x: ToolDef) => {
    const names = [tr(x.label), x.label].map((n) => n.toLowerCase());
    if (names.some((n) => n.startsWith(q))) return 0;
    if (names.some((n) => n.split(/[\s-]+/).some((w) => w.startsWith(q)))) return 1;
    return names.some((n) => n.includes(q)) ? 2 : -1;
  };
  return (FEATURE_TOOLS.filter((x) => x !== '|') as ToolDef[])
    .map((x) => ({ x, r: rank(x) }))
    .filter((m) => m.r >= 0)
    .sort((a, b) => a.r - b.r)
    .map((m) => m.x);
}

function FeatureToolbar() {
  const start = useEditor((s) => s.startFeature);
  const editing = useEditor((s) => s.editing);
  const undo = useDoc((s) => s.undo);
  const redo = useDoc((s) => s.redo);
  const canUndo = useDoc((s) => s.past.length > 0);
  const canRedo = useDoc((s) => s.future.length > 0);
  const [q, setQ] = useState('');
  /** The highlighted result (Enter starts it; arrows move it). */
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const matches = searchTools(q);
  const pick = (id: FeatureType) => {
    start(id);
    setQ('');
    input.current?.blur();
  };
  // the toolbar clips what sticks out of it (it scrolls sideways): the results are placed in the window instead
  const box = focused && matches.length ? input.current?.getBoundingClientRect() : undefined;
  return (
    <div className="toolbar">
      <button className="icon-btn" title={`${t('Undo')} (Ctrl+Z)`} disabled={!canUndo || !!editing} onClick={undo}>
        <Icon name="undo" />
      </button>
      <button className="icon-btn" title={`${t('Redo')} (Ctrl+Y)`} disabled={!canRedo || !!editing} onClick={redo}>
        <Icon name="redo" />
      </button>
      <div className="tb-sep" />
      <OverflowRow>
        {FEATURE_TOOLS.map((tool, i) =>
          tool === '|' ? (
            <div key={i} className="tb-sep" />
          ) : (
            <button
              key={tool.id}
              className={'icon-btn' + (editing?.draft.type === tool.id ? ' active' : '')}
              title={tip(tool.label, tool.shortcut)}
              disabled={!!editing}
              onClick={() => start(tool.id)}
            >
              <Icon name={tool.icon} />
            </button>
          ),
        )}
      </OverflowRow>
      <div className="tool-search">
        <span className="search-icon">
          <Icon name="search" size={16} />
        </span>
        <input
          ref={input}
          placeholder={t('Search tools')}
          value={q}
          disabled={!!editing}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (matches.length) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
            }
            if (e.key === 'Enter' && matches.length) pick(matches[Math.min(active, matches.length - 1)].id);
            if (e.key === 'Escape') {
              setQ('');
              input.current?.blur();
            }
          }}
        />
        {box && (
          <div className="dropdown tool-search-results" style={{ position: 'fixed', top: box.bottom + 4, right: window.innerWidth - box.right }}>
            {matches.map((m, i) => (
              <div
                key={m.id}
                className={'dropdown-item' + (i === Math.min(active, matches.length - 1) ? ' active' : '')}
                // before the input loses focus (and the list closes)
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(m.id);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <Icon name={m.icon} size={18} /> {t(m.label)}
                {m.shortcut && <span className="menu-shortcut">{m.shortcut}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SketchToolbar() {
  const sketch = useEditor((s) => s.sketch);
  const setTool = useEditor((s) => s.setSketchTool);
  const commit = useEditor((s) => s.commitEditing);
  const undo = useEditor((s) => s.sketchUndo);
  const redo = useEditor((s) => s.sketchRedo);
  if (!sketch) return null;
  // a new sketch waiting for its plane: nothing to draw on yet
  const off = !!sketch.planePending;
  return (
    <div className="toolbar">
      <button className="finish-btn" title={`${t('Finish sketch')} (Enter)`} disabled={off} onClick={() => commit()}>
        <Icon name="check" size={18} /> {t('Finish sketch')}
      </button>
      <div className="tb-sep" />
      <button className="icon-btn" title={`${t('Undo')} (Ctrl+Z)`} disabled={!sketch.past.length} onClick={undo}>
        <Icon name="undo" />
      </button>
      <button className="icon-btn" title={`${t('Redo')} (Ctrl+Y)`} disabled={!sketch.future.length} onClick={redo}>
        <Icon name="redo" />
      </button>
      <div className="tb-sep" />
      <OverflowRow>
        {SKETCH_TOOLS.map((tool, i) =>
          tool === '|' ? (
            <div key={i} className="tb-sep" />
          ) : (
            <button
              key={tool.id}
              className={'icon-btn' + (sketch.tool === tool.id && !sketch.constraint && !sketch.mirror ? ' active' : '')}
              title={tip(tool.label, tool.shortcut)}
              disabled={off}
              onClick={() => setTool(tool.id)}
            >
              <Icon name={tool.icon} />
            </button>
          ),
        )}
        <button className="icon-btn" title={tip('Sketch transform')} disabled={off} onClick={() => getEngine()?.sketchEditor.startTransform()}>
          <Icon name="sketchTransform" />
        </button>
        <button className={'icon-btn' + (sketch.mirror ? ' active' : '')} title={tip('Sketch mirror')} disabled={off} onClick={() => getEngine()?.sketchEditor.applyMirror()}>
          <Icon name="sketchMirror" />
        </button>
        <button className="icon-btn" title={tip('Sketch linear pattern')} disabled={off} onClick={() => getEngine()?.sketchEditor.startPattern('linear')}>
          <Icon name="sketchLinearPattern" />
        </button>
        <button className="icon-btn" title={tip('Sketch circular pattern')} disabled={off} onClick={() => getEngine()?.sketchEditor.startPattern('circular')}>
          <Icon name="sketchCircularPattern" />
        </button>
        <div className="tb-sep" />
        <button
          className={'icon-btn' + (sketch.construction ? ' active' : '')}
          title={tip('Construction', 'Q')}
          disabled={off}
          onClick={() => getEngine()?.sketchEditor.toggleConstruction()}
        >
          <Icon name="construction" />
        </button>
        <div className="tb-sep" />
        {CONSTRAINT_TOOLS.map((c) => (
          <button
            key={c.id}
            className={'icon-btn' + (sketch.constraint === c.id ? ' active' : '')}
            title={tip(c.label, c.shortcut)}
            disabled={off}
            // on again: off (as Esc)
            onClick={() => (sketch.constraint === c.id ? setTool('select') : getEngine()?.sketchEditor.applyConstraint(c.id))}
          >
            <Icon name={c.icon} />
          </button>
        ))}
      </OverflowRow>
    </div>
  );
}

export function Toolbar() {
  const isSketch = useEditor((s) => !!s.sketch && s.editing?.draft.type === 'sketch');
  return isSketch ? <SketchToolbar /> : <FeatureToolbar />;
}
