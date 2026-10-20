// Settings that are not a document's: how the view rotates and the interface language (both kept in this
// browser). The editor's Settings menu shows them under the document's units; the documents page has them alone.

import { useState } from 'react';
import { setRotationMode, useEditor } from '../store/editorStore';
import { getLang, setLang, t } from '../i18n';
import { Icon } from './icons';

/** Rotation and Language items of a settings dropdown. */
export function AppSettingsItems() {
  const rotationMode = useEditor((s) => s.rotationMode);
  return (
    <>
      <div className="dropdown-label">{t('Rotation')}</div>
      {(
        [
          ['free', 'Free rotation'],
          ['turntable', 'Turntable (Z up)'],
        ] as const
      ).map(([mode, label]) => (
        <div key={mode} className="dropdown-item" onClick={() => setRotationMode(mode)}>
          <span className="menu-icon">{rotationMode === mode ? '✓' : ''}</span>
          {t(label)}
        </div>
      ))}
      <div className="dropdown-sep" />
      <div className="dropdown-label">{t('Language')}</div>
      {(['ru', 'en'] as const).map((l) => (
        <div
          key={l}
          className="dropdown-item"
          onClick={() => {
            setLang(l);
            location.reload();
          }}
        >
          <span className="menu-icon">{getLang() === l ? '✓' : ''}</span>
          {l === 'ru' ? 'Русский' : 'English'}
        </div>
      ))}
    </>
  );
}

/** RU | EN in a header (as in the help); the choice is kept and the page reloads in it. */
export function LangSwitch() {
  const cur = getLang();
  return (
    <div className="help-langs" role="group" aria-label={t('Language')} title={t('Language')}>
      {(['ru', 'en'] as const).map((l) => (
        <button
          key={l}
          className={l === cur ? 'on' : ''}
          lang={l}
          title={l === 'ru' ? 'Русский' : 'English'}
          onClick={() => {
            if (l === cur) return;
            setLang(l);
            location.reload();
          }}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/** The Settings button of the documents page. */
export function AppSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu-wrap">
      <button className={'btn small' + (open ? ' active' : '')} onClick={() => setOpen(!open)}>
        <Icon name="gear" size={14} /> {t('Settings')}
      </button>
      {open && (
        <div className="dropdown" onMouseLeave={() => setOpen(false)}>
          <AppSettingsItems />
        </div>
      )}
    </div>
  );
}
