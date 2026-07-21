#!/usr/bin/env node
"use strict";

/**
 * Zero-dependency static site generator.
 *
 * Reads recipes/*.json + i18n.json and emits the complete site into _site/:
 *   index.html                     language redirect (+ legacy #recipe/... links)
 *   <lang>/index.html              index view (cards grouped by meal type)
 *   <lang>/search/index.html       search page (filtered client-side)
 *   <lang>/recipe/<id>/index.html  recipe page (base variant)
 *   <lang>/recipe/<id>/<n>/        recipe page for variant n
 *   <lang>/print.html              fragment with all recipes, for "download all"
 *
 * Measurements are rendered at default servings / metric and additionally
 * carry data attributes; js/runtime.js re-renders them client-side for other
 * servings counts / unit systems. Rendering here uses the SAME modules the
 * browser gets (js/converter.js, js/scaler.js, js/parser.js) loaded via vm,
 * so build-time and client-side output can never drift.
 *
 * Usage: node build.js [--watch]
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const sharp = require("sharp");
const { validateRecipe, loadSchema } = require("./validate.js");

const ROOT = __dirname;
const OUT = path.join(ROOT, "_site");
const LANGS = ["en", "de"];

// Public base URL of the deployed site (no trailing slash). Used for absolute
// og:image / og:url, which social scrapers (WhatsApp, Facebook…) require.
const SITE_URL = JSON.parse(
  fs.readFileSync(path.join(ROOT, "site.json"), "utf8")
).url.replace(/\/$/, "");

// --- Shared browser modules, loaded once ---

const { Converter, Scaler, Parser } = (() => {
  const code =
    ["converter.js", "scaler.js", "parser.js"]
      .map((f) => fs.readFileSync(path.join(ROOT, "js", f), "utf8"))
      .join("\n") +
    "\n;({ Converter, Scaler, Parser });";
  return vm.runInContext(code, vm.createContext({}), { filename: "js/shared" });
})();

// --- Small helpers ---

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** JSON for inline <script> use ("</script" must not appear literally). */
function jsonForScript(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

function writeFile(relPath, content) {
  const full = path.join(OUT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true });
}

// --- Social-card preview images ---
// Scrapers (WhatsApp, Facebook…) want an absolute-URL JPEG under ~300 KB at
// ~1.91:1. We generate a 1200x630 JPEG per source image (any input format) for
// og:image, cached by source mtime so --watch rebuilds stay fast. The original
// image is still what the page itself displays.

const PREVIEW_CACHE = path.join(ROOT, ".preview-cache");
const PREVIEW_W = 1200;
const PREVIEW_H = 630;

/** og:image filename for a source image filename (foo.webp -> foo_preview.jpg). */
function previewName(file) {
  return file.replace(/\.[^.]+$/, "") + "_preview.jpg";
}

/**
 * Build a 1200x630 JPEG preview for every source image (cached by mtime) and
 * copy them into _site/assets/recipe_images/. Returns the number regenerated.
 */
async function generatePreviews(images) {
  fs.mkdirSync(PREVIEW_CACHE, { recursive: true });
  const srcDir = path.join(ROOT, "assets", "recipe_images");
  const outDir = path.join(OUT, "assets", "recipe_images");
  let regenerated = 0;
  for (const file of Object.values(images)) {
    const src = path.join(srcDir, file);
    const cached = path.join(PREVIEW_CACHE, previewName(file));
    const fresh =
      fs.existsSync(cached) &&
      fs.statSync(cached).mtimeMs >= fs.statSync(src).mtimeMs;
    if (!fresh) {
      await sharp(src)
        // "cover" scales to fill 1200x630, then crops the overflow; "centre"
        // trims equally from both sides (top/bottom or left/right).
        .resize(PREVIEW_W, PREVIEW_H, { fit: "cover", position: "centre" })
        .jpeg({ quality: 80, mozjpeg: true })
        .toFile(cached);
      regenerated++;
    }
    fs.copyFileSync(cached, path.join(outDir, previewName(file)));
  }
  return regenerated;
}

// --- Data loading ---

/** Map image basename (no extension) -> filename, from assets/recipe_images/. */
function loadImages() {
  const dir = path.join(ROOT, "assets", "recipe_images");
  const map = {};
  if (!fs.existsSync(dir)) return map;
  for (const f of fs.readdirSync(dir)) {
    const ext = path.extname(f);
    if (!/\.(webp|png|jpe?g|avif|gif)$/i.test(ext)) continue;
    map[f.slice(0, -ext.length)] = f;
  }
  return map;
}

