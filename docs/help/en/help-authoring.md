# About this help

This page is for those who extend the WebCAD help along with new features.

## Where the files are {#files}

| Path | Contents |
|---|---|
| `docs/help/toc.json` | Table of contents: sections, pages and subpages, their titles in each language, icons, languages and the fallback order. |
| `docs/help/<language>/<id>.md` | Page text. The file name is the page ID, the same in all languages. |
| `docs/help/images/` | Screenshots and pictures (shared by all languages). |
| `docs/help/images/<lang>/` | Interface screenshots in that language: a file with the same name replaces the shared one on that language's pages. |
| `src/help/` | The help viewer, Markdown parsing, search, context help (`pages.ts`). |

The help is bundled into the build and works offline; pages are loaded as you open them.

## Adding a page {#add-page}

1. Create `docs/help/ru/<id>.md` and `docs/help/en/<id>.md`; the first line is the `# …` title.
2. Add the page to `docs/help/toc.json`: `{ "id": "<id>", "icon": "<icon>", "title": { "ru": "…", "en": "…" } }`. Subpages are set with the `"children"` field.
3. For a feature or sketch tool, register the page in `src/help/pages.ts` — then the **?** button in the dialog and the `F1` key open it.
4. Run `npx vitest run src/help` — the test checks that the page exists in all required languages and that links, anchors and images resolve.

## Adding a language {#add-language}

1. Create a `docs/help/<code>/` folder (for example, `de`) and translate the pages. Untranslated pages are automatically shown in English, then in Russian, with a notice.
2. Add the language to `"languages"` in `toc.json`, and `"<code>": "…"` titles to sections and pages.
3. Optionally, translate the labels of the viewer itself in `src/help/strings.ts`.

## Markup {#markup}

- Link to another page by its ID: `[Line](sketch-line)`, with an anchor — `[Tangent arc](sketch-arc#tangent)`.
- Stable section anchors are set in the heading: `## Options {#options}` — the same in all languages.
- Write keys as code: `` `Shift+S` `` — the help shows them as keys.
- Callouts: a blockquote line that starts with a bold word: `> **Tip.** …`, `> **Note.** …`, `> **Limitation.** …`.
- Tables, numbered and bulleted lists, code blocks — as in regular Markdown.
- A screenshot with numbered callouts is a `figure` block: the image path, a caption, the width and "number, X %, Y %, tooltip" lines. The callouts are drawn over the image, so one screenshot works for all languages:

````text
```figure
image: ../images/interface-part-studio.jpg
alt: Part Studio window
1 50% 1.8% Top bar
```
````

Keep screenshots small (up to ~1600 px wide, JPEG or PNG), cropped to the area you need.

## Choosing an illustration {#illustrations}

- **Dialog or panel:** capture the real application, keeping the relevant controls and a little context. Field text should be readable without zooming the entire page.
- **Geometric rule:** use an SVG diagram so lines, symbols and dimensions remain sharp when enlarged. Label it as a diagram when it simplifies solver behavior.
- **Geometry changes:** show before and after in one diagram or a two-image table at comparable scales.
- **Click order:** number the points and explain every number in the caption. Keep instruction steps together, without large images between individual steps.
- **Caption and alt text:** explain what to notice and which parameters were used. Remove selections or hover highlights unrelated to the example.
- **Short reference:** an image is optional. A table of formats, shortcuts or actions is often more useful than a decorative screenshot.

Shared images live in `images/`; translate captions and `alt` text on each page. Interface screenshots show text in the interface language, so they have language copies: an English page uses `images/en/<name>` when that file exists and the shared `images/<name>` otherwise. The link in the text stays the same — `../images/<name>`. English screenshots are taken in a clean browser profile with the English interface, in the same frames as the shared ones. Click an illustration to open it at full size. After replacing a screenshot, check every numbered marker's coordinates and both language versions in the browser.
