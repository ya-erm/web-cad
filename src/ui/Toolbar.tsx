import { useState } from 'react';
import type { ConstraintType, FeatureType } from '../core/types';
import { toggleShowConstraints, useEditor, type SketchTool } from '../store/editorStore';
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
  { id: 'hole', icon: 'hole', label: 'Hole' },
  '|',
  { id: 'linearPattern', icon: 'linearPattern', label: 'Linear pattern' },
  { id: 'circularPattern', icon: 'circularPattern', label: 'Circular pattern' },
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
  { id: 'point', icon: 'point', label: 'Point' },
  { id: 'slot', icon: 'slot', label: 'Slot' },
  { id: 'polygonInscribed', icon: 'polygonInscribed', label: 'Inscribed polygon' },
  { id: 'polygon', icon: 'polygon', label: 'Circumscribed polygon' },
  { id: 'ellipse', icon: 'ellipse', label: 'Ellipse' },
  '|',
  { id: 'fillet', icon: 'sketchFillet', label: 'Sketch fillet', shortcut: 'Shift+F' },
  { id: 'trim', icon: 'trim', label: 'Trim', shortcut: 'M' },
  { id: 'extend', icon: 'extend', label: 'Extend' },
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

function FeatureToolbar() {
  const start = useEditor((s) => s.startFeature);
  const editing = useEditor((s) => s.editing);
  const undo = useDoc((s) => s.undo);
  const redo = useDoc((s) => s.redo);
  const canUndo = useDoc((s) => s.past.length > 0);
  const canRedo = useDoc((s) => s.future.length > 0);
  const [q, setQ] = useState('');
  const matches = q
    ? (FEATURE_TOOLS.filter((x) => x !== '|') as ToolDef[]).filter(
        (x) => t(x.label).toLowerCase().includes(q.toLowerCase()) || x.label.toLowerCase().includes(q.toLowerCase()),
      )
    : [];
  return (
    <div className="toolbar">
      <button className="icon-btn" title={`${t('Undo')} (Ctrl+Z)`} disabled={!canUndo || !!editing} onClick={undo}>
        <Icon name="undo" />
      </button>
      <button className="icon-btn" title={`${t('Redo')} (Ctrl+Y)`} disabled={!canRedo || !!editing} onClick={redo}>
        <Icon name="redo" />
      </button>
      <div className="tb-sep" />
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
      <div className="tool-search">
        <span className="search-icon">
          <Icon name="search" size={16} />
        </span>
        <input
          placeholder={t('Search tools')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) {
              start(matches[0].id);
              setQ('');
            }
            if (e.key === 'Escape') setQ('');
            e.stopPropagation();
          }}
        />
        {matches.length > 0 && (
          <div className="dropdown">
            {matches.map((m) => (
              <div
                key={m.id}
                className="dropdown-item"
                onMouseDown={() => {
                  start(m.id);
                  setQ('');
                }}
              >
                <Icon name={m.icon} size={18} /> {t(m.label)}
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
  const showConstraints = useEditor((s) => s.showConstraints);
  const setTool = useEditor((s) => s.setSketchTool);
  const commit = useEditor((s) => s.commitEditing);
  const undo = useEditor((s) => s.sketchUndo);
  const redo = useEditor((s) => s.sketchRedo);
  if (!sketch) return null;
  return (
    <div className="toolbar">
      <button className="finish-btn" title={`${t('Finish sketch')} (Enter)`} onClick={() => commit()}>
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
      {SKETCH_TOOLS.map((tool, i) =>
        tool === '|' ? (
          <div key={i} className="tb-sep" />
        ) : (
          <button
            key={tool.id}
            className={'icon-btn' + (sketch.tool === tool.id ? ' active' : '')}
            title={tip(tool.label, tool.shortcut)}
            onClick={() => setTool(tool.id)}
          >
            <Icon name={tool.icon} />
          </button>
        ),
      )}
      <button className="icon-btn" title={tip('Sketch mirror')} onClick={() => getEngine()?.sketchEditor.applyMirror()}>
        <Icon name="sketchMirror" />
      </button>
      <button className="icon-btn" title={tip('Sketch linear pattern')} onClick={() => getEngine()?.sketchEditor.startPattern('linear')}>
        <Icon name="sketchLinearPattern" />
      </button>
      <button className="icon-btn" title={tip('Sketch circular pattern')} onClick={() => getEngine()?.sketchEditor.startPattern('circular')}>
        <Icon name="sketchCircularPattern" />
      </button>
      <div className="tb-sep" />
      <button
        className={'icon-btn' + (sketch.construction ? ' active' : '')}
        title={tip('Construction', 'Q')}
        onClick={() => getEngine()?.sketchEditor.toggleConstruction()}
      >
        <Icon name="construction" />
      </button>
      <div className="tb-sep" />
      <button
        className={'icon-btn' + (showConstraints ? ' active' : '')}
        title={tip(showConstraints ? 'Hide constraints' : 'Show constraints', 'Shift+C')}
        onClick={toggleShowConstraints}
      >
        <Icon name={showConstraints ? 'eye' : 'eyeOff'} />
      </button>
      {CONSTRAINT_TOOLS.map((c) => (
        <button key={c.id} className="icon-btn" title={tip(c.label, c.shortcut)} onClick={() => getEngine()?.sketchEditor.applyConstraint(c.id)}>
          <Icon name={c.icon} />
        </button>
      ))}
    </div>
  );
}

export function Toolbar() {
  const isSketch = useEditor((s) => !!s.sketch && s.editing?.draft.type === 'sketch');
  return isSketch ? <SketchToolbar /> : <FeatureToolbar />;
}
