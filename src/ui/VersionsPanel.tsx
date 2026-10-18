// Versions and history (Onshape): the button in the top bar with its panel — make a version, open one for viewing,
// restore it — and the banner over a version being viewed.

import { useState } from 'react';
import type { DocumentVersion } from '../core/types';
import { nextVersionName } from '../core/versions';
import { useDoc } from '../store/docStore';
import { useEditor } from '../store/editorStore';
import { createVersion, deleteVersion, exitVersion, restoreVersion, useVersions, viewVersion } from '../store/versions';
import { Icon } from './icons';
import { getLang, t } from '../i18n';

const REASONS: Record<NonNullable<DocumentVersion['reason']>, string> = {
  open: 'When the document was opened',
  edit: 'While editing',
  restore: 'Before a version was restored',
};

const when = (time: number) => new Date(time).toLocaleString(getLang() === 'ru' ? 'ru-RU' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
/** A version by its name, an entry of the history by why it was saved. */
const title = (v: DocumentVersion) => (v.kind === 'version' ? v.name : t('Autosave'));

/** Whatever was being edited closes: the document changes under it. */
const resetEditor = () => useEditor.setState({ editing: null, sketch: null, selection: [], hover: null, activeField: null });

function NewVersionForm({ onDone }: { onDone: () => void }) {
  const versions = useVersions((s) => s.versions);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const create = async () => {
    await createVersion(name, description);
    onDone();
  };
  return (
    <div className="ver-form" onKeyDown={(e) => e.stopPropagation()}>
      <label>{t('Name')}</label>
      <input type="text" value={name} placeholder={nextVersionName(versions)} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
      <label>{t('Description')}</label>
      <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="ver-form-actions">
        <button className="btn small" onClick={onDone}>
          {t('Cancel')}
        </button>
        <button className="btn small primary" onClick={() => void create()}>
          {t('Create')}
        </button>
      </div>
    </div>
  );
}

function VersionsPanel({ onClose }: { onClose: () => void }) {
  const versions = useVersions((s) => s.versions);
  const viewing = useVersions((s) => s.viewing);
  const readOnly = useDoc((s) => s.readOnly);
  const [creating, setCreating] = useState(false);
  const [history, setHistory] = useState(true);
  /** A click on the trash asks once more. */
  const [deleting, setDeleting] = useState<string | null>(null);
  const shown = versions.filter((v) => history || v.kind === 'version');
  return (
    <div className="dropdown ver-panel" onMouseLeave={() => setDeleting(null)}>
      <div className="ver-head">
        <Icon name="history" size={16} />
        <span className="ver-head-title">{t('Versions and history')}</span>
        <span className="spacer" />
        <button className="icon-btn" title={t('Close')} onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {creating ? (
        <NewVersionForm onDone={() => setCreating(false)} />
      ) : (
        <div className="ver-actions">
          <button className="btn small primary" disabled={readOnly} title={readOnly ? t('Return to the workspace to make a version') : undefined} onClick={() => setCreating(true)}>
            <Icon name="plus" size={12} /> {t('Create version')}
          </button>
          <label className="fd-check">
            <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
            {t('Show history')}
          </label>
        </div>
      )}
      <div className="ver-list">
        {!shown.length && <div className="ver-empty">{t('No versions yet. A version is a snapshot of the document to come back to.')}</div>}
        {viewing && (
          <div className="ver-item ver-workspace" onClick={exitVersion}>
            <Icon name="edit" size={16} />
            <div className="ver-text">
              <b>{t('Workspace')}</b>
              <span>{t('Return to the workspace')}</span>
            </div>
          </div>
        )}
        {shown.map((v) => (
          <div key={v.id} className={'ver-item' + (v.kind === 'auto' ? ' auto' : '') + (viewing?.version.id === v.id ? ' viewing' : '')}>
            <Icon name={v.kind === 'version' ? 'star' : 'history'} size={16} />
            <div className="ver-text" title={t('Open for viewing')} onClick={() => void viewVersion(v.id).then((ok) => ok && resetEditor())}>
              <b>{title(v)}</b>
              <span>
                {when(v.created)}
                {v.reason ? ` · ${t(REASONS[v.reason])}` : ''}
              </span>
              {v.description && <span className="ver-desc">{v.description}</span>}
            </div>
            <div className="ver-buttons">
              <button className="icon-btn" title={t('Open for viewing')} onClick={() => void viewVersion(v.id).then((ok) => ok && resetEditor())}>
                <Icon name="eye" size={14} />
              </button>
              <button
                className="icon-btn"
                title={t('Restore this version')}
                onClick={() => {
                  resetEditor();
                  void restoreVersion(v.id);
                }}
              >
                <Icon name="rollback" size={14} />
              </button>
              {deleting === v.id ? (
                <button
                  className="btn small danger"
                  onClick={() => {
                    if (viewing?.version.id === v.id) exitVersion();
                    setDeleting(null);
                    void deleteVersion(v.id);
                  }}
                >
                  {t('Delete')}?
                </button>
              ) : (
                <button className="icon-btn" title={t('Delete')} onClick={() => setDeleting(v.id)}>
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The top bar's button: the number of versions; highlighted while one is viewed. */
export function VersionsButton() {
  const [open, setOpen] = useState(false);
  const count = useVersions((s) => s.versions.filter((v) => v.kind === 'version').length);
  const viewing = useVersions((s) => !!s.viewing);
  return (
    <div className="menu-wrap">
      <button className={'btn small ver-button' + (open || viewing ? ' active' : '')} title={t('Versions and history')} onClick={() => setOpen(!open)}>
        <Icon name="history" size={14} /> {t('Versions')}
        {count > 0 && <span className="ver-count">{count}</span>}
      </button>
      {open && <VersionsPanel onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Over a version being viewed: what it is, restore it, back to the workspace. */
export function VersionBanner() {
  const viewing = useVersions((s) => s.viewing);
  if (!viewing) return null;
  const v = viewing.version;
  return (
    <div className="version-banner">
      <Icon name="history" size={16} />
      <span>
        {t('Viewing')} <b>{title(v)}</b> · {when(v.created)} — {t('read only')}
      </span>
      <span className="spacer" />
      <button
        className="btn small"
        onClick={() => {
          resetEditor();
          void restoreVersion(v.id);
        }}
      >
        <Icon name="rollback" size={14} /> {t('Restore this version')}
      </button>
      <button
        className="btn small primary"
        onClick={() => {
          resetEditor();
          exitVersion();
        }}
      >
        {t('Return to the workspace')}
      </button>
    </div>
  );
}
