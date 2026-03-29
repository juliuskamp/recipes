# Recipe Management System — Design Document

## Project Overview

A self-hosted recipe management system built with JSON files stored in a Git repository, deployed to GitHub Pages with responsive mobile-friendly access. No backend server required.

**Core philosophy**: Store recipes as structured JSON, render dynamically with scaling, unit conversion, and multi-language support. Generate print-friendly PDFs via automated GitHub Actions on releases.

---

## 1. Architecture

### Storage Layer
- **Repository**: GitHub repo containing recipe JSON files
- **Structure**: `recipes/[recipe_id].json`
  - Example: `recipes/pancakes.json`
  - One JSON file per recipe (English base, optional translations inline)
  - `recipes/index.json` lists all recipe IDs
  - No PDFs in the repo — generated on-demand by Actions

### Frontend Layer
- **Hosting**: GitHub Pages (static site, served from repo root)
- **Technology**: Vanilla HTML, CSS, JavaScript (no build step, no npm dependencies)
- **Entry point**: `index.html` in project root
- **Responsive**: Mobile-first design, works on all devices

### CI/CD Layer
- **Validation**: Pre-commit hook validates all recipe JSON against schema
- **PDF Generation**: GitHub Action on release tag triggers PDF generation
- **Release Notes**: Automated detection of recipe changes (added/modified/deleted)

---

## 2. Recipe JSON Schema

### File Structure
Each recipe is a single JSON object with:

```json
{
  "id": "string (unique recipe identifier)",
  "title": "string",
  "default_servings": "number",
  "serving_unit": "string (e.g., 'servings', 'cupcakes')",
  "prep_time_minutes": "number",
  "cook_time_minutes": "number",
  "meal_type": "string (breakfast | main | snack | dessert | basic)",
  "tags": "array of strings",
  "related_recipes": "array of recipe IDs",
  "version": "integer (incremented on any change)",
  "ingredients": [
    {
      "name": "string",
      "amount": "number",
      "unit": "string (cups | tbsp | grams | ml | etc)"
    }
  ],
  "instructions": "string | array | array of objects (flexible)",
  "translations": {
    "<lang_code>": {
      "title": "string",
      "serving_unit": "string",
      "ingredients": ["translated name by index", "..."],
      "instructions": "same format as base instructions"
    }
  }
}
```

### Translation Model
- Recipes are authored in **English** (single source of truth for structure and amounts)
- Optional `translations` object provides per-language overrides for text content
- Translation `ingredients` is an **index-based array** matching the base ingredients order
- Tags, meal types, and units are always stored in English and translated by the frontend via `i18n.json`

### Instructions Format (Flexible)
Support all three:
1. **Simple string**: `"Mix and bake."`
2. **Array of steps**: `["Mix flour", "Bake at 350°"]`
3. **Sectioned**: `[{"section": "Prep", "steps": [...]}, ...]`

### Measurement Syntax
Use `{{amount unit}}` or `{{amount}}` in instructions:
- `{{200 g}}` — amount + unit, scales with portion slider and converts between unit systems
- `{{4}}` — unitless amount, scales only
- Examples: `"Add {{200 g}} flour, then {{4}} eggs."`
- Frontend parses and replaces these dynamically

---

## 3. JSON Schema Validation

Create `schema.json` in repo root. `validate.py` (Python stdlib only) validates:
- All required fields present
- Recipe ID format valid and matches filename
- Units in approved list
- `version` incremented on changes
- Translation ingredient arrays match ingredient count
- All recipes listed in `recipes/index.json`

---

## 4. Frontend Implementation

### Structure
```
/
├── index.html
├── i18n.json
├── css/main.css
├── js/
│   ├── app.js
│   ├── parser.js
│   ├── scaler.js
│   └── converter.js
└── recipes/
    ├── index.json
    └── pancakes.json
```

### Core Features

**Language Detection & Selection**
- Detect browser language from `navigator.language`
- Default to EN if not DE
- Provide selector UI (DE / EN toggles)
- Persist to localStorage

**Portion Scaling**
- Input field showing current servings (editable)
- Extract measurements with regex: `/\{\{[^}]+\}\}/g`
- On change: multiply all amounts by (new_servings / default_servings)
- Re-render instructions with scaled values

**Unit Conversion**
- Toggle button: Imperial ↔ Metric
- Hand-rolled lookup table for cooking units (no npm dependencies)
- Convert cups → ml, oz → grams, etc.
- Update all displayed amounts

**Related Recipes**
- Display clickable links at bottom
- Click → load that recipe with current settings

**Search / Filter**
- List all recipes with metadata
- Filter by meal_type and tags
- Search by title

