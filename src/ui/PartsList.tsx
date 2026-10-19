import { useState } from 'react';
import { useEditor, sameRef } from '../store/editorStore';
import { activeStudio, useDoc, withStudio } from '../store/docStore';
import { uid } from '../core/ids';
import { defaultParams, nextFeatureName } from '../core/features';
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
  const parts = build?.parts ?? [];
  const ed = useEditor.getState;

  const menu = (e: React.MouseEvent, id: string, hidden: boolean) => {
    e.preventDefault();
    const ref = { kind: 'part' as const, partId: id };
    if (!ed().selection.some((r) => sameRef(r, ref))) ed().setSelection([ref]);
    const items = [
      {
        label: t('Rename'), icon: 'rename',
        action: () => {
          setRenaming(id);
          setName(parts.find((p) => p.id === id)?.name ?? '');
        },
      },
      { label: hidden ? t('Show') : t('Hide'), icon: hidden ? 'eye' : 'eyeOff', action: () => setPartMeta(id, { hidden: !hidden }) },
      {
        label: t('Hide other parts'), icon: 'eyeOff',
        action: () =>
          useDoc.getState().update((d) =>
            withStudio(d, (s) => {
              for (const p of parts) if (p.id !== id) s.parts[p.id] = { ...(s.parts[p.id] ?? {}), hidden: true };
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
      {
        // the selected parts (the one clicked among them), or just this one
        label: t('Material…'), icon: 'massProps',
        action: () => {
          const ids = ed().selection.flatMap((r) => (r.kind === 'part' ? [r.partId] : []));
          useEditor.setState({ materialOpen: { partIds: ids.includes(id) ? ids : [id] } });
        },
      },
      { label: t('Export part'), icon: 'export', action: () => useEditor.setState({ exportOpen: { partIds: [id] } }) },
      { separator: true, label: '' },
      {
        label: t('Delete part'), icon: 'deletePart',
        danger: true,
        action: () => {
          if (!studio) return;
          const f = {
            id: uid('f'),
            type: 'deletePart' as const,
            name: nextFeatureName(studio.features, 'deletePart'),
            params: { ...defaultParams('deletePart'), parts: [ref] },
          };
          useDoc.getState().update((d) =>
            withStudio(d, (s) => {
              const at = s.rollback ?? s.features.length;
              s.features.splice(at, 0, f);
              if (s.rollback !== null) s.rollback++;
            }),
          );
        },
      },
    ];
    useEditor.setState({
      contextMenu: {
        x: e.clientX,
        y: e.clientY,
        items,
        palette: { colors: COLOR_CHOICES, onPick: (color) => setPartMeta(id, { color }, `color-${id}`) },
      },
    });
  };

  // surfaces apart, after the parts (Onshape: Parts / Surfaces)
  const solids = parts.filter((p) => !p.surface);
  const surfaces = parts.filter((p) => p.surface);
  const anyShown = parts.some((p) => !p.hidden);
  return (
    <div className="panel-section parts">
      <div className="panel-header">
        {t('Parts')} <span className="count">({solids.length})</span>
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
        {[...solids, ...surfaces].map((p, i) => {
          const ref = { kind: 'part' as const, partId: p.id };
          const sel = selection.some((r) => sameRef(r, ref));
          const head =
            p.surface && i === solids.length ? (
              <div key="surfaces" className="tree-group">
                {t('Surfaces')} <span className="count">({surfaces.length})</span>
              </div>
            ) : null;
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
              {p.surface ? <Icon name="offsetSurface" size={14} /> : <span className="color-swatch" style={{ background: p.color }} />}
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
          ];
        })}
      </div>
    </div>
  );
}
