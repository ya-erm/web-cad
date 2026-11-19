import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';
import { Icon, type IconName } from './icons';

export interface VersionAction {
  id: string;
  label: string;
  icon: IconName;
  disabled?: boolean;
  danger?: boolean;
  keepOpen?: boolean;
  run: () => void;
}

/** Hover on a mouse, click on touch, or open and navigate with the keyboard. */
export function VersionActionMenu({
  label,
  open,
  onOpen,
  onClose,
  actions,
}: {
  label: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  actions: VersionAction[];
}) {
  const button = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const mode = useRef<'hover' | 'click' | 'keyboard' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const id = useId();
  const focusLast = useRef(false);
  const cancelLeave = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const close = (focus = false) => {
    cancelLeave();
    onClose();
    if (focus) button.current?.focus();
  };
  const leave = () => {
    if (mode.current !== 'hover') return;
    cancelLeave();
    timer.current = setTimeout(() => {
      timer.current = null;
      onClose();
    }, 150);
  };
  const show = (next: 'hover' | 'click' | 'keyboard', last = false) => {
    focusLast.current = last;
    cancelLeave();
    mode.current = next;
    onOpen();
  };
  const focusItem = (last = false) => {
    const items = menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    if (items?.length) items[last ? items.length - 1 : 0].focus();
  };
  useLayoutEffect(() => {
    if (!open) {
      cancelLeave();
      mode.current = null;
      return;
    }
    const anchor = button.current!.getBoundingClientRect(),
      popup = menu.current!.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(anchor.right - popup.width, window.innerWidth - popup.width - 8)),
      top: Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - popup.height - 8)),
    });
    if (mode.current === 'keyboard') focusItem(focusLast.current);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) close();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    const scrolled = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) close();
    };
    const resized = () => close();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', resized);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', resized);
    };
  }, [open]);
  useEffect(() => cancelLeave, []);
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <>
      <button
        ref={button}
        className="icon-btn ver-more"
        aria-label={`${t('Actions')} — ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') {
            cancelLeave();
            if (!open) show('hover');
          }
        }}
        onPointerLeave={leave}
        onClick={(event) => {
          if (event.detail === 0) {
            show('keyboard');
            if (open) focusItem();
          } else if (!open || mode.current === 'hover') show('click');
          else close();
        }}
        onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
          event.preventDefault();
          show('keyboard', event.key === 'ArrowUp');
          if (open) focusItem(event.key === 'ArrowUp');
        }}
      >
        <Icon name="more" size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label={`${t('Actions')} — ${label}`}
            className="context-menu version-action-menu"
            style={position}
            onKeyDown={navigate}
            onPointerEnter={cancelLeave}
            onPointerLeave={leave}
          >
            {actions.map((action) => (
              <button
                key={action.id}
                role="menuitem"
                tabIndex={-1}
                className={'dropdown-item' + (action.danger ? ' danger' : '')}
                disabled={action.disabled}
                onClick={() => {
                  mode.current = 'click';
                  if (!action.keepOpen) close(true);
                  action.run();
                }}
              >
                <Icon name={action.icon} size={16} />
                <span>{action.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
