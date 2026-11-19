import { useRef } from 'react';
import { t } from '../i18n';
import { useEditor, type ContextMenuItem } from '../store/editorStore';
import { Icon } from './icons';

/** The card whose menu is open: its "⋯" then closes the menu instead of opening it again. */
let menuOwner: string | null = null;

/** The menu of a card: at the cursor on a right click, under the "⋯" button when it is clicked. */
export function openCardMenu(e: React.MouseEvent, owner: string, items: ContextMenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  let { clientX: x, clientY: y } = e;
  if (e.type !== 'contextmenu') {
    const r = e.currentTarget.getBoundingClientRect();
    x = r.left;
    y = r.bottom + 4;
  }
  menuOwner = owner;
  useEditor.setState({ contextMenu: { x, y, items } });
}

/** The "⋯" button in the corner of a card (on hover): the same menu as a right click on the card. */
export function CardMenuButton({ owner, items }: { owner: string; items: () => ContextMenuItem[] }) {
  /** The press already closed this card's open menu (a press outside the menu closes it). */
  const wasOpen = useRef(false);
  return (
    <div className="doc-actions" onClick={(e) => e.stopPropagation()}>
      <button
        className="icon-btn"
        title={t('Actions')}
        onPointerDown={() => (wasOpen.current = !!useEditor.getState().contextMenu && menuOwner === owner)}
        onClick={(e) => !wasOpen.current && openCardMenu(e, owner, items())}
      >
        <Icon name="more" size={14} />
      </button>
    </div>
  );
}

/** The name being edited on a card (a file's or a subfolder's): Enter or leaving the field keeps it, Esc does not. */
export function RenameInput({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  return (
    <input
      className="tree-rename"
      autoFocus
      defaultValue={value}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => {
        const v = e.target.value.trim();
        onDone(v && v !== value ? v : null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') onDone(null);
      }}
    />
  );
}

/**
 * A subfolder card's picture (`shown` — pictures of its documents, see folderPreview): the only document's picture
 * whole, a 2 × 2 grid of up to four, three and "+N" for the rest; an empty folder — its icon.
 */
export function FolderPreview({ shown, more }: { shown: (string | undefined)[]; more: number }) {
  const pic = (src: string | undefined, size: number) =>
    src ? <img src={src} alt="" draggable={false} /> : <Icon name="partStudio" size={size} />;
  if (shown.length === 0)
    return (
      <div className="doc-thumb">
        <Icon name="folder" size={40} />
      </div>
    );
  if (shown.length === 1) return <div className="doc-thumb">{pic(shown[0], 40)}</div>;
  return (
    <div className="doc-thumb folder-mosaic">
      {shown.map((src, i) => (
        <div key={i} className="folder-tile">
          {pic(src, 22)}
        </div>
      ))}
      {more > 0 && <div className="folder-tile folder-more">+{more}</div>}
    </div>
  );
}