function loadData() {
  const schema = loadSchema();
  const i18n = JSON.parse(fs.readFileSync(path.join(ROOT, "i18n.json"), "utf8"));
  const images = loadImages();

  const files = fs
    .readdirSync(path.join(ROOT, "recipes"))
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .sort();

  const recipes = [];
  const problems = [];
  for (const f of files) {
    const id = f.replace(/\.json$/, "");
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(ROOT, "recipes", f), "utf8"));
    } catch (e) {
      problems.push(`recipes/${f}: invalid JSON: ${e.message}`);
      continue;
    }
    const errors = validateRecipe(data, schema);
    if (errors.length > 0) {
      problems.push(...errors.map((e) => `recipes/${f}: ${e}`));
      continue;
    }
    data.id = id;
    recipes.push(data);
  }

  if (problems.length > 0) {
    for (const p of problems) console.error("ERROR " + p);
    throw new Error(`${problems.length} validation error(s) — build aborted.`);
  }

  return { recipes, i18n, images };
}

// --- Per-language rendering context (ports of js/app.js helpers) ---

function makeLang(lang, recipes, i18n, images) {
  function t(category, key) {
    const l = i18n[lang];
    if (l && l[category] && l[category][key]) return l[category][key];
    const en = i18n["en"];
    if (en && en[category] && en[category][key]) return en[category][key];
    return key;
  }
  const tUI = (key) => t("ui", key);
  const translateUnit = (unit) => t("units", unit);

  const needsTranslation = (r) => r.language !== lang;
  const hasTranslation = (r) => !needsTranslation(r) || (r.translations && r.translations[lang]);
  const getTranslation = (r) =>
    needsTranslation(r) && r.translations && r.translations[lang] ? r.translations[lang] : null;

  function translationBadge(r) {
    if (hasTranslation(r)) return "";
    return ` <span class="no-translation">${esc(tUI("no_translation_" + r.language))}</span>`;
  }

  const getTitle = (r) => (getTranslation(r) ? getTranslation(r).title : r.title);
  const getServingUnit = (r) => (getTranslation(r) ? getTranslation(r).serving_unit : r.serving_unit);

  /** Resolve a recipe + variant index into an effective view object. */
  function resolveVariant(recipe, variantIdx) {
    const isBase = !variantIdx;
    const variant = isBase ? null : (recipe.variants || [])[variantIdx - 1];

    const tags = (variant && variant.tags) || recipe.tags || [];
    const ingredients = recipe.ingredients.map((ing, i) => {
      if (variant && variant.ingredients && variant.ingredients[String(i)]) {
        return variant.ingredients[String(i)];
      }
      return ing;
    });
    const instructions = (variant && variant.instructions) || recipe.instructions;
    const title = isBase ? recipe.title : variant.name;
    const variantName = isBase ? tUI("variant_default") : variant.variant_name;

    const tr = getTranslation(recipe);
    let translatedTitle = title;
    let translatedVariantName = variantName;
    let translatedIngredientNames = null;
    let translatedInstructions = null;

    if (tr) {
      if (isBase) {
        translatedTitle = tr.title;
        translatedIngredientNames = tr.ingredients ? tr.ingredients.slice() : null;
        translatedInstructions = tr.instructions;
      } else {
        const tv = tr.variants && tr.variants[variantIdx - 1];
        if (tv) {
          translatedTitle = tv.name;
          translatedVariantName = tv.variant_name;
          translatedIngredientNames = tr.ingredients ? tr.ingredients.slice() : null;
          if (translatedIngredientNames && tv.ingredients) {
            for (const [k, v] of Object.entries(tv.ingredients)) {
              translatedIngredientNames[parseInt(k, 10)] = v;
            }
          }
          translatedInstructions = tv.instructions || tr.instructions;
        } else {
          translatedIngredientNames = tr.ingredients ? tr.ingredients.slice() : null;
          translatedInstructions = tr.instructions;
        }
      }
    }

    return {
      recipe, variantIdx, isBase, title, variantName, tags, ingredients, instructions,
      translatedTitle, translatedVariantName, translatedIngredientNames, translatedInstructions,
    };
  }

  const resolvedTitle = (res) => (getTranslation(res.recipe) ? res.translatedTitle : res.title);
  const resolvedVariantName = (res) =>
    getTranslation(res.recipe) ? res.translatedVariantName : res.variantName;

  function resolvedIngredientName(res, index) {
    if (getTranslation(res.recipe) && res.translatedIngredientNames) {
      const tr = res.translatedIngredientNames[index];
      if (tr !== undefined) return tr;
    }
    return res.ingredients[index].name;
  }

  function resolvedInstructions(res) {
    if (getTranslation(res.recipe) && res.translatedInstructions) {
      return res.translatedInstructions;
    }
    return res.instructions;
  }

  function getAllTagsForRecipe(recipe) {
    const all = new Set(recipe.tags || []);
    for (const v of recipe.variants || []) {
      const vTags = v.tags || recipe.tags || [];
      for (const tag of vTags) all.add(tag);
    }
    return [...all];
  }

  /**
   * Resolve the image file for a recipe/variant, or null if none exists.
   * Base variant matches by recipe id; other variants use their explicit
   * `image_file_name` (basename, no extension). A missing file yields null.
   */
  function imageFileFor(recipe, variantIdx) {
    let key;
    if (!variantIdx) {
      key = recipe.id;
    } else {
      const v = (recipe.variants || [])[variantIdx - 1];
      key = v && v.image_file_name;
    }
    if (!key) return null;
    return images[key] || null;
  }

  /** <img> for a resolved variant, or "" if it has no image. relLang = prefix up to the language dir. */
  function recipeImageHtml(res, relLang, className) {
    const file = imageFileFor(res.recipe, res.variantIdx);
    if (!file) return "";
    const src = `${relLang}../assets/recipe_images/${esc(file)}`;
    const alt = esc(tUI("photo_alt").replace("{name}", resolvedTitle(res)));
    return `<img class="${className}" src="${src}" alt="${alt}" loading="lazy">`;
  }

  return {
    lang, recipes, t, tUI, translateUnit, needsTranslation, hasTranslation, getTranslation,
    translationBadge, getTitle, getServingUnit, resolveVariant, resolvedTitle,
    resolvedVariantName, resolvedIngredientName, resolvedInstructions, getAllTagsForRecipe,
    imageFileFor, recipeImageHtml,
  };
}

