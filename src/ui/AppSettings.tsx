// Settings that are not a document's: how the view rotates and the interface language (both kept in this
// browser), installing the app. The editor's Settings menu shows them under the document's units; the documents page
// has them alone.

import { useState } from 'react';
import { setRotationMode, useEditor } from '../store/editorStore';
import { getLang, setLang, t } from '../i18n';
import { openHelp } from '../help/context';
import { installApp, useInstallState } from '../pwa';
import { Icon } from './icons';

/** Rotation, Language and App items of a settings dropdown. */
export function AppSettingsItems() {
  const rotationMode = useEditor((s) => s.rotationMode);
  const install = useInstallState();
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
      <div className="dropdown-sep" />
      <div className="dropdown-label">{t('App')}</div>
      {install === 'installed' ? (
        <div className="dropdown-item disabled">
          <span className="menu-icon">✓</span>
          {t('Installed as an app')}
        </div>
      ) : install === 'available' ? (
        <div className="dropdown-item" title={t('Opens in its own window and works offline')} onClick={() => void installApp()}>
          <span className="menu-icon">
            <Icon name="download" size={14} />
          </span>
          {t('Install app…')}
        </div>
      ) : (
        <div className="dropdown-item" onClick={() => openHelp('offline#install')}>
          <span className="menu-icon">?</span>
          {t('How to install the app')}
        </div>
      )}
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
