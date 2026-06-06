# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Self-hosted bilingual (EN/DE) recipe app. Static site deployed to GitHub Pages — pure vanilla HTML/CSS/JS with **no build step and no npm/node dependencies at runtime**. Recipes are JSON files in `recipes/`, validated by a Python-stdlib-only schema validator. Keep it that way: do not introduce bundlers, frameworks, or runtime dependencies.

## Commands

- **Run locally**: the user tests via the VSCode **Five Server** extension (a Live Server fork) — do not suggest CLI commands for serving. There is no dev/build/watch command.
- **Validate a recipe**: `python3 validate.py recipes/<name>.json`
- **Install git hooks** (one-time): `git config core.hooksPath .githooks`
- **Release / generate PDFs**: create a GitHub release. `.github/workflows/generate-pdfs.yml` diffs recipes against the previous tag, renders each changed recipe via Puppeteer, and uploads PDFs to the release.

## Architecture

### Frontend (three-view SPA)
`index.html` loads four scripts in order: `converter.js` → `scaler.js` → `parser.js` → `app.js`. Each defines a single IIFE module (`Converter`, `Scaler`, `Parser`, `App`) on the global scope — they depend on load order, no imports.

`js/app.js` is the only stateful module. It manages three views via hash routing:
- `#` → index view (recipes grouped by meal type)
- `#search?q=...&meal=...&tags=...` → flat filtered list
- `#recipe/<id>` → recipe detail

Recipe IDs are **derived from filenames** at load time (`data.id = id`) — there is no `id` field in the schema.

### Data model
A recipe has a base `language` (`"en"` or `"de"`) plus an optional `translations` object keyed by language code. Tags, meal types, and units are **always stored in English** in the JSON and translated in the frontend via `i18n.json`. Translated ingredient names are stored as an **index-based array** that must match the length and order of the base `ingredients` array — `validate.py` enforces this.

`schema.json` is the single source of truth. `validate.py` is a minimal JSON Schema validator (Python stdlib only) that reads `schema.json` at runtime — do not hardcode validation rules in the Python.

`recipes/index.json` is just a flat array of recipe IDs. The pre-commit hook enforces that it stays in sync with the files in `recipes/`.

### Measurement template syntax
Instructions embed scalable measurements using `{{...}}`. `Parser.parseToken` handles the full syntax:

- `{{2 cups}}` — scale with servings, convert between metric/imperial, translate unit
- `{{4}}` — scale a bare number (e.g. "{{4}} eggs")
- `{{!180 °C}}` — **fixed**: does NOT scale, but still converts and translates (leading `!`)
- `{{6 round 1}}` — scale, then round to nearest step (e.g. whole patties)
- `{{5 g round 0.5}}` — combine unit, conversion, and rounding

The pipeline in `processInstruction` is: scale (unless fixed) → convert units → apply `round` step → `Converter.formatAmount`.

### Display formatting
`Converter.formatAmount` rounds the third significant digit to the nearest 0 or 5 (e.g. 104→105, 236→235, 3.5→3.5), then renders clean fractions (½, ¼, ⅓, ⅔, ⅛, ⅜, ⅝, ⅞, ¾) as Unicode characters. `tbsp` and `tsp` are in `noConvert` — they get translated (EL/TL) but are never converted to ml.

### Theming
Dark mode uses CSS custom properties under `:root[data-theme="dark"]`. `app.js` reads `prefers-color-scheme` as the default, stores the user choice in localStorage, and also sets `document.documentElement.style.colorScheme` so native form controls (checkboxes, number inputs) match.

### i18n
`i18n.json` has `en` and `de` sections, each with `meal_types`, `tags`, `units`, and `ui` lookup tables. `App.t(category, key)` falls back to English if a key is missing in the active language. When adding a new unit/tag/meal type, add it to both `en` and `de` sections and to the enum in `schema.json`.

## Authoring recipes

When creating or editing a recipe:
1. Base language (`language` field) is whichever the original was written in. Add `translations` only if you want the other language supported.
2. Units, tags, and meal types must come from the enums in `schema.json` (English keys).
3. If a translation exists, its `ingredients` array MUST have the same length as the base `ingredients` array — it's index-based, not keyed by name.
4. Bump the `version` field on every modification — the pre-commit hook rejects modified recipes whose version didn't increase.
5. Add the new filename (without `.json`) to `recipes/index.json`.
6. Ingredients may omit `amount` and `unit` (e.g. "salt to taste").

## Pre-commit hook (`.githooks/pre-commit`)
Runs `validate.py` on all recipes, checks version bumps on modified recipes, and verifies `recipes/index.json` is in sync with the filesystem. Install with `git config core.hooksPath .githooks`.
