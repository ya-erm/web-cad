// The app's version (vite.config.ts → __APP_VERSION__): semver from package.json, the commit's date and short hash.

import { t } from '../i18n';

/** None: a dev server started before the version was defined — restart it. */
const BUILD: { version?: string; date: string; sha: string } = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : { date: '', sha: '' };

/** "v0.14.0" ("v0.14.0 · dev" on the development server). */
export const APP_VERSION = [BUILD.version ? `v${BUILD.version}` : '', import.meta.env.DEV ? 'dev' : ''].filter(Boolean).join(' · ');

/** The tooltip: the version with its commit's date and hash. */
export function appVersionTitle(): string {
  const build = [BUILD.date, BUILD.sha].filter(Boolean).join(', ');
  return `${t('App version')}: ${BUILD.version ?? '?'} (${build})${import.meta.env.DEV ? ` — ${t('development server')}` : ''}`;
}