---

## 5. PDF Generation

### GitHub Action Workflow (`.github/workflows/generate-pdfs.yml`)

On release tag:
1. Detect changed recipes by comparing git tags
2. For each changed recipe:
   - Use Puppeteer to open recipe page in browser
   - Render with current styling
   - Print to PDF (A4, print-friendly)
3. Attach PDFs to release
4. Generate release notes: "Added: pancakes\nModified: stir-fry"

---

## 6. Pre-commit Hook (`.githooks/pre-commit`)

- Validates all `recipes/*.json` against `schema.json` via `validate.py`
- Verifies version numbers are incremented on modified recipes
- Checks `recipes/index.json` contains all recipes (no missing, no stale entries)

Configure with: `git config core.hooksPath .githooks`

---

## 7. Development Workflow

**Add a recipe**:
1. Create `recipes/[id].json` (English base)
2. Add optional `translations` object for other languages
3. Add ID to `recipes/index.json`
4. Set `version: 1`
5. Commit — pre-commit validates schema and index
6. Push → GitHub Pages auto-rebuilds

**Edit a recipe**:
1. Modify JSON
2. Increment `version` field
3. Commit — hook enforces version bump
4. Push

**Release**:
1. `git tag v1.0.0`
2. `git push origin v1.0.0`
3. GitHub Action generates PDFs and creates release

---

## 8. Technology Stack

| Component | Tech |
|-----------|------|
| Frontend | HTML5, CSS3, Vanilla JS |
| Hosting | GitHub Pages |
| Data | JSON in Git |
| Validation | Python stdlib (validate.py) |
| Units | Vanilla JS lookup table |
| PDF | Puppeteer |
| CI/CD | GitHub Actions |

---

## 9. Example Recipe

`recipes/pancakes.json`:
```json
{
  "id": "pancakes",
  "title": "Fluffy Pancakes",
  "default_servings": 4,
  "serving_unit": "servings",
  "prep_time_minutes": 10,
  "cook_time_minutes": 15,
  "meal_type": "breakfast",
  "tags": ["vegetarian", "quick"],
  "related_recipes": [],
  "version": 1,
  "ingredients": [
    {"name": "flour", "amount": 2, "unit": "cups"},
    {"name": "eggs", "amount": 2, "unit": "whole"},
    {"name": "milk", "amount": 1.5, "unit": "cups"},
    {"name": "sugar", "amount": 2, "unit": "tbsp"},
    {"name": "baking powder", "amount": 2, "unit": "tsp"},
    {"name": "salt", "amount": 0.5, "unit": "tsp"}
  ],
  "instructions": [
    {
      "section": "Prepare",
      "steps": [
        "Mix {{2 cups}} flour, {{2 tsp}} baking powder, {{0.5 tsp}} salt.",
        "Whisk {{2}} eggs, {{1.5 cups}} milk, {{2 tbsp}} sugar.",
        "Combine wet and dry until just mixed."
      ]
    },
    {
      "section": "Cook",
      "steps": [
        "Heat skillet, lightly butter.",
        "Pour {{0.25 cups}} batter per pancake.",
        "Cook until bubbles form (~2min), flip.",
        "Cook golden on other side (1-2min)."
      ]
    }
  ],
  "translations": {
    "de": {
      "title": "Fluffige Pfannkuchen",
      "serving_unit": "Portionen",
      "ingredients": ["Mehl", "Eier", "Milch", "Zucker", "Backpulver", "Salz"],
      "instructions": [
        {
          "section": "Vorbereitung",
          "steps": [
            "{{2 cups}} Mehl, {{2 tsp}} Backpulver, {{0.5 tsp}} Salz mischen.",
            "{{2}} Eier, {{1.5 cups}} Milch, {{2 tbsp}} Zucker verquirlen.",
            "Nasse und trockene Zutaten vorsichtig vermengen."
          ]
        },
        {
          "section": "Braten",
          "steps": [
            "Pfanne erhitzen, leicht buttern.",
            "{{0.25 cups}} Teig pro Pfannkuchen eingießen.",
            "Braten bis Blasen entstehen (~2 Min), wenden.",
            "Goldbraun auf der anderen Seite braten (1-2 Min)."
          ]
        }
      ]
    }
  }
}
```

---

## 10. Implementation Phases

1. **Phase 1**: Repo setup, schema, pre-commit hook
2. **Phase 2**: Basic HTML, recipe loading, display
3. **Phase 3**: Portion scaling, unit conversion
4. **Phase 4**: Language detection and switching
5. **Phase 5**: Mobile polish, search, filtering
6. **Phase 6**: PDF generation, GitHub Actions, releases

---
