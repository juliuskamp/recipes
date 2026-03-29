/**
 * Main application: recipe loading, display, language, search, filtering.
 */
const App = (() => {
  // State
  let recipes = [];       // Array of loaded recipe objects
  let currentRecipe = null;
  let currentServings = 0;
  let language = "en";
  let unitSystem = null;  // null = as-authored, "metric", "imperial"
  let activeFilters = new Set();
  let searchQuery = "";
  let i18n = {};          // Frontend translations (tags, meal types, units, ui)

  const RECIPES_INDEX = "recipes/index.json";

  // DOM refs
  const recipeList = document.getElementById("recipe-list");
  const recipeView = document.getElementById("recipe-view");
  const searchInput = document.getElementById("search-input");
  const filterTags = document.getElementById("filter-tags");
  const langEn = document.getElementById("lang-en");
  const langDe = document.getElementById("lang-de");
  const unitToggle = document.getElementById("unit-toggle");
  const homeLink = document.getElementById("home-link");

  // --- i18n helpers ---

  function t(category, key) {
    if (language === "en" || !i18n[language]) return key;
    const cat = i18n[language][category];
    return (cat && cat[key]) || key;
  }

  function tUI(key) {
    return t("ui", key);
  }

  function getTitle(recipe) {
    if (language !== "en" && recipe.translations && recipe.translations[language]) {
      return recipe.translations[language].title;
    }
    return recipe.title;
  }

  function getServingUnit(recipe) {
    if (language !== "en" && recipe.translations && recipe.translations[language]) {
      return recipe.translations[language].serving_unit;
    }
    return recipe.serving_unit;
  }

  function getIngredientName(recipe, index) {
    if (language !== "en" && recipe.translations && recipe.translations[language]) {
      const names = recipe.translations[language].ingredients;
      if (names && names[index] !== undefined) return names[index];
    }
    return recipe.ingredients[index].name;
  }

  function getInstructions(recipe) {
    if (language !== "en" && recipe.translations && recipe.translations[language]) {
      return recipe.translations[language].instructions;
    }
    return recipe.instructions;
  }

  // --- Init ---

  async function init() {
    loadSettings();
    updateLangButtons();
    updateUnitButton();
    bindEvents();
    await loadI18n();
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
    }
  }

  function bindEvents() {
    langEn.addEventListener("click", () => setLanguage("en"));
    langDe.addEventListener("click", () => setLanguage("de"));
    unitToggle.addEventListener("click", toggleUnits);
    searchInput.addEventListener("input", onSearch);
    homeLink.addEventListener("click", (e) => { e.preventDefault(); showList(); });
    window.addEventListener("hashchange", handleRoute);
  }

  // --- Routing ---

  function handleRoute() {
    const hash = window.location.hash.slice(1);
    if (hash) {
      showRecipe(hash);
    } else {
      showList();
    }
  }

  // --- Recipe index ---

  async function loadIndex() {
    try {
      const res = await fetch(RECIPES_INDEX);
      const ids = await res.json();

      const fetches = ids.map(async (id) => {
        try {
          const r = await fetch(`recipes/${id}.json`);
          return r.json();
        } catch {
          console.warn(`Failed to load recipe: ${id}`);
          return null;
        }
      });

      recipes = (await Promise.all(fetches)).filter(Boolean);
      collectTags();
      renderList();
    } catch (e) {
      recipeList.innerHTML = `<p>Could not load recipe index.</p>`;
      console.error("Failed to load index:", e);
    }
  }

  function collectTags() {
    const allTags = new Set();
    for (const r of recipes) {
      for (const tag of (r.tags || [])) {
        allTags.add(tag);
      }
    }
    renderFilterTags([...allTags].sort());
  }

  // --- Language ---

  function setLanguage(lang) {
    language = lang;
    localStorage.setItem("recipe-lang", lang);
    updateLangButtons();
    updateSearchPlaceholder();
    collectTags();
    if (currentRecipe) {
      renderRecipe();
    } else {
      renderList();
    }
  }

  function updateLangButtons() {
    langEn.classList.toggle("active", language === "en");
    langDe.classList.toggle("active", language === "de");
  }

  function updateSearchPlaceholder() {
    searchInput.placeholder = tUI("search_placeholder") || "Search recipes...";
  }

  // --- Units ---

  function toggleUnits() {
    if (unitSystem === "metric") {
      unitSystem = "imperial";
    } else if (unitSystem === "imperial") {
      unitSystem = null;
    } else {
      unitSystem = "metric";
    }
    localStorage.setItem("recipe-units", unitSystem || "");
    updateUnitButton();
    if (currentRecipe) renderRecipe();
  }

  function updateUnitButton() {
    if (unitSystem === "metric") {
      unitToggle.textContent = "Metric";
      unitToggle.classList.add("active");
    } else if (unitSystem === "imperial") {
      unitToggle.textContent = "Imperial";
      unitToggle.classList.add("active");
    } else {
      unitToggle.textContent = "Original";
      unitToggle.classList.remove("active");
    }
  }

  // --- Search & Filter ---

  function onSearch() {
    searchQuery = searchInput.value.trim().toLowerCase();
    renderList();
  }

  function toggleFilter(tag) {
    if (activeFilters.has(tag)) {
      activeFilters.delete(tag);
    } else {
      activeFilters.add(tag);
    }
    renderFilterTags([...document.querySelectorAll(".filter-tag")].map(el => el.dataset.tag));
    renderList();
  }

  function renderFilterTags(tags) {
    filterTags.innerHTML = tags.map(tag =>
      `<span class="filter-tag ${activeFilters.has(tag) ? "active" : ""}" data-tag="${tag}">${t("tags", tag)}</span>`
    ).join("");

    filterTags.querySelectorAll(".filter-tag").forEach(el => {
      el.addEventListener("click", () => toggleFilter(el.dataset.tag));
    });
  }

  function filterRecipes() {
    return recipes.filter(r => {
      if (searchQuery) {
        const title = getTitle(r).toLowerCase();
        if (!title.includes(searchQuery)) return false;
      }
      if (activeFilters.size > 0) {
        const recipeTags = new Set(r.tags || []);
        for (const f of activeFilters) {
          if (!recipeTags.has(f)) return false;
        }
      }
      return true;
    });
  }

  // --- List view ---

  function showList() {
    window.location.hash = "";
    currentRecipe = null;
    recipeView.classList.add("hidden");
    recipeList.classList.remove("hidden");
    document.getElementById("search-bar").classList.remove("hidden");
    updateSearchPlaceholder();
    renderList();
  }

  function renderList() {
    const filtered = filterRecipes();

    if (filtered.length === 0) {
      recipeList.innerHTML = `<p>${tUI("no_recipes") || "No recipes found."}</p>`;
      return;
    }

    recipeList.innerHTML = filtered.map(r => `
      <div class="recipe-card" data-id="${r.id}">
        <h2>${getTitle(r)}</h2>
        <div class="recipe-card-meta">
          <span>${t("meal_types", r.meal_type || "")}</span>
          <span>${r.prep_time_minutes || 0}min ${tUI("prep") || "prep"}</span>
          <span>${r.cook_time_minutes || 0}min ${tUI("cook") || "cook"}</span>
        </div>
        <div class="recipe-card-tags">
          ${(r.tags || []).map(tag => `<span class="tag">${t("tags", tag)}</span>`).join("")}
        </div>
      </div>
    `).join("");

    recipeList.querySelectorAll(".recipe-card").forEach(card => {
      card.addEventListener("click", () => {
        window.location.hash = card.dataset.id;
      });
    });
  }

  // --- Recipe view ---

  function showRecipe(id) {
    const recipe = recipes.find(r => r.id === id);
    if (!recipe) {
      recipeView.innerHTML = `<p>Recipe not found.</p>`;
      recipeView.classList.remove("hidden");
      recipeList.classList.add("hidden");
      return;
    }
    currentRecipe = recipe;
    currentServings = recipe.default_servings;
    recipeList.classList.add("hidden");
    document.getElementById("search-bar").classList.add("hidden");
    recipeView.classList.remove("hidden");
    renderRecipe();
  }

  function translateUnit(unit) {
    return t("units", unit);
  }

  function renderRecipe() {
    const r = currentRecipe;
    const ratio = Scaler.getRatio(r.default_servings, currentServings);

    // Scale ingredients
    const scaled = Scaler.scaleIngredients(r.ingredients, ratio);

    // Get translated instructions and process
    const instructions = getInstructions(r);
    const sections = Parser.processInstructions(instructions, ratio, unitSystem, translateUnit);

    // Build ingredients HTML
    const ingredientsHtml = scaled.map((ing, i) => {
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
      const name = getIngredientName(r, i);
      return `<li><span class="ingredient-amount">${amountStr}${displayUnit}</span> ${name}</li>`;
    }).join("");

    // Build instructions HTML
    const instructionsHtml = sections.map(sec => {
      const title = sec.section ? `<div class="section-title">${sec.section}</div>` : "";
      const steps = sec.steps.map(s => `<li>${s}</li>`).join("");
      return `${title}<ol class="step-list">${steps}</ol>`;
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
          <h3>${tUI("related") || "Related"}</h3>
          <p>${links}</p>
        </div>
      `;
    }

    recipeView.innerHTML = `
      <div class="recipe-header">
        <h2>${getTitle(r)}</h2>
        <div class="recipe-meta">
          <span>${t("meal_types", r.meal_type || "")}</span>
          <span>${r.prep_time_minutes || 0}min ${tUI("prep") || "prep"}</span>
          <span>${r.cook_time_minutes || 0}min ${tUI("cook") || "cook"}</span>
        </div>
        <div class="recipe-tags">
          ${(r.tags || []).map(tag => `<span class="tag">${t("tags", tag)}</span>`).join("")}
        </div>
      </div>

      <div class="servings-control">
        <label for="servings-input">${tUI("servings") || "Servings"}:</label>
        <input type="number" id="servings-input" value="${currentServings}" min="1" max="100">
        <span class="serving-unit">${getServingUnit(r)}</span>
      </div>

      <div class="ingredients-section">
        <h3>${tUI("ingredients") || "Ingredients"}</h3>
        <ul class="ingredient-list">${ingredientsHtml}</ul>
      </div>

      <div class="instructions-section">
        <h3>${tUI("instructions") || "Instructions"}</h3>
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
        window.location.hash = link.dataset.id;
      });
    });
  }

  // --- Start ---
  document.addEventListener("DOMContentLoaded", init);

  return { init };
})();