/** One entry per base recipe + one per variant whose name differs from the base title. */
function buildVirtualEntries(recipes) {
  const entries = [];
  for (const r of recipes) {
    entries.push({ recipeId: r.id, variantIdx: 0 });
    if (Array.isArray(r.variants)) {
      r.variants.forEach((v, i) => {
        if (v && v.name && v.name !== r.title) {
          entries.push({ recipeId: r.id, variantIdx: i + 1 });
        }
      });
    }
  }
  return entries;
}

function collectFilters(recipes, L) {
  const tagSet = new Set();
  const mealSet = new Set();
  for (const r of recipes) {
    if (r.meal_type) mealSet.add(r.meal_type);
    for (const tag of L.getAllTagsForRecipe(r)) tagSet.add(tag);
  }
  const mealOrder = ["breakfast", "main", "dessert", "snack", "basic"];
  const rank = (m) => {
    const i = mealOrder.indexOf(m);
    return i === -1 ? mealOrder.length : i;
  };
  const allMealTypes = [...mealSet].sort((a, b) => rank(a) - rank(b));
  return { allTags: [...tagSet].sort(), allMealTypes };
}

// --- HTML building blocks ---

/** Escape user text inside instructions, keeping the {{...}} tokens intact. */
function escInstructions(instructions) {
  if (typeof instructions === "string") return esc(instructions);
  if (Array.isArray(instructions)) {
    if (instructions.length === 0) return [];
    if (typeof instructions[0] === "string") return instructions.map(esc);
    return instructions.map((sec) => ({
      section: sec.section ? esc(sec.section) : sec.section,
      steps: (sec.steps || []).map(esc),
    }));
  }
  return instructions;
}

function timeMeta(recipe, L) {
  const parts = [];
  if (recipe.prep_time_minutes) parts.push(`${recipe.prep_time_minutes} ${L.tUI("mins")} ${L.tUI("prep")}`);
  if (recipe.cook_time_minutes) parts.push(`${recipe.cook_time_minutes} ${L.tUI("mins")} ${L.tUI("cook")}`);
  return parts.map((p) => `<span>${esc(p)}</span>`).join("");
}

function recipeUrl(relLang, id, variantIdx) {
  return `${relLang}recipe/${id}/` + (variantIdx > 0 ? `${variantIdx}/` : "");
}

