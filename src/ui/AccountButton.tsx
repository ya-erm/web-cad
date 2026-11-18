import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useDoc } from '../store/docStore';
import { Icon } from './icons';

const API = 'https://api.cad.ya-erm.ru';
type User = { id: string; displayName: string; email: string | null; avatarUrl: string | null };

export function AccountButton() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [loadedAvatar, setLoadedAvatar] = useState<string | null>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const requestEpoch = useRef(0);

  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.get('auth') === 'denied') setError('Sign-in was cancelled.');
    if (url.searchParams.has('auth')) {
      url.searchParams.delete('auth');
      history.replaceState(history.state, '', url);
    }
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || document.hidden) return;
      pending = true;
      const epoch = requestEpoch.current;
      try {
        const response = await fetch(`${API}/auth/session`, {
          credentials: 'include', cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        });
        if (!response.ok) throw new Error('Account unavailable');
        const result = await response.json();
        if (result.user !== null && (typeof result.user?.id !== 'string' || typeof result.user?.displayName !== 'string'
          || (result.user.email !== null && typeof result.user.email !== 'string')
          || (result.user.avatarUrl !== null && typeof result.user.avatarUrl !== 'string'))) {
          throw new Error('Invalid account response');
        }
        if (controller.signal.aborted || epoch !== requestEpoch.current) return;
        setUser(result.user);
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted && epoch === requestEpoch.current) setStatus('unavailable');
      } finally { pending = false; }
    };
    void refresh();
    const onRefresh = () => { void refresh(); };
    window.addEventListener('focus', onRefresh);
    window.addEventListener('online', onRefresh);
    document.addEventListener('visibilitychange', onRefresh);
    const timer = window.setInterval(onRefresh, 60 * 60 * 1000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', onRefresh);
      window.removeEventListener('online', onRefresh);
      document.removeEventListener('visibilitychange', onRefresh);
    };
  }, [retry]);

  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (menu.current && !menu.current.contains(e.target as Node)) menu.current.open = false;
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape' && menu.current) menu.current.open = false; };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape); };
  }, []);

  const signIn = async () => {
    setBusy(true);
    setError('');
    try {
      await useDoc.getState().flushSave();
      if (useDoc.getState().saveError) throw new Error('Save failed');
      location.assign(`${API}/auth/yandex/start`);
    } catch {
      setError('Save your changes before signing in.');
      setBusy(false);
    }
  };
  const signOut = async () => {
    requestEpoch.current += 1;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API}/auth/logout`, {
        method: 'POST', credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('Sign-out failed');
      setUser(null);
      window.dispatchEvent(new Event('webcad:account-changed'));
      setStatus('ready');
      if (menu.current) menu.current.open = false;
    } catch { setError('Could not sign out. Try again when online.'); }
    finally { requestEpoch.current += 1; setBusy(false); }
  };
  const avatar = typeof user?.avatarUrl === 'string' && user.avatarUrl.startsWith('https://avatars.yandex.net/get-yapic/') ? user.avatarUrl : null;
  return (
    <div className="account-control">
      {error && <span className="account-error" role="status" title={t(error)}>{t(error)}</span>}
      {user ? (
        <details className="account-menu" ref={menu}>
          <summary title={user.displayName} aria-label={user.displayName}>
            <span className="account-avatar account-initials" aria-hidden="true">
              {user.displayName.slice(0, 1).toUpperCase()}
              {avatar && <img src={avatar} alt="" className={loadedAvatar === avatar ? 'account-portrait loaded' : 'account-portrait'}
                referrerPolicy="no-referrer" onLoad={() => setLoadedAvatar(avatar)} onError={() => setLoadedAvatar(null)} />}
            </span>
          </summary>
          <div className="dropdown account-dropdown">
            <div className="account-name">{user.displayName}</div>
            {user.email && <div className="dropdown-label account-email">{user.email}</div>}
            <div className="dropdown-note">{t('Local autosave works offline. Cloud uploads are optional.')}</div>
            {status === 'unavailable' && <div className="dropdown-note">{t('Account unavailable. You can keep working offline.')}</div>}
            <button className="dropdown-item" disabled={busy} onClick={() => void signOut()}>{t('Sign out')}</button>
          </div>
        </details>
      ) : status === 'loading' ? (
        <span className="account-placeholder" role="status" aria-label={t('Checking account…')}>
          <span className="account-avatar account-initials" aria-hidden="true"><Icon name="account" size={16} /></span>
        </span>
      ) : status === 'unavailable' ? (
        <button className="btn small" title={t('Account unavailable. You can keep working offline.')} onClick={() => setRetry(n => n + 1)}>{t('Retry sign-in')}</button>
      ) : (
        <button className="btn small" disabled={busy} onClick={() => void signIn()}>
          <Icon name="account" size={16} />
          {t('Sign in with Yandex')}
        </button>
      )}
    </div>
  );
}
