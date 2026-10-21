import { useEffect, useMemo, useRef, useState } from 'react';
import type { Draft } from 'immer';
import type { ConfigInput, Feature, FeatureType, HoleParams, PartStudioTab, SelRef } from '../core/types';
import { standardDefaultDepths, standardDefaultSize, standardHole, standardPitches, standardSizes } from '../core/holes';
import { FIELD_SPECS, keepRefs } from '../core/fieldSpecs';
import { FEATURE_LABELS, collectVariables, makeEvalContext } from '../core/features';
import { chosenLabel, configuredOf, configuredParams, inputName } from '../core/config';
import { ConfigurationFields } from './ConfigurationFields';
import { derivableStudios, derivedSourceKey, parseVersionStudio, sourceStudio, versionStudioId } from '../core/derived';
import { derivableVersions, snapshotStudios, versionDocument, type VersionedDocument } from '../store/versionSources';
import { sourceContents, type SourceContents } from '../store/rebuild';
import { formatNumber, LENGTH_FACTOR, tryEvaluate } from '../core/expr';
import { stepExpression } from './exprStep';
import { useVariableSuggest, varChoices } from './varSuggest';
import { useEditor, refKey, FIRST_FIELD } from '../store/editorStore';
import { activeStudio, useDoc } from '../store/docStore';
import { FORMS, type Row } from './forms';
import { Icon, type IconName } from './icons';
import { t, tName } from '../i18n';
import { openHelp } from '../help/context';
import { FEATURE_HELP } from '../help/pages';

export const FEATURE_ICONS: Record<FeatureType, IconName> = {
  sketch: 'sketch',
  extrude: 'extrude',
  revolve: 'revolve',
  sweep: 'sweep',
  loft: 'loft',
  thicken: 'thicken',
  fillet: 'fillet',
  chamfer: 'chamfer',
  shell: 'shell',
  draft: 'draft',
  deleteFace: 'deleteFace',
  moveFace: 'moveFace',
  replaceFace: 'replaceFace',
  offsetSurface: 'offsetSurface',
  enclose: 'enclose',
  hole: 'hole',
  linearPattern: 'linearPattern',
  circularPattern: 'circularPattern',
  curvePattern: 'curvePattern',
  mirror: 'mirror',
  rib: 'rib',
  wrap: 'wrap',
  boolean: 'boolean',
  split: 'split',
  transform: 'transform',
  deletePart: 'deletePart',
  plane: 'plane',
  variable: 'variable',
  import: 'import',
  derived: 'partStudio',
  helix: 'helix',
  mateConnector: 'mateConnector',
};

/** A feature's own icon: a solid extrude's arrow is coloured by what it does — adds (green), removes (red), intersects (purple). */
export function featureIcon(f: Feature): IconName {
  if (f.type === 'extrude' && f.params.bodyType !== 'surface') {
    if (f.params.op === 'add') return 'extrudeAdd';
    if (f.params.op === 'remove') return 'extrudeRemove';
    if (f.params.op === 'intersect') return 'extrudeIntersect';
  }
  return FEATURE_ICONS[f.type];
}

export function useRefLabel() {
  const build = useEditor((s) => s.build);
  const doc = useDoc((s) => s.doc);
  const studio = activeStudio(doc);
  return (r: SelRef): string => {
    const partName = (id: string) => build?.parts.find((p) => p.id === id)?.name ?? 'Part';
    const featName = (id: string) => {
      const f = studio?.features.find((x) => x.id === id);
      if (f) return tName(f.name);
      // a sketch brought by a Derived feature ("derivedId.sketchId"): "Derived 1 / Sketch 1"
      const sk = build?.sketches.find((s) => s.featureId === id);
      const owner = studio?.features.find((x) => x.id === id.split('.')[0]);
      return sk?.name && owner ? `${tName(owner.name)} / ${tName(sk.name)}` : '?';
    };
    switch (r.kind) {
      case 'face':
        return `${t('Face')} ${t('of')} ${partName(r.partId)}`;
      case 'edge':
        return `${t('Edge')} ${t('of')} ${partName(r.partId)}`;
      case 'vertex':
        return `${t('Vertex')} ${t('of')} ${partName(r.partId)}`;
      case 'part':
        return partName(r.partId);
      case 'region':
        return `${t('Sketch region')} (${featName(r.sketchId)})`;
      case 'sketchEntity': {
        const f = studio?.features.find((x) => x.id === r.sketchId);
        // a whole curve feature (helix)
        if (f && f.type !== 'sketch') return featName(r.sketchId);
        const e = f?.type === 'sketch' ? f.params.entities.find((x) => x.id === r.entityId) : build?.sketches.find((s) => s.featureId === r.sketchId)?.entities.find((x) => x.id === r.entityId);
        const kind = e?.type === 'point' ? t('Sketch point') : e?.type === 'line' ? t('Sketch line') : t('Sketch curve');
        return `${kind} (${featName(r.sketchId)})`;
      }
      case 'plane':
        return r.planeId === 'top' || r.planeId === 'front' || r.planeId === 'right'
          ? `${t(r.planeId[0].toUpperCase() + r.planeId.slice(1))} ${t('plane')}`
          : featName(r.planeId);
      case 'origin':
        return t('Origin');
    }
  };
}