/** A recipe card as a real link. relLang = prefix up to the language dir. */
function entryCardHtml(entry, L, relLang) {
  const r = L.recipes.find((x) => x.id === entry.recipeId);
  if (!r) return "";
  const res = L.resolveVariant(r, entry.variantIdx);
  const title = L.resolvedTitle(res);
  const ownTags = new Set(res.tags);
  const allTags = L.getAllTagsForRecipe(r);

  const tagsHtml = allTags
    .map((tag) => {
      if (ownTags.has(tag)) return `<span class="tag">${esc(L.t("tags", tag))}</span>`;
      return `<span class="tag tag-ghost">${esc(L.t("tags", tag))} ${esc(L.tUI("tag_variant_suffix"))}</span>`;
    })
    .join("");

  const imgHtml = L.recipeImageHtml(res, relLang, "recipe-card-img");
  const timeHtml = timeMeta(r, L);

  return `
      <a class="recipe-card${imgHtml ? " has-img" : ""}" href="${recipeUrl(relLang, r.id, entry.variantIdx)}">
        <div class="recipe-card-body">
          <h2>${esc(title)}${L.translationBadge(r)}</h2>
          <div class="recipe-card-tags">
            <span class="badge meal-type">${esc(L.t("meal_types", r.meal_type || ""))}</span>
            ${tagsHtml}
          </div>
          ${timeHtml ? `<div class="recipe-card-meta">${timeHtml}</div>` : ""}
        </div>
        ${imgHtml}
      </a>
    `;
}

/**
 * The recipe body. Rendered at default servings, metric units, page language.
 * Measurement spans carry data attributes for client-side re-rendering.
 *   forPrint: omit interactive chrome (download button, servings input).
 */
