# Recipe Management System — Design Document

## Project Overview

A self-hosted recipe management system built with JSON files stored in a Git repository, deployed to GitHub Pages with responsive mobile-friendly access. No backend server required.

**Core philosophy**: Store recipes as structured JSON, render dynamically with scaling, unit conversion, and multi-language support. Generate print-friendly PDFs via automated GitHub Actions on releases.

---

## 1. Architecture

### Storage Layer
- **Repository**: GitHub repo containing recipe JSON files
- **Structure**: `recipes/[recipe_id]/[language].json`
  - Example: `recipes/pancakes/en.json`, `recipes/pancakes/de.json`
  - One recipe ID per dish, one JSON file per language variant
  - No PDFs in the repo — generated on-demand by Actions

### Frontend Layer
- **Hosting**: GitHub Pages (static site)
- **Technology**: Vanilla HTML, CSS, JavaScript
- **Deployment**: Built from `/docs` folder or `gh-pages` branch
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
      "id": "string",
      "name": "string",
      "amount": "number",
      "unit": "string (cups | tbsp | grams | ml | etc)"
    }
  ],
  "instructions": "string | array | array of objects (flexible)"
}
```

### Instructions Format (Flexible)
Support all three:
1. **Simple string**: `"Mix and bake."`
2. **Array of steps**: `["Mix flour", "Bake at 350°"]`
3. **Sectioned**: `[{"section": "Prep", "steps": [...]}, ...]`

### Measurement Syntax
Use `{{amount unit ingredient}}` in instructions:
- `{{2 cups flour}}` scales with portion slider
- `{{0.5 tsp salt}}` converts between unit systems
- Frontend parses and replaces these dynamically

---

## 3. JSON Schema Validation

Create `schema.json` in repo root with AJV. Pre-commit hook validates:
- All required fields present
- Recipe ID format valid
- Units in approved list
- `version` incremented on changes

---

## 4. Frontend Implementation

### Structure
```
docs/
├── index.html
├── css/main.css
├── js/
│   ├── app.js
│   ├── parser.js
│   ├── scaler.js
│   └── converter.js
└── recipes/  (copy of /recipes folder)
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
- Use `convert-units` npm library
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

```bash
#!/bin/bash
set -e

# Validate all JSON against schema
for file in recipes/*/*.json; do
  npx ajv validate -s schema.json -d "$file" || exit 1
done

# Verify version numbers incremented
# (check git diff for each modified file)

echo "✅ All recipes valid"
```

Configure with: `git config core.hooksPath .githooks`

---

## 7. Development Workflow

**Add a recipe**:
1. Create `recipes/[id]/en.json` and `recipes/[id]/de.json`
2. Set `version: 1`
3. Commit — pre-commit validates schema
4. Push → GitHub Pages auto-rebuilds

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
| Validation | AJV |
| Units | `convert-units` npm |
| PDF | Puppeteer |
| CI/CD | GitHub Actions |

---

## 9. Example Recipe

`recipes/pancakes/en.json`:
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
    {"id": "flour", "name": "flour", "amount": 2, "unit": "cups"},
    {"id": "eggs", "name": "eggs", "amount": 2, "unit": "whole"},
    {"id": "milk", "name": "milk", "amount": 1.5, "unit": "cups"},
    {"id": "sugar", "name": "sugar", "amount": 2, "unit": "tbsp"},
    {"id": "baking_powder", "name": "baking powder", "amount": 2, "unit": "tsp"},
    {"id": "salt", "name": "salt", "amount": 0.5, "unit": "tsp"}
  ],
  "instructions": [
    {
      "section": "Prepare",
      "steps": [
        "Mix {{2 cups flour}}, {{2 tsp baking powder}}, {{0.5 tsp salt}}.",
        "Whisk {{2 eggs}}, {{1.5 cups milk}}, {{2 tbsp sugar}}.",
        "Combine wet and dry until just mixed."
      ]
    },
    {
      "section": "Cook",
      "steps": [
        "Heat skillet, lightly butter.",
        "Pour {{0.25 cups batter}} per pancake.",
        "Cook until bubbles form (~2min), flip.",
        "Cook golden on other side (1-2min)."
      ]
    }
  ]
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
