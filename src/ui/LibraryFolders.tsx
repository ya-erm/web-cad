import { useState } from 'react';
import { t } from '../i18n';
import { folderTrail, type LibraryFolder } from '../store/library';
import { Icon } from './icons';

/** Shared folder structure for browser and cloud libraries. IDs survive renames and moves. */
export function LibraryPath({
  folders,
  current,
  label,
  onGo,
}: {
  folders: LibraryFolder[];
  current: string;
  label: string;
  onGo: (id: string) => void;
}) {
  const trail = folderTrail(folders, current);
  return (
    <nav className="library-path" aria-label={t('Folder path')}>
      {[{ id: '', name: label }, ...trail].map((f) => (
        <span key={f.id}>
          <button className="btn small" onClick={() => onGo(f.id)} aria-current={current === f.id ? 'location' : undefined}>
            {f.name}
          </button>
          {f.id !== current && <Icon name="chevronRight" size={12} />}
        </span>
      ))}
    </nav>
  );
}

export function LibraryFolderGrid({
  folders,
  current,
  onGo,
  onEdit,
}: {
  folders: LibraryFolder[];
  current: string;
  onGo: (id: string) => void;
  onEdit: (folder: LibraryFolder) => void;
}) {
  return (
    <div className="folder-grid">
      {folders
        .filter((f) => f.parentId === current)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => (
          <div key={f.id} className="doc-card library-folder-card">
            <button className="library-folder-open" onClick={() => onGo(f.id)}>
              <Icon name="folder" size={32} />
              <span>{f.name}</span>
            </button>
            <button className="icon-btn" title={t('Folder settings')} onClick={() => onEdit(f)}>
              <Icon name="more" size={16} />
            </button>
          </div>
        ))}
    </div>
  );
}

export function LibraryFolderDialog({
  folders,
  initial,
  parent,
  onSave,
  onDelete,
  onClose,
}: {
  folders: LibraryFolder[];
  initial?: LibraryFolder;
  parent: string;
  onSave: (name: string, parentId: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [target, setTarget] = useState(initial?.parentId ?? parent);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t(initial ? 'Folder settings' : 'New folder')}
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && name.trim()) void act(() => onSave(name.trim(), target));
        }}
      >
        <div className="modal-header">{t(initial ? 'Folder settings' : 'New folder')}</div>
        <div className="modal-body library-form">
          <label>
            {t('Name')}
            <input autoFocus value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            {t('Parent folder')}
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{t('Library root')}</option>
              {folders
                .filter((f) => !initial || !folderTrail(folders, f.id).some((p) => p.id === initial.id))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {folderTrail(folders, f.id)
                      .map((p) => p.name)
                      .join(' / ')}
                  </option>
                ))}
            </select>
          </label>
          {error && (
            <div className="docs-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          {onDelete && (
            <button type="button" className="btn danger" disabled={busy} onClick={() => void act(onDelete)}>
              {t('Delete empty folder')}
            </button>
          )}
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn primary" disabled={busy || !name.trim()}>
            {t('Save')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function LibraryMoveDialog({
  folders,
  onSave,
  onClose,
}: {
  folders: LibraryFolder[];
  onSave: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [target, setTarget] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={t('Move to folder…')}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          try {
            await onSave(target);
            onClose();
          } catch (e) {
            setError(t((e as Error).message));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="modal-header">{t('Move to folder…')}</div>
        <div className="modal-body library-form">
          <select aria-label={t('Destination folder')} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t('Library root')}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {folderTrail(folders, f.id)
                  .map((p) => p.name)
                  .join(' / ')}
              </option>
            ))}
          </select>
          {error && (
            <div className="docs-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" type="button" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className="btn primary" disabled={busy}>
            {t('Move')}
          </button>
        </div>
      </form>
    </div>
  );
}
