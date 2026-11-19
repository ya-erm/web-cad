import { useEffect, useRef } from 'react';
import type { LibrarySourceConflict, LibrarySourceResolution } from '../store/librarySource';
import { t } from '../i18n';
import { Icon } from './icons';

export function LibrarySourceConflictDialog({ conflict, onChoose }: {
  conflict: LibrarySourceConflict;
  onChoose: (answer: LibrarySourceResolution) => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const choose = useRef(onChoose);
  choose.current = onChoose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); choose.current(null);
      } else if (event.key === 'Tab') {
        const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keys, true);
    return () => { document.removeEventListener('keydown', keys, true); previous?.focus({ preventScroll: true }); };
  }, []);
  return (
    <div className="modal-backdrop" onPointerDown={() => onChoose(null)}>
      <div className="modal library-source-dialog" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true"
        aria-label={t('File and library changes')} onPointerDown={(event) => event.stopPropagation()}>
        <h3><Icon name="copy" size={18} /> {t('File and library changes')}</h3>
        <p>{t(conflict.targetOpen ? 'The file has changed while the library copy is open.' : 'The file and its library copy have changed. Choose what to keep.')}</p>
        <dl><dt>{t('File')}</dt><dd>{conflict.sourceName}</dd><dt>{t('My documents')}</dt><dd>{conflict.targetName}</dd></dl>
        {conflict.targetOpen && <p>{t('The library copy is open. Close it before replacing it with the file.')}</p>}
        <p>{t('The source file stays unchanged. Replaced library content is kept in history.')}</p>
        <div className="library-source-actions">
          <button className="btn" onClick={() => onChoose('local')}>{t('Keep library copy')}</button>
          <button className="btn" disabled={conflict.targetOpen} onClick={() => onChoose('incoming')}>{t('Use file version')}</button>
          <button className="btn primary" onClick={() => onChoose('both')}>{t('Keep both')}</button>
          <button className="btn" onClick={() => onChoose(null)}>{t('Cancel')}</button>
        </div>
      </div>
    </div>
  );
}