function buildRecipeHtml(r, L, relLang, variantIdx, { forPrint = false } = {}) {
  const res = L.resolveVariant(r, variantIdx);
  const servings = r.default_servings;
  const ratio = 1; // default servings

  const scaled = Scaler.scaleIngredients(res.ingredients, ratio);
  const instructions = escInstructions(L.resolvedInstructions(res));
  const sections = Parser.processInstructions(instructions, ratio, "metric", L.translateUnit);

  const ingredientsHtml = scaled
    .map((ing, i) => {
      const name = esc(L.resolvedIngredientName(res, i));

      if (ing.amount == null) {
        return `<li>${name}</li>`;
      }

      const baseAmount = res.ingredients[i].amount;
      const baseUnit = res.ingredients[i].unit || "";

      let amount = ing.amount;
      let unit = ing.unit;
      if (unit) {
        const converted = Converter.convert(amount, unit, "metric");
        if (converted) {
          amount = converted.amount;
          unit = converted.unit;
        }
      }

      const amountStr = Converter.formatAmount(amount);
      const displayUnit = unit && unit !== "whole" ? ` ${L.translateUnit(unit)}` : "";
      return `<li><span class="ingredient-amount" data-amount="${baseAmount}" data-unit="${esc(baseUnit)}">${amountStr}${displayUnit}</span> ${name}</li>`;
    })
    .join("");

  const instructionsHtml = sections
    .map((sec) => {
      const sectionWrap = sec.section ? "instruction-section" : "";
      const title = sec.section ? `<div class="section-title">${sec.section}</div>` : "";
      const steps = sec.steps.map((s) => `<li>${s}</li>`).join("");
      return `<div class="${sectionWrap}">${title}<ol class="step-list">${steps}</ol></div>`;
    })
    .join("");

  let relatedHtml = "";
  if (r.related_recipes && r.related_recipes.length > 0) {
    const links = r.related_recipes
      .map((id) => {
        const related = L.recipes.find((x) => x.id === id);
        const name = related ? L.getTitle(related) : id;
        return `<a class="related-link" href="${recipeUrl(relLang, id, 0)}">${esc(name)}</a>`;
      })
      .join(", ");
    relatedHtml = `
        <div class="related-section">
          <h3>${esc(L.tUI("related"))}</h3>
          <p>${links}</p>
        </div>
      `;
  }

  const mealLink = r.meal_type
    ? `<a class="recipe-meta-link badge meal-type" href="${relLang}search/?meal=${r.meal_type}">${esc(L.t("meal_types", r.meal_type))}</a>`
    : "";
  const ownTags = new Set(res.tags);
  const unionTags = L.getAllTagsForRecipe(r);
  const tagLinks = unionTags
    .map((tag) => {
      const isOwn = ownTags.has(tag);
      const cls = isOwn ? "recipe-meta-link tag" : "recipe-meta-link tag tag-ghost";
      const suffix = isOwn ? "" : ` ${esc(L.tUI("tag_variant_suffix"))}`;
      return `<a class="${cls}" href="${relLang}search/?tags=${tag}">${esc(L.t("tags", tag))}${suffix}</a>`;
    })
    .join("");

  let variantSelectorHtml = "";
  if (Array.isArray(r.variants) && r.variants.length > 0) {
    const buttons = [];
    for (let i = 0; i <= r.variants.length; i++) {
      const vr = L.resolveVariant(r, i);
      const label = esc(L.resolvedVariantName(vr));
      const active = i === variantIdx ? " active" : "";
      buttons.push(`<a class="group-btn variant-btn${active}" href="${recipeUrl(relLang, r.id, i)}">${label}</a>`);
    }
    variantSelectorHtml = `<div class="btn-group variant-selector">${buttons.join("")}</div>`;
  }

  let serveWithHtml = "";
  if (Array.isArray(r.serve_with) && r.serve_with.length > 0) {
    const links = r.serve_with
      .map((id) => {
        const sw = L.recipes.find((x) => x.id === id);
        const name = sw ? L.getTitle(sw) : id;
        return `<a class="serve-with-link" href="${recipeUrl(relLang, id, 0)}">${esc(name)}</a>`;
      })
      .join(", ");
    serveWithHtml = `<div class="serve-with"><strong>${esc(L.tUI("serve_with"))}:</strong> ${links}</div>`;
  }

  const downloadBtn = forPrint
    ? ""
    : `<button id="download-pdf" class="download-pdf-btn" aria-label="${esc(L.tUI("download_pdf"))}">${esc(L.tUI("download_pdf"))}</button>`;

  const servingsControl = forPrint
    ? ""
    : `<div class="servings-control">
          <input type="number" id="servings-input" value="${servings}" min="1" max="100">
          <span class="serving-unit">${esc(L.getServingUnit(r))}</span>
        </div>`;

  const servingsPrint = `<div class="servings-print">
      <span class="servings-print-num">${servings}</span>
      <span class="serving-unit">${esc(L.getServingUnit(r))}</span>
    </div>`;

  const heroImg = forPrint ? "" : L.recipeImageHtml(res, relLang, "recipe-hero-img");

  return `
      <div class="recipe-header">
        ${heroImg}
        <div class="recipe-title-row">
          <h2>${esc(L.resolvedTitle(res))}${L.translationBadge(r)}</h2>
          ${downloadBtn}
        </div>
        <div class="recipe-meta">
          ${mealLink}
          ${timeMeta(r, L)}
        </div>
        <div class="recipe-tags">
          ${tagLinks}
        </div>
        ${variantSelectorHtml}
        ${serveWithHtml}
      </div>

      ${servingsControl}
      ${servingsPrint}

      <div class="ingredients-section">
        <h3>${esc(L.tUI("ingredients"))}</h3>
        <ul class="ingredient-list">${ingredientsHtml}</ul>
      </div>

      <div class="instructions-section">
        <h3>${esc(L.tUI("instructions"))}</h3>
        ${instructionsHtml}
      </div>

      ${relatedHtml}
    `;
}

// --- Page shell ---

