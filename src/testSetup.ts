// Vitest setup: the tests are written for the Russian interface (the app's language follows the
// browser, and Node reports its own locale).

import { setLang } from './i18n';

setLang('ru');
