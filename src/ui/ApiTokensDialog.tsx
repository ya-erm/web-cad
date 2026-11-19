import { useEffect, useRef, useState } from 'react';
import { useCloudSync } from '../cloud/syncState';
import { t } from '../i18n';
import { documentTime } from './documentTime';
import { Icon } from './icons';

const API = 'https://api.cad.ya-erm.ru';
interface TokenRecord {
  id: string;
  name: string;
  scopes: string[];
  createdAt: number;
  expiresAt: number;
}
function validRecord(value: unknown): value is TokenRecord {
  const record = value as TokenRecord | null;
  return (
    !!record &&
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    Array.isArray(record.scopes) &&
    record.scopes.every((scope) => scope === 'read' || scope === 'write') &&
    Number.isFinite(record.createdAt) &&
    Number.isFinite(record.expiresAt)
  );
}

/** The plaintext credential exists only in this mounted dialog, never in persisted state. */
export function ApiTokensDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [records, setRecords] = useState<TokenRecord[]>([]);
  const [name, setName] = useState('');
  const [write, setWrite] = useState(true);
  const [days, setDays] = useState(90);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const working = useRef(false);
  const close = () => {
    setCreated(null);
    controller.current?.abort();
    epoch.current++;
    onClose();
  };
  const allowed = (request: number) =>
    request === epoch.current && !controller.current?.signal.aborted && useCloudSync.getState().accountId === userId;
  const request = async (path: string, body?: unknown): Promise<Record<string, unknown>> => {
    const generation = epoch.current;
    if (!controller.current || !allowed(generation)) throw new Error('account_changed');
    const response = await fetch(API + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([controller.current.signal, AbortSignal.timeout(20000)]),
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw new Error('request_failed');
    const result = await response.json();
    if (!allowed(generation) || result?.userId !== userId) throw new Error('account_changed');
    return result;
  };
  useEffect(() => {
    const generation = ++epoch.current;
    controller.current = new AbortController();
    const unsubscribe = useCloudSync.subscribe((state, previous) => {
      if (state.accountId === previous.accountId) return;
      epoch.current++;
      controller.current?.abort();
      setCreated(null);
      onClose();
    });
    void request('/auth/tokens')
      .then((result) => {
        if (!allowed(generation)) return;
        if (!Array.isArray(result.tokens) || !result.tokens.every(validRecord)) throw new Error('invalid_response');
        setRecords(result.tokens);
      })
      .catch(() => {
        if (allowed(generation)) setError(t('Could not load API tokens. Close this window and try again.'));
      })
      .finally(() => {
        if (allowed(generation)) setBusy(false);
      });
    dialog.current?.focus();
    return () => {
      epoch.current++;
      controller.current?.abort();
      unsubscribe();
    };
  }, [userId]);
  useEffect(() => {
    if (created) copyButton.current?.focus();
  }, [created]);
  useEffect(() => {
    if (!busy && !created && document.activeElement === dialog.current) nameInput.current?.focus();
  }, [busy, created]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = [
        ...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? []),
      ];
      const first = items[0],
        last = items.at(-1);
      if (!dialog.current?.contains(document.activeElement)) {
        event.preventDefault();
        first?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  });
  const create = async () => {
    if (working.current || busy || !name.trim() || activeCount >= 20) return;
    working.current = true;
    const generation = epoch.current;
    setBusy(true);
    setError('');
    setCreated(null);
    setCopied(false);
    setConfirm(null);
    try {
      const result = await request('/auth/tokens', {
        name: name.trim(),
        scopes: write ? ['read', 'write'] : ['read'],
        expiresInDays: days,
        expectedUserId: userId,
      });
      if (!allowed(generation)) return;
      if (typeof result.token !== 'string' || !result.token || !validRecord(result.record)) throw new Error('invalid_response');
      setCreated(result.token);
      setRecords((current) => [result.record as TokenRecord, ...current]);
      setName('');
    } catch {
      if (allowed(generation)) setError(t('Could not create an API token. Check your connection and token limit.'));
    } finally {
      working.current = false;
      if (allowed(generation)) setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    if (working.current || busy) return;
    working.current = true;
    const generation = epoch.current;
    setBusy(true);
    setError('');
    try {
      const result = await request('/auth/tokens/revoke', { id, expectedUserId: userId });
      if (!allowed(generation)) return;
      if (result.ok !== true) throw new Error('invalid_response');
      setRecords((current) => current.filter((record) => record.id !== id));
      setConfirm(null);
      // A revoked credential should not remain displayed, including the newly created one.
      setCreated(null);
      setCopied(false);
    } catch {
      if (allowed(generation)) setError(t('Could not revoke the API token. Try again.'));
    } finally {
      working.current = false;
      if (allowed(generation)) setBusy(false);
    }
  };
  const copy = async () => {
    if (!created) return;
    const generation = epoch.current;
    try {
      await navigator.clipboard.writeText(created);
      if (allowed(generation)) setCopied(true);
    } catch {
      if (allowed(generation)) setError(t('Could not copy the token. Select it and copy manually.'));
    }
  };
  const activeCount = records.filter((record) => record.expiresAt > Date.now()).length;
  return (
    <div className="modal-backdrop api-tokens-backdrop">
      <div className="modal api-tokens-dialog" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('API tokens')}>
        <div className="modal-header">
          <Icon name="lock" size={18} />
          {t('API tokens')}
          <span className="spacer" />
          <button className="icon-btn" aria-label={t('Close')} onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">
          <p className="docs-hint">
            {t('Tokens let tools access your cloud documents without a browser sign-in. Up to 20 active tokens.')}
          </p>
          {created && (
            <div className="api-token-secret" role="status">
              <strong>{t('Copy this token now')}</strong>
              <p>{t('Store it securely. After closing this window, it cannot be shown again.')}</p>
              <div className="api-token-copy">
                <input
                  type="password"
                  readOnly
                  value={created}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={t('New API token')}
                  onFocus={(event) => event.target.select()}
                />
                <button className="btn" ref={copyButton} onClick={() => void copy()}>
                  <Icon name={copied ? 'check' : 'copy'} size={14} />
                  {t(copied ? 'Copied' : 'Copy token')}
                </button>
              </div>
            </div>
          )}
          <form
            className="api-token-form"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label>
              {t('Token name')}
              <input
                ref={nameInput}
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                placeholder={t('For example: laptop agent')}
              />
            </label>
            <div className="api-token-fields">
              <label>
                {t('Permissions')}
                <select
                  aria-label={t('Permissions')}
                  value={write ? 'write' : 'read'}
                  disabled={busy}
                  onChange={(event) => setWrite(event.target.value === 'write')}
                >
                  <option value="write">{t('Read and write')}</option>
                  <option value="read">{t('Read only')}</option>
                </select>
              </label>
              <label>
                {t('Valid for')}
                <select aria-label={t('Valid for')} value={days} disabled={busy} onChange={(event) => setDays(Number(event.target.value))}>
                  {[30, 90, 180, 365].map((value) => (
                    <option key={value} value={value}>
                      {value} {t('days')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button className="btn primary" disabled={busy || activeCount >= 20 || !name.trim()}>
              {t('Create token')}
            </button>
          </form>
          {error && (
            <div className="docs-error" role="alert">
              {error}
            </div>
          )}
          <div className="api-token-list" aria-label={t('Existing API tokens')}>
            <strong>{t('Existing API tokens')}</strong>
            {busy && (
              <span className="docs-hint" role="status">
                {t('Please wait…')}
              </span>
            )}
            {!busy && !records.length && <span className="docs-hint">{t('No API tokens yet.')}</span>}
            {records.map((record) => (
              <div className="api-token-record" key={record.id}>
                <div className="api-token-record-meta">
                  <strong>{record.name}</strong>
                  <span>{t(record.scopes.includes('write') ? 'Read and write' : 'Read only')}</span>
                  <small>
                    {t('Created')}: {documentTime(record.createdAt)}
                  </small>
                  <small>
                    {t('Expires')}: {documentTime(record.expiresAt)}
                  </small>
                </div>
                <div className="api-token-record-actions">
                  {confirm === record.id ? (
                    <>
                      <span>{t('Revoke this token?')}</span>
                      <button className="btn small danger" disabled={busy} onClick={() => void revoke(record.id)}>
                        {t('Confirm revoke')}
                      </button>
                      <button className="btn small" disabled={busy} onClick={() => setConfirm(null)}>
                        {t('Cancel')}
                      </button>
                    </>
                  ) : (
                    <button className="btn small" disabled={busy} onClick={() => setConfirm(record.id)}>
                      <Icon name="trash" size={13} />
                      {t('Revoke')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={close}>
            {t('Close')}
          </button>
        </div>
      </div>
    </div>
  );
}
