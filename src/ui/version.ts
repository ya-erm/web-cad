// The app's version (vite.config.ts → __APP_VERSION__): semver from package.json, the commit's date, time and hash.

import { t } from '../i18n';

/** None: a dev server started before the version was defined — restart it. */
const BUILD: { version?: string; date: string; time?: string; sha: string } = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : { date: '', sha: '' };

/** "v0.14.0" ("v0.14.0 · dev" on the development server). */
export const APP_VERSION = [BUILD.version ? `v${BUILD.version}` : '', import.meta.env.DEV ? 'dev' : ''].filter(Boolean).join(' · ');

/** The tooltip: "App version: 0.14.0", then the commit's date and time and its hash (and the development server). */
export function appVersionTitle(): string {
  const when = [BUILD.date, BUILD.time].filter(Boolean).join(' ');
  const build = [when, BUILD.sha ? `${t('commit')} ${BUILD.sha}` : ''].filter(Boolean).join(', ');
  return `${t('App version')}: ${BUILD.version ?? '?'}\n${build}${import.meta.env.DEV ? `\n${t('development server')}` : ''}`;
}