/** Collapse many references with the same label (e.g. 13 regions of one sketch) into one chip. */
function groupRefs(refs: SelRef[], label: (r: SelRef) => string) {
  const groups = new Map<string, SelRef[]>();
  for (const r of refs) {
    const k = label(r);
    const g = groups.get(k);
    if (g) g.push(r);
    else groups.set(k, [r]);
  }
  const out: { ref: SelRef; text: string; all: SelRef[] }[] = [];
  for (const [text, all] of groups) {
    if (all.length > 2) out.push({ ref: all[0], text: `${text} × ${all.length}`, all });
    else for (const r of all) out.push({ ref: r, text, all: [r] });
  }
  return out;
}

function SelField({ fkey, type, refs }: { fkey: string; type: FeatureType; refs: SelRef[] }) {
  const active = useEditor((s) => s.activeField === fkey);
  const setActive = useEditor((s) => s.setActiveField);
  const update = useEditor((s) => s.updateDraft);
  const setListHover = useEditor((s) => s.setListHover);
  const label = useRefLabel();
  const spec = FIELD_SPECS[type]?.[fkey];
  return (
    <div className={'sel-field' + (active ? ' active' : '')} onClick={() => setActive(fkey)}>
      <div className="sel-label">{t(spec?.label ?? fkey)}</div>
      {refs.length === 0 && <div className="sel-empty">{active ? t('Select in the graphics area') : t('Click to select')}</div>}
      {groupRefs(refs, label).map(({ ref: r, text, all }) => (
        // the row under the pointer: its items (all of a group) stand out in the graphics area
        <div key={refKey(r)} className="sel-chip" onMouseEnter={() => setListHover(all)} onMouseLeave={() => setListHover(null)}>
          <span>{text}</span>
          <span
            className="x"
            onClick={(e) => {
              e.stopPropagation();
              setListHover(null);
              const drop = new Set(all.map(refKey));
              update((f) => keepRefs(f.params as unknown as Record<string, unknown>, fkey, (x) => !drop.has(refKey(x)), spec));
            }}
          >
            <Icon name="close" size={14} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function ExprInput({ value, unit, onChange }: { value: string; unit: 'length' | 'angle' | 'number'; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const doc = useDoc((s) => s.doc);
  const index = useEditor((s) => s.editing?.index ?? 0);
  useEffect(() => setText(value), [value]);
  const ctx = useMemo(() => {
    const studio = activeStudio(doc);
    return doc ? makeEvalContext(doc, collectVariables(configuredOf(studio), index, doc.units)) : null;
  }, [doc, index]);
  const v = ctx ? tryEvaluate(text, unit, ctx) : null;
  const title =
    v === null
      ? t('Invalid expression')
      : unit === 'length' && doc
        ? `${formatNumber(v / LENGTH_FACTOR[doc.units.length], 4)} ${doc.units.length}`
        : unit === 'angle'
          ? `${formatNumber((v * 180) / Math.PI, 4)} deg`
          : formatNumber(v, 4);
  // a step up / down (▲▼, the arrow keys): Shift ×10, Alt ×0.1; the latest text, so holding a button keeps counting
  const latest = useRef(text);
  latest.current = text;
  const step = (dir: 1 | -1, e: { shiftKey: boolean; altKey: boolean }) => {
    const nv = stepExpression(latest.current, dir, e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
    if (nv === null) return false;
    latest.current = nv;
    setText(nv);
    if (ctx && tryEvaluate(nv, unit, ctx) !== null) onChange(nv);
    return true;
  };
  const repeat = useRef<number | undefined>(undefined);
  const stop = () => window.clearTimeout(repeat.current);
  useEffect(() => stop, []);
  const press = (dir: 1 | -1) => (e: React.MouseEvent) => {
    // the field keeps the focus
    e.preventDefault();
    if (!step(dir, e)) return;
    const mods = { shiftKey: e.shiftKey, altKey: e.altKey };
    const again = (delay: number) => {
      repeat.current = window.setTimeout(() => step(dir, mods) && again(70), delay);
    };
    again(400);
  };
  const steppable = stepExpression(text, 1) !== null;
  // "#" lists the variables it can use
  const inputRef = useRef<HTMLInputElement>(null);
  useVariableSuggest(inputRef, () => (ctx && doc ? varChoices(ctx.vars, doc.units) : []));
  return (
    <span className="expr-field">
      <input
        ref={inputRef}
        type="text"
        className={v === null ? 'invalid' : ''}
        value={text}
        title={title}
        onChange={(e) => {
          setText(e.target.value);
          if (ctx && tryEvaluate(e.target.value, unit, ctx) !== null) onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          // nudge numeric values like Onshape
          if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && step(e.key === 'ArrowUp' ? 1 : -1, e)) e.preventDefault();
        }}
      />
      <span className={'expr-step' + (steppable ? '' : ' off')} title={steppable ? t('Step up / down (Shift ×10, Alt ×0.1)') : t('An expression is not stepped')}>
        <button type="button" tabIndex={-1} aria-label={t('Increase')} onMouseDown={press(1)} onMouseUp={stop} onMouseLeave={stop}>
          <svg width="8" height="5" viewBox="0 0 8 5">
            <path d="M1 4 L4 1 L7 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" tabIndex={-1} aria-label={t('Decrease')} onMouseDown={press(-1)} onMouseUp={stop} onMouseLeave={stop}>
          <svg width="8" height="5" viewBox="0 0 8 5">
            <path d="M1 1 L4 4 L7 1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </span>
    </span>
  );
}

function FeaturePicker({ value, onChange, upTo }: { value: string[]; onChange: (v: string[]) => void; upTo: number }) {
  const doc = useDoc((s) => s.doc);
  const studio = activeStudio(doc);
  const feats = (studio?.features ?? []).slice(0, upTo).filter((f) => ['extrude', 'revolve', 'sweep', 'loft', 'hole', 'thicken'].includes(f.type));
  if (!feats.length) return <div className="sel-empty">{t('No features to pattern')}</div>;
  return (
    <div className="feature-list-picker">
      {feats.map((f) => (
        <label key={f.id}>
          <input
            type="checkbox"
            checked={value.includes(f.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, f.id] : value.filter((x) => x !== f.id))}
          />
          <Icon name={featureIcon(f)} size={16} />
          {tName(f.name)}
        </label>
      ))}
    </div>
  );
}

/**
 * Derived, placed at a mate connector of this Part Studio: which point of the source lands there — its origin or
 * one of its mate connectors (Onshape Derived location).
 */
function DerivedPlaceFromField() {
  const update = useEditor((s) => s.updateDraft);
  const draft = useEditor((s) => s.editing?.draft);
  const doc = useDoc((s) => s.doc);
  // a version's Part Studio is there once its snapshot is loaded (a build follows)
  useEditor((s) => s.build);
  if (draft?.type !== 'derived' || !draft.params.placeTo?.length) return null;
  const source = doc && draft.params.studioId ? sourceStudio(doc, draft.params.studioId) : undefined;
  const connectors = (source?.features ?? []).filter((f) => f.type === 'mateConnector');
  const from = draft.params.placeFrom ?? '';
  return (
    <div className="fd-row">
      <label>{t('From the source')}</label>
      <div className="fd-control">
        <select
          value={from}
          onChange={(e) =>
            update((f) => {
              if (f.type !== 'derived') return;
              if (e.target.value) f.params.placeFrom = e.target.value;
              else delete f.params.placeFrom;
            })
          }
        >
          <option value="">{t('Its origin')}</option>
          {from && !connectors.some((c) => c.id === from) && <option value={from}>{t('(deleted)')}</option>}
          {connectors.map((c) => (
            <option key={c.id} value={c.id}>
              {tName(c.name)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * Derived: the source — another Part Studio of the document (not one that uses this one: a cycle), or a Part Studio
 * of a saved version of this document or another one — and which of its parts and sketches to bring in (all parts
 * by default). They are listed from the source's build.
 */
function DerivedSourceField() {
  const update = useEditor((s) => s.updateDraft);
  const draft = useEditor((s) => s.editing?.draft);
  const doc = useDoc((s) => s.doc);
  const studio = activeStudio(doc);
  const studioId = draft?.type === 'derived' ? draft.params.studioId : '';
  const versionId = parseVersionStudio(studioId)?.versionId ?? '';
  const [contents, setContents] = useState<SourceContents | null>(null);
  // documents with versions to derive from; the chosen version's Part Studios (null: loading, []: not available)
  const [versioned, setVersioned] = useState<VersionedDocument[]>([]);
  const [versionStudios, setVersionStudios] = useState<PartStudioTab[] | null>(null);
  const parts = contents?.parts ?? null;
  const options = doc && studio ? derivableStudios(doc, studio.id) : [];
  // the first possible source to start with
  useEffect(() => {
    if (draft?.type === 'derived' && !draft.params.studioId && options[0])
      update((f) => {
        if (f.type === 'derived') f.params.studioId = options[0].id;
      });
  }, [draft?.type, studioId, options[0]?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    if (doc) void derivableVersions(doc.id, doc.name).then((list) => live && setVersioned(list), () => {});
    return () => {
      live = false;
    };
  }, [doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    setVersionStudios(versionId ? null : []);
    if (versionId) void versionDocument(versionId).then((snap) => live && setVersionStudios(snap ? snapshotStudios(snap) : []));
    return () => {
      live = false;
    };
  }, [versionId]);
  const configuration = draft?.type === 'derived' ? draft.params.configuration : undefined;
  const loading = !!versionId && versionStudios === null;
  const source = doc && studioId && !loading ? sourceStudio(doc, studioId) : undefined;
  // the source's parts and sketches, from its build (in the configuration chosen for it)
  useEffect(() => {
    let live = true;
    setContents(null);
    if (!doc || !source) return;
    void sourceContents(doc, derivedSourceKey({ studioId, configuration })).then(
      (c) => live && setContents(c),
      () => live && setContents({ parts: [], sketches: [] }),
    );
    return () => {
      live = false;
    };
  }, [doc, studioId, loading, JSON.stringify(configuration)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!draft || draft.type !== 'derived' || !studio) return null;
  const chosen = draft.params.parts;
  const noParts = !!draft.params.noParts;
  const chosenSketches = draft.params.sketches ?? [];
  const gone = !!studioId && !loading && !source;
  // Part Studios of the chosen source: this document's, or the version's
  const studioOptions = versionId ? (versionStudios ?? []).map((s) => ({ id: versionStudioId(s.id, versionId), name: s.name })) : options;
  const chooseStudio = (id: string) =>
    update((f) => {
      if (f.type !== 'derived') return;
      f.params.studioId = id;
      f.params.parts = [];
      delete f.params.noParts;
      delete f.params.sketches;
      delete f.params.placeFrom;
      delete f.params.configuration;
    });
  const chooseVersion = async (v: string) => {
    if (!v) return chooseStudio(options[0]?.id ?? '');
    const snap = await versionDocument(v);
    const first = snap ? snapshotStudios(snap)[0] : undefined;
    // the Part Studio of the same tab in that version, if it has one
    const same = snap && snapshotStudios(snap).find((s) => s.id === parseVersionStudio(studioId)?.tabId || s.id === studioId);
    chooseStudio(versionStudioId((same ?? first)?.id ?? '', v));
  };
  const knownVersion = versioned.some((d) => d.versions.some((v) => v.id === versionId));
  // ids: those parts; none: all of them; null: no parts at all (only sketches)
  const setChosen = (ids: string[] | null) =>
    update((f) => {
      if (f.type !== 'derived') return;
      f.params.parts = ids ?? [];
      if (ids) delete f.params.noParts;
      else f.params.noParts = true;
    });
  const setSketches = (ids: string[]) =>
    update((f) => {
      if (f.type !== 'derived') return;
      if (ids.length) f.params.sketches = ids;
      else delete f.params.sketches;
    });
  const partOn = (id: string) => !noParts && (!chosen.length || chosen.includes(id));
  return (
    <>
      {(versioned.length > 0 || versionId) && (
        // Onshape: the current state of this document, or a version — of this document or of another one
        <div className="fd-row">
          <label>{t('Source')}</label>
          <div className="fd-control">
            <select value={versionId} onChange={(e) => void chooseVersion(e.target.value)}>
              <option value="">{t('This document (current)')}</option>
              {versionId && !knownVersion && <option value={versionId}>{t('(deleted version)')}</option>}
              {versioned.map((d) => (
                <optgroup key={d.docId} label={d.docId === doc?.id ? t('Versions of this document') : d.name}>
                  {d.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {d.docId === doc?.id ? v.name : `${d.name} — ${v.name}`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="fd-row">
        <label>{t('Part Studio')}</label>
        <div className="fd-control">
          {studioOptions.length || gone ? (
            <select value={studioId} onChange={(e) => chooseStudio(e.target.value)}>
              {gone && <option value={studioId}>{t('(deleted)')}</option>}
              {studioOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : loading ? (
            <span className="sel-empty">{t('Building the source…')}</span>
          ) : (
            <span className="sel-empty">{versionId ? t('The version has no Part Studio') : t('No other Part Studio to derive from')}</span>
          )}
        </div>
      </div>
      {source?.configuration?.length ? (
        // its configuration (Onshape): an input left as in the source follows the option chosen there
        <div className="fd-section">
          <div className="sel-label">{t('Configuration')}</div>
          <ConfigurationFields
            studio={source}
            value={configuration}
            onChange={(c) =>
              update((f) => {
                if (f.type !== 'derived') return;
                if (c) f.params.configuration = c;
                else delete f.params.configuration;
              })
            }
          />
        </div>
      ) : null}
      {studioId && !gone && (
        <div className="fd-section">
          <div className="sel-label">{t('Parts')}</div>
          <div className="feature-list-picker">
            <label>
              {/* unchecked: no parts (only sketches) */}
              <input type="checkbox" checked={!noParts && !chosen.length} onChange={(e) => setChosen(e.target.checked ? [] : null)} />
              {t('All parts')}
            </label>
            {parts === null && <div className="sel-empty">{t('Building the source…')}</div>}
            {parts?.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={partOn(p.id)}
                  onChange={(e) => {
                    const now = parts.filter((x) => partOn(x.id)).map((x) => x.id);
                    const next = e.target.checked ? [...now, p.id] : now.filter((x) => x !== p.id);
                    // every part — all of them (also those the source makes later); none — only sketches
                    setChosen(next.length === parts.length ? [] : next.length ? next : null);
                  }}
                />
                <Icon name="partItem" size={16} />
                {p.name}
              </label>
            ))}
            {/* chosen parts the source no longer has */}
            {parts && chosen.filter((id) => !parts.some((p) => p.id === id)).map((id) => (
              <label key={id} className="gone">
                <input type="checkbox" checked onChange={() => setChosen(chosen.filter((x) => x !== id))} />
                <Icon name="warning" size={16} />
                {t('A part that is gone')}
              </label>
            ))}
          </div>
        </div>
      )}
      {studioId && !gone && (contents?.sketches.length || chosenSketches.length) ? (
        // Onshape: sketches of the source come in too, their regions to extrude, their curves to use
        <div className="fd-section">
          <div className="sel-label">{t('Sketches')}</div>
          <div className="feature-list-picker">
            {contents?.sketches.map((s) => (
              <label key={s.id}>
                <input
                  type="checkbox"
                  checked={chosenSketches.includes(s.id)}
                  onChange={(e) => setSketches(e.target.checked ? [...chosenSketches, s.id] : chosenSketches.filter((x) => x !== s.id))}
                />
                <Icon name="sketch" size={16} />
                {tName(s.name)}
              </label>
            ))}
            {contents &&
              chosenSketches
                .filter((id) => !contents.sketches.some((s) => s.id === id))
                .map((id) => (
                  <label key={id} className="gone">
                    <input type="checkbox" checked onChange={() => setSketches(chosenSketches.filter((x) => x !== id))} />
                    <Icon name="warning" size={16} />
                    {t('A sketch that is gone')}
                  </label>
                ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * Hole: Standard (Onshape) — custom (its own diameters) or ISO: clearance or tapped, the size, the fit of a clearance
 * hole or the pitch of a tapped one; the sizes they give are shown (the fields of the diameters are not). A new size
 * starts the depths as Onshape does: threaded 2 d deep, drilled a little deeper.
 */
function HoleStandardField() {
  const update = useEditor((s) => s.updateDraft);
  const draft = useEditor((s) => s.editing?.draft);
  const doc = useDoc((s) => s.doc);
  if (draft?.type !== 'hole' || !doc) return null;
  const p = draft.params;
  const standard = p.standard === 'iso' || p.standard === 'ansi' ? p.standard : null;
  const iso = !!standard;
  const size = p.size ?? standardDefaultSize(standard ?? 'iso');
  const tapped = p.holeType === 'tapped';
  const unit = doc.units.length;
  const mm = (v: number) => `${formatNumber(v / LENGTH_FACTOR[unit], 4)} ${unit}`;
  const set = (fn: (q: Draft<HoleParams>) => void) =>
    update((f) => {
      if (f.type === 'hole') fn(f.params);
    });
  // a new size or type: the depths it starts with
  const depthsFor = (q: Draft<HoleParams>) => {
    const s = q.standard === 'ansi' ? 'ansi' : 'iso';
    const d = standardDefaultDepths(s, q.size ?? standardDefaultSize(s), q.holeType === 'tapped');
    q.depth = mm(d.depth);
    q.tapDepth = mm(d.tapDepth);
  };
  const std = standard ? standardHole({ ...p, size }) : null;
  const row = (label: string, control: React.ReactNode) => (
    <div className="fd-row">
      <label>{t(label)}</label>
      <div className="fd-control">{control}</div>
    </div>
  );
  return (
    <>
      {row(
        'Standard',
        <select
          value={standard ?? 'custom'}
          onChange={(e) =>
            set((q) => {
              const v = e.target.value;
              if (v === 'iso' || v === 'ansi') {
                // a size of the other standard does not carry over
                if (q.standard !== v) {
                  q.size = standardDefaultSize(v);
                  delete q.pitch;
                }
                q.standard = v;
                q.holeType ??= 'clearance';
                depthsFor(q);
              } else delete q.standard;
            })
          }
        >
          <option value="custom">{t('Custom')}</option>
          <option value="iso">ISO</option>
          <option value="ansi">ANSI</option>
        </select>,
      )}
      {iso && (
        <>
          {row(
            'Type',
            <select
              value={p.holeType ?? 'clearance'}
              onChange={(e) =>
                set((q) => {
                  q.holeType = e.target.value as 'clearance' | 'tapped';
                  delete q.pitch;
                  depthsFor(q);
                })
              }
            >
              <option value="clearance">{t('Clearance')}</option>
              <option value="tapped">{t('Tapped')}</option>
            </select>,
          )}
          {row(
            'Size',
            <select
              value={size}
              onChange={(e) =>
                set((q) => {
                  q.size = e.target.value;
                  delete q.pitch;
                  depthsFor(q);
                })
              }
            >
              {standardSizes(standard ?? 'iso').map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>,
          )}
          {tapped
            ? row(
                'Pitch',
                <select
                  value={p.pitch ?? ''}
                  onChange={(e) =>
                    set((q) => {
                      if (e.target.value) q.pitch = e.target.value;
                      else delete q.pitch;
                    })
                  }
                >
                  {standardPitches(standard ?? 'iso', size).map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.coarse ? `${x.label} (${t('coarse')})` : x.label}
                    </option>
                  ))}
                </select>,
              )
            : row(
                'Fit',
                <select
                  value={p.fit ?? 'normal'}
                  onChange={(e) =>
                    set((q) => {
                      q.fit = e.target.value as 'close' | 'normal' | 'loose' | 'nominal';
                    })
                  }
                >
                  <option value="close">{t('Close fit')}</option>
                  <option value="normal">{t('Normal fit')}</option>
                  <option value="loose">{t('Loose fit')}</option>
                  <option value="nominal">{t('No clearance (nominal)')}</option>
                </select>,
              )}
          {std && typeof std !== 'string' && (
            // the sizes the standard gives
            <div className="fd-hint">
              {tapped ? `${std.thread?.designation} · ${t('tap drill')} ⌀${mm(std.diameter)}` : `⌀${mm(std.diameter)}`}
              {(p.style === 'counterbore' || p.style === 'counterdrill') && ` · ${t('counterbore')} ⌀${mm(std.cboreDiameter)} ↧${mm(std.cboreDepth)}`}
              {p.style === 'countersink' && ` · ${t('countersink')} ⌀${mm(std.csinkDiameter)} × ${std.csinkAngle}°`}
              {p.style === 'counterdrill' && ` · ${t('countersink')} ⌀${mm(std.counterdrill.diameter)} × ${std.counterdrill.angle}°`}
            </div>
          )}
        </>
      )}
    </>
  );
}

/** Variable fillet: a radius for each chosen vertex (empty — the fillet's radius); hovering a row lights its vertex. */
function VertexRadiiField() {
  const update = useEditor((s) => s.updateDraft);
  const draft = useEditor((s) => s.editing?.draft);
  const setListHover = useEditor((s) => s.setListHover);
  if (draft?.type !== 'fillet') return null;
  const p = draft.params;
  const vertices = p.vertices ?? [];
  if (!vertices.length) return <div className="fd-hint">{t('Pick vertices of the edges to give them radii of their own')}</div>;
  return (
    <>
      {vertices.map((v, i) => (
        <div key={refKey(v)} className="fd-row" onMouseEnter={() => setListHover([v])} onMouseLeave={() => setListHover(null)}>
          <label>{`${t('Vertex')} ${i + 1}`}</label>
          <div className="fd-control">
            <ExprInput
              value={p.vertexRadii?.[i] || p.radius}
              unit="length"
              onChange={(val) =>
                update((f) => {
                  if (f.type !== 'fillet') return;
                  const radii = vertices.map((_, j) => f.params.vertexRadii?.[j] ?? '');
                  radii[i] = val;
                  f.params.vertexRadii = radii;
                })
              }
            />
          </div>
        </div>
      ))}
    </>
  );
}

/** Variable fillet: for each point on an edge, its position along the edge (0…1) and radius; hovering lights the edge. */
function EdgePointsField() {
  const update = useEditor((s) => s.updateDraft);
  const draft = useEditor((s) => s.editing?.draft);
  const setListHover = useEditor((s) => s.setListHover);
  if (draft?.type !== 'fillet') return null;
  const p = draft.params;
  const edges = p.pointEdges ?? [];
  if (!edges.length) return <div className="fd-hint">{t('Pick edges to put a point with a radius of its own inside them')}</div>;
  const set = (key: 'pointPositions' | 'pointRadii', i: number, val: string) =>
    update((f) => {
      if (f.type !== 'fillet') return;
      const list = edges.map((_, j) => f.params[key]?.[j] ?? '');
      list[i] = val;
      f.params[key] = list;
    });
  return (
    <>
      {edges.map((e, i) => (
        <div key={refKey(e)} onMouseEnter={() => setListHover([e])} onMouseLeave={() => setListHover(null)}>
          <div className="fd-row">
            <label>{`${t('Point')} ${i + 1}: ${t('position')}`}</label>
            <div className="fd-control">
              <ExprInput value={p.pointPositions?.[i] || '0.5'} unit="number" onChange={(val) => set('pointPositions', i, val)} />
            </div>
          </div>
          <div className="fd-row">
            <label>{`${t('Point')} ${i + 1}: ${t('radius')}`}</label>
            <div className="fd-control">
              <ExprInput value={p.pointRadii?.[i] || p.radius} unit="length" onChange={(val) => set('pointRadii', i, val)} />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function FileField() {
  const update = useEditor((s) => s.updateDraft);
  const draft = useEditor((s) => s.editing?.draft);
  const ref = useRef<HTMLInputElement>(null);
  if (!draft || draft.type !== 'import') return null;
  return (
    <div className="fd-row">
      <label>{t('File')}</label>
      <div className="fd-control">
        <button className="btn small" onClick={() => ref.current?.click()}>
          <Icon name="upload" size={14} /> {draft.params.fileName || 'STEP / STL…'}
        </button>
        <input
          ref={ref}
          type="file"
          accept=".step,.stp,.stl"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const buf = new Uint8Array(await file.arrayBuffer());
            let bin = '';
            for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
            const data = btoa(bin);
            const format = /\.stl$/i.test(file.name) ? 'stl' : 'step';
            update((f) => {
              if (f.type !== 'import') return;
              f.params.fileName = file.name;
              f.params.format = format;
              f.params.data = data;
              f.name = file.name.replace(/\.[^.]+$/, '');
            });
          }}
        />
      </div>
    </div>
  );
}

export function FeatureDialog() {
  const editing = useEditor((s) => s.editing);
  const preview = useEditor((s) => s.build?.preview);
  const building = useEditor((s) => s.building);
  const commit = useEditor((s) => s.commitEditing);
  const cancel = useEditor((s) => s.cancelEditing);
  const update = useEditor((s) => s.updateDraft);
  const studio = useDoc((s) => activeStudio(s.doc));
  // the dialog closed (or another one opened) with the pointer over one of its rows: that row no longer lights up
  const openId = editing?.featureId;
  useEffect(() => () => void (useEditor.getState().hoverList && useEditor.getState().setListHover(null)), [openId]);
  if (!editing || editing.draft.type === 'sketch') return null;
  const draft = editing.draft;
  // parameters set by the configuration: what is typed goes to the chosen configuration's cell
  const configured = studio ? configuredParams(studio, draft.id) : new Map<string, ConfigInput>();
  const configMark = (key: string) => {
    const input = configured.get(key);
    return input && studio ? (
      <span className="cfg-mark" title={`${t('Set by the configuration')} «${inputName(studio.features, input)}»: ${chosenLabel(studio.features, input, studio.configChoice)}`}>
        <Icon name="layers" size={13} />
      </span>
    ) : null;
  };
  const p = draft.params as unknown as Record<string, unknown>;
  const rows = FORMS[draft.type] ?? [];
  // Don't nag with "select …" errors before the user picked anything in the first field.
  const first = FIRST_FIELD[draft.type];
  const hasInput = !first || ((p[first] as unknown[] | undefined)?.length ?? 0) > 0;
  /** The selection fields shown with parameters `q` (of a "merge" row — its parts). */
  const selKeys = (q: Record<string, unknown>) =>
    rows.flatMap((r) => (r.when && !r.when(q) ? [] : r.kind === 'sel' ? [r.key] : r.kind === 'merge' && !q.mergeAll ? ['parts'] : []));
  const set = (key: string, v: unknown) => {
    const before = selKeys(p);
    update((f: Draft<Feature>) => {
      (f.params as unknown as Record<string, unknown>)[key] = v;
    });
    // a choice that shows an empty selection field ("Up to face", "Merge with all" off …) makes it active, ready for a click
    const next = { ...p, [key]: v };
    const shown = selKeys(next).find((k) => !before.includes(k) && !(next[k] as unknown[] | undefined)?.length);
    if (shown) useEditor.getState().setActiveField(shown);
  };

  const renderRow = (row: Row, i: number) => {
    if (row.when && !row.when(p)) return null;
    switch (row.kind) {
      case 'segmented':
        return (
          <div key={i} className="segmented">
            {row.options.map(([v, label]) => (
              <button key={v} className={(p[row.key] ?? row.options[0][0]) === v ? 'on' : ''} onClick={() => set(row.key, v)}>
                {t(label)}
              </button>
            ))}
          </div>
        );
      case 'select':
        return (
          <div key={i} className="fd-row">
            <label>{t(row.label)}</label>
            <div className="fd-control">
              <select value={String(p[row.key])} onChange={(e) => set(row.key, e.target.value)}>
                {row.options.map(([v, label]) => (
                  <option key={v} value={v}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        );
      case 'sel':
        return <SelField key={i} fkey={row.key} type={draft.type} refs={(p[row.key] as SelRef[]) ?? []} />;
      case 'expr':
        return (
          <div key={i} className="fd-row">
            <label>
              {t(row.label)}
              {configMark(row.key)}
            </label>
            <div className="fd-control">
              <ExprInput
                value={String(p[row.key] ?? '')}
                unit={row.unitKey ? (({ length: 'length', angle: 'angle', number: 'number', any: 'number' } as const)[String(p[row.unitKey] ?? 'any') as 'length'] ?? 'number') : row.unit}
                onChange={(v) => set(row.key, v)}
              />
              {row.flipKey && (
                <button
                  className={'icon-btn' + (p[row.flipKey] ? ' active' : '')}
                  title={t('Opposite direction')}
                  onClick={() => set(row.flipKey!, !p[row.flipKey!])}
                >
                  <Icon name="flip" size={18} />
                </button>
              )}
            </div>
          </div>
        );
      case 'check':
        return (
          <label key={i} className="fd-check">
            <input type="checkbox" checked={p[row.key] === undefined ? !!row.unsetOn : !!p[row.key]} onChange={(e) => set(row.key, e.target.checked)} />
            {t(row.label)}
            {configMark(row.key)}
          </label>
        );
      case 'flip':
        return (
          <div key={i} className="fd-row">
            <label>{t(row.label)}</label>
            <div className="fd-control">
              <button className={'icon-btn' + (p[row.key] ? ' active' : '')} onClick={() => set(row.key, !p[row.key])}>
                <Icon name="flip" size={18} />
              </button>
            </div>
          </div>
        );
      case 'text':
        return (
          <div key={i} className="fd-row">
            <label>{t(row.label)}</label>
            <div className="fd-control">
              {draft.type === 'variable' && row.key === 'name' && <span style={{ color: 'var(--text-2)', fontWeight: 600 }}>#</span>}
              <input
                type="text"
                value={String(p[row.key] ?? '')}
                onChange={(e) => set(row.key, draft.type === 'variable' && row.key === 'name' ? e.target.value.replace(/[^A-Za-z0-9_]/g, '') : e.target.value)}
              />
            </div>
          </div>
        );
      case 'features':
        return (
          <div key={i} className="fd-section">
            <div className="sel-label">{t(row.label)}</div>
            <FeaturePicker value={(p[row.key] as string[]) ?? []} onChange={(v) => set(row.key, v)} upTo={editing.index} />
          </div>
        );
      case 'merge':
        return (
          <div key={i} className="fd-section">
            <label className="fd-check">
              <input type="checkbox" checked={!!p.mergeAll} onChange={(e) => set('mergeAll', e.target.checked)} />
              {t('Merge with all')}
            </label>
            {!p.mergeAll && <SelField fkey="parts" type={draft.type} refs={(p.parts as SelRef[]) ?? []} />}
          </div>
        );
      case 'file':
        return <FileField key={i} />;
      case 'derivedSource':
        return <DerivedSourceField key={i} />;
      case 'derivedPlaceFrom':
        return <DerivedPlaceFromField key={i} />;
      case 'holeStandard':
        return <HoleStandardField key={i} />;
      case 'vertexRadii':
        return <VertexRadiiField key={i} />;
      case 'edgePoints':
        return <EdgePointsField key={i} />;
      case 'section':
        return (
          <div key={i} className="sel-label">
            {t(row.label)}
          </div>
        );
    }
  };

  return (
    <div
      className="feature-dialog"
      onKeyDown={(e) => {
        e.stopPropagation();
        // F1 anywhere in the dialog: help for this feature
        if (e.key === 'F1') {
          e.preventDefault();
          openHelp(FEATURE_HELP[draft.type]);
          return;
        }
        // Onshape: Enter in any field accepts the feature, Esc cancels it
        if (e.nativeEvent.isComposing || (e.target as HTMLElement).tagName !== 'INPUT') return;
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') cancel();
      }}
    >
      <div className="fd-header">
        <Icon name={featureIcon(draft)} size={20} />
        <input
          className="fd-title"
          value={tName(draft.name)}
          onChange={(e) =>
            update((f) => {
              f.name = e.target.value;
            })
          }
        />
        {building && <div className="spinner" />}
        <button className="icon-btn fd-help" title={`${t('Help')} (F1)`} onClick={() => openHelp(FEATURE_HELP[draft.type])}>
          <Icon name="help" size={18} />
        </button>
        <button className="icon-btn fd-ok" title={`${t('Accept')} (Enter)`} onClick={() => commit()}>
          <Icon name="check" size={20} />
        </button>
        <button className="icon-btn fd-cancel" title={`${t('Cancel')} (Esc)`} onClick={() => cancel()}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="fd-body">
        {rows.map(renderRow)}
        {preview && !preview.status.ok && hasInput && <div className="fd-error">{t(preview.status.error ?? '')}</div>}
        {preview?.status.ok && preview.status.warning && <div className="fd-warning">{t(preview.status.warning)}</div>}
        <div style={{ color: 'var(--text-3)', fontSize: 11 }}>{t(FEATURE_LABELS[draft.type])}</div>
      </div>
    </div>
  );
}
