// Interface strings of the help viewer, per help language (English is the fallback).
// To add a language, add its strings here (optional) and its pages under docs/help/<lang>/.

const STRINGS = {
  en: {
    help: 'Help',
    search: 'Search help',
    searchResults: 'Search results',
    nothingFound: 'Nothing found. Try another word or a shorter query.',
    searching: 'Searching…',
    previous: 'Previous',
    next: 'Next',
    contents: 'Contents',
    loading: 'Loading…',
    pageNotFound: 'Page not found',
    openApp: 'Open WebCAD',
    language: 'Help language',
    notTranslated: 'This page has not been translated yet. Showing the version in: {lang}.',
    imageMissing: 'Image not found',
    imageOpen: 'Open illustration at full size (new tab)',
  },
  ru: {
    help: 'Справка',
    search: 'Поиск по справке',
    searchResults: 'Результаты поиска',
    nothingFound: 'Ничего не найдено. Попробуйте другое слово или запрос короче.',
    searching: 'Поиск…',
    previous: 'Назад',
    next: 'Далее',
    contents: 'Содержание',
    loading: 'Загрузка…',
    pageNotFound: 'Страница не найдена',
    openApp: 'Открыть WebCAD',
    language: 'Язык справки',
    notTranslated: 'Эта страница ещё не переведена. Показана версия на языке: {lang}.',
    imageMissing: 'Изображение не найдено',
    imageOpen: 'Открыть иллюстрацию в полном размере (новая вкладка)',
  },
} satisfies Record<string, Record<string, string>>;

export type HelpStrings = (typeof STRINGS)['en'];

export function helpStrings(lang: string): HelpStrings {
  return { ...STRINGS.en, ...((STRINGS as Record<string, Partial<HelpStrings>>)[lang] ?? {}) };
}