const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("recipe-theme");if(t!=="light"&&t!=="dark")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.setAttribute("data-theme",t);document.documentElement.style.colorScheme=t;}catch(e){}})();`;

function headerHtml(L, { rel, langPrefix, page, counterpartPath, filterBarHtml }) {
  const otherLang = L.lang === "en" ? "de" : "en";
  const counterpartHref = `${rel}${otherLang}/${counterpartPath}`;

  const langBtn = (l) =>
    l === L.lang
      ? `<button id="lang-${l}" class="group-btn active">${l.toUpperCase()}</button>`
      : `<a id="lang-${l}" class="group-btn" href="${counterpartHref}">${l.toUpperCase()}</a>`;

  return `<header>
    <div class="header-top">
      <h1><a href="${langPrefix || "."}" id="home-link">${esc(L.tUI("site_title"))}</a></h1>
      <div class="header-controls">
        <button id="cook-toggle" class="cook-btn${page === "recipe" ? "" : " hidden"}">${esc(L.tUI("cook_mode"))}</button>
        <div class="btn-group">
          <button id="theme-light" class="group-btn" aria-label="Light mode">☀</button>
          <button id="theme-dark" class="group-btn" aria-label="Dark mode">☽</button>
        </div>
        <div class="btn-group">
          <button id="unit-metric" class="group-btn active">${esc(L.tUI("metric"))}</button>
          <button id="unit-imperial" class="group-btn">${esc(L.tUI("imperial"))}</button>
        </div>
        <div class="btn-group">
          ${langBtn("en")}${langBtn("de")}
        </div>
      </div>
    </div>
    <div class="search-bar">
      ${
        // On the index page, when the URL already carries a search query (e.g.
        // arriving from a recipe page's search bar), emit the input WITH the
        // native `autofocus` attribute at parse time — the only way to focus
        // reliably on a fresh load. Written via document.write so the attribute
        // is present when the parser sees the element. Plain home visits (no
        // query) and other pages get a normal, unfocused input.
        // autocomplete/spellcheck off so the browser's own suggestion dropdown
        // (past searches) doesn't swallow the ArrowDown card-navigation key.
        page === "index"
          ? `<script>document.write('<input type="text" id="search-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${esc(L.tUI("search_placeholder")).replace(/'/g, "\\'")}"' + (location.search ? ' autofocus' : '') + '>');</script>` +
            `<noscript><input type="text" id="search-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${esc(L.tUI("search_placeholder"))}"></noscript>`
          : `<input type="text" id="search-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="${esc(L.tUI("search_placeholder"))}">`
      }
    </div>
    ${filterBarHtml || ""}
  </header>`;
}

function pageShell(L, { depth, page, title, description, ogImageFile, counterpartPath, filterBarHtml, mainHtml, pageData }) {
  const rel = "../".repeat(depth); // prefix up to the site root
  const langPrefix = "../".repeat(depth - 1); // prefix up to the language dir
  const data = { lang: L.lang, page, rel, searchPath: `${langPrefix}`, ...pageData };

  const metaDesc = description ? `\n  <meta name="description" content="${esc(description)}">` : "";
  const ogImage = ogImageFile
    ? `\n  <meta property="og:image" content="${SITE_URL}/assets/recipe_images/${esc(previewName(ogImageFile))}">` +
      `\n  <meta property="og:image:type" content="image/jpeg">` +
      `\n  <meta property="og:image:width" content="${PREVIEW_W}">` +
      `\n  <meta property="og:image:height" content="${PREVIEW_H}">`
    : "";
  const og = `
  <meta property="og:title" content="${esc(title)}">
  ${description ? `<meta property="og:description" content="${esc(description)}">` : ""}
  <meta property="og:type" content="${page === "recipe" ? "article" : "website"}">
  <meta property="og:locale" content="${L.lang === "de" ? "de_DE" : "en_US"}">${ogImage}`;

  return `<!DOCTYPE html>
<html lang="${L.lang}">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>${metaDesc}${og}
  <link rel="icon" href="${rel}assets/favicons/favicon-utensils.svg" type="image/svg+xml">
  <meta name="color-scheme" content="light dark">
  <script>${THEME_BOOTSTRAP}</script>
  <link rel="stylesheet" href="${rel}css/main.css">
</head>

<body class="page-${page}">
  ${headerHtml(L, { rel, langPrefix, page, counterpartPath, filterBarHtml })}

  <main>
${mainHtml}
  </main>

  <script>window.__PAGE__ = ${jsonForScript(data)};</script>
  <script src="${rel}js/converter.js" defer></script>
  <script src="${rel}js/scaler.js" defer></script>
  <script src="${rel}js/runtime.js" defer></script>
</body>

