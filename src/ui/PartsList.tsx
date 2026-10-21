import { useState } from 'react';
import { useEditor, sameRef } from '../store/editorStore';
import { activeStudio, useDoc, withStudio } from '../store/docStore';
import { uid } from '../core/ids';
import { defaultParams, nextFeatureName } from '../core/features';
import type { Feature, FeatureParamsMap } from '../core/types';
import type { PartMesh } from '../kernel/protocol';
import { Icon } from './icons';
import { t } from '../i18n';

export const COLOR_CHOICES = [
  '#a9bfd6', '#d8c3a1', '#a8c99e', '#d6a6a6', '#b3a8d6', '#9fcfcc', '#d9c27a', '#c9a6c9',
  '#5b8fd1', '#e07b39', '#4caf50', '#d64545', '#7e57c2', '#26a69a', '#f2c94c', '#8d6e63',
  '#ffffff', '#c0c4c8', '#7b8794', '#3a4048',
];

function setPartMeta(id: string, patch: Record<string, unknown>, key?: string) {
  useDoc.getState().update(
    (d) =>
      withStudio(d, (s) => {
        s.parts[id] = { ...(s.parts[id] ?? {}), ...patch };
      }),
    { key },
  );
}

export function PartsList() {
  const build = useEditor((s) => s.build);
  const selection = useEditor((s) => s.selection);
  const doc = useDoc((s) => s.doc);
  const studio = activeStudio(doc);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [name, setName] = useState('');
  // composite parts shown with their bodies
  const [expanded, setExpanded] = useState<string[]>([]);
  const parts = build?.parts ?? [];
  const ed = useEditor.getState;

  /** A feature of the Part Studio, inserted at the rollback bar. */
  const insertFeature = <T extends 'deletePart'>(type: T, params: FeatureParamsMap[T]) => {
    if (!studio) return;
    const f = { id: uid('f'), type, name: nextFeatureName(studio.features, type), params };
    useDoc.getState().update((d) =>
      withStudio(d, (s) => {
        const at = s.rollback ?? s.features.length;
        s.features.splice(at, 0, f as Feature);
        if (s.rollback !== null) s.rollback++;
      }),
    );
  };

  const menu = (e: React.MouseEvent, id: string, hidden: boolean) => {
    e.preventDefault();
    const ref = { kind: 'part' as const, partId: id };
    if (!ed().selection.some((r) => sameRef(r, ref))) ed().setSelection([ref]);
    // the menu acts on the selected parts (the one clicked among them), as in Onshape; renaming — on this one
    const picked = ed().selection.flatMap((r) => (r.kind === 'part' ? [r.partId] : []));
    const ids = picked.includes(id) ? picked : [id];
    const many = ids.length > 1;
    const composites = ids.filter((p) => parts.find((x) => x.id === p)?.composite);
    const setMeta = (patch: Record<string, unknown>, key?: string) =>
      useDoc.getState().update(
        (d) =>
          withStudio(d, (s) => {
            for (const p of ids) s.parts[p] = { ...(s.parts[p] ?? {}), ...patch };
          }),
        { key },
      );
    const items = [
      {
        label: t('Rename'), icon: 'rename',
        action: () => {
          setRenaming(id);
          setName(parts.find((p) => p.id === id)?.name ?? '');
        },
      },
      // shown or hidden all as the one clicked becomes
      { label: hidden ? t('Show') : t('Hide'), icon: hidden ? 'eye' : 'eyeOff', action: () => setMeta({ hidden: !hidden }) },
      {
        label: t('Hide other parts'), icon: 'eyeOff',
        action: () =>
          useDoc.getState().update((d) =>
            withStudio(d, (s) => {
              for (const p of parts) if (!ids.includes(p.id)) s.parts[p.id] = { ...(s.parts[p.id] ?? {}), hidden: true };
            }),
          ),
      },
      {
        label: t('Show all'), icon: 'eye',
        action: () =>
          useDoc.getState().update((d) =>
            withStudio(d, (s) => {
              for (const k of Object.keys(s.parts)) s.parts[k] = { ...s.parts[k], hidden: false };
            }),
          ),
      },
      { label: t('Material…'), icon: 'massProps', action: () => useEditor.setState({ materialOpen: { partIds: ids } }) },
      { label: t(many ? 'Export parts' : 'Export part'), icon: 'export', action: () => useEditor.setState({ exportOpen: { partIds: ids } }) },
      { separator: true, label: '' },
      // the composites among them: their bodies parts again (a Delete part feature dissolving them)
      ...(composites.length
        ? [
            {
              label: t(composites.length > 1 ? 'Dissolve composite parts' : 'Dissolve composite part'), icon: 'compositePart',
              action: () => insertFeature('deletePart', { parts: composites.map((partId) => ({ kind: 'part' as const, partId })), dissolve: true }),
            },
          ]
        : []),
      {
        // one Delete part feature for all of them
        label: t(many ? 'Delete parts' : 'Delete part'), icon: 'deletePart',
        danger: true,
        action: () => insertFeature('deletePart', { ...defaultParams('deletePart'), parts: ids.map((partId) => ({ kind: 'part' as const, partId })) }),
      },
    ];
    useEditor.setState({
      contextMenu: {
        x: e.clientX,
        y: e.clientY,
        items,
        palette: {
          colors: COLOR_CHOICES,
          onPick: (color) => setMeta({ color }, `color-${ids.join()}`),
          // dragging the slider is one undo step; fully opaque leaves no value behind
          opacity: {
            value: studio?.parts[id]?.opacity ?? 1,
            onChange: (v) => setMeta({ opacity: v >= 1 ? undefined : v }, `opacity-${ids.join()}`),
          },
        },
      },
    });
  };

  // surfaces and composite parts apart, after the parts (Onshape: Parts / Surfaces / Composite parts)
  const solids = parts.filter((p) => !p.surface && !p.composite);
  const surfaces = parts.filter((p) => p.surface && !p.composite);
  const composites = parts.filter((p) => p.composite);
  const anyShown = parts.some((p) => !p.hidden);
  const group = (key: string, label: string, n: number) => (
    <div key={key} className="tree-group">
      {t(label)} <span className="count">({n})</span>
    </div>
  );
  // the bodies of a composite part: an open one's are parts of their own (a click selects one), a closed one's are not
  const members = (p: PartMesh) =>
    expanded.includes(p.id) &&
    p.composite!.members.map((m) => {
      const own = !p.composite!.closed && parts.some((x) => x.id === m.id);
      const ref = { kind: 'part' as const, partId: m.id };
      return (
        <div
          key={`${p.id}/${m.id}`}
          className={'tree-item composite-member' + (own ? '' : ' consumed') + (own && selection.some((r) => sameRef(r, ref)) ? ' selected' : '')}
          title={own ? undefined : t('In the composite part only')}
          onClick={own ? () => ed().pickIntoField(ref, 'part') || ed().select(ref) : undefined}
          onMouseEnter={own ? () => ed().setHover(ref) : undefined}
          onMouseLeave={own ? () => ed().setHover(null) : undefined}
        >
          <span className="tree-name">{m.name}</span>
        </div>
      );
    });
  return (
    <div className="panel-section parts">
      <div className="panel-header">
        {t('Parts')} <span className="count">({solids.length + composites.filter((p) => p.composite!.closed).length})</span>
        {parts.length > 0 && (
          // all of them at once (surfaces too): hide while any is shown, else show all; one undo step
          <span
            className="header-eye"
            title={anyShown ? t('Hide all') : t('Show all')}
            onClick={() =>
              useDoc.getState().update((d) =>
                withStudio(d, (s) => {
                  for (const p of parts) s.parts[p.id] = { ...(s.parts[p.id] ?? {}), hidden: anyShown };
                }),
              )
            }
          >
            <Icon name={anyShown ? 'eye' : 'eyeOff'} size={14} />
          </span>
        )}
      </div>
      <div className="panel-body">
        {[...solids, ...surfaces, ...composites].map((p, i) => {
          const ref = { kind: 'part' as const, partId: p.id };
          const sel = selection.some((r) => sameRef(r, ref));
          const head =
            i === solids.length && surfaces.length
              ? group('surfaces', 'Surfaces', surfaces.length)
              : i === solids.length + surfaces.length && composites.length
                ? group('composites', 'Composite parts', composites.length)
                : null;
          return [
            head,
            <div
              key={p.id}
              className={'tree-item' + (sel ? ' selected' : '')}
              // with a feature dialog open: into its active field when it takes parts (Merge scope, Boolean tools …)
              onClick={() => ed().pickIntoField(ref, 'part') || ed().select(ref)}
              onMouseEnter={() => ed().setHover(ref)}
              onMouseLeave={() => ed().setHover(null)}
              onDoubleClick={() => {
                setRenaming(p.id);
                setName(p.name);
              }}
              onContextMenu={(e) => menu(e, p.id, p.hidden)}
            >
              {p.composite && (
                <span
                  className="tree-icon"
                  title={t(expanded.includes(p.id) ? 'Collapse' : 'Expand')}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((x) => (x.includes(p.id) ? x.filter((k) => k !== p.id) : [...x, p.id]));
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  <Icon name={expanded.includes(p.id) ? 'chevronDown' : 'chevronRight'} size={12} />
                </span>
              )}
              {p.composite ? (
                <span title={t(p.composite.closed ? 'Closed composite part' : 'Open composite part: its parts are listed too')}>
                  <Icon name="compositePart" size={14} />
                </span>
              ) : p.surface ? (
                <Icon name="offsetSurface" size={14} />
              ) : (
                <span className="color-swatch" style={{ background: p.color }} />
              )}
              {renaming === p.id ? (
                <input
                  className="tree-rename"
                  autoFocus
                  onFocus={(e) => e.target.select()}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => {
                    if (name.trim()) setPartMeta(p.id, { name: name.trim() });
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      if (name.trim()) setPartMeta(p.id, { name: name.trim() });
                      setRenaming(null);
                    }
                    if (e.key === 'Escape') setRenaming(null);
                  }}
                />
              ) : (
                <span className="tree-name" style={p.hidden ? { color: 'var(--text-3)' } : undefined}>
                  {p.name}
                </span>
              )}
              <span
                className={'eye' + (p.hidden ? ' off' : '')}
                title={p.hidden ? t('Show') : t('Hide')}
                onClick={(e) => {
                  e.stopPropagation();
                  setPartMeta(p.id, { hidden: !p.hidden });
                }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <Icon name={p.hidden ? 'eyeOff' : 'eye'} size={14} />
              </span>
            </div>,
            p.composite && members(p),
          ];
        })}
      </div>
    </div>
  );
}
