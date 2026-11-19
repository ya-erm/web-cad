import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { Icon } from './icons';
import { canMoveCloudItem, cloudFolderRows, type CloudItem } from '../cloud/folders';
import type { LibraryFolder } from '../store/library';

export function CloudMoveDialog({
  folders,
  documents,
  item,
  name,
  onSave,
  onClose,
}: {
  folders: LibraryFolder[];
  documents: { id: string; folderId: string }[];
  item: CloudItem;
  name: string;
  onSave: (target: string) => Promise<void>;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const valid = (id: string) => canMoveCloudItem(folders, documents, item, id);
  const move = async (id: string) => {
    if (busy || !valid(id)) return;
    setBusy(true);
    setError('');
    try {
      await onSave(id);
      onClose();
    } catch (e) {
      setError(t((e as Error).message));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy, onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={() => !busy && onClose()}>
      <div
        className="modal move-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('Move to folder…')}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          {t('Move')} «{name}»
        </div>
        <div className="modal-body">
          <div className="move-tree">
            {[
              { id: '', name: t('My documents'), depth: 0 },
              ...cloudFolderRows(folders).map(({ folder, depth }) => ({ ...folder, depth: depth + 1 })),
            ].map((f) => (
              <button
                key={f.id}
                className={'move-row' + (target === f.id ? ' on' : '')}
                style={{ paddingLeft: 8 + f.depth * 16 }}
                disabled={busy || !valid(f.id)}
                onClick={() => setTarget(f.id)}
                onDoubleClick={() => void move(f.id)}
              >
                <Icon name="folder" size={16} />
                <span className="docs-nav-name">{f.name}</span>
              </button>
            ))}
          </div>
          {error && (
            <div className="docs-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" disabled={busy} onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            className="btn primary"
            disabled={busy || target === null || !valid(target)}
            onClick={() => target !== null && void move(target)}
          >
            {t('Move')}
          </button>
        </div>
      </div>
    </div>
  );
}
