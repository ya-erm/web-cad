// Error boundaries: an error while drawing a part of the interface no longer leaves a white page. The whole app —
// a page that says so (the documents are saved in the browser), a panel or dialog — a card in its place; the rest of
// the editor keeps working.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Icon } from './icons';
import { t } from '../i18n';
import { APP_VERSION } from './version';

interface Props {
  /** `app` — the whole page; `panel` — a part of the editor (its card in its place). */
  scope: 'app' | 'panel';
  /** What failed, for the details ("Feature dialog"…). */
  name?: string;
  /** Before trying again: close what failed (a dialog, a menu), so that it is not drawn the same way at once. */
  onReset?: () => void;
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string;
  copied: boolean;
}

/** The details of an error to send: the version, where, the message and both stacks. */
function errorDetails(error: Error, name: string | undefined, componentStack: string): string {
  return [`WebCAD ${APP_VERSION}${name ? ` — ${name}` : ''}`, `${error.name}: ${error.message}`, error.stack ?? '', componentStack ? `Components:${componentStack}` : '', navigator.userAgent]
    .filter(Boolean)
    .join('\n');
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '', copied: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)), copied: false };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`WebCAD: ${this.props.name ?? 'the interface'} failed`, error, info.componentStack);
    this.setState({ stack: info.componentStack ?? '' });
  }

  private retry = () => {
    this.props.onReset?.();
    this.setState({ error: null, stack: '', copied: false });
  };

  private copy = () => {
    const { error, stack } = this.state;
    if (!error) return;
    void navigator.clipboard?.writeText(errorDetails(error, this.props.name, stack)).then(() => this.setState({ copied: true }));
  };

  render() {
    const { error, copied } = this.state;
    if (!error) return this.props.children;
    const copyButton = (
      <button className="btn small" onClick={this.copy}>
        <Icon name={copied ? 'check' : 'copy'} size={14} /> {t(copied ? 'Copied' : 'Copy details')}
      </button>
    );
    if (this.props.scope === 'panel')
      return (
        <div className="error-card" role="alert">
          <div className="error-card-title">
            <Icon name="warning" size={16} /> {t('This part of the interface failed')}
          </div>
          <div className="error-card-message">{error.message}</div>
          <div className="error-card-actions">
            <button className="btn small primary" onClick={this.retry}>
              {t(this.props.onReset ? 'Close and try again' : 'Try again')}
            </button>
            {copyButton}
          </div>
        </div>
      );
    return (
      <div className="error-page" role="alert">
        <div className="error-page-box">
          <div className="error-page-title">
            <Icon name="warning" size={22} /> {t('Something went wrong')}
          </div>
          <p>{t('The documents are saved in the browser: reload the page to go on. If it happens again, copy the details and report the error.')}</p>
          <pre className="error-page-message">{error.message}</pre>
          <div className="error-card-actions">
            <button className="btn primary" onClick={() => location.reload()}>
              {t('Reload the page')}
            </button>
            <button
              className="btn"
              onClick={() => {
                location.hash = '';
                location.reload();
              }}
            >
              {t('Back to documents')}
            </button>
            {copyButton}
          </div>
        </div>
      </div>
    );
  }
}