</html>`;
}

function filterBar(L, allMealTypes, allTags, { asLinks, relLang }) {
  const meals = allMealTypes
    .map((meal) =>
      asLinks
        ? `<a class="filter-btn meal-type" href="${relLang}search/?meal=${meal}">${esc(L.t("meal_types", meal))}</a>`
        : `<span class="filter-btn meal-type" data-meal="${meal}">${esc(L.t("meal_types", meal))}</span>`
    )
    .join("");
  const tags = allTags
    .map((tag) =>
      asLinks
        ? `<a class="filter-btn tag" href="${relLang}search/?tags=${tag}">${esc(L.t("tags", tag))}</a>`
        : `<span class="filter-btn tag" data-tag="${tag}">${esc(L.t("tags", tag))}</span>`
    )
    .join("");
  return `<div id="filter-bar" class="filter-bar">
      <div id="meal-type-filters" class="filter-group">${meals}</div>
      <div class="filter-divider"></div>
      <div id="tag-filters" class="filter-group">${tags}</div>
    </div>`;
}

// --- Pages ---

function buildIndexPage(L, entries, filters, i18n) {
  const relLang = ""; // page lives directly in the language dir

  // Order entries by resolved display title in the current language (umlaut-
  // aware). Both the grouped index and the flat search list derive from this
  // order, so sorting here fixes both.
  const titleOf = (e) =>
    L.resolvedTitle(L.resolveVariant(L.recipes.find((x) => x.id === e.recipeId), e.variantIdx));
  const sortKey = (e) => titleOf(e).replace(/^[^\p{L}\p{N}]+/u, ""); // drop leading punctuation
  entries = [...entries].sort((a, b) =>
    sortKey(a).localeCompare(sortKey(b), L.lang, { sensitivity: "base" })
  );

  const groups = {};
  for (const meal of filters.allMealTypes) {
    const inGroup = entries.filter((e) => {
      const r = L.recipes.find((x) => x.id === e.recipeId);
      return r && r.meal_type === meal;
    });
    if (inGroup.length > 0) groups[meal] = inGroup;
  }

  let body;
  if (Object.keys(groups).length === 0) {
    body = `<p>${esc(L.tUI("no_recipes"))}</p>`;
  } else {
    const toolbar = `
      <div class="index-toolbar">
        <button id="download-all" class="download-all-btn">${esc(L.tUI("download_all"))}</button>
      </div>`;
    body =
      toolbar +
      Object.entries(groups)
        .map(
          ([meal, group]) => `
      <div class="meal-group">
        <h2 class="meal-group-title">${esc(L.t("meal_types", meal))}</h2>
        <div class="recipe-list">
          ${group.map((e) => entryCardHtml(e, L, relLang)).join("")}
        </div>
      </div>
    `
        )
        .join("");
  }

  // Search data lives on the index page too, so the index ↔ search transition
  // is an in-place view swap (no reload): the grouped `#index-view` and the
  // flat `#search-view` share this one page, and runtime.js toggles between
  // them from the URL query. Card links use the index-depth prefix (relLang
  // "") — searching only adds a query string, so the pathname never changes.
  const entryData = entries.map((e) => {
    const r = L.recipes.find((x) => x.id === e.recipeId);
    const res = L.resolveVariant(r, e.variantIdx);
    return {
      title: L.resolvedTitle(res),
      mealType: r.meal_type || null,
      tags: res.tags,
      html: entryCardHtml(e, L, relLang),
    };
  });

  return pageShell(L, {
    depth: 1,
    page: "index",
    title: L.tUI("site_title"),
    description: null,
    counterpartPath: "",
    filterBarHtml: filterBar(L, filters.allMealTypes, filters.allTags, { asLinks: false, relLang }),
    mainHtml:
      `    <div id="index-view" class="index-view">${body}</div>\n` +
      `    <div id="search-view" class="search-view hidden"></div>`,
    pageData: {
      units: i18n[L.lang].units || {},
      printFragment: "print.html",
      entries: entryData,
      noRecipes: L.tUI("no_recipes"),
    },
  });
}

function ogDescription(r, L) {
  const res = L.resolveVariant(r, 0);
  const names = res.ingredients.map((_, i) => L.resolvedIngredientName(res, i));
  let desc = names.join(", ");
  if (desc.length > 157) desc = desc.slice(0, 157) + "…";
  return desc;
}

function buildRecipePage(L, r, variantIdx, i18n) {
  const depth = variantIdx > 0 ? 4 : 3; // <lang>/recipe/<id>/[<n>/]
  const relLang = "../".repeat(depth - 1);
  const res = L.resolveVariant(r, variantIdx);
  const counterpartPath = `recipe/${r.id}/` + (variantIdx > 0 ? `${variantIdx}/` : "");

  const inner = buildRecipeHtml(r, L, relLang, variantIdx);

  return pageShell(L, {
    depth,
    page: "recipe",
    title: `${L.resolvedTitle(res)} – ${L.tUI("site_title")}`,
    description: ogDescription(r, L),
    ogImageFile: L.imageFileFor(r, variantIdx),
    counterpartPath,
    filterBarHtml: "",
    mainHtml: `    <div id="recipe-view" class="recipe-view">${inner}</div>`,
    pageData: { units: i18n[L.lang].units || {}, defaultServings: r.default_servings },
  });
}

function buildPrintFragment(L) {
  const relLang = ""; // fragment is fetched from the language index page
  return (
    "<!-- Generated fragment: all recipes, print layout. Injected by runtime.js for \"download all\". -->\n" +
    L.recipes
      .map((r) => `<div class="recipe-view print-recipe">${buildRecipeHtml(r, L, relLang, 0, { forPrint: true })}</div>`)
      .join("\n")
  );
}

