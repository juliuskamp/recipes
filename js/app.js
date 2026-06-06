/**
 * Main application: three views (index, search, recipe), language, unit conversion.
 */
const App = (() => {
  // State
  let recipes = [];
  let virtualEntries = []; // [{ recipeId, variantIdx }, ...] — one per card shown in index/search
  let currentRecipe = null;
  let currentVariantIdx = 0;
  let currentServings = 0;
  let language = "en";
  let unitSystem = "metric";
  let activeTags = new Set();
  let activeMealType = null;
  let searchQuery = "";
  let i18n = {};
  let allTags = [];
  let allMealTypes = [];
  let currentView = "index"; // "index", "search", "recipe"
  let cookingMode = false;
  let theme = "light";

  const RECIPES_INDEX = "recipes/index.json";

  // DOM refs
  const indexView = document.getElementById("index-view");
  const searchView = document.getElementById("search-view");
  const recipeView = document.getElementById("recipe-view");
  const searchInput = document.getElementById("search-input");
  const filterBar = document.getElementById("filter-bar");
  const mealTypeFilters = document.getElementById("meal-type-filters");
  const tagFilters = document.getElementById("tag-filters");
  const langEn = document.getElementById("lang-en");
  const langDe = document.getElementById("lang-de");
  const unitMetric = document.getElementById("unit-metric");
  const unitImperial = document.getElementById("unit-imperial");
  const cookToggle = document.getElementById("cook-toggle");
  const themeLight = document.getElementById("theme-light");
  const themeDark = document.getElementById("theme-dark");
  const homeLink = document.getElementById("home-link");

  // --- i18n helpers ---

  function t(category, key) {
    const lang = i18n[language];
    if (lang) {
      const cat = lang[category];
      if (cat && cat[key]) return cat[key];
    }
    const en = i18n["en"];
    if (en) {
      const cat = en[category];
      if (cat && cat[key]) return cat[key];
    }
    return key;
  }

  function tUI(key) {
    return t("ui", key);
  }

  function needsTranslation(recipe) {
    return recipe.language !== language;
  }

  function hasTranslation(recipe) {
    if (!needsTranslation(recipe)) return true;
    return recipe.translations && recipe.translations[language];
  }

  function translationBadge(recipe) {
    if (hasTranslation(recipe)) return "";
    return ` <span class="no-translation">${tUI("no_translation_" + recipe.language)}</span>`;
  }

  function getTranslation(recipe) {
    if (needsTranslation(recipe) && recipe.translations && recipe.translations[language]) {
      return recipe.translations[language];
    }
    return null;
  }

  function getTitle(recipe) {
    const tr = getTranslation(recipe);
    return tr ? tr.title : recipe.title;
  }

  function getServingUnit(recipe) {
    const tr = getTranslation(recipe);
    return tr ? tr.serving_unit : recipe.serving_unit;
  }

  function getIngredientName(recipe, index) {
    const tr = getTranslation(recipe);
    if (tr && tr.ingredients && tr.ingredients[index] !== undefined) {
      return tr.ingredients[index];
    }
    return recipe.ingredients[index].name;
  }

  function getInstructions(recipe) {
    const tr = getTranslation(recipe);
    return tr ? tr.instructions : recipe.instructions;
  }

  // --- Variant resolution ---

  /**
   * Resolve a recipe + variant index into an effective view object.
   * variantIdx 0 = base (default); 1..N = recipe.variants[0..N-1].
   */
  function resolveVariant(recipe, variantIdx) {
    const isBase = !variantIdx;
    const variant = isBase ? null : (recipe.variants || [])[variantIdx - 1];

    // Raw (base language) effective fields
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

    // Translation-aware fields
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
          // No translation for this specific variant — use base translation as best-effort
          translatedIngredientNames = tr.ingredients ? tr.ingredients.slice() : null;
          translatedInstructions = tr.instructions;
        }
      }
    }

    return {
      recipe,
      variantIdx,
      isBase,
      title,
      variantName,
      tags,
      ingredients,
      instructions,
      translatedTitle,
      translatedVariantName,
      translatedIngredientNames,
      translatedInstructions,
    };
  }

  /** Display title for a resolved variant, respecting the active language. */
  function resolvedTitle(res) {
    return getTranslation(res.recipe) ? res.translatedTitle : res.title;
  }

  /** Display variant name (for selector button) respecting language. */
  function resolvedVariantName(res) {
    return getTranslation(res.recipe) ? res.translatedVariantName : res.variantName;
  }

  /** Display ingredient name at index for a resolved variant. */
  function resolvedIngredientName(res, index) {
    if (getTranslation(res.recipe) && res.translatedIngredientNames) {
      // translatedIngredientNames is keyed by BASE ingredient index
      // For variant overrides at that index, check if the variant provided its own translation
      const tr = res.translatedIngredientNames[index];
      if (tr !== undefined) return tr;
    }
    return res.ingredients[index].name;
  }

  /** Instructions to render (translated if available, else raw effective). */
  function resolvedInstructions(res) {
    if (getTranslation(res.recipe) && res.translatedInstructions) {
      return res.translatedInstructions;
    }
    return res.instructions;
  }

  /** Union of tags across all variants (base + all entries in recipe.variants). */
  function getAllTagsForRecipe(recipe) {
    const all = new Set(recipe.tags || []);
    for (const v of recipe.variants || []) {
      const vTags = v.tags || recipe.tags || [];
      for (const tag of vTags) all.add(tag);
    }
    return [...all];
  }

  /**
   * Build virtual entries from loaded recipes: one per base + one per variant
   * whose `name` differs from the base recipe title.
   */
  function buildVirtualEntries() {
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

  // --- Init ---

  async function init() {
    loadSettings();
    applyTheme();
    updateThemeButtons();
    updateLangButtons();
    updateUnitButton();
    updateSearchPlaceholder();
    bindEvents();
    await loadI18n();
    updateButtonLabels();
    await loadIndex();
    handleRoute();
  }

  async function loadI18n() {
    try {
      const res = await fetch("i18n.json");
      i18n = await res.json();
    } catch (e) {
      console.warn("Could not load i18n.json:", e);
    }
  }

  function loadSettings() {
    const saved = localStorage.getItem("recipe-lang");
    if (saved === "de" || saved === "en") {
      language = saved;
    } else {
      const browserLang = (navigator.language || "").toLowerCase();
      language = browserLang.startsWith("de") ? "de" : "en";
    }

    const savedUnit = localStorage.getItem("recipe-units");
    if (savedUnit === "metric" || savedUnit === "imperial") {
      unitSystem = savedUnit;
    } else {
      unitSystem = "metric";
    }

    const savedTheme = localStorage.getItem("recipe-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      theme = savedTheme;
    } else {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
  }

  function bindEvents() {
    langEn.addEventListener("click", () => setLanguage("en"));
    langDe.addEventListener("click", () => setLanguage("de"));
    unitMetric.addEventListener("click", () => setUnitSystem("metric"));
    unitImperial.addEventListener("click", () => setUnitSystem("imperial"));
    themeLight.addEventListener("click", () => setTheme("light"));
    themeDark.addEventListener("click", () => setTheme("dark"));
    cookToggle.addEventListener("click", toggleCookingMode);
    searchInput.addEventListener("focus", () => {
      if (currentView === "index") navigateTo("search");
    });
    searchInput.addEventListener("input", onSearchInput);
    homeLink.addEventListener("click", (e) => { e.preventDefault(); navigateTo(""); });
    window.addEventListener("hashchange", handleRoute);
  }

  // --- Routing ---

  function navigateTo(hash) {
    window.location.hash = hash;
  }

  function handleRoute() {
    const hash = window.location.hash.slice(1);

    if (hash.startsWith("recipe/")) {
      const rest = hash.slice(7);
      // Accept "id" or "id/<variantIdx>"
      const slashIdx = rest.indexOf("/");
      let id, variantIdx = 0;
      if (slashIdx === -1) {
        id = rest;
      } else {
        id = rest.slice(0, slashIdx);
        variantIdx = parseInt(rest.slice(slashIdx + 1), 10) || 0;
      }
      showRecipeView(id, variantIdx);
    } else if (hash.startsWith("search")) {
      parseSearchHash(hash);
      showSearchView();
    } else {
      showIndexView();
    }
  }

  function buildSearchHash() {
    const params = new URLSearchParams();
    if (searchQuery) params.set("q", searchQuery);
    if (activeMealType) params.set("meal", activeMealType);
    if (activeTags.size > 0) params.set("tags", [...activeTags].join(","));
    const qs = params.toString();
    return "search" + (qs ? "?" + qs : "");
  }

  function parseSearchHash(hash) {
    const qIdx = hash.indexOf("?");
    if (qIdx === -1) return;
    const params = new URLSearchParams(hash.slice(qIdx));
    searchQuery = params.get("q") || "";
    searchInput.value = searchQuery;
    activeMealType = params.get("meal") || null;
    const tags = params.get("tags");
    activeTags = tags ? new Set(tags.split(",")) : new Set();
  }

  // --- Recipe loading ---

  async function loadIndex() {
    try {
      const res = await fetch(RECIPES_INDEX);
      const ids = await res.json();

      const fetches = ids.map(async (id) => {
        try {
          const r = await fetch(`recipes/${id}.json`);
          const data = await r.json();
          data.id = id;
          return data;
        } catch {
          console.warn(`Failed to load recipe: ${id}`);
          return null;
        }
      });

      recipes = (await Promise.all(fetches)).filter(Boolean);
      virtualEntries = buildVirtualEntries();
      collectFilters();
    } catch (e) {
      indexView.innerHTML = `<p>Could not load recipe index.</p>`;
      console.error("Failed to load index:", e);
    }
  }

  function collectFilters() {
    const tagSet = new Set();
    const mealSet = new Set();
    for (const r of recipes) {
      if (r.meal_type) mealSet.add(r.meal_type);
      for (const tag of getAllTagsForRecipe(r)) {
        tagSet.add(tag);
      }
    }
    allTags = [...tagSet].sort();
    allMealTypes = [...mealSet].sort();
  }

  // --- Language ---

  function setLanguage(lang) {
    language = lang;
    localStorage.setItem("recipe-lang", lang);
    updateLangButtons();
    updateSearchPlaceholder();
    updateButtonLabels();
    // Re-render current view
    if (currentView === "index") renderIndexView();
    else if (currentView === "search") renderSearchView();
    else if (currentView === "recipe" && currentRecipe) renderRecipe();
    renderFilters();
  }

  function updateLangButtons() {
    langEn.classList.toggle("active", language === "en");
    langDe.classList.toggle("active", language === "de");
  }

  function updateSearchPlaceholder() {
    searchInput.placeholder = tUI("search_placeholder");
  }

  function updateButtonLabels() {
    cookToggle.textContent = tUI("cook_mode");
    unitMetric.textContent = tUI("metric");
    unitImperial.textContent = tUI("imperial");
  }

  // --- Units ---

  function setUnitSystem(system) {
    unitSystem = system;
    localStorage.setItem("recipe-units", unitSystem);
    updateUnitButton();
    if (currentView === "recipe" && currentRecipe) renderRecipe();
  }

  function updateUnitButton() {
    unitMetric.classList.toggle("active", unitSystem === "metric");
    unitImperial.classList.toggle("active", unitSystem === "imperial");
  }

  // --- Theme ---

  function setTheme(t) {
    theme = t;
    localStorage.setItem("recipe-theme", theme);
    applyTheme();
    updateThemeButtons();
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
  }

  function updateThemeButtons() {
    themeLight.classList.toggle("active", theme === "light");
    themeDark.classList.toggle("active", theme === "dark");
  }

  // --- Cooking mode ---

  function toggleCookingMode() {
    cookingMode = !cookingMode;
    cookToggle.classList.toggle("active", cookingMode);
    if (currentView === "recipe" && currentRecipe) renderRecipe();
  }

  function updateCookToggleVisibility() {
    cookToggle.classList.toggle("hidden", currentView !== "recipe");
  }

  function bindCookingCheckboxes() {
    if (!cookingMode) return;

    recipeView.querySelectorAll(".cook-check").forEach(cb => {
      const item = cb.closest(".cookable");
      cb.addEventListener("change", () => {
        item.classList.toggle("checked", cb.checked);
        // Check if all steps in a section are done
        const section = item.closest(".instruction-section");
        if (section) {
          const allChecks = section.querySelectorAll(".step-list .cook-check");
          const allDone = [...allChecks].every(c => c.checked);
          section.querySelector(".section-title").classList.toggle("checked", allDone);
        }
      });
    });

    // Clicking the text also toggles
    recipeView.querySelectorAll(".cookable").forEach(item => {
      item.addEventListener("click", (e) => {
        if (e.target.type === "checkbox") return;
        const cb = item.querySelector(".cook-check");
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event("change"));
      });
    });
  }

  // --- Helpers ---

  function timeMeta(recipe) {
    const parts = [];
    if (recipe.prep_time_minutes) parts.push(`${recipe.prep_time_minutes} mins ${tUI("prep")}`);
    if (recipe.cook_time_minutes) parts.push(`${recipe.cook_time_minutes} mins ${tUI("cook")}`);
    return parts.map(p => `<span>${p}</span>`).join("");
  }

  function entryCardHtml(entry) {
    const r = recipes.find(x => x.id === entry.recipeId);
    if (!r) return "";
    const res = resolveVariant(r, entry.variantIdx);
    const title = resolvedTitle(res);
    const ownTags = new Set(res.tags);
    const allTags = getAllTagsForRecipe(r);

    const tagsHtml = allTags.map(tag => {
      const isOwn = ownTags.has(tag);
      if (isOwn) {
        return `<span class="tag">${t("tags", tag)}</span>`;
      }
      return `<span class="tag tag-ghost">${t("tags", tag)} ${tUI("tag_variant_suffix")}</span>`;
    }).join("");

    return `
      <div class="recipe-card" data-id="${r.id}" data-variant="${entry.variantIdx}">
        <h2>${title}${translationBadge(r)}</h2>
        <div class="recipe-card-meta">
          <span class="badge meal-type">${t("meal_types", r.meal_type || "")}</span>
          ${timeMeta(r)}
        </div>
        <div class="recipe-card-tags">
          ${tagsHtml}
        </div>
      </div>
    `;
  }

  function bindCardClicks(container) {
    container.querySelectorAll(".recipe-card").forEach(card => {
      card.addEventListener("click", () => {
        const id = card.dataset.id;
        const variant = parseInt(card.dataset.variant || "0", 10);
        const hash = variant > 0 ? `recipe/${id}/${variant}` : `recipe/${id}`;
        navigateTo(hash);
      });
    });
  }

  // --- Filters ---

  function onSearchInput() {
    searchQuery = searchInput.value.trim().toLowerCase();
    if (currentView === "index") {
      navigateTo(buildSearchHash());
    } else if (currentView === "search") {
      history.replaceState(null, "", "#" + buildSearchHash());
      renderSearchView();
    }
  }

  function toggleTag(tag) {
    if (activeTags.has(tag)) {
      activeTags.delete(tag);
    } else {
      activeTags.add(tag);
    }
    history.replaceState(null, "", "#" + buildSearchHash());
    renderFilters();
    renderSearchView();
  }

  function selectMealType(meal) {
    activeMealType = (activeMealType === meal) ? null : meal;
    history.replaceState(null, "", "#" + buildSearchHash());
    renderFilters();
    renderSearchView();
  }

  function renderFilters() {
    // Meal types
    mealTypeFilters.innerHTML = allMealTypes.map(meal =>
      `<span class="filter-btn meal-type ${activeMealType === meal ? "active" : ""}" data-meal="${meal}">${t("meal_types", meal)}</span>`
    ).join("");

    mealTypeFilters.querySelectorAll(".filter-btn").forEach(el => {
      el.addEventListener("click", () => {
        if (currentView === "index") {
          activeMealType = el.dataset.meal;
          navigateTo(buildSearchHash());
        } else {
          selectMealType(el.dataset.meal);
        }
      });
    });

    // Tags
    tagFilters.innerHTML = allTags.map(tag =>
      `<span class="filter-btn tag ${activeTags.has(tag) ? "active" : ""}" data-tag="${tag}">${t("tags", tag)}</span>`
    ).join("");

    tagFilters.querySelectorAll(".filter-btn").forEach(el => {
      el.addEventListener("click", () => {
        if (currentView === "index") {
          activeTags.add(el.dataset.tag);
          navigateTo(buildSearchHash());
        } else {
          toggleTag(el.dataset.tag);
        }
      });
    });
  }

  function filterEntries() {
    return virtualEntries.filter(entry => {
      const r = recipes.find(x => x.id === entry.recipeId);
      if (!r) return false;
      const res = resolveVariant(r, entry.variantIdx);
      if (searchQuery) {
        const title = resolvedTitle(res).toLowerCase();
        if (!title.includes(searchQuery)) return false;
      }
      if (activeMealType && r.meal_type !== activeMealType) return false;
      if (activeTags.size > 0) {
        const ownTags = new Set(res.tags);
        for (const f of activeTags) {
          if (!ownTags.has(f)) return false;
        }
      }
      return true;
    });
  }

  // --- View switching ---

  function hideAllViews() {
    indexView.classList.add("hidden");
    searchView.classList.add("hidden");
    recipeView.classList.add("hidden");
  }

  // --- Index view ---

  function showIndexView() {
    currentView = "index";
    currentRecipe = null;
    cookingMode = false;
    cookToggle.classList.remove("active");
    searchQuery = "";
    activeTags = new Set();
    activeMealType = null;
    searchInput.value = "";
    hideAllViews();
    indexView.classList.remove("hidden");
    filterBar.classList.remove("hidden");
    updateSearchPlaceholder();
    updateCookToggleVisibility();
    renderFilters();
    renderIndexView();
  }

  function renderIndexView() {
    // Group virtual entries by the base recipe's meal type
    const groups = {};
    for (const meal of allMealTypes) {
      const inGroup = virtualEntries.filter(e => {
        const r = recipes.find(x => x.id === e.recipeId);
        return r && r.meal_type === meal;
      });
      if (inGroup.length > 0) groups[meal] = inGroup;
    }

    if (Object.keys(groups).length === 0) {
      indexView.innerHTML = `<p>${tUI("no_recipes")}</p>`;
      return;
    }

    indexView.innerHTML = Object.entries(groups).map(([meal, entries]) => `
      <div class="meal-group">
        <h2 class="meal-group-title">${t("meal_types", meal)}</h2>
        <div class="recipe-list">
          ${entries.map(entryCardHtml).join("")}
        </div>
      </div>
    `).join("");

    bindCardClicks(indexView);
  }

  // --- Search view ---

  function showSearchView() {
    currentView = "search";
    currentRecipe = null;
    cookingMode = false;
    cookToggle.classList.remove("active");
    hideAllViews();
    searchView.classList.remove("hidden");
    filterBar.classList.remove("hidden");
    updateSearchPlaceholder();
    updateCookToggleVisibility();
    renderFilters();
    renderSearchView();
  }

  function renderSearchView() {
    const filtered = filterEntries();

    if (filtered.length === 0) {
      searchView.innerHTML = `<p>${tUI("no_recipes")}</p>`;
      return;
    }

    searchView.innerHTML = `
      <div class="recipe-list">
        ${filtered.map(entryCardHtml).join("")}
      </div>
    `;

    bindCardClicks(searchView);
  }

  // --- Recipe view ---

  function showRecipeView(id, variantIdx = 0) {
    const recipe = recipes.find(r => r.id === id);
    if (!recipe) {
      recipeView.innerHTML = `<p>Recipe not found.</p>`;
      hideAllViews();
      recipeView.classList.remove("hidden");
      return;
    }
    const nVariants = Array.isArray(recipe.variants) ? recipe.variants.length : 0;
    if (variantIdx < 0 || variantIdx > nVariants) variantIdx = 0;
    currentView = "recipe";
    currentRecipe = recipe;
    currentVariantIdx = variantIdx;
    currentServings = recipe.default_servings;
    cookingMode = false;
    cookToggle.classList.remove("active");
    hideAllViews();
    recipeView.classList.remove("hidden");
    filterBar.classList.add("hidden");
    updateSearchPlaceholder();
    updateCookToggleVisibility();
    renderRecipe();
  }

  function translateUnit(unit) {
    return t("units", unit);
  }

  function renderRecipe() {
    const r = currentRecipe;
    const res = resolveVariant(r, currentVariantIdx);
    const ratio = Scaler.getRatio(r.default_servings, currentServings);

    const scaled = Scaler.scaleIngredients(res.ingredients, ratio);
    const instructions = resolvedInstructions(res);
    const sections = Parser.processInstructions(instructions, ratio, unitSystem, translateUnit);

    const cb = cookingMode ? `<input type="checkbox" class="cook-check">` : "";
    const cookClass = cookingMode ? " cookable" : "";

    const ingredientsHtml = scaled.map((ing, i) => {
      const name = resolvedIngredientName(res, i);

      if (ing.amount == null) {
        return `<li class="${cookClass}">${cb}${name}</li>`;
      }

      let amount = ing.amount;
      let unit = ing.unit;

      if (unitSystem && unit) {
        const converted = Converter.convert(amount, unit, unitSystem);
        if (converted) {
          amount = converted.amount;
          unit = converted.unit;
        }
      }

      const amountStr = Converter.formatAmount(amount);
      const displayUnit = unit && unit !== "whole" ? ` ${translateUnit(unit)}` : "";
      return `<li class="${cookClass}">${cb}<span class="ingredient-amount">${amountStr}${displayUnit}</span> ${name}</li>`;
    }).join("");

    const instructionsHtml = sections.map(sec => {
      const sectionWrap = sec.section ? "instruction-section" : "";
      const title = sec.section ? `<div class="section-title">${sec.section}</div>` : "";
      const steps = sec.steps.map(s => `<li class="${cookClass}">${cb}${s}</li>`).join("");
      return `<div class="${sectionWrap}">${title}<ol class="step-list">${steps}</ol></div>`;
    }).join("");

    // Related recipes
    let relatedHtml = "";
    if (r.related_recipes && r.related_recipes.length > 0) {
      const links = r.related_recipes.map(id => {
        const related = recipes.find(x => x.id === id);
        const name = related ? getTitle(related) : id;
        return `<span class="related-link" data-id="${id}">${name}</span>`;
      }).join(", ");
      relatedHtml = `
        <div class="related-section">
          <h3>${tUI("related")}</h3>
          <p>${links}</p>
        </div>
      `;
    }

    // Meal type and tags link to search — union of tags across variants, ghost for non-owned
    const mealLink = r.meal_type
      ? `<a class="recipe-meta-link badge meal-type" href="#search?meal=${r.meal_type}">${t("meal_types", r.meal_type)}</a>`
      : "";
    const ownTags = new Set(res.tags);
    const unionTags = getAllTagsForRecipe(r);
    const tagLinks = unionTags.map(tag => {
      const isOwn = ownTags.has(tag);
      const cls = isOwn ? "recipe-meta-link tag" : "recipe-meta-link tag tag-ghost";
      const suffix = isOwn ? "" : ` ${tUI("tag_variant_suffix")}`;
      return `<a class="${cls}" href="#search?tags=${tag}">${t("tags", tag)}${suffix}</a>`;
    }).join("");

    // Variant selector — shown only if the recipe has variants
    let variantSelectorHtml = "";
    if (Array.isArray(r.variants) && r.variants.length > 0) {
      const buttons = [];
      for (let i = 0; i <= r.variants.length; i++) {
        const vr = resolveVariant(r, i);
        const label = resolvedVariantName(vr);
        const active = i === currentVariantIdx ? " active" : "";
        buttons.push(`<button class="group-btn variant-btn${active}" data-variant="${i}">${label}</button>`);
      }
      variantSelectorHtml = `<div class="btn-group variant-selector">${buttons.join("")}</div>`;
    }

    // Serve with
    let serveWithHtml = "";
    if (Array.isArray(r.serve_with) && r.serve_with.length > 0) {
      const links = r.serve_with.map(id => {
        const sw = recipes.find(x => x.id === id);
        const name = sw ? getTitle(sw) : id;
        return `<a class="serve-with-link" href="#recipe/${id}">${name}</a>`;
      }).join(", ");
      serveWithHtml = `<div class="serve-with"><strong>${tUI("serve_with")}:</strong> ${links}</div>`;
    }

    recipeView.innerHTML = `
      <div class="recipe-header">
        <h2>${resolvedTitle(res)}${translationBadge(r)}</h2>
        <div class="recipe-meta">
          ${mealLink}
          ${timeMeta(r)}
        </div>
        <div class="recipe-tags">
          ${tagLinks}
        </div>
        ${variantSelectorHtml}
        ${serveWithHtml}
      </div>

      <div class="servings-control">
        <input type="number" id="servings-input" value="${currentServings}" min="1" max="100">
        <span class="serving-unit">${getServingUnit(r)}</span>
      </div>

      <div class="ingredients-section">
        <h3>${tUI("ingredients")}</h3>
        <ul class="ingredient-list">${ingredientsHtml}</ul>
      </div>

      <div class="instructions-section">
        <h3>${tUI("instructions")}</h3>
        ${instructionsHtml}
      </div>

      ${relatedHtml}
    `;

    // Bind servings input
    const servingsInput = document.getElementById("servings-input");
    servingsInput.addEventListener("input", () => {
      const val = parseInt(servingsInput.value, 10);
      if (val > 0) {
        currentServings = val;
        renderRecipe();
      }
    });

    // Bind related recipe links
    recipeView.querySelectorAll(".related-link").forEach(link => {
      link.addEventListener("click", () => {
        navigateTo("recipe/" + link.dataset.id);
      });
    });

    // Bind variant selector
    recipeView.querySelectorAll(".variant-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.variant, 10) || 0;
        if (idx === currentVariantIdx) return;
        const hash = idx > 0 ? `recipe/${r.id}/${idx}` : `recipe/${r.id}`;
        navigateTo(hash);
      });
    });

    bindCookingCheckboxes();
  }

  // --- Start ---
  document.addEventListener("DOMContentLoaded", init);

  return { init };
})();
