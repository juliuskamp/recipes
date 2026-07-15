# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Self-hosted bilingual (EN/DE) recipe site, statically generated and deployed to GitHub Pages. Recipes are JSON files in `recipes/`; `build.js` renders them into full HTML pages in `_site/`. **Everything is plain Node stdlib + vanilla JS — zero npm dependencies, no package.json.** Keep it that way: do not introduce bundlers, frameworks, template engines, npm packages, or runtime dependencies. (The gitignored `local/` folder may hold puppeteer-based dev tools on the user's machine; it is not part of the repo.)

## Commands

- **Build the site**: `node build.js` (fast, ~25ms) — or `node build.js --watch` to rebuild on change.
- **Run locally**: build (or watch), then serve `_site/` — the user tests via the VSCode **Five Server** extension pointed at `_site/`; do not suggest CLI commands for serving.
- **Validate recipes**: `node validate.js recipes/*.json`
- **Install git hooks** (one-time): `git config core.hooksPath .githooks`
- **Deploy**: push to `main` — `.github/workflows/deploy.yml` builds and deploys `_site/` to GitHub Pages (Pages must be set to "GitHub Actions" as source).
- **PDFs**: the in-app "Download PDF" / "Download all" buttons use the browser print engine (`@media print` rules in `css/main.css`). A headless CLI generator exists locally in gitignored `local/generate-pdf.js` (needs puppeteer).

## Architecture

### Static site generation (build.js)
`build.js` (zero-dependency Node) emits into `_site/` (gitignored):

- `index.html` — redirects to the preferred language (`localStorage` → `navigator.language`); also maps legacy SPA hash URLs (`#recipe/<id>[/<n>]`, `#search?...`) to the new pages.
- `<lang>/index.html` — index view, recipe cards grouped by meal type (cards are real `<a>` links).
- `<lang>/search/index.html` — search page; entries are embedded as JSON in the page and filtered client-side (`?q=&meal=&tags=` query params).
- `<lang>/recipe/<id>/index.html` — recipe page; variant *n* at `<lang>/recipe/<id>/<n>/`. Includes per-recipe `<title>` and OG meta tags.
- `<lang>/print.html` — fragment with all recipes; fetched and injected by the "download all as PDF" button.

Recipe IDs are **derived from filenames** (`recipes/<id>.json`); recipes are ordered alphabetically by ID. There is no `recipes/index.json` — the build globs the directory.

Crucially, the build loads the SAME modules the browser uses (`js/converter.js`, `js/scaler.js`, `js/parser.js`) via `vm`, so build-time rendering and client-side re-rendering share one code path and cannot drift.

### Client-side hydration (js/runtime.js)
Pages are baked at **default servings, metric units, page language**. Every measurement is a span carrying data attributes with the original values:

```html
<span class="measurement" data-amount="3" data-unit="tbsp" data-fixed="1">3 EL</span>
<span class="ingredient-amount" data-amount="200" data-unit="g">200 g</span>
```

`js/runtime.js` (loaded with `defer`, plus `converter.js` and `scaler.js`) re-renders those spans when the user changes servings or toggles metric/imperial — same pipeline as the build: scale (unless fixed/temperature) → convert → round step → format → translate unit. It also handles theme + language toggles (language switch is a link to the sibling page, preference saved to localStorage), cooking mode (injects checkboxes), the search page, and the print buttons. Settings live in the same localStorage keys as before: `recipe-lang`, `recipe-units`, `recipe-theme`. A tiny inline script in `<head>` applies the theme before first paint.

`js/parser.js` is build-only (not shipped); `js/app.js` no longer exists.

### Data model
A recipe has a base `language` (`"en"` or `"de"`) plus an optional `translations` object keyed by language code. Tags, meal types, and units are **always stored in English** in the JSON and translated at build time via `i18n.json`. Translated ingredient names are an **index-based array** that must match the length and order of the base `ingredients` array — `validate.js` enforces this. Both language pages are always generated; untranslated recipes show base-language content plus a "only available in …" badge.

`schema.json` is the single source of truth. `validate.js` is a minimal JSON Schema validator (Node stdlib only) that reads `schema.json` at runtime — do not hardcode validation rules that the schema can express. The build runs validation first and aborts on any error.

### Measurement template syntax
Instructions embed scalable measurements using `{{...}}`. `Parser.parseToken` handles the full syntax:

- `{{2 cups}}` — scale with servings, convert between metric/imperial, translate unit
- `{{4}}` — scale a bare number (e.g. "{{4}} eggs")
- `{{!12 tsp}}` — **fixed**: does NOT scale, but still converts and translates (leading `!`)
- `{{180 °C}}` — temperatures never scale (leading `!` has no effect), but still convert
- `{{6 round 1}}` — scale, then round to nearest step (e.g. whole patties)
- `{{5 g round 0.5}}` — combine unit, conversion, and rounding

### Display formatting
`Converter.formatAmount` rounds the third significant digit to the nearest 0 or 5 (e.g. 104→105, 236→235, 3.5→3.5), then renders clean fractions (½, ¼, ⅓, ⅔, ⅛, ¾, …) as Unicode characters. `tbsp` and `tsp` are in `noConvert` — they get translated (EL/TL) but are never converted to ml.

### Theming
Dark mode uses CSS custom properties under `:root[data-theme="dark"]`. The inline head script reads `prefers-color-scheme` as the default, the user choice is stored in localStorage, and `colorScheme` is set so native form controls match.

### i18n
`i18n.json` has `en` and `de` sections, each with `meal_types`, `tags`, `units`, and `ui` lookup tables. Lookup falls back to English, then to the raw key (the `en` section has no `units` table — English unit keys display as-is). When adding a new unit/tag/meal type, add it to both sections and to the enum in `schema.json`.

## Authoring recipes

When creating or editing a recipe:
1. Base language (`language` field) is whichever the original was written in. Add `translations` only if you want the other language supported.
2. Units, tags, and meal types must come from the enums in `schema.json` (English keys).
3. If a translation exists, its `ingredients` array MUST have the same length as the base `ingredients` array — it's index-based, not keyed by name.
4. Bump the `version` field on every modification — the pre-commit hook rejects modified recipes whose version didn't increase.
5. Ingredients may omit `amount` and `unit` (e.g. "salt to taste").

(No index file to update — the build discovers recipes from the filesystem.)

## Pre-commit hook (`.githooks/pre-commit`)
Runs `validate.js` on all recipes and checks version bumps on modified recipes. Install with `git config core.hooksPath .githooks`.

## Migration note
The site was converted from a client-rendered SPA (js/app.js + hash routing) to this SSG in July 2026. Parity was verified with a headless-Chrome diff of every page (recipes × languages × variants, scaled servings, imperial units, index, search — 108 checks) against the old implementation; the one-off verifier lives outside the repo in the user's `local/` folder.