function buildRootRedirect() {
  return `<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Julius' Recipes</title>
  <link rel="icon" href="assets/favicons/favicon-utensils.svg" type="image/svg+xml">
  <meta name="color-scheme" content="light dark">
  <script>
    // Redirect to the preferred language. Also maps legacy SPA hash URLs
    // (#recipe/<id>[/<variant>], #search?...) onto the new static pages.
    (function () {
      var lang = null;
      try { lang = localStorage.getItem("recipe-lang"); } catch (e) { }
      if (lang !== "en" && lang !== "de") {
        lang = ((navigator.language || "").toLowerCase().indexOf("de") === 0) ? "de" : "en";
      }
      var target = lang + "/";
      var h = window.location.hash;
      var m;
      if ((m = h.match(/^#recipe\\/([A-Za-z0-9_-]+)(?:\\/(\\d+))?$/))) {
        target = lang + "/recipe/" + m[1] + "/" + (m[2] ? m[2] + "/" : "");
      } else if ((m = h.match(/^#search(\\?.*)?$/))) {
        target = lang + "/search/" + (m[1] || "");
      }
      window.location.replace(target);
    })();
  </script>
</head>

<body>
  <noscript>
    <p><a href="en/">English</a> · <a href="de/">Deutsch</a></p>
  </noscript>
</body>

</html>`;
}

// <lang>/search/ is now just the language index page with a query string.
// This tiny page forwards there, preserving the query and hash.
function buildSearchRedirect() {
  return `<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Search</title>
  <link rel="icon" href="../../assets/favicons/favicon-utensils.svg" type="image/svg+xml">
  <meta name="color-scheme" content="light dark">
  <script>
    window.location.replace("../" + window.location.search + window.location.hash);
  </script>
  <noscript><meta http-equiv="refresh" content="0; url=../"></noscript>
</head>

<body>
  <noscript><p><a href="../">Continue</a></p></noscript>
</body>

</html>`;
}

// --- Build ---

async function build() {
  const started = Date.now();
  const { recipes, i18n, images } = loadData();
  const entries = buildVirtualEntries(recipes);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  // Static assets + the shared modules the runtime needs
  copyDir(path.join(ROOT, "css"), path.join(OUT, "css"));
  copyDir(path.join(ROOT, "assets"), path.join(OUT, "assets"));
  await generatePreviews(images);
  fs.mkdirSync(path.join(OUT, "js"), { recursive: true });
  for (const f of ["converter.js", "scaler.js", "runtime.js"]) {
    fs.copyFileSync(path.join(ROOT, "js", f), path.join(OUT, "js", f));
  }
  writeFile(".nojekyll", "");

  writeFile("index.html", buildRootRedirect());

  let pages = 1;
  for (const lang of LANGS) {
    const L = makeLang(lang, recipes, i18n, images);
    const filters = collectFilters(recipes, L);

    writeFile(`${lang}/index.html`, buildIndexPage(L, entries, filters, i18n));
    // Search now lives on the language index page (query params, in-place view
    // swap). Keep the old /search/ URL working by redirecting to it, carrying
    // any query string / hash across.
    writeFile(`${lang}/search/index.html`, buildSearchRedirect());
    writeFile(`${lang}/print.html`, buildPrintFragment(L));
    pages += 3;

    for (const r of recipes) {
      writeFile(`${lang}/recipe/${r.id}/index.html`, buildRecipePage(L, r, 0, i18n));
      pages++;
      const nVariants = Array.isArray(r.variants) ? r.variants.length : 0;
      for (let v = 1; v <= nVariants; v++) {
        writeFile(`${lang}/recipe/${r.id}/${v}/index.html`, buildRecipePage(L, r, v, i18n));
        pages++;
      }
    }
  }

  console.log(`Built ${pages} pages (${recipes.length} recipes, ${LANGS.length} languages) in ${Date.now() - started}ms → ${path.relative(process.cwd(), OUT) || "."}`);
}

function watch() {
  const IGNORE = /^(_site|node_modules|pdfs|\.git|\.preview-cache)(\/|$)/;
  let timer = null;
  const rebuild = (reason) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      build().catch((e) => console.error(e.message));
    }, 100);
  };
  fs.watch(ROOT, { recursive: true }, (event, filename) => {
    if (!filename || IGNORE.test(filename)) return;
    rebuild(filename);
  });
  console.log("Watching for changes... (serve _site/ with any static server)");
}

module.exports = { build };

if (require.main === module) {
  build()
    .then(() => {
      if (process.argv.includes("--watch")) watch();
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
