import { useEffect, useState } from 'react';
import { useEditor } from '../store/editorStore';
import { t } from '../i18n';

const BUILD_MESSAGES = [
  'The idea is taking shape…',
  'Turning lines into volume…',
  'Every face has its place…',
  'Putting the geometry together…',
  'Connecting edges and surfaces…',
] as const;

/** The bar counts completed operations, not elapsed time. */
export function BuildStatus() {
  const ready = useEditor((s) => s.kernelReady);
  const progress = useEditor((s) => s.buildProgress);
  const [message, setMessage] = useState(0);
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => setMessage((i) => (i + 1) % BUILD_MESSAGES.length), 4000);
    return () => clearInterval(timer);
  }, [ready]);
  const total = progress?.total ?? 0;
  const completed = progress?.stage === 'meshing' ? total : Math.max(0, (progress?.current ?? 0) - 1);
  const detail = progress
    ? [progress.studio, progress.stage === 'meshing' ? t('Preparing display…') : progress.total ? `${t('Operation')} ${progress.current}/${progress.total}` : '', progress.featureName].filter(Boolean).join(' · ')
    : '';
  const title = ready ? `${t('Building the model')}: ${t(BUILD_MESSAGES[message])}` : t('Loading geometry kernel…');
  return (
    <div className="build-status" role="status" aria-live="polite" title={[title, detail].filter(Boolean).join('\n')}>
      <div className="loading-spinner" aria-hidden="true" />
      <div className="build-status-text">
        <div aria-live="off">{title}</div>
        {detail && <div className="build-status-detail">{detail}</div>}
        <progress className="build-progress" aria-label={t('Completed operations')} aria-valuetext={detail || title} max={total || 1} value={ready && total ? completed : undefined} />
      </div>
    </div>
  );
}
